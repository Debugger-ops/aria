'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import './admin.css';

// ── Types ────────────────────────────────────────────────────────

interface Stats {
  totalConversations: number;
  totalMessages: number;
  totalUserMessages: number;
  totalAiMessages: number;
  thumbsUp: number;
  thumbsDown: number;
  exportableTrainingPairs: number;
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

interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  role: 'user' | 'admin';
  createdAt: string;
}

// ── Stacked bar chart (pure SVG) ─────────────────────────────────

function BarChart({ data }: { data: ChartPoint[] }) {
  const maxVal = Math.max(...data.map((d) => d.total), 1);
  const W = 700, H = 150, BAR_W = 26;
  const GAP = (W - data.length * BAR_W) / (data.length + 1);

  return (
    <div className="admin__chart-wrap">
      <svg viewBox={`0 0 ${W} ${H + 36}`} className="admin__chart-svg" aria-label="Messages per day chart">
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
                fill="var(--accent-purple)" opacity="0.75">
                <title>Aria: {d.ai} on {d.label}</title>
              </rect>
              {d.user > 0 && (
                <rect x={x} y={H - totH} width={BAR_W} height={Math.max(userH, 0)} rx={3}
                  fill="var(--accent-blue)" opacity="0.9">
                  <title>You: {d.user} on {d.label}</title>
                </rect>
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

// ── Satisfaction ring (SVG) ───────────────────────────────────────

function SatisfactionRing({ pct }: { pct: number }) {
  const r = 38, circ = 2 * Math.PI * r, dash = (pct / 100) * circ;
  return (
    <svg width="96" height="96" viewBox="0 0 96 96" className="admin__ring-svg">
      <circle cx="48" cy="48" r={r} fill="none" stroke="var(--surface-elevated)" strokeWidth="9" />
      <circle cx="48" cy="48" r={r} fill="none" stroke="var(--accent-teal)" strokeWidth="9"
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        transform="rotate(-90 48 48)" style={{ transition: 'stroke-dasharray 1s ease' }} />
      <text x="48" y="48" textAnchor="middle" dy="0.35em" fontSize="13"
        fontWeight="700" fill="var(--text-primary)">{pct}%</text>
    </svg>
  );
}

// ── Stat card ────────────────────────────────────────────────────

function StatCard({ label, value, icon, color, subtitle }: {
  label: string; value: string | number; icon: string;
  color: 'purple' | 'blue' | 'teal' | 'green' | 'red'; subtitle?: string;
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

// ── Main dashboard component ─────────────────────────────────────

export default function AdminPage() {
  const [stats,        setStats]        = useState<Stats | null>(null);
  const [convs,        setConvs]        = useState<Conversation[]>([]);
  const [chartData,    setChartData]    = useState<ChartPoint[]>([]);
  const [users,        setUsers]        = useState<User[]>([]);
  const [selected,     setSelected]     = useState<Conversation | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [exporting,    setExporting]    = useState(false);
  const [exportFmt,    setExportFmt]    = useState<'openai' | 'simple'>('openai');
  const [onlyPositive, setOnlyPositive] = useState(false);
  const [activeTab,    setActiveTab]    = useState<'overview' | 'conversations' | 'users' | 'export'>('overview');
  const [toast,        setToast]        = useState('');
  const [convSearch,   setConvSearch]   = useState('');

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3500); };

  const [liveMode, setLiveMode] = useState<'realtime' | 'polling' | 'connecting'>('connecting');

  // `silent` skips the loading spinner — used for background live refreshes so
  // the dashboard updates without flashing the loading state.
  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const opts: RequestInit = { cache: 'no-store' }; // never serve a stale browser-cached response
      const [sR, cR, chR, uR] = await Promise.all([
        fetch('/api/admin?action=stats', opts),
        fetch('/api/admin?action=conversations', opts),
        fetch('/api/admin?action=chart-data', opts),
        fetch('/api/admin?action=users', opts),
      ]);
      if (sR.ok)  setStats(await sR.json());
      if (cR.ok)  setConvs(await cR.json());
      if (chR.ok) setChartData(await chR.json());
      if (uR.ok)  setUsers(await uR.json());
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time load on mount
  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Live updates via Server-Sent Events ──────────────────────────
  // Subscribes to /api/admin/stream. Stats arrive instantly (pushed from the
  // server on every chat/feedback event); other collections are refreshed
  // silently. Falls back to the server's polling mode automatically.
  useEffect(() => {
    const es = new EventSource('/api/admin/stream');

    es.addEventListener('meta', (e) => {
      try { setLiveMode(JSON.parse((e as MessageEvent).data).mode); } catch {}
    });
    es.addEventListener('stats', (e) => {
      try { setStats(JSON.parse((e as MessageEvent).data)); } catch {}
    });
    // When a real event fires, refresh the heavier collections in the background.
    es.addEventListener('event', () => { void fetchData(true); });
    es.onerror = () => setLiveMode('connecting');

    return () => es.close();
  }, [fetchData]);

  // Inherit theme from main app
  useEffect(() => {
    const theme = localStorage.getItem('aria-theme') ?? 'dark';
    document.documentElement.setAttribute('data-theme', theme);
  }, []);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res  = await fetch(`/api/admin?action=export&format=${exportFmt}&onlyPositive=${onlyPositive}`);
      const text = await res.text();
      const blob = new Blob([text], { type: 'application/json' });
      const a    = document.createElement('a');
      a.href     = URL.createObjectURL(blob);
      a.download = `aria-training-${exportFmt}-${Date.now()}.jsonl`;
      a.click();
      showToast(`✅ Exported ${text.split('\n').filter(Boolean).length} training pairs`);
    } finally {
      setExporting(false);
    }
  };

  const satisfaction = stats && (stats.thumbsUp + stats.thumbsDown) > 0
    ? Math.round((stats.thumbsUp / (stats.thumbsUp + stats.thumbsDown)) * 100)
    : null;

  const today         = chartData.at(-1);
  const totalActivity = chartData.reduce((s, d) => s + d.total, 0);

  const filteredConvs = convSearch.trim()
    ? convs.filter((c) =>
        c.title.toLowerCase().includes(convSearch.toLowerCase()) ||
        c.messages.some((m) => m.content.toLowerCase().includes(convSearch.toLowerCase()))
      )
    : convs;

  const TABS = [
    { id: 'overview',      label: '📊 Overview'      },
    { id: 'conversations', label: '💬 Conversations' },
    { id: 'users',         label: '👥 Users'         },
    { id: 'export',        label: '📤 Export'        },
  ] as const;

  return (
    <div className="admin">

      {/* Header */}
      <header className="admin__header">
        <div className="admin__header-brand">
          <span className="admin__logo">✦</span>
          <div>
            <h1 className="admin__title">Aria — Training Dashboard</h1>
            <p className="admin__subtitle">Monitor usage · review conversations · export fine-tuning data</p>
          </div>
        </div>
        <div className="admin__header-actions">
          <span className={`admin__live admin__live--${liveMode}`}>
            <span className="admin__live-dot" />
            {liveMode === 'realtime' ? 'Live' : liveMode === 'polling' ? 'Auto' : 'Connecting…'}
          </span>
          <button className="admin__btn admin__btn--ghost" onClick={() => fetchData()} disabled={loading}>
            {loading ? '⟳ Loading…' : '↺ Refresh'}
          </button>
          <Link href="/profile" className="admin__btn admin__btn--ghost">👤 Profile</Link>
          <Link href="/"        className="admin__btn admin__btn--ghost">← Aria</Link>
        </div>
      </header>

      {/* Tabs */}
      <div className="admin__tabs">
        {TABS.map((t) => (
          <button key={t.id}
            className={`admin__tab ${activeTab === t.id ? 'admin__tab--active' : ''}`}
            onClick={() => setActiveTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ══ OVERVIEW ══ */}
      {activeTab === 'overview' && (
        <div className="admin__content">
          <section className="admin__section">
            <h2 className="admin__section-title">At a Glance</h2>
            <div className="admin__cards">
              <StatCard label="Conversations"   value={stats?.totalConversations ?? '—'} icon="💬" color="purple" />
              <StatCard label="Messages Sent"   value={stats?.totalUserMessages  ?? '—'} icon="✍️"  color="blue"   subtitle="By you" />
              <StatCard label="Aria Replies"    value={stats?.totalAiMessages    ?? '—'} icon="🤖" color="teal"   subtitle="Generated" />
              <StatCard label="14-day Activity" value={totalActivity}                    icon="📅" color="green"
                subtitle={today ? `${today.total} messages today` : undefined} />
            </div>
          </section>

          <section className="admin__section">
            <h2 className="admin__section-title">Messages — Last 14 Days</h2>
            {chartData.length > 0
              ? <BarChart data={chartData} />
              : <p className="admin__empty">Start chatting to see activity here.</p>}
          </section>

          {satisfaction !== null && (
            <section className="admin__section">
              <h2 className="admin__section-title">Satisfaction Score</h2>
              <div className="admin__satisfaction-row">
                <SatisfactionRing pct={satisfaction} />
                <div className="admin__satisfaction-detail">
                  <p className="admin__satisfaction-desc">
                    Based on <strong>{(stats?.thumbsUp ?? 0) + (stats?.thumbsDown ?? 0)}</strong> rated messages
                  </p>
                  <div className="admin__feedback-bar-wrap">
                    <div className="admin__feedback-bar">
                      <div className="admin__feedback-bar__fill admin__feedback-bar__fill--up"
                        style={{ width: `${satisfaction}%` }} />
                    </div>
                  </div>
                  <div className="admin__feedback-labels">
                    <span className="admin__feedback-label admin__feedback-label--up">👍 {stats?.thumbsUp} positive</span>
                    <span className="admin__feedback-label admin__feedback-label--down">👎 {stats?.thumbsDown} negative</span>
                  </div>
                  <p className="admin__tip">
                    💡 Rate Aria&apos;s replies in chat to build a quality signal for fine-tuning.
                  </p>
                </div>
              </div>
            </section>
          )}
        </div>
      )}

      {/* ══ CONVERSATIONS ══ */}
      {activeTab === 'conversations' && (
        <div className="admin__content">
          <section className="admin__section">
            <div className="admin__section-header">
              <h2 className="admin__section-title">All Conversations <span className="admin__count-badge">{convs.length}</span></h2>
              <div className="admin__search-wrap">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input type="search" className="admin__search"
                  placeholder="Search by title or content…"
                  value={convSearch} onChange={(e) => setConvSearch(e.target.value)} />
              </div>
            </div>

            {filteredConvs.length === 0 ? (
              <p className="admin__empty">{convSearch ? 'No matches.' : 'No conversations yet — start chatting!'}</p>
            ) : (
              <div className="admin__conv-layout">
                <div className="admin__conv-list">
                  {filteredConvs.map((c) => (
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
      )}

      {/* ══ USERS ══ */}
      {activeTab === 'users' && (
        <div className="admin__content">
          <section className="admin__section">
            <h2 className="admin__section-title">Registered Users <span className="admin__count-badge">{users.length}</span></h2>
            {users.length === 0 ? (
              <p className="admin__empty">No users registered yet.</p>
            ) : (
              <div className="admin__users-table-wrap">
                <table className="admin__users-table">
                  <thead><tr><th>User</th><th>Email</th><th>Role</th><th>Joined</th></tr></thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id}>
                        <td>
                          <div className="admin__user-cell">
                            <div className="admin__user-avatar">{u.avatar ?? u.name.slice(0,2).toUpperCase()}</div>
                            <span className="admin__user-name">{u.name}</span>
                          </div>
                        </td>
                        <td className="admin__cell-muted">{u.email}</td>
                        <td><span className={`admin__role-badge admin__role-badge--${u.role}`}>{u.role}</span></td>
                        <td className="admin__cell-muted">
                          {new Date(u.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="admin__section">
            <h2 className="admin__section-title">Platform Summary</h2>
            <div className="admin__cards">
              <StatCard label="Total Users"       value={users.length}                             icon="👥" color="blue" />
              <StatCard label="Admins"             value={users.filter(u=>u.role==='admin').length} icon="🔧" color="purple" />
              <StatCard label="Training Pairs"     value={stats?.exportableTrainingPairs ?? '—'}   icon="📦" color="teal" />
              <StatCard label="High-Quality Pairs" value={stats?.thumbsUp ?? '—'}                  icon="⭐" color="green" subtitle="Thumbs-up only" />
            </div>
          </section>
        </div>
      )}

      {/* ══ EXPORT ══ */}
      {activeTab === 'export' && (
        <div className="admin__content">
          <section className="admin__section">
            <h2 className="admin__section-title">Training Data Overview</h2>
            <div className="admin__cards">
              <StatCard label="All Pairs"       value={stats?.exportableTrainingPairs ?? '—'} icon="📦" color="purple" subtitle="Every user→AI pair" />
              <StatCard label="High-Quality"    value={stats?.thumbsUp ?? '—'}                icon="⭐" color="green"  subtitle="Thumbs-up rated" />
              <StatCard label="Total in DB"     value={stats?.totalMessages ?? '—'}           icon="🗄️"  color="blue" />
              <StatCard label="Needs Work"      value={stats?.thumbsDown ?? '—'}              icon="⚠️" color="red"   subtitle="Thumbs-down rated" />
            </div>
          </section>

          <section className="admin__section">
            <h2 className="admin__section-title">Export Fine-Tuning Data</h2>
            <div className="admin__export-panel">
              <p className="admin__export-desc">
                Download conversations as a <strong>.jsonl</strong> file ready for OpenAI, Anthropic, HuggingFace, or any fine-tuning platform.
              </p>
              <div className="admin__export-options">
                <div className="admin__option-group">
                  <label className="admin__option-label">Format</label>
                  <div className="admin__radio-group">
                    <label className="admin__radio">
                      <input type="radio" name="fmt" value="openai" checked={exportFmt === 'openai'} onChange={() => setExportFmt('openai')} />
                      <span><strong>OpenAI / Anthropic</strong><small>{`{"messages":[{"role":"system",...}]}`}</small></span>
                    </label>
                    <label className="admin__radio">
                      <input type="radio" name="fmt" value="simple" checked={exportFmt === 'simple'} onChange={() => setExportFmt('simple')} />
                      <span><strong>Simple Pairs</strong><small>{`{"prompt":"…","completion":"…"}`}</small></span>
                    </label>
                  </div>
                </div>
                <div className="admin__option-group">
                  <label className="admin__option-label">Filter</label>
                  <label className="admin__checkbox">
                    <input type="checkbox" checked={onlyPositive} onChange={(e) => setOnlyPositive(e.target.checked)} />
                    <span><strong>Positive-rated only</strong><small>Export only 👍 responses for highest-quality data</small></span>
                  </label>
                </div>
              </div>
              <div className="admin__export-footer">
                <div className="admin__export-count">
                  {onlyPositive ? `${stats?.thumbsUp ?? 0}` : `${stats?.exportableTrainingPairs ?? 0}`} pairs will be exported
                </div>
                <button className="admin__btn admin__btn--primary" onClick={handleExport}
                  disabled={exporting || (stats?.exportableTrainingPairs ?? 0) === 0}>
                  {exporting ? '⏳ Exporting…' : '⬇ Download .jsonl'}
                </button>
              </div>
            </div>
          </section>

          <section className="admin__section">
            <h2 className="admin__section-title">How to Use This Data</h2>
            <div className="admin__guide">
              {[
                { n:1, title:'Collect conversations', body:'Chat with Aria naturally. Every conversation is saved automatically.' },
                { n:2, title:'Rate the responses',    body:'Click 👍 on good replies and 👎 on bad ones to create a quality signal.' },
                { n:3, title:'Export your JSONL',     body:'Download the file. Choose "positive-rated only" for the cleanest dataset.' },
                { n:4, title:'Fine-tune a model',     body:'Upload to OpenAI Fine-tuning, HuggingFace, or use locally with LLaMA-Factory.' },
              ].map(({ n, title, body }) => (
                <div key={n} className="admin__guide-step">
                  <div className="admin__guide-num">{n}</div>
                  <div><strong>{title}</strong><p>{body}</p></div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {toast && <div className="admin__toast">{toast}</div>}
    </div>
  );
}
