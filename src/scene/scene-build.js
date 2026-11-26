import * as THREE from 'three';
import { makeChalkMaterial, INK_PALETTE } from '../chalk.js';

// ============================================================
// 通用场景构建器 —— 吃一份场景 JSON，吐一棵 three 场景树。
//
// 游戏（level.js）和编辑器（tool/）共用同一套构建逻辑，
// 所以编辑器里看到的就是游戏里看到的。
//
// 每个生成的顶层节点都会带 userData.__item，指回它来自哪条数据，
// 编辑器靠这个做拾取、拖动后回写。
// ============================================================

export function createMaterial() {
  return makeChalkMaterial();
}

// 物体的墨水色「定义在物体自身」：优先用 item.ink（调色板索引 0..5 或颜色数组）。
//   0蓝 1墨绿 2紫 3赭 4青 5近黑（见 chalk.js INK_PALETTE）。
// 未显式指定 ink 时，才走 classify 的语义兜底（兼容老数据）。
// 返回归一化到 [0,1] 的色相索引 t（材质池按它复用）。
function inkSlotOf(item) {
  // 1) 物体自带 ink（数字索引）
  if (typeof item.ink === 'number') {
    return clamp01(item.ink / (INK_PALETTE.length - 1));
  }
  // 2) 兜底：按语义类别
  const cls = classify(item);
  const table = {
    desk: 0, chair: 1, book: 3, student: 4, door: 2,
    podium: 0, wall: 0, teacher: 2, fixture: 1, misc: 0,
    blackboard: 5,   // 黑板 —— 近黑
  };
  const idx = table[cls] ?? 0;
  return clamp01(idx / (INK_PALETTE.length - 1));
}
function clamp01(v) { return Math.max(0, Math.min(1, v)); }

// 从一条物体数据推断它的语义类别。
function classify(item) {
  const p = String(item.prefab || '');
  const tag = String((item.flags && item.flags.tag) || '');
  const id = String(item.id || '');
  if (p === 'desk' || tag === 'desk') return 'desk';
  if (p === 'chair' || tag === 'chair') return 'chair';
  if (p === 'book') return 'book';
  if (p === 'classmate') return 'student';
  if (p === 'chalkDoor') return 'door';
  if (tag === 'blackboard' || id.includes('blackboard')) return 'blackboard';
  if (tag === 'podium' || id.includes('podium')) return 'podium';
  if (tag === 'wall' || id.startsWith('wall')) return 'wall';
  if (tag === 'teacher' || id.includes('teacher')) return 'teacher';
  if (item.type === 'box' && (tag === 'shelf' || tag === 'stall' || tag === 'wc')) return 'fixture';
  return 'misc';
}

// ------------------------------------------------------------
// ------------------------------------------------------------
// prefab 注册表：新场景只要写符合格式的数据，这些基础件都能复用。
//
// ⚠️ prefab 返回值约定（务必遵守，否则会静默出 bug）：
//   1. 每个 prefab 返回一个 THREE.Object3D，坐标以原点为中心。
//   2. buildObject 会用 item.pos / item.rot / item.scale **无条件覆盖**
//      返回对象自身的 position / rotation / scale（见文件末尾 buildObject）。
//   3. 因此 prefab 内部需要的任何位置偏移（例如「书要抬到桌面高度」），
//      必须加在**子节点**上，不能设在返回对象自身的 transform 上。
//   4. 返回裸 Mesh 时尤其注意：它就是被覆盖的那个对象，写在它 position 上的
//      偏移会被冲掉 → 书掉地就是这个原因。正确做法是 new Group() 包一层，
//      把偏移设在子 mesh 上（参考下方 book prefab 的写法）。
//   5. 开发期若 prefab 返回对象自身带了非单位 transform，buildObject 会
//      console.warn 报警（正式运行不报）。见 __ASSERT_PREFAB_CONTRACT__。
// ------------------------------------------------------------
export const PREFABS = {
  // 画在墙上的粉笔门：两根立柱 + 上下横线 + 门把手。
  chalkDoor({ mat, params = {} }) {
    const half = Number(params.halfWidth ?? 1.25);
    const h = Number(params.height ?? 2.7);
    const g = new THREE.Group();
    const bar = (w, hh, dd, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, dd), mat);
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };
    bar(0.07, h, 0.05, -half, h / 2, 0);
    bar(0.07, h, 0.05, half, h / 2, 0);
    bar(half * 2, 0.07, 0.05, 0, h, 0);
    bar(half * 2, 0.07, 0.05, 0, 0.06, 0);
    bar(0.055, 0.055, 0.055, half - 0.26, h / 2 - 0.05, -0.05);
    return g;
  },

  // 地面双线地标。
  groundLines({ mat, params = {} }) {
    const w = Number(params.width ?? 2.5);
    const gap = Number(params.gap ?? 0.17);
    const g = new THREE.Group();
    for (const dz of [-gap / 2, gap / 2]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.025, 0.06), mat);
      m.position.set(0, 0, dz);
      g.add(m);
    }
    return g;
  },

  // 课桌：桌面 + 四条腿。
  desk({ mat, params = {} }) {
    const w = Number(params.width ?? 1.8);
    const d = Number(params.depth ?? 0.9);
    const topY = Number(params.topY ?? 0.95);
    const t = Number(params.topThickness ?? 0.12);
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(w, t, d), mat);
    top.position.y = topY;
    g.add(top);
    for (const sx of [-w / 2 + 0.15, w / 2 - 0.15]) {
      for (const sz of [-d / 2 + 0.13, d / 2 - 0.13]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, topY, 0.1), mat);
        leg.position.set(sx, topY / 2, sz);
        g.add(leg);
      }
    }
    return g;
  },

  // 椅子：坐板 + 靠背 + 四条腿。
  chair({ mat, params = {} }) {
    const g = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.1, 0.68), mat);
    seat.position.y = 0.48;
    g.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.78, 0.1), mat);
    back.position.set(0, 0.91, 0.31);
    g.add(back);
    for (const sx of [-0.28, 0.28]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.48, 0.08), mat);
      leg.position.set(sx, 0.24, 0);
      g.add(leg);
    }
    return g;
  },

  // 桌上的书。
  // 注意：buildObject 会用 item.pos 覆盖顶层节点的 position，所以书离桌面的
  // 抬升必须放在子节点上（用 Group 包一层），否则 y=1.035 会被 pos.y=0 冲掉、落地。
  book({ mat, params = {} }) {
    const seed = Number(params.seed ?? 0);
    const width = 0.32 + (seed % 3) * 0.06;
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(width, 0.045, 0.46), mat);
    m.rotation.y = (seed % 5 - 2) * 0.12;
    m.position.y = 1.035;
    g.add(m);
    return g;
  },

  // 同学：坐姿，pose = 'sleep' | 'read'。
  classmate({ mat, params = {} }) {
    return buildClassmateShape(mat, params.pose === 'sleep');
  },
};

// 用粉笔管和椭球拼学生，形状与旧版一致。
export function buildClassmateShape(mat, sleeping) {
  const g = new THREE.Group();
  const limb = (ax, ay, az, bx, by, bz, radius) => {
    const a = new THREE.Vector3(ax, ay, az);
    const b = new THREE.Vector3(bx, by, bz);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mid.y -= 0.012;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 4, radius, 4, false), mat);
    g.add(mesh);
    return mesh;
  };
  const ball = (x, y, z, sx, sy, sz) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 7, 5), mat);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    g.add(mesh);
    return mesh;
  };

  for (const side of [-1, 1]) {
    // 大腿抬高约 30°，让膝盖越过椅面，避免腿管从椅板里穿出来。
    limb(side * 0.12, 0.62, 0.78, side * 0.15, 0.74, 0.48, 0.055);
    limb(side * 0.15, 0.74, 0.48, side * 0.15, 0.10, 0.40, 0.045);
    ball(side * 0.15, 0.055, 0.28, 0.10, 0.035, 0.17);
  }

  if (sleeping) {
    // 躯干横躺在桌面上，髋部到桌沿只留一小段后腰连接，避免斜穿桌板。
    limb(0, 0.62, 0.78, 0, 0.98, 0.62, 0.11);
    ball(0, 1.08, 0.30, 0.20, 0.11, 0.34);
    ball(0, 1.06, 0.06, 0.16, 0.11, 0.12);
    ball(0.11, 1.12, -0.07, 0.16, 0.135, 0.14);
    for (const side of [-1, 1]) {
      limb(side * 0.16, 1.04, 0.14, side * 0.19, 1.02, -0.12, 0.04);
      limb(side * 0.19, 1.02, -0.12, side * 0.10, 1.00, -0.30, 0.035);
      ball(side * 0.10, 1.00, -0.31, 0.05, 0.025, 0.06);
    }
    return g;
  }

  // 看书的同学：上身直立，双臂搭到桌沿。
  ball(0, 0.84, 0.72, 0.19, 0.29, 0.15);
  ball(0, 1.10, 0.67, 0.085, 0.09, 0.075);
  ball(0, 1.25, 0.64, 0.16, 0.17, 0.15);
  for (const side of [-1, 1]) {
    limb(side * 0.17, 1.01, 0.70, side * 0.21, 0.86, 0.50, 0.04);
    limb(side * 0.21, 0.86, 0.50, side * 0.17, 0.98, 0.24, 0.035);
    ball(side * 0.17, 0.98, 0.22, 0.045, 0.025, 0.055);
  }
  return g;
}

// ------------------------------------------------------------
// 单个物体条目 -> Object3D
// ------------------------------------------------------------

// 开发期开关：默认开启（?shot=1 或浏览器 dev 都算开发期）。
// 正式打包如要彻底关断言，设 window.__STRICT_PREFAB__ = false。
function prefabContractStrict() {
  if (typeof window !== 'undefined' && window.__STRICT_PREFAB__ === false) return false;
  return true;
}

// 契约断言：prefab 返回对象自身的 position/rotation/scale 会被 buildObject
// 用 item.pos/rot/scale 覆盖。若它自带非单位变换，说明该偏移应放到子节点上
// （典型：书把 y 写在裸 Mesh 上 → 掉地）。这里只报警、不改数据、不阻断。
const _contractWarned = new Set();
function assertPrefabContract(item, node) {
  if (!prefabContractStrict() || !node) return;
  const p = node.position, r = node.rotation, s = node.scale;
  const posOff = Math.abs(p.x) + Math.abs(p.y) + Math.abs(p.z) > 1e-6;
  const rotOff = Math.abs(r.x) + Math.abs(r.y) + Math.abs(r.z) > 1e-6;
  const sclOff = Math.abs(s.x - 1) + Math.abs(s.y - 1) + Math.abs(s.z - 1) > 1e-6;
  if (!posOff && !rotOff && !sclOff) return;
  const key = `${item.prefab}:${item.id}`;
  if (_contractWarned.has(key)) return;
  _contractWarned.add(key);
  console.warn(
    `[prefab契约] "${item.prefab}" 返回对象自身带了非单位 transform` +
    `（pos=${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}）` +
    ` —— 它会被 item.pos 覆盖，偏移应加在子节点上（用 Group 包一层）。object id=${item.id}`,
  );
}

function buildObject(item, mat, onCollide) {
  let node;
  switch (item.type) {
    case 'box': {
      node = new THREE.Mesh(new THREE.BoxGeometry(...(item.size || [1, 1, 1])), mat);
      break;
    }
    case 'sphere': {
      node = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), mat);
      node.scale.set(...(item.size || [1, 1, 1]));
      break;
    }
    case 'tube': {
      const a = new THREE.Vector3(...(item.a || [0, 0, 0]));
      const b = new THREE.Vector3(...(item.b || [0, 1, 0]));
      node = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(a, b), 1, item.radius ?? 0.02, 5, false), mat);
      break;
    }
    case 'polyline': {
      node = new THREE.Group();
      for (const seg of item.segments || []) {
        const a = new THREE.Vector3(...seg[0]);
        const b = new THREE.Vector3(...seg[1]);
        const curve = new THREE.LineCurve3(a, b);
        node.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 1, item.radius ?? 0.02, 5, false), mat));
      }
      break;
    }
    case 'group': {
      node = new THREE.Group();
      for (const child of item.children || []) {
        node.add(buildObject(child, mat, onCollide));
      }
      break;
    }
    // 空物体：只有原点、没有任何几何。当锚点或分组容器用。
    case 'empty': {
      node = new THREE.Group();
      break;
    }
    case 'prefab': {
      const maker = PREFABS[item.prefab];
      node = maker ? maker({ mat, params: item.params || {} }) : new THREE.Group();
      // 开发期契约断言：prefab 返回对象自身的 transform 会被下方统一覆盖，
      // 若它自带非单位变换，说明偏移写错了地方（书掉地那类 bug），大声报警。
      assertPrefabContract(item, node);
      // prefab 可以由多条碰撞盒组成（课桌=桌面、椅子=坐板），
      // 用 item.colliders 显式声明，坐标相对 prefab 原点。
      if (onCollide && Array.isArray(item.colliders)) {
        const r = item.rot || [0, 0, 0];
        const euler = new THREE.Euler(
          THREE.MathUtils.degToRad(r[0]),
          THREE.MathUtils.degToRad(r[1]),
          THREE.MathUtils.degToRad(r[2]),
        );
        const origin = new THREE.Vector3(...(item.pos || [0, 0, 0]));
        item.colliders.forEach((c, ci) => {
          const local = new THREE.Vector3(...(c.pos || [0, 0, 0])).applyEuler(euler).add(origin);
          const f = c.flags || {};
          onCollide({
            id: `${item.id}#${ci}`,
            minX: local.x - c.size[0] / 2, maxX: local.x + c.size[0] / 2,
            minY: local.y - c.size[1] / 2, maxY: local.y + c.size[1] / 2,
            minZ: local.z - c.size[2] / 2, maxZ: local.z + c.size[2] / 2,
            noise: !!f.noise,
            tag: f.tag || '',
            collide: !!f.collide,
            occlude: !!f.occlude,
          });
        });
      }
      break;
    }
    default: {
      node = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
    }
  }

  // 变换只作用在顶层节点上；子条目自带的变换由递归自己处理。
  node.position.fromArray(item.pos || [0, 0, 0]);
  const r = item.rot || [0, 0, 0];
  node.rotation.set(
    THREE.MathUtils.degToRad(r[0]),
    THREE.MathUtils.degToRad(r[1]),
    THREE.MathUtils.degToRad(r[2]),
  );
  if (item.type !== 'sphere') node.scale.fromArray(item.scale || [1, 1, 1]);

  includeParts(item, node, mat);

  node.name = item.id || node.name;
  node.userData.__item = item;

  // 碰撞与遮挡：只有 box 参与，用它的世界 AABB。
  if (item.type === 'box' && onCollide) {
    const f = item.flags || {};
    if (f.collide || f.occlude) {
      node.updateMatrixWorld(true);
      const aabb = new THREE.Box3().setFromObject(node);
      onCollide({
        id: item.id,
        minX: aabb.min.x, maxX: aabb.max.x,
        minY: aabb.min.y, maxY: aabb.max.y,
        minZ: aabb.min.z, maxZ: aabb.max.z,
        noise: !!f.noise,
        tag: f.tag || '',
        collide: !!f.collide,
        occlude: !!f.occlude,
      });
    }
  }
  return node;
}

// parts 是「把 prefab 拆开手调」的逃生口：挂成 prefab 的子节点，
// 坐标相对 prefab 原点。编辑器里可以单独选中、拖动其中一段肢体。
function includeParts(item, node, mat) {
  if (!Array.isArray(item.parts)) return;
  for (const part of item.parts) {
    const child = buildObject(part, mat, null);
    node.add(child);
  }
}

// ------------------------------------------------------------
// 整份场景 -> 场景树
//   scene       THREE.Scene（或任意 Object3D 容器）
//   data        normalizeScene 之后的场景数据
//   onCollide   每个碰撞/遮挡盒回调一次
//   返回 { root, nodes } —— nodes 是 id -> Object3D 的映射
// ------------------------------------------------------------
export function buildScene(scene, data, onCollide) {
  const mat = createMaterial();      // 兜底/共享材质（inkIndex=0）
  const root = new THREE.Group();
  root.name = 'scene-root';
  scene.add(root);

  const nodes = new Map();
  for (const item of data.objects || []) {
    // 同类物体用同一种墨水色，实现「按类别多色描边」。
    const itemMat = makeChalkMaterial(inkSlotOf(item));
    const node = buildObject(item, itemMat, onCollide);
    root.add(node);
    nodes.set(item.id, node);
  }
  // 让序列化器能把 scene-root 整个展开成物体列表。
  root.userData.__container = true;
  return { root, nodes, mat };
}

// 房间外壳：地面、天花板、四面墙。单独拆出来是因为它总是满尺寸铺开，
// 不适合当成可拖动的普通物体。
export function buildShell(scene, room, onCollide) {
  const mat = scene.userData.__shellMat || createMaterial();
  scene.userData.__shellMat = mat;
  const { w, h, d } = room;
  const g = new THREE.Group();
  g.name = 'room-shell';
  const slab = (sw, sh, sd, x, y, z, flags) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sw, sh, sd), mat);
    m.position.set(x, y, z);
    g.add(m);
    if (flags && onCollide) {
      onCollide({
        id: flags.id,
        minX: x - sw / 2, maxX: x + sw / 2,
        minY: y - sh / 2, maxY: y + sh / 2,
        minZ: z - sd / 2, maxZ: z + sd / 2,
        noise: false, tag: 'wall',
        collide: true, occlude: true,
      });
    }
  };
  slab(w, 0.2, d, 0, -0.1, 0);
  slab(w, 0.2, d, 0, h + 0.1, 0);
  slab(w, h, 0.2, 0, h / 2, -d / 2, { id: 'wall-n' });
  slab(w, h, 0.2, 0, h / 2, d / 2, { id: 'wall-s' });
  slab(0.2, h, d, -w / 2, h / 2, 0, { id: 'wall-w' });
  slab(0.2, h, d, w / 2, h / 2, 0, { id: 'wall-e' });
  scene.add(g);
  return g;
}
