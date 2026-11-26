import * as THREE from 'three';

// ============================================================
// 编辑器内核 —— 与具体场景无关。
//
// 输入：一份符合 `src/scene/FORMAT` 约定的场景 JSON
// 输出：可拖拽的可视化界面 + 修改后的场景 JSON
//
// 不依赖任何外部控件库：轨道相机、gizmo、拾取全部手写，
// 只用 three 本身，这样进不进构建流程都能跑。
// ============================================================

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ------------------------------------------------------------
// 轨道相机：左键旋转、中键/右键平移、滚轮缩放。
// 编辑器的相机要独立于场景，所以不塞进 ChalkRenderer。
// ------------------------------------------------------------
class OrbitCam {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.target = V(0, 1.2, 0);
    this.dist = 16;
    this.yaw = 0;
    this.pitch = 0.35;
    this.minDist = 1.5;
    this.maxDist = 60;
    this._mode = null;
    this._px = 0;
    this._py = 0;
    // 外部（拖 gizmo 时）可以临时锁掉相机，避免拖物体的同时把视角也甩走。
    this.enabled = true;

    dom.addEventListener('contextmenu', e => e.preventDefault());
    dom.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      if (e.button === 0) this._mode = e.shiftKey ? 'pan' : 'orbit';
      else if (e.button === 1 || e.button === 2) this._mode = 'pan';
      else return;
      this._px = e.clientX;
      this._py = e.clientY;
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this._mode) return;
      if (!this.enabled) { this._mode = null; return; }
      const dx = e.clientX - this._px;
      const dy = e.clientY - this._py;
      this._px = e.clientX;
      this._py = e.clientY;
      if (this._mode === 'orbit') {
        this.yaw -= dx * 0.006;
        this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch + dy * 0.006));
      } else {
        this.pan(dx, dy);
      }
      this.update();
    });
    const stop = (e) => {
      if (!this._mode) return;
      this._mode = null;
      try { dom.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    dom.addEventListener('pointerup', stop);
    dom.addEventListener('pointercancel', stop);
    dom.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      const k = Math.exp(e.deltaY * 0.0012);
      this.dist = Math.max(this.minDist, Math.min(this.maxDist, this.dist * k));
      this.update();
    }, { passive: false });
    this.update();
  }

  pan(dx, dy) {
    const scale = this.dist * 0.0016;
    const right = V(0, 0, 0);
    this.camera.getWorldDirection(right);
    const fwd = right.clone();
    const side = V().crossVectors(V(0, 1, 0), fwd).normalize();
    this.target.addScaledVector(side, dx * scale);
    this.target.addScaledVector(V(0, 1, 0), dy * scale);
  }

  focus(pos, radius = 2) {
    this.target.copy(pos);
    this.dist = Math.max(this.minDist, Math.min(this.maxDist, radius * 5));
    this.update();
  }

  update() {
    const cp = Math.cos(this.pitch);
    const off = V(
      Math.sin(this.yaw) * cp,
      Math.sin(this.pitch),
      Math.cos(this.yaw) * cp,
    ).multiplyScalar(this.dist);
    this.camera.position.copy(this.target).add(off);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }
}

// ------------------------------------------------------------
// 通用 gizmo：移动 / 旋转 / 缩放三种模式共用一套手柄。
//   - move：三根轴 + 三个平面柄
//   - rotate：三个圆环
//   - scale：三根轴 + 中心方块（等比）
// 屏幕空间恒定大小，靠 sync(camera) 每帧校正。
// 注意：所有手柄都是 depthTest:false，所以渲染顺序大致就是拾取优先级。
// ------------------------------------------------------------
class TransformGizmo {
  constructor() {
    this.group = new THREE.Group();
    this.group.visible = false;
    this.mode = 'move';
    this.enabled = false;          // 当前模式对应的手柄才参与拾取
    this.handles = [];
    this.parts = { move: [], rotate: [], scale: [] };

    const axisColor = [0xff6b6b, 0x9fe870, 0x6fa8ff];

    ['x', 'y', 'z'].forEach((axis, i) => {
      const mat = new THREE.MeshBasicMaterial({ color: axisColor[i], depthTest: false });

      // ---- 移动轴 ----
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1, 6), mat);
      bar.userData = { kind: 'axis', axis, gz: 'move' };
      bar.renderOrder = 999;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.16, 6), mat);
      tip.userData = { kind: 'axis', axis, gz: 'move' };
      tip.renderOrder = 999;
      this.group.add(bar, tip);
      this.parts.move.push({ axis, bar, tip });

      // ---- 旋转环 ----
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.62, 0.008, 6, 40),
        new THREE.MeshBasicMaterial({ color: axisColor[i], depthTest: false }),
      );
      ring.userData = { kind: 'rot', axis, gz: 'rotate' };
      ring.renderOrder = 999;
      ring.visible = false;
      this.group.add(ring);
      this.parts.rotate.push({ axis, ring });

      // ---- 缩放轴（细一点，末端方块）----
      const sbar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1, 6), mat);
      sbar.userData = { kind: 'axis', axis, gz: 'scale' };
      sbar.renderOrder = 999;
      sbar.visible = false;
      const stip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.07), mat);
      stip.userData = { kind: 'axis', axis, gz: 'scale' };
      stip.renderOrder = 999;
      stip.visible = false;
      this.group.add(sbar, stip);
      this.parts.scale.push({ axis, sbar, stip });
    });

    // ---- 平面柄（移动模式）----
    this.planes = [];
    const planeDefs = [
      { axes: ['x', 'y'], normal: 'z' },
      { axes: ['y', 'z'], normal: 'x' },
      { axes: ['x', 'z'], normal: 'y' },
    ];
    for (const def of planeDefs) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(0.18, 0.18),
        new THREE.MeshBasicMaterial({
          color: 0xffe08a, transparent: true, opacity: 0.5,
          side: THREE.DoubleSide, depthTest: false,
        }),
      );
      m.userData = { kind: 'plane', axes: def.axes, normal: def.normal, gz: 'move' };
      m.renderOrder = 998;
      this.group.add(m);
      this.planes.push(m);
    }
  }

  setMode(mode) {
    this.mode = mode;
    for (const p of this.parts.move) { p.bar.visible = mode === 'move'; p.tip.visible = mode === 'move'; }
    for (const p of this.parts.rotate) p.ring.visible = mode === 'rotate';
    for (const p of this.parts.scale) { p.sbar.visible = mode === 'scale'; p.stip.visible = mode === 'scale'; }
    for (const pl of this.planes) pl.visible = mode === 'move';
  }

  setTarget(obj) {
    if (!obj) { this.group.visible = false; return; }
    this.group.visible = true;
    this.obj = obj;
    this.sync();
  }

  sync(camera) {
    if (!this.obj) return;
    const p = new THREE.Vector3();
    this.obj.getWorldPosition(p);
    this.group.position.copy(p);
    const scale = camera ? camera.position.distanceTo(p) * 0.13 : 0.7;
    this.group.scale.setScalar(scale);

    const place = (mesh, axis, len) => {
      if (axis === 'x') {
        mesh.position.set(len / 2, 0, 0);
        mesh.rotation.set(0, 0, -Math.PI / 2);
      } else if (axis === 'y') {
        mesh.position.set(0, len / 2, 0);
        mesh.rotation.set(0, 0, 0);
      } else {
        mesh.position.set(0, 0, len / 2);
        mesh.rotation.set(Math.PI / 2, 0, 0);
      }
    };

    for (const p of [...this.parts.move, ...this.parts.scale]) {
      const bar = p.bar || p.sbar;
      const tip = p.tip || p.stip;
      place(bar, p.axis, 1);
      place(tip, p.axis, 1.12);
    }

    // 旋转环朝向：绕该轴转，环面法线就是该轴
    for (const p of this.parts.rotate) {
      if (p.axis === 'x') p.ring.rotation.set(0, Math.PI / 2, 0);
      else if (p.axis === 'y') p.ring.rotation.set(Math.PI / 2, 0, 0);
      else p.ring.rotation.set(0, 0, 0);
    }

    const offs = { z: [0.14, 0.14, 0], x: [0, 0.14, 0.14], y: [0.14, 0, 0.14] };
    for (const pl of this.planes) {
      const o = offs[pl.userData.normal];
      pl.position.set(o[0], o[1], o[2]);
      const n = pl.userData.normal;
      if (n === 'z') pl.rotation.set(0, 0, 0);
      else if (n === 'x') pl.rotation.set(0, Math.PI / 2, 0);
      else pl.rotation.set(-Math.PI / 2, 0, 0);
    }
  }

  // 拾取时只返回当前模式下的手柄。
  pickMeshes() {
    const out = [];
    this.group.traverse((o) => { if (o.isMesh && o.visible) out.push(o); });
    return out;
  }
}

// 兼容旧名字
class MoveGizmo extends TransformGizmo {
  constructor() { super(); this.setMode('move'); }
}

// ------------------------------------------------------------
// 选择框：选中物体外面套一层线框，不干扰原场景材质。
// ------------------------------------------------------------
class SelectionBox {
  constructor() {
    this.box = new THREE.Box3Helper(new THREE.Box3(), 0x9fe870);
    this.box.visible = false;
    this.box.material.depthTest = false;
    this.box.renderOrder = 997;
  }
  setObject(obj) {
    if (!obj) { this.box.visible = false; return; }
    const b = new THREE.Box3().setFromObject(obj);
    if (b.isEmpty()) { this.box.visible = false; return; }
    this.box.box.copy(b);
    this.box.visible = true;
  }
  refresh(obj) { this.setObject(obj); }
}

// ------------------------------------------------------------
// 编辑器主类
// ------------------------------------------------------------
export class SceneEditor {
  constructor({ canvas, scene, camera, data, onDirty }) {
    this.canvas = canvas;
    this.scene = scene;
    this.camera = camera;
    this.data = data;
    this.onDirty = onDirty || (() => {});
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.camera.fov = 60;
    this.camera.near = 0.1;
    this.camera.far = 200;
    this.camera.updateProjectionMatrix();

    this.orbit = new OrbitCam(this.camera, canvas);
    this.gizmo = new MoveGizmo();
    this.selection = new SelectionBox();
    this.helper = new THREE.Group();
    this.helper.name = 'editor-helpers';
  }

  attach(renderLayer) {
    // gizmo 与选择框放在独立分组里，导出时整体跳过。
    this.editorRoot = this.helper;
    this.editorRoot.add(this.gizmo.group);
    this.editorRoot.add(this.selection.box);
    this.scene.add(this.editorRoot);
  }

  // ---- 拾取 ----
  pick(clientX, clientY, roots) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(roots, true);
    return hits.length ? hits[0] : null;
  }

  // 从被击中的 mesh 往上找到「可编辑条目」节点。
  findItemNode(hitObject, nodeMap) {
    let o = hitObject;
    while (o) {
      if (o.userData && o.userData.__item && nodeMap.has(o.userData.__item.id)) return o;
      o = o.parent;
    }
    return null;
  }

  // gizmo 命中测试
  pickGizmo(clientX, clientY) {
    if (!this.gizmo.group.visible) return null;
    const targets = [...this.gizmo.bars, ...this.gizmo.planes,
      ...this.gizmo.bars.map(b => b.userData.tipMesh).filter(Boolean)];
    const hit = this.pick(clientX, clientY, targets);
    return hit ? hit.object : null;
  }
}

export { OrbitCam, TransformGizmo, MoveGizmo, SelectionBox };
