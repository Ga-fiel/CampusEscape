// 三层教学楼：外走廊，教室在北侧，厕所在最左，楼梯在最右。
//
//   x: -34 ──────── 26        z: -10 ── 房间 ── 0 ── 走廊 ── 3.4
//
//   房间首尾相接，不留缝；相邻房间共用一道墙。
//   locked 的房间门只做门板，不能进，里面不建东西。
import * as THREE from 'three';
import { INK } from './render.js';
import { createBuilder } from './builder.js';

const FH = 4;
const FLOORS = 3;
const X0 = -34, X1 = 26;
const Z0 = -10, Z1 = 3.4;

const ROOMS = [
  [ // 1F
    { x1: -34, x2: -28, door: -31.5, win: 2 },
    { x1: -28, x2: -10, door: -19, win: 2, locked: true },
    { x1: -10, x2: 8, door: -1, win: 2, locked: true },
  ],
  [ // 2F
    { x1: -34, x2: -28, door: -31.5, win: 2 },
    { x1: -28, x2: -18, door: -23, win: 2, locked: true },   // 小卖部
    { x1: -18, x2: -2, door: -10, win: 2, locked: true },
    { x1: -2, x2: 14, door: 6, win: 2, locked: true },
  ],
  [ // 3F
    { x1: -34, x2: -28, door: -31.5, win: 2 },
    { x1: -28, x2: -18, door: -23, win: 2 },                  // 办公室
    { x1: -18, x2: -2, door: -10, win: 4 },                   // 主教室
    { x1: -2, x2: 14, door: 6, win: 2, locked: true },
  ],
];

export function buildSchool(scene, world) {
  const B = createBuilder(scene, world);
  const { box, slab, wallX, wallZ, stairs, cyl, collider, finish } = B;

  const pickups = [];

  box(0, -1, 0, 220, 1, 220, { ink: INK.BLUE });

  // 窗户：竖着的框 + 中梃，z 由调用方指定
  const makeWindow = (cx, y, z, w, h) => {
    const t = 0.07;
    box(cx, y, z, w, t, 0.09, { noCollide: true, ink: INK.BLACK });
    box(cx, y + h - t, z, w, t, 0.09, { noCollide: true, ink: INK.BLACK });
    box(cx - w / 2 + t / 2, y, z, t, h, 0.09, { noCollide: true, ink: INK.BLACK });
    box(cx + w / 2 - t / 2, y, z, t, h, 0.09, { noCollide: true, ink: INK.BLACK });
    box(cx, y, z, 0.04, h, 0.07, { noCollide: true, ink: INK.BLACK });
  };

  // ---------------- 三层主体 ----------------
  for (let f = 0; f < FLOORS; f++) {
    const y = f * FH;

    // ---- 楼板（2F/3F 在楼梯处开洞） ----
    if (f === 0) {
      slab(X0, Z0, X1, Z1, y, 0.3);
    } else if (f === 1) {
      slab(X0, Z0, X1, 0, y, 0.3);
      slab(X0, 0, 16, Z1, y, 0.3);
      slab(16, 1.8, 23.2, Z1, y, 0.3);     // 洞：x16-23.2, z0-1.8
      slab(23.2, 0, X1, Z1, y, 0.3);
    } else {
      slab(X0, Z0, X1, 0, y, 0.3);
      slab(X0, 0, 16, Z1, y, 0.3);
      slab(16, 0, 23.2, 1.6, y, 0.3);      // 洞：x16-23.2, z1.6-3.4
      slab(23.2, 0, X1, Z1, y, 0.3);
      box(0, y + FH, 0, X1 - X0, 0.3, Z1 - Z0, { ink: INK.BLACK });   // 屋顶
    }

    // ---- 外墙 ----
    wallX(X0, X1, Z0, y, FH, 0.4);
    wallZ(Z0, Z1, X0, y, FH, 0.4);
    wallZ(Z0, Z1, X1, y, FH, 0.4);

    // ---- 房间 ----
    const walls = new Set();
    for (const r of ROOMS[f]) {
      walls.add(r.x1);
      walls.add(r.x2);
      const span = r.x2 - r.x1;

      if (r.locked) {
        // 封死的教室：整面墙 + 一块门板装饰
        wallX(r.x1, r.x2, 0, y, FH, 0.4);
        box(r.door, y, 0.22, 1.24, 2.2, 0.06, { noCollide: true, ink: INK.BLACK });
        box(r.door, y + 1.9, 0.2, 0.1, 0.1, 0.1, { noCollide: true, ink: INK.BLACK });  // 门把手
      } else {
        wallX(r.x1, r.x2, 0, y, FH, 0.4, [[r.door - 0.62, r.door + 0.62, 0, 2.2]]);
      }

      // 北墙窗
      for (let i = 0; i < r.win; i++) {
        const cx = r.x1 + span * (i + 0.5) / r.win;
        makeWindow(cx, y + 1.15, Z0 + 0.23, Math.min(1.7, span / r.win * 0.62), 1.5);
      }
      // 走廊侧窗：门两边各一扇
      makeWindow(r.x1 + 2.1, y + 1.2, 0.21, 1.5, 1.4);
      makeWindow(r.x2 - 2.1, y + 1.2, 0.21, 1.5, 1.4);
    }
    for (const wx of walls) wallZ(Z0, 0, wx, y, FH, 0.35);

    // ---- 护栏（1F 不要） ----
    if (f > 0) {
      for (let x = X0; x <= X1; x += 2.4) {
        box(x, y, Z1, 0.1, 1.15, 0.1, { ink: INK.BLACK, noCollide: true });
      }
      box((X0 + X1) / 2, y + 1.02, Z1, X1 - X0, 0.07, 0.08, { ink: INK.BLACK, noCollide: true });
      box((X0 + X1) / 2, y, Z1, X1 - X0, 0.18, 0.12, { ink: INK.BLACK, noCollide: true });
      collider((X0 + X1) / 2, y, Z1, X1 - X0, 1.15, 0.15, { noShoot: true });
    }
  }

  // ---------------- 楼梯：两段，楼板已开洞 ----------------
  stairs(16, 0, 0.9, '+x', 24, 1.6, { run: 0.3, rise: FH / 24 });     // 1F→2F
  stairs(23.2, 4, 2.5, '-x', 24, 1.6, { run: 0.3, rise: FH / 24 });   // 2F→3F

  // 洞边护栏，防止从走廊掉下去
  box(19.6, 4, 1.8, 7.2, 1.1, 0.1, { ink: INK.BLACK, noCollide: true });   // 2F 洞南侧
  box(19.6, 8, 1.6, 7.2, 1.1, 0.1, { ink: INK.BLACK, noCollide: true });   // 3F 洞北侧

  // ---------------- 3F 主教室 ----------------
  box(-2.2, 9.3, -5, 0.06, 1.3, 6, { dynamic: true, noCollide: true, ink: INK.BLACK, fill: true });
  box(-2.18, 10.7, -5, 0.04, 0.42, 9, { dynamic: true, noCollide: true, ink: INK.RED, fill: true });
  box(-3.0, 8, -5, 1.0, 0.16, 3.6, { ink: INK.BLUE });
  box(-2.7, 8.16, -5, 0.5, 0.72, 1.6, { ink: INK.BLUE });

  const rowsX = [-16.0, -14.2, -12.4, -10.6, -8.8, -7.0];
  const colsZ = [-8.4, -7.2, -4.8, -3.6, -1.2];
  const deskInks = [INK.BLUE, INK.BLACK, INK.BLUE, INK.BLACK];
  const desks = [];
  let si = 0;
  for (const x of rowsX) {
    for (const z of colsZ) {
      box(x, 8, z, 0.5, 0.74, 0.95, { ink: INK.BLUE });
      desks.push({ x, z });
      box(x - 0.42, 8, z, 0.4, 0.44, 0.4, { noCollide: true, ink: INK.BLACK });
      const ink = deskInks[si % 4];
      box(x - 0.42, 8.44, z, 0.28, 0.46, 0.36, { noCollide: true, ink });
      box(x - 0.42, 8.9, z, 0.26, 0.26, 0.26, { noCollide: true, ink });
      si++;
    }
  }

  // ---------------- 房间内部（只做能进的） ----------------
  for (let f = 0; f < FLOORS; f++) {
    const y = f * FH;
    for (let i = 0; i < 3; i++) {
      const z = -8 + i * 2.6;
      wallX(-34, -28.4, z, y, 2.1, 0.12, [[-33.6, -32.6, 0, 2.0]]);
    }
    box(-28.6, y, -1.2, 0.5, 0.85, 3.0, { ink: INK.BLUE });
  }
  box(-24, 8, -6, 5, 0.74, 1.0, { ink: INK.BLUE });      // 办公室桌
  box(-21, 8, -3, 2, 1.6, 0.4, { ink: INK.BLUE });       // 文件柜

  // ---------------- 操场 / 绿化带 / 校门 ----------------
  box(-20, 0, 16.7, 40, 0.12, 25, { ink: INK.GREEN });
  for (let i = 0; i < 3; i++) cyl(-14 + i * 5, 0.12, 9 + i * 2, 0.35, 1.2, { ink: INK.BLACK, noCollide: true });
  wallX(-20, 20, 30, 0, 3.2, 0.4, [[-2.2, 2.2, 0, 2.6]]);
  const gate = box(0, 0, 30, 4.4, 2.6, 0.26, { dynamic: true, ink: INK.RED, fill: true });

  const saves = [
    new THREE.Vector3(-31, 0.05, -1.5),
    new THREE.Vector3(-31, 4.05, -1.5),
    new THREE.Vector3(-31, 8.05, -1.5),
  ];

  const mkItem = (name, x, y, z, ink) => {
    const r = box(x, y, z, 0.44, 0.05, 0.3, { dynamic: true, noCollide: true, ink });
    pickups.push({ name, pos: new THREE.Vector3(x, y, z), mesh: r.mesh, taken: false });
  };
  const paperSpots = desks.filter((d) => d.x <= -12 && d.z <= -4.8);
  const pick = paperSpots[Math.floor(Math.random() * paperSpots.length)];
  mkItem('数学试卷', pick.x, 8.76, pick.z, INK.BLUE);
  mkItem('请假条', -24, 8.76, -6, INK.BLACK);

  const level = finish();

  return {
    playerStart: new THREE.Vector3(-12.82, 8.05, -1.2),
    seat: new THREE.Vector3(-12.82, 8.05, -1.2),
    desks,
    saves,
    stairs: [],
    gate,
    wire: null,
    pickups,
    bounds: level.bounds,
    npcs: [
      {
        name: '讲课老师',
        ink: INK.RED,
        speed: 0,
        chaseSpeed: 5.9,
        viewRange: 99,
        hearRange: 0,
        fov: Math.PI,
        boardMode: true,
        patrol: [new THREE.Vector3(-2.8, 8.16, -5)],
      },
      {
        name: '教导主任',
        ink: INK.RED,
        speed: 2.1,
        chaseSpeed: 5.95,
        viewRange: 12,
        hearRange: 11,
        fov: Math.PI / 3,
        patrol: [
          new THREE.Vector3(-30, 8, 2.2),
          new THREE.Vector3(22, 8, 2.2),
        ],
        waitAt: 1.2,
      },
    ],
  };
}
