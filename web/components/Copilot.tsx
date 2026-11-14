"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, FireExtinguisher, Flame, Moon, RotateCcw, Siren, SlidersHorizontal, Sparkles, Wind } from "lucide-react";
import { modelLabel, type ChatAnswer, type Health } from "@/lib/api";
import type { Params } from "@/lib/flame";

/** Auto-growing textarea — from design/ruixen-moon-chat.tsx. */
function useAutoResizeTextarea({ minHeight, maxHeight }: { minHeight: number; maxHeight?: number }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const adjustHeight = useCallback(
    (reset?: boolean) => {
      const t = textareaRef.current;
      if (!t) return;
      t.style.height = `${minHeight}px`;
      if (reset) return;
      t.style.height = `${Math.max(minHeight, Math.min(t.scrollHeight, maxHeight ?? Infinity))}px`;
    },
    [minHeight, maxHeight],
  );
  useEffect(() => {
    if (textareaRef.current) textareaRef.current.style.height = `${minHeight}px`;
  }, [minHeight]);
  return { textareaRef, adjustHeight };
}

export interface ChatMsg {
  id: string;
  role: "user" | "ai";
  text?: string;
  answer?: ChatAnswer;
  proposalState?: "pending" | "applied" | "dismissed";
}

const KIND = {
  finding: { label: "RETRIEVED FINDING", color: "var(--text)" },
  interpretation: { label: "AI INTERPRETATION", color: "var(--ai)" },
  limitation: { label: "LIMITATION", color: "var(--warn)" },
} as const;

const PARAM_LABEL: Record<string, string> = {
  o2: "O₂ (%)", p: "Pressure (kPa)", g: "Gravity (g₀)", u: "Flow (m/s)", T: "Temperature (K)",
  geom: "Size (mm)", flow: "Fuel flow (mg/s)", xf: "Fuel fraction (%)", co2: "CO₂ (%)", ef: "Potential (kV)",
};

interface Props {
  open: boolean;
  narrow: boolean;
  onToggle: () => void;
  ctx: string;
  msgs: ChatMsg[];
  thinking: boolean;
  onAsk: (q: string) => void;
  onApply: (id: string) => void;
  onDismiss: (id: string) => void;
  onClear: () => void;
  params: Params;
  health: Health | null;
  invName: string;
  onResize: (e: React.MouseEvent) => void;
}

export default function Copilot(p: Props) {
  const [draft, setDraft] = useState("");
  const [openCites, setOpenCites] = useState<Record<string, boolean>>({});
  const chatRef = useRef<HTMLDivElement>(null);

  const { textareaRef, adjustHeight } = useAutoResizeTextarea({ minHeight: 44, maxHeight: 150 });

  useEffect(() => {
    const c = chatRef.current;
    if (c) c.scrollTop = c.scrollHeight;
  }, [p.msgs.length, p.thinking]);

  const send = () => {
    const q = draft.trim();
    if (!q || p.thinking) return;
    p.onAsk(q);
    setDraft("");
    adjustHeight(true);
  };

  // Quick actions: short label on the pill, full question sent.
  const actions = [
    { icon: <Flame size={14} />, label: "Fire-safety findings", q: `What did ${p.invName} find that matters for crewed-habitat fire safety?` },
    { icon: <Moon size={14} />, label: "Lunar applicability", q: "What are the limits of applying µg results to lunar gravity?" },
    { icon: <SlidersHorizontal size={14} />, label: "Set lunar conditions", q: `Configure conditions from ${p.invName} closest to a lunar habitat atmosphere` },
    { icon: <Wind size={14} />, label: "Airflow & flammability", q: "How does low-speed airflow change solid-material flammability in microgravity?" },
    { icon: <Siren size={14} />, label: "Smoke detection", q: "Which investigations inform smoke detector design for spacecraft?" },
    { icon: <FireExtinguisher size={14} />, label: "Suppression", q: "What did PSI experiments show about extinguishing fires with CO₂ or helium dilution?" },
  ];
  const empty = !p.msgs.length && !p.thinking;
  const service = p.health?.llm ? "RAG · " + modelLabel(p.health.llm, false) : p.health ? "RETRIEVAL ONLY" : "OFFLINE";

  return (
    <section className="panel panel-r copilot" aria-label="Research copilot">
      <div className="phead">
        <Sparkles size={14} color="var(--amber)" aria-hidden="true" />
        {p.open && (<><h2>RESEARCH COPILOT</h2><span className="chip" style={{ fontSize: 9.5, color: "var(--muted)" }}>{service}</span></>)}
        {!p.narrow && <button className="collapse" onClick={p.onToggle} aria-label="Collapse copilot panel">{p.open ? "›" : "‹"}</button>}
      </div>
      {p.open && (
        <>
          <div className="ctx"><span className="k">CONTEXT</span><span className="v">{p.ctx}</span></div>
          <div ref={chatRef} className={`chat ${empty ? "chat-empty" : ""}`}>
            {empty && (
              <div className="welcome">
                <h3>Ask the PSI record</h3>
                <p>
                  {p.health?.chunks ?? "…"} passages from NASA combustion investigations. Findings are quoted with dataset DOIs;
                  interpretation is labelled separately.
                </p>
              </div>
            )}
            {p.msgs.map((m) => (
              <div key={m.id} className="msg">
                {m.role === "user" && <div className="bubble">{m.text}</div>}
                {m.role === "ai" && m.answer && (
                  <>
                    <div className="ai-meta"><span className="sq" />COPILOT · {m.answer.mode === "generated" ? modelLabel(m.answer.model, false) : "RETRIEVAL ONLY"} · {m.answer.cites.length} source{m.answer.cites.length === 1 ? "" : "s"}</div>
                    {m.answer.blocks.map((b, i) => (
                      <div key={i} className="block" style={{ borderColor: KIND[b.kind].color }}>
                        <span className="kind" style={{ color: KIND[b.kind].color }}>{KIND[b.kind].label}</span>
                        <span className="txt">{b.text}</span>
                      </div>
                    ))}
                    {m.answer.proposal && (
                      <div className="proposal">
                        <span className="mono" style={{ fontSize: 10, letterSpacing: ".07em", color: "var(--flame-soft)" }}>PROPOSED PARAMETER CHANGES · REVIEW REQUIRED</span>
                        {Object.entries(m.answer.proposal.changes).map(([k, v]) => (
                          <div key={k} className="mono" style={{ display: "grid", gridTemplateColumns: "1fr auto", fontSize: 11.5 }}>
                            <span style={{ color: "var(--muted)" }}>{PARAM_LABEL[k] ?? k}</span>
                            <span><span style={{ color: "var(--faint)", textDecoration: "line-through" }}>{String(p.params[k as keyof Params])}</span> → {v}</span>
                          </div>
                        ))}
                        {m.answer.proposal.why && <span className="small">{m.answer.proposal.why}</span>}
                        {m.proposalState === "pending" ? (
                          <>
                            <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                              <button className="run" style={{ height: 28, padding: "0 12px", fontSize: 11.5, letterSpacing: 0 }} onClick={() => p.onApply(m.id)}>Apply to inputs</button>
                              <button className="btn" style={{ height: 28, padding: "0 12px" }} onClick={() => p.onDismiss(m.id)}>Dismiss</button>
                            </div>
                            <span className="small" style={{ fontSize: 10.5 }}>Applying updates inputs only. The model does not run until you press RUN MODEL.</span>
                          </>
                        ) : (
                          <span className="mono" style={{ fontSize: 10.5, color: "var(--muted)" }}>{m.proposalState === "applied" ? "Applied to inputs — press RUN MODEL." : "Dismissed."}</span>
                        )}
                      </div>
                    )}
                    {m.answer.cites.length > 0 && (
                      <>
                        <button className="cite-btn" onClick={() => setOpenCites((o) => ({ ...o, [m.id]: !o[m.id] }))}>
                          {openCites[m.id] ? "▾" : "▸"} {m.answer.cites.length} cited source{m.answer.cites.length === 1 ? "" : "s"}
                        </button>
                        {openCites[m.id] && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                            {m.answer.cites.map((c) => (
                              <div key={c.n} className="cite">
                                <span className="mono" style={{ color: "var(--accent)" }}>[{c.n}]</span><span style={{ fontWeight: 500 }}>{c.inv}</span>
                                <span /><span className="mono" style={{ fontSize: 10.5, color: "var(--muted)" }}>{c.acc} · {c.section}</span>
                                <span /><span className="mono" style={{ fontSize: 10.5, color: "var(--warn)" }}>
                                  DOI · {c.doi ? <a href={`https://doi.org/${c.doi}`} target="_blank" rel="noreferrer">{c.doi}</a> : "none listed"}
                                </span>
                                {c.pub_dois.length > 0 && (<><span /><span className="mono" style={{ fontSize: 10, color: "var(--muted)" }}>papers: {c.pub_dois.map((d, i) => <a key={d} href={`https://doi.org/${d}`} target="_blank" rel="noreferrer">{i ? ", " : ""}{d}</a>)}</span></>)}
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            ))}
            {p.thinking && <div className="thinking"><span className="dot" />Retrieving from local PSI index…</div>}
          </div>
          <div className={`composer-wrap ${empty ? "composer-centered" : ""}`}>
            <div className="glass">
              <textarea
                ref={textareaRef}
                value={draft}
                aria-label="Ask the research copilot"
                placeholder="Ask about PSI investigations…"
                onChange={(e) => { setDraft(e.target.value); adjustHeight(); }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                style={{ overflow: "hidden" }}
              />
              <div className="glass-foot">
                <button className="glass-ghost" onClick={p.onClear} disabled={!p.msgs.length || p.thinking} title="Start a new chat" aria-label="Start a new chat">
                  <RotateCcw size={15} />
                </button>
                <button className={`glass-send ${draft.trim() && !p.thinking ? "ready" : ""}`} onClick={send}
                  disabled={p.thinking || !draft.trim()} title="Send (Enter)">
                  <ArrowUp size={16} />
                  <span className="sr-only">Send</span>
                </button>
              </div>
            </div>
            <div className={`pills ${empty ? "" : "pills-row"}`}>
              {actions.map((a) => (
                <button key={a.label} className="pill" onClick={() => p.onAsk(a.q)} disabled={p.thinking} title={a.q}>
                  {a.icon}<span>{a.label}</span>
                </button>
              ))}
            </div>
            <span className="composer-note">
              {p.health?.llm ? "Grounded in retrieved PSI records — uncited statements are removed." : "No LLM key configured — showing retrieved passages verbatim."}
            </span>
          </div>
        </>
      )}
      {!p.narrow && <div className="resize" style={{ left: -4 }} onMouseDown={p.onResize} title="Drag to resize" />}
    </section>
  );
}
