// 三层教学楼 —— 按用户手绘《第三层》平面图 + 3 张实拍参考图重建。
// 本轮只建模，不放敌对生物（npcs 为空数组）。
//
// 俯视（-z = 教室一侧，+z = 外廊护栏一侧）：
//
//                            ┌──────── 另一栋楼：老师办公室 ────────┐
//                            │              ↑ 连廊（两面护栏）      │
//   ─────────────────────────┴──────────────┼──────────────────────┴──  z=+13
//        外廊护栏（可以看到校内楼下）
//   ┌──────────┬───────────────────────────┴────────────────┬────────┐
//   │ 楼梯间 W │  走廊                                    │ 楼梯间 E│ z 0..3.4
//   ├──────────┼─────────┬─────────┬─────────┬───────────────┴────────┤ z=0
//   │          │ 教室(伪) │ 教室(真) │ 教室(伪) │      厕所               │
//   │  梯井    │         │ ← 黑板  │         │ （更深，最里面高处开窗）  │
//   └──────────┴─────────┴─────────┴─────────┴───────────────────────┘  z=-10 / -14
//
// 楼梯：双跑（半跑 12 级 → 休息平台 → 折返 12 级），东西两端各一部，贯通三层。
import * as THREE from '../vendor/three/three.module.js';
import { INK, makeInkMaterial } from './render.js';
import { createBuilder } from './builder.js';

const FH = 4;                  // 层高
const FLOORS = 3;

const X0 = -34, X1 = 32;       // 主楼东西端
const Z0 = -10, Z1 = 3.4;      // 教室北墙 / 外廊护栏
const TZ0 = -14;               // 厕所比教室再深 4m
const TOI = { x1: 14, x2: 26 };

const SW = { x1: X0, x2: -28 };   // 西楼梯间
const SE = { x1: 26, x2: X1 };    // 东楼梯间
const HZ = 0.8;                   // 梯井北边界 = 走廊楼板起点
const STZ0 = -5.2;                // 楼梯间北墙（比教室浅，双跑只需要这么深）
const LAND = { z1: -4.6, z2: -2.8 };  // 双跑楼梯的休息平台
const FLIGHT = 12;                // 半跑级数
const RUN = 0.3, RISE = FH / 2 / FLIGHT;

// 3F 连廊（两面护栏）+ 另一栋楼的老师办公室：紧挨东端楼梯间西侧，从外廊护栏向北伸出
const LINK = { x1: 21.5, x2: 26, z2: 13 };
// 办公室按用户图五放大：24 × 10（原来 14 × 9），给后面的博弈留空间
// z1 = 13 是南墙（连廊接进来那面），z2 = 23 是北墙
const OFF = { x1: 12, x2: 32, z1: 13, z2: 23 };

// 每层房间：x 范围 / 门（前门靠讲台黑板侧，后门靠后排）/ 北墙窗数 / 是否封死 / 是否厕所
// 教室两个门：后门在 x1 端，前门在 x2 端（x2 侧是黑板 + 讲台那一头）
const ROOMS = [
  [
    { x1: -28, x2: -14, doors: [-27.1, -15.0], win: 4, locked: true },
    { x1: -14, x2: 0, doors: [-13.1, -1.0], win: 4, locked: true },
    { x1: 0, x2: 14, doors: [0.9, 13.0], win: 4, locked: true },
    { x1: TOI.x1, x2: TOI.x2, door: 20, win: 1, toilet: true },
  ],
  [
    { x1: -28, x2: -14, doors: [-27.1, -15.0], win: 4, locked: true },
    { x1: -14, x2: 0, doors: [-13.1, -1.0], win: 4, locked: true },
    { x1: 0, x2: 14, doors: [0.9, 13.0], win: 4, locked: true },
    { x1: TOI.x1, x2: TOI.x2, door: 20, win: 1, toilet: true },
  ],
  [
    { x1: -28, x2: -14, doors: [-27.1, -15.0], win: 4, locked: true },   // 教室（伪）
    { x1: -14, x2: 0, doors: [-13.1, -1.0], win: 4 },                    // 教室（真）= 主教室
    { x1: 0, x2: 14, doors: [0.9, 13.0], win: 4, locked: true },         // 教室（伪）
    { x1: TOI.x1, x2: TOI.x2, door: 20, win: 1, toilet: true },
  ],
];

const CLASSROOM = { x1: -14, x2: 0, z1: Z0, z2: 0, floor: 2 };  // 主教室平面矩形 + 所在层
const SEAT = new THREE.Vector3(-12.86, 2 * FH + 0.05, -1.2);

export function buildSchool(scene, world) {
  const B = createBuilder(scene, world);
  const { box, slab, wallX, wallZ, winFrame, stairs, rail, cyl, cone, finish } = B;

  const pickups = [];
  const desks = [];

  // 室内地面：只在白纸上画地砖格线（不铺实色，否则整个房间压成一块死蓝）
  // 线要很细：房间进深十几米，透视后 5cm 宽的线会变成几条很粗的大斜线，
  // 把整个地面读成"斜条纹纸"；1.2cm 刚好是纸上一根笔道。
  function tiledFloor(x1, z1, x2, z2, y, o = {}) {
    const step = o.step ?? 2.0;
    const ink = o.ink ?? INK.BLACK;
    const LW = 0.012;
    slab(x1, z1, x2, z2, y, 0.06, { ink, noCollide: true });
    for (let x = x1 + step; x < x2 - 0.05; x += step) {
      box(x, y + 0.01, (z1 + z2) / 2, LW, 0.008, z2 - z1, { noCollide: true, ink });
    }
    for (let z = z1 + step; z < z2 - 0.05; z += step) {
      box((x1 + x2) / 2, y + 0.01, z, x2 - x1, 0.008, LW, { noCollide: true, ink });
    }
  }

  // ---------------- 地面 / 操场 ----------------
  box(0, -1.02, 0, 320, 1, 320, { ink: INK.GREEN });         // 大地（顶面 -0.02）

  // ---------------- 楼板 ----------------
  for (let f = 0; f < FLOORS; f++) {
    const y = f * FH;
    if (f === 0) {
      slab(X0, Z0, X1, Z1, y, 0.3);                          // 1F 整层
    } else {
      slab(-28, Z0, 26, HZ, y, 0.3);                         // 教室 + 走廊内带（避开两端梯井）
      slab(X0, HZ, X1, Z1, y, 0.3);                          // 外廊带（含梯井前沿）
    }
    slab(TOI.x1, TZ0, TOI.x2, Z0, y, 0.3);                   // 厕所加深段
  }

  // ---------------- 双跑楼梯（东西各一部，贯通三层） ----------------
  // stairSpots[floor] = 该层楼梯口（站在这里按 E 换层）
  const stairSpots = [];
  for (const [sx1, sx2] of [[SW.x1, SW.x2], [SE.x1, SE.x2]]) {
    const half = (sx2 - sx1) / 2;
    const base = stairSpots.length;
    for (let f = 0; f < FLOORS; f++) {
      stairSpots.push({
        x: sx1 + half / 2, z: HZ + 0.75, y: f * FH,
        floor: f, upTo: null, downTo: null, well: sx1 === SW.x1 ? 'W' : 'E',
      });
    }
    for (let f = 0; f < FLOORS; f++) {
      if (f > 0) stairSpots[base + f].downTo = base + f - 1;
      if (f < FLOORS - 1) stairSpots[base + f].upTo = base + f + 1;
    }
    for (let L = 0; L < FLOORS - 1; L++) {
      const y0 = L * FH;
      stairs(sx1 + half / 2, y0, HZ, '-z', FLIGHT, half - 0.12, { run: RUN, rise: RISE });
      slab(sx1, LAND.z1, sx2, LAND.z2, y0 + FH / 2, 0.26);
      stairs(sx2 - half / 2, y0 + FH / 2, LAND.z2, '+z', FLIGHT, half - 0.12, { run: RUN, rise: RISE });
      rail(sx1, LAND.z1, sx2, LAND.z1, y0 + FH / 2, { ink: INK.BLACK });
    }
  }

  // ---------------- 外墙 + 房间 ----------------
  for (let f = 0; f < FLOORS; f++) {
    const y = f * FH;
    const rooms = ROOMS[f];

    // 教室北墙（-z）开窗：每间 4 扇
    const northGaps = [];
    for (const r of rooms) {
      if (r.toilet) continue;
      const span = r.x2 - r.x1;
      for (let i = 0; i < r.win; i++) {
        const cx = r.x1 + span * (i + 0.5) / r.win;
        const w = Math.min(1.8, span / r.win * 0.66);
        northGaps.push([cx - w / 2, cx + w / 2, 1.15, 2.7]);
      }
    }
    wallX(-28, TOI.x1, Z0, y, FH, 0.4, northGaps);
    for (const g of northGaps) {
      winFrame((g[0] + g[1]) / 2, y + g[2], g[3] - g[2], Z0 + 0.24, g[1] - g[0], 'x');
    }

    // 楼梯间北墙比教室浅（双跑只到 -4.6），两端各留一个凹口，窗直接对外
    const stairGaps = [[-32.5, -29.5, 1.2, 2.9], [28.5, 31.5, 1.2, 2.9]];
    wallX(X0, -28, STZ0, y, FH, 0.4, stairGaps);
    wallX(26, X1, STZ0, y, FH, 0.4, stairGaps);
    winFrame(-31, y + 1.2, 1.7, STZ0 + 0.24, 3.0, 'x');
    winFrame(30, y + 1.2, 1.7, STZ0 + 0.24, 3.0, 'x');

    // 厕所北墙（更深）+ 最里面高处开窗
    wallX(TOI.x1, TOI.x2, TZ0, y, FH, 0.4, [[18.4, 21.6, 2.5, 3.4]]);
    wallZ(TZ0, Z0, TOI.x1, y, FH, 0.4);
    wallZ(TZ0, Z0, TOI.x2, y, FH, 0.4);
    winFrame(20, y + 2.5, 0.9, TZ0 + 0.24, 3.2, 'x');

    // 东西山墙
    wallZ(Z0, Z1, X0, y, FH, 0.4);
    wallZ(Z0, Z1, X1, y, FH, 0.4);

    // 楼梯间外廊侧封墙 + 大窗
    wallX(X0, -28, Z1, y, FH, 0.4, [[-32.5, -29.5, 1.2, 2.9]]);
    wallX(26, X1, Z1, y, FH, 0.4, [[28.5, 31.5, 1.2, 2.9]]);
    winFrame(-31, y + 1.2, 1.7, Z1 - 0.24, 3.0, 'x');
    winFrame(30, y + 1.2, 1.7, Z1 - 0.24, 3.0, 'x');

    // 楼梯间与走廊之间的隔墙（留 1.4m 门洞）
    wallZ(0, Z1, -28, y, FH, 0.35, [[1.1, 2.5, 0, 2.2]]);
    wallZ(0, Z1, 26, y, FH, 0.35, [[1.1, 2.5, 0, 2.2]]);

    // 房间前墙（走廊侧 z=0）：前后两个门 + 四个观察窗（左右各两个）
    const walls = new Set();
    for (const r of rooms) {
      walls.add(r.x1); walls.add(r.x2);
      // 教室：后门贴 x1 端、前门贴 x2 端（前门那侧是黑板讲台）
      // 厕所只有中间一个门
      const doors = r.doors || [r.door];
      const gaps = [];
      for (const d of doors) gaps.push([d - 0.62, d + 0.62, 0, 2.2]);
      // 图纸：每个教室都开四个窗户，左右各两个 —— 后门那侧两个、前门那侧两个，
      // 中间留 2.4m 实墙（不然四扇窗连成一片玻璃幕墙，看不出"左右各两个"）
      const winSpans = r.toilet ? [] : [
        [r.x1 + 1.9, r.x1 + 3.6], [r.x1 + 4.1, r.x1 + 5.8],
        [r.x2 - 5.8, r.x2 - 4.1], [r.x2 - 3.6, r.x2 - 1.9],
      ];
      for (const w of winSpans) gaps.push([w[0], w[1], 1.15, 2.6]);
      wallX(r.x1, r.x2, 0, y, FH, 0.4, gaps);
      if (r.locked) {
        // 两扇门都做成关着的门板（填满门洞，墙厚 0.4 这里 0.36 居中）
        for (const d of doors) {
          box(d, y, 0.0, 1.24, 2.2, 0.36, { noCollide: true, ink: INK.BLACK });
          box(d + 0.44, y + 1.0, 0.22, 0.12, 0.12, 0.12, { noCollide: true, ink: INK.RED });  // 把手
        }
      }
      if (!r.toilet) {
        for (const w of winSpans) winFrame((w[0] + w[1]) / 2, y + 1.15, 1.45, 0.24, w[1] - w[0], 'x');
      } else {
        box(r.door, y + 2.24, 0.0, 1.5, 0.1, 0.12, { noCollide: true, ink: INK.BLACK });  // 门帘杆
      }
    }
    for (const wx of walls) wallZ(Z0, 0, wx, y, FH, 0.35);

    // 外廊护栏（1F 是地面不做；3F 在连廊口 x21.5~26 断开）
    if (f > 0) {
      const openL = f === FLOORS - 1 ? LINK.x1 : 1e9;
      const openR = f === FLOORS - 1 ? LINK.x2 : 1e9;
      if (openL > -28) rail(-28, Z1, Math.min(openL, 26), Z1, y, { ink: INK.BLACK, bars: 0.24, mid: true });
      if (openR < 25.9) rail(openR, Z1, 26, Z1, y, { ink: INK.BLACK, bars: 0.24, mid: true });
    }

    // 走廊生活道具：垃圾桶 / 灭火器箱 / 饮水机
    if (f > 0) {
      cyl(-20, y, 2.95, 0.26, 0.78, { ink: INK.BLACK, seg: 12 });          // 垃圾桶
      box(-5, y, 2.85, 0.62, 1.05, 0.42, { ink: INK.RED });                // 灭火器箱
      box(8, y, 2.8, 0.7, 1.0, 0.55, { ink: INK.BLUE });                   // 饮水机
      cyl(8, y + 1.0, 2.8, 0.24, 0.5, { ink: INK.BLUE, seg: 10 });         // 水桶
      box(-31, y + 1.55, Z1 - 0.22, 0.9, 0.5, 0.06, { noCollide: true, ink: INK.BLACK });  // 楼层牌
      box(29, y + 1.55, Z1 - 0.22, 0.9, 0.5, 0.06, { noCollide: true, ink: INK.BLACK });
    }
    // 3F 走廊横幅：挂在走廊天花板下沿（不挡"低头看楼下"的视线）
    if (f === FLOORS - 1) {
      box(-8, y + 2.86, Z1 - 0.42, 7.2, 0.62, 0.05, { noCollide: true, ink: INK.RED, fill: true });
      box(-8, y + 2.86, Z1 - 0.4, 7.4, 0.05, 0.05, { noCollide: true, ink: INK.BLACK });
      box(-8, y + 3.43, Z1 - 0.4, 7.4, 0.05, 0.05, { noCollide: true, ink: INK.BLACK });
      // 两条吊绳挂到天花板
      box(-11.3, y + 3.48, Z1 - 0.4, 0.04, 0.5, 0.04, { noCollide: true, ink: INK.BLACK });
      box(-4.7, y + 3.48, Z1 - 0.4, 0.04, 0.5, 0.04, { noCollide: true, ink: INK.BLACK });
    }

    // 屋顶（最上层）
    if (f === FLOORS - 1) {
      box((X0 + X1) / 2, y + FH, (TZ0 + Z1) / 2, X1 - X0, 0.3, Z1 - TZ0, { ink: INK.BLACK });
    }
  }

  // ---------------- 主教室（3F 教室（真）） ----------------
  {
    const y = 2 * FH;
    // 黑板贴东墙内侧：东墙在 x=0（厚 0.35，内表面 -0.175）。黑板厚 0.1，中心放到 -0.25
    // 才留出 0.025 的间隙，否则整块黑板会陷进墙里只剩 z-fighting。
    box(-0.25, y + 1.35, -5, 0.1, 1.4, 6, { noCollide: true, ink: INK.BLACK, fill: true });
    box(-0.22, y + 2.78, -5, 0.06, 0.42, 8.4, { noCollide: true, ink: INK.RED, fill: true });
    // 讲台 + 讲桌
    box(-1.35, y, -5, 1.1, 0.18, 3.8, { ink: INK.BLUE });
    box(-1.0, y + 0.18, -5, 0.55, 0.72, 1.5, { ink: INK.BLUE });
    // 课桌 6 列 × 5 排（东侧是黑板，学生面朝 +x）
    const colsX = [-12.4, -10.4, -8.4, -6.4, -4.4, -2.4];
    const rowsZ = [-8.4, -7.2, -4.8, -3.6, -1.2];
    const chairInk = [INK.BLUE, INK.BLACK, INK.ORANGE, INK.BLACK];
    let k = 0;
    for (const x of colsX) {
      for (const z of rowsZ) {
        box(x, y, z, 0.52, 0.74, 0.96, { ink: INK.BLUE });
        desks.push({ x, z });
        box(x - 0.44, y, z, 0.42, 0.44, 0.42, { noCollide: true, ink: INK.BLACK });
        const ink = chairInk[k % 4];
        box(x - 0.44, y + 0.44, z, 0.3, 0.46, 0.36, { noCollide: true, ink });
        box(x - 0.44, y + 0.9, z, 0.26, 0.26, 0.26, { noCollide: true, ink });
        k++;
      }
    }
    // 西侧后墙：学习园地 + 挂钟
    box(-13.7, y + 1.6, -5, 0.06, 1.6, 5, { noCollide: true, ink: INK.RED, fill: true });
    cyl(-13.7, y + 3.1, -2.2, 0.26, 0.08, { ink: INK.BLACK, noCollide: true, seg: 16 });
  }

  // ---------------- 厕所内部（每层都能进） ----------------
  for (let f = 0; f < FLOORS; f++) {
    const y = f * FH;
    // 最里面（北墙）4 个隔间：隔墙 5 道，门板挂在两墙之间（往北缩 0.06 贴住，不穿模）
    for (let i = 0; i <= 4; i++) {
      wallZ(TZ0, -11.2, 15.0 + i * 2.45, y, 2.1, 0.1);
    }
    for (let i = 0; i < 4; i++) {
      box(16.22 + i * 2.45, y, -11.26, 2.33, 2.05, 0.07, { noCollide: true, ink: INK.BLUE });
    }
    // 小便池靠西墙
    for (let i = 0; i < 4; i++) {
      box(TOI.x1 + 0.28, y + 0.5, -9.6 + i * 1.7, 0.3, 0.55, 0.7, { noCollide: true, ink: INK.BLUE });
    }
    // 洗手台靠门内两侧
    box(16.4, y, -1.3, 3.4, 0.82, 0.6, { ink: INK.BLUE });
    box(23.0, y, -1.3, 3.4, 0.82, 0.6, { ink: INK.BLUE });
    // 拖把池
    box(24.6, y, -8.6, 0.9, 0.6, 0.9, { ink: INK.BLUE });
  }

  // ---------------- 3F 连廊 + 另一栋楼（老师办公室） ----------------
  let officeDoor = null;          // 办公室那扇可开关的门（game.js 里交互）
  {
    const y = 2 * FH;
    const lcx = (LINK.x1 + LINK.x2) / 2;
    // 另一栋楼的楼体：从地面立到 3F 楼面
    box((OFF.x1 + OFF.x2) / 2, -0.02, (OFF.z1 + OFF.z2) / 2, OFF.x2 - OFF.x1, y + 0.02, OFF.z2 - OFF.z1, { ink: INK.BLUE });
    // 连廊地面
    slab(LINK.x1, Z1, LINK.x2, LINK.z2, y, 0.3);
    // 连廊两面护栏（实拍：混凝土柱 + 上下双横杆 + 密集竖向铁栏杆）
    rail(LINK.x1, Z1, LINK.x1, LINK.z2, y, { ink: INK.BLACK, bars: 0.22, mid: true });
    rail(LINK.x2, Z1, LINK.x2, LINK.z2, y, { ink: INK.BLACK, bars: 0.22, mid: true });
    // 顶棚 + 混凝土柱
    box(lcx, y + 3.1, (Z1 + LINK.z2) / 2, LINK.x2 - LINK.x1 + 0.5, 0.26, LINK.z2 - Z1, { ink: INK.BLACK });
    // 坑：柱子原来都放在 lcx（连廊正中），一根从地面立到 3F 的方柱正好穿过
    // 1F 那条架空连廊的走道中央 —— 一楼上楼会被一根柱子堵在路中间。
    // 现在改到连廊两侧（离护栏 0.4m），走道中线彻底让开。
    for (const z of [6.2, 10.4]) {
      for (const px of [LINK.x1 + 0.42, LINK.x2 - 0.42]) {
        box(px, -0.02, z, 0.42, y + 0.02, 0.42, { ink: INK.BLACK });
      }
    }
    // 横幅：同窗共苦战 金榜齐题名
    box(lcx, y + 2.42, LINK.z2 - 0.45, LINK.x2 - LINK.x1 - 0.2, 0.62, 0.06, { noCollide: true, ink: INK.RED, fill: true });

    // 办公室（连廊尽头）—— 按图五重做：
    //   南墙：一扇单开门（可交互开关），不是"和连廊同宽的洞"
    //   北墙：两扇窗（"窗户和原来一样放就行"）
    //   西墙：一块黑板（"左手边加块黑板"）
    //   东墙：一扇窗
    //
    // 坑：上一版把南墙开了 4.5m（=连廊宽）的洞，只拿两根门框 + 两扇贴墙的门扇撑场面，
    // 洞边和门扇之间全是大缝 —— 截图里就是"门旁边全是缝"。
    // 现在改成和教室门同规格的单门洞（1.24m），门框填满墙厚，门扇带合页能开关。
    const DOOR_W = 1.24;                              // 单开门宽（与教室门一致）
    const doorC = (LINK.x1 + LINK.x2) / 2;            // 门居中在连廊轴线上
    const dL = doorC - DOOR_W / 2, dR = doorC + DOOR_W / 2;
    const DOOR_H = 2.16;                              // 门扇净高
    // 南墙：只开一个单门洞
    wallX(OFF.x1, OFF.x2, OFF.z1, y, FH, 0.4, [[dL, dR, 0, 2.24]]);
    // 门框：两侧立柱 + 上槛，厚度顶满墙厚（0.4 → 0.46 出一点边），把洞边彻底盖住
    box(dL - 0.07, y, OFF.z1, 0.14, 2.3, 0.46, { ink: INK.BLACK });
    box(dR + 0.07, y, OFF.z1, 0.14, 2.3, 0.46, { ink: INK.BLACK });
    box(doorC, y + 2.24, OFF.z1, DOOR_W + 0.28, 0.14, 0.46, { ink: INK.BLACK });
    // 门扇：dynamic（可开关），几何原点挪到左侧合页，绕 Y 转就是开门
    officeDoor = box(dL + 0.02, y + 0.04, OFF.z1, DOOR_W - 0.04, DOOR_H, 0.07,
      { dynamic: true, ink: INK.RED });
    if (officeDoor && officeDoor.mesh) {
      // 把几何中心挪到左边：之后 mesh.position.x = dL 就是"合页在左门框"
      officeDoor.mesh.geometry.translate((DOOR_W - 0.04) / 2, 0, 0);
      officeDoor.mesh.position.set(dL + 0.02, y + 0.04 + DOOR_H / 2, OFF.z1);
    }
    // 门把手（挂在门扇上，跟着门一起转）
    if (officeDoor && officeDoor.mesh) {
      const hg = new THREE.BoxGeometry(0.1, 0.1, 0.12);
      hg.translate(DOOR_W - 0.22, 0, 0.09);
      const hm = new THREE.Mesh(hg, makeInkMaterial({ ink: INK.ORANGE }));
      officeDoor.mesh.add(hm);
    }
    // 门牌（门楣上方）
    box(doorC, y + 2.42, OFF.z1 + 0.26, 1.3, 0.34, 0.06, { noCollide: true, ink: INK.BLUE });
    // 北墙两扇窗
    const nwin = [[OFF.x1 + 4.0, OFF.x1 + 7.0], [OFF.x2 - 7.0, OFF.x2 - 4.0]];
    wallX(OFF.x1, OFF.x2, OFF.z2, y, FH, 0.4, nwin.map(([a, b]) => [a, b, 1.15, 2.6]));
    for (const [a, b] of nwin) winFrame((a + b) / 2, y + 1.15, 1.45, OFF.z2 - 0.24, b - a, 'x');
    // 东墙一扇窗
    wallZ(OFF.z1, OFF.z2, OFF.x2, y, FH, 0.4, [[OFF.z1 + 4.2, OFF.z1 + 7.0, 1.15, 2.6]]);
    winFrame(OFF.z1 + 5.6, y + 1.15, 1.45, OFF.x2 - 0.24, 2.8, 'z');
    // 西墙：实墙（黑板挂在上面）
    wallZ(OFF.z1, OFF.z2, OFF.x1, y, FH, 0.4);
    // 西墙黑板（"左手边加块黑板"）—— 一整块深色板 + 银色边框 + 粉笔槽
    const bbz1 = OFF.z1 + 3.0, bbz2 = OFF.z2 - 3.0;
    const bbcz = (bbz1 + bbz2) / 2, bbW = bbz2 - bbz1;
    box(OFF.x1 + 0.25, y + 1.15, bbcz, 0.1, 1.35, bbW, { noCollide: true, ink: INK.BLACK, fill: true });
    box(OFF.x1 + 0.2, y + 1.1, bbcz, 0.06, 1.45, bbW + 0.16, { noCollide: true, ink: INK.BLACK });   // 边框（比板略大一圈，藏在后面）
    box(OFF.x1 + 0.22, y + 2.52, bbcz, 0.14, 0.12, bbW + 0.24, { noCollide: true, ink: INK.BLACK }); // 上檐
    box(OFF.x1 + 0.34, y + 1.02, bbcz, 0.22, 0.08, bbW, { noCollide: true, ink: INK.BLACK });        // 粉笔槽
    // 黑板上留几笔板书（白色细条，只是暗示）
    for (let i = 0; i < 5; i++) {
      box(OFF.x1 + 0.32, y + 1.6 + (i % 3) * 0.28, bbcz - bbW / 2 + 1.0 + i * 0.9, 0.02, 0.05, 0.7,
        { noCollide: true, ink: INK.BLACK });
    }
    // 屋顶
    box((OFF.x1 + OFF.x2) / 2, y + FH, (OFF.z1 + OFF.z2) / 2, OFF.x2 - OFF.x1 + 0.8, 0.3, OFF.z2 - OFF.z1 + 0.8, { ink: INK.BLACK });
    // 地面：水磨石质感（浅色地砖格线）
    // step 给大：这间房 20×10，2m 一格的线在透视下会变成几条粗黑斜线横穿整个地面，
    // 看着像地板上画了粗笔道；5m 一格只留几条，刚好读得出"水磨石分格"。
    tiledFloor(OFF.x1 + 0.2, OFF.z1 + 0.2, OFF.x2 - 0.2, OFF.z2 - 0.2, y + 0.01, { step: 5.0 });

    // ---- 三张正方形办公卡座（图五：每张被十字挡板分成四个工位）----
    // 排布照图五：左上、右上、右下（左下留给连廊进门那块空地）
    const DESK = 3.0;          // 正方形边长
    const PART_H = 0.62;       // 挡板高：隔断顶 = 地面往上 1.41m，比站着的人眼睛低一点
                               // （站着能探头看到对面，蹲下就完全挡住 —— 后面博弈靠这个）
    const PART_T = 0.08;       // 挡板厚
    // 房间进深 10m、卡座 3m、每张卡座外侧还要各塞一把椅子（0.5 深 + 靠背 0.07）。
    // 坑：原来两排取 z1+3.0 / z2-3.0（16 / 20），两排卡座之间只剩 1m，
    // 两把背靠背的椅子（各占 0.32m）直接叠在一起 —— 截图里就是"两张椅子交叉重叠"。
    // 现在两排各往里收到 z1+2.6 / z2-2.6（15.6 / 20.4），中间留 1.8m 走道，椅子不再打架。
    const zRow1 = OFF.z1 + 2.6;
    const zRow2 = OFF.z2 - 2.6;
    const xColL = OFF.x1 + 4.4;
    const xColR = OFF.x2 - 4.4;
    const desksAt = [
      [xColL, zRow1],
      [xColR, zRow1],
      [xColR, zRow2],
    ];
    for (const [dx, dz] of desksAt) {
      // 桌面（一整块正方形台面，灰白色）
      box(dx, y + 0.72, dz, DESK, 0.07, DESK, { ink: INK.BLACK });
      // 台面下的深红木色柜体（四个小柜，留出中间腿部空间）
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          box(dx + sx * DESK * 0.28, y, dz + sz * DESK * 0.28, DESK * 0.4, 0.72, DESK * 0.4,
            { noCollide: true, ink: INK.RED });
        }
      }
      // 十字挡板：横一道、竖一道（都高 1.28，从桌面往上）
      box(dx, y + 0.79, dz, DESK, PART_H, PART_T, { ink: INK.RED });
      box(dx, y + 0.79, dz, PART_T, PART_H, DESK, { ink: INK.RED });
      // 挡板上沿的浅色压条（实拍里是灰白边）
      box(dx, y + 0.79 + PART_H, dz, DESK + 0.04, 0.06, PART_T + 0.04, { noCollide: true, ink: INK.BLACK });
      box(dx, y + 0.79 + PART_H, dz, PART_T + 0.04, 0.06, DESK + 0.04, { noCollide: true, ink: INK.BLACK });
      // 四个工位：显示器 + 文件架 + 桌上绿植 + 椅子
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const wx = dx + sx * DESK * 0.25, wz = dz + sz * DESK * 0.25;
          // 显示器（屏 + 底座），屏幕朝外
          box(wx - sx * 0.28, y + 0.79, wz, 0.06, 0.42, 0.62, { noCollide: true, ink: INK.BLACK });
          box(wx - sx * 0.24, y + 0.79, wz, 0.14, 0.05, 0.26, { noCollide: true, ink: INK.BLACK });
          // 文件架（斜靠在挡板边）
          box(wx + sx * 0.18, y + 0.79, wz + sz * 0.52, 0.5, 0.28, 0.1, { noCollide: true, ink: INK.BLUE });
          // 桌上小绿植
          cyl(wx + sx * 0.52, y + 0.79, wz - sz * 0.42, 0.09, 0.14, { noCollide: true, ink: INK.RED, seg: 6 });
          cone(wx + sx * 0.52, y + 0.93, wz - sz * 0.42, 0.13, 0.22, { noCollide: true, ink: INK.GREEN, seg: 6 });
          // 椅子：只放在「朝走道」的两个工位（sz 指向房间中线的那两个），
          // 四把椅子全在中间走道两侧、背对背，谁也不压谁。
          // 坑（两轮）：①原来靠背只沿 x 偏移，斜角工位上看像插进座面中间；
          //            ②改成 L 形两片靠背之后，斜着看又读成「两块板交叉重叠」。
          // 现在按用户要求，直接和食堂那把同一套参数：单靠背、四条腿内缩。
          if (sz === (dz < (OFF.z1 + OFF.z2) / 2 ? 1 : -1)) {
            const chx = wx, chz = dz + sz * (DESK * 0.5 + 0.36);
            box(chx, y + 0.42, chz, 0.52, 0.08, 0.5, { noCollide: true, ink: INK.BLACK });                // 座面
            // 靠背必须落在座面【后沿之外】：座面半深 0.25 + 靠背半厚 0.035 = 0.285。
            // 原来写 0.22，靠背整个嵌在座面里，透视下就是"两块板交叉重叠"（用户两轮都指出这点）。
            box(chx, y + 0.5, chz + sz * 0.285, 0.52, 0.46, 0.07, { noCollide: true, ink: INK.BLACK });   // 靠背（朝外）
            for (const lx of [-1, 1]) {
              for (const lz of [-1, 1]) {
                box(chx + lx * 0.2, y, chz + lz * 0.2, 0.05, 0.42, 0.05, { noCollide: true, ink: INK.BLACK });
              }
            }
          }
        }
      }
    }

    // ---- 生活道具（图五："盆栽、高高的作业本之类的"）----
    // 北墙下的文件柜一排
    for (let i = 0; i < 3; i++) {
      box(OFF.x1 + 3.0 + i * 2.1, y, OFF.z2 - 0.62, 1.8, 1.75, 0.55, { ink: INK.BLUE });
      // 柜门缝 + 拉手
      box(OFF.x1 + 3.0 + i * 2.1, y + 0.85, OFF.z2 - 0.9, 1.7, 0.03, 0.04, { noCollide: true, ink: INK.BLACK });
      box(OFF.x1 + 3.0 + i * 2.1, y + 0.7, OFF.z2 - 0.92, 0.28, 0.05, 0.05, { noCollide: true, ink: INK.BLACK });
    }
    // 高高的作业本摞（图五点名要的）—— 放在靠门那张卡座旁边，两摞
    for (const [bx, bz, n] of [[OFF.x1 + 2.2, OFF.z1 + 2.6, 7], [OFF.x2 - 2.4, OFF.z1 + 2.4, 5]]) {
      for (let k = 0; k < n; k++) {
        box(bx, y + k * 0.11, bz, 0.62, 0.09, 0.44, { noCollide: true, ink: INK.BLACK });
        // 每本的封皮挑一本红的，别一摞全黑
        if (k % 3 === 1) box(bx, y + k * 0.11 + 0.02, bz, 0.64, 0.05, 0.46, { noCollide: true, ink: INK.RED });
      }
    }
    // 角落的大盆栽（两个）
    for (const [px, pz] of [[OFF.x1 + 1.3, OFF.z2 - 1.3], [OFF.x2 - 1.4, OFF.z2 - 1.2]]) {
      cyl(px, y, pz, 0.32, 0.46, { ink: INK.RED, seg: 10 });                 // 花盆
      cyl(px, y + 0.46, pz, 0.09, 0.7, { ink: INK.BLACK, seg: 6 });          // 树干
      cone(px, y + 1.0, pz, 0.52, 0.9, { noCollide: true, ink: INK.GREEN, seg: 6 });
      cone(px, y + 1.62, pz, 0.34, 0.6, { noCollide: true, ink: INK.GREEN, seg: 6 });
    }
    // 饮水机 + 灭火器（原来就有，位置按新房间调整）
    box(OFF.x1 + 1.2, y, OFF.z1 + 1.4, 1.1, 1.05, 0.5, { ink: INK.BLUE });
    box(OFF.x1 + 1.2, y + 1.05, OFF.z1 + 1.4, 0.42, 0.42, 0.42, { noCollide: true, ink: INK.BLUE });
    box(OFF.x2 - 0.7, y, OFF.z1 + 0.7, 0.42, 1.1, 0.42, { ink: INK.RED });
    // 墙上贴的海报（东墙 + 北墙各一张）
    box(OFF.x2 - 0.26, y + 1.9, OFF.z1 + 2.6, 0.05, 0.7, 0.5, { noCollide: true, ink: INK.GREEN, fill: true });
    box(OFF.x1 + 9.0, y + 1.95, OFF.z2 - 0.26, 0.9, 0.6, 0.05, { noCollide: true, ink: INK.ORANGE, fill: true });
    // 窗帘（北墙两窗两侧，米色 = 纸白 + 黑描边）
    for (const [a, b] of nwin) {
      for (const s of [-1, 1]) {
        const cxp = s < 0 ? a - 0.3 : b + 0.3;
        box(cxp, y + 1.05, OFF.z2 - 0.42, 0.46, 1.7, 0.06, { noCollide: true, ink: INK.BLACK });
      }
    }
    // 吸顶灯两盏
    for (const lx of [OFF.x1 + 7.0, OFF.x2 - 7.0]) {
      box(lx, y + FH - 0.22, (OFF.z1 + OFF.z2) / 2, 2.4, 0.1, 0.5, { noCollide: true, ink: INK.BLACK });
    }
  }

  // ---------------- 校门 / 围墙 ----------------
  // 围墙、大门、门卫岗亭、旗杆、花坛全部搬到 campus.js 了（那边按校园总平面图建整个校园）。
  // 这里只留一个空占位，game.js 用 level.gate 判断能不能开；真正的大门由 campus 提供。
  const gate = null;

  // ---------------- 存档点（每层厕所门口内侧） ----------------
  const saves = [];
  for (let f = 0; f < FLOORS; f++) saves.push(new THREE.Vector3(20.0, f * FH + 0.05, -1.5));

  // ---------------- 可拾取道具 ----------------
  const mkItem = (name, x, y, z, ink) => {
    const r = box(x, y, z, 0.46, 0.05, 0.32, { dynamic: true, noCollide: true, ink });
    pickups.push({ name, pos: new THREE.Vector3(x, y, z), mesh: r.mesh, taken: false });
  };
  const paperSpots = desks.filter((d) => d.x <= -10 && d.z <= -4.8);
  const pick = paperSpots[Math.floor(Math.random() * paperSpots.length)];
  mkItem('数学试卷', pick.x, 2 * FH + 0.75, pick.z, INK.BLUE);
  // 请假条放在办公室里间靠窗那张卡座的桌面上（新办公室放大后位置也变了）
  // 卡座中心 = (OFF.x2 - 4.4, OFF.z2 - 3.0)，桌面高 y + 0.72
  mkItem('请假条', OFF.x2 - 4.4 + 0.8, 2 * FH + 0.79, OFF.z2 - 3.0 + 0.8, INK.BLACK);

  const level = finish();

  return {
    playerStart: SEAT.clone(),
    seat: SEAT.clone(),
    classroom: CLASSROOM,
    desks,
    saves,
    stairs: stairSpots,
    gate,
    wire: null,
    pickups,
    bounds: level.bounds,
    floors: FLOORS,
    fh: FH,
    // 办公室那扇可交互的门（game.js 按 E 开/关）
    officeDoor,
    officeDoorSpot: new THREE.Vector3((LINK.x1 + LINK.x2) / 2, 2 * FH + 0.05, OFF.z1 + 0.9),
    npcs: [],
  };
}
