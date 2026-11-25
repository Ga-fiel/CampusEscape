import * as THREE from 'three';
import { ChalkRenderer } from './chalk.js';
import { buildClassroom, ROOM, walls } from './level.js';
import { Teacher } from './teacher.js';

const canvas = document.getElementById('game');
const R = new ChalkRenderer(canvas);
buildClassroom(R.scene);
const teacher = new Teacher(R.scene);

const camera = R.camera;
camera.position.set(0, 1.6, ROOM.d / 2 - 2.5); // 从后门附近出发
camera.rotation.order = 'YXZ';

let yaw = 0, pitch = 0;
const keys = {};
let caught = false;
let won = false;

// ---- 输入 ----
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== canvas) {
    document.getElementById('start').classList.remove('hidden');
  } else {
    document.getElementById('start').classList.add('hidden');
  }
});
canvas.addEventListener('click', () => canvas.requestPointerLock());
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  yaw -= e.movementX * 0.0022;
  pitch -= e.movementY * 0.0022;
  pitch = Math.max(-1.4, Math.min(1.4, pitch));
});
document.addEventListener('keydown', (e) => { keys[e.code] = true; });
document.addEventListener('keyup', (e) => { keys[e.code] = false; });
document.getElementById('start').addEventListener('click', () => canvas.requestPointerLock());

// ---- 尺寸 ----
function resize() {
  R.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

// ---- 简化碰撞：把玩家推出 AABB ----
const PR = 0.35;
function resolve(pos) {
  for (const w of walls) {
    if (pos.x > w.minX - PR && pos.x < w.maxX + PR &&
        pos.z > w.minZ - PR && pos.z < w.maxZ + PR) {
      const left = pos.x - (w.minX - PR);
      const right = (w.maxX + PR) - pos.x;
      const back = pos.z - (w.minZ - PR);
      const front = (w.maxZ + PR) - pos.z;
      const m = Math.min(left, right, back, front);
      if (m === left) pos.x = w.minX - PR;
      else if (m === right) pos.x = w.maxX + PR;
      else if (m === back) pos.z = w.minZ - PR;
      else pos.z = w.maxZ + PR;
    }
  }
  pos.x = Math.max(-ROOM.w / 2 + PR, Math.min(ROOM.w / 2 - PR, pos.x));
  pos.z = Math.max(-ROOM.d / 2 + PR, Math.min(ROOM.d / 2 - PR, pos.z));
}

// ---- 主循环 ----
let last = performance.now();
function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  if (!caught && !won) {
    const speed = 4.2 * dt;
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const move = new THREE.Vector3();
    if (keys['KeyW']) move.add(fwd);
    if (keys['KeyS']) move.sub(fwd);
    if (keys['KeyD']) move.add(right);
    if (keys['KeyA']) move.sub(right);
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(speed);
      camera.position.add(move);
      resolve(camera.position);
    }
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;

    if (teacher.update(dt, camera.position)) {
      caught = true;
      document.getElementById('hint').textContent = '⚠ 被老师发现了！按 R 重来';
      document.exitPointerLock();
    }
    // 到达前墙黑板附近视为"逃出"（切片先简单判定）
    if (camera.position.z < -ROOM.d / 2 + 1.2) {
      won = true;
      document.getElementById('hint').textContent = '✓ 逃出成功！按 R 重来';
      document.exitPointerLock();
    }
  }

  if (keys['KeyR'] && (caught || won)) {
    caught = false; won = false;
    camera.position.set(0, 1.6, ROOM.d / 2 - 2.5);
    yaw = 0; pitch = 0;
    document.getElementById('hint').textContent =
      'WASD 移动 · 鼠标看向 · 避开老师视线，摸到前方黑板处逃出';
  }

  R.render();
}
requestAnimationFrame(tick);
