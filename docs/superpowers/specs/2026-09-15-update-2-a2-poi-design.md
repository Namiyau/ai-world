# 主世界更新 2-A2：程序化人工场景与 POI 设计

## 目标

在不改变已稳定的 TerrainSampler、湖泊 WaterLayer、RoadLayer 和无限 Chunk 坐标语义的前提下，为主世界增加确定性人工场景与环境装饰。首批 POI 包括小木屋、加油站、小仓库、废弃营地、小码头、木桥/简单公路桥、矿区工棚、废车点和裸露矿物点；所有位置由 world seed 与 POI cell 坐标决定。

## 约束与不做事项

- POI cell 间距固定为 256m，每个 cell 最多一个主体 POI；同一 seed 重载位置、类型和矿物接口签名不变。
- 现有地形高度、湖泊合法性、水面几何、道路 ribbon 和 chunk 半开范围不改写。
- POI 只在自身 owner chunk 创建和销毁，不跨 chunk 重复构建；加载窗口外不保留网格。
- 本阶段只做视觉和生成稳定性，不加入 NPC、任务、建筑交互、资源采集结算或新经济流程。
- 建筑与桥梁必须使用多点地形采样，超出坡度/高度差阈值时拒绝候选，不用强行拉伸网格制造悬空或穿地。
- 主建筑与大型装饰使用共享材质和低模几何；重复小装饰使用 Babylon instance，保持浏览器负担可控。

## 方案

新增独立 `PoiLayer`，由 `WorldManager` 按 chunk 生命周期驱动。`PoiLayer` 负责三件事：

1. 以 `(seed, cellX, cellZ)` 计算 `PoiPlacement`，根据 `TerrainSampler.sample()`、`nearestRoadSpine()`、`nearestLakeCandidate()` 和局部高度探测筛选环境。
2. 在 placement 合法时构建主体网格、装饰实例和矿物节点，并返回该 POI 的 root mesh 与元数据。
3. 暴露无 Babylon 依赖的 placement/query 函数及矿物数据接口，供单元测试和未来采集系统使用。

`WorldManager` 只负责找到覆盖当前 chunk 的 POI cells、判断 placement 中心是否属于当前 chunk、挂接 root 到 `ChunkRecord`，以及在销毁 chunk 时调用 `disposeCell`。现有商店/传送门仍由 WorldManager 保持，不与 A2 视觉 POI 混合。

## POI 选址规则

- 道路型 POI（小木屋、加油站、小仓库、废弃营地、废车点）先从 cell 内确定性抖动点找到最近道路 spine，再沿道路法线偏移到道路肩部外；要求非水面、离道路中心 8~30m、基座坡度不超过 0.32、footprint 高差不超过 2.4m。
- 小码头先取得合法 lake candidate，在湖岸半径附近查找干燥 shore 点；码头主轴朝向湖心，平台保持水平并只在合法湖盆旁生成。
- 木桥/公路桥只在道路 spine 上尝试，沿道路方向扫描两端；中段必须检测到水面或低地，两端必须为干燥陆地且高度差不超过 2.4m。桥面使用统一高度和低模支柱，不改变 TerrainSampler 地形。
- 矿区工棚和裸露矿物点只在 gravel zone 且 biome 为 rocky/mountain 或 rockiness 足够高的区域尝试，避开水面和道路中心；矿物点沿小半径确定性分布，并贴到各自真实地形高度。

## 类型与视觉构成

```ts
type PoiKind =
  | "cabin" | "gasStation" | "warehouse" | "abandonedCamp"
  | "dock" | "woodBridge" | "roadBridge" | "mineShed"
  | "wreck" | "mineralOutcrop";

type MineralType = "stone" | "iron" | "copper" | "rare";

interface MineralNode {
  id: string;
  type: MineralType;
  amount: number;
  position: { x: number; y: number; z: number };
}
```

主体几何使用箱体、圆柱、低模多面体和屋顶组合。POI 装饰包括围栏、路牌、电线杆、路灯、木箱、油桶、托盘、垃圾桶和长椅；装饰数量由 POI 类型固定规则和 cell hash 决定，不使用 `Math.random`。矿物颜色区分普通石材、铁矿、铜矿和稀有矿，全部写入 mesh metadata 的 `mineralNode` 字段，为以后采集系统保留稳定 id/type/amount/position。

## 测试与验收

- TypeScript 单元测试覆盖：256m cell 归属、同 seed 确定性、道路/湖岸/矿区环境约束、建筑 footprint 坡度拒绝、桥梁两端高度差拒绝、四类矿物类型、不同 POI 类型扫描覆盖。
- 浏览器验收覆盖：已加载 chunk 中存在 POI 主体和装饰 mesh、矿物 metadata 格式正确、POI 无明显异常倾斜、签名跨 reload 一致、无 page error。
- 回归命令：`npm test`、`npm run build`、`python -u tests/browser-acceptance.py`、`python -u tests/browser-water-acceptance.py`、A2 专用 `tests/browser-poi-acceptance.py`。
