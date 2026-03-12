import { useState, useRef, useEffect } from "react";

const THREAT_RANK = { safe: 0, caution: 1, warning: 2, danger: 3 };

const COLORS = {
  safe:    { shield: "#94a3b8", card: null },
  caution: { shield: "#f59e0b", card: null },
  warning: { shield: "#f97316", card: { bg: "#fff7ed", border: "#fed7aa", text: "#7c2d12", badge: "#f97316", label: "Heads up" } },
  danger:  { shield: "#ef4444", card: { bg: "#fef2f2", border: "#fecaca", text: "#7f1d1d", badge: "#ef4444", label: "Be careful" } },
};

const GUARDIAN_SYSTEM_PROMPT = `You are a guardian AI protecting a child from online predators. Detect grooming patterns across the whole conversation.

ESCALATION RULES:
- Two or more personal info requests = danger, even if spaced apart.
- Personal info request in first 5 turns = warning minimum.
- Platform switch after any prior signal = danger.
- Secrecy request = danger immediately.
- Love bombing + follow-up personal ask = danger.
- Never downgrade current highest level.

Signals: personal info requests, platform switch, secrecy requests, love bombing, isolation tactics, gift offers, urgency/pressure, age-inappropriate content, re-engaging after meander.

Respond ONLY with JSON:
{
  "threat_level": "safe"|"caution"|"warning"|"danger",
  "signals": ["2-3 word label"],
  "pattern_reasoning": "one sentence or empty string",
  "kid_nudge": "warning/danger only: one short curious question in peer voice that makes them pause — e.g. 'Do you know this person in real life?' or 'Does it feel a bit fast to you?'. Do NOT suggest talking to Guardian, offer advice, or imply Guardian is available for a conversation. Limit to a simple pause-and-think prompt. Empty for safe/caution.",
  "guardian_note": "one sentence for parent dashboard",
  "confidence": 0-100
}`;

const BULLY_SYSTEM_PROMPT = `You are a guardian AI protecting a child from online bullying. Detect bullying patterns across the whole conversation.

ESCALATION RULES:
- Repeated insults across 2+ turns = danger.
- Explicit threat ("I'll tell everyone", "watch your back") = danger immediately.
- Coordinated language ("we all think", "nobody likes you") = danger.
- Coercion ("if you don't X, I'll Y") = danger immediately.
- Humiliation threat = danger immediately.
- Never downgrade current highest level.

Signals: direct insults, exclusion language, threats, coordinated pressure, coercion, humiliation tactics, persistent negativity, gaslighting.

Respond ONLY with JSON:
{
  "threat_level": "safe"|"caution"|"warning"|"danger",
  "signals": ["2-3 word label"],
  "pattern_reasoning": "one sentence or empty string",
  "kid_nudge": "warning/danger only: one short check-in question in peer voice — e.g. 'That didn't sound kind, you ok?' or 'Bit harsh — you good?'. Do NOT suggest talking to Guardian, offer advice, or imply Guardian is available for a conversation. Limit to a simple check-in. Empty for safe/caution.",
  "guardian_note": "one sentence for parent dashboard",
  "confidence": 0-100
}`;

const REACTION_SYSTEM_PROMPT = `You watch over a child's conversations. A Guardian warning was shown. Did the child heed it or ignore it?

HEEDING: doubt/hesitation, pulling back, cautious question, declining to share, any pause-and-think signal.
IGNORING: sharing info, agreeing to move platforms, making plans, warm reply with no doubt, neutral filler (lol, k, haha).
Default to IGNORING unless there is a clear unmistakable signal of caution.

IF HEEDING: 2-4 word kudos, lowercase, warm. E.g. "good call", "trust that instinct".
IF IGNORING: one gentle peer-voice question. Not advice. Makes them pause.

Respond ONLY with JSON: { "outcome": "heeding"|"ignoring", "text": "..." }`;

async function callClaude(system, userContent, maxTokens = 600) {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: userContent }],
    }),
  });
  const data = await res.json();
  const raw = (data.content?.[0]?.text || "").replace(/```json|```/g, "").trim();
  try { return JSON.parse(raw); }
  catch { const m = raw.match(/\{[\s\S]*?\}/); return m ? JSON.parse(m[0]) : null; }
}

async function analyzeMessage(messages, newMessage, threatHistory, currentHighestLevel) {
  const turnCount = messages.filter(m => m.from === "sender").length + 1;
  const recentHistory = messages.slice(-10)
    .map(m => `${m.from === "sender" ? "Contact" : "Child"}: ${m.text}`).join("\n");

  const threatBlock = threatHistory.length > 0
    ? `THREAT HISTORY:\n${threatHistory.map(t =>
        `[Turn ${t.turn}, ${t.level}] ${t.signals.join(", ")} — "${t.snippet}"`
      ).join("\n")}\n\nCurrent highest: ${currentHighestLevel}. Turn: ${turnCount}.`
    : `No signals yet. Turn: ${turnCount}. Current highest: ${currentHighestLevel}.`;

  const prompt = `${threatBlock}\n\nRecent conversation:\n${recentHistory || "(none)"}\n\nNew message: "${newMessage}"\n\nRate in context of full arc.`;

  const [predator, bully] = await Promise.all([
    callClaude(GUARDIAN_SYSTEM_PROMPT, prompt),
    callClaude(BULLY_SYSTEM_PROMPT, prompt),
  ]);

  const pr = THREAT_RANK[predator?.threat_level] ?? 0;
  const br = THREAT_RANK[bully?.threat_level] ?? 0;
  const winner = br > pr ? bully : predator;
  return winner;
}

async function evaluateKidReply(conversationHistory, kidReply) {
  const recentNudge = [...conversationHistory].reverse()
    .find(m => m.from === "sender" && m.analysis?.kid_nudge);
  const history = conversationHistory.slice(-8)
    .map(m => `${m.from === "sender" ? "Contact" : "Child"}: ${m.text}`).join("\n");
  const nudgeLine = recentNudge?.analysis?.kid_nudge
    ? `Guardian asked: "${recentNudge.analysis.kid_nudge}"`
    : `Guardian flagged this conversation as suspicious.`;
  const prompt = `${nudgeLine}\n\nRecent:\n${history}\n\nChild just replied: "${kidReply}"\n\nHeed or ignore?`;
  const result = await callClaude(REACTION_SYSTEM_PROMPT, prompt, 120);
  return { heeding: result?.outcome === "heeding", text: result?.text?.trim() || "" };
}

// ── UI Primitives ────────────────────────────────────────────────────────────

function Shield({ color, size = 20, pulse = false }) {
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      {pulse && <div style={{
        position: "absolute", inset: -4, borderRadius: "50%",
        background: color, opacity: 0.25,
        animation: "ripple 1.8s ease-out infinite",
      }} />}
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <path d="M12 2L4 6v6c0 5.5 3.8 10.7 8 12 4.2-1.3 8-6.5 8-12V6l-8-4z"/>
        <path d="M9 12l2 2 4-4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      </svg>
    </div>
  );
}

function Dots() {
  return (
    <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
      {[0,1,2].map(i => (
        <span key={i} style={{
          width: 4, height: 4, borderRadius: "50%", background: "currentColor", opacity: 0.5,
          animation: `bounce 1.2s ease-in-out ${i*0.2}s infinite`, display: "inline-block",
        }}/>
      ))}
    </span>
  );
}


function GuardianCard({ analysis, onDismiss }) {
  const c = COLORS[analysis.threat_level];
  if (!c?.card) return null;
  const { bg, border, text, badge, label } = c.card;
  return (
    <div style={{
      margin: "6px 12px 2px", borderRadius: 14, border: `1.5px solid ${border}`,
      background: bg, padding: "11px 13px", animation: "slideUp 0.25s ease", position: "relative",
    }}>
      <button onClick={onDismiss} style={{
        position: "absolute", top: 8, right: 8, background: "none", border: "none",
        cursor: "pointer", color: text, opacity: 0.4, fontSize: 14, padding: "2px 4px",
      }}>✕</button>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7 }}>
        <Shield color={badge} size={15} />
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: badge }}>Guardian</span>
        <span style={{ background: badge, color: "white", fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 20 }}>{label}</span>
      </div>
      {analysis.kid_nudge && (
        <p style={{ fontSize: 13, color: text, margin: "0 0 7px", lineHeight: 1.5, fontWeight: 500 }}>"{analysis.kid_nudge}"</p>
      )}
      {analysis.signals?.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {analysis.signals.map((s, i) => (
            <span key={i} style={{ fontSize: 10, background: `${badge}18`, color: text, padding: "2px 7px", borderRadius: 20, fontWeight: 600 }}>{s}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function CompactNudge({ analysis, onDismiss }) {
  const isWarning = analysis?.threat_level === "warning";
  const color  = isWarning ? "#f97316" : "#ef4444";
  const bg     = isWarning ? "#fff7ed" : "#fef2f2";
  const border = isWarning ? "#fed7aa" : "#fecaca";
  const text   = isWarning ? "#7c2d12" : "#7f1d1d";
  return (
    <div style={{
      margin: "3px 12px 4px", padding: "5px 28px 5px 10px", borderRadius: 20,
      background: bg, border: `1px solid ${border}`, display: "inline-flex",
      alignItems: "center", gap: 6, alignSelf: "flex-start",
      animation: "slideUp 0.25s ease", position: "relative", maxWidth: "90%",
    }}>
      <Shield color={color} size={11} />
      <span style={{ fontSize: 11, color: text, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {(analysis?.signals || []).slice(0, 2).join(" · ") || "suspicious pattern"}
      </span>
      <button onClick={onDismiss} style={{
        position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)",
        background: "none", border: "none", cursor: "pointer", color: text, opacity: 0.4, fontSize: 11,
      }}>✕</button>
    </div>
  );
}

function CautionToast() {
  return (
    <div style={{
      margin: "4px 12px", padding: "5px 11px", borderRadius: 20,
      background: "#fef9c3", border: "1px solid #fde047",
      display: "inline-flex", alignItems: "center", gap: 6,
      animation: "fadeInOut 2.5s ease forwards", alignSelf: "flex-start",
    }}>
      <Shield color="#eab308" size={12} />
      <span style={{ fontSize: 11, color: "#713f12", fontWeight: 600 }}>Guardian noticed something</span>
    </div>
  );
}

function RegretNudge({ text, onDismiss }) {
  return (
    <div style={{
      margin: "4px 12px 6px", borderRadius: 14, border: "1.5px solid #e9d5ff",
      background: "#faf5ff", padding: "10px 13px", animation: "slideUp 0.3s ease",
      position: "relative", alignSelf: "flex-end", maxWidth: "88%",
    }}>
      <button onClick={onDismiss} style={{
        position: "absolute", top: 7, right: 8, background: "none", border: "none",
        cursor: "pointer", color: "#6b21a8", opacity: 0.35, fontSize: 13,
      }}>✕</button>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
        <Shield color="#a855f7" size={14} />
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "#a855f7" }}>Guardian</span>
      </div>
      {text
        ? <p style={{ fontSize: 13, color: "#581c87", margin: 0, lineHeight: 1.5, fontWeight: 500 }}>"{text}"</p>
        : <div style={{ color: "#a855f7", opacity: 0.5 }}><Dots /></div>
      }
    </div>
  );
}

function KudosPill({ text }) {
  return (
    <div style={{
      margin: "3px 12px 4px", padding: "4px 10px", borderRadius: 20,
      background: "#f0fdfa", border: "1px solid #99f6e4",
      display: "inline-flex", alignItems: "center", gap: 5,
      alignSelf: "flex-end", animation: "slideUp 0.25s ease",
    }}>
      <span style={{ fontSize: 13 }}>👏</span>
      <span style={{ fontSize: 11, color: "#0f766e", fontWeight: 600 }}>{text || "smart move"}</span>
    </div>
  );
}

// ── Main Demo ─────────────────────────────────────────────────────────────────

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
  textarea:focus, input:focus { outline: none; }
  @keyframes slideUp { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
  @keyframes fadeInOut { 0%{opacity:0} 15%{opacity:1} 70%{opacity:1} 100%{opacity:0} }
  @keyframes bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-4px)} }
  @keyframes ripple { 0%{transform:scale(0.8);opacity:0.4} 100%{transform:scale(2.2);opacity:0} }
`;

function Demo() {
  const [messages,    setMessages]    = useState([]);
  const [senderInput, setSenderInput] = useState("");
  const [kidInput,    setKidInput]    = useState("");
  const [analyzing,   setAnalyzing]   = useState(false);
  const [shieldLevel, setShieldLevel] = useState("safe");
  const [dismissed,   setDismissed]   = useState({});

  const highestShown  = useRef(0);
  const highestLevel  = useRef("safe");
  const threatHistory = useRef([]);
  const senderTurns   = useRef(0);
  const phoneRef      = useRef(null);
  const senderRef     = useRef(null);

  useEffect(() => {
    if (phoneRef.current)  phoneRef.current.scrollTop  = phoneRef.current.scrollHeight;
    if (senderRef.current) senderRef.current.scrollTop = senderRef.current.scrollHeight;
  }, [messages]);

  const sendFromSender = async () => {
    if (!senderInput.trim() || analyzing) return;
    const text = senderInput.trim();
    setSenderInput("");
    setAnalyzing(true);
    senderTurns.current += 1;

    const id = Date.now();
    setMessages(prev => [...prev, { id, from: "sender", text, analyzing: true, analysis: null, showCard: false, showRepeat: false, showCaution: false }]);

    try {
      const analysis = await analyzeMessage(messages, text, threatHistory.current, highestLevel.current);
      const level = analysis?.threat_level || "safe";
      const rank  = THREAT_RANK[level] ?? 0;

      if (analysis?.signals?.length > 0 && rank >= 1) {
        threatHistory.current = [...threatHistory.current, {
          turn: senderTurns.current, level,           signals: analysis.signals,
          snippet: text.length > 60 ? text.slice(0, 60) + "…" : text,
        }];
      }

      if (rank > THREAT_RANK[highestLevel.current]) highestLevel.current = level;
      setShieldLevel(prev => rank > THREAT_RANK[prev] ? level : prev);

      const showCard    = rank >= 2 && rank > highestShown.current;
      const showRepeat  = rank >= 2 && rank <= highestShown.current;
      const showCaution = rank === 1 && rank > highestShown.current;
      if (rank > highestShown.current) highestShown.current = rank;

      setMessages(prev => prev.map(m =>
        m.id === id ? { ...m, analyzing: false, analysis, showCard, showRepeat, showCaution } : m
      ));
    } catch (e) {
      setMessages(prev => prev.map(m => m.id === id ? { ...m, analyzing: false } : m));
    }
    setAnalyzing(false);
  };

  const sendFromKid = async () => {
    if (!kidInput.trim()) return;
    const text = kidInput.trim();
    const warningActive = highestShown.current >= 2;
    const id = Date.now();
    setMessages(prev => [...prev, { id, from: "kid", text, regretNudge: false, regretText: null, kudos: false, kudosText: "" }]);
    setKidInput("");

    if (warningActive) {
      setMessages(prev => prev.map(m => m.id === id ? { ...m, regretNudge: true, regretText: null } : m));
      const snap = await new Promise(res => setMessages(prev => { res(prev); return prev; }));
      const { heeding, text: rt } = await evaluateKidReply(snap, text);
      if (heeding) {
        setMessages(prev => prev.map(m => m.id === id ? { ...m, regretNudge: false, kudos: true, kudosText: rt || "smart move" } : m));
      } else {
        setMessages(prev => prev.map(m => m.id === id ? { ...m, regretText: rt || "Does that feel like the right move?" } : m));
      }
    }
  };

  const enter = (e, fn) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); fn(); } };

  const shieldColor = COLORS[shieldLevel]?.shield || "#94a3b8";
  const shieldPulse = shieldLevel === "warning" || shieldLevel === "danger";

  return (
    <div style={{ height: "100vh", display: "flex", background: "#0f172a", fontFamily: "'DM Sans', system-ui, sans-serif", overflow: "hidden" }}>
      <style>{CSS}</style>

      {/* LEFT — Sender panel */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", borderRight: "1px solid #1e293b" }}>
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #1e293b" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 38, height: 38, borderRadius: "50%",
              background: "linear-gradient(135deg, #f59e0b, #ef4444)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 16, fontWeight: 700, color: "white",
            }}>M</div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#f1f5f9" }}>Marcus_R27</div>
              <div style={{ fontSize: 11, color: "#64748b" }}>Unknown contact · Sending to: Jamie</div>
            </div>
            <div style={{ marginLeft: "auto", background: "#1e293b", border: "1px solid #334155", borderRadius: 20, padding: "4px 10px", fontSize: 11, color: "#94a3b8" }}>SENDER VIEW</div>
          </div>
        </div>

        <div ref={senderRef} style={{ flex: 1, overflowY: "auto", padding: "16px 0", display: "flex", flexDirection: "column", justifyContent: messages.length === 0 ? "center" : "flex-start" }}>
          {messages.length === 0 ? (
            <div style={{ textAlign: "center", padding: "0 32px" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>💬</div>
              <div style={{ fontSize: 14, color: "#475569", lineHeight: 1.6 }}>
                Type a message below to send to Jamie.<br/>
                <span style={{ color: "#334155" }}>Try something suspicious to see Guardian respond.</span>
              </div>
            </div>
          ) : messages.map(m => (
            <div key={m.id} style={{
              display: "flex", justifyContent: m.from === "kid" ? "flex-start" : "flex-end",
              padding: "2px 16px", marginBottom: 4,
            }}>
              <div style={{
                maxWidth: "72%", padding: "9px 14px",
                borderRadius: m.from === "kid" ? "18px 18px 18px 4px" : "18px 18px 4px 18px",
                background: m.from === "kid" ? "#334155" : "#0ea5e9",
                color: "white", fontSize: 14, lineHeight: 1.5,
              }}>{m.text}</div>
            </div>
          ))}
        </div>

        <div style={{ padding: "16px 20px", borderTop: "1px solid #1e293b", display: "flex", gap: 10, alignItems: "flex-end" }}>
          <textarea
            value={senderInput}
            onChange={e => setSenderInput(e.target.value)}
            onKeyDown={e => enter(e, sendFromSender)}
            placeholder="Send a message to Jamie..."
            rows={1}
            style={{
              flex: 1, background: "#1e293b", border: "1px solid #334155", borderRadius: 12,
              color: "#f1f5f9", fontSize: 14, padding: "10px 14px", resize: "none", lineHeight: 1.5,
            }}
          />
          <button onClick={sendFromSender} disabled={analyzing || !senderInput.trim()} style={{
            width: 40, height: 40, borderRadius: 12, border: "none",
            background: analyzing || !senderInput.trim() ? "#1e293b" : "#0ea5e9",
            color: "white", cursor: analyzing || !senderInput.trim() ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M22 2L11 13M22 2L15 22 11 13 2 9l20-7z"/></svg>
          </button>
        </div>
      </div>

      {/* RIGHT — Jamie's phone */}
      <div style={{ width: 420, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 32px", flexShrink: 0 }}>
        <div style={{ fontSize: 11, color: "#334155", letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 600, marginBottom: 16 }}>Jamie's Phone</div>

        <div style={{
          width: 340, height: 680, background: "#ffffff", borderRadius: 44,
          border: "8px solid #1e293b", display: "flex", flexDirection: "column", overflow: "hidden",
          boxShadow: "0 25px 60px rgba(0,0,0,0.5), inset 0 0 0 1px #334155", position: "relative",
        }}>
          {/* notch */}
          <div style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: 120, height: 28, background: "#1e293b", borderRadius: "0 0 20px 20px", zIndex: 10 }} />

          {/* status bar */}
          <div style={{ height: 44, background: "#f8fafc", display: "flex", alignItems: "flex-end", justifyContent: "space-between", padding: "0 20px 6px", flexShrink: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#1e293b" }}>9:41</span>
            <div style={{ width: 14, height: 8, border: "1.5px solid #1e293b", borderRadius: 2 }}>
              <div style={{ width: "70%", height: "100%", background: "#22c55e", borderRadius: 1 }} />
            </div>
          </div>

          {/* chat header */}
          <div style={{ padding: "10px 16px 12px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <div style={{
              width: 36, height: 36, borderRadius: "50%",
              background: "linear-gradient(135deg, #f59e0b, #ef4444)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 14, fontWeight: 700, color: "white",
            }}>M</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#0f172a" }}>Marcus_R27</div>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>New contact · Met 3 days ago</div>
            </div>
            <div style={{ marginLeft: "auto", transition: "all 0.6s ease" }}>
              <Shield color={shieldColor} size={24} pulse={shieldPulse} />
            </div>
          </div>

          {/* messages */}
          <div ref={phoneRef} style={{ flex: 1, overflowY: "auto", paddingTop: 12, paddingBottom: 8, background: "#f8fafc", display: "flex", flexDirection: "column" }}>
            {messages.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 20px" }}>
                <div style={{ fontSize: 28, marginBottom: 10 }}>🛡️</div>
                <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>Guardian is watching quietly.<br/>Waiting for Marcus to say something.</div>
              </div>
            ) : messages.map(msg => (
              <div key={msg.id}>
                <div style={{ display: "flex", justifyContent: msg.from === "sender" ? "flex-start" : "flex-end", marginBottom: 4, padding: "0 12px" }}>
                  {msg.from === "sender" && (
                    <div style={{
                      width: 28, height: 28, borderRadius: "50%",
                      background: "linear-gradient(135deg, #f59e0b, #ef4444)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 12, color: "white", fontWeight: 700,
                      marginRight: 6, flexShrink: 0, alignSelf: "flex-end", marginBottom: 2,
                    }}>M</div>
                  )}
                  <div style={{
                    maxWidth: "72%", padding: "9px 13px",
                    borderRadius: msg.from === "sender" ? "18px 18px 18px 4px" : "18px 18px 4px 18px",
                    background: msg.from === "sender" ? "#f1f5f9" : "linear-gradient(135deg, #14b8a6, #0d9488)",
                    color: msg.from === "sender" ? "#1e293b" : "white",
                    fontSize: 14, lineHeight: 1.5, boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
                  }}>
                    {msg.text}
                    {msg.analyzing && <span style={{ marginLeft: 6 }}><Dots /></span>}
                  </div>
                </div>

                {msg.from === "sender" && msg.showCaution && <CautionToast />}

                {msg.from === "sender" && msg.showCard && msg.analysis && !dismissed[msg.id] && (
                  <GuardianCard analysis={msg.analysis} onDismiss={() => setDismissed(p => ({ ...p, [msg.id]: true }))} />
                )}

                {msg.from === "sender" && msg.showRepeat && msg.analysis && !dismissed[`r_${msg.id}`] && (
                  <CompactNudge analysis={msg.analysis} onDismiss={() => setDismissed(p => ({ ...p, [`r_${msg.id}`]: true }))} />
                )}

                {msg.from === "kid" && msg.kudos && <KudosPill text={msg.kudosText} />}

                {msg.from === "kid" && msg.regretNudge && !dismissed[`rg_${msg.id}`] && (
                  <RegretNudge text={msg.regretText} onDismiss={() => setDismissed(p => ({ ...p, [`rg_${msg.id}`]: true }))} />
                )}

                {msg.from === "sender" && msg.analyzing && (
                  <div style={{ margin: "3px 12px", display: "inline-flex", alignItems: "center", gap: 6, opacity: 0.5 }}>
                    <Shield color="#94a3b8" size={12} />
                    <span style={{ fontSize: 11, color: "#94a3b8" }}>analyzing</span>
                    <Dots />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* kid input */}
          <div style={{ padding: "10px 12px", background: "#ffffff", borderTop: "1px solid #e2e8f0", display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
            <input
              value={kidInput}
              onChange={e => setKidInput(e.target.value)}
              onKeyDown={e => enter(e, sendFromKid)}
              placeholder="Reply as Jamie..."
              style={{ flex: 1, background: "#f1f5f9", border: "none", borderRadius: 20, color: "#0f172a", fontSize: 13, padding: "9px 14px" }}
            />
            <button onClick={sendFromKid} disabled={!kidInput.trim()} style={{
              width: 34, height: 34, borderRadius: "50%", border: "none",
              background: kidInput.trim() ? "linear-gradient(135deg, #14b8a6, #0d9488)" : "#e2e8f0",
              cursor: kidInput.trim() ? "pointer" : "not-allowed",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M22 2L11 13M22 2L15 22 11 13 2 9l20-7z"/></svg>
            </button>
          </div>
        </div>

        {/* legend */}
        <div style={{ marginTop: 18, display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center" }}>
          {[
            { level: "safe", label: "Safe · silent" },
            { level: "caution", label: "Caution · ambient" },
            { level: "warning", label: "Warning · nudge" },
            { level: "danger", label: "Danger · alert" },
          ].map(({ level, label }) => (
            <div key={level} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: COLORS[level].shield }} />
              <span style={{ fontSize: 10, color: "#475569" }}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return <Demo />;
}
