// 场景搭建器：用轴对齐盒子拼校园，几何按墨色合并成一个 mesh，同时生成 AABB 碰撞体。
// 相对于原项目的 level.js：抽掉了游戏内容，新增 dynamic 通道（门 / 可拾取物必须独立 mesh）。
import * as THREE from '../vendor/three/three.module.js';
import { mergeGeometries } from '../vendor/three/addons/utils/BufferGeometryUtils.js';
import { makeInkMaterial, INK } from './render.js';

export function createBuilder(scene, world) {
  const geos = {};
  const L = {
    dynamic: [],   // 独立 mesh，不参与合并
    meshes: [],
    bounds: { minX: -80, maxX: 80, minZ: -80, maxZ: 80 },
  };
  // 按「墨色 + 是否实色填充」分桶：fill 的面要单独一个 mesh，
  // 否则合并后会统一走排线，大块地面（跑道、草坪、广场）就只剩描边
  const bucketKey = (ink, fill) => `${ink}|${fill ? 1 : 0}`;
  const addGeo = (g, ink, fill) => {
    // 【必须统一 indexed】mergeGeometries 要求同一批几何"全都有 index"或"全都没有"，
    // 混着会直接返回 null，而下面 finish() 里 `if (!merged) continue` 会静默丢掉
    // 整个墨色桶 —— 表现为那一整色的几何全部从画面上消失（踩过一次：篮球场整块
    // 只剩台地底色）。BoxGeometry / CylinderGeometry 自带 index，
    // ExtrudeGeometry（arcLine 画弧线用）没有，这里给它补一个顺序 index。
    if (!g.index) {
      const n = g.attributes.position.count;
      const arr = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
      for (let i = 0; i < n; i++) arr[i] = i;
      g.setIndex(new THREE.BufferAttribute(arr, 1));
    }
    const k = bucketKey(ink, !!fill);
    (geos[k] || (geos[k] = [])).push(g);
  };

  function collider(x, y, z, w, h, d, o = {}) {
    return world.addBox(
      { x: x - w / 2, y, z: z - d / 2 },
      { x: x + w / 2, y: y + h, z: z + d / 2 },
      { noNav: !!o.noNav, noShoot: !!o.noShoot, tag: o.tag }
    );
  }

  function box(x, y, z, w, h, d, o = {}) {
    // dynamic：几何不平移，挂在 mesh 上，方便后面移动 / 隐藏 / 销毁
    if (o.dynamic) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        makeInkMaterial({ ink: o.ink ?? INK.BLUE, fill: !!o.fill })
      );
      mesh.position.set(x, y + h / 2, z);
      scene.add(mesh);
      L.dynamic.push(mesh);
      const col = o.noCollide ? null : collider(x, y, z, w, h, d, o);
      return { mesh, collider: col };
    }

    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y + h / 2, z);
    addGeo(g, o.ink ?? INK.BLUE, o.fill);
    if (!o.noCollide) collider(x, y, z, w, h, d, o);
    return null;
  }

  // 顶面在 y 处的水平板
  const slab = (x1, z1, x2, z2, y, t, o = {}) =>
    box((x1 + x2) / 2, y - t, (z1 + z2) / 2, x2 - x1, t, z2 - z1, o);

  // 沿一条轴切墙，gaps 是矩形洞 [a1, a2, yBottom, yTop]
  function wallPieces(a1, a2, h, gaps) {
    const xs = new Set([a1, a2]);
    for (const g of gaps) {
      xs.add(Math.min(Math.max(g[0], a1), a2));
      xs.add(Math.min(Math.max(g[1], a1), a2));
    }
    const sorted = [...xs].sort((a, b) => a - b);
    const runs = new Map();
    const out = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const s1 = sorted[i], s2 = sorted[i + 1];
      if (s2 - s1 < 0.005) continue;
      const mid = (s1 + s2) / 2;
      const cuts = gaps
        .filter((g) => g[0] <= mid && g[1] >= mid)
        .map((g) => [g[2] ?? 0, g[3] ?? h])
        .sort((a, b) => a[0] - b[0]);
      const pieces = [];
      let y = 0;
      for (const [gb, gt] of cuts) {
        if (gb > y + 0.005) pieces.push([y, gb]);
        y = Math.max(y, gt);
      }
      if (y < h - 0.005) pieces.push([y, h]);
      const keys = new Set();
      for (const [yb, yt] of pieces) {
        const k = yb.toFixed(3) + ',' + yt.toFixed(3);
        keys.add(k);
        const r = runs.get(k);
        if (r && Math.abs(r[1] - s1) < 0.005) r[1] = s2;
        else runs.set(k, [s1, s2, yb, yt]);
      }
      for (const [k, r] of [...runs]) {
        if (!keys.has(k)) { out.push(r); runs.delete(k); }
      }
    }
    for (const r of runs.values()) out.push(r);
    return out;
  }

  function wallX(x1, x2, z, y, h, t, gaps = [], o = {}) {
    for (const [a, b, yb, yt] of wallPieces(x1, x2, h, gaps)) {
      box((a + b) / 2, y + yb, z, b - a, yt - yb, t, o);
    }
  }
  function wallZ(z1, z2, x, y, h, t, gaps = [], o = {}) {
    for (const [a, b, yb, yt] of wallPieces(z1, z2, h, gaps)) {
      box(x, y + yb, (a + b) / 2, t, yt - yb, b - a, o);
    }
  }

  // 窗框 + 中梃。along='x' 表示窗开在 z 恒定的墙上；along='z' 表示开在 x 恒定的墙上
  function winFrame(cx, yb, h, at, w, along) {
    const t = 0.07;
    const o = { noCollide: true, ink: INK.BLACK };
    if (along === 'x') {
      box(cx, yb, at, w, t, 0.1, o);
      box(cx, yb + h - t, at, w, t, 0.1, o);
      box(cx - w / 2 + t / 2, yb, at, t, h, 0.1, o);
      box(cx + w / 2 - t / 2, yb, at, t, h, 0.1, o);
      box(cx, yb, at, 0.05, h, 0.08, o);
      box(cx, yb + h * 0.62, at, w, 0.05, 0.08, o);
    } else {
      box(at, yb, cx, 0.1, t, w, o);
      box(at, yb + h - t, cx, 0.1, t, w, o);
      box(at, yb, cx - w / 2 + t / 2, 0.1, h, t, o);
      box(at, yb, cx + w / 2 - t / 2, 0.1, h, t, o);
      box(at, yb, cx, 0.08, h, 0.05, o);
      box(at, yb + h * 0.62, cx, 0.08, 0.05, w, o);
    }
  }

  function stairs(x, y, z, dir, steps, width, o = {}) {
    const rise = o.rise ?? 0.17, run = o.run ?? 0.42;
    const dx = dir === '+x' ? 1 : dir === '-x' ? -1 : 0;
    const dz = dir === '+z' ? 1 : dir === '-z' ? -1 : 0;
    for (let i = 0; i < steps; i++) {
      const c = (i + 0.5) * run, h = (i + 1) * rise;
      box(x + dx * c, y, z + dz * c, dx ? run + 0.004 : width, h, dz ? run + 0.004 : width, o);
    }
    return { x: x + dx * steps * run, z: z + dz * steps * run, y: y + steps * rise };
  }

  // 护栏：顶部扶手（+ 可选中横杆）+ 竖杆。o.bars = 竖杆间距（默认 2m，铁栏杆用 0.22）
  function rail(x1, z1, x2, z2, y, o = {}) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const ax = Math.abs(x2 - x1) > Math.abs(z2 - z1);
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
    const w = 0.12, bw = o.barW ?? 0.055;
    box(cx, y + 0.9, cz, ax ? len : w, 0.1, ax ? w : len, { noCollide: true, ink: o.ink });
    if (o.mid) box(cx, y + 0.45, cz, ax ? len : w * 0.8, 0.07, ax ? w * 0.8 : len, { noCollide: true, ink: o.ink });
    const n = Math.max(1, Math.round(len / (o.bars ?? 2)));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      box(x1 + (x2 - x1) * t, y, z1 + (z2 - z1) * t, bw, 0.9, bw, { noCollide: true, ink: o.ink });
    }
    collider(cx, y, cz, ax ? len : w, 1.0, ax ? w : len, { noShoot: true });
  }

  // 地面弧线：篮球场三分线 / 罚球圈、跑道弯道等。
  //
  // 【为什么不用一串小盒子拼】墨线渲染按几何边做轮廓，一串盒子每段都带自己的四条
  // 边框，放大看就是一串毛毛虫。
  // 【为什么不用 ExtrudeGeometry】它的侧壁由几十个小平面拼成，每片法线都不同，
  // 后处理的法线边缘检测会在段与段之间再画一条线 —— 放大看是"缝合线"。
  // 【最终做法】用 RingGeometry 切平面环带，但画【两条细环带】：内沿一条、外沿一条，
  // 中间留空。因为场地上的直线是 0.12m 宽的空心盒子，墨线只描它的两条边，
  // 看上去就是两条相距 0.12m 的细线；弧线照这个做，粗细才和直线一致。
  // （直接填一整条 0.12m 的实心环会明显比直线粗，试过。）
  // 角度用弧度，0 指向 +x，逆时针为正（与 atan2(z, x) 一致）。
  // o.dash：虚线（隔一段画一段），罚球圈靠篮下那半边要用。
  function arcLine(cx, cz, r, a0, a1, y, w, o = {}) {
    const span = Math.abs(a1 - a0);
    // 每段约 0.1m 弧长，弧线才不显棱角
    const seg = Math.max(6, Math.ceil((span * r) / 0.1));
    const parts = o.dash ? 14 : 1;
    const dir = a1 > a0 ? 1 : -1;
    const sub = span / parts;
    const t = o.t ?? 0.028;                 // 每条细带的宽度
    // 虚线时每小段只画 72%，留出空隙；实线时必须画满 100%，
    // 否则弧线会短一截、断成一段段（踩过一次：三分线看着像虚线）。
    const frac = o.dash ? 0.72 : 1;
    for (let p = 0; p < parts; p++) {
      if (o.dash && p % 2 === 1) continue;
      const s0 = a0 + dir * sub * p;
      const s1 = s0 + dir * sub * frac;
      const start = Math.min(-s0, -s1), len = Math.abs(s1 - s0);
      const segs = Math.max(3, Math.ceil(seg / parts));
      // 内外两条细带
      for (const rr of [r - w / 2, r + w / 2]) {
        // RingGeometry 在 XY 平面、theta 从 +x 逆时针；绕 X 转 -90° 后 y 轴翻成 -z，
        // 所以 XZ 上的角度 a 对应 Ring 里的 -a。
        const g = new THREE.RingGeometry(
          Math.max(0.004, rr - t / 2), rr + t / 2, segs, 1, start, len
        );
        g.rotateX(-Math.PI / 2);
        g.translate(cx, y, cz);
        addGeo(g, o.ink ?? INK.BLACK, o.fill ?? true);
      }
    }
  }

  function cyl(x, y, z, r, h, o = {}) {
    const g = new THREE.CylinderGeometry(r, r, h, o.seg ?? 12);
    g.translate(x, y + h / 2, z);
    addGeo(g, o.ink ?? INK.BLUE, o.fill);
    if (!o.noCollide) collider(x, y, z, r * 1.7, h, r * 1.7, o);
  }

  // 圆锥：围墙尖刺（seg:4）、树冠（seg:6）
  function cone(x, y, z, r, h, o = {}) {
    const g = new THREE.ConeGeometry(r, h, o.seg ?? 4);
    g.translate(x, y + h / 2, z);
    addGeo(g, o.ink ?? INK.BLACK, o.fill);
    if (!o.noCollide) collider(x, y, z, r * 1.5, h, r * 1.5, o);
  }

  function finish() {
    for (const key in geos) {
      const [inkStr, fillStr] = key.split('|');
      const merged = mergeGeometries(geos[key], false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(
        merged,
        makeInkMaterial({ ink: Number(inkStr), fill: fillStr === '1' })
      );
      mesh.matrixAutoUpdate = false;
      scene.add(mesh);
      L.meshes.push(mesh);
    }
    world.finalize();
    return L;
  }

  return { L, box, slab, wallX, wallZ, winFrame, stairs, rail, arcLine, cyl, cone, collider, finish, scene, world };
}
