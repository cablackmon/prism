(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.KystVoiceStreaming = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  const TARGET_RATE = 16000;
  const VOICE_URL = "wss://cb-threadripper.tail3a8e2d.ts.net:8445/voice";
  const RESPONSE_TIMEOUT_MS = 6000;

  function pcm16FromFloat32(input, inputRate, state = {}) {
    const ratio = inputRate / TARGET_RATE;
    const tail = state.tail || new Float32Array(0);
    const samples = new Float32Array(tail.length + input.length);
    samples.set(tail);
    samples.set(input, tail.length);
    const position = state.position || 0;
    const length = Math.floor((samples.length - position) / ratio);
    const output = new Int16Array(length);
    for (let index = 0; index < length; index += 1) {
      const start = Math.floor(position + index * ratio);
      const end = Math.max(start + 1, Math.floor(position + (index + 1) * ratio));
      let sum = 0;
      for (let cursor = start; cursor < end && cursor < samples.length; cursor += 1) sum += samples[cursor];
      const sample = Math.max(-1, Math.min(1, sum / (end - start)));
      output[index] = sample < 0 ? sample * 32768 : sample * 32767;
    }
    const nextPosition = position + length * ratio;
    const consumed = Math.floor(nextPosition);
    state.tail = samples.slice(consumed);
    state.position = nextPosition - consumed;
    return output.buffer;
  }

  class VoiceStreamClient {
    constructor(options = {}) {
      this.WebSocketClass = options.WebSocketClass || globalThis.WebSocket;
      this.setTimer = options.setTimer || globalThis.setTimeout;
      this.clearTimer = options.clearTimer || globalThis.clearTimeout;
      this.now = options.now || (() => Date.now());
      this.onEvent = options.onEvent || (() => {});
      this.onFallback = options.onFallback || (() => {});
      this.playAudio = options.playAudio || (() => {});
      this.stopAudio = options.stopAudio || (() => {});
      this.socket = null;
      this.authenticated = false;
      this.activeRequest = null;
      this.audioFormat = null;
      this.audioRequestId = null;
      this.readyTimer = null;
      this.audioTimer = null;
      this.reconnectTimer = null;
      this.reconnectAttempts = 0;
    }

    get ready() {
      return Boolean(this.authenticated && this.socket?.readyState === this.WebSocketClass.OPEN);
    }

    connect({ url, token }, { preserveCompletedPlayback = false } = {}) {
      if (!url || !token) throw new Error("Streaming configuration is incomplete");
      if (url !== VOICE_URL) throw new Error("Unexpected streaming endpoint");
      if (this.ready && this.url === url && this.token === token) return false;
      this.clearTimer(this.reconnectTimer);
      this.disconnect("reconfigure", { preserveCompletedPlayback });
      this.url = url;
      this.token = token;
      const socket = new this.WebSocketClass(url);
      socket.binaryType = "arraybuffer";
      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ type: "auth", token }));
        this.readyTimer = this.setTimer(() => {
          if (this.socket !== socket) return;
          this.failConnection("ready_timeout");
          this.socket = null;
          if (socket.readyState < this.WebSocketClass.CLOSING) socket.close(4000, "ready_timeout");
          this.scheduleReconnect();
        }, 3000);
      });
      socket.addEventListener("message", (event) => {
        if (this.socket === socket) this.handleMessage(event.data);
      });
      socket.addEventListener("error", () => {
        if (this.socket === socket) this.failConnection("socket_error");
      });
      socket.addEventListener("close", () => {
        if (this.socket !== socket) return;
        this.socket = null;
        this.authenticated = false;
        if (!this.activeRequest?.complete) this.failActive("socket_closed");
        this.onEvent({ type: "stream.closed" });
        this.scheduleReconnect();
      });
      this.socket = socket;
    }

    scheduleReconnect() {
      this.clearTimer(this.reconnectTimer);
      if (!this.url || !this.token || this.reconnectAttempts >= 3) return;
      const delay = 500 * (2 ** this.reconnectAttempts++);
      this.reconnectTimer = this.setTimer(() => {
        this.reconnectTimer = null;
        this.connect(
          { url: this.url, token: this.token },
          { preserveCompletedPlayback: Boolean(this.activeRequest?.complete) },
        );
      }, delay);
    }

    disconnect(reason = "disconnect", { preserveCompletedPlayback = false } = {}) {
      if (!(preserveCompletedPlayback && this.activeRequest?.complete)) this.cancel(reason);
      this.clearTimer(this.readyTimer);
      this.clearTimer(this.reconnectTimer);
      const socket = this.socket;
      this.socket = null;
      this.authenticated = false;
      if (socket && socket.readyState < this.WebSocketClass.CLOSING) socket.close(1000, reason);
    }

    begin({ requestId }) {
      if (!this.ready) return false;
      if (this.activeRequest) this.cancel("barge_in");
      this.activeRequest = { requestId, firstAudio: false, ended: false, complete: false, pendingAudio: 0 };
      this.audioFormat = null;
      this.audioRequestId = null;
      this.sendControl({ type: "start", requestId, format: "pcm16", rate: TARGET_RATE, channels: 1 });
      return true;
    }

    sendPcm(buffer) {
      if (!this.activeRequest?.ended && this.ready && buffer?.byteLength) this.socket.send(buffer);
    }

    end() {
      const request = this.activeRequest;
      if (!request || request.ended || !this.ready) return false;
      request.ended = true;
      this.sendControl({ type: "end_of_speech", requestId: request.requestId });
      this.audioTimer = this.setTimer(() => this.failActive("first_audio_timeout"), RESPONSE_TIMEOUT_MS);
      return true;
    }

    cancel() {
      if (this.activeRequest && this.ready) this.sendControl({ type: "cancel", requestId: this.activeRequest.requestId });
      this.clearTimer(this.audioTimer);
      this.activeRequest = null;
      this.audioFormat = null;
      this.audioRequestId = null;
      this.stopAudio();
    }

    sendControl(message) {
      if (!this.socket || this.socket.readyState !== this.WebSocketClass.OPEN) return false;
      this.socket.send(JSON.stringify(message));
      return true;
    }

    handleMessage(data) {
      if (typeof data === "string") {
        let message;
        try { message = JSON.parse(data); } catch { return; }
        return this.handleControl(message);
      }
      if (!(data instanceof ArrayBuffer) || !this.activeRequest || !this.audioFormat ||
          this.audioRequestId !== this.activeRequest.requestId) return;
      const request = this.activeRequest;
      let playback;
      try {
        playback = this.playAudio(data, this.audioFormat, request.requestId);
      } catch {
        this.failPlayback(request.requestId);
        return;
      }
      const markStarted = () => this.markAudioProgress(request.requestId);
      if (playback && typeof playback.then === "function") {
        request.pendingAudio += 1;
        playback.then(() => {
          request.pendingAudio -= 1;
          markStarted();
        }).catch(() => {
          request.pendingAudio -= 1;
          this.failPlayback(request.requestId);
        });
      } else {
        markStarted();
      }
    }

    handleControl(message) {
      if (message.type === "ready") {
        this.clearTimer(this.readyTimer);
        this.authenticated = true;
        this.reconnectAttempts = 0;
        this.onEvent(message);
      } else if (message.type === "audio.start" && this.matchesActive(message)) {
        this.audioFormat = message.format;
        this.audioRequestId = message.requestId;
        this.onEvent(message);
      } else if (message.type === "transcript.delta" || message.type === "answer.delta" || message.type === "complete") {
        if (this.matchesActive(message)) {
          if (message.type === "complete") {
            this.activeRequest.complete = true;
            if (!this.activeRequest.firstAudio && this.activeRequest.pendingAudio === 0) {
              this.failActive("complete_without_audio");
              return;
            }
            if (this.activeRequest.firstAudio) this.clearTimer(this.audioTimer);
          }
          this.onEvent(message);
        }
      } else if ((message.type === "fallback" || message.type === "error") && this.matchesActive(message)) {
        this.failActive(message.reason || message.type);
      }
    }

    matchesActive(message) {
      return Boolean(this.activeRequest && message.requestId === this.activeRequest.requestId);
    }

    markAudioProgress(requestId) {
      const request = this.activeRequest;
      if (!request || request.requestId !== requestId) return;
      this.clearTimer(this.audioTimer);
      if (!request.complete) {
        this.audioTimer = this.setTimer(() => this.failActive("audio_idle_timeout"), RESPONSE_TIMEOUT_MS);
      }
      if (!request.firstAudio) {
        request.firstAudio = true;
        this.onEvent({ type: "audio.first_chunk", requestId, receivedAt: this.now() });
      }
    }

    failPlayback(requestId, reason = "audio_playback_failed") {
      if (this.activeRequest?.requestId === requestId) this.failActive(reason);
    }

    failConnection(reason) {
      this.clearTimer(this.readyTimer);
      this.authenticated = false;
      if (!this.activeRequest?.complete) this.failActive(reason);
      this.onEvent({ type: "stream.unavailable", reason });
    }

    failActive(reason) {
      const request = this.activeRequest;
      if (!request) return;
      this.clearTimer(this.audioTimer);
      this.activeRequest = null;
      this.audioFormat = null;
      this.audioRequestId = null;
      this.stopAudio();
      if (!request.firstAudio) this.onFallback({ requestId: request.requestId, reason });
      else this.onEvent({ type: "error", requestId: request.requestId, reason });
    }
  }

  return { TARGET_RATE, VOICE_URL, VoiceStreamClient, pcm16FromFloat32 };
});
