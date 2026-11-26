// ============================================================
// 箱庭：三楼（CampusFloor3）
//
// 一个「箱庭」= 一整层楼的自由空间，由 5 个矩形房间拼出来：
//
//            z-（里 / 黑板方向）
//     ┌──────────┐  ┌──────────┐
//     │ 另一间教室│  │          │
//     ├──────────┼──┘          │
//     │ 我的教室  ▓ 走廊  ┌─────┤   ← 我的教室东墙有「前门」「后门」通到走廊
//     ├──────────┤  ↑  │教师办公室│
//     │  女厕所   │  │  └─────┤
//     │          ▓ 走廊  ┌─────┤
//     │          │  │  │ 男厕所 │
//     └──────────┘  └───┴──────┘
//            z+（外）
//
// 坐标约定：X 右、Z 里外（-Z 是黑板一侧）、Y 上。
// 玩家出生在「我的教室」自己的座位上，面朝黑板。
//
// 门一律用 this.makeDoor(...) 造：一扇真实的门扇，按 F 在开/关之间切换，
// 门扇绕铰链平滑转开（被推开），只动门不动玩家。
//
// 这层楼是一个「世界」，不是「关」。以后要在这层里加玩法（潜行目标、
// 教导主任、可拾取物、楼梯出口等）都在本文件的 build() 里往上加。
// ============================================================

import * as THREE from 'three';
import { SceneBase, WorldBuilder } from '../scene-base.js';
import { buildScene } from '../../scene/scene-build.js';
import { normalizeScene } from '../../scene/schema.js';
import { SCENE, DESK_GRID, shouldHaveStudent, studentPoseOf, booksOf } from '../../scene/scene-data.js';
import { PatrolEnemy } from '../../reusable/enemy-base.js';

// 三楼各房间矩形（世界坐标，单位米）。
//   minX/maxX 左右；minZ/maxZ 里外；房间尺寸按要求：
//   我的教室 / 另一间教室 / 办公室 ≈ 教室大小（16×22），走廊宽≈教室宽，厕所≈半间教室。
export const ROOMS = [
  // 左列，从里到外
  { id: '另一间教室', minX: -22, maxX: -6, minZ: -33, maxZ: -11 },
  { id: '我的教室', minX: -22, maxX: -6, minZ: -11, maxZ: 11 },
  { id: '女厕所', minX: -18, maxX: -6, minZ: 11, maxZ: 22 },
  // 走廊：竖直长条
  { id: '走廊', minX: -6, maxX: 6, minZ: -33, maxZ: 22 },
  // 右列，从里到外
  { id: '教师办公室', minX: 6, maxX: 22, minZ: -11, maxZ: 11 },
  { id: '男厕所', minX: 6, maxX: 18, minZ: 11, maxZ: 22 },
];

// 门洞：房间之间连通。wall 指该房间的哪面墙，at 是门中心沿墙坐标。
// 注意：我的教室东墙开了两个门洞（前门 + 后门）。
export const DOORS = [
  // 我的教室：东墙靠后（+Z 端）= 后门；东墙靠前（-Z 端）= 前门
  { room: '我的教室', wall: 'e', at: 7.5, width: 2.2, id: 'door-classroom-back' },
  { room: '我的教室', wall: 'e', at: -7.5, width: 2.2, id: 'door-classroom-front' },
  // 教师办公室：西墙对走廊开门
  { room: '教师办公室', wall: 'w', at: 0, width: 2.2, id: 'door-office' },
  // 另一间教室：东墙对走廊开门
  { room: '另一间教室', wall: 'e', at: -22, width: 2.2, id: 'door-class2' },
  // 女厕所：东墙对走廊开门
  { room: '女厕所', wall: 'e', at: 16.5, width: 1.6, id: 'door-wc-f' },
  // 男厕所：西墙对走廊开门
  { room: '男厕所', wall: 'w', at: 16.5, width: 1.6, id: 'door-wc-m' },
];

// ---------- 粉笔文字工具（纯线稿，字由线段拼出来） ----------
// 5×7 点阵里画一笔「竖/横」；这里只为几块字牌服务（男厕/女厕/英语板书），
// 不追求字形完美，能认出即可。坐标是在字牌平面 (u,v) 上，u 右、v 上。
function strokeSeg(mat, parent, a, b, r = 0.012) {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const dir = new THREE.Vector3().subVectors(B, A);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(r, r, len, 4);
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(A).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  parent.add(m);
  return m;
}

// 用「横竖笔画」画一个中文字（每个字 0..1 方块内的一组线段）。
// 只含本场景要用的几个字：男、厕、女、卫（卫=卫）。不够可以再加。
const CN_STROKES = {
  '男': [
    // 田（上）
    [[0.1, 0.95], [0.9, 0.95]], [[0.1, 0.95], [0.1, 0.62]], [[0.9, 0.95], [0.9, 0.62]],
    [[0.1, 0.62], [0.9, 0.62]], [[0.5, 0.95], [0.5, 0.62]], [[0.1, 0.785], [0.9, 0.785]],
    // 力（下）
    [[0.5, 0.55], [0.5, 0.05]], [[0.5, 0.5], [0.85, 0.42]], [[0.85, 0.42], [0.82, 0.18]],
    [[0.82, 0.18], [0.62, 0.12]],
  ],
  '厕': [
    // 厂
    [[0.08, 0.98], [0.08, 0.08]], [[0.08, 0.98], [0.5, 0.98]],
    // 则（贝+刂）
    [[0.55, 0.9], [0.55, 0.55]], [[0.9, 0.9], [0.9, 0.55]],
    [[0.55, 0.9], [0.9, 0.9]], [[0.55, 0.55], [0.9, 0.55]],
    [[0.72, 0.55], [0.72, 0.06]], [[0.55, 0.06], [0.9, 0.06]],
  ],
  '女': [
    [[0.5, 0.98], [0.32, 0.55]], [[0.32, 0.55], [0.12, 0.42]],
    [[0.35, 0.72], [0.75, 0.55]], [[0.55, 0.62], [0.35, 0.15]], [[0.35, 0.15], [0.1, 0.08]],
    [[0.35, 0.15], [0.82, 0.08]], [[0.55, 0.45], [0.85, 0.75]],
  ],
  '卫': [
    [[0.15, 0.92], [0.85, 0.92]], [[0.15, 0.92], [0.15, 0.55]],
    [[0.15, 0.55], [0.7, 0.55]], [[0.7, 0.55], [0.7, 0.2]],
    [[0.7, 0.2], [0.55, 0.08]],
  ],
  '生': [
    [[0.3, 0.98], [0.3, 0.8]], [[0.15, 0.8], [0.85, 0.8]],
    [[0.5, 0.8], [0.5, 0.55]], [[0.15, 0.55], [0.85, 0.55]],
    [[0.5, 0.55], [0.5, 0.08]], [[0.1, 0.08], [0.9, 0.08]],
  ],
  '老': [
    [[0.15, 0.95], [0.85, 0.95]], [[0.5, 0.95], [0.5, 0.72]],
    [[0.15, 0.72], [0.85, 0.72]], [[0.3, 0.72], [0.3, 0.5]],
    [[0.7, 0.72], [0.7, 0.5]], [[0.5, 0.72], [0.5, 0.28]],
    [[0.5, 0.5], [0.15, 0.32]], [[0.4, 0.35], [0.25, 0.1]], [[0.3, 0.06], [0.88, 0.06]],
  ],
  '师': [
    [[0.1, 0.95], [0.1, 0.5]], [[0.1, 0.95], [0.45, 0.95]], [[0.1, 0.72], [0.45, 0.72]],
    [[0.1, 0.5], [0.45, 0.5]], [[0.5, 0.98], [0.9, 0.98]], [[0.7, 0.98], [0.7, 0.08]],
    [[0.5, 0.6], [0.9, 0.6]],
  ],
};

// 在 parent 里画一段竖排/横排的中文字，返回一个 Group。
//   word: 字符串（每个字一个块）；size: 字高（米）；pos: 世界坐标；facing: 'z-'/'z+'/'x+'/'x-'（字正面朝向）
function chalkWord(mat, parent, word, { pos, size = 0.5, gap = 0.1, facing = 'z-' }) {
  const g = new THREE.Group();
  g.position.set(...pos);
  // 让字所在平面朝向 facing，字面法线朝外。
  const yawMap = { 'z-': 0, 'z+': Math.PI, 'x+': Math.PI / 2, 'x-': -Math.PI / 2 };
  g.rotation.y = yawMap[facing] ?? 0;

  let u = 0;
  for (const ch of word) {
    const strokes = CN_STROKES[ch];
    const ox = u;
    if (strokes) {
      for (const [a, b] of strokes) {
        strokeSeg(mat, g, [ox + a[0] * size, a[1] * size, 0], [ox + b[0] * size, b[1] * size, 0], size * 0.028);
      }
    }
    u += size + gap;
  }
  // 居中
  g.position.x -= u / 2;
  parent.add(g);
  return g;
}

// 把一串「折线/闭合多边形」画到牌面局部平面 (u,v) 上，返回 Group。
//   segs: [[ [u0,v0],[u1,v1], ... ], ...]，每条线段列表会被 strokeSeg 连成笔画。
//   牌面在局部 (u,v,0)，u 右、v 上，原点在牌中心附近。
function drawSignGlyph(mat, segs, { cx = 0, cy = 0, scale = 1, r = 0.012 }) {
  const g = new THREE.Group();
  for (const poly of segs) {
    const pts = poly.map(([u, v]) => [cx + u * scale, cy + v * scale, 0]);
    for (let i = 0; i < pts.length - 1; i++) strokeSeg(mat, g, pts[i], pts[i + 1], r);
    if (pts.length > 2 && (poly[0][0] === poly[poly.length - 1][0] && poly[0][1] === poly[poly.length - 1][1])) {
      // 已显式闭合则无需补
    }
  }
  return g;
}

// 画一个圆形轮廓（用多段近似），单独列出便于画「头」。
function drawCircle(mat, parent, cx, cy, radius, r = 0.012, seg = 20) {
  const pts = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, 0]);
  }
  for (let i = 0; i < pts.length - 1; i++) strokeSeg(mat, parent, pts[i], pts[i + 1], r);
}

// 厕所标示牌：一块扁平板 + 简笔小人（图二：男=圆头+正三角张腿；女=圆头+梯形裙摆）。
//   pos: 牌中心世界坐标；facing: 'x+'/'x-'/'z+'/'z-'；plateW/plateH: 板尺寸（米）。
function drawToiletSign(mat, parent, kind, { pos, facing = 'x+', plateW = 0.9, plateH = 0.62 }) {
  const outer = new THREE.Group();
  outer.position.set(...pos);
  const yawMap = { 'z-': 0, 'z+': Math.PI, 'x+': Math.PI / 2, 'x-': -Math.PI / 2 };
  outer.rotation.y = yawMap[facing] ?? 0;

  // 牌底板（极薄的盒子，略小于人像留白），贴墙。
  const thick = 0.03;
  const plate = new THREE.Mesh(new THREE.BoxGeometry(plateW, plateH, thick), mat);
  outer.add(plate);

  // 人像画在牌面上（局部 z 略前移，避免 z-fighting）。
  const g = new THREE.Group();
  g.position.z = thick / 2 + 0.004;
  outer.add(g);

  const R = 0.014;                 // 笔画粗细
  const H = plateH;                // 牌高
  const headR = H * 0.20;
  const headCy = H * 0.27;         // 头心偏上（占据牌面上部）

  // 头（圆）
  drawCircle(mat, g, 0, headCy, headR, R, 26);

  if (kind === 'man') {
    // 正三角形张腿：肩在头正下方两侧 → 汇聚到底端一点（倒三角）。
    const topY = headCy - headR - H * 0.04;
    const halfW = H * 0.26;
    const botY = -H * 0.36;
    strokeSeg(mat, g, [-halfW, topY, 0], [halfW, topY, 0], R);           // 肩线
    strokeSeg(mat, g, [-halfW, topY, 0], [0, botY, 0], R);               // 左腿
    strokeSeg(mat, g, [halfW, topY, 0], [0, botY, 0], R);                // 右腿
  } else {
    // 梯形裙摆：肩窄、下摆宽。
    const topY = headCy - headR - H * 0.04;
    const topHalf = H * 0.15;
    const botY = -H * 0.36;
    const botHalf = H * 0.30;
    strokeSeg(mat, g, [-topHalf, topY, 0], [topHalf, topY, 0], R);       // 肩线
    strokeSeg(mat, g, [topHalf, topY, 0], [botHalf, botY, 0], R);        // 右腰
    strokeSeg(mat, g, [botHalf, botY, 0], [-botHalf, botY, 0], R);       // 裙摆
    strokeSeg(mat, g, [-botHalf, botY, 0], [-topHalf, topY, 0], R);      // 左腰
  }

  parent.add(outer);
  return outer;
}

// ---------- 我的教室完整布置 ----------
function buildMyClassroomObjects(room) {
  const cx = (room.minX + room.maxX) / 2;
  const cz = (room.minZ + room.maxZ) / 2;
  const data = normalizeScene(SCENE);
  const objects = [];

  for (const o of data.objects) {
    const clone = JSON.parse(JSON.stringify(o));
    if (clone.pos) clone.pos = [clone.pos[0] + cx, clone.pos[1], clone.pos[2] + cz];
    if (clone.segments) {
      clone.segments = clone.segments.map((seg) =>
        seg.map((p) => [p[0] + cx, p[1], p[2] + cz]));
    }
    // 旧的后门画（door-frame / door-ground-mark）不再用——门改成真正的门扇。
    if (clone.id === 'door-frame' || clone.id === 'door-ground-mark') continue;
    // 讲台改由下方代码按「靠黑板」重新摆放；黑板位置不动。
    if (clone.id === 'podium') continue;
    objects.push(clone);
  }

  const grid = DESK_GRID;
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const x = cx + grid.originX + col * grid.stepX;
      const z = cz + grid.originZ + row * grid.stepZ;
      const isPlayerSeat = row === grid.playerSeat.row && col === grid.playerSeat.col;
      const key = `${row}-${col}`;
      const deskFlags = { collide: true, noise: true, occlude: true, tag: 'desk' };
      objects.push({
        id: `desk-${key}`, type: 'prefab', prefab: 'desk', pos: [x, 0, z],
        params: { width: grid.deskWidth, depth: grid.deskDepth, topY: grid.deskTopY, topThickness: grid.deskTopThickness },
        flags: deskFlags,
        colliders: [{ pos: [0, grid.deskTopY, 0], size: [grid.deskWidth, grid.deskTopThickness, grid.deskDepth], flags: deskFlags }],
      });
      const chairFlags = { collide: !isPlayerSeat, noise: !isPlayerSeat, occlude: false, tag: 'chair' };
      objects.push({
        id: `chair-${key}`, type: 'prefab', prefab: 'chair', pos: [x, 0, z + grid.chairOffsetZ],
        flags: chairFlags,
        colliders: [{ pos: [0, 0.48, 0], size: [0.72, 0.1, 0.68], flags: chairFlags }],
      });
      for (const b of booksOf(row, col)) {
        objects.push({ id: b.id, type: 'prefab', prefab: 'book', pos: [x + b.x, 0, z + b.z], params: { seed: b.seed } });
      }
      if (shouldHaveStudent(row, col, isPlayerSeat)) {
        objects.push({ id: `student-${key}`, type: 'prefab', prefab: 'classmate', pos: [x, 0, z], params: { pose: studentPoseOf(row, col) } });
      }
    }
  }

  // 出生座位
  const seatX = cx + grid.originX + grid.playerSeat.col * grid.stepX;
  const seatZ = cz + grid.originZ + grid.playerSeat.row * grid.stepZ;
  return { objects, seat: { x: seatX, z: seatZ }, center: { cx, cz } };
}

// 另一间教室：桌椅 + 学生（用同一套 DESK_GRID，缩到 3×3 区域）
function buildClass2Objects(room) {
  const cx = (room.minX + room.maxX) / 2;
  const cz = (room.minZ + room.maxZ) / 2;
  const objects = [];
  const cols = 3, rows = 3;
  const stepX = 4.4, stepZ = 4.2;
  const startX = cx - ((cols - 1) * stepX) / 2;
  const startZ = cz - ((rows - 1) * stepZ) / 2 - 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = startX + c * stepX;
      const z = startZ + r * stepZ;
      const key = `${r}-${c}`;
      const deskFlags = { collide: true, noise: true, occlude: true, tag: 'desk' };
      objects.push({
        id: `c2-desk-${key}`, type: 'prefab', prefab: 'desk', pos: [x, 0, z],
        params: { width: 1.8, depth: 0.9, topY: 0.95, topThickness: 0.12 },
        flags: deskFlags,
        colliders: [{ pos: [0, 0.95, 0], size: [1.8, 0.12, 0.9], flags: deskFlags }],
      });
      const chairFlags = { collide: true, noise: true, occlude: false, tag: 'chair' };
      objects.push({
        id: `c2-chair-${key}`, type: 'prefab', prefab: 'chair', pos: [x, 0, z + 0.82],
        flags: chairFlags,
        colliders: [{ pos: [0, 0.48, 0], size: [0.72, 0.1, 0.68], flags: chairFlags }],
      });
      // 每个桌位都有学生（上英语课）
      objects.push({
        id: `c2-student-${key}`, type: 'prefab', prefab: 'classmate', pos: [x, 0, z],
        params: { pose: (r + c) % 2 === 0 ? 'read' : 'sleep' },
      });
      objects.push({ id: `c2-book-${key}`, type: 'prefab', prefab: 'book', pos: [x - 0.38, 0, z], params: { seed: r * 3 + c } });
    }
  }
  return { objects, center: { cx, cz }, boardZ: cz - 8 };
}

// 其它房间的家具占位
function buildRoomFixtures(room) {
  const objs = [];
  const cx = (room.minX + room.maxX) / 2;
  const cz = (room.minZ + room.maxZ) / 2;
  const w = room.maxX - room.minX;
  const d = room.maxZ - room.minZ;
  const flag = { collide: true, occlude: true };
  if (room.id === '教师办公室') {
    for (let i = 0; i < 3; i++) {
      const x = room.minX + 4 + i * 4.5;
      objs.push({ id: `office-desk-${i}`, type: 'prefab', prefab: 'desk', pos: [x, 0, cz - 2], params: { width: 1.9, depth: 1.0 },
        flags: flag, colliders: [{ pos: [0, 0.95, 0], size: [1.9, 0.12, 1.0], flags: flag }] });
    }
    objs.push({ id: 'office-shelf', type: 'box', pos: [cx, 1.0, room.minZ + 0.6], size: [w - 3, 2.0, 0.5], flags: { ...flag, tag: 'shelf' } });
  } else if (room.id === '女厕所' || room.id === '男厕所') {
    const n = 3;
    for (let i = 0; i < n; i++) {
      const x = room.minX + 2 + i * ((w - 3) / n);
      objs.push({ id: `${room.id}-stall-${i}`, type: 'box', pos: [x, 1.0, room.maxZ - 1.2], size: [0.15, 1.8, 1.6], flags: { ...flag, tag: 'stall' } });
      objs.push({ id: `${room.id}-wc-${i}`, type: 'box', pos: [x + 0.6, 0.3, room.maxZ - 1.2], size: [0.4, 0.6, 0.6], flags: { collide: true, occlude: false, tag: 'wc' } });
    }
  }
  return objs;
}

export class Floor3Scene extends SceneBase {
  static meta = {
    id: 'floor3',
    name: '三楼 · 我的教室',
    next: null,
    prev: null,
  };

  build(ctx) {
    const helpers = this.getHelpers(ctx);
    const mat = this.mat;
    this.root = new THREE.Group();
    this.root.name = `sandbox-${this.meta.id}`;
    ctx.scene.add(this.root);

    this.rooms = ROOMS;

    // ---- 1) 空间外壳 ----
    const world = new WorldBuilder(this, helpers, { rooms: ROOMS, doors: DOORS, height: 4.2 });
    world.buildAll();

    const myRoom = ROOMS.find((r) => r.id === '我的教室');
    const class2Room = ROOMS.find((r) => r.id === '另一间教室');

    // ---- 2) 我的教室完整布置 ----
    const { objects: classroomObjs, seat } = buildMyClassroomObjects(myRoom);
    const cx0 = (myRoom.minX + myRoom.maxX) / 2;
    const cdata = normalizeScene({ objects: classroomObjs });
    buildScene(this.root, cdata, (box) => {
      if (box.collide) this.walls.push(box);
      if (box.occlude) this.occluders.push(box);
    }).root.name = 'my-classroom-layout';

    // ---- 2c) 讲台：摆在黑板与老师之间 ----
    // 老师站在讲台「后面」（更靠黑板），写板书时转身面朝黑板、手够得到板面；
    // 回头看学生时面朝 +Z，讲台就在他身前（符合参考图）。
    {
      // 黑板面（朝 +Z 的那一面）的 z 坐标，用来精确摆讲台和老师。
      const boardFaceZ = myRoom.minZ + 0.18;      // 黑板前表面
      // 讲台：薄一点、往前挪，给老师留出「站黑板前伸手够到板面」的站位。
      const podiumZ = boardFaceZ + 1.15;          // 讲台中心
      const podium = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.1, 0.5), mat);
      podium.position.set(cx0, 0.55, podiumZ);
      this.root.add(podium);
      this.walls.push({ id: 'podium', minX: cx0 - 1.6, maxX: cx0 + 1.6, minY: 0, maxY: 1.1, minZ: podiumZ - 0.25, maxZ: podiumZ + 0.25, collide: true, occlude: true, noise: true, tag: 'podium' });
      this._teacherHomeZ = boardFaceZ + 0.72;     // 老师站位：距板面约 0.72m，伸手正好够到
    }

    // ---- 3) 另一间教室：桌椅 + 学生 + 英语黑板 ----
    const c2 = buildClass2Objects(class2Room);
    const c2data = normalizeScene({ objects: c2.objects });
    buildScene(this.root, c2data, (box) => {
      if (box.collide) this.walls.push(box);
      if (box.occlude) this.occluders.push(box);
    }).root.name = 'class2-layout';
    // 英语黑板（在另一教室 -Z 端墙上）+ 粉笔英文板书（用短线段拼几行）
    const board2Z = class2Room.minZ + 0.14;
    const board2 = new THREE.Mesh(new THREE.BoxGeometry(9, 2.2, 0.1), mat);
    board2.position.set(c2.center.cx, 2.2, board2Z);
    this.root.add(board2);
    this._buildEnglishBoard(mat, c2.center.cx, board2Z + 0.08, 2.2);
    // 另一教室讲台
    const podium2 = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.1, 1.0), mat);
    podium2.position.set(c2.center.cx, 0.55, board2Z + 1.6);
    this.root.add(podium2);
    this.walls.push({ id: 'c2-podium', minX: c2.center.cx - 1.4, maxX: c2.center.cx + 1.4, minY: 0, maxY: 1.1, minZ: board2Z + 1.1, maxZ: board2Z + 2.1, collide: true, occlude: true, noise: true, tag: 'podium' });
    this.occluders.push(this.walls[this.walls.length - 1]);

    // ---- 4) 其它房间家具 ----
    const otherRooms = ROOMS.filter((r) => r.id !== '我的教室' && r.id !== '另一间教室');
    const fixObjs = otherRooms.flatMap((r) => buildRoomFixtures(r));
    if (fixObjs.length) {
      const fdata = normalizeScene({ objects: fixObjs });
      buildScene(this.root, fdata, (box) => {
        if (box.collide) this.walls.push(box);
        if (box.occlude) this.occluders.push(box);
      }).root.name = 'room-fixtures';
    }

    // ---- 4b) 男厕小便池（一排靠墙的立式便斗） ----
    const mRoom = ROOMS.find((r) => r.id === '男厕所');
    {
      const urinalZ = mRoom.minZ + 0.35;
      const n = 4;
      for (let i = 0; i < n; i++) {
        const x = mRoom.minX + 2 + i * 2.6;
        const bowl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.35), mat);
        bowl.position.set(x, 1.0, urinalZ);
        this.root.add(bowl);
        // 顶部斜管
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.4, 5), mat);
        pipe.position.set(x, 1.5, urinalZ - 0.12);
        pipe.rotation.x = 0.5;
        this.root.add(pipe);
      }
    }

    // ---- 4c) 厕所门口标示牌（简笔小人图，代替字） ----
    // 贴在门扇正面中上部，门关着时正对走廊，玩家走到门口抬头即可见。
    // 门宽 1.6、高 2.4；牌中心在门扇局部 +X 方向 width/2，高度 ~1.7 与视线齐平。
    {
      // 先建门扇（4c 在门前生成，这里改成缓冲，等门生成后再贴牌）
      // 记录需求，门循环后再统一贴牌（见下方 4d）。
      this._pendingToiletSigns = [
        { doorId: 'door-wc-f', kind: 'woman' },
        { doorId: 'door-wc-m', kind: 'man' },
      ];
    }

    // ---- 5) 门扇（按 F 开关）：我的教室前/后门、另一教室、办公室、男女厕 ----
    // makeDoor 参数：hinge 铰链[x,z]，width 门宽，height 门高，closedDir 关门贴合墙方向。
    // 西/东墙门：门都沿 z 方向（closedDir 'z+' 或 'z-'）。
    const makeDoorFromOpening = (opening, name, opts = {}) => {
      const room = ROOMS.find((r) => r.id === opening.room);
      const wallX = opening.wall === 'e' ? room.maxX : room.minX;
      const at = opening.at;
      const half = opening.width / 2;
      // 铰链取门洞一端。'z+'：门从铰链沿 +z 展开；'z-'：沿 -z 展开。
      const closedDir = opts.closedDir ?? 'z+';
      const hingeZ = closedDir === 'z+' ? at - half : at + half;
      return this.makeDoor(helpers, {
        id: opening.id,
        name,
        hinge: [wallX, hingeZ],
        width: opening.width,
        height: 2.4,
        closedDir,
        // 打开时朝房间内侧或走廊侧推：由 openSign 决定，绕铰链转。
        openAngle: 95,
        openSign: opts.openSign ?? 1,
      });
    };

    for (const d of DOORS) {
      let name = '门';
      let opts = {};
      if (d.id === 'door-classroom-back') { name = '教室后门'; opts = { closedDir: 'z+', openSign: -1 }; }
      else if (d.id === 'door-classroom-front') { name = '教室前门'; opts = { closedDir: 'z-', openSign: 1 }; }
      else if (d.id === 'door-class2') { name = '教室门'; opts = { closedDir: 'z+', openSign: -1 }; }
      else if (d.id === 'door-office') { name = '办公室门'; opts = { closedDir: 'z+', openSign: 1 }; }
      else if (d.id === 'door-wc-f') { name = '女厕门'; opts = { closedDir: 'z+', openSign: -1 }; }
      else if (d.id === 'door-wc-m') { name = '男厕门'; opts = { closedDir: 'z-', openSign: 1 }; }
      makeDoorFromOpening(d, name, opts);
    }

    // ---- 4d) 厕所标示牌：贴到对应门扇（leaf）正面中上部 ----
    // leaf 局部：几何中心在 (width/2,0,0)，厚在 z 方向。牌贴哪一面取决于门扇
    // 关闭时哪面朝走廊——男厕门朝 -X、女厕门朝 +X（见下方几何推导）。
    if (this._pendingToiletSigns) {
      for (const req of this._pendingToiletSigns) {
        const door = this.doors.find((dd) => dd.id === req.doorId);
        if (!door || !door.leaf) continue;
        const w = door.width, h = door.height, th = door.thickness;
        // 两块门牌都贴门扇朝走廊的那一面（实测两家门扇朝走廊均为局部 -z 面）。
        const sign = drawToiletSign(mat, door.leaf, req.kind, {
          pos: [0, 0, 0], facing: 'z-',
          plateW: Math.min(0.62, w * 0.40), plateH: Math.min(0.80, w * 0.52),
        });
        sign.position.set(0, h * 0.06, -(th / 2 + 0.006));
        sign.rotation.y = Math.PI;  // 牌面朝门扇局部 -z（走廊侧）
      }
      this._pendingToiletSigns = null;
    }

    // ---- 6) 出生点：我的教室自己的座位，面朝黑板（-Z） ----
    // 坐在椅子上、但往后挪一点离桌子，避免一移动就撞桌（撞桌=噪声=老师回头）。
    // 面朝黑板为「前」，往后挪 = 朝 +Z 再退 0.75（0.55 基础 + 额外 0.2）。
    this.spawn = { pos: new THREE.Vector3(seat.x, 1.6, seat.z + 0.75), yaw: 0 };
    this.checkpoint = { pos: this.spawn.pos.clone(), yaw: 0 };

    // ---- 7) 老师（可复用 PatrolEnemy）：我的教室 + 另一间教室 ----
    // 回头频率调低（lookInterval 12~20 秒），方便测试时不被频繁发现。
    const mcCx = (myRoom.minX + myRoom.maxX) / 2;
    const mcCz = (myRoom.minZ + myRoom.maxZ) / 2;
    const myTeacher = new PatrolEnemy(this.root, {
      mat,
      // 站在讲台「后面」紧靠黑板：写板书时面朝 -Z、手前伸够到板面；
      // 回头看学生时面朝 +Z，讲台正好在他身前（参考图的摆位）。
      home: [mcCx, 0, this._teacherHomeZ ?? (myRoom.minZ + 0.9)],
      patrolPoints: [
        [mcCx + 5, 0, mcCz - 6],
        [mcCx + 5, 0, mcCz + 6],
        [mcCx - 5, 0, mcCz + 6],
        [mcCx - 5, 0, mcCz - 6],
      ],
      speed: 1.6, viewDist: 20, viewHalfAngle: 32,
      writeDuration: 1e9, lookInterval: [12, 20],
      walls: this.walls, occluders: this.occluders,
      room: { w: myRoom.maxX - myRoom.minX, d: myRoom.maxZ - myRoom.minZ },
    });
    this.npcs.push({ kind: 'teacher', enemy: myTeacher });

    const c2cx = c2.center.cx;
    const c2cz = c2.center.cz;
    const c2Teacher = new PatrolEnemy(this.root, {
      mat,
      home: [c2cx, 0, board2Z + 2.2],
      patrolPoints: [
        [c2cx + 4, 0, c2cz - 4], [c2cx + 4, 0, c2cz + 4],
        [c2cx - 4, 0, c2cz + 4], [c2cx - 4, 0, c2cz - 4],
      ],
      speed: 1.5, viewDist: 18, viewHalfAngle: 30,
      writeDuration: 1e9, lookInterval: [14, 24],
      walls: this.walls, occluders: this.occluders,
      room: { w: class2Room.maxX - class2Room.minX, d: class2Room.maxZ - class2Room.minZ },
    });
    this.npcs.push({ kind: 'teacher', enemy: c2Teacher });
  }

  // 在另一教室黑板上画几行「英文」板书（每行是若干段短横线模拟英文单词）。
  _buildEnglishBoard(mat, cx, z, boardY) {
    const g = new THREE.Group();
    g.position.set(cx, boardY, z);
    g.rotation.y = Math.PI; // 字面朝 +Z（房间内）
    const r = 0.018;
    // 三行板书，每行在 y 方向排列，用横线段+点拼出 "英文" 字样感觉。
    const rows = [
      { y: 0.7, words: [4, 6, 3, 5] },   // 每段代表一个单词的宽度
      { y: 0.1, words: [5, 3, 7, 2] },
      { y: -0.5, words: [6, 2, 4, 3] },
    ];
    for (const row of rows) {
      let x = -3.6;
      for (const wlen of row.words) {
        // 一个「单词」= 一条波浪状的短横线（用几段小线段拼）
        const segs = wlen;
        for (let i = 0; i < segs; i++) {
          const x0 = x + i * 0.16;
          const yj = row.y + (i % 2 === 0 ? 0.04 : -0.04);
          strokeSeg(mat, g, [x0, yj, 0], [x0 + 0.14, yj + (i % 2 === 0 ? 0.03 : -0.03), 0], r);
        }
        x += wlen * 0.16 + 0.4; // 词间距
      }
    }
    this.root.add(g);
  }
}

export default new Floor3Scene();
