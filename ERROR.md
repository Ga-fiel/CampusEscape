# 项目问题记录（ERROR.md）

> 记录开发中踩过的坑、根因与防复发手段。按时间倒序，新条目在最上面。
> 目录：`CampusEscape/ERROR.md`

---

## 2026-11-26 · 桌上的书全掉到地面（prefab 偏移被 buildObject 覆盖）

### 一句话
`buildObject` 末尾用 `item.pos` **无条件覆盖**返回对象的 `position`；`book` prefab 却把"抬到桌面"的 `position.y=1.035` 写在**返回对象自身**（一个裸 Mesh）上，于是被 `pos.y=0` 冲掉 → 书落地。桌子椅子没事，因为它们的 prefab 返回的是 Group、偏移加在子 mesh 上。

### 现象
- 教室里每张桌上的书都不在桌面，全落在地面 y=0。
- 无任何报错/警告，纯渲染现象，肉眼才发现。

### 根因
1. 数据侧 `pos:[x, 0, z]` 的 `y=0` 是"这个物体挂在哪块地面格点"的约定，本身没错——真正竖直高度由 prefab 内部负责。
2. 但 `src/scene/scene-build.js` 的 `buildObject` 统一执行 `node.position.fromArray(item.pos)`，把这个"内部高度"覆盖掉了。
3. `book` prefab 当时 `return m`（单个 Mesh），`m.position.y=1.035` 正是被覆盖的那个对象 → 失效掉地。
4. `desk / chair / chalkDoor / classmate` 返回 Group、偏移设在子节点，所以不受影响——**这就是为什么只有书出问题**。

### 修复
`book` prefab 改用 `new THREE.Group()` 包一层，书 mesh 作子节点设 `y=1.035`，被覆盖的是 Group（y=0 无妨），子偏移保留：
```js
book({ mat, params = {} }) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(...), mat);
  m.rotation.y = ...; m.position.y = 1.035;   // 偏移设在子节点
  g.add(m);
  return g;                                    // 返回 Group，非裸 Mesh
}
```

### 防复发（统一机制，重点）
1. **契约写进代码**：`PREFABS` 顶部注明——返回对象的 `position/rotation/scale` 会被 `item.pos/rot/scale` 无条件覆盖，prefab 内部偏移必须加在**子节点**上，返回裸 Mesh 尤其要注意。
2. **开发期断言** `assertPrefabContract(item, node)`：prefab 返回对象若自带非单位 transform（pos≠0/rot≠0/scale≠1）就 `console.warn`，打印 prefab 名+物体 id+pos，同物体去重；`window.__STRICT_PREFAB__=false` 可关。
3. **反向验证过**：临时把 book 退回裸 Mesh 写法，控制台每个书都报 `[prefab契约] "book" ... pos=0.00,1.03,0.00 ... object id=book-0-0-a`；恢复后 warn 归零。证明断言真能抓到这类 bug，不是摆设。
4. 全场体检：5 个 prefab（chalkDoor/groundLines/desk/chair/book）+ classmate 全部合规。

### 相关文件
- `src/scene/scene-build.js` — `PREFABS.book`（改 Group）、`PREFABS` 顶部契约注释、`assertPrefabContract()` / `prefabContractStrict()`

---

## 2026-11-26 · 按 F 门开了却出不去（碰撞不看高度）

### 一句话
碰撞函数只看平面 x/z、不看高度 y。门洞上方留着的「门楣」在 2.7 米高处，平面投影上和实墙一样，把玩家拦在门外 0.45 米——撞的是一堵**悬在头顶、看不见的空墙**。

### 现象
- 走到门边按 F，门扇正常打开（有推开动画、显示"开"），但人往前走**被挡住**，离门框还差一点就走不动。
- 关卡内**所有门**都这样（后门/前门/办公室/另一教室/男女厕）。

### 复现（真机 CDP 仿真）
把玩家摆到教室侧 `x=-6.7, z=7.5`，按 F 开门，按住 W 1.2 秒：
- 修复前 → 只挪到 `x=-6.45`（离墙 x=-6 正好 0.45m ≈ 玩家半径 0.35 + 墙厚/2），**卡死**。
- 修复后 → 一路到 `x=-2.64`，穿过门洞进入走廊。

### 根因
1. 箱庭从「单房间」改「多房间」后，墙体改成沿墙采样、遇门洞留空的自动砌墙器（`WorldBuilder`），并在门洞**上方补了门楣**（否则门洞通到天花板会露缝）。
2. 但 `src/main.js` 的 `resolveCollisions()` 是**早期单房间版本**写的，那时只有四面实心墙，所以**只判 x/z、不判 y**。
3. 门楣 `tag:'wall'`、`minY≈2.7 / maxY=4.2`，在平面投影上正好压在门洞正上方；经碰撞半径 `PR=0.35` 膨胀后，把门洞通道从垂直方向"堵死"。
4. 调试时被误导：门楣 tag 是 `'wall'` 不是 `'door'`，一开始只打印门板碰撞日志看不到它在挡人；`door-collide` 日志又显示门板已让开，看起来"门没问题"——方向全错，真凶是个**从没被打印出来**的东西。

### 修复
`src/main.js` 的 `resolveCollisions()` 加高度判定——**跳过竖直方向不与玩家身体(0~1.8m)重叠的盒子**（门楣/天花板/纯地面不再挡人，实墙照挡）：
```js
const PLAYER_HEAD = 1.8;
for (const w of walls) {
  const wMinY = (w.minY == null) ? 0 : w.minY;
  const wMaxY = (w.maxY == null) ? Infinity : w.maxY;
  if (wMinY > PLAYER_HEAD || wMaxY < 0.05) continue;  // 门楣/天花板/纯地面不挡人
  // ...原来的 x/z AABB 推出逻辑
}
```
（`scene-base.js` 的 `box()` 与 `makeDoor()` 的 collider 本来就带 `minY/maxY` 字段，直接用即可。）

顺带修了个次要隐患：`scene-base.js` 的 `_updateDoorCollider()` 里 `fullyOpen` 原按「动画角度差<1e-3」判定，会让门在旋转途中把门洞斜插挡住；改为 `const fullyOpen = door.isOpen;`——**一按 F 立即让开碰撞，动画只影响观感**。

### 验证
真机 CDP 逐门通行测试（开门 → 内侧点走到外侧点 → 断言到达；实墙 → 断言挡）：

| 门 | 结果 |
|---|---|
| 后门 → 走廊(-4, 7.5) | ✅ reached |
| 前门 → 走廊(-4, -7.5) | ✅ reached |
| 办公室门 → (7, 0) | ✅ reached |
| 另一教室门 → (-7, -22) | ✅ reached |
| 女厕门 → (-7, 16.5) | ✅ reached |
| 男厕门 → (7, 16.5) | ✅ reached |
| 实墙 z=0（应挡） | ✅ 卡在 x=-6.45，reached:false |

### 防复发（重要）
1. **碰撞盒永远是三维的。** 进 `walls` 的盒子都带 `minY/maxY`，任何碰撞函数都必须用它们，绝不"只看平面"。
2. **新增几何形态先列「谁依赖它」清单。** 门楣、天花板、楼梯这类"非地面障碍"一加进来，立刻问：碰撞用了它吗？敌人视线(`occluders`)呢？渲染呢？——每加一种新形态，把所有消费几何的系统过一遍。
3. **用「通行性自测」当回归测试。** 每扇门"开门→从内侧走到外侧→断言到达"，每面实墙"断言过不去"。改任何墙体/碰撞/门都跑一遍。（可做成 `test/walkthrough.test.mjs`，`node` 一跑出通行表。）
4. **调试先要可观测证据，别先猜。** 加坐标/门状态水印（`?debug=1`），卡住先看"停在哪个坐标"。**卡点坐标 ÷ 玩家半径，往往直接说出元凶。** 别先想"可能缓存/可能门板"。
5. **缓存意识。** 开发期多次改同一个 js，普通刷新会吃旧缓存造成"改了没效果"的假象。**验证前一律 Ctrl+Shift+R 硬刷新**，或给模块 import 加 `?v=xxx`。

### 相关文件
- `src/main.js` — `resolveCollisions()`（高度判定修复）
- `src/scenes/scene-base.js` — `WorldBuilder`（砌墙/挖门洞/补门楣）、`makeDoor()`、`_updateDoorCollider()`
- `src/scenes/floor3/index.js` — 六扇门定义、房间 `ROOMS`、门洞 `DOORS`
