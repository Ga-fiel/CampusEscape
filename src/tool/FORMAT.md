# 场景数据格式（Scene JSON）

这套格式只描述**空间里有什么**，不描述怎么渲染。任何符合本格式的 JSON 都能直接丢进
`src/tool/` 的编辑器里拖动、旋转、缩放，再导出回来。

- 数据层：`src/scene/scene-data.js`（本关的实例数据）
- 格式契约与归一化：`src/scene/schema.js`
- 构建器：`src/scene/scene-build.js`
- 反解回 JSON：`src/scene/serialize.js`
- 编辑器：`src/tool/index.html`

---

## 顶层结构

```json
{
  "version": 1,
  "name": "campus-escape-l1",
  "unit": "meter",
  "room": { "w": 16, "h": 4.2, "d": 22 },
  "markers": { "playerStart": [-4.6, 1.6, -1.55] },
  "objects": []
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `version` | 否 | 目前恒为 `1`。 |
| `name` | 否 | 场景名，导出文件名也用它。 |
| `unit` | 否 | 长度单位，默认 `meter`。 |
| `room` | 否 | 房间尺寸 `w/h/d`，只用于给编辑器铺网格和建默认墙体。 |
| `markers` | 否 | 命名锚点（出生点、巡逻点、出口等），工具原样保留、不做编辑。 |
| `objects` | 是 | 物体数组，见下。 |

---

## 物体通用字段

```json
{
  "id": "desk-1-2",
  "type": "prefab",
  "prefab": "desk",
  "label": "课桌 1-2",
  "pos": [0, 0, 0.5],
  "rot": [0, 0, 0],
  "scale": [1, 1, 1],
  "flags": { "collide": true, "occlude": true, "noise": true },
  "locked": false
}
```

| 字段 | 说明 |
| --- | --- |
| `id` | 场景内唯一。编辑器靠它定位物体、做撤销重做。 |
| `type` | `box` / `sphere` / `tube` / `polyline` / `group` / `empty` / `prefab`。 |
| `label` | 左栏显示名，省略时显示 `id`。 |
| `pos` | 位置，单位米，世界坐标。 |
| `rot` | 欧拉角，**角度制**（不是弧度），XYZ 顺序。 |
| `scale` | 缩放，默认 `[1,1,1]`。 |
| `flags.collide` | 是否参与玩家碰撞。 |
| `flags.occlude` | 是否遮挡老师视线。 |
| `flags.noise` | 碰撞时是否产生噪声（吸引老师注意）。 |
| `locked` | 为 `true` 时编辑器禁止拖动。 |

---

## 各 type 的专属字段

### box

```json
{ "type": "box", "size": [16, 0.2, 22] }
```

`size` 是盒子的 `width/height/depth`。`pos` 是盒子中心。

### sphere

```json
{ "type": "sphere", "size": [0.16, 0.135, 0.14] }
```

`size` 是三个轴的半径。

### tube

```json
{ "type": "tube", "a": [0, 0.62, 0.78], "b": [0, 0.98, 0.62], "radius": 0.11 }
```

一端点 `a` 到另一端点 `b` 的细管，`radius` 为半径。坐标相对物体自身原点。

### polyline

```json
{ "type": "polyline", "points": [[0,0,0],[1,0,0],[1,1,0]], "closed": true, "radius": 0.02 }
```

折线，用于黑板上的板书这类"线稿"物体。

### group

```json
{ "type": "group", "children": [ /* 任意物体 */ ] }
```

子物体坐标**相对父级**。给需要整体移动的一组东西用。

### empty

```json
{ "type": "empty", "children": [] }
```

空物体：只有原点和变换，没有任何几何。当锚点、分组容器或占位用。

### prefab

```json
{
  "type": "prefab",
  "prefab": "desk",
  "params": {},
  "colliders": [
    { "pos": [0, 0.475, 0], "size": [1.8, 0.95, 0.9] }
  ],
  "parts": [
    { "id": "torso-fix", "type": "sphere", "pos": [0, 1.02, 0.62], "size": [0.2, 0.11, 0.34] }
  ]
}
```

现成零件，外观由 `scene-build.js` 的 `PREFABS` 决定，本条目只负责摆位置。
`params` 是零件自己的参数（比如学生的 `pose: sleep|read`）。
`colliders` 可选：零件往往不止一个碰撞盒。每个 `{pos,size,flags}` 的 `pos` 是
**相对 prefab 原点**的偏移，构建时会按物体旋转转到世界系再转成 AABB。
不给 `colliders` 时，整个 prefab 会用一个包围盒参与碰撞/遮挡。

`parts` 是「把 prefab 拆开手调」的口子，也是不用改生成代码就能补几何的地方：

- 每条 part 就是任意一个普通物体条目（box / sphere / tube / polyline / group / 另一个 prefab）；
- 构建时按顺序挂成 prefab 的子节点，坐标**相对 prefab 原点**；
- 编辑器里它们会出现在层级树里，可以单独选中、拖动、旋转、缩放、改尺寸、删除；
- 导出的 JSON 里它们还是写在 `parts` 里，游戏运行时跟 prefab 一起出现，所见即所得。

典型用法：某个同学上半身和下半身看着脱节，就选那个同学 →
「+ 给这个物体加一个可调零件」→ 拖到位 → 导出 JSON → 填回 `scene-data.js`。

已注册的 prefab：

| prefab | params | 说明 |
| --- | --- | --- |
| `desk` | — | 单人课桌 |
| `chair` | — | 椅子 |
| `book` | — | 桌面摊开的书 |
| `classmate` | `{ pose: "sleep" \| "read" }` | 坐着的同学 |
| `chalkDoor` | `{ halfWidth, height }` | 粉笔画的门框 |
| `groundLines` | `{ length, gap }` | 门前的两道地面标线 |

---

## 怎么把现有场景变成数据

场景树里每个物体都挂了 `userData.__item`（就是生成它的那条 JSON），所以任何时候都能反解：

```js
import { serializeScene, summarize } from './src/scene/serialize.js';

const data = serializeScene(scene, { name: 'campus-escape-l1' });
console.log(summarize(data));   // { total: 73, byType: { box: 8, prefab: 64, ... } }
```

反解规则：

1. 有 `userData.__item` → 原样还原。
2. 认得出几何体（Box/Sphere/Tube）→ 转成 `box` / `sphere` / `tube`。
3. 组结构像学生（无盒子 + 多球 + 多管）→ 转成 `prefab: classmate`，按头顶高度判断姿势。
4. 剩下的组 → 转成 `group`，孩子递归。
5. 纯容器（`scene-root`、`desk-grid`、`room-shell` 这类）→ 穿透展开，不产生条目。

---

## 用编辑器

```
python serve.py
```

打开 `http://127.0.0.1:8911/src/tool/index.html`：

| 操作 | 快捷键 |
| --- | --- |
| 旋转视角 | 左键拖动空白处 |
| 平移视角 | Shift + 左键 / 中键 / 右键 |
| 拉近拉远 | 滚轮 |
| 选中物体 | 左键点物体，或点左栏列表 |
| 展开 / 收起零件 | 点左栏该项前面的小三角 |
| gizmo 移动 / 旋转 / 缩放 | `M` / `R` / `B` |
| 拖 gizmo 改值 | 拖箭头或平面柄（移动）、拖某个环（旋转）、拖某个方块（缩放） |
| 新增物体 | `N` 或顶栏「+ 新增物体」 |
| 视角对准选中物 | `F` |
| 沿 X 推 ± | `A` / `D`（Shift 加大步长到 0.5m） |
| 沿 Y 抬降 | `Q` / `E` |
| 沿 Z 前后 | `W` / `S` |
| 绕 Y 旋转 15° | `Alt+R`（Shift 反向） |
| 整体缩放 | `T`（Shift 缩小） |
| 旋转归零 | `X` |
| 吸附开关 | `G`（0.05m 吸附） |
| 撤销 / 重做 | `Ctrl+Z` / `Ctrl+Shift+Z` 或 `Ctrl+Y` |
| 删除 | `Delete` / `Backspace`（选中零件时只删零件） |
| 导出 JSON | `Ctrl+S` 或顶栏「导出 JSON」 |
| 载入 | `Ctrl+O`、顶栏「打开场景」，或把 json 拖进窗口 |
| 取消选中 | `Esc` |

拖动 gizmo 时相机的旋转和平移会被临时锁住，松手才恢复，不会拖着物体把视角一起甩走。

注意 `S` 既是"向后移动"也是导出（带 `Ctrl` 时），`Shift+S` 是 0.5m 大步后退。

导出的 JSON 就是上面这套格式，直接改 `src/scene/scene-data.js` 里的实例数据即可。
