import * as THREE from 'three';
import { makeChalkMaterial, INK_PALETTE } from './chalk.js';

// ============================================================
// 第一人称「自己身体」——挂在相机下的简化人体。
// 平时只有低头/侧看时能看到自己的大腿、小腿和手臂，
// 让玩家有"这具身体是我"的存在感（原本只有一台漂浮的摄像机）。
//
// 设计要点：
// - 整体 parent 到相机，所以天然跟随位置与朝向。
// - 眼睛在相机原点 (0,0,0)，身体各部件都放在相机坐标系的「下方/后方」。
// - 用近黑墨水（索引 5）描线，和白纸风格一致，简笔人。
// - 只画摄像机下方能看到的部位，避免穿帮。
// ============================================================

export function createPlayerBody(camera) {
  const grp = new THREE.Group();
  grp.name = '__playerBody';
  // 相机朝 -Z 看；身体在相机坐标系里，+Y 上、-Z 前。
  camera.add(grp);
  // 相机需要被加入场景才会渲染其子节点——由 main.js 保证 R.scene.add(camera)。

  // 墨水索引需归一化到 [0,1]（与 scene-build 的 inkSlotOf 一致）：
  // 材质里的 uInkIndex 会在后处理里 *（INK_PALETTE.length-1）=*6 还原成调色板下标。
  // 索引 5(近黑)、3(赭色)。
  const N = INK_PALETTE.length - 1;
  const mat = makeChalkMaterial(5 / N); // 近黑描线
  const skinMat = makeChalkMaterial(3 / N); // 赭色（皮肤/衣物暖色）

  const box = (w, h, d, x, y, z, m = mat) => {
    const g = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    g.position.set(x, y, z);
    grp.add(g);
    return g;
  };

  // 摄像机眼睛约 y=1.6（standing）。相机原点就是眼睛。
  // 抬头平视时不想看到太多，所以部件整体压到「眼下方、稍微朝前」。
  const hipY = -0.62;
  // 躯干：放在眼睛正前下方一点，俯视能看到胸口一角（别裹住相机原点，避免近裁剪面切半）。
  const torso = box(0.46, 0.5, 0.24, 0, hipY + 0.18, -0.16, skinMat);
  // 两条大腿：从髋部往前下方伸出（俯视能看到伸向眼前的腿）
  const thigh = (sideX) => {
    const piv = new THREE.Group();
    piv.position.set(sideX, hipY + 0.02, -0.12);
    grp.add(piv);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.17, 0.5), mat);
    // 大腿沿 -Z（前）伸出，略向下
    m.position.set(0, -0.06, -0.26);
    m.rotation.x = -0.24;
    piv.add(m);
    return piv;
  };
  const thighL = thigh(-0.13);
  const thighR = thigh(0.13);

  // 小腿：接在大腿前端往下（低头伸腿时可见）
  const shin = (thighPiv) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.52, 0.14), mat);
    m.position.set(0, -0.36, -0.5);
    m.rotation.x = 0.34;
    thighPiv.add(m);
    return m;
  };
  shin(thighL);
  shin(thighR);

  // 左右手臂：从肩（靠近相机两侧）垂下，低头/侧看能看到手
  const arm = (sideX) => {
    const piv = new THREE.Group();
    piv.position.set(sideX, hipY + 0.44, -0.1);
    grp.add(piv);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.46, 0.1), skinMat);
    upper.position.set(0, -0.23, 0.0);
    piv.add(upper);
    return piv;
  };
  arm(-0.32);
  arm(0.32);

  // 走路时腿部轻微摆动所需引用
  grp.userData = { thighL, thighR };

  camera.userData.playerBody = grp;
  return grp;
}

// 每帧调用：根据移动状态做轻微的腿部摆动 + 蹲下时整体下沉。
// grounded/crouched 由 main.js 传入；moving 决定摆腿。
export function updatePlayerBody(body, dt, { moving, crouched, bob }) {
  if (!body) return;
  const t = body.userData;
  if (!t) return;
  // 蹲下时身体整体下移一点，避免腿穿到地面以上太多
  body.position.y = crouched ? -0.32 : 0;
  // 迈步摆动
  const target = moving ? 0.5 : 0.0;
  t._phase = (t._phase || 0) + dt * (moving ? 9 : 0);
  const swing = Math.sin(t._phase) * target;
  if (t.thighL) t.thighL.rotation.x = swing;
  if (t.thighR) t.thighR.rotation.x = -swing;
  // 行走上下微颠
  body.position.y += bob || 0;
}
