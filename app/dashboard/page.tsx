'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import '../admin/admin.css'; // reuse the dashboard styling

// ── Types ────────────────────────────────────────────────────────

interface Stats {
  totalConversations: number;
  totalMessages: number;
  totalUserMessages: number;
  totalAiMessages: number;
}

interface DbMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

interface Conversation {
  sessionId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: DbMessage[];
}

interface ChartPoint {
  date: string;
  label: string;
  user: number;
  ai: number;
  total: number;
}

// ── Stacked bar chart (pure SVG) ─────────────────────────────────

function BarChart({ data }: { data: ChartPoint[] }) {
  const maxVal = Math.max(...data.map((d) => d.total), 1);
  const W = 700, H = 150, BAR_W = 26;
  const GAP = (W - data.length * BAR_W) / (data.length + 1);

  return (
    <div className="admin__chart-wrap">
      <svg viewBox={`0 0 ${W} ${H + 36}`} className="admin__chart-svg" aria-label="My messages per day">
        {[0.25, 0.5, 0.75, 1].map((frac) => (
          <line key={frac} x1={0} y1={H - frac * H} x2={W} y2={H - frac * H}
            stroke="var(--border-color)" strokeWidth="1" strokeDasharray="4,4" />
        ))}
        {data.map((d, i) => {
          const x     = GAP + i * (BAR_W + GAP);
          const aiH   = (d.ai   / maxVal) * H;
          const userH = (d.user / maxVal) * H;
          const totH  = aiH + userH;
          return (
            <g key={d.date}>
              <rect x={x} y={H - aiH} width={BAR_W} height={Math.max(aiH, 0)} rx={3}
                fill="var(--accent-purple)" opacity="0.75" />
              {d.user > 0 && (
                <rect x={x} y={H - totH} width={BAR_W} height={Math.max(userH, 0)} rx={3}
                  fill="var(--accent-blue)" opacity="0.9" />
              )}
              {d.total > 0 && (
                <text x={x + BAR_W / 2} y={H - totH - 5} textAnchor="middle"
                  fontSize="8" fill="var(--text-muted)">{d.total}</text>
              )}
              {i % 2 === 0 && (
                <text x={x + BAR_W / 2} y={H + 18} textAnchor="middle"
                  fontSize="8.5" fill="var(--text-muted)">{d.label}</text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="admin__chart-legend">
        <span className="admin__legend-dot" style={{ background: 'var(--accent-blue)' }} />
        <span>Your messages</span>
        <span className="admin__legend-dot" style={{ background: 'var(--accent-purple)' }} />
        <span>Aria replies</span>
      </div>
    </div>
  );
}

// ── Stat card ────────────────────────────────────────────────────

function StatCard({ label, value, icon, color, subtitle }: {
  label: string; value: string | number; icon: string;
  color: 'purple' | 'blue' | 'teal' | 'green'; subtitle?: string;
}) {
  return (
    <div className={`stat-card stat-card--${color}`}>
      <div className="stat-card__icon">{icon}</div>
      <div className="stat-card__value">{value}</div>
      <div className="stat-card__label">{label}</div>
      {subtitle && <div className="stat-card__subtitle">{subtitle}</div>}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [stats,     setStats]     = useState<Stats | null>(null);
  const [convs,     setConvs]     = useState<Conversation[]>([]);
  const [chartData, setChartData] = useState<ChartPoint[]>([]);
  const [selected,  setSelected]  = useState<Conversation | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [authed,    setAuthed]    = useState(true);
  const [live,      setLive]      = useState(false);

  const fetchData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const opts: RequestInit = { cache: 'no-store' };
      const [sR, cR, chR] = await Promise.all([
        fetch('/api/me/dashboard?action=stats', opts),
        fetch('/api/me/dashboard?action=conversations', opts),
        fetch('/api/me/dashboard?action=chart-data', opts),
      ]);
      if (sR.status === 401) { setAuthed(false); return; }
      if (sR.ok)  setStats(await sR.json());
      if (cR.ok)  setConvs(await cR.json());
      if (chR.ok) setChartData(await chR.json());
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time load on mount
  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Live updates ───────────────────────────────────────────────
  // Subscribes to /api/me/stream, which pushes whenever THIS user's data
  // changes. Previously the dashboard only ever loaded once on mount, which is
  // why it looked frozen while the admin page (already wired to its own stream)
  // updated fine. `stats` arrive on the wire; conversations and chart data are
  // refetched quietly so the panel doesn't flash a loading state.
  useEffect(() => {
    const es = new EventSource('/api/me/stream');

    es.addEventListener('meta', () => setLive(true));

    es.addEventListener('stats', (e) => {
      try { setStats(JSON.parse((e as MessageEvent).data)); } catch { /* ignore */ }
    });

    es.addEventListener('event', () => { void fetchData(true); });

    es.onerror = () => setLive(false);

    return () => es.close();
  }, [fetchData]);

  useEffect(() => {
    const theme = localStorage.getItem('aria-theme') ?? 'dark';
    document.documentElement.setAttribute('data-theme', theme);
  }, []);

  const today         = chartData.at(-1);
  const totalActivity = chartData.reduce((s, d) => s + d.total, 0);

  if (!authed) {
    return (
      <div className="admin">
        <header className="admin__header">
          <div className="admin__header-brand">
            <span className="admin__logo">✦</span>
            <div><h1 className="admin__title">My Dashboard</h1></div>
          </div>
        </header>
        <div className="admin__content">
          <p className="admin__empty">
            Please <Link href="/login?from=/dashboard" className="auth-link">sign in</Link> to see your activity.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin">
      <header className="admin__header">
        <div className="admin__header-brand">
          <span className="admin__logo">✦</span>
          <div>
            <h1 className="admin__title">My Dashboard</h1>
            <p className="admin__subtitle">
              Your conversations and activity with Aria
              {live && <span className="admin__live" title="Updating live"> · ● live</span>}
            </p>
          </div>
        </div>
        <div className="admin__header-actions">
          <button className="admin__btn admin__btn--ghost" onClick={() => fetchData()} disabled={loading}>
            {loading ? '⟳ Loading…' : '↺ Refresh'}
          </button>
          <Link href="/profile" className="admin__btn admin__btn--ghost">👤 Profile</Link>
          <Link href="/"        className="admin__btn admin__btn--ghost">← Aria</Link>
        </div>
      </header>

      <div className="admin__content">
        {/* Stats */}
        <section className="admin__section">
          <h2 className="admin__section-title">At a Glance</h2>
          <div className="admin__cards">
            <StatCard label="My Conversations" value={stats?.totalConversations ?? '—'} icon="💬" color="purple" />
            <StatCard label="Messages Sent"    value={stats?.totalUserMessages  ?? '—'} icon="✍️" color="blue"  subtitle="By you" />
            <StatCard label="Aria Replies"     value={stats?.totalAiMessages    ?? '—'} icon="🤖" color="teal"  subtitle="To you" />
            <StatCard label="14-day Activity"  value={totalActivity}                    icon="📅" color="green"
              subtitle={today ? `${today.total} messages today` : undefined} />
          </div>
        </section>

        {/* Activity chart */}
        <section className="admin__section">
          <h2 className="admin__section-title">My Messages — Last 14 Days</h2>
          {chartData.some((d) => d.total > 0)
            ? <BarChart data={chartData} />
            : <p className="admin__empty">Start chatting with Aria to see your activity here.</p>}
        </section>

        {/* Conversation history */}
        <section className="admin__section">
          <h2 className="admin__section-title">
            My Conversations <span className="admin__count-badge">{convs.length}</span>
          </h2>
          {convs.length === 0 ? (
            <p className="admin__empty">No conversations yet — say hi to Aria!</p>
          ) : (
            <div className="admin__conv-layout">
              <div className="admin__conv-list">
                {convs.map((c) => (
                  <button key={c.sessionId}
                    className={`admin__conv-item ${selected?.sessionId === c.sessionId ? 'admin__conv-item--active' : ''}`}
                    onClick={() => setSelected(selected?.sessionId === c.sessionId ? null : c)}>
                    <div className="admin__conv-item-title">{c.title}</div>
                    <div className="admin__conv-item-meta">
                      <span>{c.messages.length} msgs</span>
                      <span>{new Date(c.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                    </div>
                  </button>
                ))}
              </div>

              {selected && (
                <div className="admin__conv-detail">
                  <div className="admin__conv-detail-header">
                    <div>
                      <strong className="admin__conv-detail-title">{selected.title}</strong>
                      <div className="admin__conv-detail-meta">
                        {selected.messages.length} messages · {new Date(selected.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <button className="admin__btn admin__btn--xs" onClick={() => setSelected(null)}>✕</button>
                  </div>
                  <div className="admin__conv-messages">
                    {selected.messages.map((m) => (
                      <div key={m.id} className={`admin__msg admin__msg--${m.role}`}>
                        <div className="admin__msg-header">
                          <span className="admin__msg-role">{m.role === 'user' ? '👤 You' : '✦ Aria'}</span>
                          <span className="admin__msg-time">
                            {new Date(m.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="admin__msg-text">{m.content}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
