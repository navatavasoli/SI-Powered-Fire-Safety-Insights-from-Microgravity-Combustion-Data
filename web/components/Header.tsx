import { modelLabel, type Health } from "@/lib/api";

/** CRASSUS shield-and-flame mark (keyed from design/CRASSUS Shield and Flame Logo.png). */
export function Logo() {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/crassus-mark.png" alt="" aria-hidden="true" className="brand-mark" width={256} height={307} />;
}

export default function Header({ health, nInv, onAbout }: { health: Health | null; nInv: number; onAbout: () => void }) {
  const copilot = health?.llm ? modelLabel(health.llm) : health ? "retrieval-only" : "offline";
  return (
    <header className="hdr">
      <div className="brand">
        <Logo />
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
          <span className="brand-name">CRASSUS</span>
          <span className="brand-sub">Spacecraft Fire Intelligence</span>
        </div>
      </div>
      <div className="vsep" />
      <div className="hdr-meta">
        <span><span className="k">DATASET</span><span className="v">NASA PSI · Combustion</span><span className="chip">{nInv || "…"} INVESTIGATIONS</span></span>
        <span><span className="dot" /><span className="k">DATA</span><span className="v">Local cache</span></span>
        <span><span className="k">MODEL</span><span className="v">Reduced-order tier 2</span><span className="chip">NOT VALIDATED</span></span>
        <span><span className="k">COPILOT</span><span className="v">{copilot}</span></span>
      </div>
      <div className="hdr-actions">
        <button className="ghost" onClick={onAbout} title="Model documentation">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4z" /><path d="M20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z" /></svg>Docs
        </button>
        <a className="ghost" href="https://psi.nasa.gov" target="_blank" rel="noreferrer" title="NASA Physical Sciences Informatics">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></svg>Sources
        </a>
        <button className="icon-btn" onClick={onAbout} aria-label="About CRASSUS">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><circle cx="12" cy="7.6" r=".6" fill="currentColor" /></svg>
        </button>
      </div>
    </header>
  );
}
