'use client';

import { useState, useEffect, useCallback } from 'react';
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

// ── Component ────────────────────────────────────────────────────

export default function AdminPage() {
  const [stats, setStats]           = useState<Stats | null>(null);
  const [convs, setConvs]           = useState<Conversation[]>([]);
  const [selected, setSelected]     = useState<Conversation | null>(null);
  const [loading, setLoading]       = useState(true);
  const [exporting, setExporting]   = useState(false);
  const [exportFmt, setExportFmt]   = useState<'openai' | 'simple'>('openai');
  const [onlyPositive, setOnlyPositive] = useState(false);
  const [activeTab, setActiveTab]   = useState<'user' | 'admin'>('user');
  const [toast, setToast]           = useState('');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, convsRes] = await Promise.all([
        fetch('/api/admin?action=stats'),
        fetch('/api/admin?action=conversations'),
      ]);
      setStats(await statsRes.json());
      setConvs(await convsRes.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const url = `/api/admin?action=export&format=${exportFmt}&onlyPositive=${onlyPositive}`;
      const res = await fetch(url);
      const text = await res.text();
      const blob = new Blob([text], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `aria-training-${exportFmt}-${Date.now()}.jsonl`;
      a.click();
      showToast(`✅ Exported ${text.split('\n').filter(Boolean).length} training pairs`);
    } finally {
      setExporting(false);
    }
  };

  const satisfaction = stats
    ? stats.thumbsUp + stats.thumbsDown > 0
      ? Math.round((stats.thumbsUp / (stats.thumbsUp + stats.thumbsDown)) * 100)
      : null
    : null;

  return (
    <div className="admin">
      {/* ── Header ── */}
      <header className="admin__header">
        <div className="admin__header-brand">
          <span className="admin__logo">✦</span>
          <div>
            <h1 className="admin__title">Aria — Training Dashboard</h1>
            <p className="admin__subtitle">Collect, review and export conversation data for AI fine-tuning</p>
          </div>
        </div>
        <div className="admin__header-actions">
          <button className="admin__btn admin__btn--ghost" onClick={fetchData} disabled={loading}>
            {loading ? '⟳ Loading…' : '↺ Refresh'}
          </button>
          <a href="/" className="admin__btn admin__btn--ghost">← Back to Aria</a>
        </div>
      </header>

      {/* ── Tabs ── */}
      <div className="admin__tabs">
        <button
          className={`admin__tab ${activeTab === 'user' ? 'admin__tab--active' : ''}`}
          onClick={() => setActiveTab('user')}
        >
          👤 User Overview
        </button>
        <button
          className={`admin__tab ${activeTab === 'admin' ? 'admin__tab--active' : ''}`}
          onClick={() => setActiveTab('admin')}
        >
          🔧 Admin & Export
        </button>
      </div>

      {/* ═══════════ USER TAB ═══════════ */}
      {activeTab === 'user' && (
        <div className="admin__content">
          {/* ── Summary cards ── */}
          <section className="admin__section">
            <h2 className="admin__section-title">📊 Your Conversation Summary</h2>
            <div className="admin__cards">
              <StatCard
                label="Total Conversations"
                value={stats?.totalConversations ?? '—'}
                icon="💬"
                color="purple"
              />
              <StatCard
                label="Messages Sent"
                value={stats?.totalUserMessages ?? '—'}
                icon="✍️"
                color="blue"
              />
              <StatCard
                label="AI Replies Received"
                value={stats?.totalAiMessages ?? '—'}
                icon="🤖"
                color="teal"
              />
              <StatCard
                label="Satisfaction Rate"
                value={satisfaction !== null ? `${satisfaction}%` : '—'}
                icon="😊"
                color="green"
                subtitle={
                  stats
                    ? `${stats.thumbsUp} 👍  ·  ${stats.thumbsDown} 👎`
                    : undefined
                }
              />
            </div>
          </section>

          {/* ── Feedback insight ── */}
          {stats && (stats.thumbsUp + stats.thumbsDown) > 0 && (
            <section className="admin__section">
              <h2 className="admin__section-title">⭐ Feedback Breakdown</h2>
              <div className="admin__feedback-bar-wrap">
                <div className="admin__feedback-bar">
                  <div
                    className="admin__feedback-bar__fill admin__feedback-bar__fill--up"
                    style={{ width: `${satisfaction}%` }}
                  />
                </div>
                <div className="admin__feedback-labels">
                  <span className="admin__feedback-label admin__feedback-label--up">
                    👍 {stats.thumbsUp} positive
                  </span>
                  <span className="admin__feedback-label admin__feedback-label--down">
                    👎 {stats.thumbsDown} negative
                  </span>
                </div>
              </div>
              <p className="admin__tip">
                💡 Tip: Rate AI responses with 👍/👎 in the chat. Positive-rated responses become high-quality training data.
              </p>
            </section>
          )}

          {/* ── Recent conversations ── */}
          <section className="admin__section">
            <h2 className="admin__section-title">🕐 Recent Conversations</h2>
            {convs.length === 0 ? (
              <p className="admin__empty">No conversations yet. Start chatting with Aria!</p>
            ) : (
              <div className="admin__conv-list">
                {convs.map((c) => (
                  <button
                    key={c.sessionId}
                    className={`admin__conv-item ${selected?.sessionId === c.sessionId ? 'admin__conv-item--active' : ''}`}
                    onClick={() => setSelected(selected?.sessionId === c.sessionId ? null : c)}
                  >
                    <div className="admin__conv-item-title">{c.title}</div>
                    <div className="admin__conv-item-meta">
                      {c.messages.length} messages ·{' '}
                      {new Date(c.updatedAt).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Expanded conversation view */}
            {selected && (
              <div className="admin__conv-detail">
                <div className="admin__conv-detail-header">
                  <strong>{selected.title}</strong>
                  <button className="admin__btn admin__btn--xs" onClick={() => setSelected(null)}>✕ Close</button>
                </div>
                <div className="admin__conv-messages">
                  {selected.messages.map((m) => (
                    <div key={m.id} className={`admin__msg admin__msg--${m.role}`}>
                      <span className="admin__msg-role">{m.role === 'user' ? '👤 You' : '✦ Aria'}</span>
                      <p className="admin__msg-text">{m.content}</p>
                      <span className="admin__msg-time">
                        {new Date(m.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {/* ═══════════ ADMIN TAB ═══════════ */}
      {activeTab === 'admin' && (
        <div className="admin__content">
          {/* ── Training data stats ── */}
          <section className="admin__section">
            <h2 className="admin__section-title">🧠 Training Data Overview</h2>
            <div className="admin__cards">
              <StatCard
                label="Training Pairs (All)"
                value={stats?.exportableTrainingPairs ?? '—'}
                icon="📦"
                color="purple"
                subtitle="All user→AI pairs"
              />
              <StatCard
                label="High-Quality Pairs"
                value={stats?.thumbsUp ?? '—'}
                icon="⭐"
                color="green"
                subtitle="Thumbs-up rated only"
              />
              <StatCard
                label="Total Messages in DB"
                value={stats?.totalMessages ?? '—'}
                icon="🗄️"
                color="blue"
              />
              <StatCard
                label="Negative Feedback"
                value={stats?.thumbsDown ?? '—'}
                icon="⚠️"
                color="red"
                subtitle="Responses to improve"
              />
            </div>
          </section>

          {/* ── Export panel ── */}
          <section className="admin__section">
            <h2 className="admin__section-title">📤 Export Training Data</h2>
            <div className="admin__export-panel">
              <p className="admin__export-desc">
                Export conversations as a <strong>.jsonl</strong> file ready for fine-tuning on OpenAI, HuggingFace, Anthropic, or any other platform.
              </p>

              <div className="admin__export-options">
                <div className="admin__option-group">
                  <label className="admin__option-label">Format</label>
                  <div className="admin__radio-group">
                    <label className="admin__radio">
                      <input
                        type="radio"
                        name="format"
                        value="openai"
                        checked={exportFmt === 'openai'}
                        onChange={() => setExportFmt('openai')}
                      />
                      <span>
                        <strong>OpenAI / Anthropic</strong>
                        <small>{`{"messages":[{"role":"system",...},{"role":"user",...},{"role":"assistant",...}]}`}</small>
                      </span>
                    </label>
                    <label className="admin__radio">
                      <input
                        type="radio"
                        name="format"
                        value="simple"
                        checked={exportFmt === 'simple'}
                        onChange={() => setExportFmt('simple')}
                      />
                      <span>
                        <strong>Simple Pairs</strong>
                        <small>{`{"prompt":"user message","completion":"ai reply"}`}</small>
                      </span>
                    </label>
                  </div>
                </div>

                <div className="admin__option-group">
                  <label className="admin__option-label">Filter</label>
                  <label className="admin__checkbox">
                    <input
                      type="checkbox"
                      checked={onlyPositive}
                      onChange={(e) => setOnlyPositive(e.target.checked)}
                    />
                    <span>
                      <strong>Positive-rated responses only</strong>
                      <small>Only include messages users rated 👍 — higher quality training data</small>
                    </span>
                  </label>
                </div>
              </div>

              <div className="admin__export-footer">
                <div className="admin__export-count">
                  {onlyPositive
                    ? `${stats?.thumbsUp ?? 0} pairs will be exported`
                    : `${stats?.exportableTrainingPairs ?? 0} pairs will be exported`}
                </div>
                <button
                  className="admin__btn admin__btn--primary"
                  onClick={handleExport}
                  disabled={exporting || (stats?.exportableTrainingPairs ?? 0) === 0}
                >
                  {exporting ? '⏳ Exporting…' : '⬇ Download .jsonl'}
                </button>
              </div>
            </div>
          </section>

          {/* ── How to use guide ── */}
          <section className="admin__section">
            <h2 className="admin__section-title">📖 How to Use This Data for Training</h2>
            <div className="admin__guide">
              <div className="admin__guide-step">
                <div className="admin__guide-num">1</div>
                <div>
                  <strong>Collect conversations</strong>
                  <p>Chat with Aria naturally. Every conversation is automatically saved to the database.</p>
                </div>
              </div>
              <div className="admin__guide-step">
                <div className="admin__guide-num">2</div>
                <div>
                  <strong>Rate the responses</strong>
                  <p>In the chat, click 👍 on good AI replies and 👎 on bad ones. This creates a quality signal.</p>
                </div>
              </div>
              <div className="admin__guide-step">
                <div className="admin__guide-num">3</div>
                <div>
                  <strong>Export your JSONL file</strong>
                  <p>Download the .jsonl file above. Choose &quot;positive-rated only&quot; for the cleanest dataset.</p>
                </div>
              </div>
              <div className="admin__guide-step">
                <div className="admin__guide-num">4</div>
                <div>
                  <strong>Fine-tune a model</strong>
                  <p>Upload to <a href="https://platform.openai.com/finetune" target="_blank" rel="noreferrer">OpenAI Fine-tuning</a>, <a href="https://huggingface.co" target="_blank" rel="noreferrer">HuggingFace</a>, or use locally with <a href="https://github.com/hiyouga/LLaMA-Factory" target="_blank" rel="noreferrer">LLaMA-Factory</a>.</p>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && <div className="admin__toast">{toast}</div>}
    </div>
  );
}

// ── StatCard sub-component ────────────────────────────────────────

function StatCard({
  label, value, icon, color, subtitle,
}: {
  label: string;
  value: string | number;
  icon: string;
  color: 'purple' | 'blue' | 'teal' | 'green' | 'red';
  subtitle?: string;
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
