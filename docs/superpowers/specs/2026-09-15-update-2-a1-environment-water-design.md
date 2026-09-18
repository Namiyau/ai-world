# Update 2-A1 Stylized Water and Natural Environment Design

## Goal

在不重构已经稳定的地形、水体拓扑、道路和无限 Chunk 核心的前提下，为湖面加入轻微 stylized water 质感，并扩展主世界的自然地表区域与低模环境细节，使玩家在连续探索几分钟内能感受到草地、森林、泥地、碎石地和湖岸浅滩的差异。

## Scope and non-goals

- 保留当前 Babylon.js + TypeScript 无限 Chunk 架构。
- 保留 Water 的真实 Ground-triangle clipping、水平岸线、chunk-local 坐标和 `backFaceCulling`。
- 保持水面不透明；不重新引入透明排序、岸线 alpha 薄膜或 zOffset 依赖。
- 不增加河流、POI、任务、商店、建筑、外部模型资源或新的世界持久化系统。
- 不改变地形高度生成、湖泊合法性、道路几何和 chunk 坐标定义。

## Architecture

### Stylized water

`WaterLayer` 继续消费 `buildWaterTriangles` 的三角形结果，CPU 侧不重新三角化、不移动岸线顶点。每个水面顶点额外携带 `waterDepth`，深度只用于视觉，不参与 topology。

Shader 通过 world-space 坐标和时间 uniform 生成两组低频、低振幅波纹。波幅由水深平滑衰减，水岸交线保持稳定。片元颜色沿用现有浅水青绿到深水蓝的 palette，并叠加：

- 约 3～5cm 的缓慢波动；
- 基于水深的浅深色过渡；
- 基于视线与水平面的轻微 Fresnel 边缘增强；
- 使用天空地平线色的低强度伪天空反射；
- 现有雾效和水下色调。

水材质仍为不透明、背面裁剪、固定水平水位；`color.a` 仍保持 coverage/透明语义隔离，最终输出 alpha 固定为 1。

### Terrain zones

在 `TerrainSampler.sample` 中增加派生的 `TerrainZone`，它不参与高度和水体几何，只用于 Ground 配色与细节规则：

- `grassland`：普通草地；
- `forestFloor`：湿润、森林 biome 下的深色森林土；
- `mudflat`：低洼湿润但没有有效水面的裸露泥地；
- `gravel`：rocky/mountain 或高岩性地表的岩石碎石地；
- `shore`：湖岸浅滩和水边过渡带。

zone 由既有 `surface`、`biome`、`moisture`、`rockiness`、最终高度和水深派生，不改变已有 `lakeMask` / `hasWater` 语义。Ground 顶点色用每个 zone 的低模调色板，并继续叠加现有 macro shade 与 detail grain，区域之间不使用硬贴图边界。

### Natural details

`DetailLayer` 继续按 chunk seed 生成候选点，继续使用 master mesh + `createInstance`。扩展实例类型：

- 多种低模树：圆冠树、针叶树、浅色树；
- 灌木；
- 草簇；
- 小花；
- 芦苇簇；
- 倒木；
- 裸石和小碎石。

候选策略使用 `zone + biome + moisture + height + slope + waterDepth + roadDistance`：

- 湖岸浅滩/浅水边：芦苇、草簇、小花，禁止深水和高密度树木；
- 森林土：树木、灌木、草簇，并以低概率添加倒木；
- 岩石碎石地：裸石/碎石为主，植物密度显著降低；
- 普通草地：草簇、小花、灌木和少量树木；
- 泥地：稀疏草、芦苇或裸露地面，避免森林树冠。

陡坡、道路、有效水体和 clear zones 继续过滤。所有随机数只来自 seed + chunk 坐标，实例数量受每 chunk 候选预算约束，避免破坏现有浏览器性能。

## Interfaces

- `TerrainSample.zone: TerrainZone`。
- `TerrainGridVertex.zone: TerrainZone`，Ground 使用它进行顶点配色。
- `WaterPolygonPoint.waterDepth: number`，由真实 Ground triangle clipping 过程插值得到，仅供水面视觉。
- `WaterLayer.update(deltaSeconds, cameraY, cameraPosition?)` 更新时间与相机位置 uniform。
- `chooseDetailKind(sample, slope, roll)` 或等价的纯规则函数，供 DetailLayer 和单元测试复用。

## Testing and acceptance

TypeScript tests must verify:

1. 同 seed、同坐标得到相同 zone 与水面深度数据；
2. 采样范围内出现至少五种 zone；
3. zone/biome/slope 规则会选择不同的自然细节，不是均匀随机；
4. 水面仍使用原 Ground triangle topology，所有 CPU 水面点保持 `WATER_CONFIG.level`；
5. 水面 source 中存在时间、深度、Fresnel/反射计算，且最终 alpha 仍为不透明；
6. 候选预算和实例 master 数量在设定范围内。

Browser acceptance must verify:

- 页面无非预期 console/page errors；
- 水面在正常视角、湖岸近景和高空视角可见轻微动态波纹与浅深过渡；
- 水面岸线没有重新出现巨大三角形、漂浮薄板或地下水墙；
- 进入不同区域时能看到不同颜色和对应植被组合；
- 同 seed 重载后 zone / detail signature 稳定；
- detail instance 数量处于性能预算内。

## Risks and mitigations

- Shader 波纹可能造成岸线看起来离地：波幅按 `waterDepth` 平滑衰减，深度为零的 clipping edge 不位移。
- 细节种类增加可能导致 draw/instance 数上升：所有新几何使用共享 master 与实例化，保留每 chunk 候选上限。
- Zone 色差过强会破坏低模风格：使用相近明度的柔和 palette，并保留现有 macro/detail 调制。
- 采样规则变更可能影响旧存档视觉：不改变高度与湖泊判定，旧存档只会获得确定性的新增视觉细节。
