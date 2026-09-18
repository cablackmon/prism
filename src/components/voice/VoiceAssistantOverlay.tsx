'use client';

import { Mic, Square, Volume2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  KystVoiceStreamClient,
  pcm16FromFloat32,
  type ResampleState,
  type VoiceStreamEvent,
} from '@/lib/voice/KystVoiceStreamClient';

type Phase = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error';
type VoiceEvent = {
  owner?: 'tap' | 'wake';
  phase?: Phase;
  error?: string;
};

const MAX_CAPTURE_MS = 15_000;
const MIN_CAPTURE_MS = 1_200;
const SILENCE_MS = 1_250;
const SILENCE_LEVEL = 0.035;

export class PcmPlaybackQueue {
  private context: AudioContext | null = null;
  private nextPlayAt = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private pendingPushes = 0;
  private generation = 0;
  private finishCallback: (() => void) | null = null;

  async unlock() {
    if (!this.context) this.context = new AudioContext();
    if (this.context.state === 'suspended') await this.context.resume();
  }

  async push(chunk: ArrayBuffer) {
    const generation = this.generation;
    this.pendingPushes += 1;
    let scheduled = false;
    try {
      await this.unlock();
      if (generation !== this.generation || !this.context || chunk.byteLength < 2) return;
      const aligned = chunk.byteLength - (chunk.byteLength % 2);
      const samples = new Int16Array(chunk.slice(0, aligned));
      const buffer = this.context.createBuffer(1, samples.length, 16_000);
      const channel = buffer.getChannelData(0);
      for (let index = 0; index < samples.length; index += 1) {
        const sample = samples[index] ?? 0;
        channel[index] = sample < 0 ? sample / 32768 : sample / 32767;
      }

      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.context.destination);
      const startsAt = Math.max(this.context.currentTime + 0.025, this.nextPlayAt);
      this.nextPlayAt = startsAt + buffer.duration;
      this.sources.add(source);
      source.onended = () => {
        this.sources.delete(source);
        this.maybeFinish();
      };
      source.start(startsAt);
      scheduled = true;
    } finally {
      this.pendingPushes -= 1;
      if (scheduled || generation !== this.generation) this.maybeFinish();
    }
  }

  finish(callback: () => void) {
    this.finishCallback = callback;
    this.maybeFinish();
  }

  private maybeFinish() {
    if (this.pendingPushes || this.sources.size || !this.finishCallback) return;
    const callback = this.finishCallback;
    this.finishCallback = null;
    callback();
  }

  stop() {
    this.generation += 1;
    this.finishCallback = null;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // A source may already have ended between iteration and stop().
      }
    }
    this.sources.clear();
    this.nextPlayAt = 0;
  }

  close() {
    this.stop();
    void this.context?.close();
    this.context = null;
  }
}

function voiceError(reason = '') {
  if (reason === 'socket_closed' || reason === 'socket_error') {
    return 'NOX lost the voice connection. Tap to reconnect.';
  }
  if (reason === 'silent_transcript' || reason === 'no speech detected') {
    return "I didn't hear a question. Tap to try again.";
  }
  if (reason === 'action_timeout') return 'That action took too long. Tap to try again.';
  return 'NOX could not finish that answer. Tap to try again.';
}

export function VoiceAssistantOverlay() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [level, setLevel] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const phaseRef = useRef<Phase>('idle');
  const owner = useRef<'tap' | 'wake' | null>(null);
  const requestId = useRef<string | null>(null);
  const client = useRef<KystVoiceStreamClient | null>(null);
  const playback = useRef(new PcmPlaybackQueue());
  const stream = useRef<MediaStream | null>(null);
  const captureContext = useRef<AudioContext | null>(null);
  const captureSource = useRef<MediaStreamAudioSourceNode | null>(null);
  const processor = useRef<ScriptProcessorNode | null>(null);
  const silentGain = useRef<GainNode | null>(null);
  const frame = useRef<number>();
  const captureTimer = useRef<number>();
  const idleTimer = useRef<number>();
  const resampleState = useRef<ResampleState>({});
  const heardAudio = useRef(false);
  const captureGeneration = useRef(0);

  const changePhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const resetCapture = useCallback(() => {
    if (frame.current) cancelAnimationFrame(frame.current);
    if (captureTimer.current) window.clearTimeout(captureTimer.current);
    frame.current = undefined;
    captureTimer.current = undefined;
    processor.current?.disconnect();
    captureSource.current?.disconnect();
    silentGain.current?.disconnect();
    processor.current = null;
    captureSource.current = null;
    silentGain.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    void captureContext.current?.close();
    captureContext.current = null;
    resampleState.current = {};
    setLevel(0);
  }, []);

  const finishUi = useCallback(() => {
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      requestId.current = null;
      owner.current = null;
      setTranscript('');
      setAnswer('');
      changePhase('idle');
    }, 3_000);
  }, [changePhase]);

  const handleStreamEvent = useCallback(
    (event: VoiceStreamEvent) => {
      if (event.requestId && event.requestId !== requestId.current) return;
      if (event.type === 'transcript.delta' && event.text) {
        // Phase 1 sends full interim/final snapshots even though the event is named delta.
        setTranscript(event.text);
      } else if (event.type === 'answer.delta' && event.text) {
        setAnswer((current) => `${current}${event.text}`);
        if (!heardAudio.current) changePhase('thinking');
      } else if (event.type === 'audio.start') {
        changePhase('speaking');
      } else if (event.type === 'speech.end') {
        resetCapture();
        changePhase('thinking');
      } else if (event.type === 'complete') {
        resetCapture();
        if (event.emptyTranscript || event.reason === 'no speech detected') {
          playback.current.stop();
          setError(voiceError(event.reason));
          owner.current = null;
          requestId.current = null;
          changePhase('error');
        } else {
          playback.current.finish(finishUi);
        }
      } else if (event.type === 'error' || event.type === 'fallback') {
        resetCapture();
        playback.current.stop();
        setError(voiceError(event.reason));
        owner.current = null;
        requestId.current = null;
        changePhase('error');
      }
    },
    [changePhase, finishUi, resetCapture]
  );

  useEffect(() => {
    const audioQueue = playback.current;
    const voiceClient = new KystVoiceStreamClient({
      onEvent: handleStreamEvent,
      onAudio: (chunk, audioRequestId) => {
        if (audioRequestId !== requestId.current) return;
        const firstAudio = !heardAudio.current;
        heardAudio.current = true;
        changePhase('speaking');
        void audioQueue
          .push(chunk)
          .then(() => {
            if (firstAudio) voiceClient.playbackStarted(audioRequestId);
          })
          .catch(() => {
            voiceClient.cancelTurn('audio_playback_failed');
            audioQueue.stop();
            setError('I found the answer, but could not play it.');
            changePhase('error');
          });
      },
    });
    client.current = voiceClient;
    void voiceClient.connect().catch(() => {
      // Connection is retried on the first tap; keep an idle board quiet.
    });
    return () => {
      captureGeneration.current += 1;
      voiceClient.disconnect('unmount');
      client.current = null;
      resetCapture();
      audioQueue.close();
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
    };
  }, [changePhase, handleStreamEvent, resetCapture]);

  const endCapture = useCallback(() => {
    if (phaseRef.current !== 'listening') return;
    resetCapture();
    if (client.current?.endTurn()) changePhase('thinking');
    else {
      setError('NOX lost the voice connection. Tap to reconnect.');
      owner.current = null;
      requestId.current = null;
      changePhase('error');
    }
  }, [changePhase, resetCapture]);

  const cancelTurn = useCallback(
    (reason = 'barge_in') => {
      captureGeneration.current += 1;
      client.current?.cancelTurn(reason);
      resetCapture();
      playback.current.stop();
      requestId.current = null;
      owner.current = null;
    },
    [resetCapture]
  );

  const beginCapture = useCallback(
    async (nextOwner: 'tap' | 'wake' = 'tap') => {
      if (phaseRef.current === 'listening') return endCapture();
      if (phaseRef.current === 'connecting') return;
      if (phaseRef.current === 'thinking' || phaseRef.current === 'speaking') {
        cancelTurn('barge_in');
      }
      const generation = ++captureGeneration.current;
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
      owner.current = nextOwner;
      setTranscript('');
      setAnswer('');
      setError('');
      heardAudio.current = false;
      changePhase('connecting');

      try {
        // Playback must be unlocked during the initiating gesture on mobile browsers.
        const playbackUnlock = playback.current.unlock();
        const mediaPromise = navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: 'default',
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        const [unlockResult, connectionResult, mediaResult] = await Promise.allSettled([
          playbackUnlock,
          client.current?.connect(),
          mediaPromise,
        ]);
        const media = mediaResult.status === 'fulfilled' ? mediaResult.value : null;
        if (generation !== captureGeneration.current) {
          media?.getTracks().forEach((track) => track.stop());
          return;
        }
        if (unlockResult.status === 'rejected') throw unlockResult.reason;
        if (connectionResult.status === 'rejected') throw connectionResult.reason;
        if (mediaResult.status === 'rejected') throw mediaResult.reason;
        if (!media) throw new Error('Microphone access is needed to ask NOX.');
        stream.current = media;

        const id = crypto.randomUUID();
        requestId.current = id;
        if (!client.current?.startTurn(id)) throw new Error('voice socket is not ready');

        const context = new AudioContext();
        captureContext.current = context;
        if (context.state === 'suspended') await context.resume();
        const source = context.createMediaStreamSource(media);
        const analyser = context.createAnalyser();
        const captureProcessor = context.createScriptProcessor(2_048, 1, 1);
        const mute = context.createGain();
        mute.gain.value = 0;
        captureSource.current = source;
        processor.current = captureProcessor;
        silentGain.current = mute;
        source.connect(analyser);
        source.connect(captureProcessor);
        captureProcessor.connect(mute);
        mute.connect(context.destination);
        captureProcessor.onaudioprocess = (event) => {
          if (phaseRef.current !== 'listening') return;
          const pcm = pcm16FromFloat32(
            event.inputBuffer.getChannelData(0),
            context.sampleRate,
            resampleState.current
          );
          client.current?.sendAudio(pcm);
        };

        const samples = new Uint8Array(analyser.fftSize);
        const startedAt = performance.now();
        let heardVoice = false;
        let quietSince = 0;
        changePhase('listening');
        window.dispatchEvent(
          new CustomEvent('prism:voice-session', {
            detail: { owner: nextOwner, phase: 'listening', requestId: id },
          })
        );

        const meter = () => {
          if (phaseRef.current !== 'listening') return;
          analyser.getByteTimeDomainData(samples);
          const rms = Math.sqrt(
            samples.reduce((sum, sample) => sum + ((sample - 128) / 128) ** 2, 0) / samples.length
          );
          setLevel(Math.min(1, rms * 5));
          const now = performance.now();
          if (rms > SILENCE_LEVEL) {
            heardVoice = true;
            quietSince = 0;
          } else if (heardVoice) {
            if (!quietSince) quietSince = now;
            if (now - quietSince > SILENCE_MS && now - startedAt > MIN_CAPTURE_MS) {
              return endCapture();
            }
          }
          frame.current = requestAnimationFrame(meter);
        };
        meter();
        captureTimer.current = window.setTimeout(endCapture, MAX_CAPTURE_MS);
      } catch (cause) {
        if (generation !== captureGeneration.current) return;
        cancelTurn('capture_setup_failed');
        setError(
          cause instanceof DOMException && cause.name === 'NotAllowedError'
            ? 'Microphone access is needed to ask NOX.'
            : cause instanceof Error
              ? cause.message
              : 'NOX voice is not ready yet.'
        );
        changePhase('error');
      }
    },
    [cancelTurn, changePhase, endCapture]
  );

  useEffect(() => {
    const onVoice = (event: Event) => {
      const detail = (event as CustomEvent<VoiceEvent>).detail || {};
      const incomingOwner = detail.owner || 'wake';
      if (detail.error) {
        setError(detail.error);
        changePhase('error');
      } else if (detail.phase === 'listening' && !owner.current) {
        void beginCapture(incomingOwner);
      }
    };
    window.addEventListener('prism:voice-assistant', onVoice);
    return () => window.removeEventListener('prism:voice-assistant', onVoice);
  }, [beginCapture, changePhase]);

  const close = () => {
    cancelTurn('dismissed');
    changePhase('idle');
    setTranscript('');
    setAnswer('');
    setError('');
  };

  const active = phase !== 'idle';
  const label =
    phase === 'listening'
      ? 'Stop and send voice question'
      : phase === 'thinking' || phase === 'speaking'
        ? 'Interrupt and ask NOX'
        : 'Ask NOX by voice';

  return (
    <div
      data-screensaver-keep
      data-voice-assistant-active={active ? 'true' : 'false'}
      className="fixed bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] right-[max(1rem,env(safe-area-inset-right))] z-[10020] flex max-w-[min(28rem,calc(100vw-2rem))] items-end gap-3 lg:bottom-[max(1.25rem,env(safe-area-inset-bottom))] lg:right-[max(1.25rem,env(safe-area-inset-right))]"
    >
      {active && (
        <section
          role="status"
          aria-live="polite"
          aria-atomic="false"
          className="min-w-56 flex-1 rounded-2xl border border-border bg-card/95 p-4 text-card-foreground shadow-2xl backdrop-blur-xl"
        >
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            {phase === 'speaking' ? (
              <Volume2 className="h-4 w-4 text-primary" aria-hidden="true" />
            ) : (
              <Mic className="h-4 w-4 text-primary" aria-hidden="true" />
            )}
            <span>
              {phase === 'connecting'
                ? 'Connecting…'
                : phase === 'listening'
                  ? 'Listening…'
                  : phase === 'thinking'
                    ? 'Thinking…'
                    : phase === 'speaking'
                      ? 'NOX is speaking'
                      : 'Couldn’t finish'}
            </span>
            <button
              type="button"
              onClick={close}
              className="ml-auto grid h-[44px] w-[44px] place-items-center rounded-full text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Close voice assistant"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {phase === 'listening' && (
            <div
              className="flex h-10 items-center justify-center gap-1"
              aria-label="Live microphone level"
            >
              {[0.55, 0.8, 1, 0.75, 0.45].map((scale, index) => (
                <span
                  key={index}
                  className="w-1.5 rounded-full bg-primary transition-[height] duration-75 motion-reduce:transition-none"
                  style={{ height: `${8 + level * 30 * scale}px` }}
                />
              ))}
            </div>
          )}
          {(phase === 'connecting' || phase === 'thinking') && !transcript && (
            <div className="flex gap-1 py-3" aria-hidden="true">
              {[0, 1, 2].map((index) => (
                <span
                  key={index}
                  className="h-2 w-2 animate-bounce rounded-full bg-primary motion-reduce:animate-none"
                  style={{ animationDelay: `${index * 120}ms` }}
                />
              ))}
            </div>
          )}
          {transcript && (
            <div className="mt-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                You
              </p>
              <p className="text-sm leading-relaxed">{transcript}</p>
            </div>
          )}
          {answer && (
            <div className="mt-3 border-t border-border pt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">NOX</p>
              <p className="text-sm leading-relaxed">{answer}</p>
            </div>
          )}
          {phase === 'error' && <p className="text-sm text-destructive">{error}</p>}
        </section>
      )}

      <button
        type="button"
        onClick={() => void beginCapture('tap')}
        aria-label={label}
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
          <Square className="relative h-5 w-5 fill-current" aria-hidden="true" />
        ) : (
          <Mic className="relative h-7 w-7" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
