// 整个校园 —— 按用户手绘《校园平面图》（层 1.png）建模。本轮只建模，不放敌对生物。
//
// 坐标约定（与 school.js 一致）：
//   -z = 校园北（教学楼背后，狗洞一侧）      +z = 校园南（大门一侧）
//   -x = 西（食堂 / 小卖部 / 后山）           +x = 东（操场 / 监控室）
//
// 俯视（v0.4，整体放大到 188 × 96）：
//
//   z=-22 ┌──────────────────────────────────────────────────────────────────────────┐ 北墙（狗洞 x-60~-50）
//         │ ┌────────┐ ┌──────────┐                          ┌──────┐  ┌──────┐      │
//         │ │ 小卖部 │ │   食堂   │   花圃1      花圃2       │ 篮球 │  │ 操场 │      │
//         │ └────────┘ │          │                          │  场  │  │ 跑道 │      │
//         │            │  ┌────┐  │                          │      │  └──────┘      │
//         │  ▲后山     │  │后厨│  │        ┌──── 教学楼 ────┐ └──────┘  ┌──────┐      │
//         │ （暂不做） │  └────┘  │        │  1F 连廊 ↓     │           │监控室│      │
//         │  无栏杆段（搬椅子翻墙）└────────┴────────────────┘           └──────┘      │
//   z=74  └──────────────────────────────────────────────────────────────────────────┘ 南墙（大门 x-12~2）
//        x=-72                                                                      x=116
import * as THREE from '../vendor/three/three.module.js';
import { INK } from './render.js';
import { createBuilder } from './builder.js';

const GY = -0.02;          // 草地顶面（school.js 那块 320×320 的大地）
// 硬化地面要抬够，不能只高 1cm：墨线渲染是后期读深度/法线做的，
// 两层贴太近会 z-fighting，大片地面会闪成白纸（跑道、草坪都吃过这个亏）
const PY = 0.06;
const FH = 4;

// ---------------- 围墙（砖基 + 铁艺尖刺栏杆） ----------------
// 参考实拍图：下面一道 1 米左右的砖砌矮墙，上面是白/黑色铁栏杆，
// 栏杆顶部一截是矛尖，每隔几米一根砖柱把栏杆分成一段一段。
const WALL = { x1: -72, x2: 116, z1: -22, z2: 74 };
const WT = 0.44;           // 砖基厚度
const BASE_H = 1.0;        // 砖砌矮墙高度
const CAP = 0.16;          // 砖基压顶
const BAR_H = 1.85;        // 铁栏杆高度（从压顶上算）
const BAR_GAP = 0.26;      // 竖栏杆间距
const SPEAR_H = 0.26;      // 矛尖高
const PILLAR_EVERY = 6.0;  // 砖柱间距
const WH = BASE_H + CAP + BAR_H + SPEAR_H;   // 总高 ≈ 3.27

const GATE = { x1: -12, x2: 2 };                        // 南墙大门缺口
const HOLE = { x1: -60, x2: -50, h: 0.95 };             // 北墙狗洞（钻过去要蹲）
// 西墙"栏杆坏了"的那一段：砖基和其它段一样高（1.0m + 压顶），
// 能翻过去纯粹是因为上面没有铁栏杆挡着 —— 但墙头还有一米多，得去食堂后厨搬把椅子垫脚
const LOW = { z1: 30, z2: 44 };

// ---------------- 各功能区 ----------------
const CANTEEN = { x1: -66, x2: -38, z1: 2, z2: 34, h: 7.4 };    // 食堂（28 × 32，两层通高 7.4）
// 食堂二楼地板顶面。抬到 3.55（原来 2.90）：一楼净高 3.29、二楼净高 3.85，
// 大厅终于有"公共建筑"的层高感，不再是两米六的压抑盒子。
// 代价：floorOfY(3.55) = floor((3.55+0.9)/4) = 1，也就是说食堂二楼会被楼层判定
// 当成"二楼"。这在语义上本来就没错（它确实是二楼），而且 campus 里目前没有 NPC，
// 楼层冻结逻辑不会误伤；等以后给食堂放 NPC 时，把它们的 floor 设成 1 即可。
const CANTEEN_Y2 = 3.55;
const SHOP = { x1: -66, x2: -46, z1: 40, z2: 52, h: 4.2 };      // 小卖部（20 × 12）
const BEDS = [                                                   // 两个花圃（西边那个砍到宣传栏为止）
  { x1: -30, x2: -11.2, z1: 24, z2: 36 },
  { x1: 8, x2: 30, z1: 24, z2: 36 },
];
const FIELD = { x1: 56, x2: 106, z1: 2, z2: 56 };               // 操场（含跑道，50 × 54）
const COURT = { x1: 33, x2: 53, z1: 6, z2: 21, y: 0.2 };        // 篮球场（台地）
const MON = { x1: 96, x2: 112, z1: 60, z2: 70, h: 3.6 };        // 监控室
const GUARD = { x1: 6, x2: 16, z1: 62, z2: 72, h: 3.2 };        // 门卫岗亭
const HILL = { x1: -104, x2: -74, z1: 20, z2: 56 };             // 后山（本轮只留一片空地 + 终点旗）
const LINK1 = { x1: 21.5, x2: 26, z1: 3.4, z2: 13, y: 0.9 };    // 1F 架空连廊

export function buildCampus(scene, world) {
  const B = createBuilder(scene, world);
  const { box, slab, wallX, wallZ, winFrame, stairs, rail, arcLine, cyl, cone, collider, finish } = B;

  const pickups = [];

  // ================================================================
  //  围墙：砖基 + 压顶 + 铁艺尖刺栏杆（按实拍图）
  // ================================================================
  const capTop = GY + BASE_H + CAP;          // 压顶顶面 = 栏杆起点

  // 一根砖柱（栏杆分段用）
  function pillar(x, z, h) {
    box(x, GY, z, 0.56, h, 0.56, { noCollide: true, ink: INK.BLUE });
    box(x, GY + h, z, 0.68, 0.12, 0.68, { noCollide: true, ink: INK.BLACK });
  }

  // 一段铁栏杆（沿 x 或沿 z）。a1/a2 是长度方向坐标，c 是另一方向坐标。
  function barsRun(a1, a2, c, along) {
    if (a2 - a1 < 0.3) return;
    const len = a2 - a1;
    const mid = (a1 + a2) / 2;
    // 上下两道横杆（实拍图里是黑色方管）
    const yLo = capTop + BAR_H * 0.16;
    const yHi = capTop + BAR_H * 0.92;
    if (along === 'x') {
      box(mid, yLo, c, len, 0.07, 0.09, { noCollide: true, ink: INK.BLACK });
      box(mid, yHi, c, len, 0.07, 0.09, { noCollide: true, ink: INK.BLACK });
    } else {
      box(c, yLo, mid, 0.09, 0.07, len, { noCollide: true, ink: INK.BLACK });
      box(c, yHi, mid, 0.09, 0.07, len, { noCollide: true, ink: INK.BLACK });
    }
    // 竖栏杆 + 矛尖
    for (let a = a1 + BAR_GAP / 2; a < a2 - 0.02; a += BAR_GAP) {
      if (along === 'x') {
        box(a, capTop, c, 0.045, BAR_H, 0.045, { noCollide: true, ink: INK.BLACK });
        cone(a, capTop + BAR_H, c, 0.055, SPEAR_H, { seg: 4, noCollide: true, ink: INK.BLACK });
      } else {
        box(c, capTop, a, 0.045, BAR_H, 0.045, { noCollide: true, ink: INK.BLACK });
        cone(c, capTop + BAR_H, a, 0.055, SPEAR_H, { seg: 4, noCollide: true, ink: INK.BLACK });
      }
    }
  }

  // 一整段围墙（砖基 + 压顶 + 栏杆 + 碰撞 + 砖柱），along 决定走向
  // o.baseH：砖基高度（默认 BASE_H，全校园统一）
  // o.noRail：只砌砖基、不装铁栏杆 —— 西墙那段"尖刺坏了"就是这么做的
  function fence(a1, a2, c, along, o = {}) {
    if (a2 - a1 < 0.05) return;
    const baseH = o.baseH ?? BASE_H;
    const len = a2 - a1, mid = (a1 + a2) / 2;
    if (along === 'x') {
      box(mid, GY, c, len, baseH, WT, { noCollide: true, ink: INK.BLUE });
      box(mid, GY + baseH, c, len, CAP, WT + 0.16, { noCollide: true, ink: INK.BLACK });
      // 砖基表面的砖缝（横两条，竖的靠砖柱暗示）
      box(mid, GY + baseH * 0.45, c - WT / 2 - 0.01, len, 0.03, 0.02, { noCollide: true, ink: INK.BLACK });
      collider(mid, GY, c, len, baseH + CAP, WT + 0.16, { noShoot: true });
    } else {
      box(c, GY, mid, WT, baseH, len, { noCollide: true, ink: INK.BLUE });
      box(c, GY + baseH, mid, WT + 0.16, CAP, len, { noCollide: true, ink: INK.BLACK });
      box(c - WT / 2 - 0.01, GY + baseH * 0.45, mid, 0.02, 0.03, len, { noCollide: true, ink: INK.BLACK });
      collider(c, GY, mid, WT + 0.16, baseH + CAP, len, { noShoot: true });
    }
    // 砖柱（每 6m 一根，两端各一根）
    const n = Math.max(1, Math.round(len / PILLAR_EVERY));
    for (let i = 0; i <= n; i++) {
      const a = a1 + (len * i) / n;
      if (along === 'x') pillar(a, c, baseH + 0.42);
      else pillar(c, a, baseH + 0.42);
    }
    // 栏杆 + 整段拦人碰撞
    if (o.noRail) return;
    barsRun(a1, a2, c, along);
    if (along === 'x') collider(mid, capTop, c, len, BAR_H + SPEAR_H, 0.14, { noShoot: true });
    else collider(c, capTop, mid, 0.14, BAR_H + SPEAR_H, len, { noShoot: true });
  }

  // 室内地面：墨线风格不铺实色（实色会把整个房间压成一块死蓝），
  // 只在白纸上画地砖格线，读起来更像"纸上的地面"
  // 线要很细：房间十几米进深，5cm 宽的线透视后会变成几条粗黑大斜线，把地面读成斜条纹
  function tiledFloor(x1, z1, x2, z2, y, o = {}) {
    const step = o.step ?? 2.0;
    const ink = o.ink ?? INK.BLACK;
    const LW = 0.012;
    // 地板本身：不加 fill，只是一层薄板挡住下面的草地，呈现为白纸色
    slab(x1, z1, x2, z2, y, 0.06, { ink, noCollide: true });
    // 砖缝：横竖各一串细线（压在板面上 1cm）
    for (let x = x1 + step; x < x2 - 0.05; x += step) {
      box(x, y + 0.01, (z1 + z2) / 2, LW, 0.008, z2 - z1, { noCollide: true, ink });
    }
    for (let z = z1 + step; z < z2 - 0.05; z += step) {
      box((x1 + x2) / 2, y + 0.01, z, x2 - x1, 0.008, LW, { noCollide: true, ink });
    }
  }

  // ---- 北墙：留狗洞 ----
  fence(WALL.x1, HOLE.x1, WALL.z1, 'x');
  fence(HOLE.x2, WALL.x2, WALL.z1, 'x');
  // 狗洞上方的砖基要断开（洞口 0.95 高），单独补一段
  box((HOLE.x1 + HOLE.x2) / 2, GY + HOLE.h, WALL.z1, HOLE.x2 - HOLE.x1, BASE_H - HOLE.h, WT,
    { noCollide: true, ink: INK.BLUE });
  box((HOLE.x1 + HOLE.x2) / 2, GY + BASE_H, WALL.z1, HOLE.x2 - HOLE.x1, CAP, WT + 0.16,
    { noCollide: true, ink: INK.BLACK });
  barsRun(HOLE.x1, HOLE.x2, WALL.z1, 'x');
  collider((HOLE.x1 + HOLE.x2) / 2, GY + HOLE.h, WALL.z1, HOLE.x2 - HOLE.x1, BASE_H - HOLE.h, WT + 0.16, { noShoot: true });
  collider((HOLE.x1 + HOLE.x2) / 2, capTop, WALL.z1, HOLE.x2 - HOLE.x1, BAR_H + SPEAR_H, 0.14, { noShoot: true });

  // 狗洞铁网：不剪开就钻不过去（钳子在监控室）
  const holeWire = box(
    (HOLE.x1 + HOLE.x2) / 2, GY, WALL.z1, HOLE.x2 - HOLE.x1, HOLE.h, 0.1,
    { dynamic: true, ink: INK.BLACK, fill: true }
  );
  for (let i = 1; i < 8; i++) {
    box(HOLE.x1 + i * (HOLE.x2 - HOLE.x1) / 8, GY, WALL.z1 - 0.02, 0.04, HOLE.h, 0.04, { noCollide: true, ink: INK.BLACK });
  }
  for (let i = 1; i < 4; i++) {
    box((HOLE.x1 + HOLE.x2) / 2, GY + i * HOLE.h / 4, WALL.z1 - 0.02, HOLE.x2 - HOLE.x1, 0.04, 0.04, { noCollide: true, ink: INK.BLACK });
  }

  // ---- 南墙：留大门 ----
  fence(WALL.x1, GATE.x1, WALL.z2, 'x');
  fence(GATE.x2, WALL.x2, WALL.z2, 'x');

  // ---- 西墙：中间一段的尖刺（铁栏杆）坏了 —— 砖基和别处一样高，只是上面空着 ----
  fence(WALL.z1, LOW.z1, WALL.x1, 'z');
  fence(LOW.z1, LOW.z2, WALL.x1, 'z', { noRail: true });   // 栏杆缺失段
  fence(LOW.z2, WALL.z2, WALL.x1, 'z');
  // 断口处的细节：两端的栏杆被拧断，留下几截歪斜的残杆 + 掉在地上的一段栏杆
  {
    const lx = WALL.x1;
    // 断口南端：一根被拗弯的竖杆（斜着，用 box 拼）
    for (const [dz, tilt] of [[-0.35, 0.28], [-0.62, 0.16]]) {
      box(lx - tilt * 0.4, capTop, LOW.z1 + dz, 0.045, BAR_H * 0.62, 0.045, { noCollide: true, ink: INK.BLACK });
      box(lx - tilt * 0.9, capTop + BAR_H * 0.6, LOW.z1 + dz, 0.045, 0.5, 0.045, { noCollide: true, ink: INK.BLACK });
    }
    // 断口北端：残留一小截横杆（说明这里本来是连续栏杆）
    box(lx, capTop + BAR_H * 0.92, LOW.z2 - 0.5, 0.09, 0.07, 1.0, { noCollide: true, ink: INK.BLACK });
    box(lx, capTop + BAR_H * 0.16, LOW.z2 - 0.5, 0.09, 0.07, 1.0, { noCollide: true, ink: INK.BLACK });
    // 地上：一截被拆下来扔在草里的栏杆（两根横杆 + 几根竖杆）
    const gz = (LOW.z1 + LOW.z2) / 2, gx = lx + 1.1;
    for (const s of [-1, 1]) box(gx, GY + 0.05, gz + s * 0.34, 1.9, 0.07, 0.07, { noCollide: true, ink: INK.BLACK });
    for (let i = 0; i < 7; i++) {
      box(gx - 0.85 + i * 0.28, GY + 0.05, gz, 0.045, 0.07, 0.72, { noCollide: true, ink: INK.BLACK });
    }
    // 地上再散几根断掉的矛尖
    for (let i = 0; i < 4; i++) {
      cone(gx - 0.7 + i * 0.5, GY + 0.02, gz + 0.55, 0.055, SPEAR_H, { seg: 4, noCollide: true, ink: INK.BLACK });
    }
  }

  // ---- 东墙 ----
  fence(WALL.z1, WALL.z2, WALL.x2, 'z');

  // ================================================================
  //  地面 / 道路
  // ================================================================
  // 路面不铺实色：这是墨线速写风，纸白地面 + 黑描边才读得对；
  // 一旦 fill 就是一大块死蓝，把整个画面压塌（试过，很难看）
  slab(-36, 3.4, 56, 16, PY, 0.12, { ink: INK.BLACK });        // 教学楼前广场
  slab(-6, 16, 2, WALL.z2, PY, 0.12, { ink: INK.BLACK });      // 南北主路
  slab(-38, 2, -34, 44, PY, 0.12, { ink: INK.BLACK });         // 食堂东侧通道
  slab(52, 2, 56, 56, PY, 0.12, { ink: INK.BLACK });           // 操场西通道
  slab(2, 56, 18, WALL.z2, PY, 0.12, { ink: INK.BLACK });      // 岗亭前
  slab(-34, 16, -8, 24, PY, 0.12, { ink: INK.BLACK });         // 自行车棚前

  // ================================================================
  //  大门 + 门卫岗亭
  // ================================================================
  let gateL = null, gateR = null;
  {
    const gw = (GATE.x2 - GATE.x1) / 2;
    gateL = box(GATE.x1 + gw / 2, GY, WALL.z2, gw - 0.1, 2.8, 0.2, { dynamic: true, ink: INK.RED, fill: true });
    gateR = box(GATE.x2 - gw / 2, GY, WALL.z2, gw - 0.1, 2.8, 0.2, { dynamic: true, ink: INK.RED, fill: true });
    // 门楣 + 门柱
    box((GATE.x1 + GATE.x2) / 2, GY + 2.9, WALL.z2, GATE.x2 - GATE.x1 + 0.8, 0.44, 0.54, { ink: INK.BLACK });
    box(GATE.x1 - 0.34, GY, WALL.z2, 0.68, 3.6, 0.68, { ink: INK.BLUE });
    box(GATE.x2 + 0.34, GY, WALL.z2, 0.68, 3.6, 0.68, { ink: INK.BLUE });
    box(GATE.x1 - 0.34, GY + 3.6, WALL.z2, 0.8, 0.14, 0.8, { noCollide: true, ink: INK.BLACK });
    box(GATE.x2 + 0.34, GY + 3.6, WALL.z2, 0.8, 0.14, 0.8, { noCollide: true, ink: INK.BLACK });
    // 校名牌
    box((GATE.x1 + GATE.x2) / 2, GY + 3.34, WALL.z2 - 0.3, 8.4, 0.66, 0.08, { noCollide: true, ink: INK.RED, fill: true });

    // ================================================================
    //  门卫岗亭（v0.16 照示意图重做）
    //  外部：红砖墙 + 白色壁柱 + 白色檐口压着深色平顶 + 大面深框玻璃窗 + 北门雨棚
    //  内部：监控室 —— 整面电视墙 + 长条值班台上的显示器阵列 + 绿色内门 + 饮水机 + 矮柜
    // ================================================================
    {
      const { x1, x2, z1, z2, h } = GUARD;
      const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
      const w = x2 - x1, d = z2 - z1;
      const T = 0.34;                                  // 砖墙比教学楼厚一点
      const iw = T / 2;                                // 半墙厚
      const mwx = x1 + iw, mwxE = x2 - iw;             // 西 / 东墙内表面
      const mwz = z1 + iw, mwzS = z2 - iw;             // 北 / 南墙内表面

      // 洞口（gaps 的 y 是相对 GY 的高度）
      const gapDoor = [cx - 1.05, cx + 1.05, 0, 2.28];      // 北墙：入户门
      const gapWinN = [12.5, 14.4, 1.05, 2.45];             // 北墙：门旁小窗
      const gapWinS = [7.5, 14.5, 0.95, 2.55];              // 南墙：朝大门的大玻璃窗
      const gapWinE = [63.7, 66.2, 1.05, 2.45];             // 东墙：侧窗
      const gapDoorE = [68.3, 69.6, 0, 2.1];                // 东墙：绿色内门
      // ---- 四面砖墙（INK.RED 实色；不 fill 的话红砖读不出来）----
      wallX(x1, x2, z1, GY, h, T, [gapDoor, gapWinN], { ink: INK.RED, fill: true });
      wallX(x1, x2, z2, GY, h, T, [gapWinS], { ink: INK.RED, fill: true });
      wallZ(z1, z2, x1, GY, h, T, [], { ink: INK.RED, fill: true });
      wallZ(z1, z2, x2, GY, h, T, [gapWinE, gapDoorE], { ink: INK.RED, fill: true });

      // ---- 室内白色衬板：砖墙的背面也是红的，进屋会像进了砖窑 ----
      // 贴内表面薄薄一层，不 fill → 纸白，和参考图里刷白的室内一致。
      const lin = { noCollide: true, ink: INK.BLACK };
      wallX(x1, x2, mwz + 0.02, GY, h, 0.05, [gapDoor, gapWinN], lin);
      wallX(x1, x2, mwzS - 0.02, GY, h, 0.05, [gapWinS], lin);
      wallZ(z1, z2, mwx + 0.02, GY, h, 0.05, [], lin);
      wallZ(z1, z2, mwxE - 0.02, GY, h, 0.05, [gapWinE, gapDoorE], lin);

      // ---- 砖缝横线：只在实墙面上画（门窗洞里画了就是几条悬空的线）----
      const courses = (along, a1, a2, c, gaps) => {
        for (let yy = GY + 0.34; yy < GY + h - 0.1; yy += 0.34) {
          const rel = yy - GY;
          const cut = gaps
            .filter((g) => (g[2] ?? 0) <= rel && (g[3] ?? h) >= rel)
            .map((g) => [g[0], g[1]])
            .sort((a, b) => a[0] - b[0]);
          let cur = a1;
          const segs = [];
          for (const [s, e] of cut) {
            if (s > cur) segs.push([cur, Math.min(s, a2)]);
            cur = Math.max(cur, e);
          }
          if (cur < a2) segs.push([cur, a2]);
          for (const [s, e] of segs) {
            if (e - s < 0.1) continue;
            if (along === 'x') box((s + e) / 2, yy, c, e - s, 0.028, 0.03, { noCollide: true, ink: INK.BLACK });
            else box(c, yy, (s + e) / 2, 0.03, 0.028, e - s, { noCollide: true, ink: INK.BLACK });
          }
        }
      };
      courses('x', x1, x2, z1 - iw - 0.016, [gapDoor, gapWinN]);
      courses('x', x1, x2, z2 + iw + 0.016, [gapWinS]);
      courses('z', z1, z2, x1 - iw - 0.016, []);
      courses('z', z1, z2, x2 + iw + 0.016, [gapWinE, gapDoorE]);

      // ---- 白色壁柱：四角各一根，微微凸出砖面（示意图里就是白柱夹砖墙）----
      for (const px of [x1, x2]) {
        for (const pz of [z1, z2]) {
          box(px, GY, pz, 0.54, h, 0.54, { ink: INK.BLACK });
        }
      }

      // ---- 屋顶：白色檐口 + 压在上面的深色平顶 ----
      box(cx, GY + h - 0.22, cz, w + 1.3, 0.22, d + 1.3, { noCollide: true, ink: INK.BLACK });
      box(cx, GY + h, cz, w + 1.44, 0.3, d + 1.44, { ink: INK.BLACK, fill: true });
      // 室内吊顶（不然抬头是深色屋顶的背面）
      box(cx, GY + h - 0.08, cz, w - T - 0.06, 0.06, d - T - 0.06, { noCollide: true, ink: INK.BLACK });

      // ---- 北门雨棚（示意图左侧那个门廊）：白檐口 + 深色顶 + 两根白柱 ----
      {
        const ccy = GY + h - 0.62;
        box(cx, ccy - 0.2, z1 - 1.5, 4.6, 0.2, 3.0, { noCollide: true, ink: INK.BLACK });
        box(cx, ccy, z1 - 1.5, 4.72, 0.16, 3.12, { noCollide: true, ink: INK.BLACK, fill: true });
        for (const px of [cx - 2.0, cx + 2.0]) {
          box(px, GY, z1 - 2.6, 0.34, ccy - GY - 0.2, 0.34, { ink: INK.BLACK });
        }
      }

      // ---- 窗：南面一整条大玻璃（横向多分格），北面小窗，东面侧窗 ----
      winFrame((gapWinS[0] + gapWinS[1]) / 2, GY + 0.95, 1.6, z2 + iw + 0.05, 7.0, 'x');
      for (const mx of [8.7, 10.2, 11.7, 13.2]) {
        box(mx, GY + 0.95, z2 + iw + 0.05, 0.06, 1.6, 0.1, { noCollide: true, ink: INK.BLACK });
      }
      winFrame((gapWinN[0] + gapWinN[1]) / 2, GY + 1.05, 1.4, z1 - iw - 0.05, 1.9, 'x');
      winFrame((gapWinE[0] + gapWinE[1]) / 2, GY + 1.05, 1.4, x2 + iw + 0.05, 2.5, 'z');

      // ---- 入户门框 + 门槛（室内外零高差，按 v0.10 的规矩不放台阶）----
      box(cx, GY + 2.28, z1, 2.3, 0.12, 0.5, { noCollide: true, ink: INK.BLACK });
      for (const s of [-1, 1]) box(cx + s * 1.13, GY, z1, 0.14, 2.28, 0.5, { noCollide: true, ink: INK.BLACK });
      box(cx, GY, z1, 2.3, 0.05, 0.4, { noCollide: true, ink: INK.BLACK });
      // 门外"门卫"牌（挂在门西侧那截实墙上 —— 东侧是窗洞，挂那儿就悬空了）
      box(cx - 2.3, GY + 1.9, z1 - iw - 0.06, 1.1, 0.5, 0.08, { noCollide: true, ink: INK.BLUE, fill: true });

      // ---- 室内地面（白瓷砖，格线密一点，房间只有 10 米）----
      tiledFloor(mwx, mwz, mwxE, mwzS, GY + 0.05, { step: 1.3 });

      // ---- 电视墙（西墙整面）：柜体 + 4 列 × 3 行监视器 ----
      // 每块监视器画三层：黑外框（实心）→ 蓝屏面（实心）→ 纸白高光条。
      // 【踩过的坑】只画一层黑块 → 12 块糊成一整面黑板；内屏用纸白 →
      // 又读成了"一排相框"（截图 GD1 确认）。屏幕本身得是深色的，
      // 所以内屏取 INK.BLUE 实心，外面一圈黑框，才读得出"亮着的屏"。
      // 尺寸 1.4 × 0.52、行距 0.72（屏间留 0.2 空隙）；第一版行距 0.57
      // 三条几乎贴在一起，读成了"三个抽屉"。
      box(mwx + 0.33, GY, cz, 0.64, 2.80, d - 2.0, { ink: INK.BLACK });
      for (let c = 0; c < 4; c++) {
        const mz = z1 + 1.7 + c * 2.0;
        for (let r = 0; r < 3; r++) {
          const my = GY + 0.72 + r * 0.72;
          // 外框（黑，实心）
          box(mwx + 0.67, my, mz, 0.06, 0.52, 1.4, { noCollide: true, ink: INK.BLACK, fill: true });
          // 屏面（蓝，实心，四周各缩 6cm）
          box(mwx + 0.70, my + 0.055, mz, 0.02, 0.41, 1.28, { noCollide: true, ink: INK.BLUE, fill: true });
          // 屏内一道纸白高光，屏幕才不至于是一块死蓝
          box(mwx + 0.715, my + 0.30, mz, 0.012, 0.07, 1.0, { noCollide: true, ink: INK.BLACK });
        }
      }
      // 柜门缝（底下两排柜子）
      for (let c = 0; c < 4; c++) {
        const mz = z1 + 1.7 + c * 2.0;
        box(mwx + 0.66, GY + 0.06, mz, 0.02, 0.62, 1.6, { noCollide: true, ink: INK.BLACK });
      }

      // ---- 长条值班台（台面朝西，对着电视墙）----
      const dsk = 12.7, dz1 = z1 + 2.2, dz2 = z2 - 1.6;
      const dcz = (dz1 + dz2) / 2, dl = dz2 - dz1;
      // 台体：不 fill 的纸白 + 黑描边。第一版给的是整块 INK.BLUE 实心，
      // 10 米长的蓝板子在画面里比电视墙还抢眼（截图确认过）。
      box(dsk, GY, dcz, 1.0, 0.74, dl, { ink: INK.BLACK });
      box(dsk, GY + 0.74, dcz, 1.16, 0.06, dl + 0.16, { noCollide: true, ink: INK.BLACK });
      // 台体正面三道抽屉缝，让它读起来是"柜子"不是一块板
      for (let i = 0; i < 3; i++) {
        box(dsk - 0.51, GY + 0.1 + i * 0.22, dcz, 0.02, 0.03, dl - 0.5, { noCollide: true, ink: INK.BLACK });
      }
      // 台上一排 4 台显示器（面朝西）+ 键盘
      for (let i = 0; i < 4; i++) {
        const mz = dz1 + 0.9 + i * 1.6;
        box(dsk - 0.12, GY + 0.8, mz, 0.46, 0.03, 0.3, { noCollide: true, ink: INK.BLACK });
        // 屏：黑外框 + 蓝屏面 + 纸白高光（和电视墙同一套画法，见上面注释）
        box(dsk - 0.22, GY + 0.83, mz, 0.06, 0.44, 0.66, { noCollide: true, ink: INK.BLACK, fill: true });
        box(dsk - 0.25, GY + 0.88, mz, 0.02, 0.34, 0.56, { noCollide: true, ink: INK.BLUE, fill: true });
        box(dsk - 0.262, GY + 1.06, mz, 0.012, 0.06, 0.44, { noCollide: true, ink: INK.BLACK });
        box(dsk + 0.16, GY + 0.8, mz, 0.34, 0.03, 0.14, { noCollide: true, ink: INK.BLACK });
      }
      // 电话 + 鼠标 + 值班记录本
      box(dsk + 0.06, GY + 0.8, dz1 + 0.34, 0.3, 0.12, 0.22, { noCollide: true, ink: INK.BLACK });
      box(dsk + 0.1, GY + 0.8, dz2 - 0.45, 0.2, 0.03, 0.3, { noCollide: true, ink: INK.BLACK });
      box(dsk + 0.06, GY + 0.8, dcz - 0.9, 0.26, 0.02, 0.36, { noCollide: true, ink: INK.RED });

      // ---- 保安椅（黑色高背转椅，人朝西坐）----
      {
        const chx = dsk + 1.15, chz = dcz + 0.4;
        box(chx, GY + 0.42, chz, 0.54, 0.1, 0.54, { noCollide: true, ink: INK.BLACK });
        box(chx + 0.27, GY + 0.5, chz, 0.08, 0.66, 0.54, { noCollide: true, ink: INK.BLACK });
        cyl(chx, GY, chz, 0.06, 0.42, { noCollide: true, ink: INK.BLACK, seg: 8 });
        box(chx, GY, chz, 0.5, 0.05, 0.12, { noCollide: true, ink: INK.BLACK });
        box(chx, GY, chz, 0.12, 0.05, 0.5, { noCollide: true, ink: INK.BLACK });
      }

      // ---- 东墙的绿色内门（通向里屋，装饰用）+ 上方绿色安全出口牌 ----
      box(x2, GY, (gapDoorE[0] + gapDoorE[1]) / 2, 0.14, 2.1, gapDoorE[1] - gapDoorE[0],
        { ink: INK.GREEN, fill: true });
      box(x2 - iw - 0.06, GY + 1.25, (gapDoorE[0] + gapDoorE[1]) / 2, 0.05, 0.5, 0.42,
        { noCollide: true, ink: INK.BLACK });
      box(x2 - iw - 0.07, GY + 2.24, (gapDoorE[0] + gapDoorE[1]) / 2, 0.05, 0.26, 0.9,
        { noCollide: true, ink: INK.GREEN, fill: true });
      // 门把手
      box(x2 - iw - 0.1, GY + 0.95, gapDoorE[0] + 0.16, 0.06, 0.1, 0.1, { noCollide: true, ink: INK.BLACK });

      // ---- 饮水机（蓝色桶装）+ 米色矮柜 + 值班表 ----
      {
        const wx2 = mwxE - 0.42, wz = mwzS - 1.0;
        box(wx2, GY, wz, 0.5, 0.95, 0.5, { ink: INK.BLACK });
        cyl(wx2, GY + 0.95, wz, 0.22, 0.46, { noCollide: true, ink: INK.BLUE, seg: 12 });
        box(wx2, GY + 1.41, wz, 0.2, 0.06, 0.2, { noCollide: true, ink: INK.BLACK });
      }
      box(9.6, GY, mwzS - 0.38, 2.6, 0.82, 0.62, { ink: INK.ORANGE });
      box(9.6, GY + 0.82, mwzS - 0.38, 2.72, 0.05, 0.7, { noCollide: true, ink: INK.BLACK });
      box(8.9, GY + 0.87, mwzS - 0.38, 0.34, 0.06, 0.26, { noCollide: true, ink: INK.RED });
      // 墙上值班表（红纸）
      box(mwx + 0.06, GY + 1.5, mwzS - 1.9, 0.05, 0.72, 1.1, { noCollide: true, ink: INK.RED, fill: true });

      // ---- 壁挂空调（东墙上方）+ 立式空调（东北角）----
      box(mwxE - 0.18, GY + 2.26, 65.0, 0.32, 0.34, 0.98, { noCollide: true, ink: INK.BLACK });
      box(mwxE - 0.62, GY, 63.3, 0.52, 1.5, 0.44, { ink: INK.BLACK });
      box(mwxE - 0.66, GY + 1.5, 63.3, 0.44, 0.06, 0.5, { noCollide: true, ink: INK.BLACK });

      // ---- 吸顶灯 4 盏 ----
      for (const lx of [8.8, 13.4]) {
        for (const lz of [64.8, 69.2]) {
          box(lx, GY + h - 0.18, lz, 1.1, 0.1, 1.1, { noCollide: true, ink: INK.BLACK });
          box(lx, GY + h - 0.22, lz, 0.9, 0.05, 0.9, { noCollide: true, ink: INK.ORANGE, fill: true });
        }
      }
    }
  }

  // ================================================================
  //  食堂（28 × 32：一楼后厨 + 取餐口 + 大厅，二楼吃饭区 + 杂物间）
  // ================================================================
  {
    const { x1, x2, z1, z2, h } = CANTEEN;
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
    const w = x2 - x1, d = z2 - z1;
    // 二楼地板顶面（模块级常量 CANTEEN_Y2，椅子 / 便条等散装物件也要用）
    const y2 = CANTEEN_Y2;
    const yb2 = y2 - 0.26;             // 二楼楼板底 = 一楼天花板
    // 室内地面（地砖格线，比室外高 5cm，不然桌子像浮在草地上）
    tiledFloor(x1 - 0.2, z1 - 0.2, x2 + 0.2, z2 + 0.2, GY + 0.05, { step: 2.2 });
    // 东墙开大门（学生从教学楼西端过来），另开一个侧门
    wallZ(z1, z2, x2, GY, h, 0.36, [[13.6, 18.4, 0, 2.7], [26.0, 28.6, 0, 2.3]]);
    wallZ(z1, z2, x1, GY, h, 0.36);
    // 南北墙：一楼 5 窗（1.0~2.6）+ 二楼 4 窗（3.2~4.6）
    // 坑：原来一楼窗开到 3.4，正好顶穿二楼地板（楼板底 2.64），必须压低。
    const w1 = [];
    for (let i = 0; i < 5; i++) w1.push([x1 + 3.2 + i * 4.6, x1 + 5.8 + i * 4.6, 1.0, 2.6]);
    const w2 = [];
    for (let i = 0; i < 4; i++) w2.push([x1 + 4.4 + i * 5.4, x1 + 6.8 + i * 5.4, y2 + 0.75, y2 + 2.25]);
    wallX(x1, x2, z1, GY, h, 0.36, [...w1, ...w2]);
    wallX(x1, x2, z2, GY, h, 0.36, [...w1, ...w2]);
    for (const [a, b, yb, yt] of [...w1, ...w2]) {
      winFrame((a + b) / 2, GY + yb, yt - yb, z1 + 0.2, b - a, 'x');
      winFrame((a + b) / 2, GY + yb, yt - yb, z2 - 0.2, b - a, 'x');
    }
    // 屋顶（挑檐）+ 排风扇
    box(cx, GY + h, cz, w + 1.0, 0.32, d + 1.0, { ink: INK.BLACK });
    box(cx, GY + h + 0.32, cz, w - 2.0, 0.18, d - 2.0, { noCollide: true, ink: INK.BLUE });
    for (const [fx, fz] of [[x1 + 6, z1 + 5], [x1 + 6, z2 - 5], [x2 - 8, z1 + 5], [x2 - 8, z2 - 5]]) {
      cyl(fx, GY + h + 0.32, fz, 0.55, 0.6, { ink: INK.BLACK, seg: 10 });
    }
    // 后厨隔断（北侧 6m）。按实拍图：不是一整面墙，而是"取餐口墙" ——
    // 5 个开着的窗口，窗口之间留实墙，窗口上方一条橙色菜品招牌带。
    const KZ = z1 + 6.0;
    const WIN_N = 5;
    const winW = 2.3;          // 取餐口宽
    const winGap = 1.5;        // 窗口之间的实墙
    const totalW = WIN_N * winW + (WIN_N - 1) * winGap;
    const winX0 = cx - totalW / 2;
    const WIN_Y0 = 1.02, WIN_Y1 = 2.22;   // 取餐口下沿 / 上沿
    const gaps = [];
    for (let i = 0; i < WIN_N; i++) {
      const a = winX0 + i * (winW + winGap);
      gaps.push([a, a + winW, WIN_Y0, WIN_Y1]);
    }
    // 后厨的进出门（在最东端，学生想拿椅子就得从这儿钻进去）
    const BACKDOOR = [x2 - 4.2, x2 - 2.4];
    gaps.push([BACKDOOR[0], BACKDOOR[1], 0, 2.3]);
    // 隔断要砌到天花板：只砌 3m 的话，上方会露出一个大缝，直接看进后厨
    wallX(x1, x2, KZ, GY, h, 0.24, gaps);
    // 每个窗口：不锈钢台面（出檐）+ 台下挡板 + 窗口里的菜盆
    for (let i = 0; i < WIN_N; i++) {
      const a = winX0 + i * (winW + winGap);
      const wc = a + winW / 2;
      // 台面（出檐到学生这侧 0.7m）
      box(wc, GY + 0.92, KZ + 0.28, winW + 0.24, 0.08, 0.86, { ink: INK.BLACK });
      // 台下挡板
      box(wc, GY, KZ + 0.24, winW, 0.92, 0.5, { ink: INK.BLUE });
      // 窗口上沿的一道横梁（把窗口压成"窗口"而不是洞）
      box(wc, GY + WIN_Y1, KZ, winW, 0.1, 0.28, { noCollide: true, ink: INK.BLACK });
      // 窗口里摆 3 个菜盆（不锈钢圆盆）
      for (let k = 0; k < 3; k++) {
        cyl(a + 0.42 + k * 0.72, GY + 1.0, KZ - 0.15, 0.24, 0.16, { noCollide: true, ink: INK.BLUE, seg: 10 });
      }
      // 窗口侧边的玻璃挡板（细边框表示）
      for (const s of [-1, 1]) {
        box(wc + s * (winW / 2 - 0.03), GY + WIN_Y0, KZ + 0.02, 0.06, WIN_Y1 - WIN_Y0, 0.14, { noCollide: true, ink: INK.BLACK });
      }
    }
    // 窗口上方的橙色菜品招牌带（实拍图里那排黄底招牌）
    box(cx, GY + 2.32, KZ + 0.16, totalW + 1.6, 0.62, 0.14, { noCollide: true, ink: INK.ORANGE, fill: true });
    // 招牌带上下两道压边
    box(cx, GY + 2.28, KZ + 0.16, totalW + 1.7, 0.06, 0.2, { noCollide: true, ink: INK.BLACK });
    box(cx, GY + 2.94, KZ + 0.16, totalW + 1.7, 0.06, 0.2, { noCollide: true, ink: INK.BLACK });    // 招牌上每个窗口挂一块菜名牌（红底小方牌）
    for (let i = 0; i < WIN_N; i++) {
      const a = winX0 + i * (winW + winGap);
      box(a + winW / 2, GY + 2.42, KZ + 0.25, 1.5, 0.4, 0.04, { noCollide: true, ink: INK.RED, fill: true });
    }
    // 一楼天花板：方形吸顶灯阵列（实拍图里那种）
    // 挂在【二楼楼板底】而不是屋顶 —— 屋顶现在已经是二楼的天花板了
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        const lx = x1 + 4.0 + i * 4.2, lz = KZ + 3.4 + j * 7.6;
        box(lx, yb2 - 0.1, lz, 1.3, 0.08, 1.3, { noCollide: true, ink: INK.BLACK });
        box(lx, yb2 - 0.16, lz, 1.0, 0.06, 1.0, { noCollide: true, ink: INK.ORANGE, fill: true });
      }
    }
    // 后厨：灶台 / 蒸箱 / 水池 / 案板
    box(x1 + 4.0, GY, z1 + 2.2, 4.4, 0.92, 1.8, { ink: INK.BLACK });
    box(x1 + 4.0, GY + 0.92, z1 + 2.2, 4.6, 0.12, 2.0, { noCollide: true, ink: INK.BLUE });
    box(x1 + 11.0, GY, z1 + 2.2, 2.6, 1.7, 1.6, { ink: INK.BLUE });
    box(x1 + 17.0, GY, z1 + 2.2, 3.6, 0.92, 1.6, { ink: INK.BLUE });
    box(x1 + 22.0, GY, z1 + 2.2, 3.0, 0.9, 1.4, { ink: INK.ORANGE });
    // 后厨挂墙的不锈钢架
    box(x1 + 14.5, GY + 1.9, z1 + 0.4, 6.0, 0.1, 0.5, { noCollide: true, ink: INK.BLACK });
    // 餐桌：按实拍改成"长条浅木色桌 + 橙白塑料椅"（原来是蓝方桌 + 黑长凳，太像工地）
    // 4 列 × 4 排，每张桌子 4.4m 长，两侧各 2 把椅子
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const tx = x1 + 5.2 + i * 6.6, tz = z1 + 9.6 + j * 5.8;
        const TW = 4.4, TD = 1.0;
        // 桌面：浅木色。这里故意**不** fill —— 一 fill 就是一整块死橙，
        // 十几张桌子连成一片，整个食堂会被压塌；留纸白 + 橙描边才读得出"木桌"
        box(tx, GY + 0.72, tz, TW, 0.07, TD, { noCollide: true, ink: INK.ORANGE });
        // 桌沿包边（黑细线，把桌子从背景里挑出来）
        box(tx, GY + 0.79, tz - TD / 2 + 0.02, TW, 0.03, 0.04, { noCollide: true, ink: INK.BLACK });
        box(tx, GY + 0.79, tz + TD / 2 - 0.02, TW, 0.03, 0.04, { noCollide: true, ink: INK.BLACK });
        // 桌腿：两端各一对（细方腿，中间空着好坐人）
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            box(tx + sx * (TW / 2 - 0.3), GY, tz + sz * 0.36, 0.08, 0.72, 0.08, { noCollide: true, ink: INK.BLACK });
          }
        }
        // 中间一道横撑
        box(tx, GY + 0.22, tz, TW - 0.7, 0.06, 0.06, { noCollide: true, ink: INK.BLACK });
        // 椅子：两侧各 2 把（橙色座面 + 纸白靠背，实拍里就是橙白配）
        for (const sz of [-1, 1]) {
          for (let c = 0; c < 2; c++) {
            const chx = tx - 1.15 + c * 2.3;
            const chz = tz + sz * 0.92;
            // 座面（橙色，只在座面上用一点点实色，面积小才不会糊）
            box(chx, GY + 0.42, chz, 0.52, 0.08, 0.5, { noCollide: true, ink: INK.ORANGE });
            // 靠背（朝桌子外侧）
            box(chx, GY + 0.5, chz + sz * 0.22, 0.52, 0.46, 0.07, { noCollide: true, ink: INK.ORANGE });
            // 四条腿
            for (const lx of [-1, 1]) {
              for (const lz of [-1, 1]) {
                box(chx + lx * 0.2, GY, chz + lz * 0.2, 0.05, 0.42, 0.05, { noCollide: true, ink: INK.BLACK });
              }
            }
          }
        }
      }
    }
    // 柱
    for (const [px, pz] of [[x1 + 6.5, cz], [x2 - 6.5, cz], [x1 + 14.5, z1 + 8.0], [x1 + 14.5, z2 - 8.0]]) {
      cyl(px, GY, pz, 0.26, h, { ink: INK.BLUE, seg: 12 });
    }
    // 墙角垃圾桶 ×3
    cyl(x2 - 1.0, GY, z1 + 7.4, 0.32, 0.88, { ink: INK.BLACK, seg: 10 });
    cyl(x2 - 1.0, GY, z2 - 1.4, 0.32, 0.88, { ink: INK.BLACK, seg: 10 });
    cyl(x1 + 1.0, GY, z2 - 1.4, 0.32, 0.88, { ink: INK.BLACK, seg: 10 });
    // 洗手池一排
    box(x1 + 1.0, GY, KZ + 1.0, 0.6, 0.9, 4.0, { ink: INK.BLUE });

    // ==============================================================
    //  二楼：吃饭区 + 杂物间
    // ==============================================================
    // 二楼楼板只铺在【大厅上方】（z 从 KZ+0.5 起），后厨上方留通高：
    // 一是后厨本来就要高（蒸箱 1.7m + 挂架），二是取餐口招牌带顶到 GY+2.94，
    // 铺满整个平面的话招牌带会直接插进楼板里。
    const z2b = KZ + 0.5;                  // 二楼地板北边缘
    // 楼梯洞（西侧贴墙，从一楼爬上来）。宽 2m、往西贴到 x1+0.5，
    // 是因为一楼第一列餐桌从 x1+3.0 开始（桌面 4.4 宽），再宽就顶到桌子了。
    const hx1 = x1 + 0.5, hx2 = x1 + 2.5;
    const hz1 = z1 + 8.8;
    // 洞长必须等于楼梯的水平长度（级数 × 踏步深），否则楼梯会穿进楼板里。
    // 20 级：rise = (3.55+0.02)/20 = 0.179，正好是学校楼梯的正常踏步高。
    const STEPS2 = 20;
    const RUN2 = 0.28;
    const hz2 = hz1 + STEPS2 * RUN2;        // 10.8 → 16.4
    // 楼板分 4 块，把楼梯洞让出来
    slab(x1, z2b, x2, hz1, y2, 0.26);
    slab(x1, hz2, x2, z2, y2, 0.26);
    slab(x1, hz1, hx1, hz2, y2, 0.26);
    slab(hx2, hz1, x2, hz2, y2, 0.26);
    // 一楼到二楼的楼梯（20 级，正好爬到 CANTEEN_Y2 = 3.55）
    stairs(hx1 + (hx2 - hx1) / 2, GY, hz1, '+z', STEPS2, hx2 - hx1, {
      run: RUN2, rise: (y2 - GY) / STEPS2,
    });
    // 楼梯井护栏：东侧一整条 + 北端一条（南端是出口，不能挡）
    rail(hx2, hz1, hx2, hz2, y2, { ink: INK.BLACK, bars: 0.5, mid: true });
    rail(x1, hz1, hx2, hz1, y2, { ink: INK.BLACK, bars: 0.5, mid: true });
    // 二楼北边缘（能俯瞰一楼后厨那侧）的护栏，铺到杂物间西墙为止
    rail(x1, z2b, x2 - 10.0, z2b, y2, { ink: INK.BLACK, bars: 0.55, mid: true });

    // 二楼吃饭区：3 列 × 2 排长条桌（比一楼矮一点、桌距更松，读得出是"楼上雅座"）
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 2; j++) {
        const tx = x1 + 8.0 + i * 7.0, tz = z1 + 17.0 + j * 7.0;
        const TW = 4.0, TD = 0.95;
        box(tx, y2 + 0.70, tz, TW, 0.07, TD, { noCollide: true, ink: INK.ORANGE });
        box(tx, y2 + 0.77, tz - TD / 2 + 0.02, TW, 0.03, 0.04, { noCollide: true, ink: INK.BLACK });
        box(tx, y2 + 0.77, tz + TD / 2 - 0.02, TW, 0.03, 0.04, { noCollide: true, ink: INK.BLACK });
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            box(tx + sx * (TW / 2 - 0.3), y2, tz + sz * 0.34, 0.08, 0.70, 0.08, { noCollide: true, ink: INK.BLACK });
          }
        }
        box(tx, y2 + 0.22, tz, TW - 0.7, 0.06, 0.06, { noCollide: true, ink: INK.BLACK });
        for (const sz of [-1, 1]) {
          for (let c = 0; c < 2; c++) {
            const chx = tx - 1.05 + c * 2.1;
            const chz = tz + sz * 0.88;
            box(chx, y2 + 0.42, chz, 0.5, 0.08, 0.48, { noCollide: true, ink: INK.ORANGE });
            box(chx, y2 + 0.5, chz + sz * 0.265, 0.5, 0.44, 0.07, { noCollide: true, ink: INK.ORANGE });
            for (const lx of [-1, 1]) {
              for (const lz of [-1, 1]) {
                box(chx + lx * 0.19, y2, chz + lz * 0.19, 0.05, 0.42, 0.05, { noCollide: true, ink: INK.BLACK });
              }
            }
          }
        }
      }
    }
    // 二楼吸顶灯（挂屋顶下沿）
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 2; j++) {
        const lx = x1 + 6.0 + i * 5.6, lz = z1 + 15.0 + j * 9.0;
        box(lx, GY + h - 0.1, lz, 1.1, 0.08, 1.1, { noCollide: true, ink: INK.BLACK });
        box(lx, GY + h - 0.16, lz, 0.85, 0.06, 0.85, { noCollide: true, ink: INK.ORANGE, fill: true });
      }
    }

    // ---- 杂物间（东北角 10 × 7.5，堆旧桌椅的地方）----
    // 高度按"从二楼地面砌到屋顶"算（GY+h - y2 = 2.68），矮了会在顶上留一条缝
    const ST = { x1: x2 - 10.0, x2: x2 - 0.2, z1: z2b, z2: z2b + 7.5 };
    const STH2 = (GY + h) - y2;
    // 北墙（贴着二楼楼板北边缘 —— 没有这面墙，屋里直接对着后厨的通高空间）
    wallX(ST.x1, ST.x2, ST.z1, y2, STH2, 0.2);
    // 西隔墙（留一个门洞，门往里开着）
    wallZ(ST.z1, ST.z2, ST.x1, y2, STH2, 0.2, [[ST.z1 + 3.0, ST.z1 + 4.3, 0, 2.0]]);
    // 南隔墙
    wallX(ST.x1, ST.x2, ST.z2, y2, STH2, 0.2);
    // 门框
    box(ST.x1, y2, ST.z1 + 3.0, 0.2, 2.1, 0.12, { noCollide: true, ink: INK.BLACK });
    box(ST.x1, y2, ST.z1 + 4.3, 0.2, 2.1, 0.12, { noCollide: true, ink: INK.BLACK });
    box(ST.x1, y2 + 2.0, ST.z1 + 3.65, 0.2, 0.12, 1.4, { noCollide: true, ink: INK.BLACK });
    // 门扇：贴着大厅侧墙面、放在门洞【南边】，读成"门被推到 90° 靠在墙上"。
    // 试过两种都失败了：
    //   ① 平贴墙面但和门洞重叠 —— 门板堵在门洞里，看着像墙被砌死了；
    //   ② 垂直于墙面往大厅伸出去 —— 门板正好跟视线平行，从大厅正对门洞
    //      只能看到一条 5cm 的边，等于没有门。
    // 平行墙面、整体挪到门洞旁边，才是从正面一眼能认出来的"开着的门"。
    box(ST.x1 - 0.135, y2, ST.z1 + 4.95, 0.05, 2.0, 1.3, { noCollide: true, ink: INK.BLACK });
    // 门把手（装在门扇北端、靠门洞那一侧，朝大厅）
    box(ST.x1 - 0.19, y2 + 1.02, ST.z1 + 4.45, 0.06, 0.06, 0.22, { noCollide: true, ink: INK.BLACK });
    // 杂物间门牌 —— 贴在大厅侧门楣上（原来放在 y2+2.2，离门楣还有 8cm，
    // 远看是一块悬空的红方块；压到 2.06 才像是钉在门楣上的牌子）
    box(ST.x1 - 0.12, y2 + 2.06, ST.z1 + 3.65, 0.05, 0.32, 0.96, { noCollide: true, ink: INK.RED, fill: true });
    // 杂物间吊灯（一盏光秃秃的灯管，房间亮一点才看得清那把椅子）
    box(ST.x1 + 4.6, GY + h - 0.1, ST.z1 + 4.0, 1.3, 0.07, 0.16, { noCollide: true, ink: INK.BLACK });
    box(ST.x1 + 4.6, GY + h - 0.15, ST.z1 + 4.0, 1.1, 0.05, 0.12, { noCollide: true, ink: INK.ORANGE, fill: true });
    // 屋里堆的旧课桌（三张叠在一起）
    for (let k = 0; k < 3; k++) {
      const dx = ST.x1 + 2.0, dz = ST.z2 - 1.6;
      box(dx, y2 + k * 0.78, dz, 1.3, 0.06, 0.62, { noCollide: true, ink: INK.ORANGE });
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          box(dx + sx * 0.55, y2 + k * 0.78, dz + sz * 0.24, 0.05, 0.72, 0.05, { noCollide: true, ink: INK.BLACK });
        }
      }
    }
    // 靠墙再立两张叠起来的旧课桌（侧着放，看得出是"堆不下的东西"）
    for (let k = 0; k < 2; k++) {
      box(ST.x1 + 4.6, y2 + k * 0.9, ST.z2 - 1.2, 0.06, 0.62, 1.3, { noCollide: true, ink: INK.ORANGE });
      box(ST.x1 + 4.6, y2 + k * 0.9, ST.z2 - 1.2, 0.72, 0.06, 1.3, { noCollide: true, ink: INK.ORANGE });
    }
    // 一摞旧椅子（四把扣在一起 —— 大厅那些是焊死的，这些是坏的，但不能用）
    for (let k = 0; k < 4; k++) {
      const sy = y2 + k * 0.12;
      box(ST.x1 + 7.2, sy, ST.z2 - 1.4, 0.46, 0.06, 0.44, { noCollide: true, ink: INK.BLACK });
      box(ST.x1 + 7.2, sy + 0.06, ST.z2 - 1.62, 0.46, 0.4, 0.06, { noCollide: true, ink: INK.BLACK });
    }
    // 纸箱堆
    for (const [bx, bz, bs] of [
      [ST.x1 + 1.0, ST.z1 + 1.2, 0.72], [ST.x1 + 1.9, ST.z1 + 1.0, 0.56],
      [ST.x1 + 1.4, ST.z1 + 2.1, 0.64], [ST.x1 + 4.6, ST.z1 + 1.1, 0.66],
      [ST.x1 + 3.4, ST.z1 + 0.9, 0.5], [ST.x1 + 3.0, ST.z1 + 2.4, 0.58],
    ]) {
      box(bx, y2, bz, bs, bs * 0.8, bs, { noCollide: true, ink: INK.ORANGE });
      box(bx, y2 + bs * 0.4, bz, bs * 1.02, 0.03, bs * 1.02, { noCollide: true, ink: INK.BLACK });
    }
    // 拖把桶 + 拖把、扫帚
    cyl(ST.x1 + 8.4, y2, ST.z1 + 1.2, 0.26, 0.5, { ink: INK.BLUE, seg: 10 });
    box(ST.x1 + 8.4, y2 + 0.5, ST.z1 + 1.2, 0.06, 1.3, 0.06, { noCollide: true, ink: INK.BLACK });
    box(ST.x1 + 7.6, y2, ST.z1 + 0.6, 0.06, 1.2, 0.06, { noCollide: true, ink: INK.BLACK });
    box(ST.x1 + 7.6, y2, ST.z1 + 0.6, 0.34, 0.06, 0.1, { noCollide: true, ink: INK.ORANGE });
    // 墙角一摞废纸
    for (let k = 0; k < 5; k++) {
      box(ST.x1 + 5.6, y2 + k * 0.05, ST.z2 - 1.0, 0.7, 0.045, 0.5, { noCollide: true, ink: INK.BLACK });
    }
    // 西墙（进门那面）上的挂钩 + 挂着的两块抹布 —— 必须贴墙，不能悬在半空。
    // 【坑】原来横杆放在 ST.z1 + 3.2、长 1.8（跨 z 2.3~4.1），正好横穿
    // 门洞（z 3.0~4.3），一块绿抹布还挂在门洞正中 —— 截图里就是"门口
    // 横着一根杆 + 门中间浮着一块绿方块"。整组挪到门洞南侧、且让开门扇
    // （门扇占 z 4.36~5.60）之后的实墙上。
    box(ST.x1 + 0.06, y2 + 1.55, ST.z1 + 6.4, 0.05, 0.05, 1.3, { noCollide: true, ink: INK.BLACK });
    box(ST.x1 + 0.09, y2 + 1.05, ST.z1 + 6.05, 0.04, 0.5, 0.42, { noCollide: true, ink: INK.BLUE });
    box(ST.x1 + 0.09, y2 + 1.15, ST.z1 + 6.85, 0.04, 0.4, 0.36, { noCollide: true, ink: INK.GREEN });

    // 门口红底招牌"食堂"
    box(x2 + 0.12, GY + 3.0, 16.0, 0.1, 1.1, 5.4, { noCollide: true, ink: INK.RED, fill: true });
    // 门口台阶：室内外无高差（tiledFloor 是 noCollide），改成一阶贴地门槛条
    box(x2, GY, 16.0, 0.34, 0.05, 6.0, { noCollide: true, ink: INK.BLACK });
  }

  // ================================================================
  //  小卖部（放大到 20 × 12，3 排货架）
  // ================================================================
  {
    const { x1, x2, z1, z2, h } = SHOP;
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
    const w = x2 - x1, d = z2 - z1;
    // 室内地面
    tiledFloor(x1 - 0.2, z1 - 0.2, x2 + 0.2, z2 + 0.2, GY + 0.05, { step: 1.8 });
    wallX(x1, x2, z2, GY, h, 0.32, [[cx - 1.6, cx + 1.6, 0, 2.4]]);   // 南墙：门洞
    wallX(x1, x2, z1, GY, h, 0.32, [[x1 + 3.0, x1 + 6.0, 1.3, 2.7], [x2 - 6.0, x2 - 3.0, 1.3, 2.7]]);
    wallZ(z1, z2, x1, GY, h, 0.32);
    wallZ(z1, z2, x2, GY, h, 0.32, [[cz - 1.6, cz + 1.6, 1.2, 2.6]]);
    // 坑：南墙那个是【门洞】，不能在上面画窗框（原来 winFrame 正好挂在门口中间）
    winFrame(cz, GY + 1.2, 1.4, x2 - 0.18, 3.2, 'z');
    for (const [a, b] of [[x1 + 3.0, x1 + 6.0], [x2 - 6.0, x2 - 3.0]]) {
      winFrame((a + b) / 2, GY + 1.3, 1.4, z1 + 0.18, b - a, 'x');
    }
    box(cx, GY + h, cz, w + 0.8, 0.3, d + 0.8, { ink: INK.BLACK });
    // 货架 3 排 × 3 层
    for (let r = 0; r < 3; r++) {
      const sz = z1 + 2.6 + r * 3.2;
      box(cx - 0.6, GY, sz, 9.0, 2.0, 0.62, { ink: INK.BLUE });
      for (let k = 0; k < 3; k++) {
        box(cx - 0.6, GY + 0.52 + k * 0.62, sz, 9.2, 0.06, 0.72, { noCollide: true, ink: INK.ORANGE });
        for (let b = 0; b < 12; b++) {
          const bx = cx - 5.0 + b * 0.82;
          box(bx, GY + 0.58 + k * 0.62, sz, 0.36, 0.36, 0.36, {
            noCollide: true,
            ink: [INK.RED, INK.GREEN, INK.PINK, INK.BLUE][(b + k + r) % 4],
            fill: true,
          });
        }
      }
    }
    // 柜台 + 收银台
    box(x2 - 1.5, GY, cz, 1.8, 1.0, 5.0, { ink: INK.BLUE });
    box(x2 - 1.5, GY + 1.0, cz + 1.8, 1.5, 0.12, 1.0, { noCollide: true, ink: INK.BLACK });
    box(x2 - 1.5, GY + 1.0, cz - 1.8, 1.5, 0.12, 1.0, { noCollide: true, ink: INK.BLACK });
    // 门口招牌
    box(cx, GY + 2.8, z2 + 0.22, 5.0, 0.8, 0.08, { noCollide: true, ink: INK.ORANGE, fill: true });
    // 门口三台冰柜
    box(x1 + 1.6, GY, z2 - 1.0, 1.5, 1.0, 0.86, { ink: INK.BLUE });
    box(x2 - 3.4, GY, z2 - 1.0, 1.5, 1.0, 0.86, { ink: INK.BLUE });
    box(cx, GY, z1 + 1.0, 1.5, 1.0, 0.86, { ink: INK.BLUE });
    // 门口台阶：无高差，改贴地门槛条
    box(cx, GY, z2, 4.0, 0.05, 0.34, { noCollide: true, ink: INK.BLACK });
  }

  // ================================================================
  //  花圃 ×2（基座抬高，里面不种树，铺一片绿圆柱当草）
  // ================================================================
  for (const b of BEDS) {
    const cx = (b.x1 + b.x2) / 2, cz = (b.z1 + b.z2) / 2;
    const w = b.x2 - b.x1, d = b.z2 - b.z1;
    const BASE = 0.62;      // 基座高度（抬起来，不再是薄薄一圈砖）
    // 四面砖砌基座
    box(cx, GY, b.z1 + 0.18, w, BASE, 0.36, { ink: INK.ORANGE });
    box(cx, GY, b.z2 - 0.18, w, BASE, 0.36, { ink: INK.ORANGE });
    box(b.x1 + 0.18, GY, cz, 0.36, BASE, d - 0.72, { ink: INK.ORANGE });
    box(b.x2 - 0.18, GY, cz, 0.36, BASE, d - 0.72, { ink: INK.ORANGE });
    // 基座压顶（一圈出檐）
    box(cx, GY + BASE, b.z1 + 0.18, w + 0.1, 0.1, 0.48, { noCollide: true, ink: INK.BLACK });
    box(cx, GY + BASE, b.z2 - 0.18, w + 0.1, 0.1, 0.48, { noCollide: true, ink: INK.BLACK });
    box(b.x1 + 0.18, GY + BASE, cz, 0.48, 0.1, d - 0.72, { noCollide: true, ink: INK.BLACK });
    box(b.x2 - 0.18, GY + BASE, cz, 0.48, 0.1, d - 0.72, { noCollide: true, ink: INK.BLACK });
    // 里面填土（比基座顶低一点）
    box(cx, GY + BASE - 0.16, cz, w - 0.8, 0.16, d - 0.8, { noCollide: true, ink: INK.BLACK });
    // 土面上一片绿圆柱当草（矮、密、贴地，不能挡住基座）
    const gx0 = b.x1 + 0.9, gx1 = b.x2 - 0.9, gz0 = b.z1 + 0.9, gz1 = b.z2 - 0.9;
    let gi = 0;
    for (let gx = gx0; gx <= gx1; gx += 0.62) {
      for (let gz = gz0; gz <= gz1; gz += 0.62) {
        gi++;
        const k = (gi * 37) % 11;                 // 确定性伪随机
        const jx = gx + ((k % 3) - 1) * 0.14;
        const jz = gz + (((k >> 1) % 3) - 1) * 0.14;
        const r = 0.1 + (k % 3) * 0.035;
        const hh = 0.14 + ((k * 7) % 4) * 0.06;   // 草很矮，只到 0.14~0.32
        cyl(jx, GY + BASE - 0.14, jz, r, hh, { ink: INK.GREEN, seg: 6, noCollide: true });
        if (k % 7 === 0) {                        // 偶尔一小丛高一点的
          cyl(jx + 0.1, GY + BASE - 0.14, jz - 0.08, r * 0.85, hh + 0.14, { ink: INK.GREEN, seg: 6, noCollide: true });
        }
      }
    }
    // 基座上插一块"爱护花草"的小牌子
    box(b.x1 + 1.2, GY + BASE, b.z2 - 0.4, 0.5, 0.6, 0.05, { noCollide: true, ink: INK.RED, fill: true });
    box(b.x1 + 1.2, GY + BASE + 0.6, b.z2 - 0.4, 0.06, 0.6, 0.06, { noCollide: true, ink: INK.BLACK });
  }

  // ================================================================
  //  过渡区：教学楼 ↔ 操场（篮球场台地 + 台阶 + 乒乓球台 + 小树林）
  // ================================================================
  {
    const { x1, x2, z1, z2, y } = COURT;
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
    // 台地（抬高 0.2m）
    box(cx, GY, cz, x2 - x1, y, z2 - z1, { ink: INK.BLUE, fill: true });
    box(cx, GY + y, cz, x2 - x1 + 0.3, 0.06, z2 - z1 + 0.3, { noCollide: true, ink: INK.BLACK });
    // ---- 场地标线（v0.15：按 FIBA 尺寸画全套，不再只有一圈边线 + 中圈）----
    // 【上一版一条线都没露出来的原因】台面那层黑色贴板厚 0.06（顶面 = GY+y+0.06），
    // 而标线取 ly = GY+y+0.02 = 0.20，整片埋在贴板内部 —— 画面上看到的"边线"
    // 其实只是贴板自己的外轮廓。所以现在把线抬到贴板之上（+0.065）。
    // 尺寸说明：真实球场 28×15，这块台地 20×15，长边短了 8m。
    // 横向（z，净宽 13.8）保持真实比例，三分线 / 罚球圈的半径都不用改；
    // 纵向（x）只缩"到底线的距离"，所以限制区深度取 5.8 不变、靠中线自然更挤。
    const LW = 0.12;
    const ly = GY + y + 0.065;              // 黑色台面顶面 = GY+y+0.06
    const bx1 = x1 + 0.6, bx2 = x2 - 0.6;   // 端线（底线）
    const bz1 = z1 + 0.6, bz2 = z2 - 0.6;   // 边线
    const ccz = (bz1 + bz2) / 2;            // 场地中线
    const hw = (bz2 - bz1) / 2;             // 半宽 6.9
    // 端线 / 边线
    box((bx1 + bx2) / 2, ly, bz1, bx2 - bx1, 0.03, LW, { noCollide: true, ink: INK.BLACK });
    box((bx1 + bx2) / 2, ly, bz2, bx2 - bx1, 0.03, LW, { noCollide: true, ink: INK.BLACK });
    box(bx1, ly, ccz, LW, 0.03, bz2 - bz1, { noCollide: true, ink: INK.BLACK });
    box(bx2, ly, ccz, LW, 0.03, bz2 - bz1, { noCollide: true, ink: INK.BLACK });
    // 中线 + 中圈（半径 1.8）
    box(cx, ly, ccz, LW, 0.03, bz2 - bz1, { noCollide: true, ink: INK.BLACK });
    arcLine(cx, ccz, 1.8, 0, Math.PI * 2, ly, LW, { seg: 56 });
    // 两个半场：限制区（4.9 宽 × 5.8 深）+ 罚球圈（1.8）+ 三分线（6.75）
    for (const side of [-1, 1]) {
      const base = side < 0 ? bx1 : bx2;              // 这一侧的底线
      const dir = side < 0 ? 1 : -1;                  // 朝场内
      // 篮筐圆心：篮架立柱在 x1+1.0 / x2-1.0，篮板探出 1.2，筐再探 0.25
      const hoopX = side < 0 ? x1 + 1.0 + 1.45 : x2 - 1.0 - 1.45;
      const lz = 2.45;                                // 限制区半宽（FIBA 4.9）
      const ftX = base + dir * 5.8;                   // 罚球线
      // 限制区两条边线 + 罚球线
      box((base + ftX) / 2, ly, ccz - lz, Math.abs(ftX - base), 0.03, LW, { noCollide: true, ink: INK.BLACK });
      box((base + ftX) / 2, ly, ccz + lz, Math.abs(ftX - base), 0.03, LW, { noCollide: true, ink: INK.BLACK });
      box(ftX, ly, ccz, LW, 0.03, lz * 2, { noCollide: true, ink: INK.BLACK });
      // 罚球圈：朝中场那半边实线，朝篮下那半边虚线（FIBA 规则）
      const midA = dir > 0 ? 0 : Math.PI;
      arcLine(ftX, ccz, 1.8, midA - Math.PI / 2, midA + Math.PI / 2, ly, LW, { seg: 28 });
      arcLine(ftX, ccz, 1.8, midA + Math.PI / 2, midA + Math.PI * 1.5, ly, LW, { seg: 28, dash: true });
      // 抢篮板球分位线：限制区两侧各 3 道短横线
      for (let k = 0; k < 3; k++) {
        const sx = base + dir * (1.2 + k * 0.85);
        for (const s of [-1, 1]) {
          box(sx, ly, ccz + s * (lz + 0.28), 0.05, 0.03, 0.56, { noCollide: true, ink: INK.BLACK });
        }
      }
      // 三分线：两侧直线段（离边线 0.9）+ 以篮筐为心的 6.75 圆弧
      const c3 = 6.75;
      const sz = hw - 0.9;                             // 直线段到中线的距离
      const a3 = Math.asin(Math.min(1, sz / c3));      // 直线与圆弧交点角度
      const ex = hoopX + Math.cos(a3) * c3 * dir;      // 交点 x
      for (const s of [-1, 1]) {
        box((base + ex) / 2, ly, ccz + s * sz, Math.abs(ex - base), 0.03, LW, { noCollide: true, ink: INK.BLACK });
      }
      const a0 = dir > 0 ? -a3 : Math.PI - a3;
      const a1 = dir > 0 ? a3 : Math.PI + a3;
      arcLine(hoopX, ccz, c3, a0, a1, ly, LW, { seg: 64 });
    }
    // 两个篮球架（东西两端）
    for (const side of [-1, 1]) {
      const bx = side < 0 ? x1 + 1.0 : x2 - 1.0;
      const dir = side < 0 ? 1 : -1;
      box(bx, GY + y, cz, 0.6, 0.4, 1.4, { ink: INK.BLACK });
      box(bx, GY + y + 0.4, cz, 0.2, 3.0, 0.2, { ink: INK.BLACK });
      box(bx + dir * 0.6, GY + y + 3.2, cz, 0.14, 0.12, 0.14, { noCollide: true, ink: INK.BLACK });
      box(bx + dir * 1.2, GY + y + 2.8, cz, 0.09, 1.15, 1.95, { noCollide: true, ink: INK.BLUE });
      cyl(bx + dir * 1.45, GY + y + 2.86, cz, 0.26, 0.07, { noCollide: true, ink: INK.RED, seg: 12 });
    }
    // 台地西侧 / 北侧各一组台阶（3 级）
    stairs(x1 - 1.02, GY, cz, '+x', 3, 8.0, { run: 0.34, rise: 0.07 });
    stairs(cx, GY, z1 - 1.02, '+z', 3, 8.0, { run: 0.34, rise: 0.07 });

    // 乒乓球台 ×4（篮球场南边）
    for (let i = 0; i < 4; i++) {
      const tx = 35.5 + i * 5.0, tz = 30.0;
      box(tx, GY, tz, 2.6, 0.72, 1.5, { ink: INK.BLUE });
      box(tx, GY + 0.72, tz, 2.7, 0.06, 1.55, { noCollide: true, ink: INK.GREEN });
      box(tx, GY + 0.78, tz, 0.05, 0.24, 1.6, { noCollide: true, ink: INK.BLACK });   // 球网
      for (const s of [-1, 1]) {
        box(tx + s * 1.7, GY, tz, 0.1, 0.7, 0.1, { noCollide: true, ink: INK.BLACK });
      }
    }
    // 过渡区南侧不再种树（按图七，树全部挪到操场西侧去了）
    // 过渡区与操场之间的引导栏杆（留两个口子）
    rail(54.6, 4.0, 54.6, 22.0, GY, { ink: INK.BLACK, bars: 1.4, mid: true });
    rail(54.6, 30.0, 54.6, 54.0, GY, { ink: INK.BLACK, bars: 1.4, mid: true });
  }

  // ================================================================
  //  跳远场地（操场北侧那片空地：和东南角的器材室正好隔着一整个操场）
  //  按用户要求，操场上和篮球场里的树已经全部移除，这块地改成助跑道 + 沙坑
  // ================================================================
  {
    const JX = 78.0;                    // 场地中线，对着操场中线
    const RUN_W = 1.32;                 // 助跑道宽（标准 1.22，这里略放宽好走）
    const RUN_Z1 = WALL.z1 + 1.2;       // 助跑道北端（离北墙 1.2m）
    const BOARD_Z = -4.9;               // 起跳板
    const PIT_Z1 = -4.55;               // 沙坑北沿（紧接起跳板）
    const PIT_Z2 = 1.6;                 // 沙坑南沿（贴操场北边）
    const PIT_W = 3.0;                  // 沙坑宽
    const runLen = BOARD_Z - RUN_Z1;
    const runC = (RUN_Z1 + BOARD_Z) / 2;

    // 助跑道（红色塑胶）+ 两条白边线
    box(JX, PY - 0.1, runC, RUN_W, 0.1, runLen, { ink: INK.RED, fill: true });
    for (const s of [-1, 1]) {
      box(JX + s * (RUN_W / 2 + 0.07), PY - 0.07, runC, 0.09, 0.03, runLen,
        { ink: INK.BLACK, noCollide: true });
    }
    // 起点线（白）+ 起跳板（黑）+ 橡皮泥显示板（红）
    box(JX, PY - 0.07, RUN_Z1 + 0.4, RUN_W, 0.03, 0.12, { ink: INK.BLACK, noCollide: true });
    box(JX, PY - 0.03, BOARD_Z, RUN_W, 0.05, 0.28, { ink: INK.BLACK, fill: true });
    box(JX, PY - 0.01, BOARD_Z - 0.28, RUN_W, 0.04, 0.16, { ink: INK.RED, noCollide: true });

    // 沙坑：四周砖沿（高 0.16）+ 中间沙面。
    // 不做"真挖坑"——地面是 school.js 那块实心大地，挖下去会被地面面片遮住；
    // 用一圈凸起的砖沿把沙面框住，读起来就是沙坑。
    const pitC = (PIT_Z1 + PIT_Z2) / 2;
    const pitD = PIT_Z2 - PIT_Z1;
    const RIM = 0.16, RIM_T = 0.16;
    box(JX, GY, PIT_Z1 + RIM_T / 2, PIT_W, RIM, RIM_T, { ink: INK.ORANGE });
    box(JX, GY, PIT_Z2 - RIM_T / 2, PIT_W, RIM, RIM_T, { ink: INK.ORANGE });
    for (const s of [-1, 1]) {
      box(JX + s * (PIT_W / 2 - RIM_T / 2), GY, pitC, RIM_T, RIM, pitD, { ink: INK.ORANGE });
    }
    // 沙面（铺实色，比地面高 2cm —— 墨线渲染靠深度分层，贴太近会闪白）
    box(JX, PY - 0.02, pitC, PIT_W - RIM_T * 2, 0.04, pitD - RIM_T * 2,
      { ink: INK.ORANGE, fill: true, noCollide: true });

    // 场边立一块"跳远区"小牌
    const sgx = JX + PIT_W / 2 + 0.9, sgz = PIT_Z2 - 0.7;
    box(sgx, GY, sgz, 0.08, 1.1, 0.08, { ink: INK.BLACK });
    box(sgx, GY + 1.1, sgz, 0.9, 0.5, 0.05, { ink: INK.RED, fill: true, noCollide: true });
  }

  // ================================================================
  //  操场（跑道 + 草坪 + 看台 + 旗杆）
  // ================================================================
  {
    const { x1, x2, z1, z2 } = FIELD;
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
    const w = x2 - x1, d = z2 - z1;
    // 红色跑道整块铺（中间再盖草坪，自然成环）
    // 注意每层顶面必须拉开 2cm 以上，否则墨线渲染的深度图分不开，会闪白
    box(cx, PY - 0.1, cz, w, 0.1, d, { ink: INK.RED, fill: true });
    // 跑道内沿白线
    const inx1 = x1 + 7, inx2 = x2 - 7, inz1 = z1 + 7, inz2 = z2 - 7;
    const LW = 0.14;
    const lines = [
      [cx, inz1, inx2 - inx1, LW], [cx, inz2, inx2 - inx1, LW],
      [inx1, cz, LW, inz2 - inz1], [inx2, cz, LW, inz2 - inz1],
    ];
    for (const [lx, lz, lw, ld] of lines) box(lx, PY - 0.01, lz, lw, 0.03, ld, { ink: INK.BLACK, noCollide: true });
    // 分道线 ×3
    for (const off of [2.4, 4.8, 7.2]) {
      const mx1 = x1 + off, mx2 = x2 - off, mz1 = z1 + off, mz2 = z2 - off;
      box(cx, PY - 0.01, mz1, mx2 - mx1, 0.03, LW, { ink: INK.BLACK, noCollide: true });
      box(cx, PY - 0.01, mz2, mx2 - mx1, 0.03, LW, { ink: INK.BLACK, noCollide: true });
      box(mx1, PY - 0.01, cz, LW, 0.03, mz2 - mz1, { ink: INK.BLACK, noCollide: true });
      box(mx2, PY - 0.01, cz, LW, 0.03, mz2 - mz1, { ink: INK.BLACK, noCollide: true });
    }
    // 内场草坪：铺实色（不然整块留白，看不出是草坪；跑道是红的，对比也够）
    box(cx, PY - 0.01, cz, inx2 - inx1, 0.04, inz2 - inz1, { ink: INK.GREEN, fill: true, noCollide: true });
    // 中圈：黑圈只描边 + 绿盘实色盖内圈，净效果是一圈黑线
    cyl(cx, PY + 0.03, cz, 3.6, 0.03, { ink: INK.BLACK, noCollide: true, seg: 24 });
    cyl(cx, PY + 0.04, cz, 3.42, 0.03, { ink: INK.GREEN, noCollide: true, seg: 24, fill: true });
    // 足球门 ×2（内场南北）
    for (const s of [-1, 1]) {
      const gz = s < 0 ? inz1 + 0.6 : inz2 - 0.6;
      box(cx, GY, gz, 6.4, 0.12, 0.12, { noCollide: true, ink: INK.BLACK });
      for (const s2 of [-1, 1]) box(cx + s2 * 3.2, GY, gz, 0.12, 2.1, 0.12, { noCollide: true, ink: INK.BLACK });
      box(cx, GY + 2.1, gz, 6.4, 0.12, 0.12, { noCollide: true, ink: INK.BLACK });
    }
    // 篮球架 ×2（内场东西）
    for (const side of [-1, 1]) {
      const bx = side < 0 ? inx1 + 1.4 : inx2 - 1.4;
      const dir = side < 0 ? 1 : -1;
      box(bx, GY, cz, 0.55, 0.4, 1.3, { ink: INK.BLACK });
      box(bx, GY + 0.4, cz, 0.2, 3.1, 0.2, { ink: INK.BLACK });
      box(bx + dir * 0.58, GY + 3.3, cz, 0.13, 0.11, 0.13, { noCollide: true, ink: INK.BLACK });
      box(bx + dir * 1.15, GY + 2.9, cz, 0.08, 1.15, 1.95, { noCollide: true, ink: INK.BLUE });
      cyl(bx + dir * 1.4, GY + 2.96, cz, 0.26, 0.07, { noCollide: true, ink: INK.RED, seg: 12 });
    }
    // 看台（操场南侧，5 级，带顶棚）
    for (let i = 0; i < 5; i++) {
      box(74, GY + i * 0.46, z2 + 1.2 + i * 1.7, 34, 0.46, 1.7, { ink: INK.BLUE });
    }
    for (const px of [58, 74, 90]) {
      box(px, GY + 2.3, z2 + 9.4, 0.36, 4.6, 0.36, { ink: INK.BLACK });
    }
    box(74, GY + 6.9, z2 + 9.4, 34, 0.26, 4.2, { ink: INK.BLACK });
    // 看台两端的上台台阶
    // 坑：原来写 stairs(56.0, GY, z2+3.0, '+x', 5, 3.0, {run:0.36, rise:0.46})
    // —— 沿 +x 爬升，可看台是沿 +z 一级级升高的，台阶方向整个错了，
    // 结果是一段斜着横插进看台、哪一级都对不上的悬空梯。
    // 现在放在看台两端外侧，沿 +z 爬，run/rise 与看台每一级严格对齐：
    // 看台第 i 级中心 z = z2+1.2+i*1.7、顶面 = GY+(i+1)*0.46；
    // stairs 第 i 级中心 z = startZ+(i+0.5)*run，故 startZ = z2+1.2-0.85 = z2+0.35。
    for (const sx of [1, -1]) {
      const baseX = sx > 0 ? 55.4 : 92.6;
      stairs(baseX, GY, z2 + 0.35, '+z', 5, 2.2, { run: 1.7, rise: 0.46 });
    }
    // 操场旗杆
    cyl(x1 + 2.2, GY, z1 + 2.2, 0.1, 9.0, { ink: INK.BLACK, seg: 8 });
    box(x1 + 2.2, GY + 8.1, z1 + 3.0, 0.05, 1.4, 1.8, { noCollide: true, ink: INK.RED, fill: true });
  }

  // ================================================================
  //  器材室（体育器材 + 杂物，钳子藏在某一堆里，得自己翻）
  //  图纸原注是"在这里拿钳子钻洞"，但一进门就摆在桌上太便宜了 ——
  //  改成：屋里一堆可以翻的地方，钳子随机藏在其中一个，翻错就白跑一趟。
  //
  //  翻找规则（v0.14）：
  //   · 每个容器按住 E 站定 2 秒才出结果，走开 / 松手就中断、进度清零
  //   · 每翻完一处，可疑度 +4%（"在器材室里翻箱倒柜"本身就会引人注意）
  //   · 翻错只有灰，翻对了才拿到钳子
  //  searchSpots 里每条：{ x, y, z, label, secs, heat }
  // ================================================================
  const searchSpots = [];
  // 统一登记：所有容器都走这个，保证耗时 / 可疑度 / 判定半径一致
  const addSpot = (x, z, label, secs = 2.0, heat = 4) => {
    searchSpots.push({ x, y: GY, z, label, secs, heat });
  };
  {
    const { x1, x2, z1, z2, h } = MON;
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
    const w = x2 - x1, d = z2 - z1;
    // 室内地面
    tiledFloor(x1 - 0.2, z1 - 0.2, x2 + 0.2, z2 + 0.2, GY + 0.05, { step: 1.6 });
    wallX(x1, x2, z1, GY, h, 0.3, [[cx - 1.4, cx + 1.4, 0, 2.3]]);   // 北墙开门
    wallX(x1, x2, z2, GY, h, 0.3);
    wallZ(z1, z2, x1, GY, h, 0.3);
    wallZ(z1, z2, x2, GY, h, 0.3, [[cz - 1.6, cz + 1.6, 1.1, 2.5]]);
    winFrame(cz, GY + 1.1, 1.4, x2 - 0.18, 3.0, 'z');
    box(cx, GY + h, cz, w + 0.6, 0.28, d + 0.6, { ink: INK.BLACK });
    // 天花板一根吊灯管（器材室光线差，只有一盏）
    box(cx, GY + h - 0.12, cz, 1.6, 0.07, 0.22, { noCollide: true, ink: INK.BLACK });
    box(cx, GY + h - 0.18, cz, 1.4, 0.05, 0.16, { noCollide: true, ink: INK.ORANGE, fill: true });

    // ---- 北侧：两排器材架（贴着东西墙），架子上堆箱子 ----
    for (const sx of [-1, 1]) {
      const ax = cx + sx * (w / 2 - 1.0);
      box(ax, GY, z1 + 2.0, 1.1, 2.0, 3.4, { ink: INK.BLUE });
      for (let k = 0; k < 3; k++) {
        box(ax, GY + 0.66 + k * 0.62, z1 + 2.0, 1.2, 0.06, 3.4, { noCollide: true, ink: INK.BLACK });
      }
      // 架子上的杂物箱
      for (let k = 0; k < 3; k++) {
        for (let m = 0; m < 2; m++) {
          const bs = 0.42 + ((k + m) % 2) * 0.1;
          box(ax, GY + 0.72 + k * 0.62, z1 + 1.0 + m * 1.6, 0.5, bs, bs, {
            noCollide: true, ink: (k + m) % 2 ? INK.ORANGE : INK.BLACK,
          });
        }
      }
    }

    // ---- 南墙：工作台（原来是操作台，现在摆工具 + 拆了一半的篮球架）----
    box(cx, GY, z2 - 1.35, 5.4, 0.82, 0.9, { ink: INK.BLUE });
    box(cx, GY + 0.82, z2 - 1.35, 5.6, 0.07, 1.0, { noCollide: true, ink: INK.BLACK });
    // 台面上的工具：扳手、螺丝刀盒、一卷胶布
    box(cx - 1.6, GY + 0.89, z2 - 1.3, 0.44, 0.05, 0.1, { noCollide: true, ink: INK.BLACK });
    box(cx - 0.4, GY + 0.89, z2 - 1.35, 0.5, 0.09, 0.26, { noCollide: true, ink: INK.ORANGE });
    cyl(cx + 0.9, GY + 0.89, z2 - 1.3, 0.11, 0.1, { noCollide: true, ink: INK.BLACK, seg: 8 });
    // 拆下来靠在墙上的篮球架篮板
    box(cx + 1.9, GY, z2 - 0.5, 1.8, 1.1, 0.08, { noCollide: true, ink: INK.BLUE });
    // 工作台下的三个抽屉（可以翻）
    for (let k = 0; k < 3; k++) {
      box(cx - 1.7 + k * 1.7, GY + 0.3, z2 - 0.86, 1.4, 0.34, 0.06, { noCollide: true, ink: INK.BLACK });
      addSpot(cx - 1.7 + k * 1.7, z2 - 1.1, '抽屉', 2.0, 4);
    }

    // ---- 体育器材：跳箱、体操垫、哑铃、一筐篮球 ----
    // 跳箱（五层，靠西墙）
    for (let k = 0; k < 5; k++) {
      const bw = 1.5 - k * 0.1;
      box(x1 + 1.6, GY + k * 0.32, cz + 0.6, bw, 0.32, bw * 0.9, { ink: INK.ORANGE });
    }
    // 体操垫（叠三层）
    for (let k = 0; k < 3; k++) {
      box(x1 + 4.4, GY + k * 0.16, cz + 1.6, 2.2, 0.15, 1.2, { noCollide: true, ink: INK.BLUE });
    }
    // 哑铃架 + 4 个哑铃
    box(x2 - 2.2, GY, cz + 0.4, 1.6, 0.5, 0.7, { ink: INK.BLACK });
    for (let k = 0; k < 4; k++) {
      cyl(x2 - 2.9 + k * 0.46, GY + 0.5, cz + 0.4, 0.11, 0.34, { noCollide: true, ink: INK.BLACK, seg: 8 });
    }
    // 一筐篮球（圆柱筐 + 5 个球）
    cyl(x2 - 4.6, GY, cz + 2.0, 0.62, 0.7, { ink: INK.ORANGE, seg: 12 });
    for (let k = 0; k < 5; k++) {
      cyl(x2 - 4.6 + ((k % 3) - 1) * 0.3, GY + 0.42 + (k > 2 ? 0.28 : 0), cz + 2.0 + (k > 3 ? 0.3 : 0),
        0.24, 0.24, { noCollide: true, ink: INK.ORANGE, seg: 10 });
    }
    // 墙角一摞纸箱（也可以翻）
    for (const [bx, bz, bs] of [
      [x1 + 1.2, z2 - 1.4, 0.78], [x1 + 2.2, z2 - 1.2, 0.62],
      [x1 + 1.4, z2 - 2.4, 0.7], [x1 + 2.4, z2 - 2.2, 0.56],
    ]) {
      box(bx, GY, bz, bs, bs * 0.85, bs, { noCollide: true, ink: INK.ORANGE });
      box(bx, GY + bs * 0.43, bz, bs * 1.02, 0.03, bs * 1.02, { noCollide: true, ink: INK.BLACK });
    }
    addSpot(x1 + 1.8, z2 - 1.9, '纸箱', 2.0, 4);
    // 器材架最下层（也可以翻）。判定点放在架子【前沿外侧】——
    // 架子本身占 z1+0.3~z1+3.7，点放 z1+2.0 会被架子包住，玩家站到跟前也够不到 1.9m 判定圈。
    addSpot(cx - (w / 2 - 1.0), z1 + 3.9, '器材架', 2.0, 4);
    addSpot(cx + (w / 2 - 1.0), z1 + 3.9, '器材架', 2.0, 4);
    // 灭火器
    cyl(x2 - 1.0, GY, z1 + 1.0, 0.2, 0.9, { ink: INK.RED, seg: 10 });

    // ---- 再多塞几处可以翻的地方（v0.14：容器越多，"找钳子"越像在翻箱倒柜）----
    // 注意：南墙工作台占了 x 101.3~106.7 / z 68.2~69.1，新加的容器都避开这块，
    // 否则会插进工作台里（贴图重叠、玩家也够不着）。
    // 拖把桶 + 水桶（东南角，最脏的地方，翻得慢、也最可疑）
    cyl(x2 - 1.3, GY, z2 - 1.2, 0.3, 0.56, { ink: INK.BLUE, seg: 10 });
    cyl(x2 - 1.3, GY + 0.56, z2 - 1.2, 0.05, 1.1, { noCollide: true, ink: INK.BLACK, seg: 6 });
    addSpot(x2 - 1.3, z2 - 1.2, '拖把桶', 2.4, 6);
    // 一摞旧体操垫（掀开垫子翻，费时间）
    for (let k = 0; k < 4; k++) {
      box(cx + 4.8, GY + k * 0.17, z2 - 1.5, 1.9, 0.16, 1.1, { noCollide: true, ink: k % 2 ? INK.BLUE : INK.ORANGE });
    }
    addSpot(cx + 4.8, z2 - 1.5, '旧垫子', 2.6, 5);
    // 靠墙的旧书包堆（学生落下的）
    for (let k = 0; k < 5; k++) {
      const bx = x1 + 3.2 + (k % 3) * 0.42, bz = z1 + 0.9 + Math.floor(k / 3) * 0.36;
      box(bx, GY + Math.floor(k / 3) * 0.28, bz, 0.38, 0.26, 0.3, { noCollide: true, ink: k % 2 ? INK.PINK : INK.BLUE });
    }
    addSpot(x1 + 3.4, z1 + 1.1, '旧书包', 2.0, 3);
    // 墙角的废纸篓
    cyl(x2 - 2.0, GY, z2 - 3.2, 0.26, 0.62, { ink: INK.BLACK, seg: 10 });
    addSpot(x2 - 2.0, z2 - 3.2, '废纸篓', 1.8, 3);
    // 挂墙的工具柜（打开柜门翻，最"正常"的一处，可疑度低）
    box(x2 - 0.22, GY + 1.2, cz - 1.9, 0.18, 1.0, 1.5, { ink: INK.BLUE });
    box(x2 - 0.3, GY + 1.2, cz - 1.9, 0.06, 0.92, 1.34, { noCollide: true, ink: INK.BLACK });
    addSpot(x2 - 0.9, cz - 1.9, '工具柜', 2.2, 2);
    // 门外"器材室"牌子
    box(cx, GY + 2.7, z1 - 0.22, 2.8, 0.55, 0.08, { noCollide: true, ink: INK.RED, fill: true });
    // 门口台阶：无高差，改贴地门槛条
    box(cx, GY, z1, 3.0, 0.05, 0.34, { noCollide: true, ink: INK.BLACK });
  }

  // ================================================================
  //  1F 架空连廊 + 小楼梯
  //  图纸："一楼连廊护栏空两个口子，然后做个小楼梯下去"
  // ================================================================
  {
    const { x1, x2, z1, z2, y } = LINK1;
    const lcx = (x1 + x2) / 2;
    const w = x2 - x1;
    slab(x1, z1 + 1.4, x2, z2, y, 0.3, { ink: INK.BLUE });
    // 主台阶：stairs() 的起点 (x,z) 是"台阶前沿中点"，width 是垂直于行进方向的尺寸。
    // 原来写 lcx - w/2 → 台阶横跨 x∈[19.25,23.75]，而平台是 x∈[21.5,26]，整体偏西 2.25m。
    stairs(lcx, GY, z1, '+z', 5, w, { run: 0.28, rise: 0.18 });
    rail(x1, z1 + 1.4, x1, 7.0, y, { ink: INK.BLACK, bars: 0.22, mid: true });
    rail(x1, 9.0, x1, z2, y, { ink: INK.BLACK, bars: 0.22, mid: true });
    rail(x2, z1 + 1.4, x2, 7.0, y, { ink: INK.BLACK, bars: 0.22, mid: true });
    rail(x2, 9.0, x2, z2, y, { ink: INK.BLACK, bars: 0.22, mid: true });
    stairs(x1 - 1.4, GY, 8.0, '+x', 5, 2.0, { run: 0.28, rise: 0.18 });
    stairs(x2 + 1.4, GY, 8.0, '-x', 5, 2.0, { run: 0.28, rise: 0.18 });
    for (const px of [x1, x2]) {
      for (const pz of [5.2, 11.4]) box(px, GY, pz, 0.34, y, 0.34, { ink: INK.BLACK });
    }
    box(lcx, y + 2.7, (z1 + z2) / 2 + 0.4, w + 0.8, 0.2, z2 - z1 - 0.4, { ink: INK.BLACK });
    for (const px of [x1, x2]) box(px, y + 0.9, z2 - 0.3, 0.16, 1.9, 0.16, { ink: INK.BLACK });
    box(lcx, y + 2.3, z2 - 0.5, w - 0.3, 0.5, 0.06, { noCollide: true, ink: INK.RED, fill: true });
  }

  // ================================================================
  //  后山跑酷（v0.18）
  //  ----------------------------------------------------------------
  //  一座三级台地的山，每级抬高 2.4m。玩家跳高只有 1.11m —— 正面上不去，
  //  只能走路线。路线绕着山走大半圈（"绕山半圈"）：
  //    东侧山脚 →（石墩×3）→ 一级台地 → 沿台地往南
  //    →（石柱×3）→ 半山腰 → 沿半山腰往西 → 往北绕到西北侧
  //    →（石柱×3）→ 一级台地 →（石柱×2）→ 山脚 → 出口的小吃街
  //  先上半山腰、再下山，落差都是 0.8m 一级（< 跳高 1.11，也 < 摔不死的 0.9）。
  //
  //  【台地不许铺实色】>20×10 的地面一 fill 就把整屏压塌（v0.4 的道路、
  //  v0.12 的草皮都栽在这上面）。这里改成白纸 + 墨线轮廓 + 侧面岩层横线
  //  + 顶面边缘一圈草线，远看是山、近看还是"纸上的山"。
  // ================================================================
  {
    const H1 = GY + 2.4, H2 = GY + 4.8, H3 = GY + 7.2;
    const T1 = { x1: -100.0, x2: -77.5, z1: 23.5, z2: 52.5 };
    const T2 = { x1: -95.0, x2: -81.5, z1: 27.0, z2: 48.0 };
    const T3 = { x1: -90.0, x2: -85.0, z1: 32.0, z2: 41.0 };

    // 一级台地：主体盒子不 fill，侧面画岩层横线 + 贴一圈不规则岩块，顶面只画一圈内缩的草线
    // 【为什么要贴岩块】第一版只有通长横线，远看就是一栋"带楼层线的白楼"（截图 PA1/PA3）。
    // 岩石层理得是断断续续的短横线，墙面还得有凸出来的大石块，才读成山。
    // 【为什么删掉竖裂缝】竖缝是 0.035 宽的细长盒子，墨线渲染下每段都自己描边，
    // 画出来是一串虚线，像缝合线 —— 和 v0.15 篮球场弧线踩的是同一个坑。
    let rs = 20261128;
    const rnd = () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; };
    const strata = (cx, cz, len, axis, y) => {
      for (let k = 0; k < 4; k++) {
        const fw = 0.12 + rnd() * 0.34;                      // 这一段占整面的比例
        const off = (rnd() - 0.5) * (len - fw * len);
        if (axis === 'x') {
          box(cx + off, y, cz, fw * len, 0.03, 0.04, { noCollide: true, ink: INK.BLACK });
        } else {
          box(cx, y, cz + off, 0.04, 0.03, fw * len, { noCollide: true, ink: INK.BLACK });
        }
      }
    };
    // 崖壁上凸出来的岩块（只画不挡，玩家照样能贴着墙走）
    // 【别贴成一排砖】第一版沿墙等距撒、尺寸 0.9~2.4 × 高 0.45~1.25，结果整面崖壁
    // 读成"贴了瓷砖的墙"（截图 PD1）。现在数量减到 1/3、尺寸方差拉大、位置完全随机，
    // 只留零星几块大石头凸出来。
    const cliffRocks = (r, yb, yt) => {
      const faces = [
        { axis: 'x', at: r.z2, lo: r.x1, hi: r.x2, out: 1 },
        { axis: 'x', at: r.z1, lo: r.x1, hi: r.x2, out: -1 },
        { axis: 'z', at: r.x2, lo: r.z1, hi: r.z2, out: 1 },
        { axis: 'z', at: r.x1, lo: r.z1, hi: r.z2, out: -1 },
      ];
      for (const f of faces) {
        const len = f.hi - f.lo;
        const n = Math.max(1, Math.round(len / 11.0));
        for (let i = 0; i < n; i++) {
          const c = f.lo + (0.15 + rnd() * 0.7) * len;
          const bw = 1.1 + rnd() * 2.2;                      // 沿墙面宽
          const bh = 0.5 + rnd() * 1.1;                      // 高
          const bd = 0.24 + rnd() * 0.42;                    // 凸出墙面
          const by = yb + rnd() * Math.max(0.05, (yt - yb) - bh - 0.12);
          if (f.axis === 'x') {
            box(c, by, f.at + f.out * (bd / 2), bw, bh, bd, { noCollide: true, ink: INK.BLACK });
          } else {
            box(f.at + f.out * (bd / 2), by, c, bd, bh, bw, { noCollide: true, ink: INK.BLACK });
          }
        }
      }
    };
    // 台地底边压一圈碎石堆。
    // 【为什么需要】三级台地是同心嵌套的矩形，从东面远处看（截图 PB1）轮廓就是
    // 三条笔直的直角台阶 —— 加上层理横线，整座山读成"一栋三层的白楼"。
    // 沿每条底边撒一堆半埋进地里的碎石，把笔直的底边打断成锯齿，
    // 远景轮廓才读成山。台地 2/3 的底边正好压在下一级的顶面上，也一并盖住。
    // 【别等距撒】第一版每 2.2m 一块、尺寸也都差不多，远看是"沿墙码了一排砖"。
    // 现在数量减到 1/2、位置和尺寸都随机。
    const skirt = (r, yb) => {
      const faces = [
        { axis: 'x', at: r.z2, lo: r.x1, hi: r.x2, out: 1 },
        { axis: 'x', at: r.z1, lo: r.x1, hi: r.x2, out: -1 },
        { axis: 'z', at: r.x2, lo: r.z1, hi: r.z2, out: 1 },
        { axis: 'z', at: r.x1, lo: r.z1, hi: r.z2, out: -1 },
      ];
      for (const f of faces) {
        const len = f.hi - f.lo;
        const n = Math.max(2, Math.round(len / 4.4));
        for (let i = 0; i < n; i++) {
          const c = f.lo + (0.08 + rnd() * 0.84) * len;
          const bw = 0.9 + rnd() * 2.0;
          const bh = 0.35 + rnd() * 0.95;
          const bd = 0.3 + rnd() * 0.6;
          if (f.axis === 'x') {
            box(c, yb - 0.06, f.at + f.out * (bd / 2 - 0.06), bw, bh, bd,
              { noCollide: true, ink: INK.BLACK });
          } else {
            box(f.at + f.out * (bd / 2 - 0.06), yb - 0.06, c, bd, bh, bw,
              { noCollide: true, ink: INK.BLACK });
          }
        }
      }
      // 四个角各堆一块大的，把直角吃掉
      for (const ax of [r.x1, r.x2]) {
        for (const az of [r.z1, r.z2]) {
          box(ax, yb - 0.06, az, 1.5 + rnd() * 0.7, 0.7 + rnd() * 0.6, 1.5 + rnd() * 0.7,
            { noCollide: true, ink: INK.BLACK });
        }
      }
    };
    // 台地顶边压一圈高低不一的石脊。
    // 【为什么需要】碎石裙只打断了底边，顶边还是三条笔直的水平线（截图 PC1），
    // 远景轮廓照样读成"三层白楼"。山顶轮廓必须锯齿化：沿每条顶边撒一堆
    // 高矮不等的石块，一半悬在崖外、一半搭在台面上，把直线顶边啃成参差的山脊。
    // 【第一版为什么像"码放的纸箱"（截图 PD1）】石块间距 2.6m、尺寸 1.3~2.6 全都差不多、
    // 高度 0.28~1.13 也差不多、还都贴着边线排成一排 —— 于是整座山读成三层整齐码放的箱子。
    // 现在：间距拉到 4.5m、尺寸 0.9~3.4 拉开三倍方差、高度 0.25~1.9、
    // 位置沿法线方向随机内缩 0~1.6m（不再全都咬在边线上），
    // 并且约四成的位置叠第二块小石，才形成真正的山脊。
    // 都是 noCollide —— 只为了轮廓，玩家照样能从旁边走过去。
    const crest = (r, yt) => {
      const faces = [
        { axis: 'x', at: r.z2, lo: r.x1, hi: r.x2, out: 1 },
        { axis: 'x', at: r.z1, lo: r.x1, hi: r.x2, out: -1 },
        { axis: 'z', at: r.x2, lo: r.z1, hi: r.z2, out: 1 },
        { axis: 'z', at: r.x1, lo: r.z1, hi: r.z2, out: -1 },
      ];
      for (const f of faces) {
        const len = f.hi - f.lo;
        const n = Math.max(3, Math.round(len / 4.5));
        for (let i = 0; i < n; i++) {
          const c = f.lo + ((i + 0.5) / n) * len + (rnd() - 0.5) * 1.6;
          const bw = 0.9 + rnd() * 2.5;                      // 沿山脊宽 0.9~3.4
          const bh = 0.25 + rnd() * 1.65;                    // 高出台面 0.25~1.9
          const bd = 0.8 + rnd() * 1.4;
          const inset = rnd() * 1.6;                         // 往台面里缩多少
          const at = f.at - f.out * inset;
          if (f.axis === 'x') {
            box(c, yt - 0.15, at - bd / 2 + 0.1, bw, bh + 0.15, bd,
              { noCollide: true, ink: INK.BLACK });
          } else {
            box(at - bd / 2 + 0.1, yt - 0.15, c, bd, bh + 0.15, bw,
              { noCollide: true, ink: INK.BLACK });
          }
          // 四成位置叠第二块小石，打破"一排同高方块"的节奏
          if (rnd() < 0.4) {
            const bh2 = 0.3 + rnd() * 1.1;
            const bw2 = Math.max(0.5, bw * (0.35 + rnd() * 0.3));
            const bd2 = Math.max(0.45, bd * (0.4 + rnd() * 0.35));
            const c2 = c + (rnd() - 0.5) * bw * 0.5;
            if (f.axis === 'x') {
              box(c2, yt + bh, at - bd / 2 + 0.1, bw2, bh2, bd2,
                { noCollide: true, ink: INK.BLACK });
            } else {
              box(at - bd / 2 + 0.1, yt + bh, c2, bd2, bh2, bw2,
                { noCollide: true, ink: INK.BLACK });
            }
          }
        }
      }
    };
    const terrace = (r, yb, yt) => {
      const cx = (r.x1 + r.x2) / 2, cz = (r.z1 + r.z2) / 2;
      const w = r.x2 - r.x1, d = r.z2 - r.z1;
      box(cx, yb, cz, w, yt - yb, d, { ink: INK.BLUE });
      for (let y = yb + 0.5; y < yt - 0.2; y += 0.58) {
        strata(cx, r.z2 + 0.02, w, 'x', y);
        strata(cx, r.z1 - 0.02, w, 'x', y);
        strata(r.x2 + 0.02, cz, d, 'z', y);
        strata(r.x1 - 0.02, cz, d, 'z', y);
      }
      cliffRocks(r, yb, yt);
      skirt(r, yb);
      crest(r, yt);
      const t = 0.55;
      box(cx, yt + 0.01, r.z2 - t, w - t * 2, 0.03, 0.06, { noCollide: true, ink: INK.GREEN });
      box(cx, yt + 0.01, r.z1 + t, w - t * 2, 0.03, 0.06, { noCollide: true, ink: INK.GREEN });
      box(r.x2 - t, yt + 0.01, cz, 0.06, 0.03, d - t * 2, { noCollide: true, ink: INK.GREEN });
      box(r.x1 + t, yt + 0.01, cz, 0.06, 0.03, d - t * 2, { noCollide: true, ink: INK.GREEN });
      // 台地顶面外圈撒几块石头、几丛草（都避开中间那条跑酷路线）
      for (let i = 0; i < 10; i++) {
        const edge = i % 4;
        let sx, sz;
        if (edge === 0) { sx = r.x1 + 1.2 + rnd() * (w - 2.4); sz = r.z2 - 1.0 - rnd() * 0.7; }
        else if (edge === 1) { sx = r.x1 + 1.2 + rnd() * (w - 2.4); sz = r.z1 + 1.0 + rnd() * 0.7; }
        else if (edge === 2) { sx = r.x1 + 1.0 + rnd() * 0.7; sz = r.z1 + 1.4 + rnd() * (d - 2.8); }
        else { sx = r.x2 - 1.0 - rnd() * 0.7; sz = r.z1 + 1.4 + rnd() * (d - 2.8); }
        if (rnd() < 0.5) {
          box(sx, yt, sz, 0.5 + rnd() * 0.5, 0.28 + rnd() * 0.3, 0.45 + rnd() * 0.4,
            { noCollide: true, ink: INK.BLACK });
        } else {
          cone(sx, yt, sz, 0.42 + rnd() * 0.3, 0.4 + rnd() * 0.3,
            { noCollide: true, ink: INK.GREEN, seg: 7 });
        }
      }
    };
    terrace(T1, GY, H1);
    terrace(T2, H1, H2);
    terrace(T3, H2, H3);

    // 石柱：从 base 长到 top，顶上压一块稍大的盖石（不压就只是一根白柱子）
    // 顶面再压一个橙色实心小方块 —— 这是跑酷里唯一的橙色，用来一眼标出"这里能踩"。
    // 没有它的话，白纸柱子跟白纸台地墙长得一模一样，玩家根本看不出下一步该跳哪。
    const pillar = (x, z, top, base, s = 1.5) => {
      box(x, base, z, s, top - base, s, { ink: INK.BLACK });
      box(x, top - 0.05, z, s + 0.08, 0.05, s + 0.08, { noCollide: true, ink: INK.BLACK });
      box(x, top + 0.005, z, Math.min(0.5, s * 0.42), 0.02, Math.min(0.5, s * 0.42),
        { noCollide: true, ink: INK.ORANGE, fill: true });
    };

    // ---- ① 东侧山脚：三段石墩爬上一级台地 ----
    //   起点在围墙外 (-75.6, 37)，玩家翻过西墙就落在这一带。
    //   0.85 / 1.60 / 2.40 三级，级差 0.75~0.8，跳高 1.11 够用。
    pillar(-76.4, 39.6, GY + 0.85, GY, 1.7);
    pillar(-77.0, 41.8, GY + 1.60, GY, 1.6);
    pillar(-77.3, 44.0, H1, GY, 1.5);

    // ---- ② 一级台地上往南走（台地本身就是路，不用再搭东西）----

    // ---- ③ 南坡：三段石柱爬上半山腰 ----
    pillar(-82.0, 50.6, H1 + 0.80, H1, 1.6);
    pillar(-84.5, 50.1, H1 + 1.60, H1, 1.5);
    pillar(-87.0, 49.6, H2, H1, 1.4);

    // ---- ④ 半山腰：沿台地往西、再往北绕（这一段就是"绕山半圈"）----

    // ---- ⑤ 西北侧：三段石柱下到一级台地 ----
    pillar(-96.5, 29.6, H1 + 1.60, H1, 1.5);
    pillar(-98.6, 28.4, H1 + 0.80, H1, 1.5);
    pillar(-100.3, 26.8, H1, GY, 1.4);

    // ---- ⑥ 一级台地西北角 → 山脚 ----
    pillar(-100.4, 24.6, GY + 1.60, GY, 1.5);
    pillar(-99.0, 22.8, GY + 0.85, GY, 1.4);

    // 山脚：只画一圈绿边 + 撒草，不铺整片绿
    box((HILL.x1 + HILL.x2) / 2, GY + 0.02, HILL.z2, HILL.x2 - HILL.x1, 0.03, 0.08,
      { noCollide: true, ink: INK.GREEN });
    box((HILL.x1 + HILL.x2) / 2, GY + 0.02, HILL.z1, HILL.x2 - HILL.x1, 0.03, 0.08,
      { noCollide: true, ink: INK.GREEN });
    box(HILL.x1, GY + 0.02, (HILL.z1 + HILL.z2) / 2, 0.08, 0.03, HILL.z2 - HILL.z1,
      { noCollide: true, ink: INK.GREEN });
    box(HILL.x2, GY + 0.02, (HILL.z1 + HILL.z2) / 2, 0.08, 0.03, HILL.z2 - HILL.z1,
      { noCollide: true, ink: INK.GREEN });
    // 野草（避开路线：只在西侧和山脚外圈撒）
    for (let i = 0; i < 14; i++) {
      const gx = HILL.x1 + 2.5 + (i % 4) * 6.2;
      const gz = HILL.z1 + 2.0 + Math.floor(i / 4) * 9.0;
      cone(gx, GY, gz, 0.8, 0.8, { ink: INK.GREEN, seg: 7, noCollide: true });
      cone(gx + 0.7, GY, gz + 0.5, 0.55, 0.55, { ink: INK.GREEN, seg: 7, noCollide: true });
    }
    // 山顶：三棵树 + 几块石头（只是风景，不在路线上 —— 正面上不去）
    for (let i = 0; i < 3; i++) {
      const tx = T3.x1 + 1.6 + i * 1.6, tz = T3.z1 + 2.4 + (i % 2) * 3.0;
      cyl(tx, H3, tz, 0.16, 2.2, { ink: INK.BLACK, seg: 8 });
      cone(tx, H3 + 2.2, tz, 1.25, 2.6, { ink: INK.GREEN, seg: 6, noCollide: true });
      cone(tx, H3 + 3.9, tz, 0.85, 1.8, { ink: INK.GREEN, seg: 6, noCollide: true });
    }
    for (let i = 0; i < 5; i++) {
      box(T3.x1 + 1.2 + i * 0.9, H3, T3.z2 - 2.0 - (i % 2) * 1.1, 0.7, 0.45, 0.6,
        { noCollide: true, ink: INK.BLACK });
    }

    // ---- 出口：山脚北侧的小吃街 ----
    const ST = { x1: -103.0, x2: -89.0, z1: 5.0, z2: 19.0 };
    const scx = (ST.x1 + ST.x2) / 2;
    slab(ST.x1, ST.z1, ST.x2, ST.z2, PY, 0.12, { ink: INK.BLACK });
    for (let z = ST.z1 + 1.6; z < ST.z2 - 0.1; z += 1.6) {
      box(scx, PY + 0.01, z, ST.x2 - ST.x1, 0.008, 0.014, { noCollide: true, ink: INK.BLACK });
    }
    box(scx, PY + 0.01, (ST.z1 + ST.z2) / 2, 0.014, 0.008, ST.z2 - ST.z1,
      { noCollide: true, ink: INK.BLACK });

    // 摊位：face = +1 朝 +x，-1 朝 -x
    const stall = (sx, sz, face) => {
      const w = 2.4, d = 2.8;
      box(sx - face * (w / 2), GY, sz, 0.16, 2.25, d, { ink: INK.BLACK });          // 后墙
      for (const s of [-1, 1]) {
        box(sx, GY, sz + s * (d / 2), w, 1.45, 0.14, { ink: INK.BLACK });           // 两侧矮墙
      }
      box(sx + face * 0.55, GY, sz, 1.05, 0.92, d - 0.4, { ink: INK.BLACK });       // 柜台
      box(sx + face * 0.55, GY + 0.92, sz, 1.16, 0.06, d - 0.28, { noCollide: true, ink: INK.BLACK });
      box(sx, GY + 2.25, sz, w + 0.8, 0.14, d + 0.8, { ink: INK.BLACK });           // 顶棚
      box(sx + face * (w / 2 + 0.36), GY + 2.06, sz, 0.1, 0.24, d + 0.8,
        { noCollide: true, ink: INK.RED, fill: true });                             // 前沿红布
      box(sx + face * (w / 2 + 0.4), GY + 1.58, sz, 0.08, 0.44, d * 0.72,
        { noCollide: true, ink: INK.RED, fill: true });                             // 招牌
      box(sx - face * 0.12, GY, sz, 0.86, 0.6, 1.15, { ink: INK.BLACK });           // 灶台
      cyl(sx - face * 0.12, GY + 0.6, sz, 0.33, 0.24, { ink: INK.BLACK, seg: 10 }); // 锅
      for (const s of [-1, 1]) {
        cyl(sx + face * 1.55, GY, sz + s * 0.75, 0.19, 0.6, { ink: INK.ORANGE, seg: 8 });
      }
    };
    for (let i = 0; i < 4; i++) {
      const sz = 7.6 + i * 3.2;
      stall(ST.x1 + 1.7, sz, 1);
      stall(ST.x2 - 1.7, sz, -1);
    }

    // 街口牌坊：两根柱子 + 横梁 + 红布（玩家从山脚下来正好穿过这里）
    for (const ax of [ST.x1 - 0.4, ST.x2 + 0.4]) {
      box(ax, GY, ST.z2 + 0.3, 0.34, 3.3, 0.34, { ink: INK.BLACK });
    }
    box(scx, GY + 3.3, ST.z2 + 0.3, ST.x2 - ST.x1 + 1.1, 0.34, 0.42, { ink: INK.BLACK });
    box(scx, GY + 2.78, ST.z2 + 0.28, ST.x2 - ST.x1 - 0.9, 0.86, 0.1,
      { noCollide: true, ink: INK.RED, fill: true });

    // 街上的零碎：灯笼、塑料凳、纸箱、垃圾桶
    for (let i = 0; i < 4; i++) {
      const lz = 7.6 + i * 3.2;
      for (const lx of [ST.x1 + 0.5, ST.x2 - 0.5]) {
        cyl(lx, GY + 2.55, lz, 0.19, 0.34, { ink: INK.RED, seg: 8, noCollide: true });
        box(lx, GY + 2.89, lz, 0.05, 0.42, 0.05, { noCollide: true, ink: INK.BLACK });
      }
    }
    for (let i = 0; i < 5; i++) {
      const px = ST.x1 + 3.4 + i * 2.6, pz = ST.z1 + 1.3 + (i % 2) * 1.1;
      box(px, GY, pz, 0.36, 0.34, 0.36, { noCollide: true, ink: INK.ORANGE });
      box(px, GY + 0.34, pz, 0.42, 0.06, 0.42, { noCollide: true, ink: INK.BLACK });
    }
    for (const bz of [6.4, 12.0, 17.6]) {
      cyl(scx + 3.4, GY, bz, 0.28, 0.78, { ink: INK.BLACK, seg: 10 });
    }

    // 终点：街北口的终点线。
    // 【为什么要有】街北口原来什么都没有，玩家跑到 z≈6 只是"走进一片空地"，
    // 完全看不出这里是终点。立两根柱子拉一条红横幅 + 地面一条红线，才读得出来。
    // 柱子放在 z=5.15（街面 z1=5.0 的北沿），正好避开第一排摊位（z 6.2 起）。
    const fz = 5.15;
    for (const fx of [scx - 4.6, scx + 4.6]) {
      box(fx, GY, fz, 0.22, 2.62, 0.22, { ink: INK.BLACK });
    }
    box(scx, GY + 2.62, fz, 9.6, 0.12, 0.26, { ink: INK.BLACK });
    box(scx, GY + 1.88, fz, 9.0, 0.66, 0.08,
      { noCollide: true, ink: INK.RED, fill: true });
    // 横幅上的字：四道纸白短条。
    // 【为什么要有】整条纯红横幅远看就是一块红板子，和两边摊位顶上的红布糊成一片，
    // 分不出"这是终点"。加几道白条，才读得出"横幅上写着字"。
    // 【坑】白条必须放在横幅【朝玩家这一侧】（fz + 0.05）。第一版写成 fz - 0.05，
    // 结果白条藏在横幅背面，从街上走过来完全看不见，横幅还是纯红一块。
    for (const [bx0, bw0] of [[-3.0, 1.1], [-1.3, 1.0], [0.5, 1.2], [2.4, 0.9]]) {
      box(scx + bx0, GY + 2.06, fz + 0.05, bw0, 0.3, 0.02,
        { noCollide: true, ink: INK.BLACK });
    }
    // 地面终点线：横跨街面的一条红条（noCollide，踩上去不挡路）
    box(scx, PY + 0.02, fz, 9.2, 0.03, 0.34,
      { noCollide: true, ink: INK.RED, fill: true });
  }

  // ================================================================
  //  绿化 / 生活道具
  // ================================================================
  // 行道树（主路两侧，树高 ≈ 7m）
  for (let i = 0; i < 7; i++) {
    const tz = 18 + i * 8;
    for (const tx of [-8.8, 4.8]) {
      cyl(tx, GY, tz, 0.2, 3.0, { ink: INK.BLACK, seg: 8 });
      cone(tx, GY + 3.2, tz, 1.55, 3.3, { ink: INK.GREEN, seg: 6, noCollide: true });
      cone(tx, GY + 5.1, tz, 1.1, 2.3, { ink: INK.GREEN, seg: 6, noCollide: true });
      box(tx, GY, tz, 1.6, 0.16, 1.6, { noCollide: true, ink: INK.ORANGE });
    }
  }
  // 前广场的行道树（只留教学楼南侧这一排）
  // 坑：原来这里还有一个 `for (const tx of [-30 + i*6.5, 40 + i*2.4])` 的第二组，
  // tx = 40~52、tz = 6.4~10.8 正好整排落在篮球场台地（x33~53, z6~21）里，
  // 用户连着两轮都说"篮球场里的树全删了" —— 第二组已整组移除。
  for (let i = 0; i < 6; i++) {
    const tz = 6.4 + (i % 3) * 2.2;
    const tx = -30 + i * 6.5;
    cyl(tx, GY, tz, 0.18, 2.7, { ink: INK.BLACK, seg: 8 });
    cone(tx, GY + 2.9, tz, 1.35, 2.9, { ink: INK.GREEN, seg: 6, noCollide: true });
    cone(tx, GY + 4.6, tz, 0.95, 2.0, { ink: INK.GREEN, seg: 6, noCollide: true });
  }
  // 路灯（主路两侧交错）
  // 坑：原来 lx 也取 [-8.8, 4.8]、lz = 18 + i*10，和行道树 (18 + i*8) 撞在
  // i=0 (-8.8, 18) 与 i=4 (-8.8, 58) 两点上 —— 灯杆直接从树冠里穿出来。
  // 现在路灯收到路沿内侧（-6.6 / 2.6），z 整体错开 4m，两排完全不重叠。
  for (let i = 0; i < 6; i++) {
    const lz = 22 + i * 10;
    const lx = i % 2 === 0 ? -6.6 : 2.6;
    cyl(lx, GY, lz, 0.12, 4.6, { ink: INK.BLACK, seg: 8 });
    box(lx + (lx < 0 ? 0.55 : -0.55), GY + 4.6, lz, 1.2, 0.15, 0.15, { noCollide: true, ink: INK.BLACK });
    box(lx + (lx < 0 ? 1.1 : -1.1), GY + 4.42, lz, 0.56, 0.18, 0.34, { noCollide: true, ink: INK.ORANGE, fill: true });
    cone(lx + (lx < 0 ? 0.65 : -0.65), GY + 3.7, lz, 0.24, 0.44, { ink: INK.BLACK, seg: 6, noCollide: true });
  }
  // 宣传栏（主路西侧）
  {
    const px = -10.4, pz = 26;
    for (const s of [-1, 1]) box(px, GY, pz + s * 2.0, 0.18, 2.6, 0.18, { ink: INK.BLACK });
    box(px, GY + 0.7, pz, 0.1, 1.9, 4.0, { ink: INK.RED, fill: true });
    box(px - 0.07, GY + 0.76, pz, 0.05, 1.78, 3.8, { noCollide: true, ink: INK.BLACK });
    box(px, GY + 2.6, pz, 0.34, 0.16, 4.4, { noCollide: true, ink: INK.BLACK });
  }
  // 垃圾桶
  for (const [tx, tz] of [[-6.8, 22], [3.2, 38], [-6.8, 54], [34.0, 12], [34.0, 48], [54.0, 26]]) {
    cyl(tx, GY, tz, 0.3, 0.85, { ink: INK.BLACK, seg: 10 });
    box(tx, GY + 0.85, tz, 0.68, 0.07, 0.68, { noCollide: true, ink: INK.RED });
  }
  // 自行车棚（教学楼西南侧）
  {
    const x1 = -32, x2 = -12, z1 = 16, z2 = 23;
    for (const px of [x1 + 0.4, (x1 + x2) / 2, x2 - 0.4]) {
      box(px, GY, z1 + 0.4, 0.22, 2.7, 0.22, { ink: INK.BLACK });
      box(px, GY, z2 - 0.4, 0.22, 2.7, 0.22, { ink: INK.BLACK });
    }
    box((x1 + x2) / 2, GY + 2.7, (z1 + z2) / 2, x2 - x1 + 0.7, 0.18, z2 - z1 + 0.7, { ink: INK.BLUE });
    for (let i = 0; i < 12; i++) {
      const bx = x1 + 1.6 + i * 1.55;
      box(bx, GY, z1 + 3.4, 0.08, 0.52, 1.5, { noCollide: true, ink: INK.BLACK });
      cyl(bx, GY + 0.17, z1 + 4.0, 0.34, 0.07, { noCollide: true, ink: INK.BLACK, seg: 10 });
      cyl(bx, GY + 0.17, z1 + 2.8, 0.34, 0.07, { noCollide: true, ink: INK.BLACK, seg: 10 });
      box(bx, GY + 0.36, z1 + 3.4, 0.06, 0.11, 1.3, { noCollide: true, ink: INK.RED });
    }
  }
  // 旗杆（前广场）
  {
    const px = -22, pz = 8.5;
    box(px, GY, pz, 2.4, 0.34, 2.4, { ink: INK.BLUE });
    cyl(px, GY + 0.34, pz, 0.12, 12.0, { ink: INK.BLACK, seg: 8 });
    box(px, GY + 11.0, pz + 1.0, 0.05, 1.4, 2.0, { noCollide: true, ink: INK.RED, fill: true });
    for (let i = 0; i < 3; i++) {
      const bx = px - 5.0 + i * 5.0;
      box(bx, GY, pz - 3.6, 2.8, 0.5, 2.8, { ink: INK.ORANGE });
      box(bx, GY + 0.5, pz - 3.6, 2.4, 0.14, 2.4, { noCollide: true, ink: INK.GREEN });
      for (let g = 0; g < 5; g++) {
        cyl(bx - 0.9 + g * 0.45, GY + 0.5, pz - 3.6 + ((g % 3) - 1) * 0.6, 0.2, 0.45,
          { ink: INK.GREEN, seg: 6, noCollide: true });
      }
    }
  }

  // ================================================================
  //  校园北侧后勤带（教学楼背后那一整条）
  // ================================================================
  // 用户反馈"学校里这两个区域有点单调"：教学楼北墙（z=-10）到北围墙（z=-22）
  // 之间是 12m × 188m 的纯空地 —— 从 3F 窗户往下看就是一大片白纸，
  // 站在地面上往北看也只有围墙和远景楼。这一带按国内中学背后的实际情况铺：
  // 沿墙通道 + 空调外机 + 锁死的后门 + 垃圾房 + 自行车停放 + 单双杠 +
  // 铅球区 + 跨栏堆放 + 食堂收货口 + 墙根灌木 + 长椅 + 消防栓 + 晾衣绳。
  {
    const NB = -10.25;                        // 教学楼北墙外表面
    const RZ1 = NB - 3.5, RZ2 = NB - 2.2;     // 沿墙通道（z -13.75 ~ -12.45）
    const NW = WALL.z1 + 0.75;                // 北围墙内侧

    // ---- 沿墙通道：只铺到 x=34（东半边留给体育场地，不铺硬化路）----
    slab(WALL.x1 + 4, RZ1, 34, RZ2, PY, 0.12, { ink: INK.BLACK });
    for (const cz of [RZ1 - 0.16, RZ2 + 0.16]) {
      box((WALL.x1 + 4 + 34) / 2, GY, cz, 34 - (WALL.x1 + 4), 0.17, 0.3,
        { noCollide: true, ink: INK.BLACK });
    }

    // ---- 教学楼北墙：一排空调外机（每间教室一台）----
    for (let i = 0; i < 9; i++) {
      const ax = -30 + i * 7.4;
      if (ax > 30) break;
      box(ax, GY + 2.42, NB - 0.34, 0.92, 0.62, 0.5, { ink: INK.BLUE });                    // 外机
      box(ax, GY + 2.36, NB - 0.2, 1.04, 0.07, 0.72, { noCollide: true, ink: INK.BLACK });  // 支架
      box(ax, GY + 2.46, NB - 0.61, 0.84, 0.46, 0.04, { noCollide: true, ink: INK.BLACK }); // 正面格栅
      box(ax + 0.32, GY + 1.2, NB - 0.3, 0.06, 1.2, 0.06, { noCollide: true, ink: INK.BLACK }); // 排水管
    }

    // ---- 教学楼北墙：一扇锁死的后门（贴在墙面上，打不开）----
    {
      const dx = -16.0;
      box(dx, GY, NB - 0.06, 1.3, 2.24, 0.14, { ink: INK.BLACK });
      box(dx, GY, NB - 0.12, 1.5, 0.1, 0.26, { noCollide: true, ink: INK.BLACK });          // 门槛条
      box(dx + 0.5, GY + 1.0, NB - 0.16, 0.12, 0.12, 0.12, { noCollide: true, ink: INK.ORANGE });
      box(dx, GY + 2.36, NB - 0.18, 1.0, 0.3, 0.08, { noCollide: true, ink: INK.RED, fill: true });
    }

    // ---- 垃圾房（三面矮墙 + 顶 + 四个大桶）----
    {
      const gx1 = 36, gx2 = 44, gz1 = WALL.z1 + 1.2, gz2 = WALL.z1 + 5.4;
      const gcx = (gx1 + gx2) / 2, gcz = (gz1 + gz2) / 2;
      box(gcx, GY, gz1, gx2 - gx1, 2.0, 0.2, { ink: INK.BLUE });
      for (const wx of [gx1, gx2]) box(wx, GY, gcz, 0.2, 2.0, gz2 - gz1, { ink: INK.BLUE });
      box(gcx, GY + 2.0, gcz, gx2 - gx1 + 0.5, 0.22, gz2 - gz1 + 0.5, { ink: INK.BLACK });
      for (let i = 0; i < 4; i++) {
        const bx = gx1 + 1.0 + i * 1.9;
        cyl(bx, GY, gcz + 0.2, 0.42, 1.02, { ink: INK.BLACK, seg: 10 });
        box(bx, GY + 1.02, gcz + 0.2, 0.92, 0.08, 0.92, { noCollide: true, ink: INK.RED });
      }
      box(gcx, GY + 2.28, gz2 - 0.12, 1.6, 0.34, 0.06, { noCollide: true, ink: INK.RED, fill: true });
    }

    // ---- 自行车停放（靠北墙一排，只有车架没有棚）----
    {
      const bx1 = -30, bx2 = -12, bz = WALL.z1 + 2.4;
      for (const bx of [bx1, bx2]) box(bx, GY, bz, 0.16, 0.9, 2.4, { ink: INK.BLACK });
      for (let i = 0; i < 10; i++) {
        const bx = bx1 + 1.4 + i * 1.72;
        box(bx, GY, bz, 0.08, 0.5, 1.5, { noCollide: true, ink: INK.BLACK });
        cyl(bx, GY + 0.17, bz + 0.6, 0.34, 0.07, { noCollide: true, ink: INK.BLACK, seg: 10 });
        cyl(bx, GY + 0.17, bz - 0.6, 0.34, 0.07, { noCollide: true, ink: INK.BLACK, seg: 10 });
        box(bx, GY + 0.36, bz, 0.06, 0.1, 1.3, { noCollide: true, ink: INK.RED });
      }
    }

    // ---- 单双杠（底下铺一圈沙地，只画框不 fill）----
    {
      const bx = 46, bz = WALL.z1 + 4.0;
      for (const dx of [0, 2.4]) {
        for (const s of [-1, 1]) box(bx + dx + s * 1.0, GY, bz, 0.12, 2.35, 0.12, { ink: INK.BLACK });
        box(bx + dx, GY + 2.35, bz, 2.1, 0.09, 0.09, { noCollide: true, ink: INK.BLACK });
      }
      for (const s of [-1, 1]) {
        for (const d of [-1.1, 1.1]) box(bx + 6.0 + d, GY, bz + s * 0.55, 0.11, 1.55, 0.11, { ink: INK.BLACK });
        box(bx + 6.0, GY + 1.55, bz + s * 0.55, 2.3, 0.09, 0.09, { noCollide: true, ink: INK.BLACK });
      }
      slab(bx - 2.0, bz - 1.7, bx + 8.2, bz + 1.7, GY + 0.012, 0.04, { ink: INK.ORANGE, noCollide: true });
    }

    // ---- 铅球投掷区（投掷圈 + 抵趾板 + 落地区白线 + 两个铅球）----
    {
      const qx = 66, qz = WALL.z1 + 5.2;
      cyl(qx, PY, qz, 1.05, 0.05, { ink: INK.BLACK, seg: 20, noCollide: true });
      box(qx, PY, qz - 1.16, 1.2, 0.1, 0.16, { noCollide: true, ink: INK.BLACK });
      for (const s of [-1, 1]) box(qx + s * 3.6, PY, qz + 6.2, 0.14, 0.03, 12.4, { noCollide: true, ink: INK.BLACK });
      box(qx, PY, qz + 12.4, 7.4, 0.03, 0.14, { noCollide: true, ink: INK.BLACK });
      for (const s of [-1, 1]) cyl(qx + s * 0.55, PY, qz + 1.5, 0.13, 0.26, { ink: INK.BLACK, seg: 10, noCollide: true });
      box(qx + 4.8, GY, qz - 1.5, 0.08, 1.0, 0.08, { ink: INK.BLACK });
      box(qx + 4.8, GY + 1.0, qz - 1.5, 0.9, 0.34, 0.05, { noCollide: true, ink: INK.RED, fill: true });
    }

    // ---- 跨栏 + 体操垫堆放（操场北侧那片空地的器材区）----
    {
      const hx = 88, hz = WALL.z1 + 4.6;
      for (let i = 0; i < 4; i++) {
        const bx = hx + i * 3.0;
        for (const s of [-1, 1]) box(bx, GY, hz + s * 0.6, 0.09, 0.95, 0.09, { ink: INK.BLACK });
        box(bx, GY + 0.95, hz, 0.09, 0.09, 1.3, { noCollide: true, ink: INK.BLACK });
        box(bx, GY + 0.55, hz, 0.06, 0.24, 1.2, { noCollide: true, ink: INK.RED, fill: true });
      }
      for (let k = 0; k < 3; k++) box(hx + 13.4, GY + k * 0.14, hz, 1.8, 0.13, 1.0, { ink: INK.BLUE });
      for (let k = 0; k < 2; k++) box(hx + 15.8, GY + k * 0.14, hz, 1.8, 0.13, 1.0, { ink: INK.BLUE });
    }

    // ---- 食堂收货口（北墙外：锁着的收货门 + 菜筐 + 手推车）----
    {
      const sx = -56, sz = 1.72;
      box(sx, GY, sz, 1.6, 2.2, 0.14, { ink: INK.BLACK });
      box(sx, GY, sz - 0.02, 1.8, 0.1, 0.24, { noCollide: true, ink: INK.BLACK });
      box(sx, GY + 2.3, sz - 0.14, 1.4, 0.34, 0.06, { noCollide: true, ink: INK.RED, fill: true });
      for (let i = 0; i < 6; i++) {
        const bx = sx - 3.4 + (i % 3) * 0.8, bz = sz - 1.5 - Math.floor(i / 3) * 0.9;
        box(bx, GY, bz, 0.7, 0.42, 0.62, { ink: INK.ORANGE });
        box(bx, GY + 0.42, bz, 0.7, 0.06, 0.62, { noCollide: true, ink: INK.BLACK });
      }
      box(sx + 2.6, GY + 0.5, sz - 1.4, 1.4, 0.08, 0.9, { ink: INK.BLUE });
      for (const s of [-1, 1]) cyl(sx + 2.6 + s * 0.5, GY + 0.22, sz - 1.85, 0.22, 0.1, { ink: INK.BLACK, seg: 10 });
      box(sx + 2.6, GY + 0.5, sz - 0.95, 1.4, 0.5, 0.06, { noCollide: true, ink: INK.BLUE });
    }

    // ---- 北墙根灌木带（跳过狗洞与跳远助跑道）----
    for (let x = WALL.x1 + 5; x < WALL.x2 - 5; x += 6.5) {
      if (x > -63 && x < -47) continue;      // 狗洞
      if (x > 73 && x < 83) continue;        // 跳远助跑道
      cyl(x, GY, NW, 0.55, 0.62, { ink: INK.GREEN, seg: 7, noCollide: true });
      cyl(x + 0.62, GY, NW - 0.22, 0.42, 0.48, { ink: INK.GREEN, seg: 7, noCollide: true });
      cyl(x - 0.52, GY, NW - 0.3, 0.36, 0.42, { ink: INK.GREEN, seg: 7, noCollide: true });
    }

    // ---- 两棵大树（这一片唯一的竖向元素，否则整条都是平的）----
    for (const tx of [-44, 30]) {
      const tz = WALL.z1 + 4.4;
      cyl(tx, GY, tz, 0.28, 3.4, { ink: INK.BLACK, seg: 8 });
      cone(tx, GY + 3.4, tz, 2.1, 3.6, { ink: INK.GREEN, seg: 7, noCollide: true });
      cone(tx, GY + 5.8, tz, 1.5, 2.6, { ink: INK.GREEN, seg: 7, noCollide: true });
      box(tx, GY, tz, 2.0, 0.16, 2.0, { noCollide: true, ink: INK.ORANGE });
    }

    // ---- 长椅三张 ----
    for (const bx of [-24, 8, 30]) {
      const bz = NB - 4.8;
      box(bx, GY + 0.42, bz, 1.8, 0.08, 0.5, { ink: INK.ORANGE });
      box(bx, GY + 0.5, bz - 0.24, 1.8, 0.42, 0.07, { noCollide: true, ink: INK.ORANGE });
      for (const s of [-1, 1]) box(bx + s * 0.75, GY, bz, 0.1, 0.42, 0.46, { ink: INK.BLACK });
    }

    // ---- 消防栓 ----
    for (const fx of [-52, 20, 70]) {
      const fz = NB - 4.2;
      cyl(fx, GY, fz, 0.16, 0.95, { ink: INK.RED, seg: 10 });
      box(fx, GY + 0.95, fz, 0.34, 0.12, 0.34, { noCollide: true, ink: INK.RED });
      for (const s of [-1, 1]) box(fx + s * 0.22, GY + 0.6, fz, 0.16, 0.16, 0.16, { noCollide: true, ink: INK.RED });
    }

    // ---- 晾衣绳（住宿生晒被子那种，两根杆 + 三根绳 + 两床被子）----
    {
      const yx1 = -6, yx2 = 4, yz = NB - 5.4;
      for (const px of [yx1, yx2]) {
        box(px, GY, yz, 0.12, 2.1, 0.12, { ink: INK.BLACK });
        box(px, GY + 2.1, yz, 0.5, 0.08, 0.5, { noCollide: true, ink: INK.BLACK });
      }
      for (let k = 0; k < 3; k++) {
        box((yx1 + yx2) / 2, GY + 1.95 - k * 0.32, yz, yx2 - yx1, 0.03, 0.03, { noCollide: true, ink: INK.BLACK });
      }
      box(yx1 + 3.0, GY + 1.32, yz, 1.2, 0.62, 0.1, { noCollide: true, ink: INK.BLUE });
      box(yx1 + 6.4, GY + 1.42, yz, 1.1, 0.52, 0.1, { noCollide: true, ink: INK.PINK });
    }
  }

  // ================================================================
  //  东南角生活区（门卫室 ↔ 操场之间那片空场）
  // ================================================================
  // 用户指出"门卫室到操场"这一片太空：x16~56 × z56~74 除了两条路什么都没有。
  // 按国内中学的实际配置铺：教师停车棚 + 东西向连接路 + 花池 + 树 +
  // 长椅 + 垃圾桶 + 路灯 + 公告栏。
  {
    // ---- 东西向连接路（把岗亭前那条路和操场西通道接起来）----
    slab(16, 66.5, 56, 68.5, PY, 0.12, { ink: INK.BLACK });
    for (const cz of [66.34, 68.66]) {
      box(36, GY, cz, 40, 0.17, 0.3, { noCollide: true, ink: INK.BLACK });
    }

    // ---- 教师停车棚（钢结构顶棚 + 立柱 + 12 辆车）----
    {
      const px1 = 20, px2 = 44, pz1 = 58.0, pz2 = 65.0;
      const pcx = (px1 + px2) / 2, pcz = (pz1 + pz2) / 2;
      // 顶棚（略微前倾，只做视觉）
      box(pcx, GY + 2.42, pcz, px2 - px1 + 0.8, 0.14, pz2 - pz1 + 0.8, { ink: INK.BLACK });
      // 立柱 6 根
      for (const cx of [px1, pcx, px2]) {
        for (const cz of [pz1 + 0.3, pz2 - 0.3]) {
          box(cx, GY, cz, 0.16, 2.42, 0.16, { ink: INK.BLACK });
        }
      }
      // 地面（水泥，纸白 + 黑描边）
      slab(px1 + 0.2, pz1 + 0.4, px2 - 0.2, pz2 - 0.4, GY + 0.014, 0.04,
        { ink: INK.BLACK, noCollide: true });
      // 车（一半电动车一半自行车，简化成轮子 + 车架 + 车把）
      for (let i = 0; i < 12; i++) {
        const bx = px1 + 1.5 + i * 1.9;
        const bz = pcz + (i % 2 === 0 ? -0.85 : 0.85);
        const wheelInk = INK.BLACK;
        for (const s of [-1, 1]) {
          cyl(bx + s * 0.52, GY + 0.02, bz, 0.32, 0.06,
            { ink: wheelInk, seg: 12, noCollide: true });
        }
        box(bx, GY + 0.3, bz, 1.0, 0.07, 0.06, { noCollide: true, ink: INK.BLACK });
        box(bx - 0.1, GY + 0.34, bz, 0.06, 0.34, 0.06, { noCollide: true, ink: INK.BLACK });
        box(bx + 0.5, GY + 0.62, bz, 0.06, 0.5, 0.06, { noCollide: true, ink: INK.BLACK });
        box(bx + 0.5, GY + 1.1, bz, 0.5, 0.05, 0.05, { noCollide: true, ink: INK.BLACK });
        // 车座
        box(bx - 0.34, GY + 0.72, bz, 0.28, 0.06, 0.14,
          { noCollide: true, ink: INK.BLACK });
        // 电动车加个踏板 / 车筐
        if (i % 2 === 0) {
          box(bx + 0.05, GY + 0.24, bz, 0.5, 0.05, 0.28,
            { noCollide: true, ink: INK.BLUE });
        } else {
          box(bx + 0.62, GY + 0.78, bz, 0.3, 0.22, 0.24,
            { noCollide: true, ink: INK.ORANGE });
        }
      }
      // 棚子东侧立一块"教职工车辆停放"的牌子
      box(px2 + 0.9, GY, pcz, 0.08, 1.1, 0.08, { ink: INK.BLACK });
      box(px2 + 0.9, GY + 1.1, pcz, 0.9, 0.42, 0.06,
        { noCollide: true, ink: INK.RED, fill: true });
    }

    // ---- 公告栏（连接路北侧，面向停车棚）----
    {
      const gx = 50.0, gz = 64.6;
      for (const s of [-1, 1]) box(gx + s * 1.9, GY, gz, 0.1, 2.0, 0.1, { ink: INK.BLACK });
      box(gx, GY + 1.1, gz, 4.0, 1.5, 0.12, { ink: INK.BLUE });
      // 里面贴的几张纸（黑框 + 一点点红标题）
      for (let i = 0; i < 4; i++) {
        const ox = gx - 1.5 + i * 1.0;
        box(ox, GY + 1.25, gz + 0.08, 0.78, 0.52, 0.03,
          { noCollide: true, ink: INK.BLACK });
        box(ox, GY + 1.72, gz + 0.09, 0.62, 0.08, 0.02,
          { noCollide: true, ink: INK.RED, fill: true });
      }
      // 顶棚压边
      box(gx, GY + 2.0, gz, 4.3, 0.12, 0.34, { noCollide: true, ink: INK.BLACK });
    }

    // ---- 两个花池（连接路南侧，靠围墙）----
    for (const bxp of [24.0, 38.0]) {
      const bz = 70.6, bw = 6.0, bd = 2.2;
      box(bxp, GY, bz, bw, 0.5, bd, { ink: INK.ORANGE });
      box(bxp, GY + 0.5, bz, bw - 0.3, 0.06, bd - 0.3,
        { noCollide: true, ink: INK.BLACK });
      // 池里密铺矮草
      let k = 0;
      for (let gx = bxp - bw / 2 + 0.5; gx < bxp + bw / 2 - 0.3; gx += 0.55) {
        for (let gz = bz - bd / 2 + 0.4; gz < bz + bd / 2 - 0.3; gz += 0.5) {
          cyl(gx, GY + 0.5, gz, 0.1 + (k % 3) * 0.03, 0.16 + ((k * 5) % 3) * 0.05,
            { ink: INK.GREEN, seg: 6, noCollide: true });
          k++;
        }
      }
    }

    // ---- 四棵树（停车棚北侧，间距拉开）----
    // 【穿模修复】原来这排树的 tz 是 63.4，正好落在停车棚（x 20~44 / z 58~65）里面，
    // 三棵树干戳在棚下、树冠（离地 2.9 起、高 5.1）直接捅穿 2.42m 高的顶棚 ——
    // 截图里就是"树从车棚顶上长出来"。棚顶占 z 57.6~65.4，树冠半径 1.4，
    // 所以整排退到棚北侧 z=55.2（树冠最南到 56.6，离棚顶还有 1m）。
    for (let i = 0; i < 4; i++) {
      const tx = 21.0 + i * 9.5, tz = 55.2;
      cyl(tx, GY, tz, 0.2, 2.9, { ink: INK.BLACK, seg: 8 });
      cone(tx, GY + 2.9, tz, 1.4, 3.0, { ink: INK.GREEN, seg: 7, noCollide: true });
      cone(tx, GY + 4.7, tz, 1.0, 2.1, { ink: INK.GREEN, seg: 7, noCollide: true });
      box(tx, GY, tz, 1.5, 0.16, 1.5, { noCollide: true, ink: INK.ORANGE });
    }

    // ---- 长椅两张 + 垃圾桶两个 + 路灯两盏 ----
    for (const bx of [30.0, 46.0]) {
      const bz = 67.6;
      box(bx, GY + 0.42, bz, 1.8, 0.08, 0.5, { ink: INK.ORANGE });
      box(bx, GY + 0.5, bz - 0.24, 1.8, 0.42, 0.07,
        { noCollide: true, ink: INK.ORANGE });
      for (const s of [-1, 1]) {
        box(bx + s * 0.75, GY, bz, 0.1, 0.42, 0.46, { ink: INK.BLACK });
      }
    }
    for (const gx of [26.0, 42.0]) {
      cyl(gx, GY, 68.9, 0.32, 0.88, { ink: INK.BLACK, seg: 10 });
      box(gx, GY + 0.88, 68.9, 0.7, 0.07, 0.7, { noCollide: true, ink: INK.BLACK });
    }
    for (const lx of [18.0, 52.0]) {
      const lz = 67.5;
      cyl(lx, GY, lz, 0.11, 4.4, { ink: INK.BLACK, seg: 8 });
      box(lx, GY + 4.4, lz, 0.5, 0.1, 0.5, { noCollide: true, ink: INK.BLACK });
      box(lx, GY + 4.5, lz, 0.34, 0.3, 0.34,
        { noCollide: true, ink: INK.ORANGE, fill: true });
    }
  }

  // ================================================================
  //  教学楼东侧空地（教学楼东端 ↔ 跳远场地之间）
  // ================================================================
  // 区域2 的空场：x32~78 × z-10~3.4。北侧沿墙那条已经铺了（后勤带），
  // 但中间这 13m 宽、46m 长的一大片还是白纸 —— 补一块体能训练场地 + 草皮。
  {
    // ---- 草皮（只描边 + 零星草块，不铺实色）----
    // 教训：40×9 的整块 fill 绿会把整个画面压塌（和之前道路铺死蓝一个毛病）。
    // 这里只画一圈黑边 + 撒一些矮草丛，远处读起来是草坪，近处不抢戏。
    slab(34, -8.0, 74, 1.0, GY + 0.016, 0.05,
      { ink: INK.GREEN, noCollide: true });
    for (const cz of [-8.0, 1.0]) {
      box(54, GY + 0.02, cz, 40, 0.06, 0.16,
        { noCollide: true, ink: INK.BLACK });
    }
    for (const cx of [34, 74]) {
      box(cx, GY + 0.02, -3.5, 0.16, 0.06, 9.0,
        { noCollide: true, ink: INK.BLACK });
    }
    // 零星草丛（避开器材区 x40~68，只铺两头和边上）
    {
      let k = 0;
      for (let gx = 34.8; gx < 73.2; gx += 1.35) {
        for (let gz = -7.4; gz < 0.6; gz += 1.25) {
          // 器材区留空
          if (gx > 38.0 && gx < 69.5 && gz > -6.4 && gz < -1.6) continue;
          const jx = gx + ((k % 5) - 2) * 0.09;
          const jz = gz + ((k % 3) - 1) * 0.11;
          cyl(jx, GY + 0.02, jz, 0.1 + (k % 3) * 0.03,
            0.13 + ((k * 7) % 4) * 0.05,
            { ink: INK.GREEN, seg: 6, noCollide: true });
          k++;
        }
      }
    }

    // ---- 体能训练区：平衡木 + 低单杠 + 轮胎阵 ----
    {
      // 平衡木（两根立柱 + 一根横木）
      const bmx = 40.0, bmz = -4.2;
      for (const s of [-1, 1]) {
        box(bmx + s * 1.6, GY, bmz, 0.14, 0.5, 0.14, { ink: INK.BLACK });
      }
      box(bmx, GY + 0.5, bmz, 3.4, 0.14, 0.22, { ink: INK.ORANGE });

      // 低单杠
      for (const s of [-1, 1]) {
        box(46.0 + s * 1.1, GY, -3.0, 0.12, 1.35, 0.12, { ink: INK.BLACK });
      }
      box(46.0, GY + 1.35, -3.0, 2.3, 0.08, 0.08,
        { noCollide: true, ink: INK.BLACK });

      // 轮胎阵（8 个，平放）
      for (let i = 0; i < 8; i++) {
        const tx = 50.0 + (i % 4) * 1.5, tz = -5.6 + Math.floor(i / 4) * 1.5;
        cyl(tx, GY + 0.02, tz, 0.42, 0.22,
          { ink: INK.BLACK, seg: 14, noCollide: true });
        cyl(tx, GY + 0.02, tz, 0.2, 0.24,
          { ink: INK.GREEN, seg: 12, noCollide: true });
      }

      // 攀爬架（一组方格架）
      const cx0 = 60.0, cz0 = -4.0;
      for (const dx of [-1.4, 1.4]) {
        for (const dz of [-0.7, 0.7]) {
          box(cx0 + dx, GY, cz0 + dz, 0.1, 2.0, 0.1, { ink: INK.BLACK });
        }
      }
      for (let k = 0; k < 4; k++) {
        box(cx0, GY + 0.4 + k * 0.5, cz0 - 0.7, 2.8, 0.06, 0.06,
          { noCollide: true, ink: INK.BLACK });
        box(cx0, GY + 0.4 + k * 0.5, cz0 + 0.7, 2.8, 0.06, 0.06,
          { noCollide: true, ink: INK.BLACK });
      }
      for (const s of [-1, 1]) {
        box(cx0 + s * 1.4, GY + 2.0, cz0, 0.06, 0.06, 1.4,
          { noCollide: true, ink: INK.BLACK });
      }

      // 沙袋（两个挂在架子上）
      for (let i = 0; i < 2; i++) {
        const sx = 66.0 + i * 2.2;
        box(sx, GY + 2.3, -3.2, 0.08, 0.4, 0.08, { ink: INK.BLACK });
        cyl(sx, GY + 1.05, -3.2, 0.24, 1.25,
          { ink: INK.ORANGE, seg: 10, noCollide: true });
        box(sx, GY + 2.3, -3.2, 1.2, 0.08, 0.08,
          { noCollide: true, ink: INK.BLACK });
      }
    }

    // ---- 三棵树 + 两张长椅（草皮边）----
    for (let i = 0; i < 3; i++) {
      const tx = 37.0 + i * 15.0, tz = -7.2;
      cyl(tx, GY, tz, 0.19, 2.7, { ink: INK.BLACK, seg: 8 });
      cone(tx, GY + 2.7, tz, 1.3, 2.8, { ink: INK.GREEN, seg: 7, noCollide: true });
      cone(tx, GY + 4.4, tz, 0.92, 1.9, { ink: INK.GREEN, seg: 7, noCollide: true });
      box(tx, GY, tz, 1.4, 0.15, 1.4, { noCollide: true, ink: INK.ORANGE });
    }
    for (const bx of [44.0, 68.0]) {
      const bz = 0.4;
      box(bx, GY + 0.42, bz, 1.8, 0.08, 0.5, { ink: INK.ORANGE });
      box(bx, GY + 0.5, bz + 0.24, 1.8, 0.42, 0.07,
        { noCollide: true, ink: INK.ORANGE });
      for (const s of [-1, 1]) {
        box(bx + s * 0.75, GY, bz, 0.1, 0.42, 0.46, { ink: INK.BLACK });
      }
    }

    // ---- 一条南北小路（把北侧后勤带和这块草皮连起来）----
    slab(72.0, -12.45, 74.0, 1.0, PY, 0.12, { ink: INK.BLACK });
  }

  // ================================================================
  //  校外远景（围墙外）
  // ================================================================
  // 围墙外原本是纯空地 —— 站在主路上往校门方向看，抬头就是一大片留白。
  // 这一块补的全是"背景板"：远处楼房的剪影、电线杆、路边停的自行车、
  // 校门外那条一直延伸出去的路。只求撑起天际线，不加任何逻辑。
  // （玩家翻出围墙就判定逃学成功，所以这些永远只是背景，不会被走到跟前）
  {
    // ---- 校门外那条路（从大门一直往南延伸，画面才有"外面还有世界"）----
    slab(-6, WALL.z2, 2, 138, PY, 0.12, { ink: INK.BLACK });
    // 门前横向的人行道
    slab(-40, WALL.z2 + 0.6, 34, WALL.z2 + 5.0, PY, 0.12, { ink: INK.BLACK });

    // ---- 远景楼房 ----
    // axis='z'：立面朝南/北（楼沿 x 方向展开）；axis='x'：立面朝东/西
    function farBuilding(bx, bz, bw, bd, bh, floors, cols, axis) {
      // 楼体【不 fill】：一 fill 就是一大块死蓝，50m 外一片蓝方块比白盒子还难看。
      // 但纯描边又读成"空心盒子"（截图里非常明显），所以在朝向校园那一面
      // 每层压一道横线当楼板线 —— 远看就有"这是一栋多层楼"的信息量。
      box(bx, GY, bz, bw, bh, bd, { ink: INK.BLUE });
      box(bx, GY + bh, bz, bw + 0.5, 0.3, bd + 0.5, { noCollide: true, ink: INK.BLACK });   // 女儿墙
      // 窗格只画朝向校园的那一面（背面本来就看不见，少一半几何）
      const fh = bh / floors;
      const span = axis === 'z' ? bw : bd;
      const cell = span / cols;
      for (let f = 0; f < floors; f++) {
        const wy = GY + f * fh + fh * 0.26;
        // 每层一道楼板线（横贯整面），远看就是"一层一层"的多层楼
        const ly = GY + f * fh + fh * 0.92;
        if (axis === 'z') {
          const fz = bz + (bz < 0 ? bd / 2 + 0.05 : -bd / 2 - 0.05);
          box(bx, ly, fz, bw - 0.3, 0.07, 0.05, { noCollide: true, ink: INK.BLACK });
        } else {
          const fx = bx + (bx < 0 ? bw / 2 + 0.05 : -bw / 2 - 0.05);
          box(fx, ly, bz, 0.05, 0.07, bd - 0.3, { noCollide: true, ink: INK.BLACK });
        }
        for (let c = 0; c < cols; c++) {
          const a = (axis === 'z' ? bx - bw / 2 : bz - bd / 2) + cell * (c + 0.5);
          const ww = cell * 0.58, hh = fh * 0.46;
          if (axis === 'z') {
            const fz = bz + (bz < 0 ? bd / 2 + 0.05 : -bd / 2 - 0.05);
            box(a, wy, fz, ww, hh, 0.05, { noCollide: true, ink: INK.BLACK });
          } else {
            const fx = bx + (bx < 0 ? bw / 2 + 0.05 : -bw / 2 - 0.05);
            box(fx, wy, a, 0.05, hh, ww, { noCollide: true, ink: INK.BLACK });
          }
        }
      }
    }
    // 校门外：西侧一栋、东侧一栋、正南远处一栋更高的
    // 坑 1：第一版放在 z=96~126、x=±40 一带，站在校门内侧（z≈70）朝外看，
    //       30m 外一栋 17m 高的楼直接糊满整屏 —— 远景得推远到 50m 以上才读成"远景"。
    // 坑 2：推远之后楼又被围墙挡住了 —— 围墙 3.27m，站在北墙内侧（z≈-16）离墙 6m，
    //       楼在 46m 外，要露出墙头得高过 3.27*46/6 ≈ 25m。所以远景楼一律做到 30m 以上，
    //       宁可夸张一点，也要让"围墙外面还有城市"这件事一眼读得出来。
    farBuilding(-42, 118, 32, 18, 34, 9, 6, 'z');
    farBuilding(26, 124, 28, 16, 40, 11, 5, 'z');
    farBuilding(-10, 152, 50, 15, 48, 13, 9, 'z');
    // 北墙外（跳远场地背后那一片）
    farBuilding(30, -62, 44, 16, 36, 10, 8, 'z');
    farBuilding(-46, -58, 32, 14, 30, 8, 6, 'z');
    farBuilding(74, -56, 26, 14, 33, 9, 5, 'z');
    // 东墙外（操场东侧）
    farBuilding(152, 30, 18, 38, 34, 9, 7, 'x');
    // 西墙外（后山再往西）
    farBuilding(-150, 42, 16, 32, 30, 8, 6, 'x');
    farBuilding(-146, 82, 14, 26, 26, 7, 5, 'x');

    // ---- 电线杆 + 电线（校门外那条路的标志物）----
    for (let i = 0; i < 5; i++) {
      const px = -13.0, pz = WALL.z2 + 6 + i * 13;
      cyl(px, GY, pz, 0.15, 8.6, { ink: INK.BLACK, seg: 6 });
      box(px, GY + 7.9, pz, 2.0, 0.1, 0.12, { noCollide: true, ink: INK.BLACK });      // 横担
      for (const dx of [-0.8, 0, 0.8]) {
        box(px + dx, GY + 8.0, pz, 0.08, 0.22, 0.08, { noCollide: true, ink: INK.BLACK });   // 瓷瓶
      }
      if (i < 4) {                                                                     // 电线
        for (const dx of [-0.8, 0, 0.8]) {
          box(px + dx, GY + 8.14, pz + 6.5, 0.035, 0.035, 13.0, { noCollide: true, ink: INK.BLACK });
        }
      }
    }

    // ---- 校门外停的自行车（和车棚里同款简化画法）----
    for (let i = 0; i < 8; i++) {
      const bx = -30 + i * 1.25, bz = WALL.z2 + 2.0 + (i % 2) * 0.45;
      const tilt = ((i % 3) - 1) * 0.07;
      box(bx + tilt, GY, bz, 0.08, 0.52, 1.5, { noCollide: true, ink: INK.BLACK });
      cyl(bx + tilt, GY + 0.17, bz + 0.6, 0.34, 0.07, { noCollide: true, ink: INK.BLACK, seg: 10 });
      cyl(bx + tilt, GY + 0.17, bz - 0.6, 0.34, 0.07, { noCollide: true, ink: INK.BLACK, seg: 10 });
      box(bx + tilt, GY + 0.36, bz, 0.06, 0.11, 1.3, { noCollide: true, ink: INK.RED });
    }

    // ---- 校门外的行道树 ----
    for (let i = 0; i < 6; i++) {
      const tx = -30 + i * 9.5, tz = WALL.z2 + 8.5;
      cyl(tx, GY, tz, 0.2, 2.8, { ink: INK.BLACK, seg: 8 });
      cone(tx, GY + 3.0, tz, 1.45, 3.1, { ink: INK.GREEN, seg: 6, noCollide: true });
      cone(tx, GY + 4.8, tz, 1.0, 2.1, { ink: INK.GREEN, seg: 6, noCollide: true });
    }

    // ---- 校门外的路灯（比校内细一点，样式不同）----
    for (const lx of [-14.5, 6.5]) {
      for (let i = 0; i < 4; i++) {
        const lz = WALL.z2 + 5 + i * 14;
        cyl(lx, GY, lz, 0.1, 6.2, { ink: INK.BLACK, seg: 6 });
        box(lx + (lx < 0 ? 0.7 : -0.7), GY + 6.2, lz, 1.5, 0.12, 0.12, { noCollide: true, ink: INK.BLACK });
        box(lx + (lx < 0 ? 1.35 : -1.35), GY + 6.0, lz, 0.6, 0.16, 0.32, { noCollide: true, ink: INK.ORANGE, fill: true });
      }
    }
  }

  // ================================================================
  //  围墙内侧的补充细节
  // ================================================================
  {
    // ---- 墙根绿篱 ----
    // 现在墙根是光秃秃的，一条绿带能把地面压住。
    // 主体用一条低矮长方体（便宜），顶上加几丛圆柱破一下直线。
    function hedgeRun(a1, a2, c, along) {
      const mid = (a1 + a2) / 2, len = a2 - a1;
      if (along === 'x') box(mid, GY, c, len, 0.66, 0.8, { noCollide: true, ink: INK.GREEN });
      else box(c, GY, mid, 0.8, 0.66, len, { noCollide: true, ink: INK.GREEN });
      for (let a = a1 + 0.8; a < a2 - 0.4; a += 2.2) {
        const j = ((a * 37) % 5 - 2) * 0.06;
        if (along === 'x') cyl(a, GY + 0.5, c + j, 0.42, 0.42, { ink: INK.GREEN, seg: 6, noCollide: true });
        else cyl(c + j, GY + 0.5, a, 0.42, 0.42, { ink: INK.GREEN, seg: 6, noCollide: true });
      }
    }
    hedgeRun(WALL.x1 + 3, GATE.x1 - 2.2, WALL.z2 - 0.95, 'x');       // 南墙（大门西侧）
    hedgeRun(GATE.x2 + 2.2, WALL.x2 - 3, WALL.z2 - 0.95, 'x');       // 南墙（大门东侧）
    hedgeRun(WALL.z1 + 3, WALL.z2 - 3, WALL.x2 - 0.95, 'z');         // 东墙内侧

    // ---- 路沿石 ----
    // 主路两侧各一条，比路面高一点点，把"路"和"草地"分开。
    for (const cx of [-6.3, 2.3]) {
      box(cx, GY, (16 + WALL.z2) / 2, 0.3, 0.17, WALL.z2 - 16, { noCollide: true, ink: INK.BLACK });
    }

    // ---- 排水篦子（沿西侧路沿）----
    for (let i = 0; i < 4; i++) {
      const gz = 24 + i * 13;
      box(-6.0, PY - 0.02, gz, 0.5, 0.04, 0.9, { noCollide: true, ink: INK.BLACK });
      for (let k = 0; k < 4; k++) {
        box(-6.0, PY + 0.01, gz - 0.32 + k * 0.21, 0.44, 0.02, 0.07, { noCollide: true, ink: INK.BLACK });
      }
    }

    // ---- 井盖（主路上三个）----
    for (const [mx, mz] of [[-3.6, 36], [-0.8, 54], [-3.2, 66]]) {
      cyl(mx, PY + 0.005, mz, 0.44, 0.025, { noCollide: true, ink: INK.BLACK, seg: 14 });
      cyl(mx, PY + 0.02, mz, 0.36, 0.02, { noCollide: true, ink: INK.BLACK, seg: 14 });
      for (let k = 0; k < 3; k++) {
        box(mx - 0.2, PY + 0.035, mz - 0.16 + k * 0.16, 0.4, 0.015, 0.03, { noCollide: true, ink: INK.BLACK });
      }
    }

    // ---- 南墙内侧的标语牌（一整面墙太空了）----
    for (const sx of [-46, -22, 22, 58, 92]) {
      box(sx, GY + 1.35, WALL.z2 - 0.28, 3.2, 0.9, 0.06, { noCollide: true, ink: INK.RED, fill: true });
      box(sx, GY + 1.27, WALL.z2 - 0.28, 3.4, 0.08, 0.1, { noCollide: true, ink: INK.BLACK });
      box(sx, GY + 2.25, WALL.z2 - 0.28, 3.4, 0.08, 0.1, { noCollide: true, ink: INK.BLACK });
      for (let k = 0; k < 4; k++) {       // 牌面上四块黑条，远看就是四个字
        box(sx - 1.05 + k * 0.72, GY + 1.62, WALL.z2 - 0.33, 0.44, 0.4, 0.02, { noCollide: true, ink: INK.BLACK });
      }
    }

    // ---- 独立宣传栏（和主路那一个同款，另加两处）----
    for (const [px, pz] of [[-10.4, 46], [34.5, 40]]) {
      for (const s of [-1, 1]) box(px, GY, pz + s * 1.8, 0.16, 2.4, 0.16, { ink: INK.BLACK });
      box(px, GY + 0.62, pz, 0.09, 1.75, 3.6, { ink: INK.RED, fill: true });
      box(px - 0.06, GY + 0.68, pz, 0.05, 1.63, 3.4, { noCollide: true, ink: INK.BLACK });
      box(px, GY + 2.37, pz, 0.3, 0.15, 4.0, { noCollide: true, ink: INK.BLACK });
    }
  }

  // ================================================================
  //  可拾取道具
  // ================================================================
  const mkItem = (name, x, y, z, ink) => {
    const r = box(x, y, z, 0.46, 0.05, 0.32, { dynamic: true, noCollide: true, ink });
    pickups.push({ name, pos: new THREE.Vector3(x, y, z), mesh: r.mesh, taken: false });
  };
  // 钳子：不再摆在台面上，而是随机塞进器材室那一堆能翻的地方之一（searchSpots）。
  // 玩家进去得一个个翻，每处按住 E 站定 2 秒左右、翻完还要涨可疑度 ——
  // 这样"找钳子"才真的花时间，而不是进门顺手就摸走。
  {
    const idx = Math.floor(Math.random() * searchSpots.length);
    for (let i = 0; i < searchSpots.length; i++) searchSpots[i].hasTool = i === idx;
  }
  // 小卖部柜台上：一包辣条（凑生活气息）
  mkItem('辣条', SHOP.x2 - 1.5, GY + 1.12, (SHOP.z1 + SHOP.z2) / 2 + 2.2, INK.RED);

  // 椅子：食堂【二楼杂物间】里那把"因为松动被废弃"的椅子（翻西墙垫脚用）
  // 为什么非得是这一把：一楼大厅满地都是椅子，但那些都焊死在桌边、不能搬；
  // 只有杂物间这把螺丝松了、被扔在废纸堆里，才解释得通"为什么只能拿它"。
  const chairPos = new THREE.Vector3(CANTEEN.x2 - 6.4, CANTEEN_Y2, CANTEEN.z1 + 12.4);
  {
    const cx = chairPos.x, cz = chairPos.z;
    const cy = chairPos.y;           // 二楼地面（CANTEEN_Y2 = 3.55），不是 GY
    // 坑：box() 的 y 是底面。上一版靠背放在 cz-0.27、座面宽 0.62 ——
    // 靠背整个落在座面 z 范围内，看着像"从座面中间长出来一块板"，
    // 加上腿比座面窄一圈，就成了截图里那种错位重合。
    // 现在：座面 0.5×0.5，靠背贴在座面后沿【外侧】，四条腿内缩，再加四根横撑。
    const SW2 = 0.5;                 // 座面边长
    const SH2 = 0.36;                // 座面底面离地高（腿高）
    const STH = 0.09;                // 座面厚
    const parts = [
      // [x, y, z, w, h, d, ink]
      [cx, cy + SH2, cz, SW2, STH, SW2, INK.ORANGE],                             // 座面
      [cx, cy + SH2 + STH, cz - SW2 / 2 - 0.03, SW2, 0.52, 0.06, INK.ORANGE],    // 靠背（后沿外侧）
    ];
    // 四条腿（内缩 0.05，比座面窄一圈）。有一条腿短一截 —— 就是它松动的原因。
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const legH = (sx === 1 && sz === -1) ? SH2 - 0.06 : SH2;
        parts.push([cx + sx * (SW2 / 2 - 0.05), cy, cz + sz * (SW2 / 2 - 0.05), 0.06, legH, 0.06, INK.BLACK]);
      }
    }
    // 横撑：左右两根（沿 z）+ 前后两根（沿 x），离地 0.12
    for (const sx of [-1, 1]) {
      parts.push([cx + sx * (SW2 / 2 - 0.05), cy + 0.12, cz, 0.045, 0.05, SW2 - 0.14, INK.BLACK]);
    }
    for (const sz of [-1, 1]) {
      parts.push([cx, cy + 0.12, cz + sz * (SW2 / 2 - 0.05), SW2 - 0.14, 0.05, 0.045, INK.BLACK]);
    }
    const meshes = [];
    for (const [px, py, pz, pw, ph, pd, ink] of parts) {
      const r = box(px, py, pz, pw, ph, pd, { dynamic: true, noCollide: true, ink });
      if (r && r.mesh) meshes.push(r.mesh);
    }
    pickups.push({ name: '椅子', pos: chairPos.clone(), mesh: meshes[0], meshes, taken: false });
  }
  // 杂物间墙上贴的一张便条，解释这把椅子的来历（也是给玩家的提示）
  {
    const nx = CANTEEN.x2 - 9.9, nz = CANTEEN.z1 + 12.0;
    box(nx, CANTEEN_Y2 + 1.35, nz, 0.04, 0.34, 0.5, { noCollide: true, ink: INK.BLACK, fill: true });
  }

  const level = finish();

  return {
    gate: gateL,                       // game.js 兼容：开门时隐藏 + 移除碰撞体
    gateL, gateR,
    gateSpot: new THREE.Vector3((GATE.x1 + GATE.x2) / 2, GY + 0.05, WALL.z2 - 1.8),
    holeSpot: new THREE.Vector3((HOLE.x1 + HOLE.x2) / 2, GY + 0.05, WALL.z1 + 1.2),
    // 翻墙点：站在砖基东侧（校园内）
    lowWallSpot: new THREE.Vector3(WALL.x1 + 1.5, GY + 0.05, (LOW.z1 + LOW.z2) / 2),
    // 翻过去之后落在墙外
    lowWallOut: new THREE.Vector3(WALL.x1 - 1.6, GY + 0.05, (LOW.z1 + LOW.z2) / 2),
    hillTop: new THREE.Vector3(HILL.x1 + 4.0, GY + 0.05, (HILL.z1 + HILL.z2) / 2),
    // ---- 后山跑酷（v0.18）----
    // 路线（绕山半圈，先上半山腰再下山）：
    //   翻西墙落地 → 东侧台阶上一级台地 → 沿台地往南
    //   → 南侧台阶上半山腰 → 沿半山腰往西、再往北绕到西北角
    //   → 跳下半山腰（落差 2.4m，是路线的一部分，不算摔）
    //   → 沿台地往西 → 北侧台阶下山 → 穿过牌坊进小吃街 → 跑到街北口算完
    parkour: {
      start: new THREE.Vector3(WALL.x1 - 1.6, GY + 0.05, 39.6),
      checkpoints: [
        { x: -75.0, y: GY + 0.05, z: 39.6, name: '山脚' },
        { x: -80.0, y: GY + 2.45, z: 44.0, name: '一级台地' },
        { x: -90.0, y: GY + 4.85, z: 45.0, name: '半山腰' },
        { x: -97.0, y: GY + 2.45, z: 31.0, name: '西北坡' },
        { x: -96.0, y: PY + 0.05, z: 14.0, name: '小吃街' },
      ],
      // 终点：小吃街北口那条红横幅（街是 z 5~19，玩家从南边的牌坊进来往北跑）。
      // goalR 别给太大 —— 原来 3.2 会在离横幅还有 4 米多的地方就判定跑完，
      // 人还没到线就"通关"了，观感很怪。现在收在 1.8，基本是走到线前一步才算。
      goal: new THREE.Vector3(-96.0, PY + 0.05, 5.6),
      goalR: 1.8,
      // 山脚地面高度：落地时低于这个值才算"摔到了地上"（台阶之间的落差不算）
      groundY: GY,
      street: { x1: -103.0, x2: -89.0, z1: 5.0, z2: 19.0 },
      // 踩到山脚地面但不算"摔下去"的两块地方：
      // ① 起点那片（翻墙落地 + 第一段石柱脚下）② 西北角下山段（路线本来就是从这儿回到地面）
      // 别的地方从台地上掉到地面 = 掉下去了，扣时间 + 退回上一个检查点。
      groundOK: [
        { x1: -78.5, x2: -72.0, z1: 36.0, z2: 49.0 },     // 起点 / 东侧石柱脚下
        { x1: -102.5, x2: -95.0, z1: 19.0, z2: 27.5 },    // 西北角下山段
        { x1: -103.5, x2: -88.5, z1: 4.5, z2: 20.0 },     // 小吃街（地面高度和山脚一样）
      ],
    },
    hill: HILL,
    wall: WALL, lowWall: LOW, hole: HOLE, gateGap: GATE,
    holeWire,
    pickups,
    searchSpots,                       // 器材室里可以翻的地方（钳子随机藏在其中一个）
    bounds: level.bounds,
    npcs: [],
  };
}
