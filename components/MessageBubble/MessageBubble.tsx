'use client';

import { useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import { Message } from '@/lib/types';
import { formatTimestamp } from '@/lib/chatLogic';
import { speak, stopSpeaking, VoiceSettings, DEFAULT_VOICE_SETTINGS } from '@/lib/voice';
import { playClickSound } from '@/lib/sounds';
import './MessageBubble.css';

interface MessageBubbleProps {
  message: Message;
  voiceSettings?: VoiceSettings;
  isSpeaking?: boolean;
  isStreaming?: boolean;
  onSpeakRequest?: (id: string) => void;
  onSpeakEnd?: () => void;
  sessionId?: string;
  precedingUserMessage?: string;
  onRegenerate?: () => void;
}

// ── Code block with copy button ──────────────────────────────────

function CodeBlock({ language, children }: { language: string; children: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard?.writeText(children).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <div className="code-block">
      <div className="code-block__header">
        <span className="code-block__lang">{language || 'code'}</span>
        <button className="code-block__copy" onClick={handleCopy} type="button">
          {copied ? '✓ Copied' : '⎘ Copy'}
        </button>
      </div>
      <SyntaxHighlighter
        style={oneDark}
        language={language || 'text'}
        PreTag="div"
        customStyle={{
          margin: 0,
          borderRadius: '0 0 0.5rem 0.5rem',
          fontSize: '0.82rem',
          lineHeight: '1.55',
          background: 'transparent',
        }}
        codeTagProps={{ style: { fontFamily: 'var(--font-mono, monospace)' } }}
      >
        {children}
      </SyntaxHighlighter>
    </div>
  );
}

// ── Markdown renderer ────────────────────────────────────────────

function MarkdownContent({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  return (
    <div className="bubble__markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          code({ inline, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || '');
            const lang = match?.[1] ?? '';
            const code = String(children).replace(/\n$/, '');
            if (!inline && (lang || code.includes('\n'))) {
              return <CodeBlock language={lang}>{code}</CodeBlock>;
            }
            return (
              <code className="bubble__inline-code" {...props}>
                {children}
              </code>
            );
          },
          // Open links in new tab safely
          a({ href, children }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" className="bubble__link">
                {children}
              </a>
            );
          },
          // Style tables
          table({ children }) {
            return <div className="bubble__table-wrap"><table className="bubble__table">{children}</table></div>;
          },
          // Blockquote
          blockquote({ children }) {
            return <blockquote className="bubble__blockquote">{children}</blockquote>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
      {isStreaming && <span className="bubble__streaming-cursor" aria-hidden="true" />}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────

export default function MessageBubble({
  message,
  voiceSettings = DEFAULT_VOICE_SETTINGS,
  isSpeaking = false,
  isStreaming = false,
  onSpeakRequest,
  onSpeakEnd,
  sessionId,
  precedingUserMessage,
  onRegenerate,
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
          rating: newRating ?? 'down',
          userMessage: precedingUserMessage,
          aiReply: message.content,
        }),
      });
    } catch { /* silent */ } finally {
      setFeedbackPending(false);
    }
  }, [feedback, feedbackPending, message.dbMsgId, message.content, sessionId, precedingUserMessage]);

  return (
    <div className={`bubble-wrapper ${isUser ? 'bubble-wrapper--user' : 'bubble-wrapper--ai'}`}>
      {/* AI avatar */}
      {!isUser && (
        <div className={`bubble-avatar ${isSpeaking ? 'bubble-avatar--speaking' : ''}`} aria-hidden="true">
          {isSpeaking ? (
            <div className="bubble-avatar__waves"><span /><span /><span /></div>
          ) : (
            <span className="bubble-avatar__icon">✦</span>
          )}
        </div>
      )}

      <div className={`bubble ${isUser ? 'bubble--user' : 'bubble--ai'} ${isSpeaking ? 'bubble--speaking' : ''} ${isStreaming ? 'bubble--streaming' : ''}`}>
        {isUser ? (
          <p className="bubble__text">{message.content}</p>
        ) : (
          <MarkdownContent content={message.content} isStreaming={isStreaming} />
        )}

        {/* Footer */}
        <div className="bubble__footer">
          <span className="bubble__time">{formatTimestamp(new Date(message.timestamp))}</span>

          {isUser && (
            <div className="bubble__actions">
              <button className="bubble__action-btn" onClick={handleCopy} title={copied ? 'Copied!' : 'Copy'} type="button">
                {copied ? '✓' : '⎘'}
              </button>
            </div>
          )}

          {!isUser && !isStreaming && (
            <div className="bubble__actions">
              <button
                className={`bubble__action-btn bubble__feedback-btn ${feedback === 'up' ? 'bubble__feedback-btn--active-up' : ''}`}
                onClick={() => handleFeedback('up')}
                title="Good response"
                type="button"
                disabled={feedbackPending}
              >👍</button>

              <button
                className={`bubble__action-btn bubble__feedback-btn ${feedback === 'down' ? 'bubble__feedback-btn--active-down' : ''}`}
                onClick={() => handleFeedback('down')}
                title="Poor response"
                type="button"
                disabled={feedbackPending}
              >👎</button>

              <button className="bubble__action-btn" onClick={handleCopy} title={copied ? 'Copied!' : 'Copy'} type="button">
                {copied ? '✓' : '⎘'}
              </button>

              <button
                className={`bubble__action-btn bubble__speak-btn ${isSpeaking ? 'bubble__speak-btn--stop' : ''}`}
                onClick={handleSpeak}
                title={isSpeaking ? 'Stop speaking' : 'Read aloud'}
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

              {onRegenerate && (
                <button
                  className="bubble__action-btn bubble__regenerate-btn"
                  onClick={onRegenerate}
                  title="Regenerate response"
                  type="button"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                    <path d="M3 3v5h5"/>
                  </svg>
                </button>
              )}
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
