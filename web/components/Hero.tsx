"use client";

import HalftoneNebula from "./HalftoneNebula";

// Planet moved right so the wordmark (left column) reads over open sky.
const SKY = { planetX: 0.8, planetY: 0.64 };

interface Props {
  nInv: number;
  nFlex: number;
  nBurner: number;
  nChunks: number | null;
  onAbout: () => void;
}

export default function Hero({ nInv, nFlex, nBurner, nChunks, onAbout }: Props) {
  const open = () => document.getElementById("dashboard")?.scrollIntoView({ behavior: "smooth" });
  const stats = [
    { v: nInv || "…", l: "PSI combustion investigations" },
    { v: nFlex + nBurner || "…", l: "ISS tests used to calibrate & check the flame models" },
    { v: nChunks ?? "…", l: "cited passages behind the research copilot" },
  ];
  return (
    <HalftoneNebula height="max(100svh, 760px)" preset="solar" params={SKY}>
      <div className="hero">
        <div className="hero-body">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/crassus-logo.png" alt="CRASSUS" className="hero-logo" width={1400} height={303} />
          <p className="hero-kicker">SPACECRAFT FIRE INTELLIGENCE</p>
          <h1 className="hero-title">
            Flame in Freefall: SI-Powered Fire Safety Insights from Microgravity Combustion Data
          </h1>
          <div className="hero-ctas">
            <button className="hero-cta primary" onClick={open}>Open dashboard ↓</button>
            <button className="hero-cta" onClick={onAbout}>How the models work</button>
          </div>
          <div className="hero-stats">
            {stats.map((s) => (
              <div key={s.l}><span className="hero-stat">{s.v}</span><span className="hero-stat-l">{s.l}</span></div>
            ))}
          </div>
        </div>
        <div className="hero-foot">
          <div className="hero-marquee">
            <span className="hero-marquee-cap">Data from NASA PSI · NASA 2026 Space Apps</span>
          </div>
          <span className="hero-hint">Move the pointer to part the gas, click to light a star!!</span>
        </div>
      </div>
    </HalftoneNebula>
  );
}
