// 场景搭建器：用轴对齐盒子拼校园，几何按墨色合并成一个 mesh，同时生成 AABB 碰撞体。
// 相对于原项目的 level.js：抽掉了游戏内容，新增 dynamic 通道（门 / 可拾取物必须独立 mesh）。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeInkMaterial, INK } from './render.js';

export function createBuilder(scene, world) {
  const geos = {};
  const L = {
    dynamic: [],   // 独立 mesh，不参与合并
    meshes: [],
    bounds: { minX: -80, maxX: 80, minZ: -80, maxZ: 80 },
  };
  const addGeo = (g, ink) => (geos[ink] || (geos[ink] = [])).push(g);

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
    addGeo(g, o.ink ?? INK.BLUE);
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

  function rail(x1, z1, x2, z2, y, o = {}) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const ax = Math.abs(x2 - x1) > Math.abs(z2 - z1);
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
    box(cx, y + 0.9, cz, ax ? len : 0.12, 0.12, ax ? 0.12 : len, { noCollide: true, ink: o.ink });
    const n = Math.max(1, Math.round(len / 2));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      box(x1 + (x2 - x1) * t, y, z1 + (z2 - z1) * t, 0.1, 0.9, 0.1, { noCollide: true, ink: o.ink });
    }
    collider(cx, y, cz, ax ? len : 0.12, 1.0, ax ? 0.12 : len, { noShoot: true });
  }

  function cyl(x, y, z, r, h, o = {}) {
    const g = new THREE.CylinderGeometry(r, r, h, o.seg ?? 12);
    g.translate(x, y + h / 2, z);
    addGeo(g, o.ink ?? INK.BLUE);
    if (!o.noCollide) collider(x, y, z, r * 1.7, h, r * 1.7, o);
  }

  function finish() {
    for (const ink in geos) {
      const merged = mergeGeometries(geos[ink], false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, makeInkMaterial({ ink: Number(ink) }));
      mesh.matrixAutoUpdate = false;
      scene.add(mesh);
      L.meshes.push(mesh);
    }
    world.finalize();
    return L;
  }

  return { L, box, slab, wallX, wallZ, stairs, rail, cyl, collider, finish, scene, world };
}
