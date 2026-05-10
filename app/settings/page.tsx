'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import '../login/auth.css';
import './settings.css';

interface User {
  id: string;
  name: string;
  email: string;
  role: 'user' | 'admin';
}

export default function SettingsPage() {
  const router = useRouter();

  const [user,        setUser]        = useState<User | null>(null);
  const [geminiKey,   setGeminiKey]   = useState('');
  const [showKey,     setShowKey]     = useState(false);
  const [hasKey,      setHasKey]      = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [removing,    setRemoving]    = useState(false);
  const [error,       setError]       = useState('');
  const [success,     setSuccess]     = useState('');

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => {
        if (d.user) {
          setUser(d.user);
          setHasKey(!!d.user.hasGeminiKey);
        }
      });
  }, []);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!geminiKey.trim()) {
      setError('Please enter an API key.');
      return;
    }
    if (!geminiKey.trim().startsWith('AIza')) {
      setError('That doesn\'t look like a valid Gemini API key (should start with "AIza").');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/auth/me', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ geminiApiKey: geminiKey.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Failed to save.'); return; }
      setHasKey(true);
      setGeminiKey('');
      setShowKey(false);
      setSuccess('API key saved! Aria will now use your key for all conversations.');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    setError('');
    setSuccess('');
    setRemoving(true);
    try {
      const res = await fetch('/api/auth/me', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ geminiApiKey: '' }),
      });
      if (!res.ok) { setError('Failed to remove key.'); return; }
      setHasKey(false);
      setGeminiKey('');
      setSuccess('API key removed. Aria will use the shared server key.');
    } catch {
      setError('Network error.');
    } finally {
      setRemoving(false);
    }
  }

  if (!user) {
    return (
      <div className="auth-page">
        <div className="auth-card" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
          Loading…
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card settings-card">

        {/* Header */}
        <div className="auth-brand" style={{ marginBottom: '1.25rem' }}>
          <div className="auth-brand__icon">⚙️</div>
          <h1 className="auth-brand__name">Settings</h1>
          <p className="auth-brand__tagline">Manage your Aria preferences</p>
        </div>

        {/* Current key status */}
        <div className={`settings-key-status ${hasKey ? 'settings-key-status--active' : ''}`}>
          <span className="settings-key-status__dot" />
          {hasKey
            ? '✅ You have a personal Gemini API key set'
            : '🔵 Using shared server key (rate-limited)'}
        </div>

        {/* Add / replace key */}
        <form className="auth-form" onSubmit={handleSave} noValidate style={{ marginTop: '1.5rem' }}>
          <div className="auth-field">
            <label className="auth-label" htmlFor="gemini-key">
              Your Gemini API Key
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
                className="settings-get-key-link"
              >
                Get a free key →
              </a>
            </label>
            <div className="settings-key-input-wrap">
              <input
                id="gemini-key"
                type={showKey ? 'text' : 'password'}
                className="auth-input"
                placeholder="AIzaSy…"
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="settings-key-toggle"
                onClick={() => setShowKey((v) => !v)}
                aria-label={showKey ? 'Hide key' : 'Show key'}
              >
                {showKey ? '🙈' : '👁️'}
              </button>
            </div>
            <p className="settings-hint">
              Free tier: 15 requests/min · 1 million tokens/min. Never shared with anyone.
            </p>
          </div>

          {error   && <p className="auth-error">{error}</p>}
          {success && <p className="auth-success">✅ {success}</p>}

          <button className="auth-submit" type="submit" disabled={saving}>
            {saving ? 'Saving…' : hasKey ? 'Update API Key' : 'Save API Key'}
          </button>
        </form>

        {/* Remove key */}
        {hasKey && (
          <div style={{ marginTop: '0.75rem' }}>
            <button
              onClick={handleRemove}
              disabled={removing}
              className="settings-remove-btn"
            >
              {removing ? 'Removing…' : 'Remove my key (use shared key)'}
            </button>
          </div>
        )}

        {/* How to get a key */}
        <div className="settings-guide">
          <p className="settings-guide__title">How to get your free Gemini API key</p>
          <ol className="settings-guide__steps">
            <li>Go to <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com/apikey</a></li>
            <li>Sign in with your Google account</li>
            <li>Click <strong>Create API key</strong></li>
            <li>Copy the key and paste it above</li>
          </ol>
          <p className="settings-guide__note">
            Your key is stored securely in your account and only used for your own conversations.
          </p>
        </div>

        {/* Admin dashboard — only visible to admins */}
        {user.role === 'admin' && (
          <div className="settings-admin-section">
            <div className="settings-admin-section__header">
              <span className="settings-admin-section__icon">🔧</span>
              <div>
                <p className="settings-admin-section__title">Training Dashboard</p>
                <p className="settings-admin-section__desc">
                  View usage stats, conversations, user list, and export fine-tuning data.
                </p>
              </div>
            </div>
            <a href="/admin" className="settings-admin-section__btn">
              Open Admin Dashboard →
            </a>
          </div>
        )}

        {/* Footer nav */}
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
          <a href="/" className="auth-link settings-nav-btn">← Back to Aria</a>
          <a href="/profile" className="auth-link settings-nav-btn">👤 Profile</a>
        </div>
      </div>
    </div>
  );
}
