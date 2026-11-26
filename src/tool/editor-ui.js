import * as THREE from 'three';
import { normalizeScene } from '../scene/schema.js';
import { buildScene, buildShell } from '../scene/scene-build.js';
import { getFullSceneData } from '../level.js';
import { OrbitCam, TransformGizmo, SelectionBox } from './editor-core.js';

// ============================================================
// 场景编辑器界面
//
// 加载顺序：
//   1. 默认载入当前项目场景（level.js 的 getFullSceneData）
//   2. 也可以拖入 / 打开任意符合 FORMAT 的 JSON
//   3. 编辑完导出 JSON，或 Ctrl+S 下载
// ============================================================

const canvas = document.getElementById('view');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);

// 工具页不用粉笔后处理：编辑时要看得清结构。
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

const wireMat = new THREE.LineBasicMaterial({ color: 0x8fb59c });
// 拾取代理：不可见、不写深度，只给 raycast 用。
const pickMat = new THREE.MeshBasicMaterial({ visible: false });

// ---------- 编辑器状态 ----------
const state = {
  data: null,
  root: null,
  nodes: new Map(),
  selected: null,
  undo: [],
  redo: [],
  dirty: false,
  grid: null,
  axes: null,
  // 点了 prefab 上方零件之后，这次点击只认这个零件，再点空白才回到整体。
  focusPart: null,
  // 拖动时把 gizmo 锚在鼠标按下的那个点上，而不是物体原点，
  // 否则点一个离原点很远的零件会「跳」一下。
  dragAnchor: null,
};

const orbit = new OrbitCam(camera, canvas);
const gizmo = new TransformGizmo();
gizmo.setMode('move');
const selection = new SelectionBox();
scene.add(gizmo.group);
scene.add(selection.box);

// ------------------------------------------------------------
// 构建：把场景数据变成可编辑的线框树
// ------------------------------------------------------------
function clearBuilt() {
  if (state.root) scene.remove(state.root);
  if (state.shell) scene.remove(state.shell);
  state.root = null;
  state.shell = null;
  state.nodes.clear();
  state.selected = null;
  gizmo.setTarget(null);
  selection.setObject(null);
}

// 把一棵已经建好的实体树换成「线框外壳」，保留层级与 userData。
function toWireframe(obj) {
  const out = new THREE.Group();
  out.position.copy(obj.position);
  out.rotation.copy(obj.rotation);
  out.scale.copy(obj.scale);
  out.name = obj.name;
  out.userData = obj.userData;

  if (obj.isMesh && obj.geometry) {
    // 只画棱线：用 EdgesGeometry 抽硬边，比线框模式干净得多。
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(obj.geometry, 25),
      wireMat,
    );
    out.add(edges);
    // 拾取代理：真正参与 raycast 的不可见实体。
    const ghost = new THREE.Mesh(obj.geometry, pickMat);
    ghost.visible = false;
    out.add(ghost);
    out.userData.__pickMesh = ghost;
    out.userData.__isLeaf = true;
  }
  for (const child of obj.children) {
    out.add(toWireframe(child));
  }
  return out;
}

// 线框树里没法直接 raycast 到 Line，所以每个叶子挂一个不可见实体当拾取代理。
function buildPickLayer(root) {
  const proxies = [];
  root.traverse((o) => {
    if (o.userData && o.userData.__pickMesh) {
      o.userData.__pickMesh.visible = true;
      proxies.push(o.userData.__pickMesh);
    }
  });
  return proxies;
}

function buildWorld(data) {
  clearBuilt();
  state.data = data;
  state.focusPart = null;

  // 房间外壳
  const shellHolder = new THREE.Group();
  scene.add(shellHolder);
  const shell = buildShell(shellHolder, data.room, null);
  const wireShell = toWireframe(shell);
  shellHolder.remove(shell);
  shellHolder.add(wireShell);
  state.shell = shellHolder;

  // 物体
  const built = buildScene(scene, data, null);
  scene.remove(built.root);
  const wire = toWireframe(built.root);
  wire.name = 'editable-root';
  scene.add(wire);
  state.root = wire;

  // id -> 节点，包括 prefab 内部可手调的零件
  const register = (node) => {
    node.traverse((o) => {
      const it = o.userData && o.userData.__item;
      if (it && it.id) state.nodes.set(it.id, o);
    });
  };
  for (const child of wire.children) register(child);
  // 顶层后写一次，保证同名 id 优先指向顶层
  for (const child of wire.children) {
    if (child.userData.__item) state.nodes.set(child.userData.__item.id, child);
  }

  buildPickLayer(wire);
  refreshTree();
  renderProps();
  updateStatus();
}

// ------------------------------------------------------------
// 拾取与选择
// ------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function pickAt(clientX, clientY, objects) {
  const r = canvas.getBoundingClientRect();
  ndc.x = ((clientX - r.left) / r.width) * 2 - 1;
  ndc.y = -((clientY - r.top) / r.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(objects, false);
  return hits.length ? hits[0] : null;
}

function pickGizmo(clientX, clientY) {
  if (!gizmo.group.visible) return null;
  const hit = pickAt(clientX, clientY, gizmo.pickMeshes());
  return hit ? hit.object : null;
}

function rootItemNode(obj) {
  let o = obj;
  while (o && o !== state.root) {
    if (o.parent === state.root && o.userData.__item) return o;
    o = o.parent;
  }
  return null;
}

// 从投影代理往上找回「该被选中的那一层」：
// 先看是不是某个 prefab 的零件（parts 里的条目），否则退回整个顶层物体。
function itemNodeOf(obj) {
  const top = rootItemNode(obj);
  if (!top) return null;
  let o = obj;
  while (o && o !== top) {
    if (o.userData && o.userData.__item && o !== top) return o;
    o = o.parent;
  }
  return top;
}

function selectById(id) {
  const node = state.nodes.get(id) || null;
  state.selected = node;
  gizmo.setTarget(node);
  selection.setObject(node);
  refreshTree();
  renderProps();
  updateStatus();
  if (node) {
    const p = new THREE.Vector3();
    node.getWorldPosition(p);
    orbit.focus(p, Math.max(1.2, boxRadius(node)));
  }
}

function selectNode(node) {
  state.focusPart = null;
  state.selected = node;
  gizmo.setTarget(node);
  selection.setObject(node);
  refreshTree();
  renderProps();
  updateStatus();
}

function boxRadius(node) {
  const b = new THREE.Box3().setFromObject(node);
  if (b.isEmpty()) return 1;
  const s = new THREE.Vector3();
  b.getSize(s);
  return Math.max(s.x, s.y, s.z) / 2;
}

// ------------------------------------------------------------
// 拖动 gizmo
// ------------------------------------------------------------
const drag = {
  active: false,
  axis: null,
  plane: null,
  startPoint: new THREE.Vector3(),
  startPos: new THREE.Vector3(),
  startValue: 0,
  // gizmo 的锚点（按下时指针在 gizmo 平面上的落点），拖动中不跳
  anchor: new THREE.Vector3(),
  haveAnchor: false,
};

const dragPlane = new THREE.Plane();
const tmpV = new THREE.Vector3();

// 选了 prefab 上方的一小段零件时，gizmo 贴在那个零件上；
// 选了整个 prefab 时贴在原点。否则点一根离原点很远的手臂会「跳」。
function gizmoAnchorFor(node) {
  return node;
}

function pointerRay(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  ndc.x = ((clientX - r.left) / r.width) * 2 - 1;
  ndc.y = -((clientY - r.top) / r.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  return raycaster.ray;
}

function beginDrag(hitObj, clientX, clientY) {
  const node = state.selected;
  if (!node) return false;
  drag.active = true;
  drag.startPos.copy(node.position);
  drag.axis = hitObj.userData.axis || null;

  const worldPos = new THREE.Vector3();
  node.getWorldPosition(worldPos);
  if (hitObj.userData.kind === 'plane' || hitObj.userData.kind === 'box') {
    drag.placedPlane = worldPos.clone();
  }

  if (hitObj.userData.kind === 'axis' || hitObj.userData.kind === 'rot') {
    const axisName = hitObj.userData.axis;
    const dir = new THREE.Vector3(
      axisName === 'x' ? 1 : 0,
      axisName === 'y' ? 1 : 0,
      axisName === 'z' ? 1 : 0,
    );
    const isRot = hitObj.userData.kind === 'rot';
    if (isRot) {
      if (axisName === 'x') dir.set(1, 0, 0);
      if (axisName === 'y') dir.set(0, 1, 0);
      if (axisName === 'z') dir.set(0, 0, 1);
    }
    drag.axisDir = dir;
    // 用「过物体、包含该轴、最朝向相机」的平面来解算，避免轴与视线平行时抖动
    const viewDir = new THREE.Vector3();
    camera.getWorldDirection(viewDir);
    let normal = new THREE.Vector3().crossVectors(dir, new THREE.Vector3().crossVectors(dir, viewDir));
    if (normal.lengthSq() < 1e-6) {
      normal = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0));
      if (normal.lengthSq() < 1e-6) normal.set(1, 0, 0);
    }
    normal.normalize();
    dragPlane.setFromNormalAndCoplanarPoint(normal, worldPos);
    drag.kind = isRot ? 'rotate' : 'move';
  } else {
    const n = hitObj.userData.normal;
    const normal = new THREE.Vector3(n === 'x' ? 1 : 0, n === 'y' ? 1 : 0, n === 'z' ? 1 : 0);
    drag.planeAxes = hitObj.userData.axes;
    dragPlane.setFromNormalAndCoplanarPoint(normal, worldPos);
    drag.kind = 'move';
  }

  const ray = pointerRay(clientX, clientY);
  if (!ray.intersectPlane(dragPlane, tmpV)) { drag.active = false; return false; }
  drag.startPoint.copy(tmpV);
  drag.startRot = [node.rotation.x, node.rotation.y, node.rotation.z];
  drag.startValue = node.userData.__item
    ? [...node.userData.__item.pos]
    : [node.position.x, node.position.y, node.position.z];
  return true;
}

function applyDrag(clientX, clientY) {
  if (!drag.active || !state.selected) return;
  const ray = pointerRay(clientX, clientY);
  if (!ray.intersectPlane(dragPlane, tmpV)) return;
  const delta = tmpV.clone().sub(drag.startPoint);
  const node = state.selected;

  // 旋转：把鼠标在这条轴上的位移换算成绕该轴转的角度。
  if (drag.kind === 'rotate') {
    const d = delta.dot(drag.axisDir);
    const ang = d * 6;              // 1m 拖动 ≈ 6 rad，手感够用
    node.rotation.copy(new THREE.Euler(drag.startRot[0], drag.startRot[1], drag.startRot[2]));
    node.rotation[drag.axis] = drag.startRot[['x', 'y', 'z'].indexOf(drag.axis)] + ang;
    if (snapStep() > 0) {
      const s = THREE.MathUtils.degToRad(15);
      node.rotation[drag.axis] = Math.round(node.rotation[drag.axis] / s) * s;
    }
    gizmo.sync(camera);
    selection.setObject(node);
    renderPropsLive();
    markDirty();
    return;
  }

  if (drag.axis) {
    const d = delta.dot(drag.axisDir);
    node.position.copy(drag.startPos);
    node.position.addScaledVector(drag.axisDir, d);
  } else {
    node.position.copy(drag.startPos).add(delta);
  }

  // 吸附
  const snap = snapStep();
  if (snap > 0) {
    node.position.x = Math.round(node.position.x / snap) * snap;
    node.position.y = Math.round(node.position.y / snap) * snap;
    node.position.z = Math.round(node.position.z / snap) * snap;
  }

  gizmo.sync(camera);
  selection.setObject(node);
  renderPropsLive();
  markDirty();
}

// ------------------------------------------------------------
// 历史记录
// ------------------------------------------------------------
function snapshot() {
  return JSON.parse(JSON.stringify(state.data));
}

function pushHistory(before) {
  state.undo.push(before);
  if (state.undo.length > 60) state.undo.shift();
  state.redo.length = 0;
}

function undo() {
  if (!state.undo.length) return;
  const prev = state.undo.pop();
  state.redo.push(snapshot());
  const keepSel = state.selected ? state.selected.userData.__item?.id : null;
  buildWorld(prev);
  if (keepSel && state.nodes.has(keepSel)) selectById(keepSel);
  markDirty();
}

function redo() {
  if (!state.redo.length) return;
  const next = state.redo.pop();
  state.undo.push(snapshot());
  const keepSel = state.selected ? state.selected.userData.__item?.id : null;
  buildWorld(next);
  if (keepSel && state.nodes.has(keepSel)) selectById(keepSel);
  markDirty();
}

// ------------------------------------------------------------
// 数据回写：编辑器里的 Object3D -> 场景 JSON
// ------------------------------------------------------------
function syncDataFromNodes() {
  const data = snapshot();
  const apply = (items) => {
    for (const item of items) {
      const node = state.nodes.get(item.id);
      if (node) {
        item.pos = [
          +node.position.x.toFixed(4),
          +node.position.y.toFixed(4),
          +node.position.z.toFixed(4),
        ];
        item.rot = [
          +THREE.MathUtils.radToDeg(node.rotation.x).toFixed(3),
          +THREE.MathUtils.radToDeg(node.rotation.y).toFixed(3),
          +THREE.MathUtils.radToDeg(node.rotation.z).toFixed(3),
        ];
        item.scale = [
          +node.scale.x.toFixed(4),
          +node.scale.y.toFixed(4),
          +node.scale.z.toFixed(4),
        ];
      }
      if (Array.isArray(item.children)) apply(item.children);
    }
  };
  apply(data.objects || []);
  return data;
}

// ------------------------------------------------------------
// UI：物体列表
// ------------------------------------------------------------
const treeList = document.getElementById('treeList');
const searchBox = document.getElementById('search');

function labelOf(item) {
  if (item.label) return item.label;
  if (item.type === 'prefab') return `${item.prefab}${item.params?.pose ? `(${item.params.pose})` : ''}`;
  if (item.type === 'empty') return '空物体';
  return item.type;
}

// 一个条目下能展开的东西：group/empty 的孩子、prefab 的 parts、
// 以及 prefab 生成出来的原始零件（不可选中时只列出来看看结构）。
function childItemsOf(item) {
  if (!item) return [];
  if (item.type === 'group' || item.type === 'empty') return item.children || [];
  if (item.type === 'prefab' && Array.isArray(item.parts)) return item.parts;
  return [];
}

const expanded = new Set();

function refreshTree(keepScroll = true) {
  const scrollTop = treeList.scrollTop;
  const q = (searchBox.value || '').trim().toLowerCase();
  treeList.innerHTML = '';
  const items = state.data?.objects || [];
  const selItem = state.selected?.userData?.__item || null;

  const rowFor = (item, depth, parentNode) => {
    const li = document.createElement('li');
    li.dataset.id = item.id;
    if (depth > 0) li.classList.add('child');
    else li.classList.add('branch');
    const isSel = selItem && selItem === item;
    if (isSel) li.classList.add(depth > 0 ? 'sel-deep' : 'sel');
    if (item.locked) li.classList.add('locked');

    const kids = childItemsOf(item);
    const caret = document.createElement('span');
    caret.className = 'caret' + (kids.length ? '' : ' leaf');
    caret.textContent = kids.length ? (expanded.has(item.id) ? '▾' : '▸') : '·';
    if (kids.length) {
      caret.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (expanded.has(item.id)) expanded.delete(item.id);
        else expanded.add(item.id);
        refreshTree();
      });
    }

    const name = document.createElement('span');
    name.textContent = item.label || item.id;
    if (item.type === 'empty') name.style.color = '#8fa6b8';
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = item.type === 'prefab' ? item.prefab : item.type;

    li.append(caret, name, t);
    li.addEventListener('click', () => {
      const id = item.id;
      if (state.nodes.has(id)) selectById(id);
      else { state.selected = parentNode; gizmo.setTarget(parentNode); selection.setObject(parentNode); renderProps(); updateStatus(); refreshTree(); }
    });
    treeList.appendChild(li);

    if (kids.length && expanded.has(item.id)) {
      for (const kid of kids) rowFor(kid, depth + 1, state.nodes.get(item.id) || parentNode);
    }
  };

  for (const item of items) {
    if (q && !`${item.id} ${item.type} ${item.label || ''} ${item.prefab || ''}`.toLowerCase().includes(q)) continue;
    rowFor(item, 0, null);
  }

  const total = items.length;
  document.getElementById('statCount').textContent = `共 ${total} 个物体${q ? ` · 已过滤` : ''}`;
  if (keepScroll) treeList.scrollTop = scrollTop;
}

searchBox.addEventListener('input', () => refreshTree());

// ------------------------------------------------------------
// UI：属性面板
// ------------------------------------------------------------
const propBody = document.getElementById('propBody');
const propTarget = document.getElementById('propTarget');

function rowInput(label, value, step, onChange) {
  const row = document.createElement('div');
  row.className = 'row';
  const l = document.createElement('label');
  l.textContent = label;
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.step = String(step);
  inp.value = value;
  inp.addEventListener('input', () => {
    const v = parseFloat(inp.value);
    if (!Number.isFinite(v)) return;
    onChange(v);
  });
  inp.addEventListener('change', () => { commitChange(); });
  row.append(l, inp);
  return row;
}

function vecRow(label, arr, step, onChange) {
  const row = document.createElement('div');
  row.className = 'row';
  const l = document.createElement('label');
  l.textContent = label;
  row.append(l);
  ['x', 'y', 'z'].forEach((axis, i) => {
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.step = String(step);
    inp.value = +Number(arr[i] ?? 0).toFixed(3);
    inp.dataset.axis = axis;
    inp.addEventListener('input', () => {
      const v = parseFloat(inp.value);
      if (!Number.isFinite(v)) return;
      const next = [...arr];
      next[i] = v;
      onChange(next);
    });
    inp.addEventListener('change', () => commitChange());
    row.append(inp);
  });
  return row;
}

let pendingBefore = null;

function beginChange() {
  if (!pendingBefore) pendingBefore = snapshot();
}

function commitChange() {
  if (!pendingBefore) { markDirty(); return; }
  pushHistory(pendingBefore);
  pendingBefore = null;
  markDirty();
}

function selectedItem() {
  return state.selected?.userData?.__item || null;
}

function renderProps() {
  const node = state.selected;
  const item = selectedItem();
  propBody.innerHTML = '';
  if (!node || !item) {
    propTarget.textContent = '未选中';
    propTarget.classList.remove('on');
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = '在视口里点一个物体，或用左侧列表选中';
    propBody.appendChild(p);
    return;
  }
  propTarget.textContent = item.type;
  propTarget.classList.add('on');

  const head = document.createElement('div');
  head.className = 'row';
  const idLabel = document.createElement('label');
  idLabel.textContent = 'id';
  const idInput = document.createElement('input');
  idInput.type = 'text';
  idInput.value = item.id;
  idInput.disabled = true;
  head.append(idLabel, idInput);
  propBody.appendChild(head);

  const title = (t) => {
    const d = document.createElement('div');
    d.className = 'group-title';
    d.textContent = t;
    propBody.appendChild(d);
  };

  // 名字：随时改，列表和导出都跟着变
  title('名字');
  const nameRow = document.createElement('div');
  nameRow.className = 'row';
  const nameL = document.createElement('label');
  nameL.textContent = 'label';
  const nameInp = document.createElement('input');
  nameInp.type = 'text';
  nameInp.value = item.label || '';
  nameInp.placeholder = item.id;
  nameInp.addEventListener('change', () => {
    beginChange();
    item.label = nameInp.value.trim();
    commitChange();
    refreshTree();
  });
  nameRow.append(nameL, nameInp);
  propBody.appendChild(nameRow);

  // 父节点信息：告诉用户这个零件是挂在谁身上的
  if (node.parent && node.parent !== state.root) {
    const parentItem = node.parent.userData?.__item;
    const p = document.createElement('p');
    p.className = 'warn';
    p.style.color = '#7f9587';
    p.textContent = `零件 · 属于 ${parentItem?.label || parentItem?.id || '父节点'}（坐标相对父级）`;
    propBody.appendChild(p);
  }

  title('位置 (m)');
  propBody.appendChild(vecRow('pos', [node.position.x, node.position.y, node.position.z], 0.05, (v) => {
    beginChange();
    node.position.fromArray(v);
    gizmo.sync(camera);
    selection.setObject(node);
    renderPropsLive();
  }));

  title('旋转 (deg)');
  propBody.appendChild(vecRow('rot', [
    THREE.MathUtils.radToDeg(node.rotation.x),
    THREE.MathUtils.radToDeg(node.rotation.y),
    THREE.MathUtils.radToDeg(node.rotation.z),
  ], 5, (v) => {
    beginChange();
    node.rotation.set(
      THREE.MathUtils.degToRad(v[0]),
      THREE.MathUtils.degToRad(v[1]),
      THREE.MathUtils.degToRad(v[2]),
    );
    gizmo.sync(camera);
    selection.setObject(node);
    renderPropsLive();
  }));

  title('缩放');
  propBody.appendChild(vecRow('scale', [node.scale.x, node.scale.y, node.scale.z], 0.05, (v) => {
    beginChange();
    node.scale.fromArray(v);
    gizmo.sync(camera);
    selection.setObject(node);
    renderPropsLive();
  }));

  if (item.type === 'box' || item.type === 'sphere') {
    title(item.type === 'box' ? '尺寸 (m)' : '半径 (m)');
    const size = item.size || [1, 1, 1];
    propBody.appendChild(vecRow('size', size, 0.05, (v) => {
      beginChange();
      item.size = v;
      rebuildNode(item.id);
    }));
  }

  if (item.type === 'tube') {
    title('端点 / 半径');
    propBody.appendChild(vecRow('a', item.a || [0, 0, 0], 0.05, (v) => {
      beginChange(); item.a = v; rebuildNode(item.id);
    }));
    propBody.appendChild(vecRow('b', item.b || [0, 1, 0], 0.05, (v) => {
      beginChange(); item.b = v; rebuildNode(item.id);
    }));
    propBody.appendChild(rowInput('radius', item.radius ?? 0.02, 0.005, (v) => {
      beginChange(); item.radius = v; rebuildNode(item.id);
    }));
  }

  if (item.type === 'prefab') {
    title('参数');
    for (const [k, v] of Object.entries(item.params || {})) {
      const row = document.createElement('div');
      row.className = 'row';
      const l = document.createElement('label');
      l.textContent = k;
      const inp = document.createElement('input');
      inp.type = typeof v === 'number' ? 'number' : 'text';
      if (typeof v === 'number') inp.step = '0.05';
      inp.value = String(v);
      inp.addEventListener('change', () => {
        beginChange();
        item.params[k] = typeof v === 'number' ? parseFloat(inp.value) : inp.value;
        rebuildNode(item.id);
        commitChange();
      });
      row.append(l, inp);
      propBody.appendChild(row);
    }
    // 拆零件的入口：把一个能单独调的零件挂到 prefab 上
    title('零件');
    const kids = childItemsOf(item);
    if (kids.length) {
      for (const kid of kids) {
        const row = document.createElement('div');
        row.className = 'row';
        const btn = document.createElement('button');
        btn.textContent = `选中 ${kid.label || kid.id}`;
        btn.style.cssText = 'flex:1;background:#16201b;color:#cfe0d4;border:1px solid #2f4239;border-radius:3px;padding:3px 8px;cursor:pointer;font:inherit';
        btn.addEventListener('click', () => {
          if (state.nodes.has(kid.id)) selectById(kid.id);
          else if (!expanded.has(item.id)) { expanded.add(item.id); refreshTree(); }
        });
        row.appendChild(btn);
        propBody.appendChild(row);
      }
    }
    const addPart = document.createElement('button');
    addPart.textContent = '+ 给这个物体加一个可调零件';
    addPart.style.cssText = 'width:100%;margin-top:6px;background:#22361f;color:#d9ffab;border:1px solid #4a6b58;border-radius:3px;padding:4px;cursor:pointer;font:inherit';
    addPart.addEventListener('click', () => addPartToSelected());
    propBody.appendChild(addPart);
  }

  title('标记');
  const chk = document.createElement('div');
  chk.className = 'chk-row';
  for (const key of ['collide', 'noise', 'occlude']) {
    const lab = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !!item.flags?.[key];
    box.addEventListener('change', () => {
      beginChange();
      item.flags = item.flags || {};
      item.flags[key] = box.checked;
      commitChange();
    });
    lab.append(box, document.createTextNode(key));
    chk.appendChild(lab);
  }
  const lockLab = document.createElement('label');
  const lockBox = document.createElement('input');
  lockBox.type = 'checkbox';
  lockBox.checked = !!item.locked;
  lockBox.addEventListener('change', () => {
    beginChange();
    item.locked = lockBox.checked;
    commitChange();
    refreshTree();
  });
  lockLab.append(lockBox, document.createTextNode('locked'));
  chk.appendChild(lockLab);
  propBody.appendChild(chk);

  if (item.type === 'box') {
    const warn = document.createElement('p');
    warn.className = 'warn';
    warn.textContent = '提示：碰撞盒由 box 的世界 AABB 推导，改尺寸后运行时自动重算。';
    propBody.appendChild(warn);
  }
}

// 拖动时只刷新数值框，不重建面板（否则输入框会失焦）。
let liveInputs = null;
function renderPropsLive() {
  const node = state.selected;
  if (!node) return;
  const inputs = propBody.querySelectorAll('.row');
  if (!inputs.length) { renderProps(); return; }
  // 位置 / 旋转 / 缩放 三组都在前 9 个数字框里
  const nums = propBody.querySelectorAll('input[type=number]');
  const vals = [
    node.position.x, node.position.y, node.position.z,
    THREE.MathUtils.radToDeg(node.rotation.x),
    THREE.MathUtils.radToDeg(node.rotation.y),
    THREE.MathUtils.radToDeg(node.rotation.z),
    node.scale.x, node.scale.y, node.scale.z,
  ];
  vals.forEach((v, i) => {
    if (nums[i] && document.activeElement !== nums[i]) {
      nums[i].value = +v.toFixed(3);
    }
  });
}

// 重建单个节点（改尺寸 / 改 prefab 参数时用）
function rebuildNode(id) {
  const item = findItem(state.data.objects || [], id);
  if (!item) return;
  const node = state.nodes.get(id);
  if (!node) return;
  const parent = node.parent || state.root;
  const holder = new THREE.Group();
  const built = buildScene(holder, { ...state.data, objects: [item] }, null);
  const fresh = toWireframe(built.root.children[0]);
  fresh.position.copy(node.position);
  fresh.rotation.copy(node.rotation);
  fresh.scale.copy(node.scale);
  parent.remove(node);
  parent.add(fresh);
  state.nodes.set(id, fresh);
  fresh.traverse((o) => {
    const it = o.userData && o.userData.__item;
    if (it && it.id) state.nodes.set(it.id, o);
  });
  buildPickLayer(fresh);
  state.selected = fresh;
  gizmo.setTarget(fresh);
  selection.setObject(fresh);
  renderPropsLive();
  markDirty();
}

function findItem(items, id) {
  for (const it of items) {
    if (it.id === id) return it;
    if (Array.isArray(it.children)) {
      const f = findItem(it.children, id);
      if (f) return f;
    }
    if (Array.isArray(it.parts)) {
      const f = findItem(it.parts, id);
      if (f) return f;
    }
  }
  return null;
}

// ------------------------------------------------------------
// 状态栏
// ------------------------------------------------------------
function markDirty() {
  state.dirty = true;
  updateStatus();
}

function updateStatus() {
  const id = state.selected?.userData?.__item?.id;
  document.getElementById('statSel').textContent = id ? `选中: ${id}` : '未选中';
  const d = document.getElementById('statDirty');
  d.textContent = state.dirty ? '有未导出改动' : '已保存';
  d.className = state.dirty ? 'dirty' : 'saved';
}

// ------------------------------------------------------------
// 键盘与吸附
// ------------------------------------------------------------
let snapOn = true;
function snapStep() { return snapOn ? 0.05 : 0; }

function nudge(axis, amount) {
  const node = state.selected;
  if (!node) return;
  beginChange();
  const item = node.userData.__item;
  if (item?.locked) return;
  node.position[axis] += amount;
  gizmo.sync(camera);
  selection.setObject(node);
  renderPropsLive();
  commitChange();
}

function rotateSelected(axis, deg) {
  const node = state.selected;
  if (!node) return;
  beginChange();
  node.rotation[axis] += THREE.MathUtils.degToRad(deg);
  gizmo.sync(camera);
  selection.setObject(node);
  renderPropsLive();
  commitChange();
}

function scaleSelected(factor) {
  const node = state.selected;
  if (!node) return;
  beginChange();
  node.scale.multiplyScalar(factor);
  gizmo.sync(camera);
  selection.setObject(node);
  renderPropsLive();
  commitChange();
}

document.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT') return;

  const step = e.shiftKey ? 0.5 : 0.05;
  switch (e.code) {
    case 'KeyW': nudge('z', -step); break;
    case 'KeyS': nudge('z', step); break;
    case 'KeyA': nudge('x', -step); break;
    case 'KeyD': nudge('x', step); break;
    case 'KeyQ': nudge('y', -step); break;
    case 'KeyE': nudge('y', step); break;
    case 'KeyR':
      if (e.altKey) rotateSelected('y', e.shiftKey ? -15 : 15);
      else setGizmoMode('rotate');
      break;
    case 'KeyT': scaleSelected(e.shiftKey ? 0.9 : 1.1); break;
    case 'KeyX': if (state.selected) { beginChange(); state.selected.rotation.x = 0; state.selected.rotation.y = 0; state.selected.rotation.z = 0; gizmo.sync(camera); renderPropsLive(); commitChange(); } break;
    case 'KeyF': if (state.selected) { const p = new THREE.Vector3(); state.selected.getWorldPosition(p); orbit.focus(p, boxRadius(state.selected)); } break;
    case 'KeyG': snapOn = !snapOn; flashHint(`吸附 ${snapOn ? '开 0.05m' : '关'}`); break;
    case 'KeyM': setGizmoMode('move'); break;
    case 'KeyB': setGizmoMode('scale'); break;
    case 'KeyN': openAddDialog(); break;
    case 'Delete': case 'Backspace': deleteSelected(); break;
    case 'KeyZ': if (e.ctrlKey || e.metaKey) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); } break;
    case 'KeyY': if (e.ctrlKey || e.metaKey) { e.preventDefault(); redo(); } break;
    case 'KeyO': if (e.ctrlKey || e.metaKey) { e.preventDefault(); openFile(); } break;
    case 'KeyS': if (e.ctrlKey || e.metaKey) { e.preventDefault(); exportJson(); } break;
    case 'Escape': selectNode(null); break;
    default: break;
  }
});

function deleteSelected() {
  const item = selectedItem();
  if (!item) return;
  if (item.locked) { flashHint('已锁定，先解锁'); return; }
  const node = state.selected;
  const before = snapshot();

  // 选中的是零件：只从父级的 parts / children 里摘掉它
  if (node && node.parent && node.parent !== state.root) {
    const parentItem = node.parent.userData?.__item;
    if (parentItem) {
      for (const key of ['parts', 'children']) {
        if (Array.isArray(parentItem[key])) {
          const i = parentItem[key].findIndex(o => o.id === item.id);
          if (i >= 0) { parentItem[key].splice(i, 1); break; }
        }
      }
      pushHistory(before);
      buildWorld(state.data);
      markDirty();
      flashHint('已删除零件（点父物体可看剩下的）');
      return;
    }
  }

  state.data.objects = state.data.objects.filter(o => o.id !== item.id);
  pushHistory(before);
  buildWorld(state.data);
  markDirty();
}

function setGizmoMode(mode) {
  gizmo.setMode(mode);
  gizmo.sync(camera);
  const names = { move: '移动', rotate: '旋转', scale: '缩放' };
  flashHint(`gizmo：${names[mode] || mode}（M / R / B 切换）`);
}

let hintTimer = 0;
const DEFAULT_HINT = '左键选物体 · 拖 gizmo 移动 · M/R/B 切移动/旋转/缩放 · R 环上拖=旋转 · Shift+左键 平移视角 · 滚轮缩放';
function flashHint(text) {
  const el = document.getElementById('hintBar');
  el.textContent = text;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    el.textContent = DEFAULT_HINT;
  }, 1800);
}

// ------------------------------------------------------------
// 指针交互
// ------------------------------------------------------------
let dragging = false;
let moved = false;

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  moved = false;

  // 先测 gizmo
  const g = pickGizmo(e.clientX, e.clientY);
  if (g) {
    if (beginDrag(g, e.clientX, e.clientY)) {
      dragging = true;
      orbit.enabled = false;          // 拖物体期间锁住相机，别把视角一起甩走
      canvas.setPointerCapture(e.pointerId);
      e.stopPropagation();
      e.preventDefault();
      return;
    }
  }

  // 再测场景物体：先按整体包围盒，命中后再细分到 prefab 零件。
  const objs = [];
  state.root?.traverse((o) => {
    if (o.userData && o.userData.__pickMesh) objs.push(o.userData.__pickMesh);
  });
  const hit = pickAt(e.clientX, e.clientY, objs);
  if (hit) {
    const node = itemNodeOf(hit.object);
    if (node) {
      selectNode(node);
      return;
    }
  }
  selectNode(null);
});

canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  moved = true;
  applyDrag(e.clientX, e.clientY);
});

canvas.addEventListener('pointerup', (e) => {
  if (!dragging) return;
  dragging = false;
  orbit.enabled = true;
  try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  if (!moved) return;
  commitChange();
});

canvas.addEventListener('pointercancel', () => {
  if (!dragging) return;
  dragging = false;
  orbit.enabled = true;
});

// ------------------------------------------------------------
// 新增物体
// ------------------------------------------------------------
const addDlg = document.getElementById('addDlg');
const addName = document.getElementById('addName');
const addType = document.getElementById('addType');
const addPrefab = document.getElementById('addPrefab');
const addPrefabRow = document.getElementById('addPrefabRow');
const PREFAB_NAMES = ['desk', 'chair', 'book', 'classmate', 'chalkDoor', 'groundLines'];

addPrefab.innerHTML = '';
for (const name of PREFAB_NAMES) {
  const o = document.createElement('option');
  o.value = name;
  o.textContent = name;
  addPrefab.appendChild(o);
}

function syncAddRows() {
  addPrefabRow.style.display = addType.value === 'prefab' ? '' : 'none';
}
addType.addEventListener('change', syncAddRows);
syncAddRows();

function uniqueId(base) {
  const ids = new Set((state.data?.objects || []).map(o => o.id));
  let n = 1;
  let id = base;
  while (ids.has(id)) { id = `${base}-${n++}`; }
  return id;
}

function openAddDialog() {
  addDlg.classList.remove('hidden');
  addName.value = '';
  addType.value = 'prefab';
  addPrefab.value = 'desk';
  syncAddRows();
  addName.focus();
}

function closeAddDialog() { addDlg.classList.add('hidden'); }

// 新物体放在视角中心：把相机视线与过中心点的水平面求交。
function viewCenterPoint() {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const origin = camera.position.clone();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.9);
  const hit = new THREE.Vector3();
  if (origin.y > 0.9 && dir.y < -1e-4 && rayPlaneHit(origin, dir, plane, hit)) return hit;
  return orbit.target.clone();
}

function rayPlaneHit(origin, dir, plane, out) {
  const denom = plane.normal.dot(dir);
  if (Math.abs(denom) < 1e-6) return false;
  const t = -(plane.normal.dot(origin) + plane.constant) / denom;
  if (t <= 0) return false;
  out.copy(origin).addScaledVector(dir, t);
  return true;
}

function confirmAdd() {
  const type = addType.value;
  const wanted = addName.value.trim();
  const label = wanted || (type === 'prefab' ? addPrefab.value : (type === 'empty' ? '空物体' : type));
  const id = uniqueId(wanted ? slug(wanted) : `${type}-${Date.now().toString(36).slice(-4)}`);

  const where = document.querySelector('input[name=addWhere]:checked')?.value || 'view';
  const pos = where === 'origin' ? [0, 0, 0] : viewCenterPoint().toArray().map(v => +v.toFixed(3));

  const item = {
    id,
    type,
    label,
    pos,
    rot: [0, 0, 0],
    scale: [1, 1, 1],
    flags: {},
  };
  if (type === 'box') item.size = [1, 0.6, 1];
  if (type === 'sphere') item.size = [0.3, 0.3, 0.3];
  if (type === 'tube') { item.a = [0, 0, 0]; item.b = [0, 0.6, 0]; item.radius = 0.03; }
  if (type === 'polyline') { item.segments = []; item.radius = 0.02; }
  if (type === 'group') item.children = [];
  if (type === 'empty') item.children = [];
  if (type === 'prefab') {
    item.prefab = addPrefab.value;
    item.params = {};
    if (addPrefab.value === 'classmate') item.params.pose = 'read';
  }

  const before = snapshot();
  state.data.objects.push(item);
  pushHistory(before);
  expanded.add(id);
  buildWorld(state.data);
  selectById(id);
  markDirty();
  closeAddDialog();
  flashHint(`已新增 ${label}`);
}

function slug(s) {
  return s.replace(/[^\w\u4e00-\u9fa5-]+/g, '-').replace(/^-+|-+$/g, '') || 'obj';
}

document.getElementById('btnAdd').addEventListener('click', openAddDialog);
document.getElementById('addCancel').addEventListener('click', closeAddDialog);
document.getElementById('addConfirm').addEventListener('click', confirmAdd);
addName.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmAdd(); });
addDlg.addEventListener('click', (e) => { if (e.target === addDlg) closeAddDialog(); });

// 给选中物体加一个可手调的零件（默认是根小管子，方便当骨架/连接件）。
function addPartToSelected() {
  const item = selectedItem();
  if (!item) return;
  if (item.type !== 'prefab' && item.type !== 'group' && item.type !== 'empty') {
    flashHint('只有 prefab / group / empty 能挂零件');
    return;
  }
  const part = {
    id: uniqueId(`${item.id}-part`),
    type: 'tube',
    label: '零件',
    pos: [0, 0, 0],
    rot: [0, 0, 0],
    scale: [1, 1, 1],
    a: [0, 0, 0],
    b: [0, 0.4, 0],
    radius: 0.03,
    flags: {},
  };
  const before = snapshot();
  if (item.type === 'prefab') {
    if (!Array.isArray(item.parts)) item.parts = [];
    item.parts.push(part);
  } else {
    if (!Array.isArray(item.children)) item.children = [];
    item.children.push(part);
  }
  pushHistory(before);
  expanded.add(item.id);
  buildWorld(state.data);
  selectById(part.id);
  markDirty();
  flashHint('已加零件，可以直接拖');
}

// ------------------------------------------------------------
// 载入 / 导出
// ------------------------------------------------------------
function exportJson() {
  if (state.selected) {
    state.selected.position.copy(state.selected.position);
  }
  const out = syncDataFromNodes();
  out.name = out.name || 'scene';
  const text = JSON.stringify(out, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(out.name || 'scene').replace(/[^\w\u4e00-\u9fa5-]+/g, '_')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  state.dirty = false;
  updateStatus();
  flashHint('已导出 JSON —— 把它给我，我就能接进代码');
  console.log('[scene-editor] exported', out);
}

function openFile() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.json,application/json';
  inp.addEventListener('change', () => {
    const f = inp.files?.[0];
    if (!f) return;
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const data = normalizeScene(JSON.parse(String(fr.result)));
        state.undo.length = 0;
        state.redo.length = 0;
        buildWorld(data);
        state.dirty = false;
        updateStatus();
        flashHint(`已载入 ${f.name}`);
      } catch (err) {
        flashHint('JSON 解析失败：' + err.message);
      }
    };
    fr.readAsText(f);
  });
  inp.click();
}

document.getElementById('btnOpen').addEventListener('click', openFile);
document.getElementById('btnExport').addEventListener('click', exportJson);

// 拖放载入
const dropZone = document.getElementById('dropZone');
window.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.remove('hidden'); });
window.addEventListener('dragleave', (e) => {
  if (e.clientX === 0 && e.clientY === 0) dropZone.classList.add('hidden');
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.add('hidden');
  const f = e.dataTransfer?.files?.[0];
  if (!f) return;
  const fr = new FileReader();
  fr.onload = () => {
    try {
      const data = normalizeScene(JSON.parse(String(fr.result)));
      state.undo.length = 0;
      state.redo.length = 0;
      buildWorld(data);
      state.dirty = false;
      updateStatus();
      flashHint(`已载入 ${f.name}`);
    } catch (err) {
      flashHint('JSON 解析失败：' + err.message);
    }
  };
  fr.readAsText(f);
});

// ------------------------------------------------------------
// 网格与坐标轴
// ------------------------------------------------------------
function buildHelpers() {
  const grid = new THREE.GridHelper(40, 80, 0x2f4a3c, 0x1c2a24);
  grid.name = 'editor-grid';
  scene.add(grid);
  state.grid = grid;

  const axes = new THREE.AxesHelper(2);
  axes.name = 'editor-axes';
  scene.add(axes);
  state.axes = axes;
}

document.getElementById('chkGrid').addEventListener('change', (e) => {
  if (state.grid) state.grid.visible = e.target.checked;
});
document.getElementById('chkAxes').addEventListener('change', (e) => {
  if (state.axes) state.axes.visible = e.target.checked;
});

// ------------------------------------------------------------
// 渲染循环
// ------------------------------------------------------------
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function tick() {
  requestAnimationFrame(tick);
  gizmo.sync(camera);
  renderer.render(scene, camera);
}

// ------------------------------------------------------------
// 启动：默认载入当前项目场景
// ------------------------------------------------------------
buildHelpers();
try {
  const data = normalizeScene(getFullSceneData());
  buildWorld(data);
  orbit.target.set(0, 1.2, -2);
  orbit.dist = 18;
  orbit.pitch = 0.42;
  orbit.yaw = 0.15;
  orbit.update();
} catch (err) {
  console.error(err);
  document.getElementById('hintBar').textContent = '场景载入失败：' + err.message;
}
tick();

// 调试入口：控制台可直接拿当前数据
window.__editor = { state, buildWorld, syncDataFromNodes, exportJson };
