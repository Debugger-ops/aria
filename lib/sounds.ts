/**
 * Sound effects engine — uses the Web Audio API.
 * All sounds are synthesised programmatically (no audio files needed).
 */

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!)();
      masterGain = ctx.createGain();
      masterGain.gain.value = 0.4;
      masterGain.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  // Resume if suspended (browsers require user gesture first)
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function setSoundVolume(vol: number) {
  if (masterGain) masterGain.gain.value = Math.max(0, Math.min(1, vol));
}

/** Kick the AudioContext alive on first user interaction */
export function unlockAudio() {
  getCtx();
}

// ── Envelope helper ────────────────────────────────────────────────

function ramp(
  param: AudioParam,
  from: number,
  to: number,
  startAt: number,
  duration: number
) {
  param.setValueAtTime(from, startAt);
  param.linearRampToValueAtTime(to, startAt + duration);
}

// ── Individual sounds ─────────────────────────────────────────────

/** Soft 'whoosh' when user sends a message */
export function playSendSound() {
  const c = getCtx();
  if (!c || !masterGain) return;
  const t = c.currentTime;

  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.connect(gain);
  gain.connect(masterGain);

  osc.type = 'sine';
  osc.frequency.setValueAtTime(660, t);
  osc.frequency.exponentialRampToValueAtTime(300, t + 0.18);

  ramp(gain.gain, 0, 0.55, t, 0.02);
  ramp(gain.gain, 0.55, 0, t + 0.10, 0.08);

  osc.start(t);
  osc.stop(t + 0.22);
}

/** Warm two-tone chime when AI replies arrive */
export function playReceiveSound() {
  const c = getCtx();
  if (!c || !masterGain) return;
  const t = c.currentTime;

  const notes = [880, 1108]; // A5, C#6 — uplifting interval
  notes.forEach((freq, i) => {
    const osc  = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain);
    gain.connect(masterGain!);

    osc.type = 'triangle';
    osc.frequency.value = freq;

    const start = t + i * 0.11;
    ramp(gain.gain, 0, 0.45, start, 0.02);
    ramp(gain.gain, 0.45, 0, start + 0.15, 0.25);

    osc.start(start);
    osc.stop(start + 0.45);
  });
}

/** Sparkle shimmer when app loads / new chat opens */
export function playWelcomeSound() {
  const c = getCtx();
  if (!c || !masterGain) return;
  const t = c.currentTime;

  const sequence = [523, 659, 784, 1047]; // C5 E5 G5 C6
  sequence.forEach((freq, i) => {
    const osc  = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain);
    gain.connect(masterGain!);

    osc.type = 'sine';
    osc.frequency.value = freq;

    const start = t + i * 0.09;
    ramp(gain.gain, 0, 0.35, start, 0.02);
    ramp(gain.gain, 0.35, 0, start + 0.12, 0.22);

    osc.start(start);
    osc.stop(start + 0.38);
  });
}

/** Gentle pop when a button / starter prompt is clicked */
export function playClickSound() {
  const c = getCtx();
  if (!c || !masterGain) return;
  const t = c.currentTime;

  const osc  = c.createOscillator();
  const gain = c.createGain();
  osc.connect(gain);
  gain.connect(masterGain);

  osc.type = 'sine';
  osc.frequency.setValueAtTime(400, t);
  osc.frequency.exponentialRampToValueAtTime(200, t + 0.06);

  ramp(gain.gain, 0, 0.3, t, 0.005);
  ramp(gain.gain, 0.3, 0, t + 0.03, 0.04);

  osc.start(t);
  osc.stop(t + 0.08);
}

/** Positive reward chime — played when user gets a long/detailed AI answer */
export function playRewardSound() {
  const c = getCtx();
  if (!c || !masterGain) return;
  const t = c.currentTime;

  // Major arpeggio: C E G E C  (major chord sweep)
  const notes = [523, 659, 784, 659, 1047];
  notes.forEach((freq, i) => {
    const osc  = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain);
    gain.connect(masterGain!);

    osc.type = i === notes.length - 1 ? 'sine' : 'triangle';
    osc.frequency.value = freq;

    const start  = t + i * 0.08;
    const vol    = i === notes.length - 1 ? 0.5 : 0.3;
    const sustain = i === notes.length - 1 ? 0.35 : 0.1;

    ramp(gain.gain, 0, vol, start, 0.015);
    ramp(gain.gain, vol, 0, start + sustain, 0.25);

    osc.start(start);
    osc.stop(start + sustain + 0.3);
  });
}

/** Error blip */
export function playErrorSound() {
  const c = getCtx();
  if (!c || !masterGain) return;
  const t = c.currentTime;

  [300, 240].forEach((freq, i) => {
    const osc  = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain);
    gain.connect(masterGain!);

    osc.type = 'sawtooth';
    osc.frequency.value = freq;

    const start = t + i * 0.12;
    ramp(gain.gain, 0, 0.25, start, 0.01);
    ramp(gain.gain, 0.25, 0, start + 0.06, 0.08);

    osc.start(start);
    osc.stop(start + 0.18);
  });
}

/** Soft 'mic-on' ping when voice starts speaking */
export function playVoiceStartSound() {
  const c = getCtx();
  if (!c || !masterGain) return;
  const t = c.currentTime;

  const osc  = c.createOscillator();
  const gain = c.createGain();
  osc.connect(gain);
  gain.connect(masterGain);

  osc.type = 'sine';
  osc.frequency.setValueAtTime(700, t);
  osc.frequency.linearRampToValueAtTime(900, t + 0.08);

  ramp(gain.gain, 0, 0.3, t, 0.01);
  ramp(gain.gain, 0.3, 0, t + 0.08, 0.12);

  osc.start(t);
  osc.stop(t + 0.25);
}

// ── Persistence ────────────────────────────────────────────────────

const SOUND_KEY = 'aria-sound-enabled';

export function isSoundEnabled(): boolean {
  try { return localStorage.getItem(SOUND_KEY) !== 'false'; } catch { return true; }
}

export function setSoundEnabled(on: boolean) {
  try { localStorage.setItem(SOUND_KEY, String(on)); } catch { /**/ }
  if (masterGain) masterGain.gain.value = on ? 0.4 : 0;
}
