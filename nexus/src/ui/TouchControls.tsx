import { useRef, useState } from 'react';
import { getEngine } from '../core/Engine';
import { store, useNexus } from '../core/store';

/** Virtual joystick + vertical/interact buttons for touch screens. */
export function TouchControls() {
  const touch = useNexus((s) => s.isTouch);
  const phase = useNexus((s) => s.phase);
  const paused = useNexus((s) => s.paused);
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const pid = useRef<number | null>(null);

  if (!touch || phase !== 'explore' || paused) return null;

  const move = (e: React.PointerEvent) => {
    const el = base.current;
    if (!el || pid.current !== e.pointerId) return;
    const r = el.getBoundingClientRect();
    const max = r.width / 2;
    let x = e.clientX - (r.left + max);
    let y = e.clientY - (r.top + max);
    const len = Math.hypot(x, y);
    if (len > max) {
      x = (x / len) * max;
      y = (y / len) * max;
    }
    setKnob({ x, y });
    const input = getEngine()?.input;
    if (input) {
      input.joystick.x = x / max;
      input.joystick.y = -y / max;
      input.touchBoost = len > max * 0.98;
    }
  };
  const end = () => {
    pid.current = null;
    setKnob({ x: 0, y: 0 });
    const input = getEngine()?.input;
    if (input) {
      input.joystick.x = 0;
      input.joystick.y = 0;
      input.touchBoost = false;
    }
  };
  const hold = (v: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation();
      const i = getEngine()?.input;
      if (i) i.touchVertical = v;
    },
    onPointerUp: () => {
      const i = getEngine()?.input;
      if (i) i.touchVertical = 0;
    },
    onPointerLeave: () => {
      const i = getEngine()?.input;
      if (i) i.touchVertical = 0;
    },
  });
  const btn = 'pointer-events-auto flex h-12 w-12 items-center justify-center border border-nx-grey/30 bg-nx-void/40 font-mono text-[11px] tracking-[0.1em] text-nx-white/80 active:border-nx-cyan active:text-nx-cyan';

  return (
    <div className="pointer-events-none fixed inset-0 z-30">
      <div
        ref={base}
        className="pointer-events-auto absolute bottom-8 left-8 h-32 w-32 rounded-full border border-nx-grey/25 bg-nx-void/30"
        onPointerDown={(e) => {
          e.stopPropagation();
          pid.current = e.pointerId;
          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
          move(e);
        }}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <div
          className="absolute left-1/2 top-1/2 h-12 w-12 rounded-full border border-nx-cyan/60 bg-nx-cyan/10"
          style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }}
        />
      </div>
      <div className="absolute bottom-8 right-6 grid grid-cols-2 gap-2">
        <button type="button" className={btn} {...hold(1)} aria-label="Ascend">
          ▲
        </button>
        <button type="button" className={btn} onClick={() => getEngine()?.selection.interact()} aria-label="Interact">
          E
        </button>
        <button type="button" className={btn} {...hold(-1)} aria-label="Descend">
          ▼
        </button>
        <button type="button" className={btn} onClick={() => store.set({ explorerOpen: true })} aria-label="Open index">
          ☰
        </button>
      </div>
    </div>
  );
}
