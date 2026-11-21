import { useSyncExternalStore } from 'react';
import type { QualityTier, RenderMode, SceneId, SelectionInfo, ZoneId } from './types';

type Listener = () => void;

/** Minimal external store: React reads it with useSyncExternalStore, the engine writes rarely. */
function createStore<T extends object>(initial: T) {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => state,
    set(patch: Partial<T> | ((s: T) => Partial<T>)) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      let changed = false;
      for (const k in p) {
        if ((p as T)[k as keyof T] !== state[k as keyof T]) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      state = { ...state, ...p };
      listeners.forEach((l) => l());
    },
    subscribe(l: Listener) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
}

export interface BootLine {
  id: number;
  text: string;
  status: 'run' | 'ok' | 'warn' | 'fail';
  detail?: string;
}

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'discovery' | 'warn';
}

export interface ZoneCard {
  key: number;
  index: string;
  name: string;
  subtitle: string;
}

export interface NexusState {
  phase: 'boot' | 'gateway' | 'explore' | 'transition';
  bootLines: BootLine[];
  bootProgress: number;
  bootError: string | null;
  bootDone: boolean;
  paused: boolean;
  scene: SceneId;
  zone: ZoneId;
  mode: RenderMode;
  quality: QualityTier;
  autoQuality: boolean;
  cellSize: number;
  audioOn: boolean;
  selected: SelectionInfo | null;
  inspecting: boolean;
  hint: { key: string; text: string } | null;
  explorerOpen: boolean;
  hudVisible: boolean;
  discovered: Record<ZoneId, boolean>;
  anomalies: string[];
  anomalyTotal: number;
  dimension: string | null;
  toasts: Toast[];
  zoneCard: ZoneCard | null;
  isTouch: boolean;
  gatewayStage: 0 | 1 | 2 | 3;
  inverted: boolean;
}

export const store = createStore<NexusState>({
  phase: 'boot',
  bootLines: [],
  bootProgress: 0,
  bootError: null,
  bootDone: false,
  paused: false,
  scene: 'gateway',
  zone: 'gateway',
  mode: 'ascii',
  quality: 'high',
  autoQuality: true,
  cellSize: 9,
  audioOn: true,
  selected: null,
  inspecting: false,
  hint: null,
  explorerOpen: false,
  hudVisible: true,
  discovered: { gateway: true, cosmos: false, archive: false, singularity: false, unknown: false },
  anomalies: [],
  anomalyTotal: 3,
  dimension: null,
  toasts: [],
  zoneCard: null,
  isTouch: false,
  gatewayStage: 0,
  inverted: false,
});

export function useNexus<S>(selector: (s: NexusState) => S): S {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()));
}

let toastId = 1;
export function pushToast(text: string, tone: Toast['tone'] = 'info', ms = 4200) {
  const id = toastId++;
  store.set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, tone }] }));
  window.setTimeout(() => {
    store.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  }, ms);
}

let bootId = 1;
export function bootLine(text: string): number {
  const id = bootId++;
  store.set((s) => ({ bootLines: [...s.bootLines, { id, text, status: 'run' }] }));
  return id;
}
export function bootLineDone(id: number, status: BootLine['status'], detail?: string) {
  store.set((s) => ({ bootLines: s.bootLines.map((l) => (l.id === id ? { ...l, status, detail } : l)) }));
}

/** Persisted preferences. Storage can be unavailable (sandboxed frames), so every access is guarded. */
export const prefs = {
  read<T>(key: string, fallback: T): T {
    try {
      const raw = window.localStorage.getItem(`nexus:${key}`);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  write(key: string, value: unknown) {
    try {
      window.localStorage.setItem(`nexus:${key}`, JSON.stringify(value));
    } catch {
      /* storage unavailable */
    }
  },
};
