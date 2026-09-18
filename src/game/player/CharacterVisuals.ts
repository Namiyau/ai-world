import {
  Color3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  Vector3,
  type Scene,
} from "@babylonjs/core";
import { CHARACTER_MODULE_SLOTS, type CharacterDescriptor, type CharacterModuleSlot } from "./CharacterCatalog";

export interface CharacterVisualBuild {
  root: TransformNode;
  moduleNodes: Map<CharacterModuleSlot, TransformNode>;
  meshCount: number;
}

const materialCache = new WeakMap<Scene, Map<string, StandardMaterial>>();
// The first-person camera eye is about 1.72m above the terrain. Keep showcase
// characters at a believable 1.60–1.70m instead of towering over that view.
const CHARACTER_MODEL_SCALE = 0.46;

function material(scene: Scene, hex: string): StandardMaterial {
  let materials = materialCache.get(scene);
  if (!materials) {
    materials = new Map<string, StandardMaterial>();
    materialCache.set(scene, materials);
  }
  const existing = materials.get(hex);
  if (existing) return existing;
  const created = new StandardMaterial(`character-material-${hex.slice(1)}`, scene);
  created.diffuseColor = Color3.FromHexString(hex);
  created.specularColor = new Color3(0.035, 0.035, 0.035);
  materials.set(hex, created);
  return created;
}

function part(parent: TransformNode, mesh: Mesh): Mesh {
  mesh.parent = parent;
  mesh.isPickable = false;
  mesh.checkCollisions = false;
  // Characters cast a single readable silhouette but must not receive their
  // own CSM samples. Receiving every tiny face/strap part produced the fast
  // dark horizontal shadow bars visible near the showcase.
  mesh.receiveShadows = false;
  return mesh;
}

function box(scene: Scene, parent: TransformNode, name: string, width: number, height: number, depth: number, position: Vector3, hex: string): Mesh {
  const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
  mesh.position.copyFrom(position);
  mesh.material = material(scene, hex);
  return part(parent, mesh);
}

function cylinder(scene: Scene, parent: TransformNode, name: string, height: number, diameter: number, position: Vector3, hex: string): Mesh {
  const mesh = MeshBuilder.CreateCylinder(name, { height, diameter, tessellation: 6 }, scene);
  mesh.position.copyFrom(position);
  mesh.material = material(scene, hex);
  return part(parent, mesh);
}

function sphere(scene: Scene, parent: TransformNode, name: string, diameter: number, position: Vector3, hex: string): Mesh {
  const mesh = MeshBuilder.CreateSphere(name, { diameter, segments: 8 }, scene);
  mesh.position.copyFrom(position);
  mesh.material = material(scene, hex);
  mesh.convertToFlatShadedMesh();
  return part(parent, mesh);
}

function moduleNode(scene: Scene, root: TransformNode, descriptor: CharacterDescriptor, slot: CharacterModuleSlot): TransformNode {
  const variant = descriptor.appearance.modules[slot];
  const node = new TransformNode(`character:${descriptor.id}:module:${slot}:${variant}`, scene);
  node.parent = root;
  return node;
}

/**
 * Build one small, deliberately modular character. All parts are local to the
 * root, so a later art pass can replace a slot without changing world placement.
 */
export function buildCharacterVisual(scene: Scene, descriptor: CharacterDescriptor): CharacterVisualBuild {
  const { proportions, palette, modules } = descriptor.appearance;
  const root = new TransformNode(`character:${descriptor.id}`, scene);
  root.scaling.setAll(CHARACTER_MODEL_SCALE * proportions.bodyScale);
  const moduleNodes = new Map<CharacterModuleSlot, TransformNode>();
  for (const slot of CHARACTER_MODULE_SLOTS) moduleNodes.set(slot, moduleNode(scene, root, descriptor, slot));

  const hair = moduleNodes.get("hair")!;
  // A faceted sphere reads as a head instead of the old pointed polyhedron.
  // The face is intentionally made from small, separate modules so a future
  // GLB can replace hair/face/head without changing the root contract.
  const head = sphere(scene, hair, "head", 1.08, new Vector3(0, 2.72, 0), palette.skin);
  head.scaling.set(0.96, proportions.headScale, 0.94);
  sphere(scene, hair, `hair-${modules.hair}`, 0.88, new Vector3(0, 3.01, 0.08), palette.hair).scaling.set(1.02, 0.62, 0.98);
  sphere(scene, hair, "hair-left", 0.22, new Vector3(-0.42, 2.88, 0.01), palette.hair);
  sphere(scene, hair, "hair-right", 0.22, new Vector3(0.42, 2.88, 0.01), palette.hair);

  const face = moduleNodes.get("hair")!;
  sphere(scene, face, "eye-left", 0.105, new Vector3(-0.18, 2.82, -0.505), "#263338");
  sphere(scene, face, "eye-right", 0.105, new Vector3(0.18, 2.82, -0.505), "#263338");
  const nose = cylinder(scene, face, "nose", 0.14, 0.12, new Vector3(0, 2.70, -0.55), palette.skin);
  nose.rotation.x = Math.PI / 2;
  nose.scaling.y = 1.35;
  box(scene, face, "mouth", 0.2, 0.035, 0.025, new Vector3(0, 2.57, -0.515), palette.hair);

  const neck = moduleNodes.get("outfit")!;
  cylinder(scene, neck, "neck", 0.34, 0.3, new Vector3(0, 2.31, 0), palette.skin);

  const headwear = moduleNodes.get("headwear")!;
  if (modules.headwear === "wide-brim-hat") {
    cylinder(scene, headwear, "merchant-hat-brim", 0.12, 1.3, new Vector3(0, 3.22, 0), palette.jacket);
    cylinder(scene, headwear, "merchant-hat-crown", 0.38, 0.72, new Vector3(0, 3.4, 0), palette.jacket);
  } else if (modules.headwear === "patched-cap") {
    box(scene, headwear, "patched-cap", 0.9, 0.18, 0.72, new Vector3(0, 3.18, -0.02), palette.accent);
  }

  const outfit = moduleNodes.get("outfit")!;
  const shoulderWidth = 1.0 * proportions.shoulderScale;
  box(scene, outfit, `torso-${modules.outfit}`, shoulderWidth, 1.25, 0.62, new Vector3(0, 1.82, 0), palette.jacket);
  box(scene, outfit, "collar", shoulderWidth * 0.54, 0.18, 0.7, new Vector3(0, 2.42, -0.02), palette.accent);
  const armY = 1.83;
  const armSpan = shoulderWidth * 0.72;
  const leftArm = box(scene, outfit, "left-arm", 0.3, 1.12, 0.34, new Vector3(-armSpan, armY, 0), palette.jacket);
  leftArm.rotation.z = -0.08;
  const rightArm = box(scene, outfit, "right-arm", 0.3, 1.12, 0.34, new Vector3(armSpan, armY, 0), palette.jacket);
  rightArm.rotation.z = 0.08;

  const lowerBody = moduleNodes.get("lowerBody")!;
  for (const side of [-1, 1]) box(scene, lowerBody, `${side < 0 ? "left" : "right"}-leg-${modules.lowerBody}`, 0.4, 1.15, 0.42, new Vector3(side * 0.27, 0.92, 0), palette.trousers);

  const footwear = moduleNodes.get("footwear")!;
  for (const side of [-1, 1]) box(scene, footwear, `${side < 0 ? "left" : "right"}-boot-${modules.footwear}`, 0.46, 0.34, 0.68, new Vector3(side * 0.27, 0.25, -0.12), palette.boots);

  const carry = moduleNodes.get("carry")!;
  box(scene, carry, `carry-${modules.carry}`, 0.62, 0.9, 0.28, new Vector3(0, 1.78, 0.43), palette.pack);
  if (modules.carry === "cross-body-goods-bag" || modules.carry === "single-strap") {
    const strap = box(scene, carry, "carry-strap", 0.1, 1.55, 0.1, new Vector3(0, 1.84, -0.34), palette.accent);
    strap.rotation.z = modules.carry === "single-strap" ? -0.42 : 0.38;
  }

  const prop = moduleNodes.get("prop")!;
  if (modules.prop === "price-board") {
    box(scene, prop, "merchant-price-board", 0.76, 0.52, 0.12, new Vector3(0, 1.48, -0.48), palette.accent);
  } else if (modules.prop === "short-club") {
    const club = cylinder(scene, prop, "enemy-short-club", 1.42, 0.18, new Vector3(0.68, 1.22, -0.2), palette.accent);
    club.rotation.z = -0.48;
  }

  return { root, moduleNodes, meshCount: root.getChildMeshes(false).length };
}
