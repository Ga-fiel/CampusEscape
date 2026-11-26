import * as THREE from 'three';
import { buildScene, buildShell, createMaterial, PREFABS, buildClassmateShape } from './scene/scene-build.js';
import { normalizeScene } from './scene/schema.js';
import { SCENE, DESK_GRID, shouldHaveStudent, studentPoseOf, booksOf } from './scene/scene-data.js';

// ============================================================
// 关卡构建 —— 数据在 scene/scene-data.js，这里只负责「按数据长出来」，
// 顺手把碰撞盒、遮挡盒、关键点整理成 AI 与玩家共用的运行时状态。
// ============================================================

const normalized = normalizeScene(SCENE);

export const ROOM = { ...normalized.room };
export const PLAYER_START = new THREE.Vector3(...normalized.markers.playerStart);
export const TEACHER_DESK = new THREE.Vector3(...normalized.markers.teacherDesk);
export const PATROL_POINTS = normalized.markers.patrolPoints.map(p => new THREE.Vector3(...p));
export const BACK_DOOR = { ...normalized.markers.backDoor };
export const SCENE_DATA = normalized;

export const walls = [];
export const occluders = [];

// 桌椅、学生这些批量件：默认由 DESK_GRID 生成，
// 如果场景 JSON 里已经有同 id 的条目，以 JSON 为准（编辑器存回来的就是这样）。
function buildDeskGrid(mat, scene, pushBox) {
  const grid = DESK_GRID;
  const items = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const x = grid.originX + col * grid.stepX;
      const z = grid.originZ + row * grid.stepZ;
      const isPlayerSeat = row === grid.playerSeat.row && col === grid.playerSeat.col;
      const key = `${row}-${col}`;

      const deskFlags = { collide: true, noise: true, occlude: true, tag: 'desk' };
      items.push({
        id: `desk-${key}`,
        type: 'prefab',
        prefab: 'desk',
        pos: [x, 0, z],
        params: {
          width: grid.deskWidth,
          depth: grid.deskDepth,
          topY: grid.deskTopY,
          topThickness: grid.deskTopThickness,
        },
        flags: deskFlags,
        // prefab 的碰撞盒单独声明，因为 prefab 不一定只有一个盒子。
        colliders: [{
          pos: [0, grid.deskTopY, 0],
          size: [grid.deskWidth, grid.deskTopThickness, grid.deskDepth],
          flags: deskFlags,
        }],
        label: `课桌 ${row + 1}-${col + 1}`,
      });

      // 椅子在桌子南侧；出生椅不碰撞，避免醒来时误判噪声。
      const chairFlags = { collide: !isPlayerSeat, noise: !isPlayerSeat, occlude: false, tag: 'chair' };
      items.push({
        id: `chair-${key}`,
        type: 'prefab',
        prefab: 'chair',
        pos: [x, 0, z + grid.chairOffsetZ],
        flags: chairFlags,
        colliders: [{
          pos: [0, 0.48, 0],
          size: [0.72, 0.1, 0.68],
          flags: chairFlags,
        }],
        label: `椅子 ${row + 1}-${col + 1}`,
      });

      for (const b of booksOf(row, col)) {
        items.push({
          id: b.id,
          type: 'prefab',
          prefab: 'book',
          pos: [x + b.x, 0, z + b.z],
          params: { seed: b.seed },
        });
      }

      if (shouldHaveStudent(row, col, isPlayerSeat)) {
        items.push({
          id: `student-${key}`,
          type: 'prefab',
          prefab: 'classmate',
          pos: [x, 0, z],
          params: { pose: studentPoseOf(row, col) },
          label: `同学 ${row + 1}-${col + 1}`,
        });
      }
    }
  }
  return items;
}

export function buildClassroom(scene) {
  const mat = scene.userData.__classroomMat || createMaterial();
  scene.userData.__classroomMat = mat;
  walls.length = 0;
  occluders.length = 0;

  const pushBox = (box) => {
    if (box.collide) walls.push(box);
    if (box.occlude) occluders.push(box);
  };

  // 1) 房间外壳
  buildShell(scene, ROOM, pushBox);

  // 2) 场景 JSON 里的显式物体
  const { root } = buildScene(scene, SCENE_DATA, pushBox);

  // 3) 批量桌椅与学生：JSON 里已有同 id 就跳过（编辑器保存过的场景）
  const existing = new Set(SCENE_DATA.objects.map(o => o.id));
  const batch = buildDeskGrid(mat, scene, pushBox).filter(o => !existing.has(o.id));
  if (batch.length) {
    const batchData = normalizeScene({ objects: batch });
    const sub = buildScene(root, batchData, pushBox);
    sub.root.name = 'desk-grid';
  }

  return root;
}

export function isInExitZone(pos) {
  return Math.abs(pos.x - BACK_DOOR.x) <= BACK_DOOR.halfWidth && pos.z >= BACK_DOOR.interactZ;
}

// 供工具页复用：拿到「当前场景数据」，包含批量桌椅在内。
export function getFullSceneData() {
  const batch = buildDeskGrid(null, null, () => {});
  const ids = new Set(SCENE_DATA.objects.map(o => o.id));
  return {
    ...SCENE_DATA,
    objects: [...SCENE_DATA.objects, ...batch.filter(o => !ids.has(o.id))],
  };
}

export { PREFABS, buildClassmateShape };
