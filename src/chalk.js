import * as THREE from 'three';

// ============================================================
// 第一遍：把场景画成「粉笔数据」，不是最终颜色
//   R = shade(明暗)   G = chalk(粉笔强度)   B,A = 世界法线 xy
// ============================================================
const chalkVert = /* glsl */`
varying vec3 vN;
void main() {
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}`;

const chalkFrag = /* glsl */`
uniform vec3 uLightDir;
varying vec3 vN;
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;              // 教室从内部看到盒子背面，翻正法线
  float shade = clamp(dot(n, normalize(uLightDir)) * 0.5 + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(shade, 1.0, n.x, n.y);
}`;

export function makeChalkMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uLightDir: { value: new THREE.Vector3(0.45, 0.85, 0.35) } },
    vertexShader: chalkVert,
    fragmentShader: chalkFrag,
    side: THREE.DoubleSide,
  });
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

void main() {
  vec2 px = 1.0 / uRes;

  // 手绘抖动：噪声扰动采样坐标，线条歪而不齐；绑定屏幕坐标所以不闪烁
  vec2 wob = vec2(vnoise(vUv * 34.0 + 11.3), vnoise(vUv * 34.0 + 37.0)) - 0.5;
  vec2 uv = vUv + wob * px * 1.6;

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
  float edge = smoothstep(0.06, 0.28, lap / (iw + 1e-6));

  vec4 sl = texture2D(tInk, uv - vec2(px.x, 0.0));
  vec4 sr = texture2D(tInk, uv + vec2(px.x, 0.0));
  vec4 su = texture2D(tInk, uv + vec2(0.0, px.y));
  vec4 sd = texture2D(tInk, uv - vec2(0.0, px.y));
  float nEdge = length(sl.ba - sr.ba) + length(su.ba - sd.ba);
  edge = max(edge, smoothstep(0.35, 0.80, nEdge));

  float isGeo = step(z, 0.9999);          // 背景深度为 1
  edge *= isGeo;

  // ---- 粉笔排线：越暗画越多斜线 ----
  float shade = c.r;
  float dark  = 1.0 - shade;
  float a1 = 0.60;
  float coord  = dot(uv * uRes, vec2(cos(a1), sin(a1))) / 7.0
               + (vnoise(vUv * 38.0 + 5.0) - 0.5) * 0.25;  // 轻微手绘 waver，保持直线感
  float coord2 = coord * 1.7 + vnoise(vUv * 33.0 + 9.0) * 0.15;
  vec2 d3 = vec2(cos(-a1), sin(-a1));
  float coord3 = dot(uv * uRes, d3) / 6.0 + vnoise(vUv * 30.0 + 21.0) * 0.18;

  float s1 = 1.0 - smoothstep(0.0, 0.45, abs(fract(coord)  - 0.5) * 2.0);
  float s2 = 1.0 - smoothstep(0.0, 0.45, abs(fract(coord2) - 0.5) * 2.0);
  float s3 = 1.0 - smoothstep(0.0, 0.45, abs(fract(coord3) - 0.5) * 2.0);
  // 任何几何体都有一层淡排线，暗部再叠加，避免地板/桌面死黑
  float hatch = s1 * (0.35 + 0.65 * step(0.15, dark))
              + s2 * step(0.40, dark)
              + s3 * step(0.62, dark);
  hatch = clamp(hatch, 0.0, 1.0) * isGeo;

  // ---- 粉笔颗粒：让线条断断续续，有摩擦感 ----
  float grain = vnoise(uv * uRes * 1.25 + 2.0);
  edge  *= 0.55 + 0.60 * grain;
  hatch *= 0.50 + 0.70 * grain;

  // ---- 黑板底：深墨绿 + 颗粒 + 淡淡擦痕 ----
  float boardGrain = vnoise(vUv * uRes * 0.9) * 0.55 + vnoise(vUv * uRes * 0.18) * 0.45;
  vec3 board = vec3(0.045, 0.062, 0.055) + boardGrain * 0.022;
  float smudge = smoothstep(0.55, 0.88, vnoise(vUv * 7.0 + 3.0));
  board += smudge * 0.018;

  // ---- 合成 ----
  vec3 chalkCol = vec3(0.92, 0.94, 0.90);
  vec3 col = board;
  col = mix(col, chalkCol, hatch * 0.42);
  col = mix(col, chalkCol, clamp(edge, 0.0, 1.0) * 0.95);

  // 暗角：整体更昏暗
  vec2 q = vUv - 0.5;
  col *= 1.0 - dot(q, q) * 0.75;

  gl_FragColor = vec4(col, 1.0);
}`;

export class ChalkRenderer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, stencil: false, powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
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
