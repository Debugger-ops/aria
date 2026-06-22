'use client';

import { useEffect, useRef, useCallback, useReducer, useState } from 'react';
import { Message, ChatSession } from '@/lib/types';
import {
  createMessage,
  createSession,
  deriveSessionTitle,
  buildHistory,
  saveSessions,
  loadSessions,
  formatTimestamp,
} from '@/lib/chatLogic';
import { ChatRequest } from '@/lib/types';
import {
  speak,
  stopSpeaking,
  loadVoiceSettings,
  VoiceSettings,
} from '@/lib/voice';
import {
  playSendSound,
  playReceiveSound,
  playWelcomeSound,
  playRewardSound,
  playErrorSound,
  playVoiceStartSound,
  unlockAudio,
  isSoundEnabled,
  setSoundEnabled,
} from '@/lib/sounds';
import { GEMINI_MODELS, GeminiModel, DEFAULT_MODEL } from '@/lib/gemini';
import MessageBubble from '@/components/MessageBubble/MessageBubble';
import ChatInput from '@/components/ChatInput/ChatInput';
import VoiceControls from '@/components/VoiceControls/VoiceControls';
import './ChatWindow.css';

interface ChatWindowProps {
  sessionId: string | null;
  onSessionUpdate: (sessions: ChatSession[], activeId: string) => void;
  onMenuToggle?: () => void;
}

interface WindowState {
  messages: Message[];
  currentSessionId: string | null;
  isLoading: boolean;
  streamingMsgId: string | null;
}

type WindowAction =
  | { type: 'LOAD_SESSION'; sessionId: string | null; messages: Message[] }
  | { type: 'ADD_MESSAGES'; messages: Message[] }
  | { type: 'SET_LOADING'; value: boolean }
  | { type: 'START_STREAM'; placeholder: Message; messages: Message[] }
  | { type: 'APPEND_STREAM'; msgId: string; text: string }
  | { type: 'FINISH_STREAM'; msgId: string; dbMsgId: string };

function windowReducer(state: WindowState, action: WindowAction): WindowState {
  switch (action.type) {
    case 'LOAD_SESSION':
      return { ...state, currentSessionId: action.sessionId, messages: action.messages, streamingMsgId: null };
    case 'ADD_MESSAGES':
      return { ...state, messages: action.messages };
    case 'SET_LOADING':
      return { ...state, isLoading: action.value };
    case 'START_STREAM':
      return { ...state, messages: action.messages, streamingMsgId: action.placeholder.id, isLoading: true };
    case 'APPEND_STREAM': {
      const updated = state.messages.map((m) =>
        m.id === action.msgId ? { ...m, content: m.content + action.text } : m
      );
      return { ...state, messages: updated };
    }
    case 'FINISH_STREAM': {
      const updated = state.messages.map((m) =>
        m.id === action.msgId ? { ...m, dbMsgId: action.dbMsgId } : m
      );
      return { ...state, messages: updated, streamingMsgId: null, isLoading: false };
    }
    default:
      return state;
  }
}

export default function ChatWindow({ sessionId, onSessionUpdate, onMenuToggle }: ChatWindowProps) {
  const [state, dispatch] = useReducer(windowReducer, {
    messages: [],
    currentSessionId: sessionId,
    isLoading: false,
    streamingMsgId: null,
  });

  const { messages, currentSessionId, isLoading, streamingMsgId } = state;
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>(() => loadVoiceSettings());
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [model, setModel] = useState<GeminiModel>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('aria-model') as GeminiModel) ?? DEFAULT_MODEL;
    }
    return DEFAULT_MODEL;
  });
  const [showModelPicker, setShowModelPicker] = useState(false);

  const welcomePlayed = useRef(false);
  const prevSessionId = useRef<string | null | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!welcomePlayed.current) {
      welcomePlayed.current = true;
      if (isSoundEnabled()) setTimeout(() => playWelcomeSound(), 400);
    }
  }, []);

  useEffect(() => {
    if (prevSessionId.current === sessionId) return;
    prevSessionId.current = sessionId;
    abortRef.current?.abort();
    stopSpeaking();
    const stored = loadSessions();
    const found = sessionId ? stored.find((s) => s.id === sessionId) : undefined;
    dispatch({ type: 'LOAD_SESSION', sessionId, messages: found?.messages ?? [] });
    setSpeakingMsgId(null);
  }, [sessionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    localStorage.setItem('aria-model', model);
  }, [model]);

  // ── Send handler with streaming ───────────────────────────────
  const handleSend = useCallback(
    async (text: string) => {
      if (!text.trim() || isLoading) return;

      unlockAudio();
      if (isSoundEnabled()) playSendSound();
      stopSpeaking();
      setSpeakingMsgId(null);
      setShowModelPicker(false);

      let activeSessionId = currentSessionId;
      let sessions = loadSessions();

      if (!activeSessionId) {
        const newSession = createSession(text);
        activeSessionId = newSession.id;
        sessions = [newSession, ...sessions];
      }

      const userMsg = createMessage('user', text);
      const updatedMessages = [...messages, userMsg];
      const aiPlaceholder = createMessage('assistant', '');
      const messagesWithPlaceholder = [...updatedMessages, aiPlaceholder];

      const sessionIdx = sessions.findIndex((s) => s.id === activeSessionId);
      if (sessionIdx !== -1) {
        sessions[sessionIdx] = {
          ...sessions[sessionIdx],
          messages: updatedMessages,
          title: deriveSessionTitle(updatedMessages),
          updatedAt: new Date(),
        };
      } else {
        sessions = [{
          id: activeSessionId!,
          title: deriveSessionTitle(updatedMessages),
          messages: updatedMessages,
          createdAt: new Date(),
          updatedAt: new Date(),
        }, ...sessions];
      }
      saveSessions(sessions);
      onSessionUpdate(sessions, activeSessionId!);
      dispatch({ type: 'START_STREAM', placeholder: aiPlaceholder, messages: messagesWithPlaceholder });

      const abort = new AbortController();
      abortRef.current = abort;

      try {
        const payload: ChatRequest & { model: GeminiModel } = {
          message: text,
          sessionId: activeSessionId!,
          history: buildHistory(updatedMessages),
          model,
        };

        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: abort.signal,
        });

        if (!res.ok) throw new Error(`API error ${res.status}`);

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullContent = '';
        let dbMsgId = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;
            try {
              const event = JSON.parse(jsonStr);
              if (event.type === 'chunk') {
                fullContent += event.text;
                dispatch({ type: 'APPEND_STREAM', msgId: aiPlaceholder.id, text: event.text });
              } else if (event.type === 'done') {
                dbMsgId = event.aiMsgId;
              } else if (event.type === 'error') {
                throw new Error(event.message);
              }
            } catch { /* skip malformed */ }
          }
        }

        dispatch({ type: 'FINISH_STREAM', msgId: aiPlaceholder.id, dbMsgId });

        if (isSoundEnabled()) {
          fullContent.length > 300 ? playRewardSound() : playReceiveSound();
        }

        if (voiceSettings.autoSpeak) {
          setTimeout(() => {
            if (isSoundEnabled()) playVoiceStartSound();
            setSpeakingMsgId(aiPlaceholder.id);
            speak(fullContent, {
              settings: voiceSettings,
              onEnd: () => setSpeakingMsgId(null),
              onError: () => setSpeakingMsgId(null),
            });
          }, 350);
        }

        const finalMessages = updatedMessages.concat({ ...aiPlaceholder, content: fullContent, dbMsgId });
        const idx2 = sessions.findIndex((s) => s.id === activeSessionId);
        if (idx2 !== -1) {
          sessions[idx2] = { ...sessions[idx2], messages: finalMessages, updatedAt: new Date() };
          saveSessions(sessions);
          onSessionUpdate(sessions, activeSessionId!);
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        console.error('Chat error:', err);
        if (isSoundEnabled()) playErrorSound();
        dispatch({ type: 'FINISH_STREAM', msgId: aiPlaceholder.id, dbMsgId: '' });
        dispatch({
          type: 'ADD_MESSAGES',
          messages: [...updatedMessages, {
            ...aiPlaceholder,
            content: "Oops, I had a little hiccup! Could you try again? I'm all ears 👂",
          }],
        });
      }
    },
    [currentSessionId, isLoading, messages, onSessionUpdate, voiceSettings, model]
  );

  // ── Regenerate ────────────────────────────────────────────────
  const handleRegenerate = useCallback(() => {
    if (isLoading || messages.length < 2) return;
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    // Drop last AI reply, re-send last user message
    const withoutLastAI = messages[messages.length - 1].role === 'assistant'
      ? messages.slice(0, -1)
      : messages;
    dispatch({ type: 'ADD_MESSAGES', messages: withoutLastAI });
    handleSend(lastUser.content);
  }, [messages, isLoading, handleSend]);

  // ── Voice controls ────────────────────────────────────────────
  const handleSpeakRequest = useCallback((id: string) => setSpeakingMsgId(id), []);
  const handleSpeakEnd = useCallback(() => setSpeakingMsgId(null), []);
  const handleVoiceSettingsChange = useCallback((s: VoiceSettings) => {
    setVoiceSettings(s);
    if (!s.autoSpeak) { stopSpeaking(); setSpeakingMsgId(null); }
    setSoundEnabled(isSoundEnabled());
  }, []);

  // ── Export ────────────────────────────────────────────────────
  const handleExport = useCallback(() => {
    if (!messages.length) return;
    const session = loadSessions().find((s) => s.id === currentSessionId);
    const title = session?.title ?? 'Aria Chat';
    const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const lines: string[] = [`# ${title}`, ``, `_Exported on ${dateStr}_`, ``, `---`, ``];
    messages.forEach((msg) => {
      const who = msg.role === 'user' ? '**You**' : '**Aria**';
      const time = formatTimestamp(new Date(msg.timestamp));
      lines.push(`${who} · _${time}_`, ``, msg.content, ``, `---`, ``);
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 50)}.md`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [messages, currentSessionId]);

  // ── Clear ─────────────────────────────────────────────────────
  const handleClear = useCallback(() => {
    abortRef.current?.abort();
    stopSpeaking();
    dispatch({ type: 'ADD_MESSAGES', messages: [] });
    if (currentSessionId) {
      const sessions = loadSessions().map((s) =>
        s.id === currentSessionId ? { ...s, messages: [], updatedAt: new Date() } : s
      );
      saveSessions(sessions);
      onSessionUpdate(sessions, currentSessionId);
    }
  }, [currentSessionId, onSessionUpdate]);

  const isEmpty = messages.length === 0;
  const currentModel = GEMINI_MODELS.find((m) => m.id === model) ?? GEMINI_MODELS[0];

  return (
    <div className="chat-window" onClick={() => setShowModelPicker(false)}>

      {/* Header */}
      <div className="chat-window__header" onClick={(e) => e.stopPropagation()}>
        <button className="chat-window__hamburger" onClick={onMenuToggle} aria-label="Toggle sidebar" type="button">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6"/>
            <line x1="3" y1="12" x2="21" y2="12"/>
            <line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
        </button>

        <div className={`chat-window__avatar ${speakingMsgId ? 'chat-window__avatar--speaking' : ''}`} aria-hidden="true">
          {speakingMsgId ? (
            <div className="chat-window__avatar-waves"><span /><span /><span /></div>
          ) : '✦'}
        </div>

        <div className="chat-window__title-group">
          <h2 className="chat-window__name">Aria</h2>
          <span className={`chat-window__status ${isLoading ? 'chat-window__status--typing' : ''} ${speakingMsgId ? 'chat-window__status--speaking' : ''}`}>
            {speakingMsgId ? '🎙️ Speaking…' : isLoading ? 'Generating…' : 'Online · Always here for you'}
          </span>
        </div>

        <div className="chat-window__header-actions">
          {/* Model picker */}
          <div className="chat-window__model-picker" onClick={(e) => e.stopPropagation()}>
            <button
              className="chat-window__model-btn"
              onClick={() => setShowModelPicker((v) => !v)}
              type="button"
              title="Switch AI model"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3"/>
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
              </svg>
              <span className="chat-window__model-label">{currentModel.label}</span>
              <span style={{ fontSize: '9px', opacity: 0.6 }}>{showModelPicker ? '▲' : '▼'}</span>
            </button>
            {showModelPicker && (
              <div className="chat-window__model-dropdown">
                {GEMINI_MODELS.map((m) => (
                  <button
                    key={m.id}
                    className={`chat-window__model-option ${model === m.id ? 'chat-window__model-option--active' : ''}`}
                    onClick={() => { setModel(m.id); setShowModelPicker(false); }}
                    type="button"
                  >
                    <span className="chat-window__model-option-name">{m.label}</span>
                    <span className="chat-window__model-option-desc">{m.description}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {!isEmpty && (
            <button className="chat-window__export-btn" onClick={handleClear} title="Clear conversation" type="button">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                <path d="M10 11v6M14 11v6M9 6V4h6v2"/>
              </svg>
              Clear
            </button>
          )}
          {!isEmpty && (
            <button className="chat-window__export-btn" onClick={handleExport} title="Export as Markdown" type="button">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Export
            </button>
          )}
          <VoiceControls onSettingsChange={handleVoiceSettingsChange} />
        </div>
      </div>

      {/* Messages */}
      <div className="chat-window__messages" role="log" aria-live="polite" aria-label="Chat messages">
        {isEmpty && !isLoading && (
          <div className="chat-window__empty">
            <div className="chat-window__empty-icon" aria-hidden="true">✦</div>
            <h3 className="chat-window__empty-title">Hi, I&apos;m Aria!</h3>
            <p className="chat-window__empty-subtitle">
              Streaming AI · Voice · Code highlighting · Multi-model
              <br />Choose a model above or just start chatting!
            </p>
            <div className="chat-window__starters">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  className="chat-window__starter-btn"
                  onClick={() => { unlockAudio(); handleSend(s); }}
                  type="button"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, idx) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            voiceSettings={voiceSettings}
            isSpeaking={speakingMsgId === msg.id}
            isStreaming={streamingMsgId === msg.id}
            onSpeakRequest={handleSpeakRequest}
            onSpeakEnd={handleSpeakEnd}
            sessionId={currentSessionId ?? undefined}
            precedingUserMessage={
              msg.role === 'assistant' && idx > 0 && messages[idx - 1].role === 'user'
                ? messages[idx - 1].content
                : undefined
            }
            onRegenerate={
              idx === messages.length - 1 && msg.role === 'assistant' && !isLoading
                ? handleRegenerate
                : undefined
            }
          />
        ))}

        {isLoading && !streamingMsgId && (
          <div className="chat-window__typing-indicator" aria-label="Aria is thinking">
            <div className="chat-window__avatar chat-window__avatar--sm" aria-hidden="true">✦</div>
            <div className="typing-dots">
              <span className="typing-dots__label">Aria is thinking…</span>
              <div className="typing-dots__balls"><span /><span /><span /></div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} aria-hidden="true" />
      </div>

      <ChatInput onSend={handleSend} isLoading={isLoading} />
    </div>
  );
}

const STARTERS = [
  "Hey Aria! Introduce yourself 🎙️",
  "Explain async/await in JavaScript with examples",
  "I need to vent — can you listen to me?",
  "Give me a motivational pep talk!",
];
