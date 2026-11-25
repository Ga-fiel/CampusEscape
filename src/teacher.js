import * as THREE from 'three';
import { makeChalkMaterial } from './chalk.js';

// 用弯曲 tube + 扁椭圆拼一个「粉笔火柴人」
function limb(mat, from, to, r = 0.06) {
  const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
  mid.x += (Math.random() - 0.5) * 0.05; // 手绘不齐
  const curve = new THREE.QuadraticBezierCurve3(
    from.clone(), mid, to.clone()
  );
  return new THREE.Mesh(new THREE.TubeGeometry(curve, 6, r, 6, false), mat);
}

export class Teacher {
  constructor(scene) {
    const mat = makeChalkMaterial();
    this.group = new THREE.Group();

    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    // 头（扁椭圆）
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 8), mat);
    head.scale.set(1, 1.15, 0.7);
    head.position.y = 1.75;
    this.group.add(head);
    // 身体
    this.group.add(limb(mat, V(0, 1.55, 0), V(0, 0.95, 0), 0.16));
    // 四肢
    this.group.add(limb(mat, V(0, 1.45, 0), V(-0.35, 0.95, 0)));
    this.group.add(limb(mat, V(0, 1.45, 0), V(0.35, 0.95, 0)));
    this.group.add(limb(mat, V(0, 0.95, 0), V(-0.18, 0.05, 0)));
    this.group.add(limb(mat, V(0, 0.95, 0), V(0.18, 0.05, 0)));
    // 眉毛（严厉表情）
    this.group.add(limb(mat, V(-0.12, 1.82, -0.2), V(-0.02, 1.79, -0.2), 0.02));
    this.group.add(limb(mat, V(0.02, 1.79, -0.2), V(0.12, 1.82, -0.2), 0.02));

    scene.add(this.group);

    // 巡逻：固定路线来回走
    this.path = [
      new THREE.Vector3(-5, 0, -6),
      new THREE.Vector3(5, 0, -6),
      new THREE.Vector3(5, 0, 6),
      new THREE.Vector3(-5, 0, 6),
    ];
    this.target = 1;
    this.pos = this.path[0].clone();
    this.group.position.copy(this.pos);
    this.speed = 1.8;
    this.facing = new THREE.Vector3(1, 0, 0);
    this.fovCos = Math.cos(THREE.MathUtils.degToRad(35)); // 半角 35°
    this.viewDist = 9;

    // 视锥指示（脚下白圈，仅调试时可开）
    this.detected = false;
  }

  update(dt, playerPos) {
    const goal = this.path[this.target];
    const dir = new THREE.Vector3().subVectors(goal, this.pos);
    dir.y = 0;
    const dist = dir.length();
    if (dist < 0.15) {
      this.target = (this.target + 1) % this.path.length;
    } else {
      dir.normalize();
      this.facing.copy(dir);
      this.pos.addScaledVector(dir, Math.min(this.speed * dt, dist));
      this.group.position.copy(this.pos);
      this.group.rotation.y = Math.atan2(dir.x, dir.z);
    }

    // 视锥检测：距离 + 角度
    const toPlayer = new THREE.Vector3().subVectors(playerPos, this.pos);
    toPlayer.y = 0;
    const d = toPlayer.length();
    let seen = false;
    if (d < this.viewDist && d > 0.01) {
      toPlayer.normalize();
      if (toPlayer.dot(this.facing) > this.fovCos) seen = true;
    }
    this.detected = seen;
    return seen;
  }
}
