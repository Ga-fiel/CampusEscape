import * as THREE from 'three';

// ============================================================
// 场景序列化 —— 把任意一个 three 场景树「反解」成场景 JSON。
//
// 用途：你已经有一份用代码硬写出来的场景（比如旧的 buildClassroom），
// 想把它搬到编辑器里手调，就走这条路：
//
//     import { serializeScene } from './scene/serialize.js';
//     const data = serializeScene(myScene, { name: '我的场景' });
//
// 规则：
//   - 带 userData.__item 的节点，直接用那条原始数据（编辑器回存用）
//   - 同 prefab 的子节点会被识别成 prefab（课桌 / 椅子 / 学生 / 门）
//   - 认出几何体类型的（Box / Sphere / Tube）转成 box / sphere / tube
//   - 剩下的兜底成 group，逐个孩子转，位置保持世界坐标
// ============================================================

const deg = THREE.MathUtils.radToDeg;

function rotOf(obj) {
  const e = obj.rotation;
  return [
    +deg(e.x).toFixed(3),
    +deg(e.y).toFixed(3),
    +deg(e.z).toFixed(3),
  ];
}

const round = (v) => +Number(v).toFixed(4);
const vec = (v) => [round(v.x), round(v.y), round(v.z)];
const arr = (a) => a.map(round);

// 按几何体类型猜条目类型。
function classify(mesh) {
  const g = mesh.geometry;
  if (!g) return null;
  const size = new THREE.Vector3();
  const box = new THREE.Box3().setFromObject(mesh);
  box.getSize(size);
  if (g.type === 'BoxGeometry') {
    return {
      type: 'box',
      size: arr([g.parameters.width, g.parameters.height, g.parameters.depth]),
      // 桌面被缩放过的，把缩放吃掉，尺寸并进 size，编辑器里更好理解。
      scale: [1, 1, 1],
    };
  }
  if (g.type === 'SphereGeometry') {
    const p = g.parameters;
    return {
      type: 'sphere',
      size: arr([p.radius * mesh.scale.x, p.radius * mesh.scale.y, p.radius * mesh.scale.z]),
      scale: [1, 1, 1],
    };
  }
  if (g.type === 'TubeGeometry') {
    const p = g.parameters;
    const path = p.path;
    if (path && path.v1 && path.v2) {
      return {
        type: 'tube',
        a: vec(path.v1),
        b: vec(path.v2),
        radius: round(p.radius),
        scale: [1, 1, 1],
      };
    }
    return {
      type: 'polyline',
      radius: round(p.radius),
      segments: [],
      scale: [1, 1, 1],
    };
  }
  return null;
}

// 猜 prefab：看子节点结构和已知 prefab 的签名是否对得上。
function classifyPrefab(group) {
  const kids = group.children;
  const meshes = kids.filter((k) => k.isMesh);
  if (!meshes.length) return null;

  // 学生：一堆椭球 + 管，没有盒子。
  const balls = meshes.filter((m) => m.geometry && m.geometry.type === 'SphereGeometry');
  const tubes = meshes.filter((m) => m.geometry && m.geometry.type === 'TubeGeometry');
  const boxes = meshes.filter((m) => m.geometry && m.geometry.type === 'BoxGeometry');
  if (boxes.length === 0 && balls.length >= 4 && tubes.length >= 3) {
    // 头在 y≈1.25 且躯干高的是「看书」，否则是「趴桌」。
    const highest = balls.reduce((a, b) => (b.position.y > a.position.y ? b : a), balls[0]);
    const sleeping = highest.position.y < 1.2;
    return { type: 'prefab', prefab: 'classmate', params: { pose: sleeping ? 'sleep' : 'read' } };
  }
  return null;
}

function nodeToItem(node, index) {
  // 原始数据优先。
  if (node.userData && node.userData.__item) {
    return JSON.parse(JSON.stringify(node.userData.__item));
  }

  const base = {
    id: node.userData?.id || node.name || `obj-${index}`,
    pos: vec(node.position),
    rot: rotOf(node),
    scale: vec(node.scale),
  };

  if (node.isMesh) {
    const c = classify(node);
    if (c) return { ...base, ...c };
  }

  if (node.isGroup) {
    const prefab = classifyPrefab(node);
    if (prefab) return { ...base, ...prefab };
    return {
      ...base,
      type: 'group',
      children: node.children.map((child, i) => nodeToItem(child, i)),
    };
  }

  if (node.isMesh) {
    const c = classify(node) || {};
    return { ...base, type: 'box', size: [1, 1, 1], ...c };
  }

  return null;
}

// 场景根 -> 场景数据
//
// three 场景通常是「容器套容器」：scene -> 'scene-root' -> 各个物体。
// 所以序列化要能穿透纯容器（自身没有 __item、名字也不是有意义物体），
// 把里面的可编辑条目平铺出来，否则导出的只会是两个空 group。
const CONTAINER_NAMES = new Set(['scene-root', 'desk-grid', 'room-shell', 'editor-helpers']);

function isPureContainer(node) {
  if (!node.isGroup) return false;
  if (node.userData && node.userData.__item) return false;
  return CONTAINER_NAMES.has(node.name) || node.name === '' || node.type === 'Group';
}

export function serializeScene(scene, options = {}) {
  const objects = [];
  const skip = options.skip || [];
  let i = 0;

  const walk = (node) => {
    if (skip.includes(node)) return;
    // 带原始数据的节点、或已认出的几何体，直接成条目。
    if ((node.userData && node.userData.__item) || !isPureContainer(node)) {
      const item = nodeToItem(node, i++);
      if (item) objects.push(item);
      return;
    }
    // 纯容器：先看自己像不像 prefab（door-frame / desk 这类本身就是 prefab 组）。
    const prefab = classifyPrefab(node);
    if (prefab) {
      const item = nodeToItem(node, i++);
      if (item) objects.push(item);
      return;
    }
    // 否则展开孩子，坐标保持世界系（容器通常无变换）。
    for (const child of node.children) walk(child);
  };

  for (const child of scene.children) walk(child);
  return {
    version: 1,
    name: options.name || 'exported-scene',
    unit: 'meter',
    room: options.room ? { ...options.room } : { w: 16, h: 4.2, d: 22 },
    markers: options.markers ? { ...options.markers } : {},
    objects,
  };
}

// 容器自身没有 __item，但孩子里可能有；这种情况要把容器当 group 保留，
// 否则子条目的相对坐标会失去父级变换。
function hasItemDeep(node) {
  return node.children.some(c => c.userData && c.userData.__item);
}

// 统计一下导出结果，方便在控制台确认没漏东西。
export function summarize(data) {
  const byType = {};
  for (const o of data.objects || []) byType[o.type] = (byType[o.type] || 0) + 1;
  return { total: (data.objects || []).length, byType };
}
