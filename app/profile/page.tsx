'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import '../login/auth.css';

const AVATAR_OPTIONS = ['😊', '🦊', '🐱', '🐸', '🐼', '🦁', '🐨', '🦋', '🌟', '🎯', '🚀', '💎'];

interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  role: 'user' | 'admin';
  createdAt: string;
}

export default function ProfilePage() {
  const router = useRouter();

  const [user,        setUser]        = useState<User | null>(null);
  const [name,        setName]        = useState('');
  const [avatar,      setAvatar]      = useState('');
  const [password,    setPassword]    = useState('');
  const [confirm,     setConfirm]     = useState('');
  const [error,       setError]       = useState('');
  const [success,     setSuccess]     = useState('');
  const [saving,      setSaving]      = useState(false);
  const [loggingOut,  setLoggingOut]  = useState(false);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => {
        if (d.user) {
          setUser(d.user);
          setName(d.user.name);
          setAvatar(d.user.avatar ?? '');
        }
      });
  }, []);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (password && password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (password && password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setSaving(true);
    try {
      const body: Record<string, string> = { name, avatar };
      if (password) body.password = password;

      const res  = await fetch('/api/auth/me', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) { setError(data.error ?? 'Update failed.'); return; }
      setUser(data.user);
      setPassword('');
      setConfirm('');
      setSuccess('Profile updated!');
    } catch {
      setError('Network error.');
    } finally {
      setSaving(false);
    }
  }

  async function handleLogout() {
    setLoggingOut(true);
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
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
      <div className="auth-card" style={{ maxWidth: 480 }}>
        {/* Header */}
        <div className="auth-brand" style={{ marginBottom: '1.25rem' }}>
          <div className="auth-brand__icon">✦</div>
          <h1 className="auth-brand__name">Your Profile</h1>
        </div>

        {/* Current user badge */}
        <div className="auth-user-badge">
          <div className="auth-user-avatar">
            {AVATAR_OPTIONS.includes(user.avatar ?? '') ? user.avatar : (user.name.slice(0, 2).toUpperCase())}
          </div>
          <div className="auth-user-info">
            <span className="auth-user-name">{user.name}</span>
            <span className="auth-user-email">{user.email}</span>
            <span className="auth-user-role">{user.role}</span>
          </div>
        </div>

        <form className="auth-form" onSubmit={handleSave} noValidate>
          {/* Name */}
          <div className="auth-field">
            <label className="auth-label" htmlFor="name">Display name</label>
            <input
              id="name"
              type="text"
              className="auth-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          {/* Avatar picker */}
          <div className="auth-field">
            <p className="auth-section-label">Choose an avatar</p>
            <div className="auth-avatar-grid">
              {AVATAR_OPTIONS.map((em) => (
                <button
                  key={em}
                  type="button"
                  className={`auth-avatar-option ${avatar === em ? 'auth-avatar-option--active' : ''}`}
                  onClick={() => setAvatar(em)}
                  title={em}
                >
                  {em}
                </button>
              ))}
            </div>
          </div>

          <div className="auth-divider" />

          {/* Change password */}
          <div className="auth-field">
            <label className="auth-label" htmlFor="newpw">New password <span style={{ fontWeight: 400, textTransform: 'none' }}>(leave blank to keep current)</span></label>
            <input
              id="newpw"
              type="password"
              className="auth-input"
              placeholder="Min. 6 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>

          {password && (
            <div className="auth-field">
              <label className="auth-label" htmlFor="confirmpw">Confirm new password</label>
              <input
                id="confirmpw"
                type="password"
                className="auth-input"
                placeholder="Re-enter password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
              />
            </div>
          )}

          {error   && <p className="auth-error">{error}</p>}
          {success && <p className="auth-success">✅ {success}</p>}

          <button className="auth-submit" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </form>

        {/* Footer actions */}
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
          <a href="/" className="auth-link" style={{ flex: 1, textAlign: 'center', padding: '0.6rem', background: 'var(--surface-elevated)', borderRadius: 8 }}>
            ← Back to Aria
          </a>
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            style={{
              flex: 1,
              background: 'rgba(239,68,68,0.12)',
              color: '#f87171',
              border: '1px solid rgba(239,68,68,0.25)',
              borderRadius: 8,
              padding: '0.6rem',
              cursor: 'pointer',
              fontSize: '0.875rem',
              fontWeight: 600,
            }}
          >
            {loggingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </div>
    </div>
  );
}
