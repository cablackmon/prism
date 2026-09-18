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
let emit: ((event: Record<string, unknown>) => void) | undefined;

jest.mock('@/lib/voice/KystVoiceStreamClient', () => ({
  KystVoiceStreamClient: jest.fn().mockImplementation(({ onEvent }) => {
    emit = onEvent;
    return {
      connect,
      startTurn,
      endTurn,
      cancelTurn,
      disconnect,
      playbackStarted,
      sendAudio: jest.fn(),
    };
  }),
  pcm16FromFloat32: jest.fn(() => new ArrayBuffer(2)),
}));

import { VoiceAssistantOverlay } from '../VoiceAssistantOverlay';

function installCaptureMocks() {
  const stop = jest.fn();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: jest.fn(async () => ({ getTracks: () => [{ stop }] })) },
  });

  class FakeAudioContext {
    state = 'running';
    sampleRate = 48_000;
    currentTime = 0;
    destination = {};
    resume = jest.fn(async () => undefined);
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
  return stop;
}

describe('VoiceAssistantOverlay accessibility and turn controls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    emit = undefined;
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
    const stop = installCaptureMocks();

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
    const stop = installCaptureMocks();

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
});
