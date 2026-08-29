// lib/email.ts — transactional email with graceful fallback.
//
// Delivery order:
//   1. Resend  (RESEND_API_KEY)        — HTTP API, no extra infra
//   2. SMTP    (SMTP_HOST + creds)     — via nodemailer
//   3. none    — logs the link to the server console (dev convenience)
//
// Returns which method was used so callers can decide whether to surface the
// link directly (only safe to do in development).

import 'server-only';

const FROM = process.env.EMAIL_FROM ?? 'Aria <onboarding@resend.dev>';

export type DeliveryMethod = 'resend' | 'smtp' | 'none';

export interface SendResult {
  method: DeliveryMethod;
  ok: boolean;
}

interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

async function sendViaResend(mail: Mail): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM, to: mail.to, subject: mail.subject, html: mail.html, text: mail.text }),
    });
    if (!res.ok) {
      console.warn('[email] Resend failed:', res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[email] Resend error:', (err as Error).message);
    return false;
  }
}

async function sendViaSmtp(mail: Mail): Promise<boolean> {
  const host = process.env.SMTP_HOST;
  if (!host) return false;
  try {
    const nodemailer = (await import('nodemailer')).default;
    const transport = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
    await transport.sendMail({ from: FROM, to: mail.to, subject: mail.subject, html: mail.html, text: mail.text });
    return true;
  } catch (err) {
    console.warn('[email] SMTP error:', (err as Error).message);
    return false;
  }
}

/** Returns true if any real email provider is configured. */
export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY || process.env.SMTP_HOST);
}

export async function sendMail(mail: Mail): Promise<SendResult> {
  if (await sendViaResend(mail)) return { method: 'resend', ok: true };
  if (await sendViaSmtp(mail))   return { method: 'smtp', ok: true };
  // Dev fallback: surface the content in the server log.
  console.log(`\n[email:dev] (no provider configured) → ${mail.to}\n${mail.subject}\n${mail.text}\n`);
  return { method: 'none', ok: false };
}

export async function sendPasswordResetEmail(to: string, name: string, link: string): Promise<SendResult> {
  const subject = 'Reset your Aria password';
  const text = `Hi ${name || 'there'},\n\nWe received a request to reset your Aria password. ` +
    `Use the link below within 1 hour:\n\n${link}\n\nIf you didn't request this, you can ignore this email.`;
  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1a1a">
      <div style="font-size:28px">✦</div>
      <h2 style="margin:8px 0 4px">Reset your password</h2>
      <p style="color:#555">Hi ${name || 'there'}, we received a request to reset your Aria password.</p>
      <p style="margin:24px 0">
        <a href="${link}" style="background:#6d5dfc;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block;font-weight:600">
          Reset password
        </a>
      </p>
      <p style="color:#888;font-size:13px">This link expires in 1 hour. If you didn't request it, you can safely ignore this email.</p>
      <p style="color:#aaa;font-size:12px;word-break:break-all">${link}</p>
    </div>`;
  return sendMail({ to, subject, html, text });
}
