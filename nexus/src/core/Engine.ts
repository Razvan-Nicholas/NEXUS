import * as THREE from 'three';
import gsap from 'gsap';
import { AudioEngine } from '../audio/AudioEngine';
import { GlyphAtlas } from '../render/GlyphAtlas';
import { RenderPipeline } from '../render/RenderPipeline';
import { CameraRig } from './CameraRig';
import { disposeObject } from './dispose';
import { HudBridge } from './HudBridge';
import { Input } from './Input';
import { wait } from './math';
import { AdaptiveScaler, profileDevice, QUALITY, type DeviceProfile } from './Quality';
import { SelectionSystem } from './Selection';
import { bootLine, bootLineDone, prefs, pushToast, store } from './store';
import { TransitionDirector, type ArrivalOptions } from './TransitionDirector';
import { G } from './uniforms';
import { ZONES } from './zones';
import type { Environment, QualitySettings, QualityTier, RenderMode, SceneId, Selectable, TransitionKind, ZoneId } from './types';

const LOADERS: Record<SceneId, () => Promise<{ default: new () => Environment }>> = {
  gateway: () => import('../environments/gateway/GatewayEnvironment'),
  cosmos: () => import('../environments/cosmos/CosmosEnvironment'),
  singularity: () => import('../environments/singularity/SingularityEnvironment'),
  unknown: () => import('../environments/unknown/UnknownEnvironment'),
};

const MODES: RenderMode[] = ['ascii', 'wireframe', 'reality'];

async function loadFonts() {
  if (!document.fonts) return;
  await Promise.race([
    Promise.all([
      document.fonts.load('500 32px "IBM Plex Mono"'),
      document.fonts.load('400 32px "IBM Plex Mono"'),
      document.fonts.load('600 64px "Space Grotesk"'),
      document.fonts.load('500 32px "Space Grotesk"'),
      document.fonts.load('400 16px "Inter"'),
    ]),
    wait(5000),
  ]);
}

export class Engine {
  readonly container: HTMLElement;
  renderer!: THREE.WebGLRenderer;
  canvas!: HTMLCanvasElement;
  camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  atlas = new GlyphAtlas();
  pipeline!: RenderPipeline;
  input = new Input();
  rig: CameraRig;
  selection: SelectionSystem;
  hud: HudBridge;
  director: TransitionDirector;
  audio = new AudioEngine();
  scaler = new AdaptiveScaler();
  quality: QualitySettings = QUALITY.high;
  tier: QualityTier = 'high';
  device!: DeviceProfile;
  env: Environment | null = null;
  arrival: ArrivalOptions = {};
  params = new URLSearchParams(window.location.search);
  time = 0;
  timeScale = 1;
  fps = 60;
  mode: RenderMode = 'ascii';
  modeState = { ascii: 1, wire: 0 };
  private modeTween: gsap.core.Tween | null = null;
  private last = 0;
  private raf = 0;
  private zoneT = 0;
  private emptyScene = new THREE.Scene();
  private resizeObs: ResizeObserver | null = null;
  private disposed = false;
  private frozen = false;
  private onVisibility = () => {
    if (document.hidden && store.get().phase === 'explore') this.setPaused(true);
  };

  constructor(container: HTMLElement) {
    this.container = container;
    this.rig = new CameraRig(this.camera);
    this.selection = new SelectionSystem(this);
    this.hud = new HudBridge(this);
    this.director = new TransitionDirector(this);
  }

  // ───────────────────────────── boot ─────────────────────────────

  async boot() {
    const fast = this.params.has('fast');
    const step = async <T>(text: string, fn: () => Promise<T> | T, detail?: (r: T) => string, min = 240) => {
      const id = bootLine(text);
      const t0 = performance.now();
      try {
        const r = await fn();
        const el = performance.now() - t0;
        if (!fast && el < min) await wait(min - el);
        bootLineDone(id, 'ok', detail ? detail(r) : undefined);
        return r;
      } catch (err) {
        bootLineDone(id, 'fail', String((err as Error)?.message ?? err));
        throw err;
      }
    };

    try {
      if (!fast) await wait(500);
      const gpu = await step('initializing webgl2 context', () => this.initRenderer(), (g) => g);
      store.set({ bootProgress: 0.14 });
      await step('loading typefaces', () => loadFonts(), () => 'space grotesk · plex mono · inter');
      store.set({ bootProgress: 0.28 });
      await step('measuring glyph ink coverage', () => this.atlas.measure(), () => `${this.atlas.totalGlyphs} glyphs · ${this.atlas.rows.length} sets`);
      store.set({ bootProgress: 0.4 });
      await step('calibrating luminance ramp', () => this.atlas.buildLUT(), () => '256 levels per set');
      store.set({ bootProgress: 0.5 });
      await step('profiling device', () => this.initQuality(), () => `${this.quality.label.toLowerCase()} tier${this.device.software ? ' · software gpu' : ''}`);
      store.set({ bootProgress: 0.6 });
      await step('assembling render pipeline', () => this.initPipeline(), () => 'scene → cells → glyphs → bloom');
      store.set({ bootProgress: 0.72 });
      const startScene = (this.params.get('env') as SceneId) || 'gateway';
      const first = await step(`materializing environment // ${startScene}`, () => this.loadEnvironment(LOADERS[startScene] ? startScene : 'gateway'), () => 'shaders compiled');
      store.set({ bootProgress: 0.92 });
      this.swapEnvironment(first, null, 'boot');
      this.start();
      await step('synchronizing reality', () => wait(fast ? 0 : 300), () => gpu.length > 2 ? 'stable' : 'ok');
      store.set({ bootProgress: 1, bootDone: true });
      this.audio.enabled = prefs.read('audio', true);
      store.set({ audioOn: this.audio.enabled });
      if (!fast) await wait(1900);
      if (first.id === 'gateway') {
        store.set({ phase: 'gateway' });
        (first as unknown as { beginIntro?: (e: Engine) => void }).beginIntro?.(this);
      } else {
        store.set({ phase: 'explore' });
        if (first.entryCinematic) await first.entryCinematic(this, null, 'boot');
      }
    } catch (err) {
      console.error(err);
      store.set({ bootError: String((err as Error)?.message ?? err) });
    }
  }

  private initRenderer() {
    const canvas = document.createElement('canvas');
    canvas.className = 'nexus-canvas';
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL2 is not available on this device');
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setClearColor(0x050509, 1);
    if (!this.renderer.extensions.has('EXT_color_buffer_float')) {
      console.warn('EXT_color_buffer_float missing — HDR targets may fail.');
    }
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      store.set({ bootError: 'The GPU context was lost. Reload to re-enter the NEXUS.' });
    });
    this.container.appendChild(canvas);
    this.input.attach(this.container);
    this.input.onKey = (code, e) => this.handleKey(code, e);
    this.input.onClick = (x, y) => this.handleClick(x, y);
    this.input.onPointerMove = () => this.selection.markHoverDirty();
    store.set({ isTouch: window.matchMedia?.('(pointer: coarse)').matches ?? false });
    this.device = profileDevice(this.renderer);
    return this.device.gpu;
  }

  private initQuality() {
    const forced = this.params.get('q') as QualityTier | null;
    const saved = prefs.read<QualityTier | null>('quality', null);
    const tier: QualityTier = forced && QUALITY[forced] ? forced : saved && QUALITY[saved] ? saved : this.device.tier;
    this.tier = tier;
    this.quality = QUALITY[tier];
    this.scaler.enabled = this.params.get('adaptive') !== '0';
    const auto = prefs.read('autoQuality', true) && !forced;
    const cell = prefs.read<number>('cellSize', this.quality.defaultCell);
    store.set({ quality: tier, autoQuality: auto, cellSize: cell });
  }

  private initPipeline() {
    this.pipeline = new RenderPipeline(this.renderer, this.atlas);
    this.pipeline.cellCss = store.get().cellSize;
    this.pipeline.setQuality(this.quality);
    const startMode = this.params.get('mode') as RenderMode | null;
    if (startMode && MODES.includes(startMode)) {
      this.mode = startMode;
      this.modeState.ascii = startMode === 'ascii' ? 1 : 0;
      this.modeState.wire = startMode === 'wireframe' ? 1 : 0;
      this.pipeline.asciiMix = this.modeState.ascii;
      G.uWire.value = this.modeState.wire;
      store.set({ mode: startMode });
    }
    this.resize();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.container);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  resize() {
    if (!this.pipeline) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality.maxDpr);
    this.pipeline.resize(w, h, dpr);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (store.get().paused) this.renderFrame();
  }

  // ───────────────────────────── environments ─────────────────────────────

  async loadEnvironment(id: SceneId): Promise<Environment> {
    const mod = await LOADERS[id]();
    const env = new mod.default();
    await env.init(this);
    env.onQualityChange?.(this.quality);
    const cam = this.camera.clone();
    cam.near = env.config.camera.near;
    cam.far = env.config.camera.far;
    cam.updateProjectionMatrix();
    try {
      await this.renderer.compileAsync(env.scene, cam);
    } catch {
      this.renderer.compile(env.scene, cam);
    }
    return env;
  }

  swapEnvironment(next: Environment, from: SceneId | null, kind: TransitionKind) {
    const prev = this.env;
    this.audio.clearSpatial();
    if (prev && prev !== next) {
      prev.dispose();
      disposeObject(prev.scene);
    }
    this.env = next;
    const c = next.config;
    this.camera.fov = c.camera.fov;
    this.camera.near = c.camera.near;
    this.camera.far = c.camera.far;
    this.camera.updateProjectionMatrix();
    this.rig.fov = this.rig.zoomFov = c.camera.fov;
    this.rig.speed = c.movement.speed;
    this.rig.boost = c.movement.boost;
    this.rig.speedFactor = 1;
    this.timeScale = 1;
    G.uFogColor.value.set(c.fogColor);
    G.uFogDensity.value = c.fogDensity;
    this.pipeline.applyEnvironment(c);
    this.selection.setSelectables(next.getSelectables());
    this.audio.setProfile(c.audio);
    next.enter(this, from, kind);
    const zone = this.arrival.zone && ZONES[this.arrival.zone].scene === next.id ? this.arrival.zone : c.zone;
    this.setZone(zone, kind !== 'boot' || next.id !== 'gateway');
    store.set({ scene: next.id, selected: null, inspecting: false });
    this.arrival = {};
  }

  setZone(zone: ZoneId, announce = true) {
    const s = store.get();
    const first = !s.discovered[zone];
    if (s.zone === zone && !announce) return;
    store.set({ zone, discovered: { ...s.discovered, [zone]: true } });
    if (announce && zone !== 'gateway') {
      const z = ZONES[zone];
      store.set({ zoneCard: { key: performance.now(), index: z.index, name: z.name, subtitle: z.subtitle } });
      if (first && s.bootDone) this.audio.play('discover');
    }
  }

  /** Travel to a zone from the index. Same-scene zones are handled by the environment. */
  warpTo(zone: ZoneId) {
    const z = ZONES[zone];
    if (this.director.busy) return;
    if (zone === 'gateway') {
      void this.director.travel('gateway', 'warp', { zone });
      return;
    }
    if (this.env?.id === z.scene) {
      const focus = (this.env as unknown as { focusZone?: (e: Engine, zone: ZoneId) => void }).focusZone;
      store.set({ explorerOpen: false });
      if (focus) focus.call(this.env, this, zone);
      return;
    }
    void this.director.travel(z.scene, 'warp', { zone });
  }

  /** Travel to the archive and inspect a specific planet. */
  inspectPlanet(id: string) {
    store.set({ explorerOpen: false });
    if (this.env?.id === 'cosmos') {
      (this.env as unknown as { inspectById?: (e: Engine, id: string) => void }).inspectById?.(this, id);
    } else {
      void this.director.travel('cosmos', 'warp', { zone: 'archive', focus: id });
    }
  }

  enterNexus() {
    if (store.get().phase !== 'gateway' || this.director.busy) return;
    if (this.audio.enabled) void this.audio.start();
    void this.director.travel('cosmos', 'enter', { zone: 'cosmos' });
  }

  // ───────────────────────────── autopilot ─────────────────────────────

  /** Glide to a stand-off point in front of a target, then hand control back. */
  approach(target: THREE.Vector3, standoff: number, onArrive?: () => void) {
    if (this.director.busy) return;
    if (this.rig.mode === 'orbit') this.releaseInspect();
    const rig = this.rig;
    rig.beginCinematic();
    const from = rig.position.clone();
    const dir = from.clone().sub(target).normalize();
    if (!isFinite(dir.x) || dir.lengthSq() < 0.5) dir.set(0, 0.2, 1).normalize();
    const to = target.clone().addScaledVector(dir, standoff).add(new THREE.Vector3(0, standoff * 0.15, 0));
    const look = rig.lookTarget.clone();
    const dur = THREE.MathUtils.clamp(from.distanceTo(to) / 240, 1.4, 4.2);
    store.set({ phase: 'transition' });
    gsap
      .timeline({
        onComplete: () => {
          rig.setFree();
          store.set({ phase: 'explore' });
          onArrive?.();
        },
      })
      .to(look, { x: target.x, y: target.y, z: target.z, duration: 0.9, ease: 'power2.inOut', onUpdate: () => rig.lookTarget.copy(look) }, 0)
      .to(rig.position, { x: to.x, y: to.y, z: to.z, duration: dur, ease: 'power3.inOut' }, 0.2)
      .to(rig, { fov: rig.fov + 10, duration: dur * 0.5, yoyo: true, repeat: 1, ease: 'sine.inOut' }, 0.2);
  }

  // ───────────────────────────── inspection ─────────────────────────────

  inspect(target: Selectable, radius: number, min: number, max: number) {
    this.selection.select(target);
    const center = new THREE.Vector3();
    this.rig.enterOrbit(() => target.getPosition(center), radius, min, max);
    store.set({ inspecting: true });
  }

  releaseInspect() {
    if (this.rig.mode === 'orbit') this.rig.setFree();
    store.set({ inspecting: false });
  }

  // ───────────────────────────── modes & settings ─────────────────────────────

  setMode(mode: RenderMode) {
    if (mode === this.mode || !this.pipeline) return;
    this.mode = mode;
    store.set({ mode });
    this.modeTween?.kill();
    this.pipeline.fullResHold = true;
    this.audio.play('mode');
    this.modeTween = gsap.to(this.modeState, {
      ascii: mode === 'ascii' ? 1 : 0,
      wire: mode === 'wireframe' ? 1 : 0,
      duration: 1.5,
      ease: 'power2.inOut',
      onUpdate: () => {
        this.pipeline.asciiMix = this.modeState.ascii;
        G.uWire.value = this.modeState.wire;
      },
      onComplete: () => {
        this.pipeline.fullResHold = false;
      },
    });
  }

  cycleMode() {
    this.setMode(MODES[(MODES.indexOf(this.mode) + 1) % MODES.length]);
  }

  setQuality(tier: QualityTier, manual = true) {
    this.tier = tier;
    this.quality = QUALITY[tier];
    this.pipeline.setQuality(this.quality);
    this.scaler.reset(1);
    this.pipeline.adaptiveScale = 1;
    this.resize();
    this.env?.onQualityChange?.(this.quality);
    store.set({ quality: tier });
    if (manual) {
      prefs.write('quality', tier);
      this.setAutoQuality(false);
    }
  }

  setAutoQuality(on: boolean) {
    store.set({ autoQuality: on });
    prefs.write('autoQuality', on);
  }

  setCellSize(px: number) {
    store.set({ cellSize: px });
    prefs.write('cellSize', px);
    this.pipeline.setCellSize(px);
  }

  async toggleAudio() {
    const on = !this.audio.enabled;
    prefs.write('audio', on);
    store.set({ audioOn: on });
    await this.audio.setEnabled(on);
    if (on) this.audio.play('ui');
  }

  setPaused(p: boolean) {
    const s = store.get();
    if (s.paused === p) return;
    if (p && s.phase !== 'explore') return;
    store.set({ paused: p, explorerOpen: false });
    this.input.keys.clear();
    if (!p) this.last = performance.now();
  }

  // ───────────────────────────── input ─────────────────────────────

  private handleClick(x: number, y: number) {
    const s = store.get();
    if (s.phase !== 'explore' || s.paused || s.explorerOpen) return;
    this.selection.clickAt(x, y);
  }

  private handleKey(code: string, e: KeyboardEvent) {
    const s = store.get();
    if (s.phase === 'boot' || !this.pipeline) return;
    if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code)) e.preventDefault();
    switch (code) {
      case 'Digit1':
      case 'Numpad1':
        this.setMode('ascii');
        break;
      case 'Digit2':
      case 'Numpad2':
        this.setMode('wireframe');
        break;
      case 'Digit3':
      case 'Numpad3':
        this.setMode('reality');
        break;
      case 'KeyM':
        this.cycleMode();
        break;
      case 'KeyH':
        if (s.phase === 'explore') store.set({ hudVisible: !s.hudVisible });
        break;
      case 'Escape':
        this.escape();
        break;
      case 'Tab':
        if (s.phase === 'explore' && !s.paused) {
          store.set({ explorerOpen: !s.explorerOpen });
          this.audio.play('ui');
        }
        break;
      case 'KeyE':
        if (s.phase === 'explore' && !s.paused && !s.explorerOpen) this.selection.interact();
        break;
      case 'Enter':
        if (s.phase === 'gateway' && s.gatewayStage >= 3) this.enterNexus();
        break;
    }
  }

  escape() {
    const s = store.get();
    if (s.explorerOpen) {
      store.set({ explorerOpen: false });
      return;
    }
    if (s.paused) {
      this.setPaused(false);
      return;
    }
    if (s.phase !== 'explore') return;
    if (s.inspecting) {
      this.releaseInspect();
      return;
    }
    if (s.selected) {
      this.selection.select(null);
      return;
    }
    this.setPaused(true);
  }

  // ───────────────────────────── loop ─────────────────────────────

  start() {
    if (this.raf) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  private loop = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const raw = Math.min(Math.max((now - this.last) / 1000, 0), 0.1);
    this.last = now;
    if (store.get().paused || this.frozen) return;
    this.frame(raw);
  };

  // ───────────────────────────── deterministic capture ─────────────────────────────

  /** Stops the real-time loop so frames can be stepped by hand (screen capture, tests). */
  setFrozen(on: boolean) {
    this.frozen = on;
    if (!on) this.last = performance.now();
  }

  /** Advances the simulation by `dt` seconds and renders exactly one frame. */
  step(dt = 1 / 60) {
    this.frame(Math.max(0, dt));
  }

  /** Sets the render-mode blend directly (0..1 each), skipping the animated transition. */
  setModeMix(ascii: number, wire: number) {
    this.modeTween?.kill();
    this.modeState.ascii = ascii;
    this.modeState.wire = wire;
    this.pipeline.asciiMix = ascii;
    this.pipeline.fullResHold = ascii > 0.001 && ascii < 0.999;
    G.uWire.value = wire;
    this.mode = ascii >= 0.5 ? 'ascii' : wire >= 0.5 ? 'wireframe' : 'reality';
    store.set({ mode: this.mode });
  }

  private frame(raw: number) {
    this.fps += (1 / Math.max(raw, 1e-3) - this.fps) * 0.05;
    const dt = raw * this.timeScale;
    this.time += dt;
    G.uTime.value = this.time;
    this.input.update(raw);
    this.rig.update(raw, this.input);
    this.env?.update(dt, this.time, this);
    G.uCamVel.value.copy(this.rig.worldVelocity);
    G.uAscii.value = this.pipeline.asciiMix;
    this.updateMouse();
    this.selection.update(raw);
    this.hud.update(raw);
    this.audio.update(this.camera, raw);
    this.renderFrame();
    this.adapt(raw);
    this.zoneT -= raw;
    if (this.zoneT <= 0 && this.env?.getZone && store.get().phase === 'explore') {
      this.zoneT = 0.5;
      const z = this.env.getZone(this);
      if (z !== store.get().zone) this.setZone(z);
    }
  }

  private updateMouse() {
    const p = this.input.pointer;
    const pl = this.pipeline;
    const active = p.inside && p.x > -1000 && store.get().phase !== 'boot';
    pl.setMouse(p.x, p.y);
    pl.mouse.lens = active && !(p.type === 'touch' && !p.down) ? 1 : 0;
    pl.mouse.energy = Math.min(1, this.input.pointerSpeed / 1800);
    if (active) {
      const ndc = new THREE.Vector2((p.x / pl.cssW) * 2 - 1, -(p.y / pl.cssH) * 2 + 1);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, this.camera);
      G.uMouseOrigin.value.copy(ray.ray.origin);
      G.uMouseDir.value.copy(ray.ray.direction);
    }
    G.uMouseActive.value += ((active ? 1 : 0) - G.uMouseActive.value) * 0.1;
  }

  renderFrame() {
    if (!this.pipeline) return;
    this.pipeline.render(this.env?.scene ?? this.emptyScene, this.camera);
  }

  private adapt(dt: number) {
    if (!store.get().autoQuality && !this.params.has('adaptive')) {
      if (this.pipeline.adaptiveScale !== 1) this.pipeline.adaptiveScale = 1;
      return;
    }
    const r = this.scaler.sample(dt, this.quality.minSceneScale);
    if (r === 'scale') {
      this.pipeline.adaptiveScale = this.scaler.scale;
    } else if (r === 'tier-down' && store.get().autoQuality) {
      const next: QualityTier | null = this.tier === 'high' ? 'balanced' : this.tier === 'balanced' ? 'performance' : null;
      if (next) {
        this.setQuality(next, false);
        pushToast(`ADAPTIVE QUALITY → ${QUALITY[next].label.toUpperCase()}`, 'warn');
      }
    }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs?.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.input.dispose();
    if (this.env) {
      this.env.dispose();
      disposeObject(this.env.scene);
    }
    this.pipeline?.dispose();
    this.renderer?.dispose();
    this.canvas?.remove();
  }
}

let instance: Engine | null = null;
export function createEngine(container: HTMLElement) {
  instance?.dispose();
  instance = new Engine(container);
  (window as unknown as { __nexus?: Engine }).__nexus = instance;
  return instance;
}
export function getEngine() {
  return instance;
}
