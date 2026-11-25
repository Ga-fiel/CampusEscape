import * as THREE from 'three';
import { makeChalkMaterial } from './chalk.js';

// 教室尺寸
export const ROOM = { w: 16, h: 4.2, d: 22 };

// 碰撞盒（AABB，仅 XZ 平面足够做第一人称行走）
export const walls = [];

function box(scene, mat, w, h, d, x, y, z, collide = false) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  scene.add(m);
  if (collide) {
    walls.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
  }
  return m;
}

export function buildClassroom(scene) {
  const mat = makeChalkMaterial();
  const { w, h, d } = ROOM;

  // 地面与天花板
  box(scene, mat, w, 0.2, d, 0, -0.1, 0);
  box(scene, mat, w, 0.2, d, 0, h + 0.1, 0);
  // 四面墙
  box(scene, mat, w, h, 0.2, 0, h / 2, -d / 2, true);
  box(scene, mat, w, h, 0.2, 0, h / 2, d / 2, true);
  box(scene, mat, 0.2, h, d, -w / 2, h / 2, 0, true);
  box(scene, mat, 0.2, h, d, w / 2, h / 2, 0, true);

  // 黑板（前墙）
  box(scene, mat, 9, 2.4, 0.12, 0, 2.3, -d / 2 + 0.18);
  // 讲台
  box(scene, mat, 3.2, 1.1, 1.2, 0, 0.55, -d / 2 + 1.6, true);

  // 课桌 3 列 x 5 排
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      const x = -4.6 + col * 4.6;
      const z = -5.5 + row * 3.0;
      box(scene, mat, 1.8, 0.12, 0.9, x, 0.95, z, true);     // 桌面
      // 四条腿
      for (const sx of [-0.75, 0.75]) {
        for (const sz of [-0.32, 0.32]) {
          box(scene, mat, 0.1, 0.95, 0.1, x + sx, 0.475, z + sz);
        }
      }
      box(scene, mat, 1.8, 0.8, 0.12, x, 1.45, z - 0.39);    // 椅背
    }
  }

  // 走廊尽头的「出口」门框（后墙中央），用两根立柱 + 横梁表现
  box(scene, mat, 0.18, 2.8, 0.18, -1.3, 1.4, d / 2 - 0.2);
  box(scene, mat, 0.18, 2.8, 0.18, 1.3, 1.4, d / 2 - 0.2);
  box(scene, mat, 2.8, 0.18, 0.18, 0, 2.8, d / 2 - 0.2);
}
