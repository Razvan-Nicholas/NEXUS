import * as THREE from 'three';
import gsap from 'gsap';
import type { Engine } from '../../core/Engine';
import type { Environment, EnvironmentConfig, QualitySettings, SceneId, Selectable, TransitionKind, ZoneId } from '../../core/types';
import { mulberry32 } from '../../core/math';
import { STYLE } from '../../core/uniforms';
import { pushToast, store } from '../../core/store';
import { NebulaField, SpaceDust, glowSprite, pointsGeometry, shellStars, starPointsMaterial } from '../../materials/library';
import { BlackHole } from '../shared/blackhole';
import { ANOMALY_INFO, ARCHIVE_VIEW, CORE_INFO, CORE_POSITION, GALAXY_NORMAL, LATTICE_INFO, LUMEN_INFO, MONOLITH_INFO, PLANETS, SPAWN } from './data';
import { buildDistantGalaxies, buildGalaxyNebulae, buildGalaxyStars, buildSky, galaxyFrame, nebulaCluster } from './galaxy';
import { buildPlanet, buildStar, orbitPosition, type PlanetObject } from './planets';
import { AsteroidBelt, buildAnomaly, buildLattice, buildMonoliths, buildOrbitPath } from './structures';

const STAR_R = 14;
const CORE_RS = 7;
const LATTICE_POS = new THREE.Vector3(-300, 70, 40);
const MONOLITH_POS = new THREE.Vector3(330, -14, -170);
const ANOMALY_POS = new THREE.Vector3(330, -10, -158);

export default class CosmosEnvironment implements Environment {
  readonly id = 'cosmos' as const;
  readonly config: EnvironmentConfig = {
    id: 'cosmos',
    zone: 'cosmos',
    audio: 'cosmos',
    background: '#050509',
    fogColor: '#06050c',
    fogDensity: 0.00016,
    camera: { fov: 60, near: 0.5, far: 40000 },
    movement: { speed: 26, boost: 7 },
    ascii: { exposure: 1.3, gamma: 1.0, edge: 1, voidDust: 0.35, lens: 0, glyphGain: 1.1, floor: 0.055 },
    bloom: { strength: 0.85, threshold: 0.55 },
    exposure: 1,
    hint: 'DRAG TO LOOK · WASD TO FLY · SHIFT BOOST · CLICK TO SELECT',
  };
  readonly scene = new THREE.Scene();
  private sky = new THREE.Group();
  private planets: PlanetObject[] = [];
  private star!: THREE.Mesh;
  private corona!: THREE.Mesh;
  private belt!: AsteroidBelt;
  private galaxy!: THREE.Points;
  private galaxyCount = 0;
  private nebulae: NebulaField[] = [];
  private dust!: SpaceDust;
  private lattice!: THREE.Group;
  private monoliths!: THREE.Group;
  private anomaly!: THREE.Mesh;
  private anomalyVisible = true;
  private core!: BlackHole;
  private coreGlows: THREE.Mesh[] = [];
  private orbitPaths: THREE.Points[] = [];
  private selectables: Selectable[] = [];
  private starPos = new THREE.Vector3();
  private engine!: Engine;
  private travelling = false;
  private spatialOn = false;
  private proximityCooldown = 0;
  private tmp = new THREE.Vector3();

  async init(engine: Engine) {
    this.engine = engine;
    const rng = mulberry32(2026);
    const frame = galaxyFrame(CORE_POSITION, GALAXY_NORMAL);
    const q = engine.quality;

    // Sky dome, far stars and distant galaxies travel with the camera (at infinity).
    this.sky.add(buildSky(frame, 20000));
    const far = shellStars(rng, 5200, 16000, ['#F5F3FF', '#9FEFFF', '#C59BFF', '#FF9AD9'].map((c) => new THREE.Color(c)), [0.9, 2.4], 0.7);
    const farPts = new THREE.Points(pointsGeometry(far), starPointsMaterial({ twinkle: 0.3, fog: 0, style: STYLE.STAR }));
    farPts.frustumCulled = false;
    farPts.renderOrder = -80;
    this.sky.add(farPts);
    this.sky.add(buildDistantGalaxies(rng, 7, 15000, frame.normal));
    this.scene.add(this.sky);

    // The galaxy: 70k stars in four logarithmic arms, a bulge and field stars.
    const stars = buildGalaxyStars(rng, frame, 70000);
    this.galaxyCount = 70000;
    this.galaxy = new THREE.Points(pointsGeometry(stars), starPointsMaterial({ twinkle: 0.35, atten: 900, fog: 0.6, style: STYLE.STAR, intensity: 1.35 }));
    this.galaxy.frustumCulled = false;
    this.galaxy.renderOrder = -10;
    this.scene.add(this.galaxy);

    // Nebulae: arm clouds plus three close clusters around the Lumen system.
    const puffs = [
      ...buildGalaxyNebulae(rng, frame, 340),
      ...nebulaCluster(rng, new THREE.Vector3(-420, 40, -560), 260, 70, ['#5B12B0', '#8E1DFF', '#3A0F7A'], 0.12),
      ...nebulaCluster(rng, new THREE.Vector3(600, -60, -300), 200, 50, ['#08697E', '#0B8DA6', '#1A3F8F'], 0.11),
      ...nebulaCluster(rng, new THREE.Vector3(160, 180, 820), 280, 55, ['#8A0F66', '#B0157E', '#4A1690'], 0.1),
    ];
    const neb = new NebulaField(puffs, 1);
    this.nebulae.push(neb);
    this.scene.add(neb.mesh);

    // Galactic core: a real ray-marched black hole seen from 2.8 ku, wrapped in glow.
    this.core = new BlackHole({ rs: CORE_RS, lens: 22, diskIn: 3, diskOut: 13, steps: Math.min(90, q.bhSteps), sky: null, gain: 1.1 });
    this.core.mesh.position.copy(CORE_POSITION);
    this.core.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), frame.normal);
    this.core.mesh.rotateX(0.32);
    this.core.mesh.renderOrder = 1;
    this.scene.add(this.core.mesh);
    const g1 = glowSprite({ color: '#24124F', core: '#000000', scale: 2200, intensity: 0.2, power: 3.0, fog: 0 });
    const g2 = glowSprite({ color: '#3B7FD9', core: '#000000', scale: 620, intensity: 0.22, power: 3.6, fog: 0 });
    for (const g of [g1, g2]) {
      g.position.copy(CORE_POSITION);
      g.renderOrder = -5;
      this.scene.add(g);
      this.coreGlows.push(g);
    }

    // Lumen and its four worlds.
    this.star = buildStar(STAR_R);
    this.scene.add(this.star);
    this.corona = glowSprite({ color: '#7FEFFF', core: '#FFFFFF', scale: STAR_R * 9, intensity: 1.1, power: 3.0, rays: 1, fog: 0.4 });
    this.scene.add(this.corona);
    const halo = glowSprite({ color: '#3A1C8C', scale: STAR_R * 30, intensity: 0.35, power: 2.2, fog: 0.4 });
    this.scene.add(halo);

    for (const def of PLANETS) {
      const p = buildPlanet(def, this.starPos);
      orbitPosition(def, 0, p.position);
      p.root.position.copy(p.position);
      this.scene.add(p.root);
      this.planets.push(p);
      const path = buildOrbitPath(def.orbitRadius, def.inclination, def.palette.accent);
      this.orbitPaths.push(path);
      this.scene.add(path);
    }

    this.belt = new AsteroidBelt(rng, 1500, 205, 232, this.starPos);
    this.scene.add(this.belt.mesh);

    this.lattice = buildLattice(52, this.starPos);
    this.lattice.position.copy(LATTICE_POS);
    this.scene.add(this.lattice);

    this.monoliths = new THREE.Group();
    this.monoliths.add(buildMonoliths(7, 60, this.starPos));
    this.monoliths.position.copy(MONOLITH_POS);
    this.monoliths.lookAt(0, MONOLITH_POS.y, 0);
    this.scene.add(this.monoliths);

    this.anomaly = buildAnomaly();
    this.anomaly.position.copy(ANOMALY_POS);
    this.scene.add(this.anomaly);

    this.dust = new SpaceDust(rng, 2600, 220, '#B9B3D9', 1.2, 0.08);
    this.scene.add(this.dust.mesh);

    this.buildSelectables();
  }

  private planetSelectable(p: PlanetObject): Selectable {
    const def = p.def;
    const sel: Selectable = {
      id: def.id,
      name: def.name,
      kind: 'planet',
      radius: def.rings ? def.rings.outer * 0.75 : def.radius * 1.15,
      getPosition: (t) => t.copy(p.position),
      info: { id: def.id, name: def.name, designation: def.designation, kind: 'planet', stats: def.stats, description: def.description, accent: def.palette.accent, inspectable: true },
      interactLabel: 'INSPECT',
      interactRange: def.radius * 7 + 30,
      tone: def.tone,
      onInteract: () => {
        const r = def.rings ? def.rings.outer * 1.9 : def.radius * 3.4;
        this.engine.inspect(sel, r, def.radius * 1.5, def.radius * 16);
        this.engine.setZone('archive');
      },
    };
    return sel;
  }

  private buildSelectables() {
    const list: Selectable[] = this.planets.map((p) => this.planetSelectable(p));
    const lumen: Selectable = {
      id: 'lumen',
      name: 'LUMEN',
      kind: 'star',
      radius: STAR_R * 1.3,
      getPosition: (t) => t.copy(this.starPos),
      info: LUMEN_INFO,
      interactLabel: 'OBSERVE',
      interactRange: 140,
      tone: 523.25,
      onInteract: () => this.engine.inspect(lumen, STAR_R * 6, STAR_R * 2.6, STAR_R * 20),
    };
    list.push(lumen);
    list.push({
      id: 'lattice',
      name: 'THE LATTICE',
      kind: 'structure',
      radius: 62,
      getPosition: (t) => t.copy(this.lattice.position),
      info: LATTICE_INFO,
      interactLabel: 'APPROACH',
      interactRange: 0,
      tone: 330,
      onInteract: () => this.approach(this.lattice.position, 160),
    });
    list.push({
      id: 'monoliths',
      name: 'MONOLITH ARRAY',
      kind: 'artifact',
      radius: 50,
      getPosition: (t) => t.copy(this.monoliths.position),
      info: MONOLITH_INFO,
      interactLabel: 'APPROACH',
      interactRange: 0,
      tone: 277.18,
      onInteract: () => this.approach(this.monoliths.position, 110),
    });
    list.push({
      id: 'anomaly-sigma',
      name: 'ANOMALY Σ',
      kind: 'anomaly',
      radius: 3.5,
      getPosition: (t) => t.copy(this.anomaly.position),
      info: ANOMALY_INFO,
      interactLabel: 'ENTER',
      interactRange: 40,
      tone: 740,
      isAvailable: () => this.anomalyVisible || this.engine.selection.selected?.id === 'anomaly-sigma',
      onInteract: () => {
        this.travelling = true;
        void this.engine.director.travel('unknown', 'portal');
      },
    });
    list.push({
      id: 'sgr-0',
      name: 'SGR-Ø',
      kind: 'singularity',
      radius: 22 * CORE_RS,
      getPosition: (t) => t.copy(CORE_POSITION),
      info: CORE_INFO,
      interactLabel: 'SET COURSE',
      interactRange: 0,
      tone: 110,
      onInteract: () => {
        this.travelling = true;
        void this.engine.director.travel('singularity', 'singularity');
      },
    });
    this.selectables = list;
  }

  getSelectables() {
    return this.selectables;
  }

  private approach(target: THREE.Vector3, standoff: number) {
    this.engine.approach(target, standoff);
  }

  focusZone(engine: Engine, zone: ZoneId) {
    if (zone === 'archive') this.approach(new THREE.Vector3(0, 0, 0), 300);
    else if (zone === 'cosmos') {
      if (engine.rig.mode === 'orbit') engine.releaseInspect();
      this.approach(SPAWN.clone().multiplyScalar(0.02), SPAWN.length());
    }
  }

  inspectById(_engine: Engine, id: string) {
    const s = this.selectables.find((x) => x.id === id);
    if (s?.onInteract) s.onInteract();
  }

  enter(engine: Engine, from: SceneId | null, kind: TransitionKind) {
    this.travelling = false;
    this.spatialOn = false;
    const rig = engine.rig;
    let pos = SPAWN.clone();
    let look = new THREE.Vector3(-30, -10, 0);
    if (engine.arrival.zone === 'archive') {
      pos = ARCHIVE_VIEW.clone();
      look = new THREE.Vector3(0, 0, 0);
    } else if (from === 'unknown' && kind === 'portal') {
      pos = ANOMALY_POS.clone().add(new THREE.Vector3(-70, 22, 90));
      look = MONOLITH_POS.clone();
    } else if (from === 'singularity') {
      pos = new THREE.Vector3(-260, 120, 520);
      look = new THREE.Vector3(0, 0, 0);
    }
    this.arrivalFocus = engine.arrival.focus ?? null;
    rig.mode = 'free';
    rig.position.copy(pos);
    rig.velocity.set(0, 0, 0);
    rig.camera.position.copy(pos);
    rig.lookAtNow(look);
    this.arrival = { pos, look, kind };
  }

  private arrival: { pos: THREE.Vector3; look: THREE.Vector3; kind: TransitionKind } | null = null;
  private arrivalFocus: string | null = null;

  entryCinematic(engine: Engine): Promise<void> {
    const a = this.arrival!;
    const rig = engine.rig;
    const fx = engine.pipeline.fx;
    const dir = a.look.clone().sub(a.pos).normalize();
    const start = a.pos.clone().addScaledVector(dir, -160);
    rig.mode = 'cinematic';
    rig.position.copy(start);
    rig.lookTarget.copy(a.look);
    rig.fov = 100;
    rig.roll = a.kind === 'enter' ? -0.5 : 0;
    return new Promise((resolve) => {
      gsap
        .timeline({
          onComplete: () => {
            rig.setFree();
            rig.zoomFov = this.config.camera.fov;
            if (this.arrivalFocus) this.inspectById(engine, this.arrivalFocus);
            this.arrivalFocus = null;
            resolve();
          },
        })
        .to(fx, { flash: 0, duration: 0.9, ease: 'power2.out' }, 0)
        .to(fx, { warp: 0, scramble: 0, chroma: 0, glitch: 0, invert: 0, fade: 0, duration: 2.2, ease: 'power3.out' }, 0)
        .to(rig.position, { x: a.pos.x, y: a.pos.y, z: a.pos.z, duration: 3.0, ease: 'expo.out' }, 0)
        .to(rig, { fov: this.config.camera.fov, roll: 0, duration: 3.0, ease: 'expo.out' }, 0);
    });
  }

  exitCinematic(engine: Engine, to: SceneId, kind: TransitionKind): Promise<void> {
    if (kind === 'singularity') return this.coreDive(engine);
    if (kind === 'portal' && to === 'unknown') return this.anomalyDive(engine);
    return engine.director.defaultExit();
  }

  /** Turn toward the galactic core, then fall into it. */
  private coreDive(engine: Engine): Promise<void> {
    const rig = engine.rig;
    const fx = engine.pipeline.fx;
    rig.beginCinematic();
    const look = rig.lookTarget.clone();
    const start = rig.position.clone();
    const dir = CORE_POSITION.clone().sub(start).normalize();
    const travel = Math.max(0, start.distanceTo(CORE_POSITION) - 260);
    const end = start.clone().addScaledVector(dir, travel);
    const proj = new THREE.Vector3();
    return new Promise((resolve) => {
      gsap
        .timeline({ onComplete: () => resolve() })
        .to(look, { x: CORE_POSITION.x, y: CORE_POSITION.y, z: CORE_POSITION.z, duration: 1.2, ease: 'power2.inOut', onUpdate: () => rig.lookTarget.copy(look) }, 0)
        .to(rig.position, {
          x: end.x,
          y: end.y,
          z: end.z,
          duration: 2.6,
          ease: 'power4.in',
          onUpdate: () => {
            proj.copy(CORE_POSITION).project(engine.camera);
            fx.warpX = THREE.MathUtils.clamp(proj.x * 0.5 + 0.5, 0.1, 0.9);
            fx.warpY = THREE.MathUtils.clamp(proj.y * 0.5 + 0.5, 0.1, 0.9);
          },
        }, 0.6)
        .to(rig, { fov: 105, duration: 2.6, ease: 'power3.in' }, 0.6)
        .to(fx, { warp: 1, scramble: 0.4, chroma: 0.012, duration: 2.4, ease: 'power3.in' }, 0.8)
        .to(fx, { flash: 1, duration: 0.5, ease: 'power2.in' }, 2.8)
        .add(() => {
          fx.warpX = 0.5;
          fx.warpY = 0.5;
        });
    });
  }

  private anomalyDive(engine: Engine): Promise<void> {
    const rig = engine.rig;
    const fx = engine.pipeline.fx;
    rig.beginCinematic();
    const look = rig.lookTarget.clone();
    const p = ANOMALY_POS;
    return new Promise((resolve) => {
      gsap
        .timeline({ onComplete: () => resolve() })
        .to(look, { x: p.x, y: p.y, z: p.z, duration: 0.8, ease: 'power2.inOut', onUpdate: () => rig.lookTarget.copy(look) }, 0)
        .to(rig.position, { x: p.x, y: p.y, z: p.z + 0.5, duration: 2.2, ease: 'power3.in' }, 0.4)
        .to(fx, { glitch: 1, scramble: 0.8, chroma: 0.02, duration: 2.0, ease: 'power2.in' }, 0.4)
        .to(fx, { invert: 1, duration: 0.25, ease: 'none' }, 2.1)
        .to(fx, { flash: 1, duration: 0.3 }, 2.35);
    });
  }

  getZone(engine: Engine): ZoneId {
    if (store.get().inspecting) {
      const s = engine.selection.selected;
      if (s && (s.kind === 'planet' || s.kind === 'star')) return 'archive';
    }
    return engine.camera.position.length() < 330 ? 'archive' : 'cosmos';
  }

  onQualityChange(q: QualitySettings) {
    this.galaxy.geometry.setDrawRange(0, Math.floor(this.galaxyCount * Math.max(0.35, q.particleScale)));
    this.nebulae.forEach((n) => n.setScale(Math.max(0.45, q.particleScale)));
    this.dust.setScale(q.particleScale);
    this.belt.setScale(Math.max(0.3, q.particleScale));
    this.core.material.uniforms.uSteps.value = Math.min(90, q.bhSteps);
  }

  update(dt: number, t: number, engine: Engine) {
    const cam = engine.camera;
    this.sky.position.copy(cam.position);

    for (let i = 0; i < this.planets.length; i++) {
      const p = this.planets[i];
      orbitPosition(p.def, t, p.position);
      p.root.position.copy(p.position);
      p.body.rotation.y += p.def.rotationSpeed * dt;
      const ring = p.tilt.getObjectByName('rings') as THREE.Mesh | undefined;
      if (ring) {
        (ring.material as THREE.ShaderMaterial).uniforms.uPlanetPos.value.copy(p.position);
        const n = (ring.material as THREE.ShaderMaterial).uniforms.uNormal.value as THREE.Vector3;
        n.set(0, 1, 0).applyQuaternion(p.tilt.getWorldQuaternion(new THREE.Quaternion()));
      }
      const phase = (((p.def.orbitPhase + t * p.def.orbitSpeed) / (Math.PI * 2)) % 1 + 1) % 1;
      (this.orbitPaths[i].material as THREE.ShaderMaterial).uniforms.uPhase.value = phase;
      if (this.spatialOn) engine.audio.moveSpatial(p.def.id, p.position);
    }
    this.star.rotation.y += dt * 0.02;

    this.lattice.rotation.y = (t * Math.PI * 2) / 314;
    this.lattice.rotation.x = Math.sin(t * 0.05) * 0.2;
    this.monoliths.position.y = MONOLITH_POS.y + Math.sin(t * 0.4) * 2.5;

    const flick = Math.sin(t * 1.3) + Math.sin(t * 3.7 + 1.1) * 0.6 + Math.sin(t * 17.0) * 0.25;
    this.anomalyVisible = flick > -0.35;
    (this.anomaly.material as THREE.ShaderMaterial).uniforms.uVisible.value = this.anomalyVisible ? 1 : 0;
    this.anomaly.rotation.set(t * 0.7, t * 1.1, t * 0.3);

    this.core.update(t);
    this.dust.update(cam);

    if (!this.spatialOn && engine.audio.running) {
      this.spatialOn = true;
      for (const p of this.planets) engine.audio.addSpatial(p.def.id, p.position, { freq: p.def.tone / 2, gain: 0.05, ref: p.def.radius * 3, rolloff: 1.4 });
      engine.audio.addSpatial('lumen', this.starPos, { freq: 130.81, gain: 0.04, ref: 40, rolloff: 1.2, noise: true });
      engine.audio.addSpatial('sgr', CORE_POSITION, { freq: 41.2, gain: 0.12, ref: 400, rolloff: 1 });
    }

    const phase = store.get().phase;
    const rig = engine.rig;
    if (phase === 'explore' && rig.mode === 'free') {
      // Cruise faster in open space; softly refuse to enter solid bodies.
      const fromStar = cam.position.length();
      rig.speedFactor = THREE.MathUtils.clamp(1 + (fromStar - 380) / 320, 1, 9);
      this.proximityCooldown -= dt;
      const bodies: { pos: THREE.Vector3; r: number; name: string }[] = [
        ...this.planets.map((p) => ({ pos: p.position, r: p.def.radius * 1.35, name: p.def.name })),
        { pos: this.starPos, r: STAR_R * 2.2, name: 'LUMEN' },
      ];
      for (const b of bodies) {
        const d = this.tmp.copy(rig.position).sub(b.pos);
        const len = d.length();
        if (len < b.r) {
          rig.position.copy(b.pos).addScaledVector(d.normalize(), b.r);
          rig.velocity.multiplyScalar(0.2);
          if (this.proximityCooldown <= 0) {
            pushToast(`PROXIMITY ALERT — ${b.name}`, 'warn', 2600);
            this.proximityCooldown = 4;
          }
        }
      }
      if (!this.travelling && cam.position.distanceTo(CORE_POSITION) < 760) {
        this.travelling = true;
        void engine.director.travel('singularity', 'singularity');
      }
    }

    const coreDist = cam.position.distanceTo(CORE_POSITION);
    (this.coreGlows[1].material as THREE.ShaderMaterial).uniforms.uIntensity.value = 0.2 + Math.max(0, 1 - coreDist / 3000) * 0.35;
    this.core.material.uniforms.uFlare.value = engine.selection.hovered?.id === 'sgr-0' ? 1 : 0.15;
  }

  dispose() {
    gsap.killTweensOf(this.engine.rig.position);
  }
}
