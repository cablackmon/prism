'use client';

import { useState, useRef, useCallback } from 'react';
import { toast } from '@/components/ui/use-toast';

export interface SpeechRecognizer {
  isListening: boolean;
  isSupported: boolean;
  start: () => void;
  stop: () => void;
  error: string | null;
}

// Browser SpeechRecognition API — not in standard TS DOM lib without @types/dom-speech-recognition
interface ISpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult:
    | ((e: {
        results: { length: number; [i: number]: { [j: number]: { transcript: string } } };
      }) => void)
    | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

interface SpeechRecognitionWindow {
  SpeechRecognition?: new () => ISpeechRecognition;
  webkitSpeechRecognition?: new () => ISpeechRecognition;
}

/**
 * v1: wraps webkitSpeechRecognition (built into Chrome/Edge).
 * To swap to cloud STT (Azure/Whisper/Deepgram) in v2: implement the same
 * SpeechRecognizer interface in a new file and update the import in useGlobalInput.tsx.
 */
export function useSpeechRecognition(onResult: (transcript: string) => void): SpeechRecognizer {
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<ISpeechRecognition | null>(null);

  const isSupported =
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  const start = useCallback(() => {
    if (!isSupported) {
      toast({ title: 'Voice input not supported in this browser.', variant: 'destructive' });
      return;
    }
    if (isListening) return;

    const win = window as unknown as SpeechRecognitionWindow;
    const Impl = win.SpeechRecognition ?? win.webkitSpeechRecognition;
    if (!Impl) return;

    const rec = new Impl();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = 'en-US';

    rec.onresult = (e) => {
      let transcript = '';
      for (let i = 0; i < e.results.length; i++) {
        transcript += e.results[i]?.[0]?.transcript ?? '';
      }
      onResult(transcript);
    };

    rec.onerror = (e) => {
      setIsListening(false);
      setError(e.error);
      const messages: Record<string, string> = {
        'no-speech': 'No speech detected. Tap the mic to try again.',
        'not-allowed': 'Microphone permission denied. Check browser settings.',
        network: 'Speech recognition needs an internet connection.',
        'audio-capture': 'No microphone found.',
      };
      if (e.error !== 'aborted' && messages[e.error]) {
        toast({ title: messages[e.error], variant: 'destructive' });
      }
    };

    rec.onend = () => setIsListening(false);

    recRef.current = rec;
    rec.start();
    setIsListening(true);
    setError(null);
  }, [isListening, isSupported, onResult]);

  const stop = useCallback(() => {
    recRef.current?.stop();
    setIsListening(false);
  }, []);

  return { isListening, isSupported, start, stop, error };
}
