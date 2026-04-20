'use client';

import { useEffect, useCallback, useReducer } from 'react';
import { ChatSession } from '@/lib/types';
import { loadSessions } from '@/lib/chatLogic';
import ChatWindow from '@/components/ChatWindow/ChatWindow';
import Sidebar from '@/components/Sidebar/Sidebar';
import './page.css';

export type AppTheme = 'light' | 'dark' | 'ocean' | 'forest' | 'sunset' | 'midnight';

interface AppState {
  sessions: ChatSession[];
  activeSessionId: string | null;
  theme: AppTheme;
  mounted: boolean;
}

type AppAction =
  | { type: 'INIT'; sessions: ChatSession[]; activeSessionId: string | null; theme: AppTheme }
  | { type: 'SET_SESSIONS'; sessions: ChatSession[]; activeSessionId: string }
  | { type: 'SELECT_SESSION'; id: string }
  | { type: 'NEW_CHAT' }
  | { type: 'SET_THEME'; theme: AppTheme };

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'INIT':
      return {
        ...state,
        sessions: action.sessions,
        activeSessionId: action.activeSessionId,
        theme: action.theme,
        mounted: true,
      };
    case 'SET_SESSIONS':
      return { ...state, sessions: action.sessions, activeSessionId: action.activeSessionId };
    case 'SELECT_SESSION':
      return { ...state, activeSessionId: action.id };
    case 'NEW_CHAT':
      return { ...state, activeSessionId: null };
    case 'SET_THEME':
      return { ...state, theme: action.theme };
    default:
      return state;
  }
}

const initialState: AppState = {
  sessions: [],
  activeSessionId: null,
  theme: 'dark',
  mounted: false,
};

export default function Home() {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const { sessions, activeSessionId, theme, mounted } = state;

  // Hydrate from localStorage on client
  useEffect(() => {
    const stored = loadSessions();
    const storedTheme = (localStorage.getItem('aria-theme') as AppTheme) ?? 'dark';
    dispatch({
      type: 'INIT',
      sessions: stored,
      activeSessionId: stored[0]?.id ?? null,
      theme: storedTheme,
    });
  }, []);

  // Sync theme to <html> and localStorage
  useEffect(() => {
    if (!mounted) return;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('aria-theme', theme);
  }, [theme, mounted]);

  const handleSessionUpdate = useCallback(
    (updatedSessions: ChatSession[], activeId: string) => {
      dispatch({ type: 'SET_SESSIONS', sessions: updatedSessions, activeSessionId: activeId });
    },
    []
  );

  const handleSelectSession = useCallback((id: string) => {
    dispatch({ type: 'SELECT_SESSION', id });
  }, []);

  const handleNewChat = useCallback(() => {
    dispatch({ type: 'NEW_CHAT' });
  }, []);

  const handleSetTheme = useCallback((t: AppTheme) => {
    dispatch({ type: 'SET_THEME', theme: t });
  }, []);

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
    <div className="app-shell" data-theme={theme}>
      <Sidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onNewChat={handleNewChat}
        theme={theme}
        onSetTheme={handleSetTheme}
      />
      <main className="app-shell__main">
        <ChatWindow
          sessionId={activeSessionId}
          onSessionUpdate={handleSessionUpdate}
        />
      </main>
    </div>
  );
}
