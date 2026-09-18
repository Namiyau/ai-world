import type { InventoryData, WorldId } from "../types";
import { TIME_PRESET_LABELS, type TimePreset } from "../world/Atmosphere";
import { chunkCountForRadius, loadPauseSettings, savePauseSettings, type PauseSettings } from "./PauseSettings";

const ITEM_LABELS: Record<keyof InventoryData, string> = {
  wood: "木材",
  stone: "石料",
  scrap: "废料",
  relic: "遗物",
};

export interface LandmarkGuide {
  label: string;
  distance: number;
  direction: "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";
}

export interface HudCallbacks {
  /** 面板里的"继续游戏" */
  onResume: () => void;
  /** 面板里的"切换飞行" */
  onToggleFlight: () => void;
  /** 面板里的"回到出生点"（卡地形自救） */
  onReturnToSpawn: () => void;
  /** 面板里的临时湖泊导航 / 传送 */
  onTeleportToLake: () => void;
  /** Pause menu weather/time shortcuts. */
  onSetTimePreset: (preset: TimePreset) => void;
  /** Persistent display, camera and accessibility preferences from the pause menu. */
  onPauseSettingsChanged: (settings: PauseSettings) => void;
}

const DIRECTION_ARROW: Record<LandmarkGuide["direction"], string> = {
  N: "↑",
  NE: "↗",
  E: "→",
  SE: "↘",
  S: "↓",
  SW: "↙",
  W: "←",
  NW: "↖",
};

export class Hud {
  private readonly worldEl: HTMLDivElement;
  private readonly moneyEl: HTMLDivElement;
  private readonly coordinatesEl: HTMLDivElement;
  private readonly promptEl: HTMLDivElement;
  private readonly inventoryEl: HTMLDivElement;
  private readonly toastEl: HTMLDivElement;
  private readonly damageEl: HTMLDivElement;
  private readonly guideEl: HTMLDivElement;
  private readonly lakeTargetEl: HTMLDivElement;
  private readonly characterShowcaseEl: HTMLDivElement;
  private readonly waterEl: HTMLDivElement;
  private readonly flightEl: HTMLDivElement;
  private readonly helpEl: HTMLDivElement;
  private readonly menuEl: HTMLDivElement;
  private readonly flightButton: HTMLButtonElement;
  private readonly timeStatusEl: HTMLParagraphElement;
  private readonly chunkLoadStatusEl: HTMLOutputElement;
  private readonly callbacks: HudCallbacks;
  private pauseSettings: PauseSettings;
  private inventoryOpen = false;
  private toastTimer: number | null = null;
  private guideText = "";
  private paused = false;

  public constructor(private readonly root: HTMLDivElement, callbacks: HudCallbacks) {
    this.callbacks = callbacks;
    this.pauseSettings = loadPauseSettings();
    root.innerHTML = `
      <div class="underwater-tint"></div>
      <div class="damage-flash"></div>
      <div class="hud-top">
        <div class="pill" data-world></div>
        <div class="pill" data-money></div>
        <div class="pill coordinates" data-coordinates></div>
        <div class="pill guide" data-guide></div>
        <div class="pill guide lake-target" data-lake-target></div>
        <div class="pill guide character-showcase-target" data-character-showcase></div>
      </div>
      <div class="crosshair"></div>
      <div class="prompt" data-prompt></div>
      <div class="inventory" data-inventory></div>
      <div class="flight-badge" data-flight>✈ 飞行模式</div>
      <div class="toast" data-toast></div>
      <div class="help">
        点击画面锁定鼠标 · WASD 移动 · Shift 冲刺 · 空格跳跃 / 双击飞行 · E 交互 · 左键近战 · Tab 背包 · Esc 菜单 / 湖泊导航
      </div>
      <div class="pause-overlay" data-menu>
        <div class="pause-panel">
          <header>
            <h2>游戏菜单</h2>
            <p class="pause-sub">按 Esc 或点击「继续游戏」返回</p>
          </header>

          <section>
            <h3>游戏</h3>
            <div class="menu-grid">
              <button type="button" data-action="resume">继续游戏</button>
              <button type="button" data-action="flight">切换飞行模式</button>
            </div>
          </section>

          <section>
            <h3>导航</h3>
            <div class="menu-grid">
              <button type="button" data-action="lake">前往最近湖泊</button>
            </div>
            <p class="menu-hint">临时导航：自动加载最近的合法湖盆，并落在湖岸干燥地面。</p>
          </section>

          <section>
            <h3>时间</h3>
            <div class="menu-grid menu-grid-time">
              <button type="button" data-action="time-dawn">日出</button>
              <button type="button" data-action="time-noon">正午</button>
              <button type="button" data-action="time-dusk">傍晚</button>
              <button type="button" data-action="time-midnight">午夜</button>
            </div>
            <p class="menu-hint" data-time-status>当前：晨间循环</p>
          </section>

          <section class="pause-settings-section">
            <h3>野外控制台</h3>
            <div class="pause-settings-grid">
              <label>渲染分辨率 <output data-setting-output="renderResolution"></output>
                <select data-setting="renderResolution">
                  <option value="75">75% · 节能</option>
                  <option value="100">100% · 原生</option>
                  <option value="125">125% · 清晰</option>
                  <option value="150">150% · 超清</option>
                </select>
              </label>
              <label>区块加载距离 <output data-setting-output="chunkLoadRadius"></output>
                <select data-setting="chunkLoadRadius">
                  <option value="2">2 区块 · 25块</option>
                  <option value="3">3 区块 · 49块</option>
                  <option value="4">4 区块 · 81块</option>
                  <option value="5">5 区块 · 121块</option>
                  <option value="6">6 区块 · 169块</option>
                </select>
              </label>
              <label>远景雾
                <select data-setting="fogDistance">
                  <option value="near">近</option>
                  <option value="standard">标准</option>
                  <option value="far">远</option>
                </select>
              </label>
              <label>视野 <output data-setting-output="fovDegrees"></output>
                <input data-setting="fovDegrees" type="range" min="70" max="105" step="1">
              </label>
              <label>灵敏度 <output data-setting-output="sensitivity"></output>
                <input data-setting="sensitivity" type="range" min="0.45" max="2" step="0.05">
              </label>
              <label class="pause-setting-toggle"><span>显示操作提示</span><input data-setting="showHints" type="checkbox"></label>
              <label class="pause-setting-toggle"><span>减少动态效果</span><input data-setting="reducedMotion" type="checkbox"></label>
            </div>
          </section>

          <section>
            <h3>救援</h3>
            <div class="menu-grid">
              <button type="button" data-action="spawn">回到出生点</button>
            </div>
            <p class="menu-hint">卡在湖里或地形里时用这个；也可以双击空格飞出来。</p>
          </section>

          <section>
            <h3>操作</h3>
            <ul class="menu-keys">
              <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><span>移动</span></li>
              <li><kbd>Shift</kbd><span>冲刺 / 飞行加速</span></li>
              <li><kbd>空格</kbd><span>跳跃（连按两次 = 开关飞行）</span></li>
              <li><kbd>空格</kbd><kbd>Shift</kbd><span>飞行时上升 / 下降</span></li>
              <li><kbd>E</kbd><span>交互、收集、商店、传送</span></li>
              <li><kbd>左键</kbd><span>近战</span></li>
              <li><kbd>Tab</kbd><span>背包</span></li>
              <li><kbd>Esc</kbd><span>打开 / 关闭本菜单</span></li>
          </section>

          <footer>
            <p class="menu-hint" data-menu-note>更多功能会陆续加到这里。</p>
          </footer>
        </div>
      </div>
    `;

    this.worldEl = this.mustFind("[data-world]");
    this.moneyEl = this.mustFind("[data-money]");
    this.coordinatesEl = this.mustFind("[data-coordinates]");
    this.promptEl = this.mustFind("[data-prompt]");
    this.inventoryEl = this.mustFind("[data-inventory]");
    this.toastEl = this.mustFind("[data-toast]");
    this.damageEl = this.mustFind(".damage-flash");
    this.guideEl = this.mustFind("[data-guide]");
    this.lakeTargetEl = this.mustFind("[data-lake-target]");
    this.characterShowcaseEl = this.mustFind("[data-character-showcase]");
    this.waterEl = this.mustFind(".underwater-tint");
    this.flightEl = this.mustFind("[data-flight]");
    this.helpEl = this.mustFind(".help");
    this.menuEl = this.mustFind("[data-menu]");
    this.flightButton = this.mustFindButton('[data-action="flight"]');
    this.timeStatusEl = this.mustFindParagraph("[data-time-status]");
    this.chunkLoadStatusEl = this.mustFindOutput('[data-setting-output="chunkLoadRadius"]');

    this.bindMenu();
    this.syncPauseSettingsInputs();
  }

  private bindMenu(): void {
    // Tab 开合背包（面板打开时忽略）
    window.addEventListener("keydown", (event) => {
      if (event.code !== "Tab" || this.paused) return;
      event.preventDefault();
      this.inventoryOpen = !this.inventoryOpen;
      this.inventoryEl.classList.toggle("open", this.inventoryOpen);
    });

    this.menuEl.addEventListener("click", (event) => {
      const action = (event.target as HTMLElement | null)?.closest("[data-action]")?.getAttribute("data-action");
      if (action === "resume") this.callbacks.onResume();
      else if (action === "flight") this.callbacks.onToggleFlight();
      else if (action === "spawn") this.callbacks.onReturnToSpawn();
      else if (action === "lake") this.callbacks.onTeleportToLake();
      else if (action?.startsWith("time-")) this.callbacks.onSetTimePreset(action.slice("time-".length) as TimePreset);
    });

    const changeSetting = (event: Event) => this.readPauseSetting(event.target);
    this.menuEl.addEventListener("input", changeSetting);
    this.menuEl.addEventListener("change", changeSetting);

    // Esc 菜单状态由 Game 的捕获阶段监听器唯一管理。这里若再切换一次，
    // 会出现“刚打开又立刻关闭”的竞争，导致设置控件不可操作。
  }

  public setWorld(world: WorldId): void {
    this.worldEl.textContent = world === "home" ? "主世界 · HOME" : "任务世界 · EXPEDITION";
  }

  public setMoney(money: number): void {
    this.moneyEl.textContent = `$ ${money.toLocaleString("zh-CN")}`;
  }

  public setCoordinates(x: number, z: number): void {
    this.coordinatesEl.textContent = `坐标 X ${Math.round(x)} · Z ${Math.round(z)}`;
  }

  public setLakeTarget(target: { x: number; z: number; distance: number } | null): void {
    if (!target) {
      this.lakeTargetEl.textContent = "";
      this.lakeTargetEl.classList.remove("show");
      return;
    }

    this.lakeTargetEl.textContent = `湖泊 X ${Math.round(target.x)} · Z ${Math.round(target.z)} · ${Math.round(target.distance)}m`;
    this.lakeTargetEl.classList.add("show");
  }

  public setCharacterShowcaseTarget(target: { x: number; z: number; distance: number } | null): void {
    if (!target) {
      this.characterShowcaseEl.textContent = "";
      this.characterShowcaseEl.classList.remove("show");
      return;
    }
    this.characterShowcaseEl.textContent = `角色展示点 X ${Math.round(target.x)} · Z ${Math.round(target.z)} · ${Math.round(target.distance)}m`;
    this.characterShowcaseEl.classList.add("show");
  }

  /** HUD 顶部的「最近地标」指引 —— 让玩家永远知道该往哪走。 */
  public setLandmarkGuide(guide: LandmarkGuide | null): void {
    if (!guide) {
      if (this.guideText !== "") {
        this.guideText = "";
        this.guideEl.textContent = "";
        this.guideEl.classList.remove("show");
      }
      return;
    }

    const arrow = DIRECTION_ARROW[guide.direction];
    const text = `${arrow} ${guide.label} · ${Math.round(guide.distance)}m`;
    if (text === this.guideText) return;
    this.guideText = text;
    this.guideEl.textContent = text;
    this.guideEl.classList.add("show");
  }

  /** 镜头沉入水下时的屏幕色调。 */
  public setUnderwater(underwater: boolean): void {
    this.waterEl.classList.toggle("show", underwater);
  }

  public setFlightMode(flying: boolean): void {
    this.flightEl.classList.toggle("show", flying);
    this.flightButton.textContent = flying ? "退出飞行模式" : "切换飞行模式";
    if (flying) this.toast("已进入飞行模式 · 双击空格退出");
  }

  public setHintsVisible(visible: boolean): void {
    this.helpEl.classList.toggle("hidden", !visible);
  }

  public setTimePreset(preset: TimePreset): void {
    this.timeStatusEl.textContent = `当前：${TIME_PRESET_LABELS[preset]}`;
  }

  /** Report the actual Babylon render buffer, not the browser window size. */
  public setRenderResolutionStatus(width: number, height: number): void {
    const status = this.root.querySelector<HTMLOutputElement>('[data-setting-output="renderResolution"]');
    if (!status) return;
    status.textContent = `${this.pauseSettings.renderResolution}% · ${Math.round(width)}×${Math.round(height)}`;
  }

  /** Show the configured radius plus the actual streaming window state. */
  public setChunkLoadStatus(loaded: number, pending: number): void {
    const target = chunkCountForRadius(this.pauseSettings.chunkLoadRadius);
    this.chunkLoadStatusEl.textContent = `${this.pauseSettings.chunkLoadRadius} 区块 · ${loaded}/${target} 已载入 · ${pending} 排队`;
  }

  public get settings(): PauseSettings {
    return { ...this.pauseSettings };
  }

  public setVisible(visible: boolean): void {
    this.root.classList.toggle("game-hud-hidden", !visible);
  }

  /** ESC 面板的显示 / 隐藏。 */
  public setPaused(paused: boolean): void {
    this.paused = paused;
    this.menuEl.classList.toggle("open", paused);
    if (paused) {
      this.inventoryOpen = false;
      this.inventoryEl.classList.remove("open");
    }
  }

  public setPrompt(text: string | null): void {
    this.promptEl.textContent = text ?? "";
    this.promptEl.classList.toggle("show", Boolean(text));
  }

  public setInventory(data: InventoryData): void {
    const rows = Object.entries(data)
      .filter(([, amount]) => amount > 0)
      .map(([item, amount]) => `<div class="inventory-row"><span>${ITEM_LABELS[item as keyof InventoryData]}</span><strong>${amount}</strong></div>`)
      .join("");

    this.inventoryEl.innerHTML = `<h3>背包</h3>${rows || '<div class="inventory-empty">空</div>'}`;
  }

  public toast(message: string): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.add("show");
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove("show"), 1250);
  }

  public meleeFeedback(hit: boolean): void {
    if (hit) {
      this.damageEl.classList.add("show");
      window.setTimeout(() => this.damageEl.classList.remove("show"), 70);
    }
  }

  private mustFind(selector: string): HTMLDivElement {
    const element = this.root.querySelector<HTMLDivElement>(selector);
    if (!element) throw new Error(`HUD element missing: ${selector}`);
    return element;
  }

  private mustFindButton(selector: string): HTMLButtonElement {
    const element = this.root.querySelector<HTMLButtonElement>(selector);
    if (!element) throw new Error(`HUD button missing: ${selector}`);
    return element;
  }

  private mustFindParagraph(selector: string): HTMLParagraphElement {
    const element = this.root.querySelector<HTMLParagraphElement>(selector);
    if (!element) throw new Error(`HUD paragraph missing: ${selector}`);
    return element;
  }

  private mustFindOutput(selector: string): HTMLOutputElement {
    const element = this.root.querySelector<HTMLOutputElement>(selector);
    if (!element) throw new Error(`HUD output missing: ${selector}`);
    return element;
  }

  private readPauseSetting(target: EventTarget | null): void {
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    const key = target.dataset.setting as keyof PauseSettings | undefined;
    if (!key) return;
    const value = target instanceof HTMLInputElement && target.type === "checkbox" ? target.checked : target.value;
    const next = { ...this.pauseSettings };
    if (key === "renderResolution" && (value === "75" || value === "100" || value === "125" || value === "150")) next.renderResolution = value;
    else if (key === "chunkLoadRadius" && (value === "2" || value === "3" || value === "4" || value === "5" || value === "6")) next.chunkLoadRadius = Number(value) as PauseSettings["chunkLoadRadius"];
    else if (key === "fogDistance" && (value === "near" || value === "standard" || value === "far")) next.fogDistance = value;
    else if (key === "fovDegrees" && typeof value === "string" && Number.isFinite(Number(value))) next.fovDegrees = Number(value);
    else if (key === "sensitivity" && typeof value === "string" && Number.isFinite(Number(value))) next.sensitivity = Number(value);
    else if (key === "showHints" && typeof value === "boolean") next.showHints = value;
    else if (key === "reducedMotion" && typeof value === "boolean") next.reducedMotion = value;
    else return;
    this.pauseSettings = next;
    savePauseSettings(next);
    this.syncPauseSettingsInputs();
    this.callbacks.onPauseSettingsChanged({ ...next });
  }

  private syncPauseSettingsInputs(): void {
    for (const key of ["renderResolution", "chunkLoadRadius", "fogDistance", "fovDegrees", "sensitivity", "showHints", "reducedMotion"] as const) {
      const control = this.root.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-setting="${key}"]`);
      if (!control) continue;
      const value = this.pauseSettings[key];
      if (control instanceof HTMLInputElement && control.type === "checkbox") control.checked = Boolean(value);
      else control.value = String(value);
    }
    const fov = this.root.querySelector<HTMLOutputElement>('[data-setting-output="fovDegrees"]');
    if (fov) fov.textContent = `${this.pauseSettings.fovDegrees}°`;
    const sensitivity = this.root.querySelector<HTMLOutputElement>('[data-setting-output="sensitivity"]');
    if (sensitivity) sensitivity.textContent = `${this.pauseSettings.sensitivity.toFixed(2)}×`;
    this.chunkLoadStatusEl.textContent = `${this.pauseSettings.chunkLoadRadius} 区块 · 目标 ${chunkCountForRadius(this.pauseSettings.chunkLoadRadius)} 块`;
  }
}
