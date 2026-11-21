import { useEffect, useState } from 'react';
import { useNexus } from '../core/store';
import { ScrambleText } from './ScrambleText';

const SPIN = ['|', '/', '-', '\\'];

function Spinner() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setI((v) => (v + 1) % SPIN.length), 90);
    return () => window.clearInterval(id);
  }, []);
  return <span className="text-nx-cyan">{SPIN[i]}</span>;
}

function Bar({ value }: { value: number }) {
  const n = 36;
  const filled = Math.round(value * n);
  return (
    <div className="mt-6 flex items-center gap-3 text-nx-grey">
      <span className="whitespace-pre">
        [<span className="text-nx-cyan">{'#'.repeat(filled)}</span>
        <span className="text-nx-grey/40">{'·'.repeat(n - filled)}</span>]
      </span>
      <span className="tabular-nums text-nx-white/80">{String(Math.round(value * 100)).padStart(3, '0')}%</span>
    </div>
  );
}

/** Loading sequence: every line is a real initialization step reported by the engine. */
export function Boot() {
  const lines = useNexus((s) => s.bootLines);
  const progress = useNexus((s) => s.bootProgress);
  const done = useNexus((s) => s.bootDone);
  const error = useNexus((s) => s.bootError);
  const phase = useNexus((s) => s.phase);
  const visible = phase === 'boot' || !!error;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-nx-void transition-opacity duration-[1400ms] ${visible ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      aria-live="polite"
    >
      <div className="w-[min(600px,88vw)] font-mono text-[10.5px] leading-[2] tracking-[0.08em] text-nx-grey sm:text-[11px]">
        <div className="mb-7 flex justify-between text-nx-white/75">
          <span className="tracking-[0.3em]">NEXUS KERNEL 1.0</span>
          <span className="tracking-[0.3em] text-nx-grey">COLD START</span>
        </div>
        {lines.map((l) => (
          <div key={l.id} className="nx-rise flex items-baseline gap-3">
            <span className="text-nx-purple">&gt;</span>
            <span className="min-w-0 flex-1 truncate text-nx-white/85">{l.text}</span>
            <span className="hidden max-w-[44%] truncate text-right text-nx-grey/70 sm:inline">{l.detail}</span>
            <span className="w-9 text-right">
              {l.status === 'run' ? (
                <Spinner />
              ) : l.status === 'ok' ? (
                <span className="text-nx-cyan">OK</span>
              ) : (
                <span className="text-nx-magenta">FAIL</span>
              )}
            </span>
          </div>
        ))}
        <Bar value={progress} />
        <div className="mt-12 h-8 text-center font-display text-[13px] font-medium tracking-[0.42em] text-nx-white sm:text-base">
          {done && !error && <ScrambleText text="REALITY IS JUST ANOTHER RENDERING." duration={1300} />}
        </div>
        {error && (
          <div className="mt-2 border border-nx-magenta/40 p-4 text-nx-magenta">
            <div className="mb-1 tracking-[0.3em]">RENDER FAULT</div>
            <div className="text-nx-white/80">{error}</div>
            <div className="mt-2 text-nx-grey">NEXUS needs a browser with WebGL2 enabled. Try a recent desktop browser with hardware acceleration on.</div>
          </div>
        )}
      </div>
    </div>
  );
}
