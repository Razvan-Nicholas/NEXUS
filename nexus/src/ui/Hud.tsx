import { useCallback } from 'react';
import { getEngine } from '../core/Engine';
import type { HudKey } from '../core/HudBridge';
import { useNexus } from '../core/store';
import { ZONES } from '../core/zones';

/** Callback ref that hands the DOM node to the engine's HUD bridge (no React re-renders per frame). */
function useHud(key: HudKey) {
  return useCallback((el: HTMLElement | null) => getEngine()?.hud.register(key, el), [key]);
}

function Telemetry() {
  const pos = useHud('pos');
  const vel = useHud('vel');
  const hdg = useHud('hdg');
  return (
    <div className="font-mono text-[10px] leading-[1.95] tracking-[0.18em] text-nx-grey">
      <div className="flex gap-3">
        <span className="w-8 text-nx-grey/60">POS</span>
        <span ref={pos} className="tabular-nums text-nx-white/90" />
      </div>
      <div className="flex gap-3">
        <span className="w-8 text-nx-grey/60">VEL</span>
        <span ref={vel} className="tabular-nums text-nx-white/90" />
      </div>
      <div className="flex gap-3">
        <span className="w-8 text-nx-grey/60">HDG</span>
        <span ref={hdg} className="tabular-nums text-nx-white/90" />
      </div>
    </div>
  );
}

function Target() {
  const selected = useNexus((s) => s.selected);
  const dist = useHud('dist');
  return (
    <div className="text-right font-mono text-[10px] leading-[1.9] tracking-[0.2em] text-nx-grey">
      {selected ? (
        <>
          <div className="text-nx-grey/60">TARGET LOCK</div>
          <div className="font-display text-[14px] font-medium tracking-[0.2em] text-nx-white">{selected.name}</div>
          <div>{selected.designation}</div>
          <div>
            DIST <span ref={dist} className="tabular-nums text-nx-cyan" />
          </div>
        </>
      ) : (
        <div className="text-nx-grey/60">
          NO TARGET
          <span ref={dist} className="hidden" />
        </div>
      )}
    </div>
  );
}

function Bracket() {
  const box = useHud('bracket');
  const name = useHud('bracketName');
  const dist = useHud('bracketDist');
  const arrow = useHud('arrow');
  const arrowLabel = useHud('arrowLabel');
  const hover = useHud('hover');
  return (
    <>
      <div ref={box} className="nx-brackets absolute left-0 top-0 text-nx-cyan opacity-0 transition-opacity duration-200 will-change-transform">
        <i />
        <i />
        <i />
        <i />
        <div className="absolute left-full top-0 ml-3 whitespace-nowrap font-mono text-[10px] leading-[1.7] tracking-[0.22em]">
          <div ref={name} className="text-nx-white" />
          <div ref={dist} className="text-nx-cyan/80 tabular-nums" />
        </div>
      </div>
      <div ref={arrow} className="absolute left-0 top-0 opacity-0 transition-opacity duration-200 will-change-transform">
        <svg width="18" height="18" viewBox="0 0 18 18" className="absolute left-0 top-0 text-nx-cyan" style={{ transform: 'translate(-50%,-50%)' }}>
          <path d="M3 3 L15 9 L3 15" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </svg>
        <div ref={arrowLabel} className="absolute left-0 top-3 -translate-x-1/2 whitespace-nowrap font-mono text-[9px] tracking-[0.22em] text-nx-cyan/80" />
      </div>
      <div ref={hover} className="absolute left-0 top-0 whitespace-nowrap font-mono text-[10px] tracking-[0.25em] text-nx-white/80 opacity-0 transition-opacity duration-150" />
    </>
  );
}

function Hint() {
  const hint = useNexus((s) => s.hint);
  if (!hint) return null;
  return (
    <div key={hint.text} className="nx-rise flex flex-wrap items-center justify-center gap-3 text-center font-mono text-[10px] tracking-[0.28em] text-nx-grey">
      {hint.key && (
        <span className="flex h-6 min-w-6 items-center justify-center border border-nx-cyan/60 px-1.5 text-nx-cyan nx-glow">{hint.key}</span>
      )}
      <span className={hint.key ? 'text-nx-white' : ''}>{hint.text}</span>
    </div>
  );
}

function Corners() {
  const cls = 'absolute h-5 w-5 border-nx-grey/25';
  return (
    <>
      <div className={`${cls} left-3 top-3 border-l border-t`} />
      <div className={`${cls} right-3 top-3 border-r border-t`} />
      <div className={`${cls} bottom-3 left-3 border-b border-l`} />
      <div className={`${cls} bottom-3 right-3 border-b border-r`} />
    </>
  );
}

function FpsLine() {
  const ref = useHud('fps');
  const q = useNexus((s) => s.quality);
  return (
    <div className="font-mono text-[9px] tracking-[0.25em] text-nx-grey/60">
      Q:{q.toUpperCase()} · <span ref={ref} className="tabular-nums" />
    </div>
  );
}

export function Hud() {
  const phase = useNexus((s) => s.phase);
  const visible = useNexus((s) => s.hudVisible);
  const zone = useNexus((s) => s.zone);
  const scene = useNexus((s) => s.scene);
  const inspecting = useNexus((s) => s.inspecting);
  const anomalies = useNexus((s) => s.anomalies);
  const total = useNexus((s) => s.anomalyTotal);
  const dimension = useNexus((s) => s.dimension);
  const touch = useNexus((s) => s.isTouch);
  const shown = (phase === 'explore' || phase === 'transition') && visible;
  const z = ZONES[zone];

  return (
    <div className={`nx-legible pointer-events-none fixed inset-0 z-20 transition-opacity duration-700 ${shown ? 'opacity-100' : 'opacity-0'}`}>
      <Corners />
      <div className="absolute left-5 top-14 max-w-[70vw] sm:left-6 sm:top-6 sm:max-w-[60vw]">
        <div className="font-mono text-[10px] tracking-[0.35em] text-nx-grey/70">{z.index} — ENVIRONMENT</div>
        <div className="mt-1 font-display text-[15px] font-medium uppercase tracking-[0.24em] text-nx-white">{z.name}</div>
        <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-nx-grey">
          {z.subtitle}
          {scene === 'unknown' && dimension ? (
            <>
              {' · DIMENSION '}
              <span className="normal-case text-nx-white/80">{dimension}</span>
            </>
          ) : null}
        </div>
        {scene === 'unknown' && (
          <div className="mt-2 font-mono text-[10px] tracking-[0.3em] text-nx-magenta">
            ANOMALIES {anomalies.length}/{total}
          </div>
        )}
      </div>

      <div className="absolute right-6 top-[3.6rem] hidden text-right sm:block">
        <FpsLine />
      </div>

      {!touch && (
        <div className="absolute bottom-6 left-6">
          <Telemetry />
        </div>
      )}

      {!touch && (
        <div className="absolute bottom-16 right-6">
          <Target />
        </div>
      )}

      <div className={`absolute left-1/2 -translate-x-1/2 ${touch ? 'top-[9.5rem] w-[88vw]' : 'bottom-7'}`}>
        <Hint />
      </div>

      {!inspecting && (
        <div className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 opacity-40">
          <div className="absolute left-1/2 top-0 h-full w-px bg-nx-white/70" />
          <div className="absolute left-0 top-1/2 h-px w-full bg-nx-white/70" />
        </div>
      )}

      <Bracket />
    </div>
  );
}
