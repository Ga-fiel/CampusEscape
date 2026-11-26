import * as THREE from 'three';

// ============================================================
// 场景格式规范 —— 这是「工具能编辑什么」的唯一契约。
//
// 一份场景 JSON 的结构（全部可选，缺省的用 DEFAULT_SCENE 补）：
//
// {
//   "version": 1,
//   "name": "场景名",
//   "unit": "meter",
//   "room":    { "w": 16, "h": 4.2, "d": 22 },
//   "markers": { ... 任意关键点，原样保留，工具只显示不改 ... },
//   "objects": [ 物体条目, ... ]
// }
//
// 物体条目的公共字段：
//   id     string  唯一 id，导出时按它归并同一次拖动
//   type   string  'box' | 'sphere' | 'tube' | 'polyline' | 'group' | 'prefab'
//   pos    [x,y,z] 中心点，米
//   rot    [x,y,z] 欧拉角，度
//   scale  [x,y,z] 缩放，默认 [1,1,1]
//   flags  { collide, noise, occlude, tag }  游戏逻辑用的标记
//   locked boolean  锁住后工具里不可选中拖动
//   label  string   显示名
//
// 各 type 的专属字段：
//   box       size: [w,h,d]
//   sphere    size: [sx,sy,sz]（椭球三轴半径）
//   tube      a: [x,y,z], b: [x,y,z], radius
//   polyline  segments: [[a,b], ...], radius
//   group     children: [物体条目...]   —— 子条目坐标相对 group
//   prefab    prefab: 'chalkDoor' | 'groundLines' | 'classmate' | 'book',
//             params: { ... }            —— 由注册表按名字生成
//             parts:  [物体条目...]       —— 可选，手调的零件覆盖（见下）
//
// parts 是「把 prefab 拆开手调」的逃生口：
//   - 构建时先按注册表生成 prefab 本体，再把 parts 里的每条挂成子节点；
//   - 每个 part 记了 override: true 时，构建器会把它认成「替换件」——
//     项目里没用它的地方就无所谓，但编辑器能把它当独立的可拖动节点；
//   - 最简单的用法：把某一段肢体复制成 part，改坐标即可，不用动 prefab 代码。
//
// 任何自带 geometry 的物体在编辑器里渲染成线框，这样与粉笔风格一致，
// 也避免工具页引入第二套材质系统。
// ============================================================

export const DEFAULT_SCENE = {
  version: 1,
  name: 'untitled',
  unit: 'meter',
  room: { w: 16, h: 4.2, d: 22 },
  markers: {},
  objects: [],
};

export const OBJECT_TYPES = ['box', 'sphere', 'tube', 'polyline', 'group', 'prefab', 'empty'];

const num3 = (v, fallback) => (Array.isArray(v) && v.length === 3 ? v.map(Number) : fallback);

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

export function normalizeObject(raw, index = 0) {
  const o = { ...raw };
  o.id = typeof o.id === 'string' && o.id ? o.id : `obj-${index}`;
  o.type = OBJECT_TYPES.includes(o.type) ? o.type : 'box';
  o.pos = num3(o.pos, [0, 0, 0]);
  o.rot = num3(o.rot, [0, 0, 0]);
  o.scale = num3(o.scale, [1, 1, 1]);
  o.flags = o.flags && typeof o.flags === 'object' ? { ...o.flags } : {};
  o.locked = !!o.locked;
  if (o.type === 'box') o.size = num3(o.size, [1, 1, 1]);
  if (o.type === 'sphere') o.size = num3(o.size, [1, 1, 1]);
  if (o.type === 'tube') {
    // tube 需要两个端点 + 半径，缺任何一个都没法建几何。
    o.a = num3(o.a, [0, 0, 0]);
    o.b = num3(o.b, [0, 1, 0]);
    o.radius = num(o.radius, 0.02);
  }
  if (o.type === 'polyline') {
    o.radius = num(o.radius, 0.02);
    o.segments = Array.isArray(o.segments) ? o.segments : [];
  }
  if (o.type === 'group' && !Array.isArray(o.children)) o.children = [];
  if (o.type === 'empty') o.children = [];
  if (o.type === 'prefab') {
    if (!o.prefab) o.prefab = 'box';
    if (Array.isArray(o.parts)) o.parts = o.parts.map((p, i) => normalizeObject(p, i));
  }
  return o;
}

export function normalizeScene(raw) {
  const s = { ...DEFAULT_SCENE, ...(raw || {}) };
  s.room = { ...DEFAULT_SCENE.room, ...(s.room || {}) };
  s.markers = s.markers && typeof s.markers === 'object' ? s.markers : {};
  s.objects = Array.isArray(s.objects) ? s.objects.map(normalizeObject) : [];
  return s;
}

// 旋转/位移到 Object3D 上，编辑器与运行时共用同一套换算。
export function applyTransform(obj, item) {
  obj.position.fromArray(item.pos || [0, 0, 0]);
  obj.rotation.set(
    THREE.MathUtils.degToRad((item.rot || [0, 0, 0])[0]),
    THREE.MathUtils.degToRad((item.rot || [0, 0, 0])[1]),
    THREE.MathUtils.degToRad((item.rot || [0, 0, 0])[2]),
  );
  obj.scale.fromArray(item.scale || [1, 1, 1]);
}
