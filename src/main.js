import * as THREE from 'three';
import { ChalkRenderer } from './chalk.js';
import { SceneManager } from './scenes/scene-manager.js';
import { Inventory } from './game/inventory.js';
import { createPlayerBody, updatePlayerBody } from './player-body.js';

// ============================================================
// 初始场景 —— 调试时改这里，或 URL 加 ?scene=floor3 直接进某个场景。
// ============================================================
const INITIAL_SCENE = new URLSearchParams(location.search).get('scene') || 'floor3';

const canvas = document.getElementById('game');
const R = new ChalkRenderer(canvas);

// 物品栏：整个游戏唯一一份，跨场景携带。
const inventory = new Inventory();

// 场景管理器：管进出场景、敌人、拾取、出口。
const lm = new SceneManager({ scene: R.scene, inventory });
lm.onCaught = () => fail();
window.__lm = lm; // 调试用：控制台/自动化可直接访问

const camera = R.camera;
camera.rotation.order = 'YXZ';
window.__cam = camera; // 调试用

// 第一人称「自己身体」：挂在相机下，低头能看到大腿/手臂。
R.scene.add(camera);           // 相机进场景，其子节点（身体）才会被渲染
const playerBody = createPlayerBody(camera);

const ui = {
  start: document.getElementById('start'),
  startBtn: document.getElementById('startBtn'),
  startHint: document.getElementById('startHint'),
  intro: document.getElementById('intro'),
  suspicion: document.getElementById('suspicion'),
  suspicionFill: document.getElementById('suspicionFill'),
  suspicionText: document.getElementById('suspicionText'),
  crouch: document.getElementById('crouch'),
  noise: document.getElementById('noise'),
  lookWarning: document.getElementById('lookWarning'),
  interact: document.getElementById('interact'),
  danger: document.getElementById('danger'),
  ending: document.getElementById('ending'),
  endingTitle: document.getElementById('endingTitle'),
  endingBody: document.getElementById('endingBody'),
  endingAction: document.getElementById('endingAction'),
  crosshair: document.getElementById('crosshair'),
};

const STATE = { PLAYING: 'playing', CAUGHT: 'caught', WON: 'won' };
let gameState = STATE.PLAYING;
let started = false;
// 调试钩子：控制台可用 window.__dbg 摆位/置状态
window.__dbg = {
  setStart() { started = true; ui.start && ui.start.classList.add('hidden'); },
  place(x, z, y) { camera.position.set(x, y ?? 1.6, z); },
  face(deg) { yaw = THREE.MathUtils.degToRad(deg); camera.rotation.y = yaw; },
  state() { return { x: +camera.position.x.toFixed(2), z: +camera.position.z.toFixed(2), yaw: +(yaw * 180 / Math.PI).toFixed(1), state: gameState }; },
};
let suspicion = 0;
let crouched = false;
let noiseCooldown = 0;
let seenTimer = 0;
const SEEN_KILL_TIME = 0.35;
let suspicionFade = 0;
let introTimer = 8;
let yaw = 0;
let pitch = 0;
let moving = false;
let dialogShown = false;
let currentSceneId = INITIAL_SCENE;
const isShot = new URLSearchParams(location.search).has('shot');
const DEBUG = new URLSearchParams(location.search).has('debug');
const dbgEl = document.createElement('div');
dbgEl.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9999;background:rgba(0,0,0,.72);color:#7CFC00;font:12px/1.5 monospace;padding:6px 10px;border-radius:4px;display:none;pointer-events:none;white-space:pre;';
document.body.appendChild(dbgEl);
started = isShot;

const keys = {};
const PR = 0.35;
const STAND_SPEED = 4.2;
const CROUCH_SPEED = 0.42;
const STAND_EYE = 1.6;
const CROUCH_EYE = 0.85;

// 世界边界：由当前关卡给出。若关卡提供 bounds（箱庭多矩形），用 bounds.contains；
// 否则退回矩形房间 roomBounds。
let roomBounds = { w: 16, d: 22 };
function updateBounds() {
  const lv = lm.current;
  if (!lv) return;
  if (lv.bounds && typeof lv.bounds.contains === 'function') {
    roomBounds = null; // 用 bounds 判定，不用矩形夹取
    return;
  }
  const room = lv.room;
  if (room) roomBounds = { w: room.w, d: room.d };
}

// 把玩家放到当前关出生点。
function placeAtSpawn() {
  const sp = lm.spawn();
  camera.position.copy(sp.pos);
  yaw = sp.yaw || 0;
  pitch = 0;
  camera.rotation.set(0, pitch, yaw);
}

// ---- 加载一个场景并重置玩家到该场景出生点 ----
function loadScene(id, keepState = false) {
  lm.load(id);
  currentSceneId = id;
  updateBounds();
  placeAtSpawn();
  if (!keepState) {
    suspicion = 0;
    crouched = false;
    seenTimer = 0;
    suspicionFade = 0;
    moving = false;
    introTimer = 8;
    for (const key of Object.keys(keys)) keys[key] = false;
  }
  refreshHUD();
}

function setPlayerAtStart() {
  placeAtSpawn();
}

function beginGame() {
  if (gameState !== STATE.PLAYING) return;
  started = true;
  ui.start.classList.add('hidden');
  if (!isShot) canvas.requestPointerLock();
}

function resetGame() {
  gameState = STATE.PLAYING;
  started = true;
  suspicion = 0;
  crouched = false;
  noiseCooldown = 0;
  seenTimer = 0;
  suspicionFade = 0;
  introTimer = 8;
  dialogShown = false;
  moving = false;
  for (const key of Object.keys(keys)) keys[key] = false;
  loadScene(currentSceneId, true);
  ui.ending.classList.add('hidden');
  ui.ending.classList.remove('failed');
  ui.start.classList.add('hidden');
  ui.crosshair.classList.remove('hidden');
  ui.intro.classList.remove('hidden');
  if (!isShot) canvas.requestPointerLock();
}

function refreshHUD() {
  ui.suspicion.classList.remove('visible');
  ui.suspicionFill.style.width = '0%';
  ui.suspicionText.textContent = '0%';
  ui.danger.style.opacity = '0';
  ui.crouch.classList.remove('visible');
  ui.noise.classList.remove('visible');
  ui.lookWarning.classList.remove('visible');
  ui.interact.classList.remove('visible');
}

function endGame(kind, title, body) {
  gameState = kind;
  ui.endingTitle.textContent = title;
  ui.endingBody.innerHTML = body;
  ui.endingAction.textContent = '[R] 重来';
  ui.ending.classList.remove('hidden');
  ui.ending.classList.toggle('failed', kind === STATE.CAUGHT);
  ui.lookWarning.classList.remove('visible');
  ui.interact.classList.remove('visible');
  ui.crosshair.classList.add('hidden');
  if (document.pointerLockElement === canvas) document.exitPointerLock();
}

function fail() {
  if (gameState !== STATE.PLAYING) return;
  gameState = STATE.CAUGHT;
  suspicion = 100;
  crouched = false;
  ui.danger.style.opacity = '1';
  ui.suspicion.classList.add('visible');
  ui.suspicionFill.style.width = '100%';
  ui.suspicionText.textContent = '100%';
  ui.intro.classList.add('hidden');
  ui.crosshair.classList.add('hidden');
  lm.startChase(camera.position);
}

function showCaughtDialog() {
  if (dialogShown) return;
  dialogShown = true;
  endGame(STATE.CAUGHT, '被抓住了', '<p class="speaker">老师：</p><p class="line">“你在干什么！”</p><p class="line">“为什么离开座位！”</p>');
}

function win() {
  if (gameState !== STATE.PLAYING) return;
  gameState = STATE.WON;
  ui.danger.style.opacity = '0';
  ui.suspicion.classList.remove('visible');
  ui.intro.classList.add('hidden');
  ui.crosshair.classList.add('hidden');
  endGame(STATE.WON, '通关！', '<p class="line">你逃出了学校。</p>');
}

// 走出口：切关或通关。
function goThroughExit(exit) {
  const res = lm.goThroughExit(exit);
  if (res.type === 'win') {
    win();
    return;
  }
  // 切到新场景：重置玩家到新场景出生点，保留物品栏，清怀疑度。
  currentSceneId = res.target;
  updateBounds();
  suspicion = 0;
  crouched = false;
  seenTimer = 0;
  suspicionFade = 0;
  moving = false;
  introTimer = 5;
  placeAtSpawn();
  const lvName = lm.current.meta.name || res.target;
  ui.intro.innerHTML = `<p class="goal">${lvName}</p>`;
  ui.intro.classList.remove('hidden');
}

function addSuspicion(amount) {
  suspicion = Math.min(100, suspicion + amount);
  suspicionFade = 3;
  if (suspicion >= 100) fail();
}

function triggerNoise() {
  if (noiseCooldown > 0 || gameState !== STATE.PLAYING) return;
  noiseCooldown = 0.8;
  addSuspicion(35);
  ui.noise.classList.add('visible');
  setTimeout(() => ui.noise.classList.remove('visible'), 850);
  lm.alertEnemies(camera.position);
}

// 把玩家推出 AABB；返回是否碰到了会发声的物体。
function resolveCollisions(pos) {
  let hitNoise = false;
  const walls = lm.current?.walls || [];
  // 玩家身体占据的竖直范围（脚底到头顶）。用于跳过门楣/天花板等「高处盒子」。
  // 之前没有这项判断，导致门洞正上方的门楣(minY≈2.7)在 x/z 上和墙一样，
  // 膨胀 PR 后把玩家拦在门外 0.45m 处——人明明开了门就是过不去。
  const PLAYER_HEAD = 1.8;
  for (const w of walls) {
    // 竖直方向不重叠就跳过：门楣/天花板(minY>头顶) 或 纯地面(maxY<脚底) 不挡人。
    const wMinY = (w.minY == null) ? 0 : w.minY;
    const wMaxY = (w.maxY == null) ? Infinity : w.maxY;
    if (wMinY > PLAYER_HEAD || wMaxY < 0.05) continue;
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
      if (w.noise) hitNoise = true;
    }
  }
  if (roomBounds) {
    pos.x = Math.max(-roomBounds.w / 2 + PR, Math.min(roomBounds.w / 2 - PR, pos.x));
    pos.z = Math.max(-roomBounds.d / 2 + PR, Math.min(roomBounds.d / 2 - PR, pos.z));
  }
  return hitNoise;
}

// ------------------------------------------------------------------
// 箱庭行走范围校验：把目标点按「房间并集包含」检查，逐轴移动避免卡墙。
// 用 level.bounds.contains(x, z) 判定某点是否在可行走空间内。
// 先整体移动，若越界则分别尝试只走 X / 只走 Z（实现贴墙滑动）。
// ------------------------------------------------------------------
function moveWithBounds(pos, dx, dz) {
  const lv = lm.current;
  const contains = (x, z) => {
    if (lv && lv.bounds && typeof lv.bounds.contains === 'function') {
      return lv.bounds.contains(x, z);
    }
    if (roomBounds) {
      return x >= -roomBounds.w / 2 + PR && x <= roomBounds.w / 2 - PR &&
             z >= -roomBounds.d / 2 + PR && z <= roomBounds.d / 2 - PR;
    }
    return true;
  };
  if (contains(pos.x + dx, pos.z + dz)) {
    pos.x += dx; pos.z += dz;
  } else if (contains(pos.x + dx, pos.z)) {
    pos.x += dx;
  } else if (contains(pos.x, pos.z + dz)) {
    pos.z += dz;
  }
  // 若都不行，原地不动（被墙/边界挡住）。
}

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (locked) {
    started = true;
    ui.start.classList.add('hidden');
  } else if (gameState === STATE.PLAYING && !isShot) {
    started = false;
    ui.startHint.textContent = 'WASD 移动 · 按住 Shift 蹲下 · 鼠标观察 · E 交互';
    ui.startBtn.textContent = '继续';
    ui.start.classList.remove('hidden');
  }
});
canvas.addEventListener('click', () => {
  if (gameState === STATE.PLAYING && !isShot) beginGame();
});
ui.startBtn.addEventListener('click', beginGame);

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas || gameState !== STATE.PLAYING) return;
  yaw -= e.movementX * 0.0022;
  pitch -= e.movementY * 0.0022;
  pitch = Math.max(-1.4, Math.min(1.4, pitch));
});
document.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'KeyR') { resetGame(); return; }
  if (e.code === 'KeyE' && gameState === STATE.PLAYING) {
    // 1) 优先看是否站在出口
    const exit = lm.exitAt(camera.position);
    if (exit) { goThroughExit(exit); return; }
    // 2) 看脚下是否有可拾取物
    const pickup = lm.pickupAt(camera.position);
    if (pickup) {
      pickup.taken = true;
      inventory.add(pickup.id);
      if (pickup.mesh) pickup.mesh.visible = false;
      ui.interact.textContent = `已拾取：${pickup.name}`;
      return;
    }
  }
  if (e.code === 'KeyF' && gameState === STATE.PLAYING) {
    // F 键交互：门 / 开关等（就地交互，不依赖出口）
    const it = lm.interactAt(camera.position);
    if (it) {
      const res = typeof it.interact === 'function' ? it.interact() : null;
      if (res && res.kind === 'toggle') {
        it.done = !!res.done;
      }
      // 门（toggleDoor）由场景自己推进动画，这里不用额外处理。
    }
  }
});
document.addEventListener('keyup', (e) => { keys[e.code] = false; });

function resize() {
  R.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

// 初始加载场景
loadScene(INITIAL_SCENE, true);
ui.startHint.textContent = 'WASD 移动 · 按住 Shift 蹲下 · 鼠标观察 · E 拾取 · F 推门';

// 调试取景：?eye=x,y,z,yaw[,pitch]（度）直接摆放相机，方便截图/查空间。仅调试用。
{
  const eye = new URLSearchParams(location.search).get('eye');
  if (eye) {
    const v = eye.split(',').map(Number);
    if (v.length >= 4 && v.every((n) => !Number.isNaN(n))) {
      camera.position.set(v[0], v[1], v[2]);
      yaw = THREE.MathUtils.degToRad(v[3]);
      pitch = v.length >= 5 ? THREE.MathUtils.degToRad(v[4]) : 0;
      camera.rotation.set(pitch, yaw, 0);
      camera.rotation.order = 'YXZ';
    }
  }
}

let last = performance.now();
function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  noiseCooldown = Math.max(0, noiseCooldown - dt);

  if (!started) {
    R.render();
    return;
  }

  if (gameState === STATE.PLAYING) {
    const eyeGoal = crouched ? CROUCH_EYE : STAND_EYE;
    camera.position.y += (eyeGoal - camera.position.y) * Math.min(1, dt * 12);

    // 门扇开关动画每帧推进（只动门，不动玩家）。
    if (lm.current && lm.current.updateDoors) lm.current.updateDoors(dt);

    const speed = (crouched ? CROUCH_SPEED : STAND_SPEED) * dt;
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const move = new THREE.Vector3();
    if (keys['KeyW']) move.add(fwd);
    if (keys['KeyS']) move.sub(fwd);
    if (keys['KeyD']) move.add(right);
    if (keys['KeyA']) move.sub(right);

    moving = move.lengthSq() > 0;
    if (moving) {
      move.normalize().multiplyScalar(speed);
      // 箱庭多房间：先按 bounds 做「合法范围」移动，再对家具/墙做 AABB 推出。
      if (lm.current && lm.current.bounds) {
        moveWithBounds(camera.position, move.x, move.z);
        if (resolveCollisions(camera.position)) triggerNoise();
      } else {
        camera.position.add(move);
        if (resolveCollisions(camera.position)) triggerNoise();
      }
    }
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
    // 第一人称身体：腿部随移动摆动，蹲下整体下沉。
    if (playerBody) updatePlayerBody(playerBody, dt, { moving, crouched });

    if (!moving) suspicion = Math.max(0, suspicion - dt * 8);

    // shot 取景模式：不跑敌人、不判负，画面静止方便截图。
    const result = isShot ? { seen: false, arrived: false } : lm.update(dt, camera.position, camera.position.y);
    if (result.seen) {
      seenTimer += dt;
      const gain = 100 / SEEN_KILL_TIME;
      suspicion = Math.min(100, suspicion + gain * dt);
      suspicionFade = 3;
      if (suspicion >= 100) fail();
    } else {
      seenTimer = 0;
    }

    // 出口 / 拾取 / 交互物 提示
    const nearExit = lm.exitAt(camera.position);
    const blocked = lm.blockedExitAt(camera.position);
    const nearPickup = lm.pickupAt(camera.position);
    const nearInteract = lm.interactAt(camera.position);
    if (nearExit) {
      ui.interact.textContent = `[E] ${nearExit.hint || '离开'}`;
      ui.interact.classList.add('visible');
    } else if (blocked) {
      ui.interact.textContent = `需要：${blocked.missing.join('、')}`;
      ui.interact.classList.add('visible');
    } else if (nearPickup) {
      ui.interact.textContent = `[E] 拾取 ${nearPickup.name}`;
      ui.interact.classList.add('visible');
    } else if (nearInteract) {
      ui.interact.textContent = `[${nearInteract.verb || 'F'}] ${nearInteract.name}`;
      ui.interact.classList.add('visible');
    } else {
      ui.interact.classList.remove('visible');
    }

    ui.lookWarning.classList.toggle('visible', lm.isWatched(camera.position, camera.position.y));
    ui.crouch.classList.toggle('visible', crouched);
    ui.crosshair.classList.toggle('crouch', crouched);

    // 调试水印：URL 带 ?debug=1 时显示坐标/朝向/门状态，便于定位「走不出去」。
    if (DEBUG) {
      const backDoor = (lm.current.doors || []).find((d) => d.id === 'door-classroom-back');
      const ni = nearInteract ? `${nearInteract.name}(${nearInteract.id})` : '无';
      dbgEl.textContent =
        `v=FIX-DOOR1  pos=(${camera.position.x.toFixed(2)}, ${camera.position.z.toFixed(2)})  yaw=${Math.round(yaw * 180 / Math.PI)}  ` +
        `backDoor=${backDoor ? (backDoor.isOpen ? '开' : '关') : '未找到'}  近交互=${ni}`;
      dbgEl.style.display = 'block';
    }


    if (introTimer > 0) {
      introTimer -= dt;
      if (introTimer <= 0) ui.intro.classList.add('hidden');
    }
    if (keys['ShiftLeft'] || keys['ShiftRight']) crouched = true;
    else crouched = false;
    if (moving && crouched) ui.crouch.classList.add('visible');

    if (suspicionFade > 0) suspicionFade -= dt;
    const showSuspicion = suspicion > 0.1 || suspicionFade > 0;
    ui.suspicion.classList.toggle('visible', showSuspicion);
    ui.suspicionFill.style.width = `${suspicion}%`;
    ui.suspicionText.textContent = `${Math.round(suspicion)}%`;
    ui.danger.style.opacity = `${Math.min(0.85, suspicion / 100 * 0.85)}`;
  } else if (gameState === STATE.CAUGHT) {
    const result = lm.update(dt, camera.position, camera.position.y);
    ui.danger.style.opacity = '1';
    if (result.arrived) showCaughtDialog();
    ui.lookWarning.classList.remove('visible');
    ui.crouch.classList.remove('visible');
  }

  R.render();
}
requestAnimationFrame(tick);
