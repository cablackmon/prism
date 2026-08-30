'use client';

import { Mic, Square, Volume2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

type Phase = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';
type VoiceEvent = {
  owner?: 'tap' | 'wake';
  phase?: Phase;
  answer?: string;
  audioUrl?: string;
  error?: string;
};

const MAX_MS = 15_000;
const SILENCE_MS = 1_250;
const SILENCE_LEVEL = 0.035;

function decodeMeta(value: string | null) {
  if (!value) return {} as { answer?: string };
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(window.atob(normalized)))) as { answer?: string };
  } catch {
    return {} as { answer?: string };
  }
}

function playTone(freq: number, durationMs: number, volume = 0.22) {
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.connect(gain);
    gain.connect(context.destination);

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(freq, context.currentTime);
    gain.gain.setValueAtTime(volume, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + durationMs / 1000);

    oscillator.start(context.currentTime);
    oscillator.stop(context.currentTime + durationMs / 1000);

    window.setTimeout(() => {
      void context.close();
    }, durationMs + 40);
  } catch {
    // Ignore autoplay policy or audio-context failures.
  }
}

export function VoiceAssistantOverlay() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [level, setLevel] = useState(0);
  const [answer, setAnswer] = useState('');
  const [shownAnswer, setShownAnswer] = useState('');
  const [error, setError] = useState('');
  const owner = useRef<'tap' | 'wake' | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const frame = useRef<number>();
  const cancelTimer = useRef<number>();

  const resetCapture = useCallback(() => {
    if (frame.current) cancelAnimationFrame(frame.current);
    if (cancelTimer.current) window.clearTimeout(cancelTimer.current);
    stream.current?.getTracks().forEach((track) => track.stop());
    void audioContext.current?.close();
    stream.current = null;
    audioContext.current = null;
    setLevel(0);
  }, []);

  const playAnswer = useCallback((text: string, url: string) => {
    setAnswer(text);
    setShownAnswer('');
    setPhase('speaking');
    const audio = new Audio(url);
    const reveal = window.setInterval(() => {
      setShownAnswer((current) => text.slice(0, Math.min(text.length, current.length + 3)));
    }, 45);
    audio.onended = () => {
      window.clearInterval(reveal);
      setShownAnswer(text);
      window.setTimeout(() => {
        setPhase('idle');
        setAnswer('');
        owner.current = null;
      }, 3_000);
      URL.revokeObjectURL(url);
    };
    audio.onerror = () => {
      window.clearInterval(reveal);
      setShownAnswer(text);
      setPhase('error');
      setError('I found the answer, but could not play it.');
    };
    void audio.play();
  }, []);

  const submit = useCallback(
    async (blob: Blob) => {
      resetCapture();
      setPhase('thinking');
      try {
        const accepted = await fetch('/api/nox-voice/ask', {
          method: 'POST',
          headers: { 'content-type': blob.type || 'audio/webm' },
          body: blob,
        });
        if (!accepted.ok)
          throw new Error(
            accepted.status === 429
              ? 'Too many questions. Try again in a minute.'
              : 'NOX could not accept the recording.'
          );
        const job = (await accepted.json()) as { id: string };
        for (let attempt = 0; attempt < 150; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 800));
          const response = await fetch(`/api/nox-voice/answer/${job.id}`, { cache: 'no-store' });
          if (response.status === 202) continue;
          if (!response.ok) throw new Error('NOX could not answer that question.');
          const meta = decodeMeta(response.headers.get('x-nox-meta'));
          const audioBlob = await response.blob();
          return playAnswer(meta.answer || 'Here is what I found.', URL.createObjectURL(audioBlob));
        }
        throw new Error('NOX took too long to answer.');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Something went wrong.');
        setPhase('error');
        owner.current = null;
      }
    },
    [playAnswer, resetCapture]
  );

  const stop = useCallback(
    (cancel = false) => {
      const active = recorder.current;
      if (!active || active.state === 'inactive') return;
      if (cancel) active.onstop = () => resetCapture();
      active.stop();
      if (cancel) {
        owner.current = null;
        setPhase('idle');
      }
    },
    [resetCapture]
  );

  const start = useCallback(async () => {
    if (owner.current) return stop(true);
    owner.current = 'tap';
    playTone(1140, 85);
    setAnswer('');
    setError('');
    setPhase('listening');
    window.dispatchEvent(
      new CustomEvent('prism:voice-session', { detail: { owner: 'tap', phase: 'listening' } })
    );
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: 'default', echoCancellation: true, noiseSuppression: true },
      });
      stream.current = media;
      const chunks: BlobPart[] = [];
      const active = new MediaRecorder(
        media,
        MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? { mimeType: 'audio/webm;codecs=opus' }
          : undefined
      );
      recorder.current = active;
      active.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      active.onstop = () =>
        void submit(new Blob(chunks, { type: active.mimeType || 'audio/webm' }));
      active.start(200);

      const context = new AudioContext();
      audioContext.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaStreamSource(media).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      let heardVoice = false;
      let silentSince = performance.now();
      const meter = () => {
        analyser.getByteTimeDomainData(samples);
        const rms = Math.sqrt(
          samples.reduce((sum, sample) => sum + ((sample - 128) / 128) ** 2, 0) / samples.length
        );
        setLevel(Math.min(1, rms * 5));
        if (rms > SILENCE_LEVEL) {
          heardVoice = true;
          silentSince = performance.now();
        }
        if (heardVoice && performance.now() - silentSince > SILENCE_MS) return stop();
        frame.current = requestAnimationFrame(meter);
      };
      meter();
      cancelTimer.current = window.setTimeout(() => stop(), MAX_MS);
    } catch {
      resetCapture();
      owner.current = null;
      setError('Microphone access is needed to ask NOX.');
      setPhase('error');
    }
  }, [resetCapture, stop, submit]);

  useEffect(() => {
    const onVoice = (event: Event) => {
      const detail = (event as CustomEvent<VoiceEvent>).detail;
      const incomingOwner = detail.owner || 'wake';
      if (owner.current && owner.current !== incomingOwner) return;
      owner.current = incomingOwner;
      if (detail.error) {
        setError(detail.error);
        setPhase('error');
      } else if (detail.answer && detail.audioUrl) playAnswer(detail.answer, detail.audioUrl);
      else if (detail.phase) setPhase(detail.phase);
    };
    window.addEventListener('prism:voice-assistant', onVoice);
    return () => {
      window.removeEventListener('prism:voice-assistant', onVoice);
      resetCapture();
    };
  }, [playAnswer, resetCapture]);

  const active = phase !== 'idle';
  return (
    <div
      data-screensaver-keep
      className="fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-[max(1.25rem,env(safe-area-inset-right))] z-[10020] flex max-w-[min(26rem,calc(100vw-2rem))] items-end gap-3"
    >
      {active && (
        <section
          role="status"
          aria-live="polite"
          className="min-w-56 rounded-2xl border border-border bg-card/95 p-4 text-card-foreground shadow-2xl backdrop-blur-xl"
        >
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            {phase === 'speaking' ? (
              <Volume2 className="h-4 w-4 text-primary" />
            ) : (
              <Mic className="h-4 w-4 text-primary" />
            )}
            <span>
              {phase === 'listening'
                ? 'Listening…'
                : phase === 'thinking'
                  ? 'Thinking…'
                  : phase === 'speaking'
                    ? 'NOX'
                    : 'Couldn’t finish'}
            </span>
            <button
              onClick={() => {
                stop(true);
                setPhase('idle');
                owner.current = null;
              }}
              className="ml-auto rounded-full p-1 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Close voice assistant"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {phase === 'listening' && (
            <div
              className="flex h-10 items-center justify-center gap-1"
              aria-label="Live microphone level"
            >
              {[0.55, 0.8, 1, 0.75, 0.45].map((scale, i) => (
                <span
                  key={i}
                  className="w-1.5 rounded-full bg-primary transition-[height] duration-75 motion-reduce:transition-none"
                  style={{ height: `${8 + level * 30 * scale}px` }}
                />
              ))}
            </div>
          )}
          {phase === 'thinking' && (
            <div className="flex gap-1 py-3" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-2 w-2 animate-bounce rounded-full bg-primary motion-reduce:animate-none"
                  style={{ animationDelay: `${i * 120}ms` }}
                />
              ))}
            </div>
          )}
          {phase === 'speaking' && (
            <p className="text-sm leading-relaxed">{shownAnswer || answer}</p>
          )}
          {phase === 'error' && <p className="text-sm text-destructive">{error}</p>}
        </section>
      )}
      <button
        type="button"
        onClick={() => void start()}
        aria-label={phase === 'listening' ? 'Cancel voice capture' : 'Ask NOX by voice'}
        aria-pressed={phase === 'listening'}
        className="relative grid h-16 w-16 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-xl transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-95 motion-reduce:transition-none"
      >
        {phase === 'listening' && (
          <span
            aria-hidden="true"
            className="absolute inset-0 animate-ping rounded-full bg-primary/40 motion-reduce:animate-none"
            style={{ transform: `scale(${1 + level * 0.25})` }}
          />
        )}
        {phase === 'listening' ? (
          <Square className="relative h-5 w-5 fill-current" />
        ) : (
          <Mic className="relative h-7 w-7" />
        )}
      </button>
    </div>
  );
}
