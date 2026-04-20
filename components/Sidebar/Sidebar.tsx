'use client';

import { useState } from 'react';
import { ChatSession } from '@/lib/types';
import type { AppTheme } from '@/app/page';
import './Sidebar.css';

// ── Theme config ─────────────────────────────────────────────────

export const THEMES: { id: AppTheme; label: string; swatch: string }[] = [
  { id: 'light',    label: 'Light',    swatch: '#f4f4f8' },
  { id: 'dark',     label: 'Dark',     swatch: '#0d0d14' },
  { id: 'ocean',    label: 'Ocean',    swatch: '#030d1a' },
  { id: 'forest',   label: 'Forest',   swatch: '#050e08' },
  { id: 'sunset',   label: 'Sunset',   swatch: '#16050a' },
  { id: 'midnight', label: 'Midnight', swatch: '#000000' },
];

// ── Types ─────────────────────────────────────────────────────────

interface SidebarProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  theme: AppTheme;
  onSetTheme: (theme: AppTheme) => void;
}

function formatDate(date: Date): string {
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Component ─────────────────────────────────────────────────────

export default function Sidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewChat,
  theme,
  onSetTheme,
}: SidebarProps) {
  const [showThemes, setShowThemes] = useState(false);

  return (
    <aside className="sidebar" aria-label="Chat history">
      {/* Brand */}
      <div className="sidebar__brand">
        <div className="sidebar__brand-icon" aria-hidden="true">✦</div>
        <div>
          <span className="sidebar__brand-name">Aria</span>
          <span className="sidebar__brand-tagline">Your AI Companion</span>
        </div>
      </div>

      {/* New chat */}
      <button className="sidebar__new-btn" onClick={onNewChat} type="button">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          width="16"
          height="16"
          aria-hidden="true"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        New Conversation
      </button>

      {/* History list */}
      <nav className="sidebar__history" aria-label="Previous conversations">
        {sessions.length === 0 ? (
          <p className="sidebar__empty">No conversations yet. Start chatting!</p>
        ) : (
          <ul className="sidebar__list" role="list">
            {sessions.map((s) => (
              <li key={s.id}>
                <button
                  className={`sidebar__item ${s.id === activeSessionId ? 'sidebar__item--active' : ''}`}
                  onClick={() => onSelectSession(s.id)}
                  type="button"
                  aria-current={s.id === activeSessionId ? 'true' : undefined}
                  title={s.title}
                >
                  <span className="sidebar__item-title">{s.title}</span>
                  <span className="sidebar__item-date">{formatDate(new Date(s.updatedAt))}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>

      {/* Footer */}
      <div className="sidebar__footer">

        {/* ── Theme picker ── */}
        <div className="sidebar__theme-section">
          <button
            className="sidebar__theme-toggle"
            onClick={() => setShowThemes((v) => !v)}
            type="button"
            aria-expanded={showThemes}
            aria-label="Change theme"
          >
            <span
              className="sidebar__theme-swatch"
              style={{ background: THEMES.find((t) => t.id === theme)?.swatch }}
            />
            <span className="sidebar__theme-label">
              Theme: <strong>{THEMES.find((t) => t.id === theme)?.label}</strong>
            </span>
            <span className="sidebar__theme-arrow">{showThemes ? '▲' : '▼'}</span>
          </button>

          {showThemes && (
            <div className="sidebar__theme-grid">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  className={`sidebar__theme-option ${theme === t.id ? 'sidebar__theme-option--active' : ''}`}
                  onClick={() => { onSetTheme(t.id); setShowThemes(false); }}
                  type="button"
                  title={t.label}
                >
                  <span
                    className="sidebar__theme-option-swatch"
                    style={{ background: t.swatch }}
                  />
                  <span className="sidebar__theme-option-label">{t.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Admin link ── */}
        <a href="/admin" className="sidebar__admin-link" target="_blank" rel="noreferrer">
          <span aria-hidden="true">🔧</span>
          Training Dashboard
        </a>

        <p className="sidebar__credits">Powered by Next.js 16</p>
      </div>
    </aside>
  );
}
