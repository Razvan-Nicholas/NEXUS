import { getEngine } from '../core/Engine';
import { useNexus } from '../core/store';
import { ScrambleText } from './ScrambleText';

export function GatewayOverlay() {
  const phase = useNexus((s) => s.phase);
  const stage = useNexus((s) => s.gatewayStage);
  const visible = phase === 'gateway';

  return (
    <div className={`nx-legible pointer-events-none fixed inset-0 z-20 transition-opacity duration-700 ${visible ? 'opacity-100' : 'opacity-0'}`}>
      <div className="absolute left-5 top-5 hidden font-mono text-[10px] leading-[1.9] tracking-[0.3em] text-nx-grey sm:left-7 sm:top-6 sm:block">
        <div className="text-nx-white/80">NEXUS // 01 · GATEWAY</div>
        <div className="hidden sm:block">SIGNAL 0x7F3A·C91E · ORIGIN UNRESOLVED</div>
      </div>

      <div className="absolute inset-x-0 bottom-[8vh] flex flex-col items-center px-4 text-center">
        <h1 className="mr-[-0.34em] font-display text-[clamp(60px,12.5vw,190px)] font-semibold leading-[0.82] tracking-[0.34em] text-nx-white mix-blend-difference">
          <ScrambleText text="NEXUS" play={visible && stage >= 1} duration={1400} />
        </h1>
        <p className="mr-[-0.55em] mt-5 font-mono text-[10px] tracking-[0.55em] text-nx-grey sm:text-xs">
          <ScrambleText text="BEYOND THE DIGITAL VOID" play={visible && stage >= 2} duration={1100} />
        </p>
        <button
          type="button"
          onClick={() => getEngine()?.enterNexus()}
          className={`nx-enter nx-brackets mt-10 px-7 py-4 font-mono text-[11px] tracking-[0.45em] text-nx-cyan transition-opacity duration-1000 sm:text-xs ${
            visible && stage >= 3 ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <i />
          <i />
          <i />
          <i />
          <span className="nx-glow">ENTER THE NEXUS</span>
        </button>
        <div className={`mt-4 font-mono text-[9px] tracking-[0.4em] text-nx-grey/70 transition-opacity duration-1000 ${visible && stage >= 3 ? 'opacity-100' : 'opacity-0'}`}>
          PRESS ENTER ↵
        </div>
      </div>

      <div className="absolute bottom-6 left-5 hidden font-mono text-[10px] tracking-[0.3em] text-nx-grey/80 sm:left-7 md:block">
        REALITY IS JUST ANOTHER RENDERING.
      </div>
    </div>
  );
}
