'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import '../login/auth.css';

export default function ForgotPasswordPage() {
  const [email,   setEmail]   = useState('');
  const [sent,    setSent]    = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Something went wrong.'); return; }
      setDevLink(data.devLink ?? null);
      setSent(true);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-brand__icon">✦</div>
          <h1 className="auth-brand__name">Aria</h1>
          <p className="auth-brand__tagline">Reset your password</p>
        </div>

        {sent ? (
          <div className="auth-form">
            <p className="auth-success">
              If an account exists for <strong>{email}</strong>, a reset link is on its way.
              Check your inbox (and spam).
            </p>
            {devLink && (
              <p className="auth-devlink">
                <strong>Dev mode:</strong> no email provider configured, so use this link directly:
                <br />
                <Link href={devLink} className="auth-link">{devLink}</Link>
              </p>
            )}
            <p className="auth-switch">
              <Link href="/login" className="auth-link">← Back to sign in</Link>
            </p>
          </div>
        ) : (
          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            <p className="auth-help">
              Enter your email and we&apos;ll send you a link to reset your password.
            </p>
            <div className="auth-field">
              <label className="auth-label" htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                className="auth-input"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            {error && <p className="auth-error">{error}</p>}

            <button className="auth-submit" type="submit" disabled={loading}>
              {loading ? 'Sending…' : 'Send reset link'}
            </button>

            <p className="auth-switch">
              Remembered it?{' '}
              <Link href="/login" className="auth-link">Sign in</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
