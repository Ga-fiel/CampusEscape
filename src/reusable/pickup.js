// ============================================================
// 可拾取物 —— 场景里能被捡起来放进物品栏的小东西。
//
// 复用场景：任何关卡想要一个「能捡的道具」，就用 makePickup() 造一个：
//   const p = makePickup(level, { id: 'key_1', name: '钥匙', pos:[0,1,0], shape:'key' });
// 引擎会把它注册进 level.pickups，玩家走近按 E 就进物品栏。
//
// shape 只是一眼能认出的小模型：'key' 钥匙 / 'paper' 纸张 / 'cube' 方块。
// 想加新外观：在这里的 SHAPES 里加一个函数即可。
// ============================================================

import * as THREE from 'three';

const SHAPES = {
  // 钥匙：一个圆环 + 一根齿条。
  key(mat) {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.022, 5, 12), mat);
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.22), mat);
    shaft.position.z = 0.14;
    g.add(shaft);
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.05), mat);
    tooth.position.set(0.04, 0, 0.22);
    g.add(tooth);
    return g;
  },
  // 纸张：一张微卷的薄片。
  paper(mat) {
    const g = new THREE.Group();
    const sheet = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.006, 0.3), mat);
    sheet.rotation.y = 0.12;
    g.add(sheet);
    return g;
  },
  // 方块：占位/杂项。
  cube(mat) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), mat);
    return m;
  },
};

// 造一个可拾取物并注册进关卡。
// 返回 { id, name, pos:Vector3, mesh }，引擎拿这份记录做提示与拾取。
export function makePickup(level, { id, name, pos = [0, 1, 0], shape = 'cube', radius = 0.6 }) {
  const mat = level.mat;
  const maker = SHAPES[shape] || SHAPES.cube;
  const mesh = maker(mat);
  mesh.position.set(pos[0], pos[1], pos[2]);
  level.root.add(mesh);

  // 自转 + 轻微浮动，让玩家一眼看到这是可捡的。
  mesh.userData.spin = { phase: Math.random() * Math.PI * 2, baseY: pos[1] };

  const record = {
    id,
    name,
    pos: new THREE.Vector3(pos[0], pos[1], pos[2]),
    radius,
    mesh,
    taken: false,
    update(dt) {
      if (this.taken) return;
      const s = mesh.userData.spin;
      s.phase += dt * 2.2;
      mesh.rotation.y += dt * 2.2;
      mesh.position.y = s.baseY + Math.sin(s.phase) * 0.06;
    },
  };
  level.pickups.push(record);
  return record;
}
