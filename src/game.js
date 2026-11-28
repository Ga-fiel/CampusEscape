// 游戏入口：初始化引擎、玩家、NPC，跑主循环。
import * as THREE from '../vendor/three/three.module.js';
import { InkRenderer } from './render.js';
import { World } from './physics.js';
import { buildSchool } from './school.js';
import { buildCampus } from './campus.js';
import { Player } from './player.js';
import { Npc, ST } from './npc.js';

export function createGame({ document, window, location, performance, requestAnimationFrame, setTimeout, setInterval, renderer } = {}) {
const canvas = document.getElementById('c');
const R = renderer || new InkRenderer(canvas);
R.camera.fov = 74;
R.camera.updateProjectionMatrix();

const world = new World();
const level = buildSchool(R.scene, world);
const campus = buildCampus(R.scene, world);
// 校园里的拾取物（钳子、辣条）并进 level.pickups，交互循环只认这一份
level.pickups.push(...campus.pickups);
// 大门改用校园那两扇红铁门
level.gate = campus.gateL;
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
  eHeld: false,        // E 键是否正按着（翻找要按住 2 秒）
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
  if (e.code === 'KeyE' && !e.repeat) { input.pressedE = true; input.eHeld = true; }
});
window.addEventListener('keyup', (e) => {
  if (KEYS[e.code]) { input[KEYS[e.code]] = false; e.preventDefault(); }
  if (e.code === 'KeyE') input.eHeld = false;
});

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvas) {
    input.mouseDX += e.movementX;
    input.mouseDY += e.movementY;
  }
});

// ---------------- 状态 ----------------
const BUILD = 'B21-campus-v18';
document.getElementById('ver').textContent = BUILD;

let started = false;
let state = 'menu';          // menu | play | dialogue | caught | won
let caughtT = 0;
let flashT = 0;
let gateOpen = false;
let wireOpen = false;
let officeDoorOpen = false;   // 办公室那扇门是开着还是关着
let searchCount = 0;          // 器材室里翻完了几处（用来给玩家一点反馈）
let searchT = 0;              // 当前这处翻找了多久（秒），松手/走开就归零
let searchTarget = null;      // 正在翻的是哪个容器
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
// 出校判定必须"先在校内、再出去"，否则调试传送 / 出生点落在墙外会一开局就通关
let hasBeenInside = false;

// ---------------- 后山跑酷（v0.18）----------------
// 出口方案 B：只有从西墙那段矮墙翻出去才进跑酷；大门 / 狗洞保持原来的"逃学成功"。
// 进了跑酷之后，唯一通关方式是沿路线跑到小吃街北口；掉到山脚地面要扣剩余时间
// （名义上是班主任在下面巡查，喊一嗓子你就得重新爬）。
const PK_TIME = 90;      // 初始剩余时间（秒）
const PK_FALL = 6;       // 掉下去一次扣几秒
const pk = {
  active: false,
  time: 0,               // 剩余时间
  cp: 0,                 // 当前检查点下标（campus.parkour.checkpoints）
  falls: 0,
  cd: 0,                 // 掉落后短暂免疫，免得刚传送回去又被判一次
  prevY: 0,              // 上一帧的脚底高度，用来算落地速度（判摔）
};

// 楼层隔离（方案 A：逻辑冻结 + 假加载）。渲染照旧全量，只冻结别的楼层的逻辑。
const FLOOR_NAMES = ['一 楼', '二 楼', '三 楼'];
let curFloor = -1;      // 玩家当前所在楼层，-1 = 还没算
let trans = null;       // 正在进行的切层假加载 { t, dur, pos, floor, yaw, done }
let noFade = false;     // 调试：?nofade=1 跳过黑场（headless 截图用，rAF 帧数不够走不完淡出）

const el = {
  start: document.getElementById('start'),
  tip: document.getElementById('tip'),
  msg: document.getElementById('msg'),
  alertFill: document.getElementById('alertFill'),
  alertNum: document.getElementById('alertNum'),
  alertWrap: document.getElementById('alertWrap'),
  itemList: document.getElementById('itemList'),
  bell: document.getElementById('bell'),
  dialogue: document.getElementById('dialogue'),
  dlgWho: document.getElementById('dlgWho'),
  dlgSay: document.getElementById('dlgSay'),
  dlgOpts: document.getElementById('dlgOpts'),
  floorTag: document.getElementById('floorTag'),
  fade: document.getElementById('fade'),
  search: document.getElementById('search'),
  searchLab: document.getElementById('searchLab'),
  searchFill: document.getElementById('searchFill'),
  parkour: document.getElementById('parkour'),
  pkTime: document.getElementById('pkTime'),
  pkFill: document.getElementById('pkFill'),
  pkCp: document.getElementById('pkCp'),
};

function showMsg(text, sub = '', dur = 1.6) {
  el.msg.innerHTML = text + (sub ? `<div class="sub">${sub}</div>` : '');
  el.msg.classList.add('on');
  msgT = dur;
}

// ---------------- 楼层（箱庭隔离） ----------------
// 只认"脚下这一层"：y 落在哪一层的层高区间，就算在哪层。
function floorOfY(y) {
  const f = Math.floor((y + 0.9) / level.fh);
  return Math.max(0, Math.min(level.floors - 1, f));
}

// 静默换层：玩家自己走楼梯走上去/走下来时用，不闪黑场，只更新标签 + 清视线
function enterFloor(to) {
  if (to === curFloor) return;
  curFloor = to;
  el.floorTag.textContent = FLOOR_NAMES[to] || `${to + 1} 楼`;
  for (const n of npcs) {
    // 不同层：立刻清掉视线/注意值，免得在别的层被隔空盯着涨
    if (n.floor !== to) { n.sees = false; n.exposure = 0; }
  }
}

// 假加载：0.5 秒黑场，正中间那一刻才真的把人送过去。
// 这是"箱庭重新加载"的观感来源 —— 逻辑上什么都没重建，只是遮了一下。
function startTransition(pos, floor, yaw) {
  if (noFade) {            // 调试开关：跳过黑场，直接换层（截图用）
    player.teleport(pos, yaw);
    enterFloor(floor);
    showMsg(`到 ${floor + 1} 楼了`, '', 1.1);
    return;
  }
  trans = { t: 0, dur: 0.5, pos, floor, yaw, done: false };
}

// ---------------- 后山跑酷 ----------------
// 出口方案 B：只有从西墙那段矮墙翻出去才进跑酷。大门 / 狗洞照旧直接"逃学成功"。
// 进了跑酷之后校内那套（NPC / 可疑度 / 巡查 / 搜捕）全部停摆 —— 人在墙外，没人管得着。
function inRect(x, z, r) {
  return x > r.x1 && x < r.x2 && z > r.z1 && z < r.z2;
}

function pkCpName() {
  const cps = campus.parkour.checkpoints;
  return (cps[pk.cp] && cps[pk.cp].name) || '起点';
}

function startParkour() {
  if (pk.active) return;
  pk.active = true;
  pk.time = PK_TIME;
  pk.cp = 0;
  pk.falls = 0;
  pk.cd = 1.0;              // 刚落地那一下别立刻判摔
  pk.prevY = player.body.pos.y;
  raid = false;
  raidT = 0;
  heat = 0;
  el.parkour.classList.add('on');
  el.alertWrap.style.display = 'none';   // 墙外没有可疑度这回事
  el.floorTag.textContent = '后 山';
  // 校内那套 tip / 翻找进度条在跑酷里没有意义，直接收掉
  el.tip.classList.remove('on');
  el.search.classList.remove('on');
  showMsg('开始跑酷', '沿石柱绕山半圈 · 到小吃街北口才算跑完', 2.4);
}

// 摔回当前检查点
function pkBackToCp() {
  const c = campus.parkour.checkpoints[pk.cp];
  player.teleport(new THREE.Vector3(c.x, c.y, c.z), player.yaw);
  pk.cd = 1.0;
  pk.prevY = c.y;           // 传送会瞬间跳高度，不重置的话下一帧算出巨大的"落地速度"
}

// 跑酷收尾：把墙外专用的 HUD 状态全部还回去。
// 特别注意楼层标签 —— 跑酷时它被写成"后 山"，回来之后如果 curFloor 没变，
// 校内那段 enterFloor() 不会触发，标签就永远停在"后 山"上。所以这里把 curFloor
// 打成 -1，下一帧校内逻辑会重新算一遍并重设标签。
function endParkourUi() {
  pk.active = false;
  el.parkour.classList.remove('on');
  el.alertWrap.style.display = '';
  curFloor = -1;
}

function updateParkour(dt) {
  const P = campus.parkour;
  const bp = player.body.pos;

  // 又翻回墙里了：跑酷作废，交还给校内那套逻辑（不判失败，只是白跑一趟）
  if (bp.x > campus.wall.x1 + 0.4) {
    endParkourUi();
    showMsg('你又翻回学校了', '后山那边的事先放下', 1.6);
    return;
  }

  if (pk.cd > 0) pk.cd -= dt;

  // 时间在跑：掉下去扣的也是这个
  pk.time -= dt;
  if (pk.time <= 0) {
    endParkourUi();
    caught('班主任巡查 · 时间到了，被堵在了后山');
    return;
  }

  // ---- 检查点：只认"下一个"，必须顺着路线一个个过 ----
  // 【为什么不能允许跳着吃】试过"上了半山腰就可以直接吃最后一个检查点"，
  // 结果从台地 1 西北角（在 groundOK 里，落地不罚）往北走几步就进了街，
  // 能跳过西北坡整段 —— 那就不是"绕山半圈"了。老老实实一个一个过。
  const cps = P.checkpoints;
  if (pk.cp < cps.length - 1) {
    const nx = cps[pk.cp + 1];
    if (Math.hypot(bp.x - nx.x, bp.z - nx.z) < 3.5 && Math.abs(bp.y - nx.y) < 2.0) {
      pk.cp++;
      showMsg(`检查点 · ${nx.name}`, '掉下去会回到这里', 1.5);
    }
  }

  // ---- 摔了：扣时间 + 退回检查点 ----
  // 【判据是"落地速度"，不是"站在地面上"】最早写的是"y 低于地面就判摔"，
  // 那样在山脚走两步就被判一次 —— 山脚和台地底下是同一片地面，y 上分不开。
  // 换成落地瞬间的下落速度：落差 h 的落地速度 = sqrt(2*26*h)，
  // 0.8m（柱子之间正常下坡）≈ 6.4、1.6m ≈ 9.1、2.4m（台地一级）≈ 11.2，
  // 阈值取 8.5 —— 走柱子下来不罚，从台地直接掉下来才罚。
  // groundOK 那几块（起点、西北下山段、小吃街）本来就该落地，一律不罚。
  const vy = (pk.prevY - bp.y) / Math.max(dt, 1e-4);
  pk.prevY = bp.y;
  if (pk.cd <= 0 && bp.y < P.groundY + 0.5 && vy > 8.5) {
    let ok = false;
    for (const r of P.groundOK) if (inRect(bp.x, bp.z, r)) { ok = true; break; }
    if (!ok) {
      pk.falls++;
      pk.time -= PK_FALL;
      showMsg('班主任在下面喊了一嗓子', `掉下来了 · 剩余时间 -${PK_FALL} 秒 · 回到${pkCpName()}`, 1.9);
      pkBackToCp();
      return;
    }
  }

  // ---- 终点：小吃街北口 ----
  if (pk.cp >= cps.length - 1
      && Math.hypot(bp.x - P.goal.x, bp.z - P.goal.z) < P.goalR) {
    const used = (PK_TIME - pk.time).toFixed(1);
    endParkourUi();
    state = 'won';
    flashT = 0.6;
    showMsg('跑完了', `逃学成功 · 用时 ${used} 秒 · 摔了 ${pk.falls} 次`, 99);
  }
}

function updateParkourHud() {
  if (!pk.active) return;
  const left = Math.max(0, pk.time);
  const m = Math.floor(left / 60), s = Math.floor(left % 60);
  el.pkTime.textContent = `${m}:${String(s).padStart(2, '0')}`;
  el.pkFill.style.width = Math.max(0, Math.min(100, (left / PK_TIME) * 100)).toFixed(1) + '%';
  el.pkFill.classList.toggle('low', left < 20);
  el.pkCp.textContent = `检查点 ${pkCpName()}`;
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
  if (!o || (o.need && !player.inventory.has(o.need))) return;
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
  // 搜捕倒计时是直接往 el.msg 里写的（msgT 被设成 0 防止被计时器清掉），
  // 结束时必须手动摘掉，否则"全校搜捕 0.0 秒"会一直挂在屏幕上。
  el.msg.classList.remove('on');
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
    const py = Number(qs.get('y'));          // 不传 y 就落在 1F；要上 3F 得显式给 y=8.05
    const yaw = Number(qs.get('yaw'));
    if (Number.isFinite(px) && Number.isFinite(pz)) {
      player.teleport(
        new THREE.Vector3(px, Number.isFinite(py) ? py : 0.05, pz),
        Number.isFinite(yaw) ? yaw : 0
      );
    }
  }
  // 调试：直接指定楼层（不闪黑场）
  const fd = Number(qs.get('floor'));
  if (Number.isFinite(fd)) {
    curFloor = Math.max(0, Math.min(level.floors - 1, fd));
    el.floorTag.textContent = FLOOR_NAMES[curFloor] || `${curFloor + 1} 楼`;
  }
  // 调试：把玩家直接放在墙外验证胜利文案（不加这个参数，站在墙外不会被判通关）
  if (qs.has('win')) hasBeenInside = true;
  if (qs.has('fade')) {   // 调试：把假加载黑场停在半透明，方便截图看
    el.fade.style.opacity = '0.55';
  }
  // 调试：跳过切层黑场（headless 截图时 rAF 帧数不够，走不完 0.5 秒淡入淡出）
  if (qs.has('nofade')) noFade = true;
  // 调试：站定后自动按一次 E（配合 x/z/y 放在楼梯口，验证上下楼流程）
  // autoE=1 上楼，autoE=down 下楼（等价于按住 Shift 再按 E）
  const ae = qs.get('autoE');
  if (ae) {
    setTimeout(() => {
      if (ae === 'down') input.run = true;
      doInteract(nearestInteract());
      input.run = false;
    }, 300);
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
  if (qs.has('talk') && npcs.length) setTimeout(() => startDialogue(npcs[0]), 60);
  const nt = Number(qs.get('notice'));
  if (Number.isFinite(nt)) for (const n of npcs) n.notice = nt;
  // 调试：强制脚步声半径（看听觉回头用）
  if (qs.has('loud')) Object.defineProperty(player, 'noiseRadius', { get: () => 11 });
  if (qs.has('die')) setTimeout(() => caught('测试：被堵在了走廊'), 300);
  // 调试：一直按住 E（配合 x/z 站到容器旁边，就能截到翻找进度条）
  if (qs.has('holdE')) input.eHeld = true;
  // 调试：把每个容器的耗时压到 0.15 秒（headless 截图跑不满 2 秒 rAF，
  // 压短之后才能在 virtual-time-budget 里截到"翻完 + 可疑度上涨"的画面）
  const fs = Number(qs.get('fastsearch'));
  if (Number.isFinite(fs) && fs > 0) {
    for (const s of campus.searchSpots) s.secs = Math.max(0.05, fs);
  }
  // 调试：验证"搜捕文字残留"是否修好。
  // raidEnd=1  → 起搜捕再立刻结束（endRaid 那条路）
  // raidFast=1 → 把倒计时压到 0.2 秒，走"倒计时归零 → caught"那条路
  if (qs.has('raidEnd')) {
    setTimeout(() => startRaid(), 200);
    setTimeout(() => endRaid(), 600);
  }
  if (qs.has('raidFast')) {
    setTimeout(() => { startRaid(); raidT = 0.2; }, 200);
  }
  // 调试：给一个存档点，验证"搜捕倒计时归零 → 被抓 → 回档"之后文字会不会残留。
  // 存档点借教学楼一层大厅那个（level.saves[0]），不依赖玩家先跑去存档。
  if (qs.has('save0')) savePoint = 0;
  // 调试：raidRespawn=1 把整条链一次跑完 —— 起搜捕、倒计时压到 0.2 秒、
  // 被抓，然后自动点"从存档点继续"，最后停在回档后的画面。
  if (qs.has('raidRespawn')) {
    savePoint = 0;
    setTimeout(() => { startRaid(); raidT = 0.2; }, 200);
    setTimeout(() => { if (state === 'gameover') respawnAtSave(); }, 1400);
  }
}

// 调试：自动走正常开局路径（不点开始界面），复现"一出生就通关"
if (qs.has('autostart')) setTimeout(beginPlay, 50);

// 调试：把玩家坐标和状态实时打在左下角（test / 正常模式都能用）
if (qs.has('probe')) {
  setInterval(() => {
    const b = player.body.pos;
    const out = b.x < campus.wall.x1 - 0.6 || b.x > campus.wall.x2 + 0.6
      || b.z < campus.wall.z1 - 0.6 || b.z > campus.wall.z2 + 0.6;
    document.getElementById('ver').textContent =
      `${BUILD} · P ${b.x.toFixed(1)},${b.y.toFixed(2)},${b.z.toFixed(1)} · ${state} · out=${out}`
      + ` · heat=${heat.toFixed(0)} · 翻了${searchCount}`
      + ` · msg=${el.msg.classList.contains('on') ? 'ON' : 'off'}:${el.msg.textContent.slice(0, 12)}`;
  }, 120);
}

// ---------------- 开始 ----------------
function beginPlay() {
  el.start.classList.add('hide');
  started = true;
  // 正常开局：不管地址栏残留了什么调试参数（?x=&z=&y=），一律从教室座位开始，
  // 否则刷新一个旧的调试 URL 会直接落在墙外 —— 那就是"一出生就通关"。
  if (!qs.has('test')) {
    player.teleport(level.seat, -Math.PI / 2);
    player.sitAt(level.seat);
    player.yaw = -Math.PI / 2;
    hasBeenInside = false;
    heat = 0;
    raid = false;
    bellT = 300;
    bellRung = false;
    savePoint = -1;
  }
  state = 'play';
  canvas.requestPointerLock();
}

el.start.addEventListener('click', beginPlay);

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
    // 楼层隔离：上下层的课桌在 xz 上重叠，必须再按高度筛一次
    if (Math.abs(p.pos.y - player.body.pos.y) > 1.8) continue;
    if (d < bestD) { bestD = d; best = { kind: 'item', obj: p, d }; }
  }

  if (!gateOpen && floorOfY(player.body.pos.y) === 0) {
    const d = Math.hypot(campus.gateSpot.x - player.body.pos.x, campus.gateSpot.z - player.body.pos.z);
    if (d < 3.4 && (!best || d < bestD)) { bestD = d; best = { kind: 'gate', d }; }
  }

  // 狗洞：1F 北墙，蹲着钻出去（要钳子先把铁网剪开）
  if (floorOfY(player.body.pos.y) === 0) {
    const d = Math.hypot(campus.holeSpot.x - player.body.pos.x, campus.holeSpot.z - player.body.pos.z);
    if (d < 2.8 && (!best || d < bestD)) { bestD = d; best = { kind: 'hole', d }; }
  }

  // 翻西墙：栏杆没了但砖基 1.6m 高，得先搬把椅子垫脚（椅子在食堂）
  if (floorOfY(player.body.pos.y) === 0) {
    const d = Math.hypot(campus.lowWallSpot.x - player.body.pos.x, campus.lowWallSpot.z - player.body.pos.z);
    if (d < 2.6 && (!best || d < bestD)) { bestD = d; best = { kind: 'climb', d }; }
  }

  // 办公室的门：3F 连廊尽头，按 E 开 / 关
  if (level.officeDoorSpot) {
    const d = Math.hypot(level.officeDoorSpot.x - player.body.pos.x, level.officeDoorSpot.z - player.body.pos.z);
    if (d < 2.4 && Math.abs(level.officeDoorSpot.y - player.body.pos.y) < 1.8 && (!best || d < bestD)) {
      bestD = d; best = { kind: 'officeDoor', d };
    }
  }

  // 器材室里可以翻的地方：钳子随机藏在其中一个，得一个个翻
  if (campus.searchSpots) {
    for (const s of campus.searchSpots) {
      if (s.done) continue;
      const d = Math.hypot(s.x - player.body.pos.x, s.z - player.body.pos.z);
      if (d < 1.9 && Math.abs(s.y - player.body.pos.y) < 1.6 && (!best || d < bestD)) {
        bestD = d; best = { kind: 'search', obj: s, d };
      }
    }
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
    const sameFloor = Math.abs(level.seat.y - player.body.pos.y) < 1.8;
    if (sameFloor && d < 1.8 && (!best || d < bestD)) { bestD = d; best = { kind: 'seat', d }; }
  }
  return best;
}

function doInteract(it) {
  if (!it) return;
  if (it.kind === 'item') {
    it.obj.taken = true;
    // 有的道具是多个零件拼的（比如椅子），要一起藏掉
    if (it.obj.meshes) for (const m of it.obj.meshes) m.visible = false;
    if (it.obj.mesh) it.obj.mesh.visible = false;
    player.inventory.add(it.obj.name);
    showMsg(`拿到了【${it.obj.name}】`, '也许用得上', 1.2);
  } else if (it.kind === 'gate') {
    if (player.inventory.has('请假条')) {
      gateOpen = true;
      for (const g of [campus.gateL, campus.gateR]) {
        if (!g) continue;
        world.removeBox(g.collider);
        g.mesh.visible = false;
      }
      showMsg('校门开了', '大摇大摆地走出去', 1.4);
    } else {
      showMsg('校门锁着', '门卫看了你一眼：请假条呢？', 1.4);
    }
  } else if (it.kind === 'hole') {
    if (player.inventory.has('钳子')) {
      // 剪开铁网 → 拆掉碰撞体，人从狗洞钻到墙外（胜利判定在 tick 里）
      if (campus.holeWire) {
        world.removeBox(campus.holeWire.collider);
        campus.holeWire.mesh.visible = false;
      }
      player.teleport(new THREE.Vector3(campus.holeSpot.x, 0.05, campus.wall.z1 - 1.6), player.yaw);
      showMsg('你从狗洞钻出去了', '铁网被钳子剪开了一个口子', 1.6);
    } else {
      showMsg('狗洞被铁网封着', '需要钳子', 1.4);
    }
  } else if (it.kind === 'climb') {
    // 西墙这段的尖刺（铁栏杆）坏了，只剩 1m 砖基 + 压顶 —— 但墙头还有一米一，够不着，
    // 必须先去食堂后厨搬把椅子垫脚
    if (player.inventory.has('椅子')) {
      player.teleport(campus.lowWallOut.clone(), player.yaw);
      showMsg('踩着椅子翻过去了', '椅腿在墙头上磕了一下', 1.8);
    } else {
      showMsg('这段栏杆锈断了，可墙头还有一米一', '去食堂二楼杂物间搬把椅子来垫脚', 1.8);
    }
  } else if (it.kind === 'officeDoor') {
    // 单扇门：绕合页转 100°，同时切换碰撞体
    const door = level.officeDoor;
    if (door && door.mesh) {
      officeDoorOpen = !officeDoorOpen;
      door.mesh.rotation.y = officeDoorOpen ? -1.75 : 0;
      if (officeDoorOpen) {
        if (door.collider) { world.removeBox(door.collider); door.collider = null; }
      } else {
        // 关门：按门扇自己的位置重新挂一个碰撞体挡住门口
        const m = door.mesh;
        door.collider = world.addBox(
          { x: m.position.x - 0.02, y: m.position.y - 1.12, z: m.position.z - 0.24 },
          { x: m.position.x + 1.2, y: m.position.y + 1.12, z: m.position.z + 0.24 },
          { noShoot: true }
        );
        world.finalize();
      }
      showMsg(officeDoorOpen ? '门开了' : '门关上了', '', 1.0);
    }
  } else if (it.kind === 'save') {
    savePoint = it.idx;
    showMsg('已存档', '死亡后可以回到这里', 1.5);
  } else if (it.kind === 'stairs') {
    const s = it.spot;
    const nf = input.run ? s.downTo : s.upTo;
    if (nf != null && nf >= 0 && nf < level.stairs.length) {
      const t = level.stairs[nf];
      // 走楼梯 = 真的换箱庭：黑场遮住，正中间传送 + 换层
      // 注意：nf 是 level.stairs 数组下标（两部楼梯 × 3 层 = 6 项），
      // 不是楼层号 —— 东侧楼梯 base=3，直接当下标用会弹出"4 楼""5 楼"。
      // 楼层一律取目标点自己的 floor 字段。
      startTransition(new THREE.Vector3(t.x, t.y + 0.05, t.z), t.floor, player.yaw);
    } else {
      showMsg(input.run ? '下面没有了' : '上面是天台，上不去', '', 1.1);
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
  enterFloor(floorOfY(level.saves[savePoint].y));
  heat = 0;
  raid = false;
  raidT = 0;
  bellRung = false;
  bellT = 300;
  for (const n of npcs) { n.talkCount = 0; n.talkCd = 0; n.state = 0; n.exposure = 0; }
  // 回档时把残留的提示文字一并清掉：搜捕倒计时是直接写 el.msg 的，
  // 若没在结束时摘掉，回档后 msgT 已是 0，"全校搜捕 0.0 秒"会永久留在屏幕上。
  msgT = 0;
  el.msg.classList.remove('on');
  el.msg.innerHTML = '';
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
    if (v < 1 || state === 'won' || pk.active || n.floor !== curFloor) { dom.style.display = 'none'; continue; }
    _pv.set(n.pos.x, n.pos.y + 2.15, n.pos.z).project(R.camera);
    if (_pv.z > 1 || Math.abs(_pv.x) > 1 || Math.abs(_pv.y) > 1) { dom.style.display = 'none'; continue; }
    dom.style.display = 'block';
    dom.style.left = ((_pv.x * 0.5 + 0.5) * window.innerWidth) + 'px';
    dom.style.top = ((-_pv.y * 0.5 + 0.5) * window.innerHeight) + 'px';
    dom.firstChild.style.width = Math.min(100, v).toFixed(0) + '%';
  }
}

function step(dt, t) {

  if (state === 'play') {
    player.update(dt, input);

    // ---- 后山跑酷：人在墙外，校内那套（楼层 / 教室 / NPC / 可疑度 / 巡查 / 搜捕）全停 ----
    if (pk.active) {
      updateParkour(dt);
    } else {

      // ---- 楼层隔离：玩家换了层，就切箱庭（逻辑冻结）----
      const pf = floorOfY(player.body.pos.y);
      if (curFloor < 0) {
        curFloor = pf;                                  // 第一次不闪
        el.floorTag.textContent = FLOOR_NAMES[pf] || `${pf + 1} 楼`;
      } else if (pf !== curFloor) enterFloor(pf);

      // 主教室矩形内算安全区：走廊的老师不会进来找你
      const cr = level.classroom;
      const inRoom = player.body.pos.x > cr.x1 && player.body.pos.x < cr.x2
        && player.body.pos.z > cr.z1 && player.body.pos.z < cr.z2
        && player.body.pos.y > cr.floor * 4 - 0.6 && player.body.pos.y < cr.floor * 4 + 2.2;
      player.inClassroom = inRoom;
      player.hasCover = inRoom && nearDesk(player.body.pos);
      // 自己座位 1 米内 = 假装捡笔的安全区
      player.nearSeat = inRoom &&
        Math.hypot(player.body.pos.x - level.seat.x, player.body.pos.z - level.seat.z) < 1.0;

      const hasLeave = player.inventory.has('请假条');
      const heatScale = 1 + heat / 80;   // 可疑度越高，老师们的注意值涨得越快
      for (const n of npcs) {
        // 别的楼层整个冻住：不动、不看、不听、不追，注意值也不涨
        if (n.floor !== curFloor) { n.sees = false; continue; }
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
          } else if (it.kind === 'hole') {
            el.tip.innerHTML = player.inventory.has('钳子')
              ? '按 <b>E</b> 用钳子剪开铁网钻出去'
              : '狗洞被铁网封着 · 需要<b>钳子</b>';
            el.tip.classList.add('on');
          } else if (it.kind === 'climb') {
            el.tip.innerHTML = player.inventory.has('椅子')
              ? '按 <b>E</b> 把椅子靠在墙上翻出去'
              : '这段栏杆锈断了，可墙头还有一米一 · 需要<b>椅子</b>垫脚（食堂二楼杂物间）';
            el.tip.classList.add('on');
          } else if (it.kind === 'search') {
            el.tip.innerHTML = `按住 <b>E</b> 翻一翻${it.obj.label} · <span style="opacity:.6">${it.obj.secs} 秒</span>`;
            el.tip.classList.add('on');
          } else if (it.kind === 'officeDoor') {
            el.tip.innerHTML = officeDoorOpen
              ? '按 <b>E</b> 把门关上'
              : '按 <b>E</b> 推开办公室的门';
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

      // ---- 翻找：按住 E 站定，进度条走满才出结果 ----
      // 走开、松手、或者跑去翻别的地方都会中断，进度直接清零（不惩罚，只是白费时间）。
      {
        const it = player.sitting ? null : nearestInteract();
        const spot = it && it.kind === 'search' && !it.obj.done ? it.obj : null;
        const canSearch = spot && input.eHeld && !player.moving;

        if (!canSearch) {
          // 中断：把进度和当前目标都清掉（换目标时也走这里，避免进度串到别的容器上）
          if (searchT > 0) { searchT = 0; searchTarget = null; }
          if (searchTarget && !canSearch) searchTarget = null;
        } else {
          if (searchTarget !== spot) { searchTarget = spot; searchT = 0; }
          searchT += dt;
          if (searchT >= spot.secs) {
            // 翻完了：扣可疑度、标记已翻、出结果
            spot.done = true;
            searchT = 0;
            searchTarget = null;
            searchCount++;
            heat = Math.min(100, heat + spot.heat);
            if (spot.hasTool) {
              player.inventory.add('钳子');
              showMsg(`在${spot.label}底下摸到一把钳子`, `可疑度 +${spot.heat}% · 铁锈味很重，但还能用`, 2.0);
            } else {
              showMsg(`翻了翻${spot.label}，只有灰`, `可疑度 +${spot.heat}% · 已经翻了 ${searchCount} 处`, 1.4);
            }
            if (heat >= 100) startRaid();
          }
        }

        // 进度条显示
        if (canSearch && searchTarget === spot && searchT > 0) {
          el.search.classList.add('on');
          el.searchLab.textContent = `正在翻${spot.label}`;
          el.searchFill.style.width = Math.min(100, (searchT / spot.secs) * 100).toFixed(0) + '%';
          // 已经在翻了，就别再重复"按住 E 翻一翻"那句（两行字挤在一起很难看）
          el.tip.classList.remove('on');
        } else {
          el.search.classList.remove('on');
          el.searchFill.style.width = '0%';
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
          if (n.floor !== curFloor) continue;
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

      // 出校：翻出围墙（矮墙 / 狗洞）或从大门走出去，四边都算
      const bp = player.body.pos;
      const outside = bp.x < campus.wall.x1 - 0.6 || bp.x > campus.wall.x2 + 0.6
                   || bp.z < campus.wall.z1 - 0.6 || bp.z > campus.wall.z2 + 0.6;
      // 必须真的"从校内走出去"：开局先确认自己在墙内，之后越界才算逃学成功
      if (!outside) hasBeenInside = true;
      if (outside && hasBeenInside) {
        // 出口方案 B：只有从西墙那段矮墙翻出去才进跑酷（后山跑完才算通关）；
        // 大门 / 狗洞 / 其它边照旧直接"逃学成功"，保留原来那条路子。
        const viaLowWall = bp.x < campus.wall.x1 - 0.6
          && bp.z > campus.lowWall.z1 - 3 && bp.z < campus.lowWall.z2 + 3;
        if (viaLowWall && !pk.active) {
          startParkour();
        } else if (!pk.active) {
          state = 'won';
          flashT = 0.6;
          const viaGate = bp.z > campus.wall.z2
            && bp.x > campus.gateGap.x1 - 1.2 && bp.x < campus.gateGap.x2 + 1.2;
          const sub = viaGate ? '逃学成功 · 大摇大摆走出校门'
            : '逃学成功 · 翻墙出去了';
          showMsg('你出来了', sub, 99);
        }
      }
    }   // ← 结束 pk.active 的 else（校内那套逻辑）
  } else if (state === 'dialogue') {
    // 盘问期间完全暂停：NPC 不动、冷却不计时
    dialogueT += dt;
    if (dialogueT > 20) { dialogueT = 0; resolveDialogue(0); }
  }

  if (flashT > 0) flashT = Math.max(0, flashT - dt);
  if (msgT > 0) { msgT -= dt; if (msgT <= 0) el.msg.classList.remove('on'); }

  // 假加载黑场：0.5 秒一个来回，正中间完成传送
  if (trans) {
    trans.t += dt;
    const k = Math.min(1, trans.t / trans.dur);          // 0 → 1
    const a = k < 0.5 ? k * 2 : (1 - k) * 2;             // 0 → 1 → 0
    el.fade.style.opacity = a.toFixed(3);
    if (!trans.done && k >= 0.5) {
      trans.done = true;
      player.teleport(trans.pos, trans.yaw);
      enterFloor(trans.floor);
      showMsg(`到 ${trans.floor + 1} 楼了`, '', 1.1);
    }
    if (k >= 1) { trans = null; el.fade.style.opacity = '0'; }
  }

  // HUD
  if (pk.active) {
    // 跑酷期间可疑度 / 巡查都不适用（人已经在墙外了），只更新跑酷那块
    updateParkourHud();
  } else {
    el.alertFill.style.width = heat.toFixed(1) + '%';
    el.alertNum.textContent = Math.round(heat) + '%';

    const bt = Math.max(0, bellT);
    const bm = Math.floor(bt / 60), bs = Math.floor(bt % 60);
    el.bell.textContent = `班主任巡查 ${bm}:${String(bs).padStart(2, '0')}`;
    el.bell.classList.toggle('hot', bellT < 60);
  }
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

function tick() {
  requestAnimationFrame(tick);
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  step(dt, now / 1000);
}

return {
  start: beginPlay,
  step,
  input,
  choose: resolveDialogue,
  respawn: respawnAtSave,
  getState: () => ({
    state, started, heat, raid, raidT, bellT, bellRung, savePoint,
    gateOpen, wireOpen, officeDoorOpen, searchCount, searchT,
    floor: curFloor, hasBeenInside, parkour: { ...pk },
    player: { position: player.body.pos.toArray(), velocity: player.body.vel.toArray(), yaw: player.yaw,
      pitch: player.pitch, sitting: player.sitting, crouching: player.crouching, inventory: [...player.inventory] },
    npcs: npcs.map(n => ({ name: n.name, position: n.pos.toArray(), floor: n.floor,
      state: n.state, notice: n.notice, exposure: n.exposure, talkCount: n.talkCount })),
    dialogue: dialogue && { name: dialogue.npc.name, options: dialogue.opts.map(o => ({ ...o, enabled: !o.need || player.inventory.has(o.need) })) },
    pickups: level.pickups.map(p => ({ name: p.name, position: p.pos.toArray(), taken: !!p.taken })),
    searchSpots: campus.searchSpots.map(s => ({ label: s.label, position: [s.x, s.y, s.z], done: !!s.done })),
    message: el.msg.textContent,
  }),
  run: () => requestAnimationFrame(tick),
};
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  createGame({ document, window, location, performance, requestAnimationFrame, setTimeout, setInterval }).run();
}
