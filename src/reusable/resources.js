// ============================================================
// 可复用资源模型 —— 所有关卡共享的物品外观与摆设。
//
// 这里的都是「哪一关都能用」的东西：课桌、椅子、书、门、地标……
// 场景独有的资源（只在某一层出现的特殊道具/装饰）不写这里，
// 而是写在场景文件夹里（如 src/scenes/floor3/resources.js）。
//
// 底层复用 src/scene/scene-build.js 的 PREFABS；这里给关卡提供一个
// 更直白的入口：placePrefab(level, 'desk', { pos, params }) 直接往关卡里摆。
//
// 想加一个新的「可复用模型」：在 scene/scene-build.js 的 PREFABS 里加一个
// 生成函数，然后这里登记进 REUSABLE_PREFABS 表即可全局可用。
// ============================================================

import * as THREE from 'three';
import { PREFABS } from '../scene/scene-build.js';

// 全局可复用零件清单（key 是 prefab 名）。
export const REUSABLE_PREFABS = PREFABS;

// 往一个关卡里摆一个可复用 prefab。
//   level   关卡实例（有 root / mat）
//   name    PREFABS 里的名字：'desk'|'chair'|'book'|'classmate'|'chalkDoor'|'groundLines'
//   opts    { pos:[x,y,z], rot:[x,y,z](度), params:{}, flags:{collide,occlude,noise}, id }
// 返回生成的 Object3D。需要碰撞/遮挡的，按世界包围盒推入 level.walls / occluders。
export function placePrefab(level, name, opts = {}) {
  const maker = PREFABS[name];
  if (!maker) throw new Error(`没有名为 "${name}" 的可复用资源模型`);
  const obj = maker({ mat: level.mat, params: opts.params || {} });
  const pos = opts.pos || [0, 0, 0];
  const rot = opts.rot || [0, 0, 0];
  obj.position.set(pos[0], pos[1], pos[2]);
  obj.rotation.set(
    THREE.MathUtils.degToRad(rot[0]),
    THREE.MathUtils.degToRad(rot[1]),
    THREE.MathUtils.degToRad(rot[2]),
  );
  level.root.add(obj);

  const f = opts.flags || {};
  if (f.collide || f.occlude) {
    level.root.updateMatrixWorld(true);
    const aabb = new THREE.Box3().setFromObject(obj);
    const box = {
      id: opts.id || name,
      minX: aabb.min.x, maxX: aabb.max.x,
      minY: aabb.min.y, maxY: aabb.max.y,
      minZ: aabb.min.z, maxZ: aabb.max.z,
      noise: !!f.noise,
      tag: f.tag || name,
      collide: !!f.collide,
      occlude: !!f.occlude,
    };
    if (box.collide) level.walls.push(box);
    if (box.occlude) level.occluders.push(box);
  }
  return obj;
}
