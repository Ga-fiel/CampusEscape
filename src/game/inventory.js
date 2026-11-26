// ============================================================
// 物品栏 —— 玩家跨关卡携带的拾取物。
//
// 设计极简：就是一个字符串集合。捡到东西 add(id)，查有没有 has(id)，
// 过检查点/换关卡时它原样跟着玩家走（因为整个游戏只 new 一个 Inventory）。
//
// 物品 id 全项目唯一，想加新物品：随便起个 id 字符串，在关卡里摆一个
// 「可拾取物」，玩家走过去按 E 就进这里。物品本身长什么样、放在哪，
// 全写在各关卡的 level.js / items.js 里（见 doc/如何新增关卡.md）。
// ============================================================

export class Inventory {
  constructor(initial = []) {
    // 用 Set 存，天然去重。
    this.items = new Set(initial);
  }

  add(id) {
    this.items.add(id);
    return this;
  }

  has(id) {
    return this.items.has(id);
  }

  hasAll(ids = []) {
    return ids.every((id) => this.items.has(id));
  }

  remove(id) {
    this.items.delete(id);
    return this;
  }

  list() {
    return [...this.items];
  }

  clear() {
    this.items.clear();
  }
}
