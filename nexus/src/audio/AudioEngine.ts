import * as THREE from 'three';
import type { AudioProfile } from '../core/types';

export type Sfx = 'ui' | 'hover' | 'select' | 'interact' | 'warp' | 'portal' | 'discover' | 'collapse' | 'mode' | 'enter' | 'glitch' | 'boot';

interface Layer {
  out: GainNode;
  sources: AudioScheduledSourceNode[];
}

interface SpatialVoice {
  panner: PannerNode;
  out: GainNode;
  sources: AudioScheduledSourceNode[];
}

const PENTA = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22];
const _f = new THREE.Vector3();
const _u = new THREE.Vector3();

/**
 * Fully procedural Web Audio: per-environment drones, cosmic wind, shimmer, spatial emitters
 * (HRTF panners that follow the camera) and synthesized interaction / portal sounds.
 * Nothing is created until the visitor interacts, and nothing plays while disabled.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  enabled = true;
  private master!: GainNode;
  private amb!: GainNode;
  private sfx!: GainNode;
  private verb!: ConvolverNode;
  private verbSend!: GainNode;
  private noise!: AudioBuffer;
  private profile: AudioProfile = 'gateway';
  private layer: Layer | null = null;
  private voices = new Map<string, SpatialVoice>();
  private shimmerIn = 3;
  private listenerT = 0;

  get running() {
    return !!this.ctx && this.ctx.state === 'running' && this.enabled;
  }

  /** Must be called from a user gesture. */
  async start() {
    if (!this.enabled) return;
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      this.build();
    }
    if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => {});
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(0.9, now, 0.6);
    if (!this.layer) this.setProfile(this.profile, true);
  }

  async setEnabled(on: boolean) {
    this.enabled = on;
    if (on) {
      await this.start();
      return;
    }
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(0, now, 0.15);
    window.setTimeout(() => {
      if (!this.enabled && this.ctx?.state === 'running') this.ctx.suspend().catch(() => {});
    }, 700);
  }

  private build() {
    const ctx = this.ctx!;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.4;
    this.master.connect(comp).connect(ctx.destination);
    this.amb = ctx.createGain();
    this.amb.gain.value = 0.8;
    this.amb.connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);
    this.verb = ctx.createConvolver();
    this.verb.buffer = this.impulse(4.2, 2.6);
    this.verbSend = ctx.createGain();
    this.verbSend.gain.value = 0.55;
    this.verbSend.connect(this.verb).connect(this.master);
    const len = ctx.sampleRate * 3;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
    }
  }

  private impulse(seconds: number, decay: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  private noiseSource(loop = true) {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = loop;
    src.loopStart = Math.random() * 2;
    return src;
  }

  private lfo(freq: number, depth: number, param: AudioParam, sources: AudioScheduledSourceNode[], type: OscillatorType = 'sine') {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = depth;
    o.connect(g).connect(param);
    o.start();
    sources.push(o);
  }

  setProfile(p: AudioProfile, force = false) {
    if (p === this.profile && this.layer && !force) return;
    this.profile = p;
    if (!this.ctx || !this.enabled) return;
    const old = this.layer;
    if (old) {
      const now = this.ctx.currentTime;
      old.out.gain.cancelScheduledValues(now);
      old.out.gain.setTargetAtTime(0, now, 0.8);
      window.setTimeout(() => {
        old.sources.forEach((s) => {
          try {
            s.stop();
          } catch {
            /* already stopped */
          }
        });
        old.out.disconnect();
      }, 4000);
    }
    this.layer = this.buildLayer(p);
  }

  private buildLayer(p: AudioProfile): Layer {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.amb);
    const send = ctx.createGain();
    send.gain.value = 0.35;
    out.connect(send).connect(this.verbSend);
    const sources: AudioScheduledSourceNode[] = [];
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.7;
    filter.connect(out);
    const voice = (type: OscillatorType, freq: number, gain: number, detune = 0, dest: AudioNode = filter) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(dest);
      o.start();
      sources.push(o);
      return { o, g };
    };
    const noiseBand = (type: BiquadFilterType, freq: number, q: number, gain: number) => {
      const n = this.noiseSource();
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = gain;
      n.connect(f).connect(g).connect(out);
      n.start();
      sources.push(n);
      return { f, g };
    };

    if (p === 'gateway') {
      filter.frequency.value = 760;
      this.lfo(0.045, 280, filter.frequency, sources);
      voice('sine', 55, 0.24);
      voice('triangle', 110, 0.07, -5);
      voice('sine', 164.81, 0.045, 3);
      voice('sine', 220, 0.03, 6);
      voice('sine', 329.63, 0.012);
      const n = noiseBand('bandpass', 520, 0.9, 0.05);
      this.lfo(0.07, 0.035, n.g.gain, sources);
    } else if (p === 'cosmos') {
      filter.frequency.value = 1100;
      this.lfo(0.03, 420, filter.frequency, sources);
      voice('sine', 73.42, 0.2);
      voice('triangle', 110, 0.06, -4);
      voice('sine', 146.83, 0.05, 3);
      voice('sine', 185, 0.035, -2);
      voice('triangle', 220, 0.022, -7);
      voice('sine', 277.18, 0.014, 5);
      const n = noiseBand('bandpass', 900, 0.5, 0.045);
      this.lfo(0.05, 500, n.f.frequency, sources);
      this.lfo(0.09, 0.03, n.g.gain, sources);
    } else if (p === 'singularity') {
      filter.frequency.value = 420;
      voice('sine', 32.7, 0.32);
      voice('sine', 49.4, 0.16);
      voice('triangle', 65.4, 0.06, -12);
      const t = voice('sawtooth', 98, 0.018, 0);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 420;
      bp.Q.value = 5;
      t.g.disconnect();
      t.g.connect(bp).connect(out);
      this.lfo(0.11, 260, bp.frequency, sources);
      noiseBand('lowpass', 160, 0.8, 0.16);
      this.lfo(0.24, 0.08, out.gain, sources);
    } else {
      filter.frequency.value = 1400;
      voice('sine', 61.74, 0.16);
      voice('triangle', 123.47, 0.045, 9);
      const a = voice('sawtooth', 92.5, 0.016, -15);
      const b = voice('sawtooth', 92.5, 0.016, 15);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 700;
      bp.Q.value = 6;
      a.g.disconnect();
      b.g.disconnect();
      a.g.connect(bp);
      b.g.connect(bp);
      bp.connect(out);
      this.lfo(0.13, 420, bp.frequency, sources, 'triangle');
      const hi = voice('sine', 1975.5, 0.006);
      this.lfo(5.2, 0.006, hi.g.gain, sources);
      noiseBand('highpass', 3200, 0.7, 0.012);
    }
    out.gain.setTargetAtTime(1, now, 1.2);
    this.shimmerIn = 2 + Math.random() * 3;
    return { out, sources };
  }

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private blip(freq: number, t: number, peak: number, dur: number, type: OscillatorType = 'sine', verb = 0.3, endFreq?: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = ctx.createGain();
    this.env(g, t, peak, 0.006, dur);
    o.connect(g).connect(this.sfx);
    if (verb > 0) {
      const s = ctx.createGain();
      s.gain.value = verb;
      g.connect(s).connect(this.verbSend);
    }
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private whoosh(t: number, dur: number, from: number, to: number, peak: number) {
    const ctx = this.ctx!;
    const n = this.noiseSource(false);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.4;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur * 0.8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f).connect(g).connect(this.sfx);
    const s = ctx.createGain();
    s.gain.value = 0.5;
    g.connect(s).connect(this.verbSend);
    n.start(t, Math.random());
    n.stop(t + dur + 0.1);
  }

  play(name: Sfx, opts: { tone?: number } = {}) {
    if (!this.running) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.01;
    const tone = opts.tone ?? 660;
    switch (name) {
      case 'hover':
        this.blip(2300, t, 0.012, 0.03, 'sine', 0);
        break;
      case 'ui':
        this.blip(1500, t, 0.035, 0.05, 'sine', 0.1, 900);
        break;
      case 'select':
        this.blip(tone, t, 0.05, 0.12, 'sine', 0.35);
        this.blip(tone * 1.5, t + 0.07, 0.04, 0.18, 'sine', 0.35);
        break;
      case 'interact':
        [1, 1.25, 1.5, 2].forEach((k, i) => this.blip(tone * k, t + i * 0.06, 0.04, 0.35, 'triangle', 0.45));
        break;
      case 'mode': {
        this.blip(320, t, 0.025, 0.2, 'square', 0.15, 1300);
        this.whoosh(t, 0.35, 4000, 9000, 0.03);
        break;
      }
      case 'glitch':
        for (let i = 0; i < 6; i++) this.blip(200 + Math.random() * 2400, t + i * 0.035, 0.02, 0.03, 'square', 0);
        break;
      case 'discover':
        [880, 1318.5, 1760, 2637].forEach((f, i) => this.blip(f, t + i * 0.09, 0.035, 2.4, 'sine', 0.8));
        break;
      case 'boot':
        this.blip(110, t, 0.12, 1.6, 'sine', 0.5, 55);
        this.blip(880, t + 0.05, 0.02, 1.2, 'sine', 0.7);
        break;
      case 'enter':
      case 'warp':
      case 'portal': {
        const dur = name === 'portal' ? 2.0 : 2.6;
        this.whoosh(t, dur, 180, name === 'portal' ? 5200 : 3600, 0.35);
        this.blip(60, t, 0.09, dur, 'sine', 0.3, name === 'portal' ? 900 : 640);
        this.blip(52, t + dur * 0.92, 0.28, 1.6, 'sine', 0.6, 28);
        break;
      }
      case 'collapse': {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(420, t);
        o.frequency.exponentialRampToValueAtTime(24, t + 4.4);
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.setValueAtTime(2600, t);
        f.frequency.exponentialRampToValueAtTime(90, t + 4.4);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.12, t + 3.6);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 4.6);
        o.connect(f).connect(g).connect(this.sfx);
        o.start(t);
        o.stop(t + 4.7);
        this.whoosh(t + 1.2, 3.4, 120, 60, 0.25);
        this.blip(40, t + 4.3, 0.35, 2.4, 'sine', 0.8, 22);
        break;
      }
    }
  }

  /** A looping positional emitter (planet hum, black hole rumble, portal whisper). */
  addSpatial(id: string, pos: THREE.Vector3, o: { freq: number; type?: OscillatorType; gain?: number; ref?: number; rolloff?: number; noise?: boolean }) {
    if (!this.ctx || this.voices.has(id)) return;
    const ctx = this.ctx;
    const panner = new PannerNode(ctx, {
      panningModel: 'HRTF',
      distanceModel: 'inverse',
      refDistance: o.ref ?? 20,
      maxDistance: 20000,
      rolloffFactor: o.rolloff ?? 1.2,
      positionX: pos.x,
      positionY: pos.y,
      positionZ: pos.z,
    });
    const out = ctx.createGain();
    out.gain.value = 0;
    out.gain.setTargetAtTime(o.gain ?? 0.05, ctx.currentTime, 1.5);
    const sources: AudioScheduledSourceNode[] = [];
    if (o.noise) {
      const n = this.noiseSource();
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = o.freq;
      f.Q.value = 3;
      n.connect(f).connect(out);
      n.start();
      sources.push(n);
      this.lfo(0.3 + Math.random() * 0.3, o.freq * 0.4, f.frequency, sources);
    } else {
      const a = ctx.createOscillator();
      a.type = o.type ?? 'sine';
      a.frequency.value = o.freq;
      const b = ctx.createOscillator();
      b.type = 'sine';
      b.frequency.value = o.freq * 2.001;
      const bg = ctx.createGain();
      bg.gain.value = 0.25;
      a.connect(out);
      b.connect(bg).connect(out);
      a.start();
      b.start();
      sources.push(a, b);
      this.lfo(0.2 + Math.random() * 0.4, 3, a.detune, sources);
    }
    out.connect(panner).connect(this.amb);
    this.voices.set(id, { panner, out, sources });
  }

  moveSpatial(id: string, pos: THREE.Vector3) {
    const v = this.voices.get(id);
    if (!v || !this.ctx) return;
    const t = this.ctx.currentTime;
    v.panner.positionX.setTargetAtTime(pos.x, t, 0.05);
    v.panner.positionY.setTargetAtTime(pos.y, t, 0.05);
    v.panner.positionZ.setTargetAtTime(pos.z, t, 0.05);
  }

  clearSpatial() {
    if (!this.ctx) {
      this.voices.clear();
      return;
    }
    const t = this.ctx.currentTime;
    this.voices.forEach((v) => {
      v.out.gain.setTargetAtTime(0, t, 0.4);
      window.setTimeout(() => {
        v.sources.forEach((s) => {
          try {
            s.stop();
          } catch {
            /* stopped */
          }
        });
        v.panner.disconnect();
      }, 2500);
    });
    this.voices.clear();
  }

  update(camera: THREE.Camera, dt: number) {
    if (!this.running) return;
    const ctx = this.ctx!;
    this.listenerT -= dt;
    if (this.listenerT <= 0) {
      this.listenerT = 1 / 30;
      const l = ctx.listener;
      const p = camera.position;
      camera.getWorldDirection(_f);
      _u.set(0, 1, 0).applyQuaternion(camera.quaternion);
      const t = ctx.currentTime;
      if (l.positionX) {
        l.positionX.setTargetAtTime(p.x, t, 0.03);
        l.positionY.setTargetAtTime(p.y, t, 0.03);
        l.positionZ.setTargetAtTime(p.z, t, 0.03);
        l.forwardX.setTargetAtTime(_f.x, t, 0.03);
        l.forwardY.setTargetAtTime(_f.y, t, 0.03);
        l.forwardZ.setTargetAtTime(_f.z, t, 0.03);
        l.upX.setTargetAtTime(_u.x, t, 0.03);
        l.upY.setTargetAtTime(_u.y, t, 0.03);
        l.upZ.setTargetAtTime(_u.z, t, 0.03);
      } else {
        (l as unknown as { setPosition: (x: number, y: number, z: number) => void }).setPosition(p.x, p.y, p.z);
        (l as unknown as { setOrientation: (...a: number[]) => void }).setOrientation(_f.x, _f.y, _f.z, _u.x, _u.y, _u.z);
      }
    }
    this.shimmerIn -= dt;
    if (this.shimmerIn <= 0) {
      this.shimmerIn = 2.5 + Math.random() * 5;
      const base = this.profile === 'singularity' ? 110 : this.profile === 'unknown' ? 233.08 : 440;
      const step = PENTA[Math.floor(Math.random() * PENTA.length)];
      const f = base * Math.pow(2, step / 12) * (Math.random() < 0.4 ? 2 : 1);
      const type: OscillatorType = this.profile === 'unknown' ? 'triangle' : 'sine';
      this.blip(f, ctx.currentTime + 0.02, this.profile === 'singularity' ? 0.02 : 0.012, 3.2, type, 0.9);
    }
  }
}
