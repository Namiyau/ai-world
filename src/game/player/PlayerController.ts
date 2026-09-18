import { Ray, UniversalCamera, Vector3 } from "@babylonjs/core";
import type { Collider, Scene } from "@babylonjs/core";
import { MOVEMENT_CONFIG } from "../config";
import type { TerrainSample } from "../world/TerrainSampler";

/** 地表查询函数：由 Game 注入，避免玩家控制器直接依赖世界管理器。 */
export type SurfaceProbe = (x: number, z: number) => TerrainSample;

export type MovementMode = "ground" | "flight";

/** 需要把 WASD 关掉，改由本控制器接管。 */
const KEYBOARD_INPUT_TYPE = "FreeCameraKeyboardMoveInput";

/** 把非有限值收敛掉，避免 NaN 在速度积分里扩散。 */
function clampFinite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/**
 * Babylon collision resolution may shorten, slide, or entirely reject the
 * requested movement. Physics velocity must be based on this resolved delta,
 * never on the request that went into the coordinator.
 */
export function collisionResolvedDisplacement(start: Vector3, final: Vector3, result = new Vector3()): Vector3 {
  final.subtractToRef(start, result);
  return result;
}

/**
 * 第一人称玩家控制器。
 *
 * 这里**不使用** Babylon 自带的 `camera.speed` 移动公式 ——
 * 它在 Babylon 9 里是 `speed * sqrt(deltaTime / (fps * 100))`，
 * 配置值既不是"米/秒"也不是"米/帧"，实测 0.38 只有约 0.9 m/s，
 * 而且会随帧率漂移。所以：
 *
 *   - 关掉自带的键盘移动输入（保留鼠标视角）
 *   - 自己维护"米/秒"速度与加速度，按 deltaTime 积分
 *   - 用 `moveWithCollisions` 做碰撞（位移换算成"米/帧"）
 *
 * 附带实现：跳跃、爬台阶、涉水减速、双击空格切换飞行。
 */
export class PlayerController {
  public readonly camera: UniversalCamera;

  private readonly scene: Scene;
  private readonly probe: SurfaceProbe;
  private readonly onModeChange: ((mode: MovementMode) => void) | undefined;

  /** 水平速度（米/秒）。 */
  private readonly velocity = new Vector3(0, 0, 0);
  private verticalVelocity = 0;

  /** 本帧按键状态，由自己的监听器维护，与 Babylon 输入系统无关。 */
  private readonly keys = new Set<string>();
  private sprinting = false;
  private spaceHeld = false;
  private jumpQueued = false;

  private grounded = false;
  /** 脚下地表高度（由每帧的地表采样更新，供爬台阶判断使用）。 */
  private groundHeight = 0;
  private wading = false;
  private underwater = false;
  private mode: MovementMode = "ground";
  private lastSpaceTapAt = 0;
  private lastStepUpAt = 0;
  private elapsedMs = 0;

  /** 复用的射线对象，避免每帧新建。 */
  private readonly downRay = new Ray(Vector3.Zero(), new Vector3(0, -1, 0), 0.5);
  private readonly scratch = new Vector3(0, 0, 0);
  private readonly collisionStart = new Vector3(0, 0, 0);
  private readonly collisionCameraStart = new Vector3(0, 0, 0);
  private readonly collisionDisplacement = new Vector3(0, 0, 0);
  private collider: Collider | null = null;

  public constructor(
    scene: Scene,
    canvas: HTMLCanvasElement,
    spawn: Vector3,
    probe: SurfaceProbe,
    onModeChange?: (mode: MovementMode) => void,
  ) {
    this.scene = scene;
    this.probe = probe;
    this.onModeChange = onModeChange;

    const camera = new UniversalCamera("player-camera", spawn, scene);
    this.camera = camera;
    camera.minZ = 0.08;
    camera.fov = 1.05;
    camera.inertia = 0.18;
    camera.angularSensibility = 2600;
    // 移动与重力全部由本类接管。
    camera.applyGravity = false;
    camera.checkCollisions = true;
    camera.ellipsoid = new Vector3(0.42, 0.9, 0.42);
    // 椭球偏移必须是 0。
    // 碰撞体以"椭球中心"为基准，而相机位置在椭球顶部，Babylon 内部已经做了
    // `center = cameraY - ellipsoid.y` 的换算；再给一个 -0.9 的偏移会把
    // 碰撞体底推到相机下方 2.7m（远远插进地面），于是碰撞系统每帧把玩家顶住、
    // 垂直速度被反复清零，人永远离地、跳不起来。
    camera.ellipsoidOffset = new Vector3(0, 0, 0);
    camera.keysUp = [];
    camera.keysDown = [];
    camera.keysLeft = [];
    camera.keysRight = [];
    camera.keysUpward = [];
    camera.keysDownward = [];
    camera.attachControl(canvas, true);
    // 关键：去掉自带键盘移动，否则它会同时往 cameraDirection 里加速度。
    camera.inputs.removeByType(KEYBOARD_INPUT_TYPE);

    canvas.addEventListener("click", () => {
      if (this.scene.activeCamera === null) return;
      if (document.pointerLockElement !== canvas) void canvas.requestPointerLock();
    });

    window.addEventListener("keydown", (event) => this.handleKeyDown(event));
    window.addEventListener("keyup", (event) => this.handleKeyUp(event));
    // 指针锁被释放（按 Esc）时清空按键，避免"卡住一直往前走"。
    document.addEventListener("pointerlockchange", () => {
      if (document.pointerLockElement === null) {
        this.keys.clear();
        this.sprinting = false;
        this.spaceHeld = false;
      }
    });
  }

  public get movementMode(): MovementMode {
    return this.mode;
  }

  public get isFlying(): boolean {
    return this.mode === "flight";
  }

  /** 镜头是否已经沉到水面以下（用于屏幕色调）。 */
  public get isUnderwater(): boolean {
    return this.underwater;
  }

  public get isWading(): boolean {
    return this.wading;
  }

  /** 外部按钮也可以切换飞行模式。 */
  public toggleFlight(): void {
    this.setMode(this.mode === "flight" ? "ground" : "flight");
  }

  public setMode(mode: MovementMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.verticalVelocity = 0;
    this.velocity.setAll(0);
    this.onModeChange?.(mode);
  }

  /**
   * 每帧推进。必须传入真实帧间隔，速度才与帧率无关。
   *
   * 掉帧时把这一帧切成若干个 ≤ maxStepSeconds 的子步：
   * 既避免单帧位移过大穿过地形，又不会像"直接把 dt 钳死"那样
   * 让游戏时间变慢（实测 14fps 时钳制会让 5.2m/s 变成 3.65m/s）。
   *
   * @param deltaSeconds 帧间隔（秒）
   */
  public update(deltaSeconds: number): void {
    const frameTime = Math.min(Math.max(deltaSeconds, 0), MOVEMENT_CONFIG.maxFrameSeconds);
    if (frameTime <= 0) return;

    this.elapsedMs += frameTime * 1000;
    const position = this.camera.position;
    const sample = this.probe(position.x, position.z);
    this.groundHeight = sample.height;
    this.updateWaterState(position.y, sample);

    const steps = Math.max(1, Math.ceil(frameTime / MOVEMENT_CONFIG.maxStepSeconds));
    const step = frameTime / steps;

    for (let i = 0; i < steps; i += 1) {
      this.integrate(step, sample);
    }

    // 跳跃输入在整帧内只消费一次。
    this.jumpQueued = false;
    this.verticalVelocity = clampFinite(this.verticalVelocity);
    this.velocity.x = clampFinite(this.velocity.x);
    this.velocity.z = clampFinite(this.velocity.z);

    // 兜底：万一因为未加载区块等原因掉出世界，直接拉回地表。
    const after = this.camera.position;
    const ground = this.probe(after.x, after.z);
    if (after.y < ground.height - 25) {
      this.camera.position.y = ground.height + 1.2;
      this.verticalVelocity = 0;
    }
  }

  /** 一个物理子步：先算速度，再做带碰撞的位移。 */
  private integrate(dt: number, sample: TerrainSample): void {
    if (this.mode === "flight") this.updateFlight(dt);
    else this.updateGround(dt, sample);

    // Babylon 要求传"本帧位移"而不是速度。
    this.scratch.set(this.velocity.x * dt, this.verticalVelocity * dt, this.velocity.z * dt);

    if (this.mode === "flight") {
      // 创造模式飞行：不受地形阻挡，想去哪去哪。
      this.camera.position.addInPlace(this.scratch);
      this.grounded = false;
      return;
    }

    const applied = this.collideWithWorld(this.scratch);
    // 把"实际发生的位移"换算回速度：撞墙时水平速度归零，落地时垂直速度归零。
    if (dt > 0 && applied) {
      this.velocity.x = clampFinite(applied.x / dt);
      this.velocity.z = clampFinite(applied.z / dt);
      this.verticalVelocity = clampFinite(applied.y / dt);
    }
    this.detectGround();
  }

  public teleport(position: Vector3): void {
    this.camera.position.copyFrom(position);
    this.camera.cameraDirection.set(0, 0, 0);
    this.velocity.setAll(0);
    this.verticalVelocity = 0;
    this.grounded = false;
  }

  /** ESC 面板打开时冻结玩家：清空按键与速度。 */
  public setInputEnabled(enabled: boolean): void {
    if (enabled) return;
    this.keys.clear();
    this.sprinting = false;
    this.spaceHeld = false;
    this.velocity.setAll(0);
    this.verticalVelocity = 0;
  }

  /** 当前速度（米/秒），用于 HUD 或调试。 */
  public get speed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  /** Display-only settings; movement, collision and vertical physics remain unchanged. */
  public setCameraPreferences(fovDegrees: number, sensitivity: number): void {
    const fov = Math.min(105, Math.max(70, fovDegrees));
    const scale = Math.min(2, Math.max(0.45, sensitivity));
    this.camera.fov = (fov * Math.PI) / 180;
    this.camera.angularSensibility = 2600 / scale;
  }

  /** ---------- 移动 ---------- */

  private updateGround(dt: number, sample: TerrainSample): void {
    const config = MOVEMENT_CONFIG;
    const wish = this.wishDirection();

    let targetSpeed = this.sprinting ? config.sprintSpeed : config.walkSpeed;
    // 涉水明显减速。
    if (this.wading) targetSpeed *= config.waterSpeedMultiplier;

    const targetX = wish.x * targetSpeed;
    const targetZ = wish.z * targetSpeed;
    const accel = this.grounded ? config.groundAcceleration : config.airAcceleration;
    this.velocity.x = approach(this.velocity.x, targetX, accel * dt);
    this.velocity.z = approach(this.velocity.z, targetZ, accel * dt);

    if (this.grounded) {
      if (this.jumpQueued) {
        this.verticalVelocity = config.jumpVelocity;
        this.grounded = false;
        this.jumpQueued = false;
      } else {
        // 静止时绝不反复往地面施加位移：碰撞器每帧纠正这类请求会把
        // 极小的高度误差反馈给相机，表现为第一人称画面上下微抖。
        // 只有玩家主动沿地面行走时才给极轻的贴地速度，帮助下坡保持接触。
        this.verticalVelocity = wish.lengthSquared() > 0 ? -config.groundStickSpeed : 0;
      }
    } else {
      this.verticalVelocity += config.gravity * dt;
      if (this.verticalVelocity < config.terminalVelocity) this.verticalVelocity = config.terminalVelocity;
    }

    // 爬台阶：被挡住时给一次向上的助力，避免在河岸/石块前"顶着走不动"。
    this.tryStepUp(sample);
  }

  private updateFlight(dt: number): void {
    const config = MOVEMENT_CONFIG;
    const wish = this.wishDirection();
    const speed = this.sprinting ? config.flightSprintSpeed : config.flightSpeed;
    const accel = config.flightAcceleration;

    this.velocity.x = approach(this.velocity.x, wish.x * speed, accel * dt);
    this.velocity.z = approach(this.velocity.z, wish.z * speed, accel * dt);

    // 飞行时：空格上升、Shift 下降。
    // （碰撞关闭，所以 Shift 不再需要充当冲刺键，正好复用。）
    let vertical = 0;
    if (this.spaceHeld) vertical += 1;
    if (this.sprinting) vertical -= 1;
    this.verticalVelocity = approach(this.verticalVelocity, vertical * speed * 0.8, accel * dt);
    this.jumpQueued = false;
  }

  /**
   * 把按键翻译成"朝向 + 右向"的世界方向（水平面内，已归一化）。
   * 用相机自身的朝向矩阵，所以抬头/低头时不会往天上走。
   */
  private wishDirection(): Vector3 {
    const forward = this.axis(
      this.keys.has("KeyW"),
      this.keys.has("KeyS"),
      this.camera.getDirection(Vector3.Forward()),
    );
    const right = this.axis(
      this.keys.has("KeyD"),
      this.keys.has("KeyA"),
      this.camera.getDirection(Vector3.Right()),
    );

    forward.y = 0;
    right.y = 0;
    if (forward.lengthSquared() > 0) forward.normalize();
    if (right.lengthSquared() > 0) right.normalize();

    const direction = forward.addInPlace(right);
    if (direction.lengthSquared() > 1) direction.normalize();
    return direction;
  }

  private axis(positive: boolean, negative: boolean, direction: Vector3): Vector3 {
    if (positive === negative) return Vector3.Zero();
    return positive ? direction : direction.scale(-1);
  }

  /** ---------- 地面与水体判定 ---------- */

  /**
   * 用一条向下的短射线判断是否站在地面上。
   *
   * 射线必须从**碰撞体的底部**发出，而不是相机位置：
   * 碰撞体底在相机下方 ellipsoid.y 处，如果从相机发射，
   * 平地静止时距离是 ellipsoid.y(0.9) —— 只要射线比它短就会永远打不中。
   */
  private detectGround(): void {
    const position = this.camera.position;
    const footY = position.y - this.camera.ellipsoid.y + this.camera.ellipsoidOffset.y;
    this.downRay.origin.set(position.x, footY, position.z);
    this.downRay.length = MOVEMENT_CONFIG.groundProbeDistance;
    const pick = this.scene.pickWithRay(this.downRay, (mesh) => mesh.checkCollisions);
    this.grounded = Boolean(pick?.hit) && this.verticalVelocity <= 0.01;
  }

  private updateWaterState(eyeY: number, sample: TerrainSample): void {
    if (sample.waterDepth <= 0) {
      this.wading = false;
      this.underwater = false;
      return;
    }
    const feetY = eyeY - 1.72;
    const surface = sample.waterLevel;
    this.wading = Math.max(0, surface - feetY) > 0.42;
    this.underwater = eyeY < surface - 0.05;
  }

  /**
   * 带碰撞的位置推进。
   *
   * Camera 上没有 `moveWithCollisions`（那是 AbstractMesh 的 API），
   * 相机的碰撞入口 `_collideWithWorld` 依赖内部回调，直接调用不会写回位置
   * （实测调用后位置原地不动）。所以这里绕开它，直接使用
   * `scene.collisionCoordinator` —— 这正是 Babylon 内部的做法，
   * 区别是我们自己掌握回调，也就能拿到"实际发生的位移"。
   *
   * @returns 实际发生的位移
   */
  private collideWithWorld(displacement: Vector3): Vector3 {
    const coordinator = this.scene.collisionCoordinator;
    const cameraStart = this.collisionCameraStart;
    cameraStart.copyFrom(this.camera.position);
    // 碰撞体以"椭球中心"为基准，相机位置在椭球顶部，所以要先下移一个半径。
    const start = this.collisionStart;
    start.copyFrom(this.camera.position);
    start.y -= this.camera.ellipsoid.y;
    start.addInPlace(this.camera.ellipsoidOffset);

    if (!this.collider) {
      this.collider = coordinator.createCollider();
      this.collider._radius = this.camera.ellipsoid;
      this.collider.collisionMask = this.camera.collisionMask;
    }

    const camera = this.camera;
    const ellipsoidY = camera.ellipsoid.y;
    const offset = camera.ellipsoidOffset;
    coordinator.getNewPosition(start, displacement, this.collider, 3, null, (_collider, newPosition) => {
      // 把椭球中心的位置换算回相机位置。
      camera.position.copyFrom(newPosition);
      camera.position.y += ellipsoidY;
      camera.position.subtractInPlace(offset);
    }, camera.uniqueId);

    return collisionResolvedDisplacement(cameraStart, camera.position, this.collisionDisplacement);
  }
  /**
   * 爬台阶辅助。
   *
   * Babylon 的碰撞是"贴合滑动"而没有自动踏步，所以遇到 30° 以上的坡或者
   * 半米高的坎时会顶着走不动 —— 掉进低洼地形后爬不出来就是这个原因。
   * 这里在被挡住且贴着地面时，给一次短暂的向上助力，把玩家"抬"上台阶。
   */
  private tryStepUp(sample: TerrainSample): void {
    if (!this.grounded || this.mode === "flight") return;
    if (this.velocity.lengthSquared() < 0.6) return;
    if (this.elapsedMs - this.lastStepUpAt < MOVEMENT_CONFIG.stepUpCooldownMs) return;

    // 前方的地面是否明显高于脚下？
    const forwardX = this.velocity.x;
    const forwardZ = this.velocity.z;
    const length = Math.hypot(forwardX, forwardZ);
    if (length < 0.01) return;

    const position = this.camera.position;
    const lookAhead = MOVEMENT_CONFIG.stepUpProbeDistance;
    const probeX = position.x + (forwardX / length) * lookAhead;
    const probeZ = position.z + (forwardZ / length) * lookAhead;
    const aheadHeight = this.probe(probeX, probeZ).height;
    const rise = aheadHeight - this.groundHeight;

    // 前方比脚下高、但没高过"能跨上去"的高度时，给一次向上的助力。
    if (rise > 0.22 && rise < MOVEMENT_CONFIG.stepUpHeight) {
      this.verticalVelocity = Math.max(this.verticalVelocity, 3.2);
      this.grounded = false;
      this.lastStepUpAt = this.elapsedMs;
    }
    void sample;
  }

  /** ---------- 输入 ---------- */

  private handleKeyDown(event: KeyboardEvent): void {
    const code = event.code;

    if (code === "ShiftLeft" || code === "ShiftRight") this.sprinting = true;

    if (code === "Space") {
      event.preventDefault();
      if (!event.repeat) {
        // 双击空格 = 切换飞行（类似创造模式）
        const now = performance.now();
        if (now - this.lastSpaceTapAt < MOVEMENT_CONFIG.flightToggleWindowMs) {
          this.toggleFlight();
          this.lastSpaceTapAt = 0;
          return;
        }
        this.lastSpaceTapAt = now;
        this.jumpQueued = true;
      }
      this.spaceHeld = true;
    }

    this.keys.add(code);
  }

  private handleKeyUp(event: KeyboardEvent): void {
    const code = event.code;
    if (code === "ShiftLeft" || code === "ShiftRight") this.sprinting = false;
    if (code === "Space") this.spaceHeld = false;
    this.keys.delete(code);
  }
}

/** 把 current 以固定步长逼近 target（比直接插值更可控）。 */
function approach(current: number, target: number, maxDelta: number): number {
  const difference = target - current;
  if (Math.abs(difference) <= maxDelta) return target;
  return current + Math.sign(difference) * maxDelta;
}
