import * as THREE from 'three';
import gsap from 'gsap';
import type { Engine } from '../../core/Engine';
import type { Environment, EnvironmentConfig, QualitySettings, SceneId, Selectable, TransitionKind } from '../../core/types';
import { G, STYLE, additive, additiveStyled, shared } from '../../core/uniforms';
import { POINTS, SCENE, WIRE } from '../../render/glsl/chunks';
import { gaussian, mulberry32 } from '../../core/math';
import { pushToast, store } from '../../core/store';
import { NebulaField, SpaceDust, glowSprite, glyphMesh, pointsGeometry, shellStars, starPointsMaterial, type GlyphInstance } from '../../materials/library';
import { BlackHole } from '../shared/blackhole';

const RS = 10;
const CENTER = new THREE.Vector3(0, 0, 0);
const COMPANION = new THREE.Vector3(-520, 150, -260);

const SKY_VERT = /* glsl */ `
${SCENE}
varying vec3 vDir;
void main(){
  vDir = position;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  gl_Position.z = gl_Position.w * 0.99999;
}
`;

const SKY_FRAG = /* glsl */ `
${SCENE}
${WIRE}
uniform samplerCube uSky;
uniform vec3 uGridCol;
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  vec3 c = texture(uSky, d).rgb;
  float lon = atan(d.z, d.x) / 6.2831853 + 0.5;
  float lat = asin(clamp(d.y, -1.0, 1.0)) / 3.14159265 + 0.5;
  vec2 g = vec2(lon * 48.0, lat * 24.0);
  vec2 f = abs(fract(g - 0.5) - 0.5);
  vec2 fw = vec2(min(fwidth(g.x), fwidth(fract(lon + 0.5) * 48.0)), fwidth(g.y));
  vec2 la = smoothstep(fw * 0.4, fw * 1.6, f);
  float grid = 1.0 - min(la.x, la.y);
  c = mix(c, uGridCol * grid + c * 0.15, wireMix());
  gl_FragColor = vec4(c, STYLE(${STYLE.STAR}));
}
`;

/** Disk particles: analytic Keplerian inspiral, hidden behind the shadow, tugged by the cursor. */
const SWIRL_VERT = /* glsl */ `
${SCENE}
${POINTS}
attribute vec4 aP;
attribute vec3 aColor;
attribute float aSize;
attribute float aSeed;
uniform mat4 uDisk;
uniform vec3 uCenter;
uniform float uRs;
uniform float uIn;
varying vec3 vColor;
void main(){
  float r0 = aP.x;
  float period = 60.0 + aSeed * 90.0;
  float age = fract(uTime / period + aSeed) * period;
  float v = (r0 - uIn) / period;
  float r = r0 - v * age;
  float c = 2.6;
  float theta = aP.y + (2.0 * c / v) * (inversesqrt(r) - inversesqrt(r0));
  float h = aP.w * (0.25 + r * 0.035);
  vec3 local = vec3(cos(theta) * r, h, sin(theta) * r) * uRs;
  vec3 wp = (uDisk * vec4(local, 1.0)).xyz;
  vec3 toP = wp - uMouseOrigin;
  vec3 closest = uMouseOrigin + uMouseDir * dot(toP, uMouseDir);
  vec3 pull = closest - wp;
  float pd = length(pull);
  wp += pull / max(pd, 1e-3) * uMouseActive * 9.0 * exp(-pd * pd / 900.0);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float fade;
  gl_PointSize = pointSize(aSize, -mv.z, 260.0, fade);
  vec3 cam = cameraPosition;
  vec3 toBH = uCenter - cam;
  float dBH = length(toBH);
  vec3 dirP = normalize(wp - cam);
  float behind = step(dBH, dot(wp - cam, normalize(toBH)));
  float perp = length(cross(dirP, toBH));
  float hidden = behind * (1.0 - smoothstep(2.45 * uRs, 2.9 * uRs, perp));
  float life = smoothstep(0.0, 0.08, age / period) * smoothstep(uIn, uIn + 1.0, r);
  float heat = clamp(1.0 - (r - uIn) / 14.0, 0.0, 1.0);
  vColor = aColor * (0.35 + heat * 1.8) * fade * life * (1.0 - hidden);
  gl_Position = projectionMatrix * mv;
}
`;

/** Matter stripped from a companion star, spiralling into the outer disk. */
const STREAM_VERT = /* glsl */ `
${SCENE}
${POINTS}
attribute vec4 aP;
attribute vec3 aColor;
attribute float aSize;
attribute float aSeed;
uniform mat4 uDisk;
uniform mat4 uDiskInv;
uniform vec3 uSource;
uniform float uRs;
varying vec3 vColor;
void main(){
  vec3 srcL = (uDiskInv * vec4(uSource, 1.0)).xyz / uRs;
  float rS = length(srcL.xz);
  float thS = atan(srcL.z, srcL.x);
  float s = fract(uTime * (0.012 + aSeed * 0.01) + aSeed);
  float k = pow(s, 0.7);
  float r = mix(rS, 12.5, k);
  float th = thS + k * 2.6 + aP.x * 0.04 * (1.0 - k);
  float y = mix(srcL.y, 0.0, pow(k, 0.5)) + aP.y * (0.6 + 2.0 * (1.0 - k));
  vec3 local = vec3(cos(th) * (r + aP.z * (1.0 - k) * 2.0), y, sin(th) * (r + aP.z * (1.0 - k) * 2.0)) * uRs;
  vec3 wp = (uDisk * vec4(local, 1.0)).xyz;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float fade;
  gl_PointSize = pointSize(aSize, -mv.z, 260.0, fade);
  vColor = aColor * fade * (0.4 + k * 1.6) * smoothstep(0.0, 0.05, s) * (1.0 - smoothstep(0.92, 1.0, s));
  gl_Position = projectionMatrix * mv;
}
`;

const POINT_FRAG = /* glsl */ `
uniform float uStyleA;
varying vec3 vColor;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = 1.0 - smoothstep(0.0, 1.0, d);
  a *= a;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor * a, uStyleA);
}
`;

const PHRASE = 'REALITY IS JUST ANOTHER RENDERING // ';

export default class SingularityEnvironment implements Environment {
  readonly id = 'singularity' as const;
  readonly config: EnvironmentConfig = {
    id: 'singularity',
    zone: 'singularity',
    audio: 'singularity',
    background: '#030306',
    fogColor: '#030306',
    fogDensity: 0.00006,
    camera: { fov: 58, near: 0.3, far: 60000 },
    movement: { speed: 42, boost: 6 },
    ascii: { exposure: 1.25, gamma: 0.95, edge: 1, voidDust: 0.25, lens: 1, glyphGain: 1.1, floor: 0.05 },
    bloom: { strength: 0.8, threshold: 0.6 },
    exposure: 1,
    hint: 'DRAG TO LOOK · WASD TO FLY · CURSOR BENDS LIGHT · CLICK SGR-Ø',
  };
  readonly scene = new THREE.Scene();
  private engine!: Engine;
  private cubeRT!: THREE.WebGLCubeRenderTarget;
  private skyMesh!: THREE.Mesh;
  private bh!: BlackHole;
  private diskMatrix = new THREE.Matrix4();
  private swirl!: THREE.Points;
  private swirlMat!: THREE.ShaderMaterial;
  private swirlCount = 0;
  private stream!: THREE.Points;
  private streamMat!: THREE.ShaderMaterial;
  private companion!: THREE.Group;
  private rings: THREE.Group[] = [];
  private dust!: SpaceDust;
  private selectables: Selectable[] = [];
  private falling = false;
  private warned = 0;
  private spatialOn = false;
  private flare = 0;

  async init(engine: Engine) {
    this.engine = engine;
    const rng = mulberry32(404);
    const q = engine.quality;

    this.cubeRT = this.renderSkyCube(engine, rng, q.particleScale > 0.5 ? 1024 : 512);
    this.skyMesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(30000, 4),
      new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, uniforms: { ...shared(), uSky: { value: this.cubeRT.texture }, uGridCol: { value: new THREE.Color('#00E5FF').multiplyScalar(0.77) } } }),
    );
    this.skyMesh.renderOrder = -100;
    this.skyMesh.frustumCulled = false;
    this.scene.add(this.skyMesh);

    // The black hole, its disk tilted toward the arrival path.
    this.bh = new BlackHole({ rs: RS, lens: 24, diskIn: 3, diskOut: 13, steps: q.bhSteps, sky: this.cubeRT.texture, gain: 0.62 });
    this.bh.mesh.position.copy(CENTER);
    this.bh.mesh.rotation.set(0.12, 0.4, -0.18);
    this.bh.mesh.renderOrder = -50;
    this.scene.add(this.bh.mesh);
    this.bh.mesh.updateMatrixWorld();
    this.diskMatrix.compose(CENTER, this.bh.mesh.quaternion, new THREE.Vector3(1, 1, 1));

    // Disk particles.
    const n = 26000;
    this.swirlCount = n;
    const aP = new Float32Array(n * 4);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const seed = new Float32Array(n);
    const pal = ['#9FF6FF', '#00E5FF', '#A000FF', '#FF00A8', '#F5F3FF'].map((h) => new THREE.Color(h));
    for (let i = 0; i < n; i++) {
      const r0 = 6 + Math.pow(rng(), 0.6) * 26;
      aP.set([r0, rng() * Math.PI * 2, 0, gaussian(rng)], i * 4);
      const c = pal[Math.floor(Math.pow(rng(), 1.4) * pal.length)];
      const b = 0.25 + rng() * 0.6;
      col.set([c.r * b, c.g * b, c.b * b], i * 3);
      size[i] = 1 + Math.pow(rng(), 4) * 2.6;
      seed[i] = rng();
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    sg.setAttribute('aP', new THREE.BufferAttribute(aP, 4));
    sg.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    sg.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    sg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.swirlMat = additiveStyled(
      new THREE.ShaderMaterial({
        vertexShader: SWIRL_VERT,
        fragmentShader: POINT_FRAG,
        uniforms: { ...shared(), uDisk: { value: this.diskMatrix }, uCenter: { value: CENTER.clone() }, uRs: { value: RS }, uIn: { value: 3.1 }, uStyleA: { value: (STYLE.SINGULARITY + 0.5) / 16 } },
      }),
    );
    this.swirl = new THREE.Points(sg, this.swirlMat);
    this.swirl.frustumCulled = false;
    this.scene.add(this.swirl);

    // A companion star being torn apart, feeding the disk.
    this.companion = new THREE.Group();
    this.companion.position.copy(COMPANION);
    const cStar = glowSprite({ color: '#FF7AD9', core: '#FFFFFF', scale: 120, intensity: 1.1, power: 3, rays: 0.6, fog: 0 });
    this.companion.add(cStar);
    this.scene.add(this.companion);
    const m = 9000;
    const sp = new Float32Array(m * 4);
    const scol = new Float32Array(m * 3);
    const ssz = new Float32Array(m);
    const sseed = new Float32Array(m);
    const spal = ['#FF5CC8', '#FF9AE0', '#C04BFF', '#F5F3FF'].map((h) => new THREE.Color(h));
    for (let i = 0; i < m; i++) {
      sp.set([gaussian(rng), gaussian(rng), gaussian(rng), 0], i * 4);
      const c = spal[Math.floor(rng() * spal.length)];
      const b = 0.3 + rng() * 0.6;
      scol.set([c.r * b, c.g * b, c.b * b], i * 3);
      ssz[i] = 1 + rng() * 1.8;
      sseed[i] = rng();
    }
    const stg = new THREE.BufferGeometry();
    stg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(m * 3), 3));
    stg.setAttribute('aP', new THREE.BufferAttribute(sp, 4));
    stg.setAttribute('aColor', new THREE.BufferAttribute(scol, 3));
    stg.setAttribute('aSize', new THREE.BufferAttribute(ssz, 1));
    stg.setAttribute('aSeed', new THREE.BufferAttribute(sseed, 1));
    this.streamMat = additive(
      new THREE.ShaderMaterial({
        vertexShader: STREAM_VERT,
        fragmentShader: POINT_FRAG,
        uniforms: {
          ...shared(),
          uDisk: { value: this.diskMatrix },
          uDiskInv: { value: this.diskMatrix.clone().invert() },
          uSource: { value: COMPANION.clone() },
          uRs: { value: RS },
          uStyleA: { value: 0 },
        },
      }),
    );
    this.stream = new THREE.Points(stg, this.streamMat);
    this.stream.frustumCulled = false;
    this.scene.add(this.stream);

    // Rings of literal characters orbiting the hole.
    const atlas = engine.atlas;
    const tex = atlas.getDisplayTexture();
    const makeRing = (text: string, radius: number, scale: number, color: string, tilt: THREE.Euler) => {
      const inst: GlyphInstance[] = [];
      const chars = text.split('');
      const count = Math.floor((Math.PI * 2 * radius) / (scale * 0.78));
      const c = new THREE.Color(color);
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        const pos = new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius);
        const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a - Math.PI / 2, 0));
        const ch = chars[i % chars.length];
        if (ch === ' ') continue;
        inst.push({ char: ch, pos, quat, scale, color: c.clone().multiplyScalar(0.9 + rng() * 0.6) });
      }
      const mesh = glyphMesh(inst, tex, (ch) => atlas.displayRect(ch), STYLE.SINGULARITY);
      const g = new THREE.Group();
      g.add(mesh);
      g.rotation.copy(tilt);
      this.scene.add(g);
      this.rings.push(g);
    };
    makeRing(PHRASE, 27 * RS, 26, '#7FEFFF', new THREE.Euler(0.42, 0, 0.2));
    makeRing('01001110 01000101 01011000 01010101 01010011 ', 36 * RS, 20, '#B266FF', new THREE.Euler(-0.3, 0, -0.35));

    // A few nebula wisps for depth near the hole.
    const puffs = Array.from({ length: 40 }, () => ({
      pos: new THREE.Vector3(gaussian(rng) * 900, gaussian(rng) * 300, gaussian(rng) * 900),
      scale: 300 + rng() * 500,
      color: new THREE.Color(rng() < 0.5 ? '#3B0E80' : '#0A4E66').multiplyScalar(0.12),
    })).filter((p) => p.pos.length() > 420);
    this.scene.add(new NebulaField(puffs, 1).mesh);

    this.dust = new SpaceDust(rng, 2400, 260, '#9FEFFF', 1.2, 0.07);
    this.scene.add(this.dust.mesh);

    this.buildSelectables();
  }

  /** Renders a dense core-region starfield into a cube map once; it is lensed by the hole. */
  private renderSkyCube(engine: Engine, rng: () => number, size: number) {
    const renderer = engine.renderer;
    const rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    const sky = new THREE.Scene();
    const pal = ['#F5F3FF', '#FFF1E0', '#9FEFFF', '#C59BFF', '#FF9AD9', '#9DB4FF'].map((c) => new THREE.Color(c));
    const s1 = shellStars(rng, 16000, 1000, pal, [0.9, 2.2], 0.9);
    const s2 = shellStars(rng, 1600, 1000, pal, [2, 4.2], 1.3);
    const m1 = starPointsMaterial({ twinkle: 0, fog: 0 });
    const m2 = starPointsMaterial({ twinkle: 0, fog: 0 });
    sky.add(new THREE.Points(pointsGeometry(s1), m1), new THREE.Points(pointsGeometry(s2), m2));
    const puffs = Array.from({ length: 60 }, () => {
      const d = new THREE.Vector3(gaussian(rng), gaussian(rng) * 0.4, gaussian(rng)).normalize();
      const hue = rng();
      return {
        pos: d.multiplyScalar(800),
        scale: 300 + rng() * 500,
        color: new THREE.Color(hue < 0.4 ? '#4A0E91' : hue < 0.7 ? '#0B5566' : '#7A0A55').multiplyScalar(0.22),
      };
    });
    const neb = new NebulaField(puffs, 1);
    sky.add(neb.mesh);
    const band = glowSprite({ color: '#2A1A5E', scale: 2400, intensity: 0.25, power: 1.6, fog: 0 });
    band.position.set(0, 0, -900);
    sky.add(band);

    const cam = new THREE.CubeCamera(1, 5000, rt);
    const prevScale = G.uRTScale.value;
    const prevSize = G.uRTSize.value.clone();
    const prevPointMin = G.uPointMin.value;
    const prevAuto = renderer.autoClear;
    const prevFog = G.uFogDensity.value;
    G.uRTScale.value = size / 640;
    G.uRTSize.value.set(size, size);
    G.uPointMin.value = 1.2;
    G.uFogDensity.value = 0;
    renderer.autoClear = true;
    renderer.setClearColor(0x000000, 1);
    cam.update(renderer, sky);
    renderer.autoClear = prevAuto;
    G.uRTScale.value = prevScale;
    G.uRTSize.value.copy(prevSize);
    G.uPointMin.value = prevPointMin;
    G.uFogDensity.value = prevFog;
    sky.traverse((o) => {
      const mm = o as THREE.Mesh;
      mm.geometry?.dispose();
      (mm.material as THREE.Material | undefined)?.dispose();
    });
    return rt;
  }

  private buildSelectables() {
    const e = () => this.engine;
    this.selectables = [
      {
        id: 'sgr-0',
        name: 'SGR-Ø',
        kind: 'singularity',
        radius: 13 * RS,
        getPosition: (t) => t.copy(CENTER),
        info: {
          id: 'sgr-0',
          name: 'SGR-Ø',
          designation: 'SCHWARZSCHILD // NON-ROTATING',
          kind: 'singularity',
          accent: '#00E5FF',
          stats: [
            { label: 'Event horizon', value: `r = ${RS.toFixed(1)} u` },
            { label: 'Photon sphere', value: `${(RS * 1.5).toFixed(1)} u` },
            { label: 'Shadow', value: `${(RS * 2.6).toFixed(1)} u` },
            { label: 'Disk', value: `${3 * RS}–${13 * RS} u` },
            { label: 'Time dilation', value: 'Unbounded' },
          ],
          description:
            'Light that passes too close is bent around and returned to you — the halo above the shadow is the far side of the disk. Your cursor carries a small gravity well of its own.',
        },
        interactLabel: 'CROSS THE EVENT HORIZON',
        interactRange: 60 * RS,
        tone: 98,
        onInteract: () => this.fall(),
      },
      {
        id: 'hd-07',
        name: 'HD-Ø7',
        kind: 'star',
        radius: 40,
        getPosition: (t) => t.copy(COMPANION),
        info: {
          id: 'hd-07',
          name: 'HD-Ø7',
          designation: 'TIDAL DISRUPTION // IN PROGRESS',
          kind: 'star',
          accent: '#FF00A8',
          stats: [
            { label: 'Mass loss', value: '0.4 M☉ / yr' },
            { label: 'Stream length', value: '≈ 600 u' },
            { label: 'Remaining', value: '~ 3 orbits' },
          ],
          description: 'A star that wandered too close. Its outer layers are being unspooled into the disk, one glowing strand at a time.',
        },
        interactLabel: 'APPROACH',
        interactRange: 0,
        tone: 659.25,
        onInteract: () => e().approach(COMPANION, 160),
      },
    ];
  }

  getSelectables() {
    return this.selectables;
  }

  enter(engine: Engine) {
    this.falling = false;
    this.spatialOn = false;
    const rig = engine.rig;
    const pos = new THREE.Vector3(75, 36, 268);
    rig.mode = 'free';
    rig.position.copy(pos);
    rig.camera.position.copy(pos);
    rig.lookAtNow(new THREE.Vector3(0, -6, 0));
  }

  entryCinematic(engine: Engine, _from: SceneId | null, _kind: TransitionKind): Promise<void> {
    const rig = engine.rig;
    const fx = engine.pipeline.fx;
    const end = new THREE.Vector3(75, 36, 268);
    rig.mode = 'cinematic';
    rig.position.set(420, 210, 1600);
    rig.lookTarget.set(0, -6, 0);
    rig.fov = 104;
    return new Promise((resolve) => {
      gsap
        .timeline({
          onComplete: () => {
            rig.setFree();
            rig.zoomFov = this.config.camera.fov;
            resolve();
          },
        })
        .to(fx, { flash: 0, duration: 1.0, ease: 'power2.out' }, 0)
        .to(fx, { warp: 0, scramble: 0, chroma: 0, glitch: 0, invert: 0, fade: 0, duration: 2.4, ease: 'power3.out' }, 0)
        .to(rig.position, { x: end.x, y: end.y, z: end.z, duration: 3.6, ease: 'expo.out' }, 0)
        .to(rig, { fov: this.config.camera.fov, duration: 3.6, ease: 'expo.out' }, 0);
    });
  }

  private fall() {
    if (this.falling || this.engine.director.busy) return;
    this.falling = true;
    void this.engine.director.travel('unknown', 'horizon');
  }

  /** Spiral in, slow time to a crawl, collapse the image to a point. */
  exitCinematic(engine: Engine, _to: SceneId, kind: TransitionKind): Promise<void> {
    if (kind !== 'horizon') return engine.director.defaultExit();
    const rig = engine.rig;
    const fx = engine.pipeline.fx;
    rig.beginCinematic();
    const start = rig.position.clone();
    const local = start.clone().applyMatrix4(this.diskMatrix.clone().invert());
    const r0 = Math.max(local.length(), 8 * RS);
    const a0 = Math.atan2(local.z, local.x);
    const h0 = local.y;
    const state = { s: 0 };
    const look = rig.lookTarget.clone();
    const tmp = new THREE.Vector3();
    const proj = new THREE.Vector3();
    return new Promise((resolve) => {
      gsap
        .timeline({ onComplete: () => resolve() })
        .to(look, { x: CENTER.x, y: CENTER.y, z: CENTER.z, duration: 1.0, ease: 'power2.inOut', onUpdate: () => rig.lookTarget.copy(look) }, 0)
        .to(state, {
          s: 1,
          duration: 6.2,
          ease: 'power2.in',
          onUpdate: () => {
            const s = state.s;
            const r = THREE.MathUtils.lerp(r0, 1.08 * RS, Math.pow(s, 0.75));
            const a = a0 + s * 3.4;
            const y = THREE.MathUtils.lerp(h0, RS * 0.35, s);
            tmp.set(Math.cos(a) * r, y, Math.sin(a) * r).applyMatrix4(this.diskMatrix);
            rig.position.copy(tmp);
            const ahead = new THREE.Vector3(Math.cos(a + 0.6) * r * 0.2, 0, Math.sin(a + 0.6) * r * 0.2).applyMatrix4(this.diskMatrix);
            if (s > 0.15) rig.lookTarget.lerpVectors(CENTER, ahead, Math.min(1, (s - 0.15) * 1.4) * 0.5);
            engine.timeScale = Math.max(0.04, 1 - s * 1.1);
            proj.copy(CENTER).project(engine.camera);
            fx.warpX = THREE.MathUtils.clamp(proj.x * 0.5 + 0.5, 0.2, 0.8);
            fx.warpY = THREE.MathUtils.clamp(proj.y * 0.5 + 0.5, 0.2, 0.8);
          },
        }, 0.4)
        .to(rig, { fov: 112, roll: 0.9, duration: 6.2, ease: 'power2.in' }, 0.4)
        .to(fx, { chroma: 0.02, scramble: 0.55, warp: 0.85, duration: 5.6, ease: 'power3.in' }, 1.0)
        .to(fx, { fade: 1, duration: 0.9, ease: 'power2.in' }, 6.0)
        .to(fx, { invert: 1, duration: 0.01 }, 6.9)
        .to(fx, { fade: 0, flash: 1, duration: 0.5, ease: 'power2.out' }, 7.0)
        .add(() => {
          fx.warpX = 0.5;
          fx.warpY = 0.5;
          engine.timeScale = 1;
        });
    });
  }

  onQualityChange(q: QualitySettings) {
    this.bh.material.uniforms.uSteps.value = q.bhSteps;
    this.swirl.geometry.setDrawRange(0, Math.floor(this.swirlCount * Math.max(0.35, q.particleScale)));
    this.dust.setScale(q.particleScale);
  }

  update(dt: number, t: number, engine: Engine) {
    const cam = engine.camera;
    this.skyMesh.position.copy(cam.position);
    this.bh.update(t);
    this.dust.update(cam);
    this.rings[0].rotation.y += dt * 0.05;
    this.rings[1].rotation.y -= dt * 0.032;

    // The cursor near the hole on screen strengthens the lens and flares the photon ring.
    const p = engine.input.pointer;
    let near = 0;
    if (p.inside && p.x > -1000) {
      const s = CENTER.clone().project(cam);
      const sx = (s.x * 0.5 + 0.5) * engine.pipeline.cssW;
      const sy = (1 - (s.y * 0.5 + 0.5)) * engine.pipeline.cssH;
      const dist = cam.position.distanceTo(CENTER);
      const rpx = ((13 * RS) / (dist * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2))) * (engine.pipeline.cssH / 2);
      near = s.z < 1 ? Math.max(0, 1 - Math.hypot(p.x - sx, p.y - sy) / Math.max(rpx * 1.6, 60)) : 0;
    }
    this.flare += (near - this.flare) * Math.min(1, dt * 4);
    const u = this.bh.material.uniforms;
    u.uFlare.value = this.flare * (0.6 + Math.min(1, engine.input.pointerSpeed / 1200) * 0.8) + (engine.selection.hovered?.id === 'sgr-0' ? 0.3 : 0);
    u.uGravity.value = 1 + this.flare * 0.22;

    if (!this.spatialOn && engine.audio.running) {
      this.spatialOn = true;
      engine.audio.addSpatial('bh', CENTER, { freq: 36.7, gain: 0.3, ref: 220, rolloff: 0.9 });
      engine.audio.addSpatial('hd07', COMPANION, { freq: 880, gain: 0.03, ref: 120, noise: true });
    }

    if (store.get().phase === 'explore' && !this.falling) {
      const d = cam.position.distanceTo(CENTER);
      engine.rig.speedFactor = THREE.MathUtils.clamp(d / 400, 0.35, 3);
      if (d < 16 * RS && t - this.warned > 8) {
        this.warned = t;
        pushToast('TIDAL FORCES CRITICAL — TURN BACK OR FALL', 'warn', 3200);
      }
      if (d < 5.5 * RS) this.fall();
    }
  }

  dispose() {
    this.cubeRT.dispose();
    this.engine.timeScale = 1;
  }
}
