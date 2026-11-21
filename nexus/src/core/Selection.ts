import * as THREE from 'three';
import { store } from './store';
import type { Engine } from './Engine';
import type { Selectable } from './types';

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _c = new THREE.Vector3();
const _ndc = new THREE.Vector2();
const _ray = new THREE.Raycaster();

/** Picking (analytic ray–sphere, with a minimum angular size), hover, proximity and hints. */
export class SelectionSystem {
  private engine: Engine;
  list: Selectable[] = [];
  selected: Selectable | null = null;
  hovered: Selectable | null = null;
  proximity: Selectable | null = null;
  private hintTimer = 0;
  private hoverDirty = false;

  constructor(engine: Engine) {
    this.engine = engine;
  }

  setSelectables(list: Selectable[]) {
    this.list = list;
    this.select(null);
    this.hovered = null;
    this.proximity = null;
  }

  private available(s: Selectable) {
    return !s.isAvailable || s.isAvailable();
  }

  pick(cssX: number, cssY: number): Selectable | null {
    const cam = this.engine.camera;
    const w = this.engine.pipeline.cssW;
    const h = this.engine.pipeline.cssH;
    _ndc.set((cssX / w) * 2 - 1, -(cssY / h) * 2 + 1);
    _ray.setFromCamera(_ndc, cam);
    _o.copy(_ray.ray.origin);
    _d.copy(_ray.ray.direction);
    let best: Selectable | null = null;
    let bestT = Infinity;
    const minAngle = Math.tan(THREE.MathUtils.degToRad(1.6));
    for (const s of this.list) {
      if (!this.available(s)) continue;
      s.getPosition(_c);
      const toC = _c.sub(_o);
      const t = toC.dot(_d);
      if (t <= 0) continue;
      const dist = toC.length();
      const r = Math.max(s.radius, dist * minAngle);
      const perp2 = toC.lengthSq() - t * t;
      if (perp2 > r * r) continue;
      const hit = t - Math.sqrt(Math.max(r * r - perp2, 0));
      if (hit < bestT) {
        bestT = hit;
        best = s;
      }
    }
    return best;
  }

  select(s: Selectable | null) {
    if (this.selected === s) return;
    this.selected = s;
    store.set({ selected: s ? s.info : null });
    if (s) this.engine.audio.play('select', { tone: s.tone });
    this.hintTimer = 0;
  }

  clickAt(cssX: number, cssY: number) {
    const s = this.pick(cssX, cssY);
    if (s) {
      if (this.selected === s && s.onInteract && s.kind !== 'planet') return;
      this.select(s);
    } else if (this.engine.rig.mode !== 'orbit') {
      this.select(null);
    }
  }

  markHoverDirty() {
    this.hoverDirty = true;
  }

  distanceTo(s: Selectable) {
    return this.engine.camera.position.distanceTo(s.getPosition(_c));
  }

  interact() {
    const t = this.selected ?? this.proximity;
    if (!t || !t.onInteract) return false;
    if (!this.available(t)) return false;
    this.engine.audio.play('interact', { tone: t.tone });
    t.onInteract();
    return true;
  }

  update(dt: number) {
    const e = this.engine;
    const input = e.input;
    if (this.selected && !this.available(this.selected)) this.select(null);

    if (this.hoverDirty && input.pointer.inside && input.pointer.type === 'mouse' && !input.pointer.down) {
      this.hoverDirty = false;
      const h = this.pick(input.pointer.x, input.pointer.y);
      if (h !== this.hovered) {
        this.hovered = h;
        e.canvas.style.cursor = h ? 'pointer' : '';
        if (h) e.audio.play('hover');
      }
    } else if (!input.pointer.inside && this.hovered) {
      this.hovered = null;
      e.canvas.style.cursor = '';
    }

    this.hintTimer -= dt;
    if (this.hintTimer > 0) return;
    this.hintTimer = 0.2;

    let nearest: Selectable | null = null;
    let nearestD = Infinity;
    for (const s of this.list) {
      if (!s.interactRange || !s.onInteract || !this.available(s)) continue;
      const d = this.distanceTo(s);
      if (d < s.interactRange && d < nearestD) {
        nearestD = d;
        nearest = s;
      }
    }
    this.proximity = nearest;

    const st = store.get();
    if (st.phase !== 'explore') {
      store.set({ hint: null });
      return;
    }
    const target = this.selected ?? this.proximity;
    if (target && target.onInteract && target.interactLabel) {
      const label = st.inspecting && target.kind === 'planet' ? null : `${target.interactLabel} ${target.name}`;
      if (label) {
        const cur = st.hint;
        if (!cur || cur.text !== label) store.set({ hint: { key: 'E', text: label } });
        return;
      }
    }
    let generic = st.inspecting ? 'DRAG TO ORBIT · WHEEL TO ZOOM · ESC TO RELEASE' : e.env?.config.hint ?? '';
    if (st.isTouch) generic = generic.replace('WASD TO FLY', 'STICK TO FLY').replace('CLICK', 'TAP').replace('WHEEL TO ZOOM', 'PINCH TO ZOOM').replace(' · ESC TO RELEASE', '');
    if (!st.hint || st.hint.text !== generic) store.set({ hint: generic ? { key: '', text: generic } : null });
  }
}
