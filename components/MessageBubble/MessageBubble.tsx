'use client';

import { useState, useCallback } from 'react';
import { Message } from '@/lib/types';
import { formatTimestamp } from '@/lib/chatLogic';
import { speak, stopSpeaking, VoiceSettings, DEFAULT_VOICE_SETTINGS } from '@/lib/voice';
import { playClickSound } from '@/lib/sounds';
import './MessageBubble.css';

interface MessageBubbleProps {
  message: Message;
  voiceSettings?: VoiceSettings;
  isSpeaking?: boolean;
  onSpeakRequest?: (id: string) => void;
  onSpeakEnd?: () => void;
  sessionId?: string;
  precedingUserMessage?: string; // user turn before this AI reply — needed for feedback
}

export default function MessageBubble({
  message,
  voiceSettings = DEFAULT_VOICE_SETTINGS,
  isSpeaking = false,
  onSpeakRequest,
  onSpeakEnd,
  sessionId,
  precedingUserMessage,
}: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(message.feedback ?? null);
  const [feedbackPending, setFeedbackPending] = useState(false);

  const handleSpeak = useCallback(() => {
    playClickSound();
    if (isSpeaking) {
      stopSpeaking();
      onSpeakEnd?.();
      return;
    }
    onSpeakRequest?.(message.id);
    speak(message.content, {
      settings: voiceSettings,
      onEnd: () => onSpeakEnd?.(),
      onError: () => onSpeakEnd?.(),
    });
  }, [isSpeaking, message.id, message.content, voiceSettings, onSpeakRequest, onSpeakEnd]);

  const handleCopy = useCallback(() => {
    playClickSound();
    navigator.clipboard?.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }, [message.content]);

  const handleFeedback = useCallback(async (rating: 'up' | 'down') => {
    if (feedbackPending) return;

    // Toggle off if same rating clicked again
    const newRating = feedback === rating ? null : rating;
    setFeedback(newRating);

    if (!message.dbMsgId || !sessionId || !precedingUserMessage) return;

    setFeedbackPending(true);
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageId: message.dbMsgId,
          sessionId,
          rating: newRating ?? 'down', // default to down when toggling off
          userMessage: precedingUserMessage,
          aiReply: message.content,
        }),
      });
    } catch {
      // Silent fail — feedback is best-effort
    } finally {
      setFeedbackPending(false);
    }
  }, [feedback, feedbackPending, message.dbMsgId, message.content, sessionId, precedingUserMessage]);

  return (
    <div className={`bubble-wrapper ${isUser ? 'bubble-wrapper--user' : 'bubble-wrapper--ai'}`}>
      {/* AI avatar — pulses when speaking */}
      {!isUser && (
        <div
          className={`bubble-avatar ${isSpeaking ? 'bubble-avatar--speaking' : ''}`}
          aria-hidden="true"
        >
          {isSpeaking ? (
            <div className="bubble-avatar__waves">
              <span /><span /><span />
            </div>
          ) : (
            <span className="bubble-avatar__icon">✦</span>
          )}
        </div>
      )}

      <div className={`bubble ${isUser ? 'bubble--user' : 'bubble--ai'} ${isSpeaking ? 'bubble--speaking' : ''}`}>
        <p className="bubble__text">{message.content}</p>

        {/* Footer: timestamp + action buttons */}
        <div className="bubble__footer">
          <span className="bubble__time">{formatTimestamp(new Date(message.timestamp))}</span>

          {/* Copy button on user messages */}
          {isUser && (
            <div className="bubble__actions">
              <button
                className="bubble__action-btn"
                onClick={handleCopy}
                title={copied ? 'Copied!' : 'Copy message'}
                aria-label="Copy message"
                type="button"
              >
                {copied ? '✓' : '⎘'}
              </button>
            </div>
          )}

          {/* Actions on AI messages */}
          {!isUser && (
            <div className="bubble__actions">
              {/* Thumbs Up */}
              <button
                className={`bubble__action-btn bubble__feedback-btn ${feedback === 'up' ? 'bubble__feedback-btn--active-up' : ''}`}
                onClick={() => handleFeedback('up')}
                title="Good response"
                aria-label="Rate response as good"
                type="button"
                disabled={feedbackPending}
              >
                👍
              </button>

              {/* Thumbs Down */}
              <button
                className={`bubble__action-btn bubble__feedback-btn ${feedback === 'down' ? 'bubble__feedback-btn--active-down' : ''}`}
                onClick={() => handleFeedback('down')}
                title="Poor response"
                aria-label="Rate response as poor"
                type="button"
                disabled={feedbackPending}
              >
                👎
              </button>

              {/* Copy */}
              <button
                className="bubble__action-btn"
                onClick={handleCopy}
                title={copied ? 'Copied!' : 'Copy message'}
                aria-label="Copy message"
                type="button"
              >
                {copied ? '✓' : '⎘'}
              </button>

              {/* Speak / Stop */}
              <button
                className={`bubble__action-btn bubble__speak-btn ${isSpeaking ? 'bubble__speak-btn--stop' : ''}`}
                onClick={handleSpeak}
                title={isSpeaking ? 'Stop speaking' : 'Read aloud'}
                aria-label={isSpeaking ? 'Stop speaking' : 'Read message aloud'}
                type="button"
              >
                {isSpeaking ? (
                  <span className="bubble__speak-icon--stop">■</span>
                ) : (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 0 0 1.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06ZM18.584 5.106a.75.75 0 0 1 1.06 0c3.808 3.807 3.808 9.98 0 13.788a.75.75 0 0 1-1.06-1.06 8.25 8.25 0 0 0 0-11.668.75.75 0 0 1 0-1.06Z"/>
                    <path d="M15.932 7.757a.75.75 0 0 1 1.061 0 6 6 0 0 1 0 8.486.75.75 0 0 1-1.06-1.061 4.5 4.5 0 0 0 0-6.364.75.75 0 0 1 0-1.061Z"/>
                  </svg>
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* User avatar */}
      {isUser && (
        <div className="bubble-avatar bubble-avatar--user" aria-hidden="true">
          <span className="bubble-avatar__icon">You</span>
        </div>
      )}
    </div>
  );
}
