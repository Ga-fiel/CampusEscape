import * as THREE from '../vendor/three/three.module.js';
import { createGame } from './game.js';

// A presentation sink: the shared game rules can update HUD elements without a browser.
function element() {
  const classes = new Set();
  let html = '';
  let text = '';
  return {
    style: {},
    get textContent() { return text; },
    set textContent(value) { text = String(value); html = text; },
    get innerHTML() { return html; },
    set innerHTML(value) { html = String(value); text = html.replace(/<[^>]*>/g, ''); },
    firstChild: { style: {} },
    classList: {
      add: (...names) => names.forEach(n => classes.add(n)),
      remove: (...names) => names.forEach(n => classes.delete(n)),
      contains: name => classes.has(name),
      toggle: (name, force) => {
        const on = force === undefined ? !classes.has(name) : force;
        if (on) classes.add(name); else classes.delete(name);
        return on;
      },
    },
    appendChild() {}, addEventListener() {}, requestPointerLock() {},
  };
}

export function createHeadlessGame({ search = '' } = {}) {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
    createElement: element,
    addEventListener() {}, exitPointerLock() {},
  };
  const window = { addEventListener() {}, innerWidth: 1280, innerHeight: 720 };
  let now = 0;
  let timerId = 0;
  const timers = [];
  const schedule = (fn, delay, repeat = false) => {
    const timer = { id: ++timerId, fn, due: now + delay, repeat: repeat ? delay : 0 };
    timers.push(timer);
    return timer.id;
  };
  const renderer = {
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(74, 1280 / 720, 0.1, 1000),
    post: { uniforms: { uHatch: { value: 1 }, uDebug: { value: 0 } } }, render() {},
  };
  const game = createGame({ document, window, location: { search, reload() {} },
    performance: { now: () => now }, requestAnimationFrame() {},
    setTimeout: (fn, ms) => schedule(fn, ms), setInterval: (fn, ms) => schedule(fn, ms, true), renderer });
  return {
    start: game.start,
    choose: game.choose,
    respawn: game.respawn,
    getState: game.getState,
    step(seconds, input = {}) {
      if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('seconds must be a non-negative finite number');
      Object.assign(game.input, input);
      const end = now + seconds * 1000;
      while (now < end) {
        const dt = Math.min(50, end - now);
        now += dt;
        const due = timers.filter(timer => timer.due <= now).sort((a, b) => a.due - b.due || a.id - b.id);
        for (const timer of due) {
          if (timer.repeat) timer.due += timer.repeat; else timers.splice(timers.indexOf(timer), 1);
          timer.fn();
        }
        game.step(dt / 1000, now / 1000);
      }
      return game.getState();
    },
  };
}
