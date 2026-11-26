// ============================================================
// 可复用敌人基类 —— 粉笔火柴人 PatrolEnemy。
//
// 这是「可复用的敌人逻辑」：一个会巡逻、会回头、会用视锥检测、
// 发现玩家会追逐的粉笔老师。任何关卡想要一个这样的敌人都能直接
// new PatrolEnemy(scene, 配置)，不用重写 AI。
//
// 而「关卡独有的敌人」——比如只在第一关出现的教导主任、只在教室
// 出现的数学老师——则是各关卡文件夹里配一份配置（外观 + 巡逻点 +
// 视野参数），仍然复用这里的逻辑，只是数据不同。
//
// 与旧 teacher.js 的区别：不再依赖全局 ROOM/PATROL_POINTS，
// 巡逻点、视野、速度全部从 config 传入；碰撞/遮挡盒由关卡提供。
// ============================================================

import * as THREE from 'three';
import { makeChalkMaterial } from '../chalk.js';

const tmpDir = new THREE.Vector3();

// ---- 造型工具：关节肢体 / 椭球 / 鞋 ----
function jointLimb(mat, parent, x, y, z, length, radius) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  parent.add(pivot);
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3((Math.random() - 0.5) * 0.035, -length * 0.5, 0.022),
    new THREE.Vector3(0, -length, 0),
  );
  pivot.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 6, radius, 6, false), mat));
  return pivot;
}
function chalkSphere(mat, parent, r, x, y, z, sx = 1, sy = 1, sz = 1) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 7), mat);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  parent.add(mesh);
  return mesh;
}
function chalkShoe(mat, parent, y, z = -0.05) {
  return chalkSphere(mat, parent, 0.09, 0, y, z, 1, 0.55, 1.75);
}

// 线段与 AABB 求交，用于真实的遮挡判定。
function segmentHitsBox(a, b, box) {
  let tMin = 0;
  let tMax = 1;
  for (const axis of ['x', 'y', 'z']) {
    const min = box[`min${axis.toUpperCase()}`];
    const max = box[`max${axis.toUpperCase()}`];
    const delta = b[axis] - a[axis];
    if (Math.abs(delta) < 1e-7) {
      if (a[axis] < min || a[axis] > max) return false;
      continue;
    }
    let t1 = (min - a[axis]) / delta;
    let t2 = (max - a[axis]) / delta;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return false;
  }
  return tMax > 0.001 && tMin < 0.999;
}

// ============================================================
// PatrolEnemy
// config:
//   home          [x,y,z]  写板书时的站位（讲台）
//   patrolPoints  [[x,y,z],...] 巡逻一周的关键点（可为空=只站桩回头）
//   routeExtra    [[x,y,z],...] 可选，插在 patrolPoints 之间的绕行点
//   speed         巡逻速度（默认 1.8）
//   viewDist      视距（默认 26）
//   viewHalfAngle 视锥半角（度，默认 32）
//   eyeHeight     眼睛高度（默认 1.75）
//   writeDuration 写板书持续多久后开始巡一圈（秒，默认 45）
//   walls/occluders  关卡提供的碰撞/遮挡盒引用（用于追逐寻路与视线遮挡）
//   onCaught      被发现并追上时的回调（引擎注入）
// ============================================================
export class PatrolEnemy {
  constructor(scene, config = {}) {
    const mat = config.mat || makeChalkMaterial();
    this.config = config;
    this.home = new THREE.Vector3(...(config.home || [0, 0, 0]));
    this.patrolPoints = (config.patrolPoints || []).map((p) => new THREE.Vector3(...p));
    this.routeExtra = (config.routeExtra || []).map((p) => new THREE.Vector3(...p));
    this.speed = config.speed ?? 1.8;
    this.viewDist = config.viewDist ?? 26;
    this.viewHalfAngleDeg = config.viewHalfAngle ?? 32;
    this.eyeHeight = config.eyeHeight ?? 1.75;
    this.writeDuration = config.writeDuration ?? 45;
    // 回头间隔（秒）：写板书时每隔这么久回头看一眼，[min,max] 区间随机。
    // 想让老师少回头（方便测试）就把它调大，比如 [12, 20]。
    this.lookInterval = config.lookInterval || [3, 6];
    this.walls = config.walls || [];
    this.occluders = config.occluders || [];
    this.room = config.room || { w: 20, d: 20 };

    this._buildModel(mat, config);

    scene.add(this.group);
    this.pos = new THREE.Vector3();
    this.facing = new THREE.Vector3(0, 0, -1);
    this.facingAngle = Math.PI;
    // 看向方向（回头/预警时用）。缺这行会在第一次回头时 this.lookDir.set 抛错卡死。
    this.lookDir = new THREE.Vector3(0, 0, 1);
    this.reset();
  }

  _buildModel(mat, config) {
    this.group = new THREE.Group();
    // 髋部作为身体根。
    this.hips = new THREE.Group();
    this.hips.position.y = 0.96;
    this.group.add(this.hips);

    const torso = new THREE.Group();
    torso.position.y = 0.03;
    this.hips.add(torso);
    this.torso = torso;

    chalkSphere(mat, torso, 1, 0, 0.30, 0, 0.27, 0.34, 0.18);
    const coat = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.29, 0.2, 7), mat);
    coat.position.set(0, 0.03, 0);
    torso.add(coat);
    for (const sx of [-1, 1]) {
      const lapel = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.2, 0.018), mat);
      lapel.position.set(sx * 0.055, 0.47, -0.158);
      lapel.rotation.z = sx * 0.36;
      torso.add(lapel);
    }
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.052, 0.11, 6), mat);
    neck.position.y = 0.60;
    torso.add(neck);

    const headG = new THREE.Group();
    headG.position.y = 0.74;
    torso.add(headG);
    this.head = headG;
    chalkSphere(mat, headG, 0.24, 0, 0, 0, 1, 1.12, 0.86);
    chalkSphere(mat, headG, 0.105, 0, 0.02, 0.205, 1, 0.95, 1);
    const bunTie = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.009, 4, 10), mat);
    bunTie.position.set(0, 0.02, 0.18);
    headG.add(bunTie);

    for (const sx of [-1, 1]) {
      chalkSphere(mat, headG, 0.032, sx * 0.083, 0.045, -0.195, 0.78, 1, 0.45);
      chalkSphere(mat, headG, 0.013, sx * 0.083, 0.045, -0.229, 1, 1, 0.55);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.012, 0.012), mat);
      brow.position.set(sx * 0.083, 0.105, -0.212);
      brow.rotation.z = sx * -0.12;
      headG.add(brow);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.072, 0.008, 4, 14), mat);
      rim.position.set(sx * 0.083, 0.045, -0.232);
      headG.add(rim);
      const temple = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.008, 0.008), mat);
      temple.position.set(sx * 0.15, 0.058, -0.192);
      temple.rotation.y = sx * -0.45;
      headG.add(temple);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.008, 0.008), mat);
    bridge.position.set(0, 0.05, -0.233);
    headG.add(bridge);
    chalkSphere(mat, headG, 0.018, 0, -0.01, -0.236, 1, 1.3, 0.6);
    const mouth = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-0.052, -0.088, -0.218),
      new THREE.Vector3(0, -0.112, -0.228),
      new THREE.Vector3(0.052, -0.088, -0.218),
    ), 5, 0.007, 5, false), mat);
    headG.add(mouth);

    const shoulderY = 0.52;
    this.leftArm = jointLimb(mat, torso, -0.265, shoulderY, 0, 0.30, 0.045);
    this.leftFore = jointLimb(mat, this.leftArm, 0, -0.30, 0, 0.28, 0.040);
    chalkSphere(mat, this.leftFore, 0.042, 0, -0.29, 0, 1, 1.1, 0.8);
    this.rightArm = jointLimb(mat, torso, 0.265, shoulderY, 0, 0.30, 0.045);
    this.rightFore = jointLimb(mat, this.rightArm, 0, -0.30, 0, 0.28, 0.040);
    chalkSphere(mat, this.rightFore, 0.042, 0, -0.29, 0, 1, 1.1, 0.8);

    const book = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 0.075), mat);
    book.position.set(-0.015, -0.25, -0.055);
    book.rotation.set(-0.18, 0.08, -0.12);
    this.leftFore.add(book);
    const chalk = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.11, 6), mat);
    chalk.position.set(0, -0.315, -0.015);
    chalk.rotation.x = 0.25;
    this.rightFore.add(chalk);

    this.leftThigh = jointLimb(mat, this.hips, -0.13, 0.01, 0, 0.47, 0.058);
    this.rightThigh = jointLimb(mat, this.hips, 0.13, 0.01, 0, 0.47, 0.058);
    this.leftShin = jointLimb(mat, this.leftThigh, 0, -0.47, 0, 0.43, 0.050);
    this.rightShin = jointLimb(mat, this.rightThigh, 0, -0.47, 0, 0.43, 0.050);
    chalkShoe(mat, this.leftShin, -0.43);
    chalkShoe(mat, this.rightShin, -0.43);

    this.leftLeg = this.leftThigh;
    this.rightLeg = this.rightThigh;
  }

  // ---- 寻路（A*，仅用于被抓后的追逐演出） ----
  _buildPath(from, to) {
    const ROOM = this.room;
    const GRID = 0.5;
    const NX = Math.floor((ROOM.w - 1) / GRID) + 1;
    const NZ = Math.floor((ROOM.d - 1) / GRID) + 1;
    const gridToWorld = (ix, iz) => new THREE.Vector3(
      -ROOM.w / 2 + 0.5 + ix * GRID, 0, -ROOM.d / 2 + 0.5 + iz * GRID,
    );
    const worldToGrid = (p) => ({
      x: Math.max(0, Math.min(NX - 1, Math.round((p.x + ROOM.w / 2 - 0.5) / GRID))),
      z: Math.max(0, Math.min(NZ - 1, Math.round((p.z + ROOM.d / 2 - 0.5) / GRID))),
    });
    const blocked = (ix, iz) => {
      if (ix < 0 || iz < 0 || ix >= NX || iz >= NZ) return true;
      const p = gridToWorld(ix, iz);
      const r = 0.28;
      return this.walls.some((w) => p.x > w.minX - r && p.x < w.maxX + r && p.z > w.minZ - r && p.z < w.maxZ + r);
    };
    const nearestFree = (cell) => {
      if (!blocked(cell.x, cell.z)) return cell;
      for (let radius = 1; radius < 8; radius++) {
        for (let dx = -radius; dx <= radius; dx++) {
          for (let dz = -radius; dz <= radius; dz++) {
            if (Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;
            if (!blocked(cell.x + dx, cell.z + dz)) return { x: cell.x + dx, z: cell.z + dz };
          }
        }
      }
      return cell;
    };
    const start = nearestFree(worldToGrid(from));
    const goal = nearestFree(worldToGrid(to));
    const key = (x, z) => `${x},${z}`;
    const open = [{ ...start, g: 0, f: 0 }];
    const came = new Map();
    const costs = new Map([[key(start.x, start.z), 0]]);
    const closed = new Set();
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    while (open.length) {
      open.sort((a, b) => a.f - b.f);
      const cur = open.shift();
      const ck = key(cur.x, cur.z);
      if (closed.has(ck)) continue;
      closed.add(ck);
      if (cur.x === goal.x && cur.z === goal.z) {
        const cells = [cur];
        let cursor = ck;
        while (came.has(cursor)) {
          const parent = came.get(cursor);
          cells.push(parent);
          cursor = key(parent.x, parent.z);
        }
        cells.reverse();
        return cells.slice(1).map((c) => gridToWorld(c.x, c.z));
      }
      for (const [dx, dz] of dirs) {
        const x = cur.x + dx; const z = cur.z + dz;
        if (blocked(x, z)) continue;
        if (dx && dz && (blocked(cur.x + dx, cur.z) || blocked(cur.x, cur.z + dz))) continue;
        const nk = key(x, z);
        const g = cur.g + Math.hypot(dx, dz);
        if (g >= (costs.get(nk) ?? Infinity)) continue;
        costs.set(nk, g);
        came.set(nk, { x: cur.x, z: cur.z });
        open.push({ x, z, g, f: g + Math.hypot(goal.x - x, goal.z - z) });
      }
    }
    return [];
  }

  reset() {
    this.state = 'writing';
    this.pos.copy(this.home);
    this.facing.set(0, 0, -1);
    this.facingAngle = Math.PI;
    this.group.position.copy(this.pos);
    this.group.rotation.y = 0;
    this.lookTimer = this._randomLookDelay();
    this.patrolClock = 0;
    this.stateTimer = 0;
    this.routeIndex = 0;
    this.returnState = 'writing';
    this.detected = false;
    this.arrived = false;
    this.chasePath = null;
    this.walkPhase = 0;
    this.walkBlend = 0;
    this.writeBlend = 1;
    this.movingThisFrame = false;
    this.hips.position.y = 0.96;
    this.torso.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, 0);
  }

  _randomLookDelay() {
    const [a, b] = this.lookInterval;
    return a + Math.random() * (b - a);
  }

  beginLook(duration = 0.4, towardPlayer = null) {
    if (this.state === 'chase') return;
    this.returnState = this.state === 'patrol' ? 'patrol' : 'writing';
    this.state = 'warning';
    this.stateTimer = duration;
    if (towardPlayer) {
      this.lookDir.subVectors(towardPlayer, this.pos).setY(0).normalize();
    } else {
      this.lookDir.set(0, 0, 1);
    }
  }

  forceLook(playerPos) {
    if (this.state === 'chase' || this.state === 'warning' || this.state === 'looking') return;
    this.beginLook(0.25, playerPos);
  }

  startPatrol() {
    const p = this.patrolPoints;
    if (!p.length) return; // 站桩敌人不巡逻
    // 按巡逻点顺序，把 routeExtra 均匀穿插进去，形成一个闭合环。
    const extra = this.routeExtra;
    this.route = [];
    for (let i = 0; i < p.length; i++) {
      this.route.push(p[i].clone());
      const e = extra[i];
      if (e) this.route.push(e.clone());
    }
    // 回到讲台收尾。
    this.route.push(this.home.clone());
    this.routeIndex = 0;
    this.patrolClock = 0;
    this.state = 'patrol';
  }

  faceDirection(dir, dt, immediate = false) {
    if (dir.lengthSq() < 0.0001) return;
    const target = Math.atan2(dir.x, dir.z);
    let delta = target - this.facingAngle;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    const turn = immediate ? 1 : 1 - Math.exp(-11 * dt);
    this.facingAngle += delta * turn;
    this.facingAngle = Math.atan2(Math.sin(this.facingAngle), Math.cos(this.facingAngle));
    this.facing.set(Math.sin(this.facingAngle), 0, Math.cos(this.facingAngle));
    this.group.rotation.y = this.facingAngle + Math.PI;
  }

  moveToward(goal, dt, speed = this.speed) {
    tmpDir.subVectors(goal, this.pos).setY(0);
    const distance = tmpDir.length();
    if (distance < 0.12) return true;
    tmpDir.normalize();
    this.faceDirection(tmpDir, dt);
    this.pos.addScaledVector(tmpDir, Math.min(speed * dt, distance));
    this.group.position.copy(this.pos);
    this.movingThisFrame = true;
    this.walkPhase += dt * (speed > 2.4 ? 11 : 7.4);
    return false;
  }

  animateModel(dt) {
    const now = performance.now() / 1000;
    this.walkBlend = this.movingThisFrame ? Math.min(1, this.walkBlend + dt * 6) : Math.max(0, this.walkBlend - dt * 7);
    const writing = this.state === 'writing' ? 1 : 0;
    this.writeBlend += (writing - this.writeBlend) * Math.min(1, dt * 7);

    const w = this.walkBlend;
    const wb = this.writeBlend;
    const swing = Math.sin(this.walkPhase);
    const lift = Math.cos(this.walkPhase);

    this.leftThigh.rotation.x = swing * 0.55 * w;
    this.rightThigh.rotation.x = -swing * 0.55 * w;
    this.leftShin.rotation.x = Math.max(0, lift) * 0.72 * w;
    this.rightShin.rotation.x = Math.max(0, -lift) * 0.72 * w;

    const scribble = Math.sin(now * 8.2) * 0.055 + Math.sin(now * 17.3) * 0.02;
    this.leftArm.rotation.x = 0.38 * wb - swing * 0.42 * w * (1 - wb);
    this.leftFore.rotation.x = 1.05 * wb + (0.12 + Math.max(0, -swing) * 0.18) * w * (1 - wb);
    this.rightArm.rotation.x = 1.46 * wb + swing * 0.42 * w * (1 - wb);
    this.rightFore.rotation.x = (0.36 + scribble) * wb + (0.12 + Math.max(0, swing) * 0.18) * w * (1 - wb);
    this.leftArm.rotation.z = 0.06 * w;
    this.rightArm.rotation.z = -0.06 * w;

    this.hips.position.y = 0.96 + Math.abs(swing) * 0.028 * w;
    this.torso.rotation.x = -0.045 * wb - 0.018 * w;
    this.torso.rotation.z = swing * 0.022 * w;
    this.head.rotation.x = -0.12 * wb;
    this.head.rotation.z = -swing * 0.016 * w;
  }

  canSee(playerPos, playerHeight) {
    const eye = new THREE.Vector3(this.pos.x, this.eyeHeight, this.pos.z);
    return this.canSeeFrom(eye, playerPos, playerHeight);
  }

  canSeeFrom(eye, playerPos, playerHeight, margin = 1) {
    const target = new THREE.Vector3(playerPos.x, playerHeight, playerPos.z);
    const toPlayer = target.clone().sub(eye);
    const flat = toPlayer.clone().setY(0);
    const distance = flat.length();
    if (distance >= this.viewDist * margin || distance < 0.01) return false;
    flat.normalize();
    const elev = Math.atan2(toPlayer.y, distance);
    if (Math.abs(elev) > THREE.MathUtils.degToRad(40)) return false;
    const t = Math.min(1, distance / this.viewDist);
    const halfAngle = THREE.MathUtils.degToRad(this.viewHalfAngleDeg - 8 * t);
    if (flat.dot(this.facing) <= Math.cos(halfAngle)) return false;
    return !this.occluders.some((box) => segmentHitsBox(eye, target, box));
  }

  isWatching(playerPos, playerHeight) {
    if (this.state === 'chase') return false;
    const eye = new THREE.Vector3(this.pos.x, this.eyeHeight, this.pos.z);
    return this.canSeeFrom(eye, playerPos, playerHeight, 1.15);
  }

  startChase(playerPos) {
    this.state = 'chase';
    this.arrived = false;
    this.chasePath = this._buildPath(this.pos, playerPos);
    this.chaseIndex = 0;
    this.detected = false;
  }

  _updateChase(dt, playerPos) {
    const flatDistance = tmpDir.subVectors(playerPos, this.pos).setY(0).length();
    if (flatDistance <= 1.35 || (!this.chasePath.length && flatDistance < 2.2)) {
      this.arrived = true;
      this.faceDirection(tmpDir.normalize(), dt, true);
      return;
    }
    const goal = this.chasePath[this.chaseIndex];
    if (!goal) { this.arrived = true; return; }
    if (this.moveToward(goal, dt, 3.0)) this.chaseIndex++;
  }

  // 每帧更新。返回 { seen, arrived }
  update(dt, playerPos, playerHeight = 1.6) {
    this.detected = false;
    this.movingThisFrame = false;
    if (this.state === 'chase') {
      this._updateChase(dt, playerPos);
      this.animateModel(dt);
      return { seen: false, arrived: this.arrived };
    }

    this.patrolClock += dt;
    if (this.state === 'writing') {
      this.faceDirection(new THREE.Vector3(0, 0, -1), dt);
      this.lookTimer -= dt;
      if (this.patrolClock >= this.writeDuration) this.startPatrol();
      else if (this.lookTimer <= 0) this.beginLook(0.4);
    } else if (this.state === 'warning') {
      this.faceDirection(this.lookDir, dt);
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) {
        this.state = 'looking';
        this.stateTimer = 0.8;
        this.faceDirection(this.lookDir, dt, true);
      }
    } else if (this.state === 'looking') {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) {
        this.state = this.returnState;
        if (this.state === 'writing') this.lookTimer = this._randomLookDelay();
      }
    } else if (this.state === 'patrol') {
      const goal = this.route[this.routeIndex];
      if (this.moveToward(goal, dt)) {
        this.routeIndex++;
        if (this.routeIndex >= this.route.length) {
          this.state = 'writing';
          this.pos.copy(this.home);
          this.group.position.copy(this.pos);
          this.lookTimer = this._randomLookDelay();
        }
      }
    }

    if (this.state === 'looking' || this.state === 'patrol') {
      this.detected = this.canSee(playerPos, playerHeight);
    }
    this.animateModel(dt);
    return { seen: this.detected, arrived: false };
  }

  dispose(scene) {
    scene.remove(this.group);
  }
}
