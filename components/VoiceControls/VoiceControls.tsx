'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  VoiceSettings,
  VoiceGender,
  loadVoiceSettings,
  saveVoiceSettings,
  isTTSSupported,
  loadVoices,
  stopSpeaking,
} from '@/lib/voice';
import { isSoundEnabled, setSoundEnabled, unlockAudio } from '@/lib/sounds';
import './VoiceControls.css';

interface VoiceControlsProps {
  onSettingsChange: (s: VoiceSettings) => void;
}

export default function VoiceControls({ onSettingsChange }: VoiceControlsProps) {
  const [settings, setSettings]   = useState<VoiceSettings>(loadVoiceSettings);
  // Initialise from client-only APIs lazily (avoids SSR mismatch + effect-setState lint rule)
  const [ttsSupported, setTts]    = useState(false);
  const [soundOn, setSoundOn]     = useState(true);
  const [open, setOpen]           = useState(false);
  const initDone = useRef(false);

  useEffect(() => {
    if (initDone.current) return;
    initDone.current = true;
    // Batch into a single state update by reading both values synchronously
    const tts  = isTTSSupported();
    const snd  = isSoundEnabled();
    // Single "logical" commit — React 19 batches these automatically
    requestAnimationFrame(() => {
      setTts(tts);
      setSoundOn(snd);
    });
    loadVoices().catch(() => {/* ignore */});
  }, []);

  const update = useCallback((patch: Partial<VoiceSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveVoiceSettings(next);
      // Defer to avoid "setState during render" React warning
      setTimeout(() => onSettingsChange(next), 0);
      return next;
    });
  }, [onSettingsChange]);

  const toggleSound = useCallback(() => {
    unlockAudio();
    setSoundOn((prev) => {
      setSoundEnabled(!prev);
      return !prev;
    });
  }, []);

  const toggleAutoSpeak = useCallback(() => {
    unlockAudio();
    if (settings.autoSpeak) stopSpeaking();
    update({ autoSpeak: !settings.autoSpeak });
  }, [settings.autoSpeak, update]);

  const GENDER_OPTIONS: { value: VoiceGender; label: string; icon: string }[] = [
    { value: 'female', label: 'Female', icon: '♀' },
    { value: 'male',   label: 'Male',   icon: '♂' },
    { value: 'auto',   label: 'Auto',   icon: '◎' },
  ];

  return (
    <div className="vc">
      {/* Quick-access bar */}
      <div className="vc__bar">
        {/* Sound toggle */}
        <button
          className={`vc__icon-btn ${soundOn ? 'vc__icon-btn--active' : ''}`}
          onClick={toggleSound}
          title={soundOn ? 'Mute sound effects' : 'Enable sound effects'}
          aria-label={soundOn ? 'Mute sounds' : 'Unmute sounds'}
          type="button"
        >
          {soundOn ? '🔊' : '🔇'}
        </button>

        {/* Voice / TTS toggle */}
        {ttsSupported && (
          <button
            className={`vc__icon-btn ${settings.autoSpeak ? 'vc__icon-btn--active' : ''}`}
            onClick={toggleAutoSpeak}
            title={settings.autoSpeak ? 'Disable AI voice' : 'Enable AI voice'}
            aria-label={settings.autoSpeak ? 'Disable voice' : 'Enable voice'}
            type="button"
          >
            {settings.autoSpeak ? '🎙️' : '🔕'}
          </button>
        )}

        {/* Settings drawer toggle */}
        <button
          className={`vc__icon-btn ${open ? 'vc__icon-btn--active' : ''}`}
          onClick={() => setOpen((p) => !p)}
          title="Voice settings"
          aria-label="Open voice settings"
          aria-expanded={open}
          type="button"
        >
          🎛️
        </button>
      </div>

      {/* Expandable settings drawer */}
      {open && ttsSupported && (
        <div className="vc__drawer" role="region" aria-label="Voice settings">
          <p className="vc__drawer-title">Voice Settings</p>

          {/* Gender picker */}
          <div className="vc__field">
            <label className="vc__label">Voice</label>
            <div className="vc__gender-row">
              {GENDER_OPTIONS.map((g) => (
                <button
                  key={g.value}
                  type="button"
                  className={`vc__gender-btn ${settings.gender === g.value ? 'vc__gender-btn--active' : ''}`}
                  onClick={() => update({ gender: g.value })}
                  aria-pressed={settings.gender === g.value}
                >
                  <span className="vc__gender-icon">{g.icon}</span>
                  {g.label}
                </button>
              ))}
            </div>
          </div>

          {/* Speed */}
          <div className="vc__field">
            <label className="vc__label" htmlFor="vc-rate">
              Speed <span className="vc__val">{settings.rate.toFixed(1)}×</span>
            </label>
            <input
              id="vc-rate"
              type="range"
              className="vc__slider"
              min={0.5} max={1.8} step={0.1}
              value={settings.rate}
              onChange={(e) => update({ rate: parseFloat(e.target.value) })}
              aria-label="Speech rate"
            />
            <div className="vc__range-labels"><span>Slow</span><span>Fast</span></div>
          </div>

          {/* Pitch */}
          <div className="vc__field">
            <label className="vc__label" htmlFor="vc-pitch">
              Pitch <span className="vc__val">{settings.pitch.toFixed(1)}</span>
            </label>
            <input
              id="vc-pitch"
              type="range"
              className="vc__slider"
              min={0.6} max={1.6} step={0.1}
              value={settings.pitch}
              onChange={(e) => update({ pitch: parseFloat(e.target.value) })}
              aria-label="Speech pitch"
            />
            <div className="vc__range-labels"><span>Low</span><span>High</span></div>
          </div>

          {/* Volume */}
          <div className="vc__field">
            <label className="vc__label" htmlFor="vc-vol">
              Volume <span className="vc__val">{Math.round(settings.volume * 100)}%</span>
            </label>
            <input
              id="vc-vol"
              type="range"
              className="vc__slider"
              min={0} max={1} step={0.05}
              value={settings.volume}
              onChange={(e) => update({ volume: parseFloat(e.target.value) })}
              aria-label="Voice volume"
            />
            <div className="vc__range-labels"><span>Quiet</span><span>Loud</span></div>
          </div>

          {/* Auto-speak */}
          <label className="vc__toggle-row" htmlFor="vc-autospeak">
            <span className="vc__label">Auto-speak replies</span>
            <span className="vc__toggle-wrap">
              <input
                id="vc-autospeak"
                type="checkbox"
                className="vc__checkbox"
                checked={settings.autoSpeak}
                onChange={toggleAutoSpeak}
              />
              <span className="vc__toggle-thumb" aria-hidden="true" />
            </span>
          </label>

          <p className="vc__hint">
            Voices available: {typeof window !== 'undefined' && window.speechSynthesis
              ? window.speechSynthesis.getVoices().filter(v => v.lang.startsWith('en')).length
              : 0} English
          </p>
        </div>
      )}
    </div>
  );
}
