/**
 * Voice engine — wraps the Web Speech API (free, built into every browser)
 * Supports male/female voice selection, speed, pitch, and a speaking state callback.
 */

export type VoiceGender = 'female' | 'male' | 'auto';

export interface VoiceSettings {
  gender: VoiceGender;
  rate: number;   // 0.5 – 2.0  (1 = normal)
  pitch: number;  // 0.5 – 2.0  (1 = normal)
  volume: number; // 0.0 – 1.0
  autoSpeak: boolean;
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  gender: 'female',
  rate: 0.95,
  pitch: 1.05,
  volume: 0.9,
  autoSpeak: true,
};

// Load voices — they may be async on some browsers
let cachedVoices: SpeechSynthesisVoice[] = [];

function getVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !window.speechSynthesis) return [];
  const voices = window.speechSynthesis.getVoices();
  if (voices.length) { cachedVoices = voices; return voices; }
  return cachedVoices;
}

/** Wait for voices to load (needed on Chrome) */
export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') { resolve([]); return; }
    const synth = window.speechSynthesis;
    const voices = synth.getVoices();
    if (voices.length) { cachedVoices = voices; resolve(voices); return; }
    synth.addEventListener('voiceschanged', () => {
      cachedVoices = synth.getVoices();
      resolve(cachedVoices);
    }, { once: true });
  });
}

/** Pick the best voice for the requested gender */
export function selectVoice(gender: VoiceGender): SpeechSynthesisVoice | null {
  const voices = getVoices();
  if (!voices.length) return null;

  if (gender === 'auto') return voices[0];

  // Prioritise en-US voices, then any English, then fallback
  const priority = [
    // exact gender matches in popular browsers
    (v: SpeechSynthesisVoice) =>
      v.lang.startsWith('en') &&
      (gender === 'female'
        ? /female|woman|girl|fiona|samantha|victoria|karen|moira|tessa|zira|susan|linda|amy|emma|alice|joanna|salli|kendra|kimberly|ivy/i.test(v.name)
        : /male|man|boy|daniel|alex|fred|bruce|ralph|lee|guy|brian|eric|joey|justin|matthew|russell|oliver|thomas/i.test(v.name)),
    // English voices (any gender)
    (v: SpeechSynthesisVoice) => v.lang.startsWith('en'),
    // Any voice
    () => true,
  ];

  for (const test of priority) {
    const match = voices.find(test);
    if (match) return match;
  }
  return voices[0];
}

/** Get all available voices grouped by language */
export function getVoiceList(): SpeechSynthesisVoice[] {
  return getVoices().filter((v) => v.lang.startsWith('en'));
}

/** Is TTS supported in this browser? */
export function isTTSSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

// ── Core speak / stop ─────────────────────────────────────────────

let _currentUtterance: SpeechSynthesisUtterance | null = null; // used implicitly by cancel()

export interface SpeakOptions {
  settings: VoiceSettings;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (msg: string) => void;
}

/** Strip markdown/code before speaking */
function cleanTextForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' [code block] ')  // fenced code → label
    .replace(/`[^`]+`/g, (m) => m.slice(1, -1))     // inline code → raw text
    .replace(/#{1,6}\s/g, '')                         // headers
    .replace(/\*\*(.*?)\*\*/g, '$1')                  // bold
    .replace(/\*(.*?)\*/g, '$1')                      // italic
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')          // links
    .replace(/^\s*[-*]\s+/gm, '')                     // bullets
    .replace(/^\s*\d+\.\s+/gm, '')                    // numbered lists
    .replace(/\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function speak(text: string, options: SpeakOptions): void {
  if (!isTTSSupported()) {
    options.onError?.('Text-to-speech is not supported in this browser.');
    return;
  }
  stopSpeaking();

  const clean = cleanTextForSpeech(text);
  if (!clean) return;

  const utterance = new SpeechSynthesisUtterance(clean);
  const voice = selectVoice(options.settings.gender);
  if (voice) utterance.voice = voice;

  utterance.rate   = options.settings.rate;
  utterance.pitch  = options.settings.pitch;
  utterance.volume = options.settings.volume;

  utterance.onstart = () => options.onStart?.();
  utterance.onend   = () => { _currentUtterance = null; options.onEnd?.(); };
  utterance.onerror = (e) => {
    _currentUtterance = null;
    options.onError?.(e.error);
  };

  // Track current utterance for stopSpeaking
  // (we hold the ref outside the function so stopSpeaking can cancel it)
  // Chrome bug: long utterances get cut off — split on sentence boundaries
  if (clean.length > 200) {
    const chunks = splitIntoChunks(clean);
    speakChunks(chunks, 0, options, utterance);
  } else {
    window.speechSynthesis.speak(utterance);
  }
}

function speakChunks(
  chunks: string[],
  idx: number,
  options: SpeakOptions,
  firstUtterance: SpeechSynthesisUtterance
): void {
  if (idx >= chunks.length) { options.onEnd?.(); return; }

  const u = idx === 0 ? firstUtterance : new SpeechSynthesisUtterance(chunks[idx]);
  if (idx === 0) u.text = chunks[0]; // overwrite with first chunk

  const voice = selectVoice(options.settings.gender);
  if (voice) u.voice = voice;
  u.rate   = options.settings.rate;
  u.pitch  = options.settings.pitch;
  u.volume = options.settings.volume;

  u.onend = () => {
    if (idx === chunks.length - 1) {
      _currentUtterance = null;
      options.onEnd?.();
    } else {
      speakChunks(chunks, idx + 1, options, firstUtterance);
    }
  };
  u.onerror = (e) => { _currentUtterance = null; options.onError?.(e.error); };
  if (idx === 0) u.onstart = () => options.onStart?.();

  window.speechSynthesis.speak(u);
}

function splitIntoChunks(text: string, maxLen = 180): string[] {
  const sentences = text.match(/[^.!?]+[.!?]*/g) ?? [text];
  const chunks: string[] = [];
  let current = '';
  for (const s of sentences) {
    if ((current + s).length > maxLen && current) {
      chunks.push(current.trim());
      current = s;
    } else {
      current += s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export function stopSpeaking(): void {
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  _currentUtterance = null;
}

export function isSpeaking(): boolean {
  return typeof window !== 'undefined' &&
    window.speechSynthesis?.speaking === true;
}

// ── localStorage persistence ──────────────────────────────────────

const STORAGE_KEY = 'aria-voice-settings';

export function saveVoiceSettings(s: VoiceSettings): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /**/ }
}

export function loadVoiceSettings(): VoiceSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_VOICE_SETTINGS, ...JSON.parse(raw) };
  } catch { /**/ }
  return { ...DEFAULT_VOICE_SETTINGS };
}
