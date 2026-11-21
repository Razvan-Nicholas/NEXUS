import gsap from 'gsap';
import { pushToast, store } from './store';
import type { Engine } from './Engine';
import type { SceneId, TransitionKind, ZoneId } from './types';

export interface ArrivalOptions {
  zone?: ZoneId;
  focus?: string;
  dimension?: string;
}

/**
 * Orchestrates environment changes: departure cinematic (ends with the screen covered),
 * lazy load + shader compile of the destination in parallel, swap, arrival cinematic.
 */
export class TransitionDirector {
  busy = false;
  private engine: Engine;

  constructor(engine: Engine) {
    this.engine = engine;
  }

  async travel(target: SceneId, kind: TransitionKind, opts: ArrivalOptions = {}) {
    const e = this.engine;
    if (this.busy) return;
    this.busy = true;
    store.set({ phase: 'transition', explorerOpen: false, inspecting: false, hint: null, paused: false });
    e.selection.select(null);
    e.input.locked = true;
    e.audio.play(kind === 'portal' ? 'portal' : kind === 'horizon' ? 'collapse' : kind === 'enter' ? 'enter' : 'warp');

    const from = e.env;
    const loading = e.loadEnvironment(target);
    loading.catch(() => {});
    try {
      if (from?.exitCinematic) await from.exitCinematic(e, target, kind);
      else await this.defaultExit();
      const next = await loading;
      e.arrival = opts;
      e.swapEnvironment(next, from?.id ?? null, kind);
      if (next.entryCinematic) await next.entryCinematic(e, from?.id ?? null, kind);
      else await this.defaultEntry();
    } catch (err) {
      console.error(err);
      pushToast('TRANSIT FAILED — SIGNAL LOST', 'warn');
      await this.defaultEntry();
      if (e.rig.mode === 'cinematic') e.rig.setFree();
    } finally {
      e.input.locked = false;
      this.busy = false;
      store.set({ phase: e.env?.id === 'gateway' ? 'gateway' : 'explore' });
    }
  }

  /** Generic jump: accelerate along the view axis into a glyph storm and white-out. */
  defaultExit(): Promise<void> {
    const e = this.engine;
    const rig = e.rig;
    const fx = e.pipeline.fx;
    rig.beginCinematic();
    const fwd = rig.forward;
    const p = rig.position.clone();
    const span = 260;
    return new Promise((resolve) => {
      gsap
        .timeline({ onComplete: () => resolve() })
        .to(rig.position, { x: p.x + fwd.x * span, y: p.y + fwd.y * span, z: p.z + fwd.z * span, duration: 1.7, ease: 'power3.in' }, 0)
        .to(rig.lookTarget, { x: p.x + fwd.x * span * 3, y: p.y + fwd.y * span * 3, z: p.z + fwd.z * span * 3, duration: 1.7, ease: 'power3.in' }, 0)
        .to(rig, { fov: Math.min(rig.fov + 40, 120), duration: 1.7, ease: 'power2.in' }, 0)
        .to(fx, { warp: 1, scramble: 0.55, chroma: 0.012, duration: 1.5, ease: 'power2.in' }, 0)
        .to(fx, { flash: 1, duration: 0.4, ease: 'power1.in' }, 1.35);
    });
  }

  /** Generic arrival: release the white-out and the warp. */
  defaultEntry(): Promise<void> {
    const fx = this.engine.pipeline.fx;
    return new Promise((resolve) => {
      gsap
        .timeline({ onComplete: () => resolve() })
        .to(fx, { flash: 0, duration: 0.8, ease: 'power2.out' }, 0)
        .to(fx, { warp: 0, scramble: 0, chroma: 0, glitch: 0, fade: 0, duration: 1.8, ease: 'power3.out' }, 0.1);
    });
  }
}
