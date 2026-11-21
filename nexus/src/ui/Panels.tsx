import { useEffect, useRef, useState } from 'react';
import { getEngine } from '../core/Engine';
import { store, useNexus } from '../core/store';
import type { ZoneId } from '../core/types';
import { ZONE_ORDER, ZONES } from '../core/zones';
import { AudioToggle, ControlList, DensitySlider, ModeSwitch, QualityPicker } from './Controls';
import { ScrambleText } from './ScrambleText';

/** Contextual information for the selected object. */
export function InfoPanel() {
  const sel = useNexus((s) => s.selected);
  const inspecting = useNexus((s) => s.inspecting);
  const phase = useNexus((s) => s.phase);
  const explorer = useNexus((s) => s.explorerOpen);
  const hint = useNexus((s) => s.hint);
  const visible = !!sel && phase === 'explore' && !explorer;
  const [shown, setShown] = useState(sel);
  useEffect(() => {
    if (sel) setShown(sel);
  }, [sel]);
  const info = sel ?? shown;
  if (!info) return null;
  const engine = getEngine();
  const target = engine?.selection.selected;
  const canAct = !!target?.onInteract && !(inspecting && info.kind === 'planet');
  const actLabel = hint?.key === 'E' ? hint.text.replace(info.name, '').trim() : target?.interactLabel ?? 'INTERACT';

  return (
    <aside
      className={`nx-panel pointer-events-auto fixed z-30 p-5 transition-all duration-500 max-sm:inset-x-3 max-sm:bottom-44 max-sm:max-h-[42vh] max-sm:overflow-y-auto sm:right-6 sm:top-1/2 sm:w-[340px] sm:-translate-y-1/2 ${
        visible ? 'opacity-100 sm:translate-x-0' : 'pointer-events-none opacity-0 max-sm:translate-y-6 sm:translate-x-6'
      }`}
      aria-hidden={!visible}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-mono text-[9px] tracking-[0.35em] text-nx-grey/70">{info.kind.toUpperCase()}</div>
          <h2 className="mt-1 font-display text-2xl font-semibold tracking-[0.12em] text-nx-white" style={info.accent ? { textShadow: `0 0 24px ${info.accent}66` } : undefined}>
            <ScrambleText key={info.id} text={info.name} duration={700} />
          </h2>
          <div className="mt-1 font-mono text-[10px] tracking-[0.25em]" style={{ color: info.accent ?? '#00E5FF' }}>
            {info.designation}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            if (store.get().inspecting) engine?.releaseInspect();
            engine?.selection.select(null);
          }}
          className="font-mono text-[10px] tracking-[0.2em] text-nx-grey hover:text-nx-white"
          aria-label="Close"
        >
          ESC ✕
        </button>
      </div>
      <div className="nx-hair my-4" />
      {info.stats && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 font-mono text-[10px] tracking-[0.16em]">
          {info.stats.map((s) => (
            <div key={s.label} className="contents">
              <dt className="text-nx-grey/80">{s.label.toUpperCase()}</dt>
              <dd className="text-right text-nx-white/90">{s.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {info.description && <p className="mt-4 font-sans text-[12.5px] leading-relaxed text-nx-grey">{info.description}</p>}
      <div className="mt-5 flex flex-wrap gap-2">
        {canAct && (
          <button
            type="button"
            onClick={() => engine?.selection.interact()}
            className="flex items-center gap-2 border border-nx-cyan/50 px-3 py-2 font-mono text-[10px] tracking-[0.28em] text-nx-cyan transition-colors hover:bg-nx-cyan/10"
          >
            <span className="border border-nx-cyan/50 px-1">E</span>
            {actLabel || 'INTERACT'}
          </button>
        )}
        {inspecting && info.kind === 'planet' && (
          <button
            type="button"
            onClick={() => engine?.releaseInspect()}
            className="border border-nx-grey/30 px-3 py-2 font-mono text-[10px] tracking-[0.28em] text-nx-grey transition-colors hover:text-nx-white"
          >
            RELEASE ORBIT
          </button>
        )}
      </div>
    </aside>
  );
}

const PLANETS: { id: string; name: string }[] = [
  { id: 'nova-01', name: 'NOVA-01' },
  { id: 'void-07', name: 'VOID-07' },
  { id: 'echo-12', name: 'ECHO-12' },
  { id: 'halo-21', name: 'HALO-21' },
];

/** TAB: index of environments + render settings + controls. */
export function Explorer() {
  const open = useNexus((s) => s.explorerOpen);
  const zone = useNexus((s) => s.zone);
  const discovered = useNexus((s) => s.discovered);
  const panelRef = useRef<HTMLDivElement>(null);

  return (
    <div
      className={`fixed inset-0 z-40 flex items-center justify-center bg-nx-void/70 backdrop-blur-sm transition-opacity duration-500 ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) store.set({ explorerOpen: false });
      }}
      aria-hidden={!open}
    >
      <div ref={panelRef} className="grid max-h-[88vh] w-[min(1080px,94vw)] gap-10 overflow-y-auto p-2 md:grid-cols-[1.25fr_1fr]">
        <section>
          <div className="mb-6 flex items-baseline justify-between font-mono text-[10px] tracking-[0.35em] text-nx-grey">
            <span>NEXUS INDEX</span>
            <span className="text-nx-grey/60">TAB TO CLOSE</span>
          </div>
          <ol className="space-y-1">
            {ZONE_ORDER.map((id) => (
              <ZoneRow key={id} id={id} current={zone === id} charted={discovered[id]} />
            ))}
          </ol>
          <div className="mt-8 font-mono text-[10px] tracking-[0.35em] text-nx-grey">ARCHIVE BODIES</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {PLANETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => getEngine()?.inspectPlanet(p.id)}
                className="border border-nx-grey/20 px-3 py-2 font-mono text-[10px] tracking-[0.25em] text-nx-grey transition-colors hover:border-nx-cyan/50 hover:text-nx-cyan"
              >
                {p.name}
              </button>
            ))}
          </div>
        </section>
        <section className="nx-panel space-y-6 p-6">
          <div>
            <div className="mb-2 font-mono text-[10px] tracking-[0.35em] text-nx-grey">RENDERING</div>
            <ModeSwitch />
          </div>
          <div>
            <div className="mb-2 font-mono text-[10px] tracking-[0.35em] text-nx-grey">QUALITY</div>
            <QualityPicker />
          </div>
          <DensitySlider />
          <div>
            <div className="mb-2 font-mono text-[10px] tracking-[0.35em] text-nx-grey">AUDIO</div>
            <AudioToggle />
          </div>
          <div>
            <div className="mb-3 font-mono text-[10px] tracking-[0.35em] text-nx-grey">CONTROLS</div>
            <ControlList />
          </div>
        </section>
      </div>
    </div>
  );
}

function ZoneRow({ id, current, charted }: { id: ZoneId; current: boolean; charted: boolean }) {
  const z = ZONES[id];
  return (
    <li>
      <button
        type="button"
        disabled={current}
        onClick={() => getEngine()?.warpTo(id)}
        className={`group grid w-full grid-cols-[3rem_1fr_auto] items-baseline gap-4 border-b border-nx-grey/10 py-4 text-left transition-colors ${
          current ? 'cursor-default' : 'hover:bg-nx-white/[0.03]'
        }`}
      >
        <span className="font-mono text-[11px] tracking-[0.2em] text-nx-grey/70">{z.index}</span>
        <span>
          <span className={`block font-display text-[clamp(20px,2.6vw,30px)] font-medium tracking-[0.08em] ${current ? 'text-nx-cyan nx-glow' : 'text-nx-white group-hover:text-nx-cyan'}`}>
            {z.name}
          </span>
          <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[0.22em] text-nx-grey">{charted ? z.subtitle : 'Signal unresolved'}</span>
        </span>
        <span className="font-mono text-[10px] tracking-[0.28em]">
          {current ? (
            <span className="text-nx-cyan">HERE</span>
          ) : (
            <span className="text-nx-grey transition-colors group-hover:text-nx-cyan">{charted ? 'WARP →' : 'UNCHARTED →'}</span>
          )}
        </span>
      </button>
    </li>
  );
}

export function PauseMenu() {
  const paused = useNexus((s) => s.paused);
  return (
    <div className={`fixed inset-0 z-40 flex items-center justify-center bg-nx-void/75 backdrop-blur-md transition-opacity duration-500 ${paused ? 'opacity-100' : 'pointer-events-none opacity-0'}`} aria-hidden={!paused}>
      <div className="w-[min(520px,90vw)] text-center">
        <div className="font-mono text-[10px] tracking-[0.45em] text-nx-grey">SIMULATION SUSPENDED</div>
        <div className="mt-3 font-display text-4xl font-semibold tracking-[0.3em] text-nx-white sm:text-5xl">PAUSED</div>
        <div className="mt-8 flex justify-center gap-3">
          <button type="button" onClick={() => getEngine()?.setPaused(false)} className="border border-nx-cyan/60 px-5 py-3 font-mono text-[10px] tracking-[0.35em] text-nx-cyan hover:bg-nx-cyan/10">
            RESUME
          </button>
          <button
            type="button"
            onClick={() => {
              getEngine()?.setPaused(false);
              store.set({ explorerOpen: true });
            }}
            className="border border-nx-grey/30 px-5 py-3 font-mono text-[10px] tracking-[0.35em] text-nx-grey hover:text-nx-white"
          >
            OPEN INDEX
          </button>
        </div>
        <div className="mx-auto mt-10 w-fit text-left">
          <ControlList />
        </div>
      </div>
    </div>
  );
}

export function ZoneCardView() {
  const card = useNexus((s) => s.zoneCard);
  if (!card) return null;
  return (
    <div key={card.key} className="nx-card pointer-events-none fixed left-6 top-1/2 z-30 -translate-y-1/2 sm:left-10">
      <div className="font-mono text-[11px] tracking-[0.45em] text-nx-cyan">{card.index}</div>
      <div className="mt-2 font-display text-[clamp(34px,6vw,76px)] font-semibold uppercase leading-[0.95] tracking-[0.1em] text-nx-white">
        <ScrambleText text={card.name} duration={1100} />
      </div>
      <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.35em] text-nx-grey">{card.subtitle}</div>
    </div>
  );
}

export function Toasts() {
  const toasts = useNexus((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-6 z-40 flex flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`nx-rise nx-panel px-4 py-2 font-mono text-[10px] tracking-[0.3em] ${t.tone === 'discovery' ? 'text-nx-magenta' : t.tone === 'warn' ? 'text-nx-white/80' : 'text-nx-cyan'}`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
