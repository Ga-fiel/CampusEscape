// ============================================================
// 场景基类 —— 所有场景共同遵守的「契约」。
//
// 一个场景 = 一个文件夹（src/scenes/<场景名>/），里面至少有一个
// index.js 默认导出一个 Scene 子类实例。这个子类告诉游戏引擎：
//   - 怎么在场景里把这一层的几何/敌人/物品摆出来  build(ctx)
//   - 碰撞盒、遮挡盒、可拾取物、可交互物、可行走范围在哪
//   - 上一场景 / 下一场景是谁（场景链的拓扑）
//
// 设计原则：简单。除了 build() 必须实现，其余都有默认值，
// 新手加场景只要填数据就行，不用懂引擎内部。
//
// ctx（引擎每帧传给 build 的上下文）包含：
//   scene   THREE.Scene          往这里加几何
//   R       ChalkRenderer        渲染器（一般用不到，scene/camera 够用）
//   onCollide(box)               声明一个碰撞/遮挡盒的回调
// 见 doc/如何新增场景.md 有面向策划的完整说明。
// ============================================================

import * as THREE from 'three';
import { createMaterial } from '../scene/scene-build.js';

export class SceneBase {
  // ---- 场景身份信息（子类覆盖） ----
  // id        全项目唯一的场景标识，场景链靠它互相指向
  // name      显示名
  // next      下一场景的 id；null 表示这是最后一个场景（出口即通关）
  // prev      上一场景的 id；null 表示这是第一个场景（从它出生点开始）
  static meta = {
    id: 'unknown',
    name: '未命名场景',
    next: null,
    prev: null,
  };

  constructor() {
    this.meta = this.constructor.meta;
    // 运行时填充：
    this.root = null;        // 本场景所有几何挂在这个 Group 下，切场景时整组移除
    this.mat = null;         // 本场景共用的粉笔材质
    this.walls = [];         // 碰撞盒（引擎推玩家用）
    this.occluders = [];     // 遮挡盒（敌人视线用）
    this.pickups = [];       // 可拾取物
    this.interactables = []; // F 键可交互物（门、开关…）
    this.doors = [];         // 可开关的门扇 {id, group, pivot, opening, anim}
    this.bounds = null;      // 可行走范围（箱庭多房间用；单房间可为 null）
    this.npcs = [];          // 敌人 {kind, enemy}
    this.exits = [];         // 出口触发区
    this.spawn = null;       // {pos: Vector3, yaw}
    this.checkpoint = null;  // 被抓回传点（默认同 spawn）
    this.room = null;        // 单矩形房间 {w,h,d}（可选，多房间箱庭不用）
  }

  // 每次进入场景前，清空上一轮运行态，保证反复进出状态干净。
  resetRuntime() {
    this.walls = [];
    this.occluders = [];
    this.pickups = [];
    this.interactables = [];
    this.doors = [];
    this.bounds = null;
    this.npcs = [];
    this.exits = [];
    this.root = null;
    this.mat = null;
  }

  // 场景被卸载时清理（默认递归移除 root，子类一般不用管）。
  dispose(scene) {
    if (this.root) {
      scene.remove(this.root);
      this.root.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
      });
    }
    this.root = null;
    this.walls = [];
    this.occluders = [];
    this.pickups = [];
    this.interactables = [];
    this.doors = [];
    this.bounds = null;
    this.npcs = [];
    this.exits = [];
  }

  // ============ 引擎用的辅助方法（子类构建时调用） ============

  // 让子类在 build 里安全地拿到材质 / 建一个碰撞盒。
  getHelpers(ctx) {
    const self = this;
    const mat = this.mat || (this.mat = createMaterial());
    return {
      mat,
      // 建一个 box 几何 + 可选碰撞盒。返回 mesh。
      box(size, pos, flags = {}) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
        mesh.position.set(...pos);
        self.root.add(mesh);
        if (flags.collide || flags.occlude) {
          self.root.updateMatrixWorld(true);
          const aabb = new THREE.Box3().setFromObject(mesh);
          const box = {
            id: flags.id || 'box',
            minX: aabb.min.x, maxX: aabb.max.x,
            minY: aabb.min.y, maxY: aabb.max.y,
            minZ: aabb.min.z, maxZ: aabb.max.z,
            noise: !!flags.noise,
            tag: flags.tag || '',
            collide: !!flags.collide,
            occlude: !!flags.occlude,
          };
          if (box.collide) self.walls.push(box);
          if (box.occlude) self.occluders.push(box);
          ctx.onCollide?.(box);
        }
        return mesh;
      },
      // 只往场景加一个 three 物体（几何已建好），不做碰撞。
      add(obj) {
        self.root.add(obj);
        return obj;
      },
    };
  }

  // ============ 可开关的门 ============
  // 造一扇「绕着铰链旋转」的门扇，并注册成 F 键交互物。
  // 按 F 在「关 / 开」之间切换；门扇绕铰链平滑转开一个角度（被推开的感觉），
  // 只动门不动玩家。碰撞盒跟着门的状态走（关门挡路、开门让路）。
  //
  // 参数（世界坐标，单位米，Y 轴向上）：
  //   id        唯一标识
  //   name      显示名（F 提示用）
  //   hinge     [x,z] 铰链（合页）在世界里的水平位置
  //   width     门扇宽度（沿墙方向）
  //   height    门高（默认 2.4）
  //   closedDir 关门时门扇从铰链指向门另一边的水平方向，'x+'|'x-'|'z+'|'z-'
  //             （即门扇贴合墙的方向）
  //   openAngle 打开时绕铰链旋转的角度（度，默认 95）
  //   openSign  +1 / -1，决定往哪一侧推（朝走廊或朝房间），默认 +1
  //   thickness 门扇厚度（默认 0.08）
  // 返回 door 对象（已 push 进 this.doors 和 this.interactables）。
  makeDoor(helpers, opts) {
    const self = this;
    const mat = helpers.mat;
    const hinge = opts.hinge;
    const width = opts.width ?? 2.0;
    const height = opts.height ?? 2.4;
    const thickness = opts.thickness ?? 0.08;
    const closedDir = opts.closedDir ?? 'z+';
    const openAngle = (opts.openAngle ?? 95) * Math.PI / 180;
    const openSign = opts.openSign ?? 1;

    // 关门时门扇指向的单位向量（世界水平）。
    const dirVec = {
      'x+': new THREE.Vector2(1, 0),
      'x-': new THREE.Vector2(-1, 0),
      'z+': new THREE.Vector2(0, 1),
      'z-': new THREE.Vector2(0, -1),
    }[closedDir];

    // 门扇基础朝向角：让局部 +X 轴对齐 door 的 closedDir。
    const baseYaw = Math.atan2(-dirVec.y, dirVec.x);

    // pivot 放在铰链处，门扇几何整体往 +X 方向偏移 width/2，这样绕 pivot 转就绕铰链转。
    const pivot = new THREE.Group();
    pivot.position.set(hinge[0], height / 2, hinge[1]);
    pivot.rotation.y = baseYaw;

    const leaf = new THREE.Mesh(new THREE.BoxGeometry(width, height, thickness), mat);
    leaf.position.set(width / 2, 0, 0); // 沿 +X 展开
    pivot.add(leaf);

    // 门把手（小方块，帮助看出门的存在与朝向）。
    const knob = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.16), mat);
    knob.position.set(width - 0.18, 0, thickness / 2 + 0.06);
    pivot.add(knob);

    self.root.add(pivot);

    const door = {
      id: opts.id ?? 'door',
      name: opts.name ?? '门',
      pivot,
      leaf,
      knob,
      baseYaw,
      openAngle: openAngle * openSign,
      isOpen: false,
      // 动画状态：target 是当前应转向的角度（0=关，openAngle=开）
      animAngle: 0,
      targetAngle: 0,
      hinge,
      width,
      height,
      thickness,
      closedDir,
      dirVec,
    };

    // 关门时的碰撞盒（一个贴着墙的门扇盒子）。它的 min/max 会随门扇
    // 旋转角度每帧重算，做到「门开到哪、碰撞体转到哪」。
    const half = width / 2;
    door.collider = {
      id: door.id + '-collider',
      minX: 0, maxX: 0, minY: 0, maxY: height, minZ: 0, maxZ: 0,
      noise: true, tag: 'door', collide: true, occlude: true,
    };
    // 用关门时的几何初始化碰撞盒范围。
    this._updateDoorCollider(door);
    self.walls.push(door.collider);
    self.occluders.push(door.collider);

    // F 交互物：切换开关。
    self.interactables.push({
      id: door.id,
      name: door.name,
      pos: new THREE.Vector3(
        hinge[0] + dirVec.x * half,
        height / 2,
        hinge[1] + dirVec.y * half,
      ),
      radius: Math.max(1.8, width * 0.9),
      verb: 'F',
      door,
      interact() {
        self.toggleDoor(door);
        return { kind: 'toggleDoor' };
      },
    });

    self.doors.push(door);
    return door;
  }

  // 切换一扇门开关。碰撞盒不增删——它每帧跟着门扇走（见 _updateDoorCollider）。
  toggleDoor(door) {
    door.isOpen = !door.isOpen;
    door.targetAngle = door.isOpen ? door.openAngle : 0;
  }

  // 按门扇当前角度，把碰撞盒的 AABB 重算成「旋转后门板的包围盒」。
  // 门扇是一块 width × thickness 的长方形，绕铰链(hinge)转了 animAngle。
  _updateDoorCollider(door) {
    const a = door.baseYaw + door.animAngle; // 门扇实际朝向（世界角）
    const hw = door.width / 2;
    const ht = door.thickness / 2;
    // 门板在「局部」占 [-ht,ht]×[0,width]（沿 +X 展开 width）。取四个角的世界坐标求包围盒。
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    // 局部点 (lx, lz) → 世界 (hinge + 旋转)。门扇局部：x 从 0..width，z 从 -thickness/2..+thickness/2。
    const corners = [];
    for (const lx of [0, door.width]) {
      for (const lz of [-ht, ht]) {
        // 绕 Y 轴旋转：worldX = lx*cos + lz*sin ; worldZ = -lx*sin + lz*cos
        // （与 three 的 rotation.y 一致：y 角顺时针为负，本地 +X 旋转后 = (cos, -sin)）
        const wx = door.hinge[0] + lx * cos + lz * sin;
        const wz = door.hinge[1] - lx * sin + lz * cos;
        corners.push([wx, wz]);
      }
    }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of corners) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    // 只要门处于「打开」状态（isOpen），碰撞盒立即失效——开门即通行，不等旋转动画转到位。
    // 之前用 Math.abs(targetAngle-animAngle)<1e-3 判定，会导致按 F 后门还在 30~60° 旋转途中
    // 把门洞斜插挡住，玩家"开了门立马走"就被卡住。这里让碰撞跟视觉解耦：动画只影响观感。
    const fullyOpen = door.isOpen;
    if (fullyOpen) {
      // 退化成零体积，放到门外空间，不再参与任何碰撞判定。
      door.collider.minX = door.collider.maxX = 99999;
      door.collider.minZ = door.collider.maxZ = 99999;
      return;
    }
    door.collider.minX = minX; door.collider.maxX = maxX;
    door.collider.minZ = minZ; door.collider.maxZ = maxZ;
    door.collider.minY = 0; door.collider.maxY = door.height;
  }

  // 每帧推进门扇旋转动画（引擎会调用）。dt 秒。
  updateDoors(dt) {
    const speed = 6.0; // 弧度/秒，约 0.3~0.4s 转完
    for (const door of this.doors) {
      const diff = door.targetAngle - door.animAngle;
      if (Math.abs(diff) > 1e-4) {
        const step = Math.sign(diff) * Math.min(Math.abs(diff), speed * dt);
        door.animAngle += step;
        door.pivot.rotation.y = door.baseYaw + door.animAngle;
      }
      // 碰撞盒始终贴合当前门扇角度（不管在开关途中还是静止）。
      this._updateDoorCollider(door);
    }
  }
}

// ============================================================
// 简单的房间外壳工具 —— 大多数单房间场景都是「一个矩形房间 + 四面墙」，
// 直接用这个生成，不用每关手写六块板子。
// 返回 { walls, occluders } 已被推入 level 的数组。
// ============================================================
export function buildRoomShell(level, helpers, room, opts = {}) {
  const { w, h, d } = room;
  const t = opts.thickness ?? 0.2;
  const helpers2 = helpers;
  // 地面 / 天花板（不参与碰撞，只做视觉，玩家脚下有 floor 即可）
  helpers2.box([w, t, d], [0, -t / 2, 0], {});
  helpers2.box([w, t, d], [0, h + t / 2, 0], {});
  // 四面墙（碰撞 + 遮挡）
  const flag = { collide: true, occlude: true, tag: 'wall' };
  helpers2.box([w, h, t], [0, h / 2, -d / 2], { ...flag, id: 'wall-n' });
  helpers2.box([w, h, t], [0, h / 2, d / 2], { ...flag, id: 'wall-s' });
  helpers2.box([t, h, d], [-w / 2, h / 2, 0], { ...flag, id: 'wall-w' });
  helpers2.box([t, h, d], [w / 2, h / 2, 0], { ...flag, id: 'wall-e' });
}

// ============================================================
// 箱庭（sandbox）工具 —— 一个「箱庭」= 一张世界平面，上面由多个
// 「矩形房间」拼成，房间之间靠「门」连通。整张箱庭就是一次加载的世界，
// 玩家在其中自由走动；行走范围 = 所有房间矩形的并集（可非矩形）。
//
// 与「场景(scene)」的关系：一个箱庭就是一个场景文件，箱庭多大由策划定
// （可以是一层楼，也可以是半层、几间房）。这里只负责把空间与墙搭出来。
//
// 用法：
//   const world = new WorldBuilder(level, helpers, {
//     rooms: [...],          // 必填：房间矩形列表（见下）
//     height: 4.2,           // 天花板高度（默认 4.2）
//     doors: [...],          // 门洞列表（见下）
//   });
//   world.buildAll();        // 一次搭好地面 + 外墙 + 交付 bounds
//
// 房间对象：
//   { id:'我的教室', minX:-14, maxX:-2, minZ:-11, maxZ:11 }
//   - 用 min/max 描述矩形（世界坐标）。
//
// 门洞（door opening）：
//   { wall:'e'|'w'|'n'|'s', at:<沿墙坐标>, width:2.2, room:'房间id' }
//   - wall 指该房间的哪面墙；at 是门中心沿墙的坐标（e/w 用 z，n/s 用 x）。
//   - 门洞 = 该段墙不砌墙，并被挖进并集范围里，上方自动生成门楣。
// ============================================================
export class WorldBuilder {
  constructor(level, helpers, opts = {}) {
    this.level = level;
    this.h = helpers;
    this.height = opts.height ?? 4.2;
    this.rooms = opts.rooms || [];
    this.doors = opts.doors || [];
    this.wallFlags = { collide: true, occlude: true, tag: 'wall' };
  }

  // 所有房间地面 + 天花板
  buildFloors() {
    const t = 0.2;
    for (const r of this.rooms) {
      const w = r.maxX - r.minX;
      const d = r.maxZ - r.minZ;
      const cx = (r.minX + r.maxX) / 2;
      const cz = (r.minZ + r.maxZ) / 2;
      this.h.box([w, t, d], [cx, -t / 2, cz], {});
      this.h.box([w, t, d], [cx, this.height + t / 2, cz], {});
    }
  }

  // 沿每个房间的四面墙砌墙；门洞处留空。房间交界处也砌墙（各砌各的，
  // 视觉上双线，正好是粉笔隔断感），仅门洞连通。这样最直观、不会误通。
  buildOutlineWalls() {
    const t = 0.2;
    // 先把所有门洞换算成「世界坐标线段」，供所有房间的墙统一避让：
    //    竖墙(e/w)：x 固定，沿 z；水平墙(n/s)：z 固定，沿 x。
    this._doorSegments = this.doors.map((d) => {
      const room = this.rooms.find((r) => r.id === d.room);
      if (!room) return null;
      if (d.wall === 'e' || d.wall === 'w') {
        const x = d.wall === 'e' ? room.maxX : room.minX;
        return { dir: 'z', fixed: x, from: d.at - d.width / 2, to: d.at + d.width / 2 };
      }
      const z = d.wall === 's' ? room.maxZ : room.minZ;
      return { dir: 'x', fixed: z, from: d.at - d.width / 2, to: d.at + d.width / 2 };
    }).filter(Boolean);

    for (const r of this.rooms) this._wallsForRoom(r, t);

    // 门洞上方的门楣：门洞全高留空会露出上方，这里在门洞上方补 2.7~H 的墙。
    const doorH = 2.7;
    for (const s of this._doorSegments) {
      const midAlong = (s.from + s.to) / 2;
      const w = s.to - s.from;
      const lintelH = this.height - doorH;
      if (lintelH <= 0.1) continue;
      if (s.dir === 'z') {
        this.h.box([0.2, lintelH, w], [s.fixed, doorH + lintelH / 2, midAlong], { ...this.wallFlags, id: 'door-lintel' });
      } else {
        this.h.box([w, lintelH, 0.2], [midAlong, doorH + lintelH / 2, s.fixed], { ...this.wallFlags, id: 'door-lintel' });
      }
    }
  }

  _holesOnEdge(e) {
    // 返回该墙上的门洞区间 [a,b]（沿墙坐标）。门洞线段方向与墙一致且固定坐标吻合。
    const wantDir = e.along; // 'x' 或 'z'
    return this._doorSegments
      .filter((s) => s.dir === wantDir && Math.abs(s.fixed - e.fixed) < 0.001)
      .map((s) => [s.from, s.to]);
  }

  _wallsForRoom(r, t) {
    const H = this.height;
    const edges = [
      { key: 'n', fixed: r.minZ, along: 'x', from: r.minX, to: r.maxX },
      { key: 's', fixed: r.maxZ, along: 'x', from: r.minX, to: r.maxX },
      { key: 'w', fixed: r.minX, along: 'z', from: r.minZ, to: r.maxZ },
      { key: 'e', fixed: r.maxX, along: 'z', from: r.minZ, to: r.maxZ },
    ];

    for (const e of edges) {
      const len = e.to - e.from;
      const step = 0.25;
      const holes = this._holesOnEdge(e);
      const inHole = (v) => holes.some(([a, b]) => v > a - 1e-6 && v < b + 1e-6);

      const runs = [];
      let runStart = null;
      const n = Math.max(1, Math.ceil(len / step));
      for (let i = 0; i < n; i++) {
        const a = e.from + (len * i) / n;
        const b = e.from + (len * (i + 1)) / n;
        const mid = (a + b) / 2;
        const build = !inHole(mid);
        if (build && runStart === null) runStart = a;
        if (!build && runStart !== null) { runs.push([runStart, a]); runStart = null; }
      }
      if (runStart !== null) runs.push([runStart, e.to]);

      for (const [sa, sb] of runs) {
        const segLen = sb - sa;
        if (segLen < 0.05) continue;
        const mid = (sa + sb) / 2;
        if (e.along === 'x') {
          this.h.box([segLen, H, t], [mid, H / 2, e.fixed], { ...this.wallFlags, id: `wall-${r.id}-${e.key}` });
        } else {
          this.h.box([t, H, segLen], [e.fixed, H / 2, mid], { ...this.wallFlags, id: `wall-${r.id}-${e.key}` });
        }
      }
    }
  }

  // 把「可行走范围」交给 level.bounds：一个矩形列表，contains(x,z) 判定。
  setLevelBounds() {
    const rects = this.rooms.map((r) => ({ minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ }));
    this.level.bounds = {
      kind: 'rects',
      rects,
      // 判断某点是否在任一房间矩形内（可加 margin 用于贴墙时放宽）。
      contains(x, z, margin = 0) {
        for (const r of rects) {
          if (x >= r.minX - margin && x <= r.maxX + margin &&
              z >= r.minZ - margin && z <= r.maxZ + margin) return true;
        }
        return false;
      },
    };
  }

  // 便捷：一次构建地面 + 外墙 + 交付 bounds。
  buildAll() {
    this.buildFloors();
    this.buildOutlineWalls();
    this.setLevelBounds();
    return this;
  }
}
