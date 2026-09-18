/**
 * @jest-environment jsdom
 */

import * as React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const connect = jest.fn(async () => undefined);
const startTurn = jest.fn(() => true);
const endTurn = jest.fn(() => true);
const cancelTurn = jest.fn();
const disconnect = jest.fn();
const playbackStarted = jest.fn();
const discardPendingPlayback = jest.fn();
let emit: ((event: Record<string, unknown>) => void) | undefined;
let emitAudio: ((chunk: ArrayBuffer, requestId: string) => void) | undefined;

jest.mock('@/lib/voice/KystVoiceStreamClient', () => ({
  KystVoiceStreamClient: jest.fn().mockImplementation(({ onEvent, onAudio }) => {
    emit = onEvent;
    emitAudio = onAudio;
    return {
      connect,
      startTurn,
      endTurn,
      cancelTurn,
      disconnect,
      playbackStarted,
      discardPendingPlayback,
      sendAudio: jest.fn(),
    };
  }),
  pcm16FromFloat32: jest.fn(() => new ArrayBuffer(2)),
}));

import { PcmPlaybackQueue, VoiceAssistantOverlay } from '../VoiceAssistantOverlay';

function installCaptureMocks(
  options: { audioState?: AudioContextState; resumeError?: Error } = {}
) {
  const stop = jest.fn();
  const resume = jest.fn(async () => {
    if (options.resumeError) throw options.resumeError;
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: jest.fn(async () => ({ getTracks: () => [{ stop }] })) },
  });

  class FakeAudioContext {
    state = options.audioState || 'running';
    sampleRate = 48_000;
    currentTime = 0;
    destination = {};
    resume = resume;
    close = jest.fn(async () => undefined);
    createMediaStreamSource() {
      return { connect: jest.fn(), disconnect: jest.fn() };
    }
    createAnalyser() {
      return {
        fftSize: 32,
        getByteTimeDomainData: (samples: Uint8Array) => samples.fill(128),
      };
    }
    createScriptProcessor() {
      return { connect: jest.fn(), disconnect: jest.fn(), onaudioprocess: null };
    }
    createGain() {
      return { gain: { value: 1 }, connect: jest.fn(), disconnect: jest.fn() };
    }
  }
  Object.defineProperty(window, 'AudioContext', {
    configurable: true,
    value: FakeAudioContext,
  });
  jest.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  return { resume, stop };
}

describe('VoiceAssistantOverlay accessibility and turn controls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    emit = undefined;
    emitAudio = undefined;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('exposes a persistent four-rem tap target with a descriptive accessible name', () => {
    render(<VoiceAssistantOverlay />);

    const mic = screen.getByRole('button', { name: 'Ask NOX by voice' });
    expect(mic.getAttribute('aria-pressed')).toBe('false');
    expect(mic.className).toContain('h-16');
    expect(mic.className).toContain('w-16');
    expect(mic.className).toContain('focus-visible:ring-4');
    expect(mic.closest('[data-screensaver-keep]')).not.toBeNull();
  });

  it('announces errors and restores the idle control when dismissed', async () => {
    render(<VoiceAssistantOverlay />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent('prism:voice-assistant', {
          detail: { owner: 'wake', error: 'The microphone is unavailable.' },
        })
      );
    });

    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toContain('The microphone is unavailable.');
    expect(screen.getByRole('button', { name: 'Close voice assistant' }).className).toContain(
      'h-[44px]'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close voice assistant' }));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(screen.getByRole('button', { name: 'Ask NOX by voice' })).toBeTruthy();
    expect(cancelTurn).toHaveBeenCalledWith('dismissed');
  });

  it('streams transcript and answer text for only the active request', async () => {
    jest
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValue('6f9619ff-8b86-d011-b42d-00cf4fc964ff');
    const { stop } = installCaptureMocks();

    render(<VoiceAssistantOverlay />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask NOX by voice' }));

    await waitFor(() =>
      expect(startTurn).toHaveBeenCalledWith('6f9619ff-8b86-d011-b42d-00cf4fc964ff')
    );
    expect(screen.getByRole('button', { name: 'Stop and send voice question' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stop and send voice question' }));
    await waitFor(() => expect(endTurn).toHaveBeenCalledTimes(1));
    expect(stop).toHaveBeenCalledTimes(1);

    act(() => {
      emit?.({
        type: 'transcript.delta',
        requestId: 'other-request',
        text: 'Ignore me',
      });
      emit?.({
        type: 'transcript.delta',
        requestId: '6f9619ff-8b86-d011-b42d-00cf4fc964ff',
        text: 'What is on',
        final: false,
      });
      emit?.({
        type: 'transcript.delta',
        requestId: '6f9619ff-8b86-d011-b42d-00cf4fc964ff',
        text: 'What is on the calendar today?',
        final: true,
      });
      emit?.({
        type: 'answer.delta',
        requestId: '6f9619ff-8b86-d011-b42d-00cf4fc964ff',
        text: 'Dinner is at six.',
      });
    });

    const status = screen.getByRole('status');
    expect(status.textContent).toContain('What is on the calendar today?');
    expect(status.textContent).toContain('Dinner is at six.');
    expect(status.textContent).not.toContain('Ignore me');
    expect(screen.getByRole('button', { name: 'Interrupt and ask NOX' })).toBeTruthy();

    act(() => {
      emit?.({
        type: 'complete',
        requestId: '6f9619ff-8b86-d011-b42d-00cf4fc964ff',
        emptyTranscript: true,
        reason: 'no speech detected',
      });
    });
    expect(status.textContent).toContain("I didn't hear a question. Tap to try again.");
  });

  it('stops local capture when server VAD reports the end of speech', async () => {
    jest
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValue('6f9619ff-8b86-d011-b42d-00cf4fc964ff');
    const { stop } = installCaptureMocks();

    render(<VoiceAssistantOverlay />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask NOX by voice' }));
    await screen.findByRole('button', { name: 'Stop and send voice question' });

    act(() => {
      emit?.({
        type: 'speech.end',
        requestId: '6f9619ff-8b86-d011-b42d-00cf4fc964ff',
      });
    });

    expect(stop).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Interrupt and ask NOX' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Thinking…');
  });

  it('clears the stale client turn when ending capture fails', async () => {
    jest
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValue('6f9619ff-8b86-d011-b42d-00cf4fc964ff');
    installCaptureMocks();
    endTurn.mockReturnValueOnce(false);

    render(<VoiceAssistantOverlay />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask NOX by voice' }));
    await screen.findByRole('button', { name: 'Stop and send voice question' });
    fireEvent.click(screen.getByRole('button', { name: 'Stop and send voice question' }));

    expect(cancelTurn).toHaveBeenCalledWith('end_turn_failed');
    expect(screen.getByRole('status').textContent).toContain(
      'NOX lost the voice connection. Tap to reconnect.'
    );
  });

  it('unlocks playback synchronously from the initiating tap', async () => {
    jest
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValue('6f9619ff-8b86-d011-b42d-00cf4fc964ff');
    const { resume } = installCaptureMocks({ audioState: 'suspended' });

    render(<VoiceAssistantOverlay />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask NOX by voice' }));

    expect(resume).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(startTurn).toHaveBeenCalledTimes(1));
  });

  it('stops an acquired microphone stream when setup fails', async () => {
    const { stop } = installCaptureMocks({
      audioState: 'suspended',
      resumeError: new Error('Playback unavailable.'),
    });

    render(<VoiceAssistantOverlay />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask NOX by voice' }));

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('Playback unavailable.')
    );
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('does not resume a dismissed capture after its audio context unlocks', async () => {
    let resumeCapture: (() => void) | undefined;
    let resumeCalls = 0;
    const stop = jest.fn();
    const createMediaStreamSource = jest.fn(() => ({ connect: jest.fn(), disconnect: jest.fn() }));
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: jest.fn(async () => ({ getTracks: () => [{ stop }] })) },
    });
    class FakeAudioContext {
      state = 'suspended';
      sampleRate = 48_000;
      currentTime = 0;
      destination = {};
      close = jest.fn(async () => undefined);
      resume = jest.fn(() => {
        resumeCalls += 1;
        if (resumeCalls === 1) return Promise.resolve();
        return new Promise<void>((resolve) => {
          resumeCapture = resolve;
        });
      });
      createMediaStreamSource = createMediaStreamSource;
      createAnalyser() {
        return { fftSize: 32, getByteTimeDomainData: jest.fn() };
      }
      createScriptProcessor() {
        return { connect: jest.fn(), disconnect: jest.fn(), onaudioprocess: null };
      }
      createGain() {
        return { gain: { value: 1 }, connect: jest.fn(), disconnect: jest.fn() };
      }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext });

    render(<VoiceAssistantOverlay />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask NOX by voice' }));
    expect(resumeCalls).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'Close voice assistant' }));

    await act(async () => {
      resumeCapture?.();
      await Promise.resolve();
    });

    expect(createMediaStreamSource).not.toHaveBeenCalled();
    expect(startTurn).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: 'Ask NOX by voice' })).toBeTruthy();
  });

  it('ignores a stale playback failure after barge-in starts a new turn', async () => {
    jest
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('6f9619ff-8b86-d011-b42d-00cf4fc96401')
      .mockReturnValueOnce('6f9619ff-8b86-d011-b42d-00cf4fc96402');
    installCaptureMocks();
    let rejectPlayback: ((reason: Error) => void) | undefined;
    jest.spyOn(PcmPlaybackQueue.prototype, 'push').mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectPlayback = reject;
        })
    );

    render(<VoiceAssistantOverlay />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask NOX by voice' }));
    await screen.findByRole('button', { name: 'Stop and send voice question' });
    act(() => {
      emitAudio?.(new ArrayBuffer(2), '6f9619ff-8b86-d011-b42d-00cf4fc96401');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Interrupt and ask NOX' }));
    await waitFor(() => expect(startTurn).toHaveBeenCalledTimes(2));

    await act(async () => {
      rejectPlayback?.(new Error('stale playback failure'));
      await Promise.resolve();
    });

    expect(cancelTurn).not.toHaveBeenCalledWith('audio_playback_failed');
    expect(screen.getByRole('button', { name: 'Stop and send voice question' })).toBeTruthy();
  });

  it('ignores an external error owned by a different voice session', async () => {
    jest
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValue('6f9619ff-8b86-d011-b42d-00cf4fc964ff');
    installCaptureMocks();

    render(<VoiceAssistantOverlay />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask NOX by voice' }));
    await screen.findByRole('button', { name: 'Stop and send voice question' });
    act(() => {
      window.dispatchEvent(
        new CustomEvent('prism:voice-assistant', {
          detail: { owner: 'wake', error: 'Wake-word capture failed.' },
        })
      );
    });

    expect(screen.getByRole('button', { name: 'Stop and send voice question' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).not.toContain('Wake-word capture failed.');
  });

  it('continues handling a wake-owned external answer and audio URL', async () => {
    jest
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValue('6f9619ff-8b86-d011-b42d-00cf4fc964ff');
    installCaptureMocks();
    const play = jest.fn(async () => undefined);
    const pause = jest.fn();
    class FakeAudio {
      onended: (() => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      play = play;
      pause = pause;
      constructor(_url: string) {}
    }
    Object.defineProperty(window, 'Audio', { configurable: true, value: FakeAudio });

    render(<VoiceAssistantOverlay />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent('prism:voice-assistant', {
          detail: { owner: 'wake', phase: 'listening' },
        })
      );
    });
    await screen.findByRole('button', { name: 'Stop and send voice question' });
    act(() => {
      window.dispatchEvent(
        new CustomEvent('prism:voice-assistant', {
          detail: {
            owner: 'wake',
            answer: 'Today is Sunday.',
            audioUrl: 'blob:voice-answer',
          },
        })
      );
    });

    expect(cancelTurn).toHaveBeenCalledWith('external_answer');
    expect(play).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toContain('Today is Sunday.');
  });

  it('cancels the matching active session before showing an external error', async () => {
    jest
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValue('6f9619ff-8b86-d011-b42d-00cf4fc964ff');
    const { stop } = installCaptureMocks();

    render(<VoiceAssistantOverlay />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask NOX by voice' }));
    await screen.findByRole('button', { name: 'Stop and send voice question' });
    act(() => {
      window.dispatchEvent(
        new CustomEvent('prism:voice-assistant', {
          detail: { owner: 'tap', error: 'Tap capture failed.' },
        })
      );
    });

    expect(cancelTurn).toHaveBeenCalledWith('external_error');
    expect(stop).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toContain('Tap capture failed.');
    expect(screen.getByRole('status').textContent).toContain('Couldn’t finish');
  });
});

describe('PcmPlaybackQueue', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('waits for an in-flight push and scheduled source before finishing', async () => {
    let resolveResume: (() => void) | undefined;
    const resume = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveResume = resolve;
        })
    );
    const source = {
      buffer: null,
      connect: jest.fn(),
      onended: null as (() => void) | null,
      start: jest.fn(),
      stop: jest.fn(),
    };
    class FakeAudioContext {
      state = 'suspended';
      currentTime = 0;
      destination = {};
      resume = resume;
      close = jest.fn(async () => undefined);
      createBuffer() {
        return {
          duration: 0.1,
          getChannelData: () => new Float32Array(2),
        };
      }
      createBufferSource() {
        return source;
      }
    }
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: FakeAudioContext,
    });
    const queue = new PcmPlaybackQueue();
    const finished = jest.fn();

    const pushing = queue.push(new Int16Array([1, 2]).buffer);
    queue.finish(finished);
    expect(finished).not.toHaveBeenCalled();

    resolveResume?.();
    await pushing;
    expect(source.start).toHaveBeenCalledTimes(1);
    expect(finished).not.toHaveBeenCalled();

    source.onended?.();
    expect(finished).toHaveBeenCalledTimes(1);
    queue.close();
  });

  it('finishes after an in-flight undersized chunk is discarded', async () => {
    let resolveResume: (() => void) | undefined;
    class FakeAudioContext {
      state = 'suspended';
      currentTime = 0;
      destination = {};
      resume = jest.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveResume = resolve;
          })
      );
      close = jest.fn(async () => undefined);
    }
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: FakeAudioContext,
    });
    const queue = new PcmPlaybackQueue();
    const finished = jest.fn();

    const pushing = queue.push(new ArrayBuffer(1));
    queue.finish(finished);
    expect(finished).not.toHaveBeenCalled();

    resolveResume?.();
    await pushing;
    expect(finished).toHaveBeenCalledTimes(1);
    queue.close();
  });
});
