import { useState, useRef, useEffect } from "react";

// ─── Constants ───────────────────────────────────────────────────────────────

const THREAT_RANK = { safe: 0, caution: 1, warning: 2, danger: 3 };

const COLORS = {
  safe:    { shield: "#94a3b8", card: null },
  caution: { shield: "#f59e0b", card: null },
  warning: { shield: "#f97316", card: { bg: "#fff7ed", border: "#fed7aa", text: "#7c2d12", badge: "#f97316", label: "Heads up" } },
  danger:  { shield: "#ef4444", card: { bg: "#fef2f2", border: "#fecaca", text: "#7f1d1d", badge: "#ef4444", label: "Be careful" } },
};

const GUARDIAN_SYSTEM_PROMPT = `You are a guardian AI protecting a child from online predators. Your job is to detect grooming patterns across a whole conversation — not just flag individual bad messages.

CRITICAL: Grooming is a slow process. A single suspicious message may only warrant "caution". But the same signal appearing again later, after meandering small talk designed to build false trust, is a PATTERN — and patterns escalate threat level regardless of how innocent the current message looks in isolation.

Analyze each new message in light of the full threat history provided. Ask: is this message a new step in an ongoing grooming arc?

ESCALATION RULES (apply these strictly):
- Two or more personal info requests across the conversation (school, address, age, photos, social handles, phone) = danger, even if spaced far apart. The meander between asks IS the grooming tactic.
- Any personal info request from an unknown contact in the first 5 turns of conversation = warning minimum (too fast, no established trust).
- Platform switch request after ANY prior suspicious signal = danger (moving off monitored channels is a grooming step, not coincidence).
- Secrecy request ("don't tell your parents") at any point = danger immediately.
- Love bombing + any follow-up personal ask = danger.
- Current highest threat level in the conversation: provided in each prompt. Never return a level LOWER than the current highest unless you have strong reason to de-escalate (very rare).

Signals to detect:
- Personal info requests (school, address, age, photos, phone, social handles)
- Platform switch ("let's move to Telegram/Discord/Snapchat")
- Secrecy requests ("don't tell anyone", "keep this between us")
- Love bombing / false intimacy ("I feel like I already know you", "you're so mature")
- Isolation tactics ("your friends wouldn't understand")
- Gift offers or financial asks
- Urgency or pressure
- Age-inappropriate content or sexual language
- Re-engaging after meander (small talk designed to lower guard before next ask)

Respond ONLY with this exact JSON:
{
  "threat_level": "safe" | "caution" | "warning" | "danger",
  "signals": ["label 1", "label 2"],
  "pattern_reasoning": "One sentence: what arc or pattern drives this rating, if any. Empty string if truly isolated message.",
  "kid_nudge": "Only for warning/danger: one short curious question in peer voice — not advice, not a warning. Make them pause and think. E.g. 'Do you know this person in real life?' or 'Does it feel a bit fast to you?' Never preach. Empty string for safe/caution.",
  "guardian_note": "One sentence for parent dashboard, including pattern context if relevant.",
  "confidence": 0-100
}

threat_level definitions:
- safe: no red flags, normal conversation
- caution: worth watching — unusually friendly for a new contact, very minor probe
- warning: clear manipulation, inappropriate request, or first personal info ask too early
- danger: immediate threat — grooming pattern confirmed, solicitation, secrecy request, or repeated personal info extraction

signals: 2-3 word labels only. E.g. "asks school", "platform switch", "moves fast", "secrecy request", "re-engages after gap", "second info ask". No full sentences.`;

// ─── API ─────────────────────────────────────────────────────────────────────

async function analyzeMessage(messages, newMessage, threatHistory, currentHighestLevel) {
  const turnCount = messages.filter(m => m.from === "sender").length + 1;
  const recentHistory = messages.slice(-10)
    .map(m => `${m.from === "sender" ? "Unknown contact" : "Child"}: ${m.text}`)
    .join("\n");

  const threatBlock = threatHistory.length > 0
    ? `THREAT HISTORY (signals detected so far across this conversation):\n${
        threatHistory.map(t => `[Turn ${t.turn}, ${t.level}] ${t.signals.join(", ")} — "${t.snippet}"`).join("\n")
      }\n\nCurrent highest threat level: ${currentHighestLevel}\nThis is turn ${turnCount} of the conversation.`
    : `No threat signals detected yet.\nThis is turn ${turnCount} of the conversation. Current highest threat level: ${currentHighestLevel}.`;

  const prompt = `${threatBlock}

Recent conversation:
${recentHistory || "(no messages yet)"}

New message from unknown contact: "${newMessage}"

Using the threat history and escalation rules, determine the threat level for this message in the context of the full conversation arc.`;

  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      system: GUARDIAN_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  const text = data.content?.[0]?.text || "{}";
  try { return JSON.parse(text); }
  catch { const m = text.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; }
}

// ─── SYSTEM PROMPT (edit this to tune nudge / kudos behaviour) ───────────────

const REACTION_SYSTEM_PROMPT = `You are a guardian AI that watches over a child's conversations. A safety warning was previously shown to the child. You now need to read their reply and decide: did they heed the warning, or ignore it?

HEEDING — the child is showing awareness. Signs include:
- Expressing doubt or hesitation ("idk", "that's weird", "I'm not sure about this")
- Pulling back or going quiet
- Asking a cautious question back
- Declining to share something or changing the subject
- Any reply that suggests they paused and thought twice

IGNORING — the child continued engaging without any sign of caution. Signs include:
- Sharing personal info (name, school, address, social handle, phone, photo)
- Agreeing to move platforms
- Making plans to meet
- Responding warmly with no hint of doubt
- Neutral filler that shows no reflection ("lol", "haha", "yeah ok", "k")

IMPORTANT: Default to IGNORING unless there is a clear, unmistakable signal of caution. Neutral is not heeding.

IF HEEDING — respond with a brief kudos label only. 2–4 words max, lowercase, warm but not patronising. Examples: "good call", "trust that instinct", "smart".

IF IGNORING — respond with a single gentle question in peer voice. Not advice. Not a warning. Just something that makes them pause and wonder. Hint at what might come next without stating it. 1–2 sentences, no quotes needed.

Respond ONLY with JSON:
{
  "outcome": "heeding" | "ignoring",
  "text": "your kudos label or gentle question here"
}`;

async function evaluateKidReply(conversationHistory, kidReply) {
  const recentNudge = [...conversationHistory].reverse()
    .find(m => m.from === "sender" && m.analysis?.kid_nudge);

  const history = conversationHistory.slice(-8)
    .map(m => `${m.from === "sender" ? "Unknown contact" : "Child"}: ${m.text}`)
    .join("\n");

  const nudgeLine = recentNudge?.analysis?.kid_nudge
    ? `The Guardian previously asked the child: "${recentNudge.analysis.kid_nudge}"`
    : `The Guardian had flagged this conversation as suspicious.`;

  const prompt = `${nudgeLine}

Recent conversation:
${history}

The child just replied: "${kidReply}"

Did they heed the warning or ignore it?`;

  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 120,
      system: REACTION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  const raw = (data.content?.[0]?.text || "").replace(/```json|```/g, "").trim();
  try {
    const parsed = JSON.parse(raw);
    return { heeding: parsed.outcome === "heeding", text: parsed.text?.trim() || "" };
  } catch {
    const m = raw.match(/\{[\s\S]*?\}/);
    if (m) {
      try {
        const parsed = JSON.parse(m[0]);
        return { heeding: parsed.outcome === "heeding", text: parsed.text?.trim() || "" };
      } catch {}
    }
    return { heeding: false, text: "" };
  }
}

// ─── Shield Icon ─────────────────────────────────────────────────────────────

function Shield({ color, size = 20, pulse = false }) {
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      {pulse && (
        <div style={{
          position: "absolute", inset: -4,
          borderRadius: "50%",
          background: color,
          opacity: 0.25,
          animation: "ripple 1.8s ease-out infinite",
        }} />
      )}
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <path d="M12 2L4 6v6c0 5.5 3.8 10.7 8 12 4.2-1.3 8-6.5 8-12V6l-8-4z"/>
        <path d="M9 12l2 2 4-4" stroke="white" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      </svg>
    </div>
  );
}

// ─── Guardian Card (warning / danger only) ───────────────────────────────────

function GuardianCard({ analysis, onDismiss }) {
  const c = COLORS[analysis.threat_level];
  if (!c.card) return null;
  const { bg, border, text, badge, label } = c.card;

  return (
    <div style={{
      margin: "6px 12px 2px",
      borderRadius: "14px",
      border: `1.5px solid ${border}`,
      background: bg,
      padding: "11px 13px",
      animation: "slideUp 0.25s ease",
      position: "relative",
    }}>
      {/* dismiss */}
      <button onClick={onDismiss} style={{
        position: "absolute", top: 8, right: 8,
        background: "none", border: "none", cursor: "pointer",
        color: text, opacity: 0.4, fontSize: "14px", lineHeight: 1,
        padding: "2px 4px",
      }}>✕</button>

      <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "7px" }}>
        <Shield color={badge} size={15} />
        <span style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.07em",
                       textTransform: "uppercase", color: badge }}>Guardian</span>
        <span style={{
          background: badge, color: "white",
          fontSize: "10px", fontWeight: "700",
          padding: "1px 7px", borderRadius: "20px",
        }}>{label}</span>
      </div>

      {analysis.kid_nudge && (
        <p style={{ fontSize: "13px", color: text, margin: "0 0 7px",
                    lineHeight: "1.5", fontWeight: "500" }}>
          "{analysis.kid_nudge}"
        </p>
      )}

      {analysis.signals?.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
          {analysis.signals.map((s, i) => (
            <span key={i} style={{
              fontSize: "10px", background: `${badge}18`,
              color: text, padding: "2px 7px", borderRadius: "20px", fontWeight: "600",
            }}>{s}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Regret nudge (shown after kid shares sensitive info post-warning) ──────────

function RegretNudge({ text, onDismiss }) {
  return (
    <div style={{
      margin: "4px 12px 6px",
      borderRadius: "14px",
      border: "1.5px solid #e9d5ff",
      background: "#faf5ff",
      padding: "10px 13px",
      animation: "slideUp 0.3s ease",
      position: "relative",
      alignSelf: "flex-end",
      maxWidth: "88%",
    }}>
      <button onClick={onDismiss} style={{
        position: "absolute", top: 7, right: 8,
        background: "none", border: "none", cursor: "pointer",
        color: "#6b21a8", opacity: 0.35, fontSize: "13px", lineHeight: 1,
        padding: "2px 4px",
      }}>✕</button>
      <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "6px" }}>
        <Shield color="#a855f7" size={14} />
        <span style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.07em",
                       textTransform: "uppercase", color: "#a855f7" }}>Guardian</span>
      </div>
      {text ? (
        <p style={{ fontSize: "13px", color: "#581c87", margin: 0, lineHeight: "1.5", fontWeight: "500" }}>
          "{text}"
        </p>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 6, opacity: 0.5 }}>
          <Dots />
        </div>
      )}
    </div>
  );
}

// ─── Kudos pill — shown when kid's reply shows they're heeding a nudge ────────

function KudosPill({ text }) {
  return (
    <div style={{
      margin: "3px 12px 4px",
      padding: "4px 10px",
      borderRadius: "20px",
      background: "#f0fdfa",
      border: "1px solid #99f6e4",
      display: "inline-flex",
      alignItems: "center",
      gap: "5px",
      alignSelf: "flex-end",
      animation: "slideUp 0.25s ease",
    }}>
      <span style={{ fontSize: "13px", lineHeight: 1 }}>👏</span>
      <span style={{ fontSize: "11px", color: "#0f766e", fontWeight: "600" }}>{text || "smart move"}</span>
    </div>
  );
}

// ─── Compact repeat nudge (same-level re-trigger — one line, signals only) ───

function CompactNudge({ analysis, onDismiss }) {
  const isWarning = analysis?.threat_level === "warning";
  const color  = isWarning ? "#f97316" : "#ef4444";
  const bg     = isWarning ? "#fff7ed" : "#fef2f2";
  const border = isWarning ? "#fed7aa" : "#fecaca";
  const text   = isWarning ? "#7c2d12" : "#7f1d1d";
  const label  = (analysis?.signals || []).join(" · ") || "suspicious pattern";
  return (
    <div style={{
      margin: "3px 12px 4px",
      padding: "5px 28px 5px 10px",
      borderRadius: "20px",
      background: bg,
      border: `1px solid ${border}`,
      display: "inline-flex",
      alignItems: "center",
      gap: "6px",
      alignSelf: "flex-start",
      animation: "slideUp 0.25s ease",
      position: "relative",
      maxWidth: "90%",
    }}>
      <Shield color={color} size={11} />
      <span style={{ fontSize: "11px", color: text, fontWeight: "600", whiteSpace: "nowrap",
                     overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      <button onClick={onDismiss} style={{
        position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)",
        background: "none", border: "none", cursor: "pointer",
        color: text, opacity: 0.4, fontSize: "11px", lineHeight: 1, padding: "1px 2px",
      }}>✕</button>
    </div>
  );
}

// ─── Ambient caution toast (appears briefly, then fades) ─────────────────────

function CautionToast({ visible }) {
  return (
    <div style={{
      margin: "4px 12px",
      padding: "5px 11px",
      borderRadius: "20px",
      background: "#fef9c3",
      border: "1px solid #fde047",
      display: "inline-flex",
      alignItems: "center",
      gap: "6px",
      opacity: visible ? 1 : 0,
      animation: visible ? "fadeInOut 2.5s ease forwards" : "none",
      alignSelf: "flex-start",
    }}>
      <Shield color="#eab308" size={12} />
      <span style={{ fontSize: "11px", color: "#713f12", fontWeight: "600" }}>
        Guardian noticed something
      </span>
    </div>
  );
}

// ─── Typing dots ─────────────────────────────────────────────────────────────

function Dots() {
  return (
    <span style={{ display: "inline-flex", gap: "3px", alignItems: "center", verticalAlign: "middle" }}>
      {[0,1,2].map(i => (
        <span key={i} style={{
          width: "4px", height: "4px", borderRadius: "50%", background: "#94a3b8",
          animation: `bounce 1.2s ease-in-out ${i*0.2}s infinite`, display: "inline-block",
        }} />
      ))}
    </span>
  );
}

// ─── Message bubble ──────────────────────────────────────────────────────────

function Bubble({ msg, isPhone }) {
  const isSender = msg.from === "sender";
  const isKid    = msg.from === "kid";

  if (!isPhone) {
    return (
      <div style={{
        display: "flex", justifyContent: isKid ? "flex-start" : "flex-end",
        marginBottom: "6px", padding: "0 16px",
      }}>
        <div style={{
          maxWidth: "72%", padding: "9px 14px",
          borderRadius: isKid ? "18px 18px 18px 4px" : "18px 18px 4px 18px",
          background: isKid ? "#334155" : "#0ea5e9",
          color: "white", fontSize: "14px", lineHeight: "1.5",
        }}>{msg.text}</div>
      </div>
    );
  }

  return (
    <div style={{
      display: "flex", justifyContent: isSender ? "flex-start" : "flex-end",
      marginBottom: "4px", padding: "0 12px",
    }}>
      {isSender && (
        <div style={{
          width: "28px", height: "28px", borderRadius: "50%",
          background: "linear-gradient(135deg, #f59e0b, #ef4444)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "12px", color: "white", fontWeight: "700",
          marginRight: "6px", flexShrink: 0,
          alignSelf: "flex-end", marginBottom: "2px",
        }}>M</div>
      )}
      <div style={{
        maxWidth: "72%", padding: "9px 13px",
        borderRadius: isSender ? "18px 18px 18px 4px" : "18px 18px 4px 18px",
        background: isSender ? "#f1f5f9" : "linear-gradient(135deg, #14b8a6, #0d9488)",
        color: isSender ? "#1e293b" : "white",
        fontSize: "14px", lineHeight: "1.5",
        boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
      }}>
        {msg.text}
        {msg.analyzing && <span style={{ marginLeft: 6 }}><Dots /></span>}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function GuardianDemo() {
  const [messages,      setMessages]      = useState([]);
  const [senderInput,   setSenderInput]   = useState("");
  const [kidInput,      setKidInput]      = useState("");
  const [analyzing,     setAnalyzing]     = useState(false);
  const [shieldLevel,   setShieldLevel]   = useState("safe");
  // tracks highest level shown so far (card only shown on escalation)
  const highestShown = useRef(0);
  const highestLevel = useRef("safe");
  // running log of all threat signals detected — persists across full conversation
  const threatHistory = useRef([]); // [{ turn, level, signals, snippet }]
  const senderTurnCount = useRef(0);
  // per-message card dismissed state
  const [dismissed, setDismissed] = useState({});

  const phoneRef = useRef(null);
  const senderRef = useRef(null);

  useEffect(() => {
    if (phoneRef.current)  phoneRef.current.scrollTop  = phoneRef.current.scrollHeight;
    if (senderRef.current) senderRef.current.scrollTop = senderRef.current.scrollHeight;
  }, [messages]);

  const sendFromSender = async () => {
    if (!senderInput.trim() || analyzing) return;
    const text = senderInput.trim();
    setSenderInput("");
    setAnalyzing(true);
    senderTurnCount.current += 1;

    const id = Date.now();
    setMessages(prev => [...prev, { id, from: "sender", text, analyzing: true, analysis: null, showCard: false, showRepeat: false, showCaution: false }]);

    try {
      const analysis = await analyzeMessage(messages, text, threatHistory.current, highestLevel.current);
      const level = analysis?.threat_level || "safe";
      const rank  = THREAT_RANK[level] ?? 0;

      // append to threat history if any signals detected
      if (analysis?.signals?.length > 0 && rank >= 1) {
        threatHistory.current = [...threatHistory.current, {
          turn: senderTurnCount.current,
          level,
          signals: analysis.signals,
          snippet: text.length > 60 ? text.slice(0, 60) + "…" : text,
        }];
      }

      // update ambient shield and highest level (never downgrade)
      if (rank > THREAT_RANK[highestLevel.current]) highestLevel.current = level;
      setShieldLevel(prev => rank > THREAT_RANK[prev] ? level : prev);

      // show full card only on escalation; compact repeat nudge for same-level re-triggers
      const showCard    = rank >= 2 && rank > highestShown.current;
      const showRepeat  = rank >= 2 && rank <= highestShown.current;
      const showCaution = rank === 1 && rank > highestShown.current;
      if (rank > highestShown.current) highestShown.current = rank;

      setMessages(prev => prev.map(m =>
        m.id === id ? { ...m, analyzing: false, analysis, showCard, showRepeat, showCaution } : m
      ));
    } catch {
      setMessages(prev => prev.map(m => m.id === id ? { ...m, analyzing: false } : m));
    }
    setAnalyzing(false);
  };

  const sharedSensitiveInfo = (text) => {
    const t = text.toLowerCase();
    return (
      /@[a-z0-9._]{2,}/.test(t) ||
      /\d{3}[-.\s]?\d{3,4}[-.\s]?\d{4}/.test(t) ||
      /\b(snap|insta|instagram|tiktok|discord|telegram|whatsapp)\b/.test(t) ||
      /\b(i live|my address|my school|my number|here's my|here is my|you can find me|my ig|my sc)\b/.test(t) ||
      /\b(photo|pic|picture|selfie|sending you)\b/.test(t)
    );
  };

  const sendFromKid = async () => {
    if (!kidInput.trim()) return;
    const text = kidInput.trim();
    const warningActive = highestShown.current >= 2;
    const id = Date.now();
    setMessages(prev => [...prev, { id, from: "kid", text, regretNudge: false, regretText: null, kudos: false, kudosText: "" }]);
    setKidInput("");

    if (warningActive) {
      // show nudge immediately with loading dots, fill text when ready
      setMessages(prev => prev.map(m => m.id === id ? { ...m, regretNudge: true, regretText: null } : m));
      const { heeding, text: reactionText } = await evaluateKidReply(messages, text);
      const fallback = "Does that feel like the right move?";
      if (heeding) {
        setMessages(prev => prev.map(m => m.id === id
          ? { ...m, regretNudge: false, kudos: true, kudosText: reactionText || "smart move" }
          : m));
      } else {
        setMessages(prev => prev.map(m => m.id === id
          ? { ...m, regretText: reactionText || fallback }
          : m));
      }
    }
  };

  const enter = (e, fn) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); fn(); } };

  const shieldColor = COLORS[shieldLevel]?.shield || "#94a3b8";
  const shieldPulse = shieldLevel === "warning" || shieldLevel === "danger";

  return (
    <div style={{
      height: "100vh", display: "flex",
      background: "#0f172a",
      fontFamily: "'DM Sans', system-ui, sans-serif",
      overflow: "hidden",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeInOut {
          0%   { opacity: 0; }
          15%  { opacity: 1; }
          70%  { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); }
          40%           { transform: translateY(-4px); }
        }
        @keyframes ripple {
          0%   { transform: scale(0.8); opacity: 0.4; }
          100% { transform: scale(2.2); opacity: 0; }
        }
        textarea:focus, input:focus { outline: none; }
      `}</style>

      {/* ── LEFT: Sender panel ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", borderRight: "1px solid #1e293b" }}>
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #1e293b" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
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
            <div style={{
              marginLeft: "auto", background: "#1e293b", border: "1px solid #334155",
              borderRadius: 20, padding: "4px 10px", fontSize: 11, color: "#94a3b8",
            }}>SENDER VIEW</div>
          </div>
        </div>

        <div ref={senderRef} style={{
          flex: 1, overflowY: "auto", padding: "16px 0",
          display: "flex", flexDirection: "column",
          justifyContent: messages.length === 0 ? "center" : "flex-start",
        }}>
          {messages.length === 0 ? (
            <div style={{ textAlign: "center", padding: "0 32px" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>💬</div>
              <div style={{ fontSize: 14, color: "#475569", lineHeight: 1.6 }}>
                Type a message below to send to Jamie.<br/>
                <span style={{ color: "#334155" }}>Try something suspicious to see the Guardian AI respond.</span>
              </div>
            </div>
          ) : messages.map(m => <Bubble key={m.id} msg={m} isPhone={false} />)}
        </div>

        <div style={{
          padding: "16px 20px", borderTop: "1px solid #1e293b",
          display: "flex", gap: 10, alignItems: "flex-end",
        }}>
          <textarea
            value={senderInput}
            onChange={e => setSenderInput(e.target.value)}
            onKeyDown={e => enter(e, sendFromSender)}
            placeholder="Send a message to Jamie..."
            rows={1}
            style={{
              flex: 1, background: "#1e293b", border: "1px solid #334155",
              borderRadius: 12, color: "#f1f5f9", fontSize: 14,
              padding: "10px 14px", resize: "none", fontFamily: "inherit", lineHeight: 1.5,
            }}
          />
          <button onClick={sendFromSender} disabled={analyzing || !senderInput.trim()} style={{
            width: 40, height: 40, borderRadius: 12, border: "none",
            background: analyzing || !senderInput.trim() ? "#1e293b" : "#0ea5e9",
            color: "white", cursor: analyzing || !senderInput.trim() ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "background 0.2s", flexShrink: 0,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
              <path d="M22 2L11 13M22 2L15 22 11 13 2 9l20-7z"/>
            </svg>
          </button>
        </div>
      </div>

      {/* ── RIGHT: Kid's phone ── */}
      <div style={{
        width: 420, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        padding: "24px 32px", background: "#0f172a", flexShrink: 0,
      }}>
        <div style={{
          fontSize: 11, color: "#334155", letterSpacing: "0.12em",
          textTransform: "uppercase", fontWeight: 600, marginBottom: 16,
        }}>Jamie's Phone</div>

        <div style={{
          width: 340, height: 680,
          background: "#ffffff", borderRadius: 44,
          border: "8px solid #1e293b",
          display: "flex", flexDirection: "column", overflow: "hidden",
          boxShadow: "0 25px 60px rgba(0,0,0,0.5), inset 0 0 0 1px #334155",
          position: "relative",
        }}>
          {/* notch */}
          <div style={{
            position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)",
            width: 120, height: 28, background: "#1e293b",
            borderRadius: "0 0 20px 20px", zIndex: 10,
          }} />

          {/* status bar */}
          <div style={{
            height: 44, background: "#f8fafc",
            display: "flex", alignItems: "flex-end", justifyContent: "space-between",
            padding: "0 20px 6px", flexShrink: 0,
          }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#1e293b" }}>9:41</span>
            <div style={{ width: 14, height: 8, border: "1.5px solid #1e293b", borderRadius: 2 }}>
              <div style={{ width: "70%", height: "100%", background: "#22c55e", borderRadius: 1 }} />
            </div>
          </div>

          {/* chat header */}
          <div style={{
            padding: "10px 16px 12px", background: "#f8fafc",
            borderBottom: "1px solid #e2e8f0",
            display: "flex", alignItems: "center", gap: 10, flexShrink: 0,
          }}>
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
            {/* ambient shield — always visible, changes color silently */}
            <div style={{ marginLeft: "auto", transition: "all 0.6s ease" }}>
              <Shield color={shieldColor} size={24} pulse={shieldPulse} />
            </div>
          </div>

          {/* messages */}
          <div ref={phoneRef} style={{
            flex: 1, overflowY: "auto", paddingTop: 12, paddingBottom: 8,
            background: "#f8fafc", display: "flex", flexDirection: "column",
          }}>
            {messages.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 20px" }}>
                <div style={{ fontSize: 28, marginBottom: 10 }}>🛡️</div>
                <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>
                  Guardian is watching quietly.<br/>Waiting for Marcus to send something.
                </div>
              </div>
            ) : messages.map(msg => (
              <div key={msg.id}>
                <Bubble msg={msg} isPhone={true} />

                {/* caution: brief ambient toast, no card */}
                {msg.from === "sender" && msg.showCaution && (
                  <CautionToast visible={true} />
                )}

                {/* warning/danger: card, only on escalation, dismissible */}
                {msg.from === "sender" && msg.showCard && msg.analysis && !dismissed[msg.id] && (
                  <GuardianCard
                    analysis={msg.analysis}
                    onDismiss={() => setDismissed(prev => ({ ...prev, [msg.id]: true }))}
                  />
                )}

                {/* compact repeat nudge — same level re-triggered, signals only */}
                {msg.from === "sender" && msg.showRepeat && msg.analysis && !dismissed[`repeat_${msg.id}`] && (
                  <CompactNudge
                    analysis={msg.analysis}
                    onDismiss={() => setDismissed(prev => ({ ...prev, [`repeat_${msg.id}`]: true }))}
                  />
                )}

                {/* kudos pill — kid showed good instinct by heeding a nudge */}
                {msg.from === "kid" && msg.kudos && (
                  <KudosPill text={msg.kudosText} />
                )}

                {/* regret nudge — after kid replies without heeding */}
                {msg.from === "kid" && msg.regretNudge && !dismissed[`regret_${msg.id}`] && (
                  <RegretNudge
                    text={msg.regretText}
                    onDismiss={() => setDismissed(prev => ({ ...prev, [`regret_${msg.id}`]: true }))}
                  />
                )}

                {/* analyzing indicator — silent, tucked small */}
                {msg.analyzing && (
                  <div style={{
                    margin: "3px 12px", display: "inline-flex", alignItems: "center",
                    gap: 6, opacity: 0.5,
                  }}>
                    <Shield color="#94a3b8" size={12} />
                    <span style={{ fontSize: 11, color: "#94a3b8" }}>analyzing</span>
                    <Dots />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* kid input */}
          <div style={{
            padding: "10px 12px", background: "#ffffff",
            borderTop: "1px solid #e2e8f0",
            display: "flex", gap: 8, alignItems: "center", flexShrink: 0,
          }}>
            <input
              value={kidInput}
              onChange={e => setKidInput(e.target.value)}
              onKeyDown={e => enter(e, sendFromKid)}
              placeholder="Reply as Jamie..."
              style={{
                flex: 1, background: "#f1f5f9", border: "none",
                borderRadius: 20, color: "#0f172a",
                fontSize: 13, padding: "9px 14px", fontFamily: "inherit",
              }}
            />
            <button onClick={sendFromKid} disabled={!kidInput.trim()} style={{
              width: 34, height: 34, borderRadius: "50%", border: "none",
              background: kidInput.trim() ? "linear-gradient(135deg, #14b8a6, #0d9488)" : "#e2e8f0",
              cursor: kidInput.trim() ? "pointer" : "not-allowed",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "background 0.2s", flexShrink: 0,
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
                <path d="M22 2L11 13M22 2L15 22 11 13 2 9l20-7z"/>
              </svg>
            </button>
          </div>
        </div>

        {/* legend */}
        <div style={{ marginTop: 18, display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center" }}>
          {[
            { level: "safe",    label: "Safe · silent" },
            { level: "caution", label: "Caution · ambient" },
            { level: "warning", label: "Warning · nudge" },
            { level: "danger",  label: "Danger · alert" },
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
