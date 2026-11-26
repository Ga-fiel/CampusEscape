// 游戏入口：初始化引擎、玩家、NPC，跑主循环。
import * as THREE from 'three';
import { InkRenderer } from './render.js';
import { World } from './physics.js';
import { buildSchool } from './school.js';
import { Player } from './player.js';
import { Npc, ST } from './npc.js';

const canvas = document.getElementById('c');
const R = new InkRenderer(canvas);
R.camera.fov = 74;
R.camera.updateProjectionMatrix();

const world = new World();
const level = buildSchool(R.scene, world);
const player = new Player(R.camera, world, level.playerStart);
player.sitAt(level.seat);           // 开局坐在自己的座位上，面朝黑板
player.yaw = -Math.PI / 2;
const npcs = level.npcs.map((o) => new Npc(R.scene, o));
for (const n of npcs) {
  n.onTalk = (npc) => {
    // 弹不出对话（比如正被另一个老师盘问），就让他先退回去，别卡在 TALK
    if (!startDialogue(npc)) { npc.state = ST.RETURN; npc.talkCd = 3; }
  };
}

// 每个 NPC 头顶一条注意值进度条（屏幕空间投影）
const noticeLayer = document.getElementById('noticeLayer');
const noticeEls = npcs.map(() => {
  const d = document.createElement('div');
  d.className = 'nbar';
  d.innerHTML = '<i></i>';
  noticeLayer.appendChild(d);
  return d;
});

// ---------------- 输入 ----------------
const input = {
  forward: false, back: false, left: false, right: false,
  run: false, crouch: false, jump: false,
  mouseDX: 0, mouseDY: 0,
  pressedE: false,
};

const KEYS = {
  KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right',
  ShiftLeft: 'run', ShiftRight: 'run', KeyC: 'crouch',
};

window.addEventListener('keydown', (e) => {
  if (state === 'dialogue') {
    if (e.code.startsWith('Digit')) {
      const i = Number(e.code.slice(5)) - 1;
      if (i >= 0 && i < 3) resolveDialogue(i);
      e.preventDefault();
    }
    return;
  }
  if (KEYS[e.code]) { input[KEYS[e.code]] = true; e.preventDefault(); }
  if (e.code === 'Space' && !e.repeat) { input.jump = true; e.preventDefault(); }
  if (e.code === 'KeyE' && !e.repeat) input.pressedE = true;
});
window.addEventListener('keyup', (e) => {
  if (KEYS[e.code]) { input[KEYS[e.code]] = false; e.preventDefault(); }
});

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvas) {
    input.mouseDX += e.movementX;
    input.mouseDY += e.movementY;
  }
});

// ---------------- 状态 ----------------
const BUILD = 'B3-patrol-talk';
document.getElementById('ver').textContent = BUILD;

let started = false;
let state = 'menu';          // menu | play | dialogue | caught | won
let caughtT = 0;
let flashT = 0;
let gateOpen = false;
let wireOpen = false;
let savePoint = -1;
let msgT = 0;
let bellT = 300;        // 5 分钟后上课铃：强制的全校搜捕
let bellRung = false;

// 可疑度：事件驱动，不自然衰减。满了 → 全校搜捕
let heat = 0;
let raid = false;
let raidT = 0;
let dialogue = null;
let dialogueT = 0;

const el = {
  start: document.getElementById('start'),
  tip: document.getElementById('tip'),
  msg: document.getElementById('msg'),
  alertFill: document.getElementById('alertFill'),
  alertNum: document.getElementById('alertNum'),
  itemList: document.getElementById('itemList'),
  bell: document.getElementById('bell'),
  dialogue: document.getElementById('dialogue'),
  dlgWho: document.getElementById('dlgWho'),
  dlgSay: document.getElementById('dlgSay'),
  dlgOpts: document.getElementById('dlgOpts'),
};

function showMsg(text, sub = '', dur = 1.6) {
  el.msg.innerHTML = text + (sub ? `<div class="sub">${sub}</div>` : '');
  el.msg.classList.add('on');
  msgT = dur;
}

// ---------------- 盘问对话 ----------------
// 每个 NPC 的三句台词：第一次 / 第二次 / 第三次
const DLG_LINES = {
  '讲课老师': [
    '你们下面在干什么，我在讲台上看得一清二楚。',
    '又是你。坐下，别逼我点名。',
    '第三次了。放学来办公室一趟。',
  ],
  '教导主任': [
    '站住。哪个班的？这个点不上课，干什么去？',
    '又是你吧？刚才我就问过你。班主任是谁？',
    '第三次了。你跟我去教导处一趟。',
  ],
  '体育老师': [
    '喂！哪个班的？这个点不在教室，往操场跑什么？',
    '又是你。操场不是给你逃课用的。',
    '第三次了，跟我去教导处。',
  ],
  '门卫': [
    '同学，请假条呢？',
    '又见面了。请假条拿出来我看看。',
    '第三次了，我记下你班级了。',
  ],
};

// 三轮对话的选项：一次比一次难糊弄
const DLG_OPTS = [
  [
    { text: '老师让我去办公室问问题', need: '数学试卷', chance: 1.0, hint: '需要：数学试卷' },
    { text: '我去趟厕所，马上回来', chance: 0.55, hint: '看运气' },
    { text: '……（沉默）', chance: 0, hint: '直接涨可疑度' },
  ],
  [
    { text: '老师让我去办公室问问题', need: '数学试卷', chance: 0.40, hint: '他记得你问过' },
    { text: '我肚子疼，去医务室', chance: 0.30, hint: '看运气' },
    { text: '……（沉默）', chance: 0, hint: '直接涨可疑度' },
  ],
  [
    { text: '……（跟着走）', chance: 0, hint: '认栽' },
    { text: '老师我真有事，通融一下', chance: 0.15, hint: '最后挣扎' },
  ],
];

function startDialogue(npc) {
  if (state !== 'play' || dialogue) return false;
  state = 'dialogue';
  dialogueT = 0;
  const idx = Math.min(npc.talkCount, 2);
  const opts = DLG_OPTS[idx];
  dialogue = { npc, opts };
  player.body.vel.set(0, 0, 0);
  document.exitPointerLock();

  el.dlgWho.textContent = npc.name;
  el.dlgSay.textContent = (DLG_LINES[npc.name] || DLG_LINES['教导主任'])[idx];
  el.dlgOpts.innerHTML = '';
  opts.forEach((o, i) => {
    const can = o.need ? player.inventory.has(o.need) : true;
    const b = document.createElement('button');
    b.disabled = !can;
    b.innerHTML = `<b>${i + 1}</b>${o.text}` + (o.hint ? `<i>${o.hint}</i>` : '');
    b.addEventListener('click', () => resolveDialogue(i));
    el.dlgOpts.appendChild(b);
  });
  el.dialogue.classList.add('on');
  return true;
}

function resolveDialogue(i) {
  const d = dialogue;
  if (!d) return;
  const o = d.opts[i];
  if (!o) return;
  const pass = Math.random() < o.chance;

  d.npc.endTalk(pass, player);
  dialogue = null;
  el.dialogue.classList.remove('on');
  state = 'play';
  setTimeout(() => { if (state === 'play') canvas.requestPointerLock(); }, 60);

  if (pass) {
    heat = Math.max(0, heat - 8);
    showMsg('“去吧，问完赶紧回。”', `第 ${d.npc.talkCount} 次糊弄过去 · 可疑度 -8%`, 1.7);
  } else {
    heat = Math.min(100, heat + 25);
    showMsg('“哪个班的？站住！”', '可疑度 +25%', 1.7);
    if (heat >= 100) startRaid();
  }
}

// ---------------- 全校搜捕 ----------------
function startRaid() {
  if (raid) return;
  raid = true;
  raidT = 8;
  heat = 100;
  for (const n of npcs) {
    n.silent = true;
    n.notice = 100;
    n.talkCd = 0;
    if (n.state !== ST.TALK) n.state = ST.CHASE;
  }
}

function endRaid() {
  raid = false;
  heat = 0;
  for (const n of npcs) {
    n.silent = false;
    n.state = ST.RETURN;
    n.notice = 0;
    n.talkCd = 6;
  }
}

// ---------------- 开发测试模式 ----------------
const qs = new URLSearchParams(location.search);
if (qs.has('test')) {
  el.start.classList.add('hide');
  started = true;
  state = 'play';
  document.getElementById('ver').textContent = BUILD + ' · TEST MODE';
  if (qs.has('nohatch')) R.post.uniforms.uHatch.value = 0;
  if (qs.has('debugshade')) R.post.uniforms.uDebug.value = 1;
  if (qs.has('x') && qs.has('z')) {
    const px = Number(qs.get('x'));
    const pz = Number(qs.get('z'));
    const yaw = Number(qs.get('yaw'));
    if (Number.isFinite(px) && Number.isFinite(pz)) {
      player.teleport(new THREE.Vector3(px, 0.05, pz), Number.isFinite(yaw) ? yaw : 0);
    }
  }
  const give = qs.get('item');
  if (give) player.inventory.add(give);
  const al = Number(qs.get('alert'));
  if (Number.isFinite(al)) {
    heat = Math.max(0, Math.min(100, al));
    if (heat >= 100) startRaid();
  }
  const tk = Number(qs.get('talks'));
  if (Number.isFinite(tk)) for (const n of npcs) n.talkCount = Math.max(0, Math.min(2, tk));
  if (qs.has('talk')) setTimeout(() => startDialogue(npcs[0]), 60);
  const nt = Number(qs.get('notice'));
  if (Number.isFinite(nt)) for (const n of npcs) n.notice = nt;
  // 调试：强制脚步声半径（看听觉回头用）
  if (qs.has('loud')) Object.defineProperty(player, 'noiseRadius', { get: () => 11 });
  if (qs.has('die')) setTimeout(() => caught('测试：被堵在了走廊'), 300);
}

// ---------------- 开始 ----------------
el.start.addEventListener('click', () => {
  el.start.classList.add('hide');
  started = true;
  state = 'play';
  canvas.requestPointerLock();
});

canvas.addEventListener('mousedown', () => {
  if (state === 'play' && document.pointerLockElement !== canvas) canvas.requestPointerLock();
});

// ---------------- 交互 ----------------
// 蹲下时附近有课桌 = 藏好，讲台上的老师看不见
function nearDesk(pos) {
  for (const d of level.desks) {
    if (Math.abs(pos.x - d.x) < 0.65 && Math.abs(pos.z - d.z) < 0.65) return true;
  }
  return false;
}

function nearestInteract() {
  let best = null;
  let bestD = 2.6;

  for (const p of level.pickups) {
    if (p.taken) continue;
    const d = Math.hypot(p.pos.x - player.body.pos.x, p.pos.z - player.body.pos.z);
    if (d < bestD) { bestD = d; best = { kind: 'item', obj: p, d }; }
  }

  if (!gateOpen) {
    const d = Math.hypot(0 - player.body.pos.x, 30 - player.body.pos.z);
    if (d < 3.2 && (!best || d < bestD)) { bestD = d; best = { kind: 'gate', d }; }
  }

  for (let i = 0; i < level.saves.length; i++) {
    const s = level.saves[i];
    const d = Math.hypot(s.x - player.body.pos.x, s.z - player.body.pos.z);
    if (d < 2.0 && Math.abs(s.y - player.body.pos.y) < 1.6 && (!best || d < bestD)) {
      bestD = d; best = { kind: 'save', idx: i, d };
    }
  }

  for (const s of level.stairs) {
    const d = Math.hypot(s.x - player.body.pos.x, s.z - player.body.pos.z);
    if (d < 2.4 && Math.abs(s.y - player.body.pos.y) < 1.6 && (!best || d < bestD)) {
      bestD = d; best = { kind: 'stairs', spot: s, d };
    }
  }

  if (!player.sitting) {
    const d = Math.hypot(level.seat.x - player.body.pos.x, level.seat.z - player.body.pos.z);
    if (d < 1.8 && (!best || d < bestD)) { bestD = d; best = { kind: 'seat', d }; }
  }
  return best;
}

function doInteract(it) {
  if (!it) return;
  if (it.kind === 'item') {
    it.obj.taken = true;
    it.obj.mesh.visible = false;
    player.inventory.add(it.obj.name);
    showMsg(`拿到了【${it.obj.name}】`, '也许用得上', 1.2);
  } else if (it.kind === 'gate') {
    if (player.inventory.has('请假条')) {
      gateOpen = true;
      world.removeBox(level.gate.collider);
      level.gate.mesh.visible = false;
      showMsg('校门开了', '大摇大摆地走出去', 1.4);
    } else {
      showMsg('校门锁着', '门卫看了你一眼：请假条呢？', 1.4);
    }
  } else if (it.kind === 'save') {
    savePoint = it.idx;
    showMsg('已存档', '死亡后可以回到这里', 1.5);
  } else if (it.kind === 'stairs') {
    const s = it.spot;
    const nf = input.run ? s.floor - 1 : s.floor + 1;
    if (nf >= 0 && nf < level.stairs.length) {
      const t = level.stairs[nf];
      player.teleport(new THREE.Vector3(t.x, t.y + 0.05, t.z), player.yaw);
      showMsg(`到 ${nf + 1} 楼了`, '', 1.1);
    }
  } else if (it.kind === 'seat') {
    player.sitAt(level.seat);
  }
}

// ---------------- 被抓 = Game Over ----------------
function caught(reason) {
  if (state === 'gameover') return;
  state = 'gameover';
  flashT = 0.5;
  player.hitFlash = 1;
  document.getElementById('goReason').textContent = reason || '被老师抓住了';
  document.getElementById('goSave').style.display = savePoint >= 0 ? 'inline-block' : 'none';
  document.getElementById('gameover').classList.add('on');
  document.exitPointerLock();
}

function respawnAtSave() {
  if (savePoint < 0) return;
  player.teleport(level.saves[savePoint], 0);
  heat = 0;
  raid = false;
  bellRung = false;
  bellT = 300;
  for (const n of npcs) { n.talkCount = 0; n.talkCd = 0; n.state = 0; n.exposure = 0; }
  document.getElementById('gameover').classList.remove('on');
  state = 'play';
  canvas.requestPointerLock();
}

document.getElementById('goBtn').addEventListener('click', () => location.reload());
document.getElementById('goSave').addEventListener('click', respawnAtSave);

// ---------------- 主循环 ----------------
let last = performance.now();

const _pv = new THREE.Vector3();
function updateNoticeBars() {
  for (let i = 0; i < npcs.length; i++) {
    const n = npcs[i];
    const dom = noticeEls[i];
    const v = n.boardMode ? n.exposure * 100 : n.notice;
    if (v < 1 || state === 'won') { dom.style.display = 'none'; continue; }
    _pv.set(n.pos.x, n.pos.y + 2.15, n.pos.z).project(R.camera);
    if (_pv.z > 1 || Math.abs(_pv.x) > 1 || Math.abs(_pv.y) > 1) { dom.style.display = 'none'; continue; }
    dom.style.display = 'block';
    dom.style.left = ((_pv.x * 0.5 + 0.5) * window.innerWidth) + 'px';
    dom.style.top = ((-_pv.y * 0.5 + 0.5) * window.innerHeight) + 'px';
    dom.firstChild.style.width = Math.min(100, v).toFixed(0) + '%';
  }
}

function tick() {
  requestAnimationFrame(tick);
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = now / 1000;

  if (state === 'play') {
    player.update(dt, input);
    // 教室矩形内算安全区：走廊的老师不会进来找你
    player.inClassroom = player.body.pos.z < -8.3 && player.body.pos.x < 2 && player.body.pos.x > -14;
    player.hasCover = player.inClassroom && nearDesk(player.body.pos);
    // 自己座位 1 米内 = 假装捡笔的安全区
    player.nearSeat = player.inClassroom &&
      Math.hypot(player.body.pos.x - level.seat.x, player.body.pos.z - level.seat.z) < 1.0;

    const hasLeave = player.inventory.has('请假条');
    const heatScale = 1 + heat / 80;   // 可疑度越高，老师们的注意值涨得越快
    for (const n of npcs) {
      if (n.name === '门卫') n.ignore = hasLeave;
      n.heatScale = heatScale;
      n.update(dt, world, player);
      // 讲台老师看到你超过 0.7 秒：不盘问，直接罚你回座位
      if (n.boardMode && n.sees && n.talkCd <= 0) {
        n.talkCd = 8;
        n.exposure = 0;
        heat = Math.min(100, heat + 30);
        player.sitAt(level.seat);
        showMsg('“你们下面在干什么，我在讲台上看得一清二楚。”', '可疑度 +30% · 灰溜溜回座位', 2.2);
        if (heat >= 100) startRaid();
      }
    }

    // 交互
    if (player.sitting) {
      el.tip.innerHTML = '按 <b>E</b> 或方向键站起来';
      el.tip.classList.add('on');
      if (input.pressedE) player.standUp();
    } else {
      const it = nearestInteract();
      if (it) {
        if (it.kind === 'item') {
          el.tip.innerHTML = `按 <b>E</b> 拿起【${it.obj.name}】`;
          el.tip.classList.add('on');
        } else if (it.kind === 'gate') {
          el.tip.innerHTML = hasLeave ? '按 <b>E</b> 打开校门' : '校门锁着 · 需要<b>请假条</b>';
          el.tip.classList.add('on');
        } else if (it.kind === 'save') {
          el.tip.innerHTML = savePoint === it.idx
            ? '已存档 · 按 <b>E</b> 再存一次'
            : '按 <b>E</b> 存档（厕所）';
          el.tip.classList.add('on');
        } else if (it.kind === 'stairs') {
          el.tip.innerHTML = '按 <b>E</b> 上楼 · <b>Shift</b>+<b>E</b> 下楼';
          el.tip.classList.add('on');
        } else if (it.kind === 'seat') {
          el.tip.innerHTML = '按 <b>E</b> 坐下';
          el.tip.classList.add('on');
        }
        if (input.pressedE) doInteract(it);
      } else {
        el.tip.classList.remove('on');
      }
    }

    // 上课铃：5 分钟后强制进入全校搜捕
    if (!bellRung) {
      bellT -= dt;
      if (bellT <= 0) {
        bellRung = true;
        heat = 100;
        startRaid();
        showMsg('班主任来查人了', '发现你不在教室 · 全校开始找你', 2.2);
      }
    }

    // 搜捕：碰到就是被抓，不再盘问
    if (raid) {
      for (const n of npcs) {
        if (n.distTo(player.body.pos) < 1.25) {
          endRaid();
          caught('被按住了 · 全校搜捕');
          break;
        }
      }
    }

    // 搜捕倒计时
    if (raid) {
      raidT -= dt;
      el.msg.innerHTML = `全校搜捕<div class="sub">${Math.max(0, raidT).toFixed(1)} 秒</div>`;
      el.msg.classList.add('on');
      msgT = 0;
      if (raidT <= 0) {
        endRaid();
        caught('全校搜捕 · 被堵在了校门口');
      }
    }

    // 胜利
    if (player.body.pos.z > 28) {
      state = 'won';
      flashT = 0.6;
      showMsg('你出来了', '逃学成功 · 刷新页面重来', 99);
    }
  } else if (state === 'dialogue') {
    // 盘问期间完全暂停：NPC 不动、冷却不计时
    dialogueT += dt;
    if (dialogueT > 20) { dialogueT = 0; resolveDialogue(0); }
  }

  if (flashT > 0) flashT = Math.max(0, flashT - dt);
  if (msgT > 0) { msgT -= dt; if (msgT <= 0) el.msg.classList.remove('on'); }

  // HUD
  el.alertFill.style.width = heat.toFixed(1) + '%';
  el.alertNum.textContent = Math.round(heat) + '%';

  const bt = Math.max(0, bellT);
  const bm = Math.floor(bt / 60), bs = Math.floor(bt % 60);
  el.bell.textContent = `班主任巡查 ${bm}:${String(bs).padStart(2, '0')}`;
  el.bell.classList.toggle('hot', bellT < 60);
  const inv = [...player.inventory];
  el.itemList.innerHTML = inv.length
    ? inv.map((n) => `<span class="it">${n}</span>`).join('')
    : '—';

  updateNoticeBars();

  // 可疑度呼吸灯：搜捕时急促，平时随数值缓呼吸
  const af = heat / 100;
  const pulse = 0.5 + 0.5 * Math.sin(t * (raid ? 9 : 3 + af * 3));
  const alertFx = af * (raid ? 0.72 + 0.28 * pulse : 0.38 + 0.35 * pulse);

  R.render(t, {
    hurt: Math.min(1, player.hitFlash * 0.9 + alertFx),
    flash: flashT > 0 ? 0.55 : 0,
    lowHp: 0,
  });

  input.mouseDX = 0;
  input.mouseDY = 0;
  input.pressedE = false;
}

requestAnimationFrame(tick);
