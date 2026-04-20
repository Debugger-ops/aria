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
} from '@/lib/chatLogic';
import { ChatRequest, ChatResponse } from '@/lib/types';
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
import MessageBubble from '@/components/MessageBubble/MessageBubble';
import ChatInput from '@/components/ChatInput/ChatInput';
import VoiceControls from '@/components/VoiceControls/VoiceControls';
import './ChatWindow.css';

interface ChatWindowProps {
  sessionId: string | null;
  onSessionUpdate: (sessions: ChatSession[], activeId: string) => void;
}

// ── State ────────────────────────────────────────────────────────

interface WindowState {
  messages: Message[];
  currentSessionId: string | null;
  isLoading: boolean;
  typingDots: string;
}

type WindowAction =
  | { type: 'LOAD_SESSION'; sessionId: string | null; messages: Message[] }
  | { type: 'ADD_MESSAGES'; messages: Message[] }
  | { type: 'SET_LOADING'; value: boolean }
  | { type: 'SET_TYPING'; dots: string };

function windowReducer(state: WindowState, action: WindowAction): WindowState {
  switch (action.type) {
    case 'LOAD_SESSION':
      return { ...state, currentSessionId: action.sessionId, messages: action.messages };
    case 'ADD_MESSAGES':
      return { ...state, messages: action.messages };
    case 'SET_LOADING':
      return { ...state, isLoading: action.value };
    case 'SET_TYPING':
      return { ...state, typingDots: action.dots };
    default:
      return state;
  }
}

// ── Component ────────────────────────────────────────────────────

export default function ChatWindow({ sessionId, onSessionUpdate }: ChatWindowProps) {
  const [state, dispatch] = useReducer(windowReducer, {
    messages: [],
    currentSessionId: sessionId,
    isLoading: false,
    typingDots: '',
  });

  const { messages, currentSessionId, isLoading, typingDots } = state;
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ── Voice state ────────────────────────────────────────────────
  // Initialise voice from localStorage immediately (no effect needed)
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>(() => loadVoiceSettings());
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const welcomePlayed = useRef(false);
  const prevSessionId = useRef<string | null | undefined>(undefined);

  // Welcome sound on first mount (side-effect only, no state)
  useEffect(() => {
    if (!welcomePlayed.current) {
      welcomePlayed.current = true;
      if (isSoundEnabled()) setTimeout(() => playWelcomeSound(), 400);
    }
  }, []);

  // Sync sessionId prop → state — combine stop+dispatch in one effect (no extra setState)
  useEffect(() => {
    if (prevSessionId.current === sessionId) return;
    prevSessionId.current = sessionId;
    stopSpeaking();
    const stored = loadSessions();
    const found = sessionId ? stored.find((s) => s.id === sessionId) : undefined;
    // Batch: use a combined action that resets speakingMsgId too
    dispatch({ type: 'LOAD_SESSION', sessionId, messages: found?.messages ?? [] });
    setSpeakingMsgId(null);
  }, [sessionId]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Typing indicator animation
  useEffect(() => {
    if (!isLoading) { dispatch({ type: 'SET_TYPING', dots: '' }); return; }
    let count = 0;
    const t = setInterval(() => {
      count = (count + 1) % 4;
      dispatch({ type: 'SET_TYPING', dots: '.'.repeat(count) });
    }, 400);
    return () => clearInterval(t);
  }, [isLoading]);

  // ── Send handler ───────────────────────────────────────────────
  const handleSend = useCallback(
    async (text: string) => {
      if (!text.trim() || isLoading) return;

      // Unlock audio + play send sound
      unlockAudio();
      if (isSoundEnabled()) playSendSound();

      // Stop any in-progress speech
      stopSpeaking();
      setSpeakingMsgId(null);

      let activeSessionId = currentSessionId;
      let sessions = loadSessions();

      if (!activeSessionId) {
        const newSession = createSession(text);
        activeSessionId = newSession.id;
        sessions = [newSession, ...sessions];
      }

      const userMsg = createMessage('user', text);
      const updatedMessages = [...messages, userMsg];
      dispatch({ type: 'ADD_MESSAGES', messages: updatedMessages });

      const sessionIdx = sessions.findIndex((s) => s.id === activeSessionId);
      if (sessionIdx !== -1) {
        sessions[sessionIdx] = {
          ...sessions[sessionIdx],
          messages: updatedMessages,
          title: deriveSessionTitle(updatedMessages),
          updatedAt: new Date(),
        };
      } else {
        sessions = [
          {
            id: activeSessionId,
            title: deriveSessionTitle(updatedMessages),
            messages: updatedMessages,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          ...sessions,
        ];
      }
      saveSessions(sessions);
      onSessionUpdate(sessions, activeSessionId);

      dispatch({ type: 'SET_LOADING', value: true });
      try {
        const payload: ChatRequest = {
          message: text,
          sessionId: activeSessionId,
          history: buildHistory(updatedMessages),
        };

        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res.ok) throw new Error(`API error ${res.status}`);

        const data: ChatResponse = await res.json();
        const aiMsg = createMessage('assistant', data.reply);
        if (data.aiMsgId) aiMsg.dbMsgId = data.aiMsgId;
        const finalMessages = [...updatedMessages, aiMsg];
        dispatch({ type: 'ADD_MESSAGES', messages: finalMessages });

        // Sounds: reward chime for long replies, normal receive otherwise
        if (isSoundEnabled()) {
          if (data.reply.length > 300) {
            playRewardSound();
          } else {
            playReceiveSound();
          }
        }

        // Auto-speak the AI reply
        if (voiceSettings.autoSpeak) {
          setTimeout(() => {
            if (isSoundEnabled()) playVoiceStartSound();
            setSpeakingMsgId(aiMsg.id);
            speak(data.reply, {
              settings: voiceSettings,
              onEnd: () => setSpeakingMsgId(null),
              onError: () => setSpeakingMsgId(null),
            });
          }, 350);
        }

        // Persist
        const idx2 = sessions.findIndex((s) => s.id === activeSessionId);
        if (idx2 !== -1) {
          sessions[idx2] = { ...sessions[idx2], messages: finalMessages, updatedAt: new Date() };
          saveSessions(sessions);
          onSessionUpdate(sessions, activeSessionId);
        }
      } catch (err) {
        console.error('Chat error:', err);
        if (isSoundEnabled()) playErrorSound();
        const errMsg = createMessage(
          'assistant',
          "Oops, I had a little hiccup! Could you try again? I'm all ears 👂"
        );
        dispatch({ type: 'ADD_MESSAGES', messages: [...updatedMessages, errMsg] });
      } finally {
        dispatch({ type: 'SET_LOADING', value: false });
      }
    },
    [currentSessionId, isLoading, messages, onSessionUpdate, voiceSettings]
  );

  // ── Voice control handlers ─────────────────────────────────────
  const handleSpeakRequest = useCallback((id: string) => setSpeakingMsgId(id), []);
  const handleSpeakEnd = useCallback(() => setSpeakingMsgId(null), []);
  const handleVoiceSettingsChange = useCallback((s: VoiceSettings) => {
    setVoiceSettings(s);
    // If auto-speak was just turned off, stop anything playing
    if (!s.autoSpeak) { stopSpeaking(); setSpeakingMsgId(null); }
    // If sound was toggled via VoiceControls, sync
    setSoundEnabled(isSoundEnabled());
  }, []);

  const isEmpty = messages.length === 0;

  return (
    <div className="chat-window">

      {/* Header */}
      <div className="chat-window__header">
        <div
          className={`chat-window__avatar ${speakingMsgId ? 'chat-window__avatar--speaking' : ''}`}
          aria-hidden="true"
        >
          {speakingMsgId ? (
            <div className="chat-window__avatar-waves">
              <span /><span /><span />
            </div>
          ) : '✦'}
        </div>

        <div className="chat-window__title-group">
          <h2 className="chat-window__name">Aria</h2>
          <span className={`chat-window__status ${isLoading ? 'chat-window__status--typing' : ''} ${speakingMsgId ? 'chat-window__status--speaking' : ''}`}>
            {speakingMsgId ? '🎙️ Speaking…' : isLoading ? `Typing${typingDots}` : 'Online · Always here for you'}
          </span>
        </div>

        {/* Voice controls in header */}
        <div className="chat-window__header-actions">
          <VoiceControls onSettingsChange={handleVoiceSettingsChange} />
        </div>
      </div>

      {/* Messages */}
      <div
        className="chat-window__messages"
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
      >
        {isEmpty && !isLoading && (
          <div className="chat-window__empty">
            <div className="chat-window__empty-icon" aria-hidden="true">✦</div>
            <h3 className="chat-window__empty-title">Hi, I&apos;m Aria!</h3>
            <p className="chat-window__empty-subtitle">
              Your AI companion with voice. I can speak my replies aloud —
              <br />just enable the 🎙️ in the top-right corner!
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
            onSpeakRequest={handleSpeakRequest}
            onSpeakEnd={handleSpeakEnd}
            sessionId={currentSessionId ?? undefined}
            precedingUserMessage={
              msg.role === 'assistant' && idx > 0 && messages[idx - 1].role === 'user'
                ? messages[idx - 1].content
                : undefined
            }
          />
        ))}

        {isLoading && (
          <div className="chat-window__typing-indicator" aria-label="Aria is typing">
            <div className="chat-window__avatar chat-window__avatar--sm" aria-hidden="true">✦</div>
            <div className="typing-dots">
              <span /><span /><span />
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
  "Hey Aria! Say hello and introduce yourself 🎙️",
  "Tell me something amazing about the universe",
  "I need to vent — can you listen to me?",
  "Give me a motivational pep talk right now!",
];
