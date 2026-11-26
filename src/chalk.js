import * as THREE from 'three';

// ============================================================
// 第一遍：把场景画成「粉笔数据」，不是最终颜色
//   R = shade(明暗)   G = 墨水色索引(0..1 表示调色板位置)   B,A = 世界法线 xy
// ============================================================
const chalkVert = /* glsl */`
varying vec3 vN;
void main() {
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}`;

const chalkFrag = /* glsl */`
uniform vec3 uLightDir;
uniform float uInkIndex;   // 该物体使用的墨水色在调色板中的归一化位置 [0,1]
varying vec3 vN;
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;              // 教室从内部看到盒子背面，翻正法线
  float shade = clamp(dot(n, normalize(uLightDir)) * 0.5 + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(shade, uInkIndex, n.x, n.y);
}`;

// 墨色调色板：蓝色为主，混入绿/紫/赭/青，像一盒彩色钢笔。
// 每个物体自带墨水色（item.ink 指定索引）；未指定时走旧 classify 兜底。
// 索引 0..6：0蓝 1墨绿 2紫 3赭 4青 5近黑(黑板面) 6白粉笔(板书)。
export const INK_PALETTE = [
  [0.10, 0.19, 0.76],  // 0 蓝（默认）
  [0.14, 0.42, 0.30],  // 1 墨绿
  [0.42, 0.18, 0.55],  // 2 紫
  [0.55, 0.30, 0.10],  // 3 赭
  [0.10, 0.42, 0.60],  // 4 青
  [0.10, 0.11, 0.14],  // 5 近黑（黑板面）
  [0.90, 0.91, 0.85],  // 6 白粉笔（板书）
];
export const BOARD_INK_INDEX = 5;   // post 里识别黑板面用
export const CHALK_INK_INDEX = 6;   // post 里识别板书白粉笔用


// 材质池：同一 inkIndex 复用同一材质，避免每个 mesh 一份。
const _matPool = new Map();
export function makeChalkMaterial(inkIndex = 0) {
  const key = inkIndex.toFixed(3);
  if (_matPool.has(key)) return _matPool.get(key);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uLightDir: { value: new THREE.Vector3(0.38, 0.82, 0.42) },
      uInkIndex: { value: inkIndex },
    },
    vertexShader: chalkVert,
    fragmentShader: chalkFrag,
    side: THREE.DoubleSide,
  });
  _matPool.set(key, mat);
  return mat;
}

// ============================================================
// 第二遍：全屏后处理 —— 黑板底 + 白色粉笔描边 + 排线 + 颗粒
// ============================================================
const postVert = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const postFrag = /* glsl */`
precision highp float;
uniform sampler2D tInk;
uniform sampler2D tDepth;
uniform vec2 uRes;
varying vec2 vUv;

// 白纸 + 蓝黑钢笔手绘风格（与参考「涂鸦」一致）
const vec3 PAPER     = vec3(0.965, 0.955, 0.905);  // 米白纸
const vec3 INK_BLUE  = vec3(0.10, 0.19, 0.76);     // 蓝色圆珠笔（默认/排线基准）
const vec3 INK_GRAPH = vec3(0.18, 0.20, 0.30);     // 石墨灰（暗部排线更沉）

// 调色板：与第一遍 INK_PALETTE 保持一致（0..6），按 t∈[0,1] 在 7 色间取。
vec3 inkPalette(float t) {
  t = clamp(t, 0.0, 1.0) * 6.0;
  vec3 c0 = vec3(0.10, 0.19, 0.76); // 0 蓝
  vec3 c1 = vec3(0.14, 0.42, 0.30); // 1 墨绿
  vec3 c2 = vec3(0.42, 0.18, 0.55); // 2 紫
  vec3 c3 = vec3(0.55, 0.30, 0.10); // 3 赭
  vec3 c4 = vec3(0.10, 0.42, 0.60); // 4 青
  vec3 c5 = vec3(0.10, 0.11, 0.14); // 5 近黑（黑板面）
  vec3 c6 = vec3(0.90, 0.91, 0.85); // 6 白粉笔（板书）
  if (t < 1.0) return mix(c0, c1, t);
  if (t < 2.0) return mix(c1, c2, t - 1.0);
  if (t < 3.0) return mix(c2, c3, t - 2.0);
  if (t < 4.0) return mix(c3, c4, t - 3.0);
  if (t < 5.0) return mix(c4, c5, t - 4.0);
  return mix(c5, c6, t - 5.0);
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float linDepth(float z) {
  float n = 0.1, f = 100.0;              // 与相机 near/far 一致
  return (2.0 * n * f) / (f + n - (z * 2.0 - 1.0) * (f - n));
}
// 方向排线：沿 dir 平行、间距 spacing、线宽 width，返回 [0,1] 的笔画覆盖
float stripes(vec2 p, vec2 dir, float spacing, float width) {
  float t = dot(p, vec2(-dir.y, dir.x));
  float f = abs(fract(t / spacing) - 0.5) * spacing;
  float soft = width * 0.6;
  return 1.0 - smoothstep(width * 0.5 - soft, width * 0.5 + soft, f);
}

void main() {
  vec2 px = 1.0 / uRes;
  float sc = uRes.y / 900.0;                 // 分辨率归一，缩放稳定

  // 手绘抖动：噪声扰动采样坐标，线条歪而不齐；绑定屏幕坐标所以不闪烁
  vec2 wob = vec2(vnoise(vUv * 34.0 + 11.3), vnoise(vUv * 34.0 + 37.0)) - 0.5;
  vec2 uv = vUv + wob * px * 1.4;

  vec4  c = texture2D(tInk, uv);
  float z = texture2D(tDepth, uv).x;

  // ---- 轮廓：逆深度拉普拉斯 + 法线差 ----
  float iw = 1.0 / linDepth(z);
  float zl = texture2D(tDepth, uv - vec2(px.x, 0.0)).x;
  float zr = texture2D(tDepth, uv + vec2(px.x, 0.0)).x;
  float zu = texture2D(tDepth, uv + vec2(0.0, px.y)).x;
  float zd = texture2D(tDepth, uv - vec2(0.0, px.y)).x;
  float lap = abs(1.0 / linDepth(zl) + 1.0 / linDepth(zr) - 2.0 * iw)
            + abs(1.0 / linDepth(zu) + 1.0 / linDepth(zd) - 2.0 * iw);
  float edge = smoothstep(0.07, 0.30, lap / (iw + 1e-7));

  vec4 sl = texture2D(tInk, uv - vec2(px.x, 0.0));
  vec4 sr = texture2D(tInk, uv + vec2(px.x, 0.0));
  vec4 su = texture2D(tInk, uv + vec2(0.0, px.y));
  vec4 sd = texture2D(tInk, uv - vec2(0.0, px.y));
  float nEdge = length(sl.ba - sr.ba) + length(su.ba - sd.ba);
  edge = max(edge, smoothstep(0.42, 0.85, nEdge));

  float isGeo = step(z, 0.99999);           // 背景深度为 1
  edge *= isGeo;

  // ---- 墨水排线：暗部越多斜线（以纸为稳定参考系，比屏幕更稳） ----
  float shade = c.r;
  float dark  = 1.0 - shade;
  vec2 hp = gl_FragCoord.xy;
  hp += (vnoise(hp * 0.16) - 0.5) * 2.2;    // 手绘 waver
  float sp = 9.0 * sc;                       // 排线间距
  float w  = 1.35 * sc;                      // 线宽
  const vec2 d1 = vec2(0.7071, 0.7071);
  const vec2 d2 = vec2(-0.7071, 0.7071);
  const vec2 d3 = vec2(0.2588, 0.9659);
  float h1 = stripes(hp, d1, sp, w);
  float h2 = stripes(hp, d2, sp * 1.15, w);
  float h3 = stripes(hp, d3, sp * 0.7, w);
  // 只在偏暗处才起排线：大面积受光面（墙面/地板）保持干净留白
  float hatch = h1 * smoothstep(0.52, 0.36, shade);
  hatch = max(hatch, h2 * smoothstep(0.30, 0.20, shade));
  hatch = max(hatch, h3 * smoothstep(0.18, 0.10, shade));
  // 极暗处（背光天花板/侧墙）改用单组稀疏细线，避免三组叠加成网格纸
  float hDeep = stripes(hp, d1, sp * 1.9, w * 0.7);
  hatch = max(hatch, hDeep * smoothstep(0.14, 0.02, shade) * 0.6);
  hatch = clamp(hatch, 0.0, 1.0) * isGeo;

  // 该像素所属物体的墨水色（第一遍把色相索引写在 G 通道）
  vec3 inkCol = inkPalette(c.g);
  // 排线在暗处偏石墨灰，亮处偏该物体的墨水色（层次感）
  vec3 hatchInk = mix(inkCol, INK_GRAPH, smoothstep(0.3, 0.7, dark));

  // ---- 纸底：米白 + 颗粒 + 极淡油墨不均 ----
  float grain = vnoise(gl_FragCoord.xy * 0.8) * 0.6 + vnoise(gl_FragCoord.xy * 0.17) * 0.4;
  vec3 paper = PAPER * (0.955 + 0.055 * grain);
  paper += (vnoise(vUv * 6.0 + 7.0) - 0.5) * 0.012;

  // ---- 合成：纸 → 排线 → 描边 ----
  vec3 col = paper;
  col = mix(col, hatchInk, hatch * 0.62);
  // 描边手绘粗细抖动，用该物体的墨水色描线（多色描边）
  float ew = 0.75 + 0.35 * vnoise(gl_FragCoord.xy * 0.35);
  vec3 lineCol = inkCol * 0.92;
  col = mix(col, lineCol, clamp(edge * ew, 0.0, 1.0) * 0.95);

  // 极轻暗角（白纸不压太黑，仅收边）
  vec2 q = vUv - 0.5;
  col *= 1.0 - dot(q, q) * 0.12;

  gl_FragColor = vec4(col, 1.0);
}`;

export class ChalkRenderer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, stencil: false, powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf6f4e8); // 纸白清屏色（后处理会覆盖，仅作底）
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.1, 100);

    // 存「粉笔数据」的 RenderTarget + 深度纹理
    const depth = new THREE.DepthTexture(2, 2);
    depth.format = THREE.DepthFormat;
    depth.type = THREE.FloatType;
    this.rt = new THREE.WebGLRenderTarget(2, 2, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthTexture: depth,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
    });

    this.post = new THREE.ShaderMaterial({
      uniforms: {
        tInk: { value: this.rt.texture },
        tDepth: { value: this.rt.depthTexture },
        uRes: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: postVert,
      fragmentShader: postFrag,
      depthTest: false,
      depthWrite: false,
    });
    this.postScene = new THREE.Scene();
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.post));
    this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setSize(w, h) {
    this.renderer.setSize(w, h, false);
    const dpr = this.renderer.getPixelRatio();
    const pw = Math.max(1, Math.floor(w * dpr));
    const ph = Math.max(1, Math.floor(h * dpr));
    this.rt.setSize(pw, ph);
    this.post.uniforms.uRes.value.set(pw, ph);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.renderer.setRenderTarget(this.rt);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCam);
  }
}
