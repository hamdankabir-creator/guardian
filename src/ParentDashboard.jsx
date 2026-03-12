import { useState, useEffect, useRef } from "react";

const PARENT_CHANNEL = "guardian-parent-v1";

const LEVEL_META = {
  danger:  { color: "#ef4444", bg: "#fef2f2", border: "#fecaca", badge: "#ef4444", label: "Danger",  dot: "#ef4444" },
  warning: { color: "#f97316", bg: "#fff7ed", border: "#fed7aa", badge: "#f97316", label: "Warning", dot: "#f97316" },
  caution: { color: "#eab308", bg: "#fefce8", border: "#fef08a", badge: "#eab308", label: "Caution", dot: "#eab308" },
};

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'DM Sans', system-ui, sans-serif; background: #f8fafc; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
  @keyframes slideDown {
    from { opacity: 0; transform: translateY(-6px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.4; }
  }
`;

function Shield({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#14b8a6">
      <path d="M12 2L4 6v6c0 5.5 3.8 10.7 8 12 4.2-1.3 8-6.5 8-12V6l-8-4z"/>
      <path d="M9 12l2 2 4-4" stroke="white" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </svg>
  );
}

function ThreatBadge({ level }) {
  const m = LEVEL_META[level];
  if (!m) return null;
  return (
    <span style={{
      background: m.badge, color: "white",
      fontSize: 10, fontWeight: 700, padding: "2px 8px",
      borderRadius: 20, textTransform: "uppercase", letterSpacing: "0.06em",
    }}>{m.label}</span>
  );
}

function SignalPill({ label, color, bg }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: "3px 8px",
      borderRadius: 20, background: bg, color,
    }}>{label}</span>
  );
}

function AlertCard({ alert, isNew }) {
  const [expanded, setExpanded] = useState(false);
  const m = LEVEL_META[alert.level] || LEVEL_META.caution;
  const time = new Date(alert.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div style={{
      background: "white", borderRadius: 16,
      border: `1.5px solid ${isNew ? m.border : "#e2e8f0"}`,
      overflow: "hidden",
      animation: isNew ? "slideDown 0.3s ease" : "none",
      boxShadow: isNew ? `0 4px 20px ${m.color}18` : "0 1px 4px rgba(0,0,0,0.05)",
      transition: "box-shadow 0.3s ease",
    }}>
      {/* Card header */}
      <div style={{
        padding: "14px 16px",
        background: isNew ? m.bg : "white",
        display: "flex", alignItems: "flex-start", gap: 12,
        cursor: "pointer",
        transition: "background 0.3s ease",
      }} onClick={() => setExpanded(e => !e)}>
        {/* Contact avatar */}
        <div style={{
          width: 38, height: 38, borderRadius: "50%", flexShrink: 0,
          background: "linear-gradient(135deg, #f59e0b, #ef4444)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 15, fontWeight: 700, color: "white",
        }}>M</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>Marcus_R27</span>
            <ThreatBadge level={alert.level} />
            {isNew && (
              <span style={{
                fontSize: 10, fontWeight: 700, color: "#14b8a6",
                textTransform: "uppercase", letterSpacing: "0.06em",
                animation: "pulse 2s ease infinite",
              }}>● New</span>
            )}
            <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: "auto" }}>{time}</span>
          </div>

          {/* Snippet */}
          <p style={{
            fontSize: 13, color: "#475569", lineHeight: 1.5,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            "{alert.snippet}"
          </p>
        </div>

        <div style={{ fontSize: 16, color: "#94a3b8", flexShrink: 0, marginTop: 2 }}>
          {expanded ? "▲" : "▼"}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ borderTop: `1px solid ${m.border}`, padding: "14px 16px", background: m.bg }}>
          {/* Signals */}
          {alert.signals?.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
                Signals detected
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {alert.signals.map((s, i) => (
                  <SignalPill key={i} label={s} color={m.color} bg={`${m.badge}18`} />
                ))}
              </div>
            </div>
          )}

          {/* Pattern reasoning */}
          {alert.pattern_reasoning && (
            <div style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
                Guardian's assessment
              </p>
              <p style={{ fontSize: 13, color: "#334155", lineHeight: 1.6, fontStyle: "italic" }}>
                "{alert.pattern_reasoning}"
              </p>
            </div>
          )}

          {/* Guardian note */}
          {alert.guardian_note && (
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
                Recommended action
              </p>
              <p style={{ fontSize: 13, color: "#334155", lineHeight: 1.6 }}>
                {alert.guardian_note}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{ textAlign: "center", padding: "80px 32px" }}>
      <div style={{ marginBottom: 16 }}>
        <Shield size={48} />
      </div>
      <h3 style={{ fontSize: 17, fontWeight: 600, color: "#334155", marginBottom: 8 }}>
        All clear
      </h3>
      <p style={{ fontSize: 14, color: "#94a3b8", lineHeight: 1.6, maxWidth: 300, margin: "0 auto" }}>
        No flagged conversations yet. Guardian will notify you here when something needs your attention.
      </p>
      <p style={{ fontSize: 12, color: "#cbd5e1", marginTop: 24 }}>
        Open the demo tab and send some messages to see alerts appear in real time.
      </p>
    </div>
  );
}

function SummaryBar({ alerts }) {
  const counts = { danger: 0, warning: 0, caution: 0 };
  alerts.forEach(a => { if (counts[a.level] !== undefined) counts[a.level]++; });
  const highest = counts.danger > 0 ? "danger" : counts.warning > 0 ? "warning" : counts.caution > 0 ? "caution" : null;

  return (
    <div style={{
      display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24,
    }}>
      {Object.entries(counts).map(([level, count]) => {
        const m = LEVEL_META[level];
        return (
          <div key={level} style={{
            flex: 1, minWidth: 100,
            background: count > 0 ? m.bg : "white",
            border: `1.5px solid ${count > 0 ? m.border : "#e2e8f0"}`,
            borderRadius: 12, padding: "12px 16px",
          }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: count > 0 ? m.color : "#cbd5e1" }}>{count}</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: count > 0 ? m.color : "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>{m.label}</div>
          </div>
        );
      })}
    </div>
  );
}

export default function ParentDashboard() {
  const [alerts, setAlerts] = useState([]);
  const [newIds, setNewIds] = useState(new Set());
  const channelRef = useRef(null);

  useEffect(() => {
    const ch = new BroadcastChannel(PARENT_CHANNEL);
    channelRef.current = ch;

    ch.onmessage = (e) => {
      if (e.data?.type !== "guardian-alert") return;
      const alert = { ...e.data.payload, id: Date.now(), timestamp: Date.now() };

      setAlerts(prev => {
        // keep only the latest alert per threat level — prepend newest
        return [alert, ...prev].slice(0, 20);
      });
      setNewIds(prev => new Set([...prev, alert.id]));

      // fade "new" badge after 8s
      setTimeout(() => {
        setNewIds(prev => {
          const next = new Set(prev); next.delete(alert.id); return next;
        });
      }, 8000);
    };

    return () => ch.close();
  }, []);

  // sort: danger first, then warning, then caution
  const sorted = [...alerts].sort((a, b) =>
    (LEVEL_META[b.level] ? Object.keys(LEVEL_META).indexOf(b.level) : 99) -
    (LEVEL_META[a.level] ? Object.keys(LEVEL_META).indexOf(a.level) : 99) ||
    b.timestamp - a.timestamp
  );

  const highestLevel = sorted[0]?.level;
  const hm = highestLevel ? LEVEL_META[highestLevel] : null;

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <style>{CSS}</style>

      {/* Header */}
      <div style={{
        background: "white", borderBottom: "1px solid #e2e8f0",
        padding: "0 24px",
        position: "sticky", top: 0, zIndex: 10,
      }}>
        <div style={{ maxWidth: 720, margin: "0 auto", height: 64, display: "flex", alignItems: "center", gap: 12 }}>
          <Shield size={26} />
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#0f172a" }}>Guardian</div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>Parent dashboard · Jamie's account</div>
          </div>

          {hm && (
            <div style={{
              marginLeft: "auto", display: "flex", alignItems: "center", gap: 6,
              background: hm.bg, border: `1px solid ${hm.border}`,
              borderRadius: 20, padding: "5px 12px",
            }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: hm.color, animation: "pulse 2s ease infinite" }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: hm.color }}>{hm.label} alert active</span>
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "28px 24px" }}>

        {/* Child summary pill */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          background: "white", borderRadius: 14, border: "1px solid #e2e8f0",
          padding: "14px 16px", marginBottom: 24,
          boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: "50%",
            background: "linear-gradient(135deg, #14b8a6, #0d9488)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16, fontWeight: 700, color: "white",
          }}>J</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>Jamie</div>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>
              {alerts.length === 0
                ? "No alerts today"
                : `${alerts.length} alert${alerts.length > 1 ? "s" : ""} flagged`}
            </div>
          </div>
          <div style={{ marginLeft: "auto", fontSize: 12, color: "#94a3b8" }}>
            {new Date().toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}
          </div>
        </div>

        {/* Summary counts */}
        {alerts.length > 0 && <SummaryBar alerts={alerts} />}

        {/* Section label */}
        {alerts.length > 0 && (
          <p style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>
            Flagged conversations
          </p>
        )}

        {/* Alert cards */}
        {sorted.length === 0 ? (
          <EmptyState />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {sorted.map(alert => (
              <AlertCard key={alert.id} alert={alert} isNew={newIds.has(alert.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
