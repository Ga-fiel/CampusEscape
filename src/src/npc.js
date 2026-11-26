// 巡逻 NPC：路径点巡逻 + 视野锥 + 锁敌 + 盘问。
// 状态机：PATROL（按路线走）→ SUSPICIOUS（盯住、累积注意值）→ CHASE（追过来）
//        → TALK（走到跟前，交给游戏层弹对话）→ RETURN（走回路线）
import * as THREE from 'three';
import { makeInkMaterial, INK } from './render.js';

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();

// 只被"看得见"的物体挡视线；noShoot 的盒子（隐形墙等）忽略
const SEE_THROUGH = (b) => !!(b.data && b.data.noShoot);

export const ST = { PATROL: 0, SUSPICIOUS: 1, CHASE: 2, TALK: 3, RETURN: 4 };

export class Npc {
  constructor(scene, opts = {}) {
    this.name = opts.name || '老师';
    this.patrol = (opts.patrol || [new THREE.Vector3()]).map((p) => p.clone());
    this.speed = opts.speed ?? 2.0;
    this.chaseSpeed = opts.chaseSpeed ?? this.speed * 2.2;
    this.viewRange = opts.viewRange ?? 12;
    this.hearRange = opts.hearRange ?? 0;      // 听觉半径（脚步声）
    this.fov = opts.fov ?? Math.PI / 3;
    this.eyeHeight = opts.eyeHeight ?? 1.55;
    this.waitAt = opts.waitAt ?? 0;
    this.fixed = opts.patrol ? opts.patrol.length === 1 : true;
    this.canTalk = opts.canTalk !== false;

    // 讲台老师：站在黑板前，写字/转身循环
    this.boardMode = opts.boardMode || false;
    this.boardT = 0;
    this.boardPhase = 0;                                  // 0写字 1停笔 2转身看 3转回
    this.boardDur = opts.boardDur || [4.0, 0.6, 2.0, 0.8];
    this.exposure = 0;                                    // 暴露在老师视线里的程度 0-1
    this.heatScale = 1;                                   // 可疑度越高，注意值涨得越快

    this.pos = this.patrol[0].clone();
    this.idx = 0;
    this.waitT = 0;
    this.forward = new THREE.Vector3(0, 0, -1);
    this.sees = false;
    this.eye = new THREE.Vector3();

    // ---- 状态机 ----
    this.state = ST.PATROL;
    this.notice = 0;          // 注意值 0-100，满了走过来盘问
    this.suspT = 0;           // 盯梢最短停留（听到脚步时给足回头时间）
    this.lostT = 0;           // 追丢的时间
    this.talkCd = 0;          // 盘问冷却
    this.talkT = 0;           // 当前盘问已持续时间（防卡死）
    this.talkCount = 0;       // 被你糊弄过几次：0=第一次
    this.silent = false;      // 搜捕时禁止盘问，直接抓
    this.ignore = false;      // 门卫：有请假条就当你透明
    this.onTalk = null;       // 游戏层注入

    // ---- 涂鸦小人 ----
    this.group = new THREE.Group();
    const ink = opts.ink ?? INK.RED;
    const mat = makeInkMaterial({ ink });
    const dark = makeInkMaterial({ ink: INK.BLACK });

    const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.72, 6), dark);
    legs.position.y = 0.36;
    this.group.add(legs);

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.78, 10), mat);
    body.position.y = 1.08;
    this.group.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 10, 8), mat);
    head.position.y = 1.62;
    this.group.add(head);

    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.2), dark);
    nose.position.set(0, 1.62, -0.2);
    this.group.add(nose);

    // 视野扇形
    const fanGeo = new THREE.CircleGeometry(this.viewRange, 24, Math.PI / 2 - this.fov / 2, this.fov);
    fanGeo.rotateX(-Math.PI / 2);
    this.fanMat = new THREE.MeshBasicMaterial({
      color: 0xa01c28, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false,
    });
    this.fan = new THREE.Mesh(fanGeo, this.fanMat);
    this.fan.position.y = 0.03;
    this.group.add(this.fan);

    this.group.position.copy(this.pos);
    scene.add(this.group);
  }

  get eyePos() {
    return _v.set(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
  }

  distTo(target) {
    return Math.hypot(target.x - this.pos.x, target.z - this.pos.z);
  }

  canSee(world, targetEye) {
    const eye = this.eyePos;
    _d.copy(targetEye).sub(eye);
    const dist = _d.length();
    if (dist > this.viewRange || dist < 0.01) return false;
    _d.divideScalar(dist);
    if (this.forward.dot(_d) < Math.cos(this.fov / 2)) return false;
    return world.hasLineOfSight(eye, targetEye, SEE_THROUGH);
  }

  // 盘问结束：pass=true 放行回路线；false 继续追
  // ---------------- 讲台老师：写字 / 转身 ----------------
  _boardUpdate(dt, world, player) {
    this.boardT += dt;
    let dur = this.boardDur[this.boardPhase];
    while (this.boardT >= dur) {
      this.boardT -= dur;
      this.boardPhase = (this.boardPhase + 1) % 4;
      dur = this.boardDur[this.boardPhase];
    }
    // 写字(0)和转回(3)时背对教室；停笔(1)和转身(2)时面向教室
    const facingBoard = this.boardPhase === 0 || this.boardPhase === 3;
    this.forward.set(facingBoard ? 1 : -1, 0, 0);

    // 暴露判定：不是露头就秒，而是累计 0.5 秒才被认定看见（可疑度越高越快）
    if (this.boardPhase === 2 && player) {
      const visible = this._lookAtRoom(world, player);
      if (visible) this.exposure = Math.min(1, this.exposure + (dt / 0.5) * this.heatScale);
      else this.exposure = Math.max(0, this.exposure - dt * 2.5);
    } else {
      this.exposure = Math.max(0, this.exposure - dt * 2.5);
    }
    this.sees = this.exposure >= 1;
  }

  // 讲台上看整个教室：距离无限，但蹲在课桌后 / 自己座位旁 就看不到
  _lookAtRoom(world, player) {
    if (!player.inClassroom) return false;
    if (player.sitting) return false;                       // 坐在座位上本来就正常
    if (player.nearSeat) return false;                      // 座位附近 = 假装捡笔
    if (player.crouching && player.hasCover) return false;  // 蹲在桌后 = 藏好
    return world.hasLineOfSight(this.eyePos, player.eye, SEE_THROUGH);
  }

  endTalk(pass, player) {
    this.notice = 0;
    this.talkCd = pass ? (this.talkCount === 0 ? 20 : 14) : 10;
    this.talkCount++;
    if (this.boardMode) return;          // 讲台老师不用回巡逻
    // 走向离玩家最远的巡逻点，别在你旁边晃
    if (player && this.patrol.length > 1) {
      let best = 0, bestD = -1;
      for (let i = 0; i < this.patrol.length; i++) {
        const d = Math.hypot(
          this.patrol[i].x - player.body.pos.x,
          this.patrol[i].z - player.body.pos.z
        );
        if (d > bestD) { bestD = d; best = i; }
      }
      this.idx = best;
    }
    this.state = ST.RETURN;
  }

  update(dt, world, player) {
    this.world = world;
    this.eye.copy(this.eyePos);

    // 讲台老师走自己的循环，不进巡逻状态机
    if (this.boardMode) {
      if (this.talkCd > 0) this.talkCd -= dt;
      this._boardUpdate(dt, world, player);
      this.group.position.copy(this.pos);
      this.group.rotation.y = Math.atan2(-this.forward.x, -this.forward.z);
      return;
    }

    if (this.talkCd > 0) this.talkCd -= dt;

    const ppos = player ? player.body.pos : null;
    const dist = ppos ? this.distTo(ppos) : 999;
    // 玩家在教室里 = 安全区，老师不会进来找你
    const safe = !!(player && player.inClassroom);
    const seen = player && !safe && this.state !== ST.TALK ? this.canSee(world, player.eye) : false;
    this.sees = seen;

    // 脚步噪声半径：静止 0 / 蹲行 2 / 走 6 / 跑 11
    const noise = player && player.noiseRadius ? player.noiseRadius : 0;

    switch (this.state) {
      // ---------------- 巡逻 ----------------
      case ST.PATROL: {
        if (!this.fixed) this._patrolStep(dt);
        if (safe) break;
        if (seen && !this.ignore && this.talkCd <= 0 && this.canTalk) {
          this.state = ST.SUSPICIOUS;
          this.notice = 0;
          this.suspT = 0.6;
        } else if (!this.ignore && this.hearRange > 0 && noise > 0 && dist < Math.min(noise, this.hearRange) && this.talkCd <= 0) {
          // 听到脚步：直接回头看一眼
          this.state = ST.SUSPICIOUS;
          this.notice = 0;
          this.suspT = 1.4;
        }
        break;
      }

      // ---------------- 盯住：注意值按距离累积 ----------------
      case ST.SUSPICIOUS: {
        if (safe) { this.notice = 0; this.state = ST.PATROL; break; }
        this._facePlayer(dt, player);
        if (this.suspT > 0) this.suspT -= dt;
        if (seen) {
          // 越近涨得越快，且随可疑度整体加速：1m 处约 0.7 秒满，12m 处约 7 秒满
          const rate = (100 / Math.max(0.7, dist * 0.6)) * this.heatScale;
          this.notice = Math.min(100, this.notice + rate * dt);
        } else {
          this.notice = Math.max(0, this.notice - 30 * dt);
          if (this.notice <= 0 && this.suspT <= 0) {
            this.notice = 0;
            this.state = ST.PATROL;
          }
        }
        if (this.notice >= 100) {
          this.state = ST.CHASE;
          this.lostT = 0;
        }
        break;
      }

      // ---------------- 锁敌：追过来 ----------------
      case ST.CHASE: {
        if (safe) { this.state = ST.RETURN; this.lostT = 0; break; }
        this._facePlayer(dt, player);
        // 保证留出一点身位：平时停在 1.5m，搜捕时贴到 0.6m
        const keep = this.silent ? 0.6 : 1.5;
        if (ppos && dist > keep && !this.fixed) this._moveTowards(dt, ppos, this.chaseSpeed);
        if (ppos && dist < 1.9 && this.canTalk && !this.silent && this.talkCd <= 0) {
          this.state = ST.TALK;
          this.talkT = 0;
          if (this.onTalk) this.onTalk(this);
        } else if (!seen) {
          this.lostT += dt;
          if (this.lostT > 2.5) this.state = ST.RETURN;
        } else {
          this.lostT = 0;
        }
        break;
      }

      // ---------------- 盘问：站着（游戏层接管） ----------------
      case ST.TALK: {
        this._facePlayer(dt, player);
        this.talkT += dt;
        // 游戏层 4 秒内没接管（比如同时被两个人追），自动恢复追击，避免卡死
        if (this.talkT > 4) { this.talkT = 0; this.state = ST.CHASE; }
        break;
      }

      // ---------------- 回路线 ----------------
      case ST.RETURN: {
        const target = this.patrol[this.idx] || this.patrol[0];
        const d = this._moveTowards(dt, target, this.speed);
        if (d < 0.45) {
          this.state = ST.PATROL;
          this.notice = 0;
        }
        break;
      }
    }

    // 视野扇形随状态变色
    const alarm = this.state === ST.PATROL ? 0 : this.state === ST.SUSPICIOUS ? this.notice / 100 : 1;
    this.fanMat.opacity = 0.06 + alarm * 0.16;

    this.group.position.copy(this.pos);
    this.group.rotation.y = Math.atan2(-this.forward.x, -this.forward.z);
  }

  _patrolStep(dt) {
    if (this.waitT > 0) {
      this.waitT -= dt;
      return;
    }
    const target = this.patrol[this.idx];
    const d = this._moveTowards(dt, target, this.speed);
    if (d < 0.35) {
      this.idx = (this.idx + 1) % this.patrol.length;
      this.waitT = this.waitAt;
    }
  }

  _moveTowards(dt, target, speed) {
    const dx = target.x - this.pos.x;
    const dz = target.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.001) return 0;
    const step = Math.min(dist, speed * dt);
    const nx = this.pos.x + (dx / dist) * step;
    const nz = this.pos.z + (dz / dist) * step;

    // 撞墙就不动，别穿墙进教室
    if (this.world && this.world.overlapsAABB(
      { x: nx - 0.3, y: 0.2, z: nz - 0.3 },
      { x: nx + 0.3, y: 1.8, z: nz + 0.3 }
    )) return dist;

    this.pos.x = nx;
    this.pos.z = nz;
    _d.set(dx / dist, 0, dz / dist);
    this._turnTowards(_d, dt * 5);
    return dist;
  }

  _facePlayer(dt, player) {
    if (!player) return;
    _d.copy(player.eye).setY(0).sub(this.pos).setY(0);
    if (_d.lengthSq() > 0.001) {
      _d.normalize();
      this._turnTowards(_d, dt * 4.0);
    }
  }

  _turnTowards(dir, k) {
    const cur = Math.atan2(-this.forward.x, -this.forward.z);
    const want = Math.atan2(-dir.x, -dir.z);
    let diff = want - cur;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const a = cur + diff * Math.min(1, k);
    this.forward.set(-Math.sin(a), 0, -Math.cos(a));
  }
}
