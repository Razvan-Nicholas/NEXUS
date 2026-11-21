import * as THREE from 'three';
import { clamp, formatSigned } from './math';
import type { Engine } from './Engine';

export type HudKey =
  | 'pos'
  | 'vel'
  | 'hdg'
  | 'fps'
  | 'dist'
  | 'bracket'
  | 'bracketName'
  | 'bracketDist'
  | 'arrow'
  | 'arrowLabel'
  | 'hover';

const _p = new THREE.Vector3();
const _f = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

/**
 * High-frequency HUD values are written straight into DOM nodes registered by React,
 * so the render loop never triggers React re-renders.
 */
export class HudBridge {
  private els: Partial<Record<HudKey, HTMLElement>> = {};
  private t = 0;
  private engine: Engine;

  constructor(engine: Engine) {
    this.engine = engine;
  }

  register(key: HudKey, el: HTMLElement | null) {
    if (el) this.els[key] = el;
    else delete this.els[key];
  }

  private show(el: HTMLElement | undefined, on: boolean) {
    if (!el) return;
    const v = on ? '1' : '0';
    if (el.style.opacity !== v) el.style.opacity = v;
  }

  update(dt: number) {
    const e = this.engine;
    const cam = e.camera;
    const els = this.els;
    this.t -= dt;
    const slow = this.t <= 0;
    if (slow) this.t = 0.1;

    if (slow) {
      const p = cam.position;
      if (els.pos) els.pos.textContent = `X${formatSigned(p.x)}  Y${formatSigned(p.y)}  Z${formatSigned(p.z)}`;
      if (els.vel) els.vel.textContent = `${e.rig.worldVelocity.length().toFixed(1).padStart(6, '0')} u/s`;
      if (els.hdg) {
        _e.setFromQuaternion(cam.quaternion, 'YXZ');
        const yaw = ((-THREE.MathUtils.radToDeg(_e.y) % 360) + 360) % 360;
        const pitch = THREE.MathUtils.radToDeg(_e.x);
        els.hdg.textContent = `${yaw.toFixed(0).padStart(3, '0')}° / ${pitch >= 0 ? '+' : '-'}${Math.abs(pitch).toFixed(0).padStart(2, '0')}°`;
      }
      if (els.fps) els.fps.textContent = `${Math.round(e.fps)} FPS · ${Math.round(e.pipeline.sceneW)}×${Math.round(e.pipeline.sceneH)}`;
    }

    const sel = e.selection.selected;
    const w = e.pipeline.cssW;
    const h = e.pipeline.cssH;
    if (!sel || !e.env) {
      this.show(els.bracket, false);
      this.show(els.arrow, false);
    } else {
      sel.getPosition(_p);
      const dist = cam.position.distanceTo(_p);
      if (slow) {
        const d = dist > 9999 ? `${(dist / 1000).toFixed(2)} ku` : `${dist.toFixed(1)} u`;
        if (els.dist) els.dist.textContent = d;
        if (els.bracketDist) els.bracketDist.textContent = d;
        if (els.arrowLabel) els.arrowLabel.textContent = `${sel.name} · ${d}`;
        if (els.bracketName && els.bracketName.textContent !== sel.name) els.bracketName.textContent = sel.name;
      }
      cam.getWorldDirection(_f);
      const ahead = _p.clone().sub(cam.position).dot(_f) > 0;
      const ndc = _p.clone().project(cam);
      const onScreen = ahead && Math.abs(ndc.x) < 1.02 && Math.abs(ndc.y) < 1.02;
      if (onScreen) {
        const sx = (ndc.x * 0.5 + 0.5) * w;
        const sy = (1 - (ndc.y * 0.5 + 0.5)) * h;
        const pr = (sel.radius / (dist * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2))) * (h / 2);
        const size = clamp(pr * 2.3, 34, Math.min(w, h) * 0.8);
        if (els.bracket) {
          els.bracket.style.transform = `translate3d(${(sx - size / 2).toFixed(1)}px, ${(sy - size / 2).toFixed(1)}px, 0)`;
          els.bracket.style.width = `${size.toFixed(1)}px`;
          els.bracket.style.height = `${size.toFixed(1)}px`;
        }
        this.show(els.bracket, true);
        this.show(els.arrow, false);
      } else {
        let dx = ndc.x;
        let dy = ndc.y;
        if (!ahead) {
          dx = -dx;
          dy = -dy;
        }
        const ang = Math.atan2(-dy, dx);
        const mx = w / 2 - 70;
        const my = h / 2 - 70;
        const k = Math.min(mx / Math.max(Math.abs(Math.cos(ang)), 1e-3), my / Math.max(Math.abs(Math.sin(ang)), 1e-3));
        const ax = w / 2 + Math.cos(ang) * k;
        const ay = h / 2 + Math.sin(ang) * k;
        if (els.arrow) {
          els.arrow.style.transform = `translate3d(${ax.toFixed(1)}px, ${ay.toFixed(1)}px, 0)`;
          const icon = els.arrow.firstElementChild as HTMLElement | null;
          if (icon) icon.style.transform = `translate(-50%, -50%) rotate(${ang}rad)`;
        }
        this.show(els.bracket, false);
        this.show(els.arrow, true);
      }
    }

    const hov = e.selection.hovered;
    if (els.hover) {
      if (hov && hov !== sel && e.input.pointer.inside) {
        if (els.hover.textContent !== hov.name) els.hover.textContent = hov.name;
        els.hover.style.transform = `translate3d(${e.input.pointer.x + 16}px, ${e.input.pointer.y + 14}px, 0)`;
        this.show(els.hover, true);
      } else this.show(els.hover, false);
    }
  }
}
