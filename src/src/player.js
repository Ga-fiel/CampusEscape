// 精简第一人称控制器：走 / 跑 / 蹲 / 跳 / 蹲下钻低洞。
// 相比原项目 player.js 砍掉了武器、抓钩、滑铲、墙跳、空中冲刺。
import * as THREE from 'three';
import { makeBody } from './physics.js';
import { clamp } from './util.js';

const G = 26;
const WALK = 3.3, RUN = 5.6, CROUCH_SPEED = 1.3;   // 蹲行放慢：教室窗口 4.8 秒走不完
const JUMP = 7.6;               // 约 1.1m 起跳高度
const STAND_H = 1.75;
const CROUCH_H = 0.72;          // 低于课桌(0.74)，蹲下才真的藏得住
const EYE_STAND = 1.58, EYE_CROUCH = 0.5;
const ACCEL = 13;

export class Player {
  constructor(camera, world, start) {
    this.camera = camera;
    this.world = world;
    this.spawn = start.clone();
    this.body = makeBody(start.clone(), 0.34, STAND_H, 0.55);
    this.yaw = 0;
    this.pitch = 0;
    this.crouching = false;
    this.eyeH = EYE_STAND;
    this.alert = 0;
    this.inventory = new Set();
    this.held = null;          // 手上拿的东西（伪装用）
    this.bobT = 0;
    this.jumpBuf = 0;          // 跳跃输入缓冲，落地前一瞬间按下也算
    this.sprinting = false;    // 当前是否在跑（决定脚步声大小）
    this.sitting = false;      // 坐在座位上
    this.seatPos = new THREE.Vector3();
    this.hitFlash = 0;
    this.startYaw = 0;
  }

  sitAt(pos) {
    this.sitting = true;
    this.seatPos.copy(pos);
    this.body.pos.set(pos.x, pos.y, pos.z);
    this.body.vel.set(0, 0, 0);
    this.body.height = STAND_H;
    this.crouching = false;
  }

  standUp() {
    if (!this.sitting) return;
    this.sitting = false;
    this.body.pos.y = this.seatPos.y;   // 保持所在楼层，别掉回 1F
    this.body.vel.set(0, 0, 0);
  }

  teleport(pos, yaw = 0) {
    this.sitting = false;
    this.body.pos.copy(pos);
    this.body.vel.set(0, 0, 0);
    this.body.height = STAND_H;
    this.crouching = false;
    this.eyeH = EYE_STAND;
    this.alert = 0;
    this.yaw = yaw;
    this.startYaw = yaw;
  }

  get eye() {
    return new THREE.Vector3(
      this.body.pos.x,
      this.body.pos.y + this.eyeH,
      this.body.pos.z
    );
  }

  // 脚步声能传多远：静止 0 / 蹲行 2 / 走 6 / 跑 11
  get noiseRadius() {
    const sp = Math.hypot(this.body.vel.x, this.body.vel.z);
    if (sp < 0.4) return 0;
    if (this.crouching) return 2;
    if (this.sprinting) return 11;
    return 6;
  }

  get moving() {
    return Math.hypot(this.body.vel.x, this.body.vel.z) > 0.5;
  }

  update(dt, input) {
    const b = this.body;

    // ---- 视角 ----
    this.yaw -= input.mouseDX * 0.0023;
    this.pitch = clamp(this.pitch - input.mouseDY * 0.0023, -1.35, 1.35);

    // ---- 坐在座位上：不能移动，视角仍可转，按方向键自动站起 ----
    if (this.sitting) {
      b.vel.set(0, 0, 0);
      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.set(this.pitch, this.yaw, 0);
      this.camera.position.set(this.seatPos.x, this.seatPos.y + 1.12, this.seatPos.z);
      if (input.forward || input.back || input.left || input.right) this.standUp();
      if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt * 2);
      return;
    }

    // ---- 蹲 / 起（教室里只能蹲着走） ----
    if (this.inClassroom) {
      this.crouching = true;
      b.height = CROUCH_H;
    } else if (input.crouch) {
      this.crouching = true;
      b.height = CROUCH_H;
    } else if (this.crouching) {
      b.height = STAND_H;
      if (this.world.overlapsBody(b)) b.height = CROUCH_H;  // 头顶有东西，站不起来
      else this.crouching = false;
    }
    const wantEye = this.crouching ? EYE_CROUCH : EYE_STAND;
    this.eyeH += (wantEye - this.eyeH) * Math.min(1, dt * 14);

    // ---- 水平移动 ----
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);

    let wx = 0, wz = 0;
    if (input.forward) { wx += fx; wz += fz; }
    if (input.back) { wx -= fx; wz -= fz; }
    if (input.right) { wx += rx; wz += rz; }
    if (input.left) { wx -= rx; wz -= rz; }
    const wl = Math.hypot(wx, wz);
    if (wl > 0.001) { wx /= wl; wz /= wl; }

    const speed = this.crouching ? CROUCH_SPEED : (input.run ? RUN : WALK);
    this.sprinting = !this.crouching && !!input.run;
    const k = 1 - Math.exp(-ACCEL * dt);
    b.vel.x += (wx * speed - b.vel.x) * k;
    b.vel.z += (wz * speed - b.vel.z) * k;

    // ---- 跳跃（0.15 秒输入缓冲） ----
    if (input.jump) { this.jumpBuf = 0.15; input.jump = false; }
    else if (this.jumpBuf > 0) this.jumpBuf -= dt;
    if (this.jumpBuf > 0 && b.onGround) {
      b.vel.y = JUMP;
      b.onGround = false;
      this.jumpBuf = 0;
    }

    // ---- 重力 + 碰撞 ----
    b.vel.y -= G * dt;
    this.world.moveBody(b, dt);
    if (b.pos.y < -30) this.teleport(this.spawn, this.startYaw);

    // ---- 相机 ----
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.pitch, this.yaw, 0);

    const sp = Math.hypot(b.vel.x, b.vel.z);
    if (sp > 0.4 && b.onGround) this.bobT += dt * sp * 2.4;
    const bob = Math.sin(this.bobT) * Math.min(0.03, sp * 0.0055);

    this.camera.position.set(b.pos.x, b.pos.y + this.eyeH + bob, b.pos.z);

    if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt * 2);
  }
}
