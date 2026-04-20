'use client';

import { useState, useRef, KeyboardEvent, FormEvent } from 'react';
import { unlockAudio, playClickSound } from '@/lib/sounds';
import './ChatInput.css';

interface ChatInputProps {
  onSend: (message: string) => void;
  isLoading: boolean;
  disabled?: boolean;
}

export default function ChatInput({ onSend, isLoading, disabled = false }: ChatInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSend = value.trim().length > 0 && !isLoading && !disabled;

  function autoResize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setValue(e.target.value);
    autoResize();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSend) submit();
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (canSend) submit();
  }

  function submit() {
    unlockAudio();
    playClickSound();
    const msg = value.trim();
    setValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    onSend(msg);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  return (
    <form className="chat-input" onSubmit={handleSubmit} aria-label="Chat message form">
      <div className="chat-input__inner">
        <textarea
          ref={textareaRef}
          className="chat-input__textarea"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Message Aria… (Enter to send, Shift+Enter for new line)"
          rows={1}
          disabled={isLoading || disabled}
          aria-label="Type your message"
          aria-describedby="send-hint"
          maxLength={4000}
        />

        <button
          type="submit"
          className={`chat-input__send ${canSend ? 'chat-input__send--active' : ''}`}
          disabled={!canSend}
          aria-label="Send message"
        >
          {isLoading ? (
            <span className="chat-input__spinner" aria-hidden="true" />
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              width="20"
              height="20"
              aria-hidden="true"
            >
              <path d="M3.478 2.405a.75.75 0 0 0-.926.94l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.405Z" />
            </svg>
          )}
        </button>
      </div>

      <p id="send-hint" className="chat-input__hint">
        Press <kbd>Enter</kbd> to send · <kbd>Shift + Enter</kbd> for a new line
      </p>
    </form>
  );
}
