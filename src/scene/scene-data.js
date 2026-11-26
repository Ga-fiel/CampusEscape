// ============================================================
// 场景数据层 —— 第一关教室
// 这里只放「数据」，不放渲染逻辑。改坐标、改尺寸、加桌椅、
// 挪学生，都只改这个文件，`buildClassroom` 会照着生成。
//
// 坐标约定：
//   Y 轴向上，Y=0 是地面；X 向右、Z 向后（后门在 +Z 方向）。
//   所有 pos 都是「物体中心点」，size 是「整体长宽高」。
//   rot 用角度制，单位是度，[x, y, z]。
//
// 每类物体的字段说明见 `src/scene/FORMAT.md`。
// ============================================================

export const SCENE = {
  version: 1,
  name: 'CampusEscape · 第一关教室',
  unit: 'meter',

  // 房间外壳：地面 / 天花板 / 四面墙由它生成。
  room: { w: 16, h: 4.2, d: 22 },

  // 出生点、老师讲台、巡逻点、后门交互区。
  markers: {
    playerStart: [-4.6, 1.6, -1.55],
    teacherDesk: [0, 0, -8.2],
    patrolPoints: [[5, 0, -6], [5, 0, 6], [-5, 0, 6], [-5, 0, -6]],
    backDoor: { x: 4.1, z: 10.8, halfWidth: 1.25, interactZ: 9.6 },
  },

  objects: [
    // ---------------- 黑板与讲台 ----------------
    {
      id: 'blackboard',
      type: 'box',
      pos: [0, 2.3, -10.82],
      size: [9, 2.4, 0.12],
      ink: 5, // 近黑描边
      label: '黑板',
    },
    {
      id: 'podium',
      type: 'box',
      pos: [0, 0.55, -9.4],
      size: [3.2, 1.1, 1.2],
      flags: { collide: true, noise: true, occlude: true, tag: 'podium' },
      label: '讲台',
    },

    // ---------------- 黑板上的勾股定理图 ----------------
    // points 是「相对 pos 的绝对世界坐标点」，两点一段画一条粉笔线。
    {
      id: 'board-triangle',
      type: 'polyline',
      pos: [0, 0, 0],
      radius: 0.025,
      segments: [
        [[-2.7, 1.5, -10.74], [-0.8, 1.5, -10.74]],
        [[-0.8, 1.5, -10.74], [-0.8, 2.75, -10.74]],
        [[-0.8, 2.75, -10.74], [-2.7, 1.5, -10.74]],
      ],
      label: '板书三角形',
    },

    // ---------------- 后门：画在墙上的粉笔门 ----------------
    {
      id: 'door-frame',
      type: 'prefab',
      prefab: 'chalkDoor',
      pos: [4.1, 0, 10.84],
      params: { halfWidth: 1.25, height: 2.7 },
      label: '后门',
    },
    {
      id: 'door-ground-mark',
      type: 'prefab',
      prefab: 'groundLines',
      pos: [4.1, 0.025, 9.635],
      params: { width: 2.5, gap: 0.17 },
      label: '门前地标',
    },
  ],
};

// ============================================================
// 桌椅与学生：按 3 列 × 5 排批量生成，方便整体调行列间距。
// 想手调单个桌位，把它从批量生成里挪到上面的 objects 里即可。
// ============================================================
export const DESK_GRID = {
  cols: 3,
  rows: 5,
  originX: -4.6,
  originZ: -5.5,
  stepX: 4.6,
  stepZ: 3.0,
  // 出生座位：不参与碰撞，避免醒来就被判噪声。
  playerSeat: { row: 1, col: 0 },
  deskWidth: 1.8,
  deskDepth: 0.9,
  deskTopY: 0.95,
  deskTopThickness: 0.12,
  chairOffsetZ: 0.82,
};

// 每个桌位里学生的表现方式，按 (row*3+col) % 3 循环。
export const STUDENT_POSES = ['sleep', 'read', 'idle'];

// 哪些桌位不放学生：出生座位一定放，其余按 seed 取样。
export function shouldHaveStudent(row, col, isPlayerSeat) {
  if (isPlayerSeat) return false;
  return (row * 3 + col) % 3 !== 1;
}

export function studentPoseOf(row, col) {
  return (row + col) % 3 === 0 ? 'sleep' : 'read';
}

// 桌面书本：每个桌位都有，部分桌位多一本。
export function booksOf(row, col) {
  const list = [{ id: `book-${row}-${col}-a`, x: -0.38, z: 0, seed: row * 3 + col }];
  if ((row + col) % 2 === 0) {
    list.push({ id: `book-${row}-${col}-b`, x: 0.42, z: 0.08, seed: row + col + 7 });
  }
  return list;
}
