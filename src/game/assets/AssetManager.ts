import { AbstractMesh, AssetContainer, Mesh, Node, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import "@babylonjs/loaders/glTF";
import { getAssetDefinition, selectAssetVariant } from "./AssetRegistry";
import type { AssetMetadata, AssetSelection } from "./AssetTypes";

export interface AssetInstance {
  readonly roots: readonly Node[];
}

export interface AssetContainerHandle {
  instantiate(namePrefix: string): AssetInstance;
  dispose(): void;
}

export interface AssetLoader {
  load(url: string, scene: Scene): Promise<AssetContainerHandle>;
}

export interface AssetManagerOptions {
  readonly loader?: AssetLoader;
  readonly warn?: (message: string) => void;
  readonly onFormalAsset?: (root: TransformNode) => void;
}

export interface AssetSlotOptions {
  readonly parent?: TransformNode;
  readonly position?: Vector3;
  /** Existing children stay in place and are hidden only after formal asset load. */
  readonly fallbackOwner?: TransformNode;
}

export interface AssetSlot {
  readonly root: TransformNode;
  readonly selection: AssetSelection;
  readonly ready: Promise<boolean>;
  readonly metadata: AssetMetadata;
  dispose(): void;
}

interface SlotState {
  readonly root: TransformNode;
  readonly fallbackRoots: readonly AbstractMesh[];
  readonly selection: AssetSelection;
  readonly metadata: AssetMetadata;
  importedRoots: Node[];
}

class BabylonAssetContainerHandle implements AssetContainerHandle {
  public constructor(private readonly container: AssetContainer) {}

  public instantiate(namePrefix: string): AssetInstance {
    const result = this.container.instantiateModelsToScene((sourceName) => `${namePrefix}-${sourceName}`, false);
    return { roots: result.rootNodes.filter((node): node is Node => node instanceof Node) };
  }

  public dispose(): void {
    this.container.dispose();
  }
}

const defaultLoader: AssetLoader = {
  async load(url, scene): Promise<AssetContainerHandle> {
    const container = await LoadAssetContainerAsync(url, scene, { pluginExtension: ".glb" });
    return new BabylonAssetContainerHandle(container);
  },
};

export class AssetManager {
  private readonly loader: AssetLoader;
  private readonly warn: (message: string) => void;
  private readonly onFormalAsset: ((root: TransformNode) => void) | undefined;
  private readonly cache = new Map<string, Promise<AssetContainerHandle>>();
  private readonly handles = new Set<AssetContainerHandle>();
  private readonly slots = new Set<SlotState>();
  private readonly _diagnostics: string[] = [];

  public constructor(private readonly scene: Scene, options: AssetManagerOptions = {}) {
    this.loader = options.loader ?? defaultLoader;
    this.warn = options.warn ?? ((message) => console.warn(message));
    this.onFormalAsset = options.onFormalAsset;
  }

  public get diagnostics(): readonly string[] {
    return this._diagnostics;
  }

  public select(assetId: string, seed: number): AssetSelection {
    return selectAssetVariant(assetId, seed);
  }

  public async preload(assetIds: readonly string[]): Promise<void> {
    // Warm only one usable variant per asset. createSlot still loads the
    // deterministically selected variant on demand, so preloading every
    // visual variant would spend startup bandwidth and parse time on assets
    // that may never enter the active window.
    const loads = assetIds.flatMap((assetId) => {
      const definition = getAssetDefinition(assetId);
      const variant = definition.variants.find((candidate) => candidate.url);
      return variant ? [this.loadVariant(assetId, variant.id)] : [];
    });
    await Promise.all(loads);
  }

  public createSlot(
    assetId: string,
    seed: number,
    fallbackRoots: readonly AbstractMesh[] = [],
    options: AssetSlotOptions = {},
  ): AssetSlot {
    const selection = this.select(assetId, seed);
    const root = new TransformNode(`asset-slot-${assetId}-${seed}`, this.scene);
    if (options.parent) root.parent = options.parent;
    const metadata: AssetMetadata = {
      assetId,
      category: selection.category,
      variantId: selection.variant.id,
      source: "procedural-fallback",
      fallbackKey: selection.variant.fallbackKey,
      lodLevel: 0,
    };
    root.metadata = { ...(root.metadata ?? {}), asset: metadata };
    if (options.position) root.position.copyFrom(options.position);
    const ownedFallbackRoots = options.fallbackOwner?.getChildMeshes(false) ?? fallbackRoots;
    if (!options.fallbackOwner) {
      for (const fallback of fallbackRoots) fallback.parent = root;
    }

    const state: SlotState = { root, fallbackRoots: ownedFallbackRoots, selection, metadata, importedRoots: [] };
    this.slots.add(state);
    const ready = this.upgradeSlot(state);
    return {
      root,
      selection,
      ready,
      metadata,
      dispose: () => this.disposeSlot(state),
    };
  }

  public dispose(): void {
    for (const slot of [...this.slots]) this.disposeSlot(slot);
    for (const handle of this.handles) handle.dispose();
    this.handles.clear();
    this.cache.clear();
  }

  private async upgradeSlot(state: SlotState): Promise<boolean> {
    const url = state.selection.variant.url;
    if (!url) return false;
    try {
      const handle = await this.loadVariant(state.selection.assetId, state.selection.variant.id);
      if (state.root.isDisposed() || !this.slots.has(state)) return false;
      const instance = handle.instantiate(`${state.selection.assetId}-${state.selection.variant.id}`);
      state.importedRoots = [...instance.roots];
      for (const imported of state.importedRoots) {
        imported.parent = state.root;
        imported.metadata = {
          ...(imported.metadata ?? {}),
          asset: {
            assetId: state.selection.assetId,
            category: state.selection.category,
            variantId: state.selection.variant.id,
            source: "glb",
            fallbackKey: state.selection.variant.fallbackKey,
            lodLevel: 0,
          } satisfies AssetMetadata,
        };
      }
      for (const fallback of state.fallbackRoots) fallback.setEnabled(false);
      state.metadata.source = "glb";
      state.root.metadata = { ...(state.root.metadata ?? {}), asset: state.metadata };
      this.onFormalAsset?.(state.root);
      return true;
    } catch (error) {
      const message = `Asset ${state.selection.assetId}/${state.selection.variant.id} kept procedural fallback: ${String(error)}`;
      this._diagnostics.push(message);
      this.warn(message);
      return false;
    }
  }

  private loadVariant(assetId: string, variantId: string): Promise<AssetContainerHandle> {
    const cacheKey = `${assetId}/${variantId}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    const variant = getAssetDefinition(assetId).variants.find((candidate) => candidate.id === variantId);
    const url = variant?.url;
    if (!url) return Promise.reject(new Error(`Asset variant ${cacheKey} has no GLB URL`));
    const pending = this.loader.load(url, this.scene).then((handle) => {
      this.handles.add(handle);
      return handle;
    });
    this.cache.set(cacheKey, pending);
    return pending;
  }

  private disposeSlot(state: SlotState): void {
    if (!this.slots.delete(state)) return;
    for (const imported of state.importedRoots) imported.dispose(false, true);
    state.root.dispose(false, true);
  }
}

export function createFallbackMeshSlotRoot(root: TransformNode, fallback: Mesh): TransformNode {
  fallback.parent = root;
  return root;
}
