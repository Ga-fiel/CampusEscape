// ============================================================
// 场景管理器 —— 负责「进出场景」这件事本身。
//
// 职责很窄，全是对场景对象和玩家的调度：
//   load(id)              卸载当前场景、构建目标场景、把玩家放到它的出生点
//   goThroughExit(exit)   玩家踩到出口时切换到下一个场景/通关
//   update(dt, player)    每帧：更新本场景敌人、拾取物；返回本帧事件
//   pickupAt(player)      玩家按 E：捡起脚下可拾取物进物品栏
//   interactAt(player)    玩家按 F：靠近的可交互物（如门）
//   exitAt(player)        玩家当前站在哪个出口触发区里（没有则 null）
//
// 物品栏（Inventory）是整个游戏唯一一份，场景切换时随身携带，
// 所以「捡起来能带到下一个场景」是天然成立的——根本不用序列化。
// ============================================================

import * as THREE from 'three';
import { getScene } from './registry.js';

export class SceneManager {
  constructor({ scene, inventory }) {
    this.scene = scene;
    this.inventory = inventory;
    this.current = null;
    this.currentId = null;
    this.onCaught = null; // 引擎注入：被敌人抓住的回调
  }

  // 加载（或重载）某个场景。返回场景对象。
  load(id) {
    if (this.current) this.current.dispose(this.scene);
    const level = getScene(id);
    level.resetRuntime();

    const ctx = {
      scene: this.scene,
      onCollide: () => {}, // 场景自己已经把盒子推进 level.walls/occluders
    };
    level.build(ctx);

    // 敌人回调：被看见+追上 → 交给引擎判负。
    this.current = level;
    this.currentId = id;
    return level;
  }

  // 当前场景的出生信息（引擎把玩家放过去）。
  spawn() {
    return this.current.spawn;
  }

  // 玩家脚下是否有可拾取物（未拾取的）。
  pickupAt(playerPos) {
    if (!this.current) return null;
    for (const p of this.current.pickups) {
      if (p.taken) continue;
      const dx = playerPos.x - p.pos.x;
      const dz = playerPos.z - p.pos.z;
      if (dx * dx + dz * dz <= p.radius * p.radius) return p;
    }
    return null;
  }

  // 玩家当前站在哪个出口触发区里。
  exitAt(playerPos) {
    if (!this.current) return null;
    for (const ex of this.current.exits) {
      if (ex.contains(playerPos)) {
        // 需要道具的出口，检查物品栏
        const ok = (ex.require || []).every((id) => this.inventory.has(id));
        if (ok) return ex;
      }
    }
    return null;
  }

  // 玩家目前靠近的 F 键可交互物（在半径内，且未 done）。
  interactAt(playerPos) {
    if (!this.current) return null;
    let best = null;
    let bestD = Infinity;
    for (const it of this.current.interactables || []) {
      if (it.done) continue;
      const dx = playerPos.x - it.pos.x;
      const dz = playerPos.z - it.pos.z;
      const d = dx * dx + dz * dz;
      if (d <= it.radius * it.radius && d < bestD) { bestD = d; best = it; }
    }
    return best;
  }

  // 出口缺道具时的提示（玩家站在出口里但道具不全）。
  blockedExitAt(playerPos) {
    if (!this.current) return null;
    for (const ex of this.current.exits) {
      if (!ex.contains(playerPos)) continue;
      const missing = (ex.require || []).filter((id) => !this.inventory.has(id));
      if (missing.length) return { exit: ex, missing };
    }
    return null;
  }

  // 踩到出口：切场景或通关。返回 { type:'scene'|'win', scene?, target? }
  goThroughExit(exit) {
    if (!exit.target) {
      return { type: 'win' };
    }
    this.load(exit.target);
    return { type: 'scene', scene: this.current, target: exit.target };
  }

  // 每帧更新本场景怪物与可拾取物，返回 { seen, arrived } 汇总。
  update(dt, playerPos, playerHeight) {
    let seen = false;
    let arrived = false;
    if (!this.current) return { seen, arrived };
    for (const n of this.current.npcs) {
      const r = n.enemy.update(dt, playerPos, playerHeight);
      if (r.seen) seen = true;
      if (r.arrived) arrived = true;
    }
    for (const p of this.current.pickups) {
      if (!p.taken && p.update) p.update(dt);
    }
    return { seen, arrived };
  }

  // 让本场景所有敌人看向某点（碰撞噪声等触发）。
  alertEnemies(playerPos) {
    if (!this.current) return;
    for (const n of this.current.npcs) n.enemy.forceLook?.(playerPos);
  }

  // 是否有敌人正在盯着玩家（HUD 提示用）。
  isWatched(playerPos, playerHeight) {
    if (!this.current) return false;
    return this.current.npcs.some((n) => n.enemy.isWatching?.(playerPos, playerHeight));
  }

  // 失败追击：让所有敌人追玩家。
  startChase(playerPos) {
    if (!this.current) return;
    for (const n of this.current.npcs) n.enemy.startChase?.(playerPos);
  }
}
