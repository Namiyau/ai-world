# Update 1.1 世界几何修复设计

## 目标

修正道路 Ribbon、湖泊确定性、水面几何、道路压平、chunk 坐标、环境光照和地形 flat normals 的结构性错误；暂时完全关闭程序化河流，保持 Update 1.1 范围，不引入 POI、商店或 Update 2 内容。

## 已确认的根因

- `Roads.ts` 将多条道路以及同一道路的左右边缘混入一个 `pathArray`，Babylon 会把不应相连的 path 当作相邻 path 连接。
- 道路边缘只按轴向偏移，没有按中心线切线生成真正的横向法线；12m 采样又会放大弯道扭曲。
- `TerrainSampler` 仍在高度函数内生成横纵无限河网和支流，导致局部水位与斜面水网问题。
- `lakeAt` 使用当前查询点的 `baseHeight` 做低地资格判断，同一 lake cell 的存在性会随查询点变化。
- Water shader 把 `color.a` 同时注释为水面高度和实际写入的 coverage，语义冲突；水体还关闭了背面剔除。
- `flattenWidth = 58` 与约 6.4m 道路宽度无关，造成大范围地形平台。
- chunk 索引用 `[cx*size, (cx+1)*size)`，但 mesh 中心用 `cx*size`，实际地面范围偏移半个 chunk。
- `applyFlatNormals` 对相邻面法线求平均后写回共享顶点，实际是 smooth shading。
- `Game.ts` 与 `Atmosphere.ts` 都配置了 fog 和 lights。

## 设计

### 1. 道路几何

保留当前解析式中心线，但将道路几何拆为“道路单元”处理。每一条纵向或横向道路独立采样，采样间隔约 3.2m。对每个中心线采样点使用相邻点计算 XZ 切线 `t`，用 `(-t.z, t.x)` 得到单位左法线，用 `+/- halfWidth` 生成左右边缘。每条道路单独调用 `CreateRibbon`，`pathArray` 永远严格为 `[leftPath, rightPath]`；不同道路不会成为同一 Ribbon 的相邻 path。chunk 可保留多个合法 Ribbon mesh，避免错误 merge。

道路影响半径不再读取独立的大 `flattenWidth`，而由 `halfWidth + shoulderWidth` 推导。道路路面仍约 6.4m，肩部只作为合理的地形过渡带。

### 2. 湖泊与水面

删除河流/支流对 `TerrainSampler` 的所有参与。`WaterField` 仅包含 lake depth 和全局湖面高度。lake cell 先用 `seed + gx + gz` 生成候选中心、半径和深度，再在候选中心调用基础地形函数一次决定低地资格；候选 cell 的结果缓存或纯函数化，绝不读取当前查询点高度作为存在性条件。

WaterLayer 只为湖泊生成水面三角形，所有顶点 Y 都使用 `WATER_CONFIG.level`。保留按湿润顶点裁剪岸边三角形，但不允许不同水位顶点拼成斜面。顶点 `color.a` 统一表示 coverage；shader 不再把 alpha 当水面高度，也移除额外 normal offset。开发阶段启用 `backFaceCulling`。

### 3. Chunk 与地形法线

chunk 的唯一空间定义为 `[cx*chunkSize, (cx+1)*chunkSize)` 和 `[cz*chunkSize, (cz+1)*chunkSize)`，mesh 中心为 `((cx+0.5)*size, (cz+0.5)*size)`。地面、水面、道路、散布物、资源、敌人与地标归属全部以此定义工作。

地面网格在写入采样高度后展开索引三角形：每个三角形拥有独立的三个顶点和独立法线，法线直接由该三角形边向量计算。这样真正得到 flat low-poly，而不是对共享顶点做相邻面平均。

### 4. 环境系统

`Atmosphere` 是唯一 fog、clear color、天空、半球光和太阳光的创建者。`Game` 只负责场景、物理碰撞和游戏系统装配，不再写环境光照设置。

## 测试与验收

新增 Node 24 原生 `node:test` 测试脚本，不增加运行时依赖。测试覆盖：道路 path 结构和切线垂线、lake cell 查询顺序无关、湖面 Y 全相等、chunk 范围、独立 flat normals、河流代码路径停用和 Atmosphere 唯一光照配置。随后运行 `npm test`、`npm run build`，并用浏览器检查高空、地底、道路 chunk 接缝、湖面水平与同 seed 刷新一致性。
