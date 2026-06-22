'use client';

import { useEffect, useCallback, useReducer, useRef } from 'react';
import { ChatSession } from '@/lib/types';
import { loadSessions, saveSessions } from '@/lib/chatLogic';
import ChatWindow from '@/components/ChatWindow/ChatWindow';
import Sidebar from '@/components/Sidebar/Sidebar';
import './page.css';

export type AppTheme = 'light' | 'dark' | 'ocean' | 'forest' | 'sunset' | 'midnight';

interface AppState {
  sessions: ChatSession[];
  activeSessionId: string | null;
  theme: AppTheme;
  mounted: boolean;
  sidebarOpen: boolean;
}

type AppAction =
  | { type: 'INIT'; sessions: ChatSession[]; activeSessionId: string | null; theme: AppTheme }
  | { type: 'SET_SESSIONS'; sessions: ChatSession[]; activeSessionId: string }
  | { type: 'SELECT_SESSION'; id: string }
  | { type: 'NEW_CHAT' }
  | { type: 'SET_THEME'; theme: AppTheme }
  | { type: 'DELETE_SESSION'; id: string }
  | { type: 'TOGGLE_PIN'; id: string }
  | { type: 'RENAME_SESSION'; id: string; title: string }
  | { type: 'TOGGLE_SIDEBAR' };

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'INIT':
      return { ...state, sessions: action.sessions, activeSessionId: action.activeSessionId, theme: action.theme, mounted: true };
    case 'SET_SESSIONS':
      return { ...state, sessions: action.sessions, activeSessionId: action.activeSessionId };
    case 'SELECT_SESSION':
      return { ...state, activeSessionId: action.id };
    case 'NEW_CHAT':
      return { ...state, activeSessionId: null };
    case 'SET_THEME':
      return { ...state, theme: action.theme };
    case 'DELETE_SESSION': {
      const filtered = state.sessions.filter((s) => s.id !== action.id);
      saveSessions(filtered);
      return {
        ...state,
        sessions: filtered,
        activeSessionId: state.activeSessionId === action.id ? (filtered[0]?.id ?? null) : state.activeSessionId,
      };
    }
    case 'TOGGLE_PIN': {
      const updated = state.sessions.map((s) =>
        s.id === action.id ? { ...s, pinned: !s.pinned } : s
      );
      saveSessions(updated);
      return { ...state, sessions: updated };
    }
    case 'RENAME_SESSION': {
      const renamed = state.sessions.map((s) =>
        s.id === action.id ? { ...s, title: action.title } : s
      );
      saveSessions(renamed);
      return { ...state, sessions: renamed };
    }
    case 'TOGGLE_SIDEBAR':
      return { ...state, sidebarOpen: !state.sidebarOpen };
    default:
      return state;
  }
}

const initialState: AppState = { sessions: [], activeSessionId: null, theme: 'dark', mounted: false, sidebarOpen: false };

export default function Home() {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const { sessions, activeSessionId, theme, mounted, sidebarOpen } = state;

  // Hydrate from localStorage on client
  useEffect(() => {
    const stored = loadSessions();
    const storedTheme = (localStorage.getItem('aria-theme') as AppTheme) ?? 'dark';
    dispatch({ type: 'INIT', sessions: stored, activeSessionId: stored[0]?.id ?? null, theme: storedTheme });
  }, []);

  // Sync theme to <html> and localStorage
  useEffect(() => {
    if (!mounted) return;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('aria-theme', theme);
  }, [theme, mounted]);

  const handleSessionUpdate = useCallback((updatedSessions: ChatSession[], activeId: string) => {
    dispatch({ type: 'SET_SESSIONS', sessions: updatedSessions, activeSessionId: activeId });
  }, []);

  const handleSelectSession = useCallback((id: string) => {
    dispatch({ type: 'SELECT_SESSION', id });
  }, []);

  const handleNewChat = useCallback(() => {
    dispatch({ type: 'NEW_CHAT' });
  }, []);

  const handleSetTheme = useCallback((t: AppTheme) => {
    dispatch({ type: 'SET_THEME', theme: t });
  }, []);

  const handleDeleteSession = useCallback((id: string) => {
    dispatch({ type: 'DELETE_SESSION', id });
  }, []);

  const handleTogglePin = useCallback((id: string) => {
    dispatch({ type: 'TOGGLE_PIN', id });
  }, []);

  const handleRenameSession = useCallback((id: string, title: string) => {
    dispatch({ type: 'RENAME_SESSION', id, title });
  }, []);

  const handleToggleSidebar = useCallback(() => {
    dispatch({ type: 'TOGGLE_SIDEBAR' });
  }, []);

  // ── Global keyboard shortcuts ────────────────────────────────
  const sidebarSearchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      // Cmd/Ctrl+K → new chat
      if (mod && e.key === 'k') {
        e.preventDefault();
        handleNewChat();
      }
      // Cmd/Ctrl+/ → focus sidebar search
      if (mod && e.key === '/') {
        e.preventDefault();
        const el = document.querySelector<HTMLInputElement>('.sidebar__search-input');
        el?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleNewChat]);

  if (!mounted) {
    return (
      <div className="app-shell app-shell--loading">
        <div className="app-shell__splash">
          <div className="app-shell__splash-icon">✦</div>
          <p>Loading Aria…</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`app-shell${sidebarOpen ? ' app-shell--sidebar-open' : ''}`} data-theme={theme}>
      {/* Backdrop for mobile sidebar */}
      {sidebarOpen && (
        <div className="app-shell__backdrop" onClick={handleToggleSidebar} aria-hidden="true" />
      )}
      <Sidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={(id) => { handleSelectSession(id); dispatch({ type: 'TOGGLE_SIDEBAR' }); }}
        onNewChat={() => { handleNewChat(); if (sidebarOpen) dispatch({ type: 'TOGGLE_SIDEBAR' }); }}
        onDeleteSession={handleDeleteSession}
        onTogglePin={handleTogglePin}
        onRenameSession={handleRenameSession}
        theme={theme}
        onSetTheme={handleSetTheme}
      />
      <main className="app-shell__main">
        <ChatWindow
          sessionId={activeSessionId}
          onSessionUpdate={handleSessionUpdate}
          onMenuToggle={handleToggleSidebar}
        />
      </main>
    </div>
  );
}
