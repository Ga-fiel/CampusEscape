// ============================================================
// 场景注册表 —— 场景 id → 场景对象。
//
// 新加一个场景/箱庭，只要：
//   1) 在 src/scenes/<名字>/index.js 里 export default 一个 SceneBase 子类实例
//   2) 在下面 import 进来并登记进 SCENES
// main.js 就能用 id 加载它（也可在 main 里改 INITIAL_SCENE 方便调试）。
// ============================================================

import floor3 from './floor3/index.js';

export const SCENES = {
  floor3,
};

export function getScene(id) {
  const sc = SCENES[id];
  if (!sc) throw new Error(`未知场景 id: "${id}"，请在 src/scenes/registry.js 里登记`);
  return sc;
}
