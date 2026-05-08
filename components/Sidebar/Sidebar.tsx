'use client';

import { useState, useEffect } from 'react';
import { ChatSession } from '@/lib/types';
import type { AppTheme } from '@/app/page';
import './Sidebar.css';

// ── Icons ─────────────────────────────────────────────────────────

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" />
    </svg>
  );
}

function PinIcon({ filled }: { filled?: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2L9 9H3l5.25 4.5L6 21l6-4.5L18 21l-2.25-7.5L21 9h-6z" />
    </svg>
  );
}

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
  onDeleteSession: (id: string) => void;
  onTogglePin: (id: string) => void;
  theme: AppTheme;
  onSetTheme: (theme: AppTheme) => void;
}

interface AuthUser {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  role: 'user' | 'admin';
}

const AVATAR_EMOJIS = ['😊', '🦊', '🐱', '🐸', '🐼', '🦁', '🐨', '🦋', '🌟', '🎯', '🚀', '💎'];

function formatDate(date: Date): string {
  const d = new Date(date);
  const now = new Date();
  const diffMs   = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7)  return `${diffDays}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Component ─────────────────────────────────────────────────────

export default function Sidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewChat,
  onDeleteSession,
  onTogglePin,
  theme,
  onSetTheme,
}: SidebarProps) {
  const [showThemes,     setShowThemes]     = useState(false);
  const [searchQuery,    setSearchQuery]    = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [user,           setUser]           = useState<AuthUser | null>(null);

  // Fetch current user
  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => d?.user && setUser(d.user))
      .catch(() => {});
  }, []);

  // ── Filter + sort (pinned first) ──────────────────────────────
  const filtered = searchQuery.trim()
    ? sessions.filter(
        (s) =>
          s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.messages.some((m) =>
            m.content.toLowerCase().includes(searchQuery.toLowerCase())
          )
      )
    : sessions;

  const pinned   = filtered.filter((s) => s.pinned);
  const unpinned = filtered.filter((s) => !s.pinned);
  const sorted   = [...pinned, ...unpinned];

  // ── Avatar display ────────────────────────────────────────────
  const avatarDisplay = user
    ? AVATAR_EMOJIS.includes(user.avatar ?? '')
      ? user.avatar
      : user.name.slice(0, 2).toUpperCase()
    : null;

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
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        New Conversation
      </button>

      {/* Search */}
      <div className="sidebar__search">
        <svg className="sidebar__search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="search"
          className="sidebar__search-input"
          placeholder="Search conversations…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search conversations"
        />
        {searchQuery && (
          <button className="sidebar__search-clear" onClick={() => setSearchQuery('')} type="button" aria-label="Clear search">×</button>
        )}
      </div>

      {/* History list */}
      <nav className="sidebar__history" aria-label="Previous conversations">
        {sessions.length === 0 ? (
          <p className="sidebar__empty">No conversations yet. Start chatting!</p>
        ) : sorted.length === 0 ? (
          <p className="sidebar__empty">No matches found.</p>
        ) : (
          <>
            {/* Pinned section label */}
            {pinned.length > 0 && (
              <div className="sidebar__section-label">📌 Pinned</div>
            )}

            <ul className="sidebar__list" role="list">
              {sorted.map((s, idx) => {
                const isFirstUnpinned = s.id === unpinned[0]?.id && pinned.length > 0;
                return (
                  <li key={s.id} className="sidebar__list-item">
                    {isFirstUnpinned && (
                      <div className="sidebar__section-label" style={{ marginTop: '0.5rem' }}>Recent</div>
                    )}

                    {confirmDeleteId === s.id ? (
                      <div className="sidebar__item-confirm">
                        <span className="sidebar__confirm-text">Delete this chat?</span>
                        <button className="sidebar__confirm-yes" onClick={() => { onDeleteSession(s.id); setConfirmDeleteId(null); }} type="button">Delete</button>
                        <button className="sidebar__confirm-no"  onClick={() => setConfirmDeleteId(null)} type="button">Cancel</button>
                      </div>
                    ) : (
                      <div className="sidebar__item-row">
                        <button
                          className={`sidebar__item ${s.id === activeSessionId ? 'sidebar__item--active' : ''} ${s.pinned ? 'sidebar__item--pinned' : ''}`}
                          onClick={() => onSelectSession(s.id)}
                          type="button"
                          aria-current={s.id === activeSessionId ? 'true' : undefined}
                          title={s.title}
                        >
                          <span className="sidebar__item-title">{s.title}</span>
                          <span className="sidebar__item-date">{formatDate(new Date(s.updatedAt))}</span>
                        </button>

                        <div className="sidebar__item-actions">
                          <button
                            className={`sidebar__item-action ${s.pinned ? 'sidebar__item-action--active' : ''}`}
                            onClick={(e) => { e.stopPropagation(); onTogglePin(s.id); }}
                            type="button"
                            aria-label={s.pinned ? 'Unpin' : 'Pin'}
                            title={s.pinned ? 'Unpin' : 'Pin'}
                          >
                            <PinIcon filled={s.pinned} />
                          </button>
                          <button
                            className="sidebar__item-action sidebar__item-action--danger"
                            onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(s.id); }}
                            type="button"
                            aria-label="Delete conversation"
                            title="Delete conversation"
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </nav>

      {/* Footer */}
      <div className="sidebar__footer">
        {/* ── User info ── */}
        {user && (
          <a href="/profile" className="sidebar__user-card">
            <div className="sidebar__user-avatar">
              {avatarDisplay}
            </div>
            <div className="sidebar__user-info">
              <span className="sidebar__user-name">{user.name}</span>
              <span className="sidebar__user-role">{user.role}</span>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 'auto', opacity: 0.4 }}>
              <path d="M9 18l6-6-6-6" />
            </svg>
          </a>
        )}

        {/* ── Theme picker ── */}
        <div className="sidebar__theme-section">
          <button
            className="sidebar__theme-toggle"
            onClick={() => setShowThemes((v) => !v)}
            type="button"
            aria-expanded={showThemes}
            aria-label="Change theme"
          >
            <span className="sidebar__theme-swatch" style={{ background: THEMES.find((t) => t.id === theme)?.swatch }} />
            <span className="sidebar__theme-label">Theme: <strong>{THEMES.find((t) => t.id === theme)?.label}</strong></span>
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
                  <span className="sidebar__theme-option-swatch" style={{ background: t.swatch }} />
                  <span className="sidebar__theme-option-label">{t.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Admin link ── */}
        {user?.role === 'admin' && (
          <a href="/admin" className="sidebar__admin-link" target="_blank" rel="noreferrer">
            <span aria-hidden="true">🔧</span>
            Training Dashboard
          </a>
        )}

        <p className="sidebar__credits">Powered by Next.js 16</p>
      </div>
    </aside>
  );
}
