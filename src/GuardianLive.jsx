import { useState, useRef, useEffect } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────

const THREAT_RANK = { safe: 0, caution: 1, warning: 2, danger: 3 };

const COLORS = {
  safe:    { shield: "#94a3b8", card: null },
  caution: { shield: "#f59e0b", card: null },
  warning: { shield: "#f97316", card: { bg: "#fff7ed", border: "#fed7aa", text: "#7c2d12", badge: "#f97316", label: "Heads up" } },
  danger:  { shield: "#ef4444", card: { bg: "#fef2f2", border: "#fecaca", text: "#7f1d1d", badge: "#ef4444", label: "Be careful" } },
};

const CHANNEL = "guardian-live-v1";

// ─── System Prompts ───────────────────────────────────────────────────────────

const GUARDIAN_SYSTEM_PROMPT = `You are a guardian AI protecting a child from online predators. Your job is to detect grooming patterns across a whole conversation — not just flag individual bad messages.

CRITICAL: Grooming is a slow process. A single suspicious message may only warrant "caution". But the same signal appearing again later, after meandering small talk designed to build false trust, is a PATTERN — and patterns escalate threat level regardless of how innocent the current message looks in isolation.

Analyze each new message in light of the full threat history provided. Ask: is this message a new step in an ongoing grooming arc?

ESCALATION RULES (apply these strictly):
- Two or more personal info requests across the conversation (school, address, age, photos, social handles, phone) = danger, even if spaced far apart. The meander between asks IS the grooming tactic.
- Any personal info request from an unknown contact in the first 5 turns = warning minimum (too fast, no established trust).
- Platform switch request after ANY prior suspicious signal = danger.
- Secrecy request ("don't tell your parents") at any point = danger immediately.
- Love bombing + any follow-up personal ask = danger.
- Never return a level LOWER than the current highest unless you have strong reason.

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
  "pattern_reasoning": "One sentence on arc/pattern, empty if isolated.",
  "kid_nudge": "Only for warning/danger: one short curious question in peer voice. Never preachy. Empty for safe/caution.",
  "guardian_note": "One sentence for parent dashboard.",
  "confidence": 0-100
}

threat_level:
- safe: no red flags
- caution: worth watching, unusually friendly for a new contact
- warning: clear manipulation or personal info request too early
- danger: grooming pattern confirmed, solicitation, secrecy request, or repeated personal info extraction

signals: 2-3 word labels only. E.g. "asks school", "platform switch", "moves fast", "secrecy request".`;

const BULLY_SYSTEM_PROMPT = `You are a guardian AI protecting a child from online bullying. Your job is to detect bullying patterns across a whole conversation — not just flag individual harsh messages.

CRITICAL: Bullying is often gradual. A single unkind message may be banter. But repeated put-downs, exclusion, or threats from the same contact — especially from a known peer — constitute a pattern. Rate in context of the full history.

Analyze each new message in light of the full threat history provided. Ask: is this message part of a sustained bullying pattern?

ESCALATION RULES (apply these strictly):
- Repeated insults or name-calling across two or more turns = danger, even if spaced apart.
- Any explicit threat ("I'll tell everyone", "you'll regret this", "watch your back") = danger immediately.
- Coordinated language ("we all think", "everyone agrees", "nobody likes you") = danger — signals a group pile-on.
- Coercion ("if you don't X, I'll Y") at any point = danger immediately.
- Humiliation threat (threatening to share embarrassing content, photos, secrets) = danger immediately.
- Sustained negativity from a known peer across turns = escalate one level above the individual message score.
- Never return a level LOWER than the current highest unless you have strong reason.

Signals to detect:
- Direct insults or name-calling ("you're so ugly", "nobody likes you")
- Exclusion language ("don't come", "we don't want you there")
- Threats ("I'll tell everyone", "you'll regret this")
- Coordinated pressure ("everyone thinks", "we all agree")
- Coercion ("do this or I'll...")
- Humiliation tactics (threatening to share content, mockery of appearance/identity)
- Persistent negativity (unkind messages across multiple turns from same contact)
- Gaslighting ("you're too sensitive", "it's just a joke", "stop being dramatic")

Respond ONLY with this exact JSON:
{
  "threat_level": "safe" | "caution" | "warning" | "danger",
  "signals": ["label 1", "label 2"],
  "pattern_reasoning": "One sentence on arc/pattern, empty if isolated.",
  "kid_nudge": "Only for warning/danger: one short warm question that opens a door without inflaming. E.g. 'That didn't sound kind — are you doing ok?' or 'Do you want to talk to someone you trust about this?' Never preachy. Empty for safe/caution.",
  "guardian_note": "One sentence for parent dashboard, including pattern context if relevant.",
  "confidence": 0-100
}

threat_level:
- safe: normal conversation, no unkindness
- caution: mildly unkind, could be banter — worth watching
- warning: clear insult, exclusion, or single threat
- danger: sustained pattern, serious threat, coercion, or humiliation

signals: 2-3 word labels only. E.g. "direct insult", "exclusion language", "threat made", "coordinated pressure", "coercion", "persistent negativity", "gaslighting".`;

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

IMPORTANT: Default to IGNORING unless there is a clear, unmistakable signal of caution.

IF HEEDING — respond with a brief kudos label only. 2–4 words max, lowercase, warm but not patronising. E.g. "good call", "trust that instinct", "smart".

IF IGNORING — respond with a single gentle question in peer voice. Not advice. Not a warning. Just something that makes them pause. 1–2 sentences max.

Respond ONLY with JSON:
{
  "outcome": "heeding" | "ignoring",
  "text": "your kudos label or gentle question here"
}`;

// ─── API helpers ──────────────────────────────────────────────────────────────

async function analyzeMessage(messages, newMessage, threatHistory, currentHighestLevel) {
  const turnCount = messages.filter(m => m.from === "sender").length + 1;
  const recentHistory = messages.slice(-10)
    .map(m => `${m.from === "sender" ? "Contact" : "Child"}: ${m.text}`)
    .join("\n");

  const threatBlock = threatHistory.length > 0
    ? `THREAT HISTORY (signals detected so far):\n${
        threatHistory.map(t => `[Turn ${t.turn}, ${t.level}] ${t.signals.join(", ")} — "${t.snippet}"`).join("\n")
      }\n\nCurrent highest threat level: ${currentHighestLevel}\nThis is turn ${turnCount}.`
    : `No threat signals detected yet. This is turn ${turnCount}. Current highest: ${currentHighestLevel}.`;

  const prompt = `${threatBlock}\n\nRecent conversation:\n${recentHistory || "(none)"}\n\nNew message: "${newMessage}"\n\nDetermine the threat level in context of the full conversation arc.`;

  const call = (systemPrompt) => fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
    }),
  }).then(r => r.json()).then(data => {
    const raw = (data.content?.[0]?.text || "").replace(/```json|```/g, "").trim();
    try { return JSON.parse(raw); }
    catch { const m = raw.match(/\{[\s\S]*?\}/); return m ? JSON.parse(m[0]) : null; }
  }).catch(() => null);

  // run both tracks in parallel
  const [predator, bully] = await Promise.all([
    call(GUARDIAN_SYSTEM_PROMPT),
    call(BULLY_SYSTEM_PROMPT),
  ]);

  const predatorRank = THREAT_RANK[predator?.threat_level] ?? 0;
  const bullyRank    = THREAT_RANK[bully?.threat_level]    ?? 0;

  // content comes from whichever track scored higher (tie → predator)
  const winner = bullyRank > predatorRank ? bully : predator;

  // tags are independent — collect every track that actually fired (rank ≥ 1)
  const threat_types = [
    predatorRank >= 1 && "predator",
    bullyRank    >= 1 && "bully",
  ].filter(Boolean);

  return { ...winner, threat_types };
}

async function evaluateKidReply(conversationHistory, kidReply) {
  const recentNudge = [...conversationHistory].reverse()
    .find(m => m.from === "sender" && m.analysis?.kid_nudge);

  const history = conversationHistory.slice(-8)
    .map(m => `${m.from === "sender" ? "Unknown contact" : "Child"}: ${m.text}`)
    .join("\n");

  const nudgeLine = recentNudge?.analysis?.kid_nudge
    ? `The Guardian previously asked the child: "${recentNudge.analysis.kid_nudge}"`
    : `The Guardian had flagged this conversation as suspicious.`;

  const prompt = `${nudgeLine}\n\nRecent conversation:\n${history}\n\nThe child just replied: "${kidReply}"\n\nDid they heed the warning or ignore it?`;

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

// ─── Shared UI primitives ─────────────────────────────────────────────────────

function Shield({ color, size = 20, pulse = false }) {
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      {pulse && (
        <div style={{
          position: "absolute", inset: -4, borderRadius: "50%",
          background: color, opacity: 0.25,
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

function Dots() {
  return (
    <span style={{ display: "inline-flex", gap: "3px", alignItems: "center" }}>
      {[0,1,2].map(i => (
        <span key={i} style={{
          width: "4px", height: "4px", borderRadius: "50%", background: "currentColor",
          opacity: 0.5,
          animation: `bounce 1.2s ease-in-out ${i*0.2}s infinite`, display: "inline-block",
        }} />
      ))}
    </span>
  );
}

// ─── Guardian overlays ────────────────────────────────────────────────────────



function GuardianCard({ analysis, onDismiss }) {
  const c = COLORS[analysis.threat_level];
  if (!c?.card) return null;
  const { bg, border, text, badge, label } = c.card;
  return (
    <div style={{
      margin: "6px 12px 2px", borderRadius: "14px",
      border: `1.5px solid ${border}`, background: bg,
      padding: "11px 13px", animation: "slideUp 0.25s ease", position: "relative",
    }}>
      <button onClick={onDismiss} style={{
        position: "absolute", top: 8, right: 8,
        background: "none", border: "none", cursor: "pointer",
        color: text, opacity: 0.4, fontSize: "14px", padding: "2px 4px",
      }}>✕</button>
      <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "7px" }}>
        <Shield color={badge} size={15} />
        <span style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.07em",
                       textTransform: "uppercase", color: badge }}>Guardian</span>
        <span style={{ background: badge, color: "white", fontSize: "10px",
                       fontWeight: "700", padding: "1px 7px", borderRadius: "20px" }}>{label}</span>
      </div>
      {analysis.kid_nudge && (
        <p style={{ fontSize: "13px", color: text, margin: "0 0 7px", lineHeight: "1.5", fontWeight: "500" }}>
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

function CompactNudge({ analysis, onDismiss }) {
  const isWarning = analysis?.threat_level === "warning";
  const color  = isWarning ? "#f97316" : "#ef4444";
  const bg     = isWarning ? "#fff7ed" : "#fef2f2";
  const border = isWarning ? "#fed7aa" : "#fecaca";
  const text   = isWarning ? "#7c2d12" : "#7f1d1d";
  const label  = (analysis?.signals || []).slice(0, 2).join(" · ") || "suspicious pattern";
  return (
    <div style={{
      margin: "3px 12px 4px", padding: "5px 28px 5px 10px",
      borderRadius: "20px", background: bg, border: `1px solid ${border}`,
      display: "inline-flex", alignItems: "center", gap: "6px",
      alignSelf: "flex-start", animation: "slideUp 0.25s ease",
      position: "relative", maxWidth: "90%",
    }}>
      <Shield color={color} size={11} />
      <span style={{ fontSize: "11px", color: text, fontWeight: "600",
                     whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      <button onClick={onDismiss} style={{
        position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)",
        background: "none", border: "none", cursor: "pointer",
        color: text, opacity: 0.4, fontSize: "11px", padding: "1px 2px",
      }}>✕</button>
    </div>
  );
}

function CautionToast({ visible }) {
  return (
    <div style={{
      margin: "4px 12px", padding: "5px 11px", borderRadius: "20px",
      background: "#fef9c3", border: "1px solid #fde047",
      display: "inline-flex", alignItems: "center", gap: "6px",
      opacity: visible ? 1 : 0,
      animation: visible ? "fadeInOut 2.5s ease forwards" : "none",
      alignSelf: "flex-start",
    }}>
      <Shield color="#eab308" size={12} />
      <span style={{ fontSize: "11px", color: "#713f12", fontWeight: "600" }}>Guardian noticed something</span>
    </div>
  );
}

function RegretNudge({ text, onDismiss }) {
  return (
    <div style={{
      margin: "4px 12px 6px", borderRadius: "14px",
      border: "1.5px solid #e9d5ff", background: "#faf5ff",
      padding: "10px 13px", animation: "slideUp 0.3s ease",
      position: "relative", alignSelf: "flex-end", maxWidth: "88%",
    }}>
      <button onClick={onDismiss} style={{
        position: "absolute", top: 7, right: 8,
        background: "none", border: "none", cursor: "pointer",
        color: "#6b21a8", opacity: 0.35, fontSize: "13px", padding: "2px 4px",
      }}>✕</button>
      <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "6px" }}>
        <Shield color="#a855f7" size={14} />
        <span style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.07em",
                       textTransform: "uppercase", color: "#a855f7" }}>Guardian</span>
      </div>
      {text ? (
        <p style={{ fontSize: "13px", color: "#581c87", margin: 0, lineHeight: "1.5", fontWeight: "500" }}>"{text}"</p>
      ) : (
        <div style={{ color: "#a855f7", opacity: 0.5 }}><Dots /></div>
      )}
    </div>
  );
}

function KudosPill({ text }) {
  return (
    <div style={{
      margin: "3px 12px 4px", padding: "4px 10px", borderRadius: "20px",
      background: "#f0fdfa", border: "1px solid #99f6e4",
      display: "inline-flex", alignItems: "center", gap: "5px",
      alignSelf: "flex-end", animation: "slideUp 0.25s ease",
    }}>
      <span style={{ fontSize: "13px" }}>👏</span>
      <span style={{ fontSize: "11px", color: "#0f766e", fontWeight: "600" }}>{text || "smart move"}</span>
    </div>
  );
}

// ─── CSS ──────────────────────────────────────────────────────────────────────

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'DM Sans', system-ui, sans-serif; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
  @keyframes slideUp {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes fadeInOut {
    0%   { opacity: 0; } 15% { opacity: 1; }
    70%  { opacity: 1; } 100% { opacity: 0; }
  }
  @keyframes bounce {
    0%, 80%, 100% { transform: translateY(0); }
    40%           { transform: translateY(-4px); }
  }
  @keyframes ripple {
    0%   { transform: scale(0.8); opacity: 0.4; }
    100% { transform: scale(2.2); opacity: 0; }
  }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(12px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  textarea:focus, input:focus { outline: none; }
`;

// ─── Lobby ────────────────────────────────────────────────────────────────────

function Lobby({ onSelect }) {
  return (
    <div style={{
      height: "100vh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      background: "#0f172a", padding: "24px",
      fontFamily: "'DM Sans', system-ui, sans-serif",
    }}>
      <style>{CSS}</style>
      <div style={{ marginBottom: 32, textAlign: "center" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 10 }}>
          <Shield color="#14b8a6" size={28} />
          <span style={{ fontSize: 22, fontWeight: 700, color: "#f1f5f9" }}>Guardian Live</span>
        </div>
        <p style={{ color: "#64748b", fontSize: 14, lineHeight: 1.6, maxWidth: 360 }}>
          Open this page in <strong style={{ color: "#94a3b8" }}>two separate windows</strong>.
          Choose a role in each — then start chatting.
        </p>
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", justifyContent: "center" }}>
        <RoleCard
          emoji="🕵️"
          title="Marcus"
          subtitle="Play the unknown contact"
          detail="Send messages to Jamie. Try to build trust."
          accent="#f97316"
          onClick={() => onSelect("sender")}
        />
        <RoleCard
          emoji="📱"
          title="Jamie"
          subtitle="The kid's phone"
          detail="Receive messages. Guardian AI watches in real-time."
          accent="#14b8a6"
          onClick={() => onSelect("kid")}
        />
      </div>

      <p style={{ marginTop: 32, fontSize: 12, color: "#334155", textAlign: "center" }}>
        Guardian AI runs locally in Jamie's window — no data stored.
      </p>
    </div>
  );
}

function RoleCard({ emoji, title, subtitle, detail, accent, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: hover ? "#1e293b" : "#111827",
        border: `1.5px solid ${hover ? accent : "#1e293b"}`,
        borderRadius: 20, padding: "28px 28px 24px",
        width: 220, textAlign: "left", cursor: "pointer",
        transition: "all 0.18s ease",
        animation: "fadeIn 0.4s ease",
        transform: hover ? "translateY(-2px)" : "none",
        boxShadow: hover ? `0 8px 24px ${accent}22` : "none",
      }}
    >
      <div style={{ fontSize: 36, marginBottom: 14 }}>{emoji}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: "#f1f5f9", marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: accent, marginBottom: 10 }}>{subtitle}</div>
      <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6 }}>{detail}</div>
    </button>
  );
}

// ─── Sender view (Marcus's phone) ─────────────────────────────────────────────

function SenderView() {
  const [messages, setMessages] = useState([]);
  const [input, setInput]       = useState("");
  const [peerTyping, setPeerTyping] = useState(false);
  const [connected, setConnected]   = useState(false);
  const channelRef = useRef(null);
  const typingTimer = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    const ch = new BroadcastChannel(CHANNEL);
    channelRef.current = ch;

    ch.postMessage({ type: "ping", from: "sender" });

    ch.onmessage = (e) => {
      const { type, from } = e.data;
      if (type === "ping" && from === "kid") setConnected(true);
      if (type === "pong" && from === "kid") setConnected(true);
      if (type === "msg" && from === "kid") {
        setMessages(prev => [...prev, { id: e.data.id, from: "kid", text: e.data.text }]);
        setPeerTyping(false);
      }
      if (type === "typing" && from === "kid") {
        setPeerTyping(e.data.active);
      }
    };

    return () => ch.close();
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, peerTyping]);

  const handleInput = (val) => {
    setInput(val);
    channelRef.current?.postMessage({ type: "typing", from: "sender", active: val.length > 0 });
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() =>
      channelRef.current?.postMessage({ type: "typing", from: "sender", active: false }), 2000);
  };

  const send = () => {
    if (!input.trim()) return;
    const msg = { id: Date.now(), from: "sender", text: input.trim() };
    setMessages(prev => [...prev, msg]);
    channelRef.current?.postMessage({ type: "msg", ...msg });
    channelRef.current?.postMessage({ type: "typing", from: "sender", active: false });
    setInput("");
  };

  const enter = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };

  return (
    <div style={{
      height: "100vh", display: "flex", flexDirection: "column",
      background: "#0f172a", fontFamily: "'DM Sans', system-ui, sans-serif",
    }}>
      <style>{CSS}</style>

      {/* header */}
      <div style={{
        padding: "16px 20px", borderBottom: "1px solid #1e293b",
        display: "flex", alignItems: "center", gap: 12, flexShrink: 0,
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: "50%",
          background: "linear-gradient(135deg, #14b8a6, #0d9488)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 16, fontWeight: 700, color: "white",
        }}>J</div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#f1f5f9" }}>Jamie</div>
          <div style={{ fontSize: 11, color: connected ? "#22c55e" : "#64748b" }}>
            {connected ? "● connected" : "○ waiting for Jamie's window…"}
          </div>
        </div>
        <div style={{
          marginLeft: "auto", background: "#1e293b", border: "1px solid #f9731622",
          borderRadius: 20, padding: "4px 10px", fontSize: 11, color: "#f97316",
        }}>MARCUS</div>
      </div>

      {/* messages */}
      <div ref={scrollRef} style={{
        flex: 1, overflowY: "auto", padding: "16px 0",
        display: "flex", flexDirection: "column",
      }}>
        {messages.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 32px" }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>💬</div>
            <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.7 }}>
              {connected
                ? "Jamie's window is open. Start a conversation."
                : "Waiting for Jamie's window to open…"}
            </div>
          </div>
        ) : messages.map(msg => (
          <div key={msg.id} style={{
            display: "flex",
            justifyContent: msg.from === "sender" ? "flex-end" : "flex-start",
            padding: "2px 16px", marginBottom: 4,
          }}>
            <div style={{
              maxWidth: "72%", padding: "9px 14px",
              borderRadius: msg.from === "sender" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
              background: msg.from === "sender" ? "#f97316" : "#1e293b",
              color: msg.from === "sender" ? "white" : "#e2e8f0",
              fontSize: 14, lineHeight: 1.5,
            }}>{msg.text}</div>
          </div>
        ))}
        {peerTyping && (
          <div style={{ padding: "4px 16px", display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: "50%",
              background: "linear-gradient(135deg, #14b8a6, #0d9488)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, color: "white", fontWeight: 700,
            }}>J</div>
            <div style={{
              background: "#1e293b", borderRadius: "18px 18px 18px 4px",
              padding: "10px 14px", color: "#94a3b8",
            }}><Dots /></div>
          </div>
        )}
      </div>

      {/* input */}
      <div style={{
        padding: "14px 16px", borderTop: "1px solid #1e293b",
        display: "flex", gap: 10, alignItems: "flex-end", flexShrink: 0,
      }}>
        <textarea
          value={input}
          onChange={e => handleInput(e.target.value)}
          onKeyDown={enter}
          placeholder="Message Jamie…"
          rows={1}
          style={{
            flex: 1, background: "#1e293b", border: "1px solid #334155",
            borderRadius: 12, color: "#f1f5f9", fontSize: 14,
            padding: "10px 14px", resize: "none", lineHeight: 1.5,
          }}
        />
        <button onClick={send} style={{
          background: "#f97316", border: "none", borderRadius: 12,
          width: 42, height: 42, cursor: "pointer", fontSize: 18,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>↑</button>
      </div>
    </div>
  );
}

// ─── Kid view (Jamie's phone) ─────────────────────────────────────────────────

function KidView() {
  const [messages,    setMessages]    = useState([]);
  const [input,       setInput]       = useState("");
  const [shieldLevel, setShieldLevel] = useState("safe");
  const [dismissed,   setDismissed]   = useState({});
  const [senderTyping, setSenderTyping] = useState(false);
  const [connected,   setConnected]   = useState(false);

  const highestShown  = useRef(0);
  const highestLevel  = useRef("safe");
  const threatHistory = useRef([]);
  const senderTurn    = useRef(0);
  const channelRef    = useRef(null);
  const scrollRef     = useRef(null);
  const typingTimer   = useRef(null);
  const analyzingRef  = useRef(false);

  useEffect(() => {
    const ch = new BroadcastChannel(CHANNEL);
    channelRef.current = ch;

    ch.postMessage({ type: "ping", from: "kid" });

    ch.onmessage = async (e) => {
      const { type, from } = e.data;

      if (type === "ping" && from === "sender") {
        setConnected(true);
        ch.postMessage({ type: "pong", from: "kid" });
      }
      if (type === "pong" && from === "sender") setConnected(true);

      if (type === "typing" && from === "sender") {
        setSenderTyping(e.data.active);
      }

      if (type === "msg" && from === "sender") {
        setConnected(true);
        setSenderTyping(false);
        const { id, text } = e.data;
        senderTurn.current += 1;

        setMessages(prev => [...prev, {
          id, from: "sender", text,
          analyzing: true, analysis: null,
          showCard: false, showRepeat: false, showCaution: false,
        }]);

        if (analyzingRef.current) return;
        analyzingRef.current = true;

        try {
          const snapMessages = await new Promise(res => {
            setMessages(prev => { res(prev); return prev; });
          });

          const analysis = await analyzeMessage(snapMessages, text, threatHistory.current, highestLevel.current);
          const level = analysis?.threat_level || "safe";
          const rank  = THREAT_RANK[level] ?? 0;

          if (analysis?.signals?.length > 0 && rank >= 1) {
            threatHistory.current = [...threatHistory.current, {
              turn: senderTurn.current, level,
                            signals: analysis.signals,
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
        } catch {
          setMessages(prev => prev.map(m => m.id === id ? { ...m, analyzing: false } : m));
        }
        analyzingRef.current = false;
      }
    };

    return () => ch.close();
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, senderTyping]);

  const handleInput = (val) => {
    setInput(val);
    channelRef.current?.postMessage({ type: "typing", from: "kid", active: val.length > 0 });
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() =>
      channelRef.current?.postMessage({ type: "typing", from: "kid", active: false }), 2000);
  };

  const send = async () => {
    if (!input.trim()) return;
    const text = input.trim();
    const warningActive = highestShown.current >= 2;
    const id = Date.now();

    setMessages(prev => [...prev, { id, from: "kid", text, regretNudge: false, regretText: null, kudos: false, kudosText: "" }]);
    channelRef.current?.postMessage({ type: "msg", id, from: "kid", text });
    channelRef.current?.postMessage({ type: "typing", from: "kid", active: false });
    setInput("");

    if (warningActive) {
      setMessages(prev => prev.map(m => m.id === id ? { ...m, regretNudge: true, regretText: null } : m));
      const currentMsgs = await new Promise(res => { setMessages(prev => { res(prev); return prev; }); });
      const { heeding, text: reactionText } = await evaluateKidReply(currentMsgs, text);
      if (heeding) {
        setMessages(prev => prev.map(m => m.id === id
          ? { ...m, regretNudge: false, kudos: true, kudosText: reactionText || "smart move" } : m));
      } else {
        setMessages(prev => prev.map(m => m.id === id
          ? { ...m, regretText: reactionText || "Does that feel like the right move?" } : m));
      }
    }
  };

  const enter = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };

  const shieldColor = COLORS[shieldLevel]?.shield || "#94a3b8";
  const shieldPulse = shieldLevel === "warning" || shieldLevel === "danger";

  return (
    <div style={{
      height: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#0f172a", fontFamily: "'DM Sans', system-ui, sans-serif",
    }}>
      <style>{CSS}</style>

      {/* phone frame */}
      <div style={{
        width: 390, height: "100vh", maxHeight: 844,
        background: "white", borderRadius: 44,
        boxShadow: "0 32px 80px rgba(0,0,0,0.6)",
        display: "flex", flexDirection: "column", overflow: "hidden",
        position: "relative",
      }}>

        {/* status bar */}
        <div style={{
          background: "#f8fafc", padding: "12px 24px 8px",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>9:41</span>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 12 }}>●●●</span>
            <span style={{ fontSize: 12 }}>WiFi</span>
            <span style={{ fontSize: 12 }}>🔋</span>
          </div>
        </div>

        {/* chat header */}
        <div style={{
          background: "#f8fafc", padding: "8px 16px 12px",
          borderBottom: "1px solid #e2e8f0",
          display: "flex", alignItems: "center", gap: 10, flexShrink: 0,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: "50%",
            background: "linear-gradient(135deg, #f59e0b, #ef4444)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 14, fontWeight: 700, color: "white",
          }}>M</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#0f172a" }}>Marcus_R27</div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>
              {connected ? "New contact · Met 3 days ago" : "Waiting for Marcus to connect…"}
            </div>
          </div>
          <div style={{ transition: "all 0.6s ease" }}>
            <Shield color={shieldColor} size={24} pulse={shieldPulse} />
          </div>
        </div>

        {/* messages */}
        <div ref={scrollRef} style={{
          flex: 1, overflowY: "auto", padding: "12px 0 8px",
          background: "#f8fafc", display: "flex", flexDirection: "column",
        }}>
          {messages.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px 20px" }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>🛡️</div>
              <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>
                Guardian is watching quietly.<br/>Waiting for Marcus to say something.
              </div>
            </div>
          )}

          {messages.map(msg => (
            <div key={msg.id}>
              {/* message bubble */}
              <div style={{
                display: "flex",
                justifyContent: msg.from === "sender" ? "flex-start" : "flex-end",
                padding: "2px 12px", marginBottom: 2,
              }}>
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
                  fontSize: 14, lineHeight: 1.5,
                  boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
                }}>
                  {msg.text}
                  {msg.analyzing && <span style={{ marginLeft: 6, color: "#94a3b8" }}><Dots /></span>}
                </div>
              </div>

              {/* guardian overlays */}
              {msg.from === "sender" && msg.showCaution && <CautionToast visible={true} />}

              {msg.from === "sender" && msg.showCard && msg.analysis && !dismissed[msg.id] && (
                <GuardianCard
                  analysis={msg.analysis}
                  onDismiss={() => setDismissed(p => ({ ...p, [msg.id]: true }))}
                />
              )}

              {msg.from === "sender" && msg.showRepeat && msg.analysis && !dismissed[`r_${msg.id}`] && (
                <CompactNudge
                  analysis={msg.analysis}
                  onDismiss={() => setDismissed(p => ({ ...p, [`r_${msg.id}`]: true }))}
                />
              )}

              {msg.from === "kid" && msg.kudos && <KudosPill text={msg.kudosText} />}

              {msg.from === "kid" && msg.regretNudge && !dismissed[`rg_${msg.id}`] && (
                <RegretNudge
                  text={msg.regretText}
                  onDismiss={() => setDismissed(p => ({ ...p, [`rg_${msg.id}`]: true }))}
                />
              )}

              {msg.from === "sender" && msg.analyzing && (
                <div style={{ margin: "3px 12px", display: "inline-flex", alignItems: "center", gap: 6, opacity: 0.45 }}>
                  <Shield color="#94a3b8" size={12} />
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>analyzing</span>
                  <Dots />
                </div>
              )}
            </div>
          ))}

          {senderTyping && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 12px" }}>
              <div style={{
                width: 28, height: 28, borderRadius: "50%",
                background: "linear-gradient(135deg, #f59e0b, #ef4444)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 12, color: "white", fontWeight: 700, flexShrink: 0,
              }}>M</div>
              <div style={{
                background: "#f1f5f9", borderRadius: "18px 18px 18px 4px",
                padding: "10px 14px", color: "#94a3b8",
              }}><Dots /></div>
            </div>
          )}
        </div>

        {/* input */}
        <div style={{
          padding: "10px 12px", background: "#ffffff",
          borderTop: "1px solid #e2e8f0",
          display: "flex", gap: 8, alignItems: "center", flexShrink: 0,
        }}>
          <input
            value={input}
            onChange={e => handleInput(e.target.value)}
            onKeyDown={enter}
            placeholder="Reply as Jamie…"
            style={{
              flex: 1, background: "#f1f5f9", border: "none",
              borderRadius: 22, padding: "10px 16px",
              fontSize: 14, color: "#0f172a",
            }}
          />
          <button onClick={send} style={{
            background: "linear-gradient(135deg, #14b8a6, #0d9488)",
            border: "none", borderRadius: "50%",
            width: 36, height: 36, cursor: "pointer", fontSize: 16, color: "white",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>↑</button>
        </div>
      </div>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function GuardianLive() {
  const params = new URLSearchParams(window.location.search);
  const roleParam = params.get("role");
  const [role, setRole] = useState(roleParam || null);

  const select = (r) => {
    const url = new URL(window.location.href);
    url.searchParams.set("role", r);
    window.history.replaceState({}, "", url);
    setRole(r);
  };

  if (!role)           return <Lobby onSelect={select} />;
  if (role === "sender") return <SenderView />;
  return <KidView />;
}
