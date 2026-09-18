export interface MainMenuSettings {
  reducedMotion: boolean;
  showHints: boolean;
}

export interface MainMenuCallbacks {
  onStartSinglePlayer: () => void;
  onNewSinglePlayer: () => void;
  onSettingsChanged: (settings: MainMenuSettings) => void;
}

const SETTINGS_KEY = "ai-world-settings-v1";
const DEFAULT_SETTINGS: MainMenuSettings = {
  reducedMotion: false,
  showHints: true,
};

export function loadMainMenuSettings(storage: Storage = window.localStorage): MainMenuSettings {
  try {
    const raw = storage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<MainMenuSettings>;
    return {
      reducedMotion: parsed.reducedMotion === true,
      showHints: parsed.showHints !== false,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveMainMenuSettings(settings: MainMenuSettings, storage: Storage = window.localStorage): void {
  storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export class MainMenu {
  private readonly settings: MainMenuSettings;
  private readonly continueButton: HTMLButtonElement;
  private readonly reducedMotionInput: HTMLInputElement;
  private readonly showHintsInput: HTMLInputElement;

  public constructor(
    private readonly root: HTMLDivElement,
    private readonly callbacks: MainMenuCallbacks,
    hasSave: boolean,
  ) {
    this.settings = loadMainMenuSettings();
    root.dataset.mainMenu = "";
    root.setAttribute("aria-label", "主菜单");
    root.innerHTML = `
      <div class="main-menu-shell" data-main-page="home">
        <div class="main-menu-glow main-menu-glow-a"></div>
        <div class="main-menu-glow main-menu-glow-b"></div>
        <header class="main-menu-header">
          <div>
          <p class="main-menu-kicker">PROCEDURAL FRONTIER · BUILD 2-A3</p>
            <h1>AI WORLD</h1>
          </div>
          <div class="main-menu-world-label"><span class="status-dot"></span>主世界 · HOME</div>
        </header>

        <main class="main-menu-layout">
          <section class="main-menu-hero">
            <p class="main-menu-eyebrow">湖岸观测记录  /  001</p>
            <h2>沿着道路，<br /><em>寻找下一片湖。</em></h2>
            <p class="main-menu-intro">一个不断生成的低模世界。森林、道路、湖泊与废弃的人工场景，都在你的下一步之前等待成形。</p>
            <div class="main-menu-rule"><span></span><span>WORLD IS WIDE</span><span></span></div>
          </section>

          <nav class="main-menu-nav" aria-label="主菜单">
            <button class="main-menu-button main-menu-button-primary" type="button" data-main-action="single-player">
              <span class="main-menu-button-mark">↗</span><span><strong data-main-continue-label>继续单人游戏</strong><small>载入你的世界</small></span>
            </button>
            <button class="main-menu-button" type="button" data-main-action="new-single-player">
              <span class="main-menu-button-mark">＋</span><span><strong>新建单人存档</strong><small>从默认出生点开始</small></span>
            </button>
            <button class="main-menu-button" type="button" data-main-action="multiplayer">
              <span class="main-menu-button-mark">◎</span><span><strong>多人游戏</strong><small>共享世界 · 即将推出</small></span>
            </button>
            <div class="main-menu-nav-row">
              <button class="main-menu-button main-menu-button-compact" type="button" data-main-action="settings"><span>设置</span><span>⚙</span></button>
              <button class="main-menu-button main-menu-button-compact" type="button" data-main-action="controls"><span>操作说明</span><span>?</span></button>
            </div>
          </nav>

          <aside class="main-menu-summary" aria-label="世界摘要">
            <div class="main-menu-summary-heading"><span>已保存的远方</span><span class="summary-pulse">LIVE</span></div>
            <div class="main-menu-landscape" aria-hidden="true"><span class="landscape-sun"></span><span class="landscape-mountain landscape-mountain-a"></span><span class="landscape-mountain landscape-mountain-b"></span><span class="landscape-water"></span><span class="landscape-tree tree-a"></span><span class="landscape-tree tree-b"></span><span class="landscape-tree tree-c"></span></div>
            <div class="main-menu-stats">
              <div><strong>∞</strong><span>无限地形</span></div>
              <div><strong>04</strong><span>矿物种类</span></div>
              <div><strong>10+</strong><span>人工场景</span></div>
            </div>
            <p class="main-menu-summary-note">道路会带你穿过森林，湖岸会把你带回水边。</p>
          </aside>
        </main>

        <footer class="main-menu-footer"><span>探索 · 采集 · 交易 · 生存</span><span>LOCAL SAVE / READY</span></footer>
      </div>

      <section class="main-menu-shell main-menu-subpage" data-main-page="multiplayer" hidden>
        <div class="main-menu-subpage-card">
          <p class="main-menu-kicker">NETWORK LOG · 002</p>
          <h2>多人游戏</h2>
          <div class="coming-soon-badge" data-main-status="coming-soon">即将推出</div>
          <p class="main-menu-subpage-copy">共享世界、协作探索和房间邀请正在准备中。当前版本先把一整片世界留给你独自发现。</p>
          <div class="future-features"><span>共享湖泊与道路</span><span>协作采集</span><span>房间邀请</span></div>
          <button class="main-menu-button main-menu-button-back" type="button" data-main-action="back">← 返回主菜单</button>
        </div>
      </section>

      <section class="main-menu-shell main-menu-subpage" data-main-page="settings" hidden>
        <div class="main-menu-subpage-card">
          <p class="main-menu-kicker">FIELD SETTINGS · 003</p>
          <h2>设置</h2>
          <div class="settings-list">
            <label class="setting-row"><span><strong>减少动态效果</strong><small>降低菜单过渡与装饰动画</small></span><input type="checkbox" data-setting="reduced-motion" /></label>
            <label class="setting-row"><span><strong>显示操作提示</strong><small>在游戏右下角保留快捷键提示</small></span><input type="checkbox" data-setting="show-hints" checked /></label>
          </div>
          <p class="main-menu-subpage-note">设置会保存在当前浏览器中。</p>
          <button class="main-menu-button main-menu-button-back" type="button" data-main-action="back">← 返回主菜单</button>
        </div>
      </section>

      <section class="main-menu-shell main-menu-subpage" data-main-page="controls" hidden>
        <div class="main-menu-subpage-card">
          <p class="main-menu-kicker">FIELD MANUAL · 004</p>
          <h2>操作说明</h2>
          <div class="control-grid">
            <div><kbd>W A S D</kbd><span>移动</span></div><div><kbd>Shift</kbd><span>冲刺</span></div>
            <div><kbd>空格</kbd><span>跳跃</span></div><div><kbd>空格 ×2</kbd><span>切换飞行</span></div>
            <div><kbd>E</kbd><span>交互 / 收集</span></div><div><kbd>左键</kbd><span>近战</span></div>
            <div><kbd>Tab</kbd><span>背包</span></div><div><kbd>Esc</kbd><span>游戏菜单</span></div>
          </div>
          <button class="main-menu-button main-menu-button-back" type="button" data-main-action="back">← 返回主菜单</button>
        </div>
      </section>
    `;

    this.continueButton = this.mustFindButton('[data-main-action="single-player"]');
    this.reducedMotionInput = this.mustFindInput('[data-setting="reduced-motion"]');
    this.showHintsInput = this.mustFindInput('[data-setting="show-hints"]');
    this.reducedMotionInput.checked = this.settings.reducedMotion;
    this.showHintsInput.checked = this.settings.showHints;
    this.applyReducedMotion();
    this.setHasSave(hasSave);
    this.bindEvents();
    this.callbacks.onSettingsChanged({ ...this.settings });
  }

  public show(): void {
    this.root.classList.add("open");
    this.root.removeAttribute("aria-hidden");
  }

  public hide(): void {
    this.root.classList.remove("open");
    this.root.setAttribute("aria-hidden", "true");
  }

  public setHasSave(hasSave: boolean): void {
    const label = this.mustFind("[data-main-continue-label]");
    label.textContent = hasSave ? "继续单人游戏" : "开始单人游戏";
    this.continueButton.setAttribute("aria-label", hasSave ? "继续单人游戏，载入你的世界" : "开始单人游戏");
  }

  public dispose(): void {
    this.root.replaceChildren();
  }

  private bindEvents(): void {
    this.root.addEventListener("click", (event) => {
      const action = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-main-action]")?.dataset.mainAction;
      if (!action) return;
      if (action === "single-player") this.callbacks.onStartSinglePlayer();
      else if (action === "new-single-player") this.callbacks.onNewSinglePlayer();
      else if (action === "back") this.showPage("home");
      else if (action === "multiplayer" || action === "settings" || action === "controls") this.showPage(action);
    });

    this.reducedMotionInput.addEventListener("change", () => this.updateSetting("reducedMotion", this.reducedMotionInput.checked));
    this.showHintsInput.addEventListener("change", () => this.updateSetting("showHints", this.showHintsInput.checked));
  }

  private updateSetting(key: keyof MainMenuSettings, value: boolean): void {
    this.settings[key] = value;
    saveMainMenuSettings(this.settings);
    if (key === "reducedMotion") this.applyReducedMotion();
    this.callbacks.onSettingsChanged({ ...this.settings });
  }

  private applyReducedMotion(): void {
    document.documentElement.dataset.reducedMotion = this.settings.reducedMotion ? "true" : "false";
  }

  private showPage(page: string): void {
    for (const element of this.root.querySelectorAll<HTMLElement>("[data-main-page]")) {
      const active = element.dataset.mainPage === page;
      element.hidden = !active;
      element.classList.toggle("active", active);
    }
  }

  private mustFind(selector: string): HTMLElement {
    const element = this.root.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Main menu element missing: ${selector}`);
    return element;
  }

  private mustFindButton(selector: string): HTMLButtonElement {
    const element = this.root.querySelector<HTMLButtonElement>(selector);
    if (!element) throw new Error(`Main menu button missing: ${selector}`);
    return element;
  }

  private mustFindInput(selector: string): HTMLInputElement {
    const element = this.root.querySelector<HTMLInputElement>(selector);
    if (!element) throw new Error(`Main menu input missing: ${selector}`);
    return element;
  }
}
