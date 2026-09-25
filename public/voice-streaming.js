(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.KystVoiceStreaming = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  const TARGET_RATE = 16000;
  const VOICE_URL = "wss://cb-threadripper.tail3a8e2d.ts.net:8445/voice";
  // Once the server shows progress on a turn, 6 s of silence from it is a
  // stall. The first sign of an answer is allowed longer: end of speech to
  // first audio measured 3.6-7.2 s on the Phase B brain, and a 6 s first-audio
  // deadline abandoned exactly the two slowest turns -- their audio then
  // arrived for a request the client had already dropped, which is the
  // "frames delivered, none scheduled" silent wall (NOX-11812).
  const RESPONSE_TIMEOUT_MS = 6000;
  const FIRST_RESPONSE_TIMEOUT_MS = 15000;

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
      // setTimeout/clearTimeout are Window methods: stored bare on an instance and
      // called as this.setTimer(...), the browser sees a VoiceStreamClient receiver
      // and throws "Illegal invocation". connect() clears a timer before it opens
      // the socket, so every connect threw and the wall never opened a websocket at
      // all. Bind them to the global so the receiver stays correct.
      this.setTimer = options.setTimer || globalThis.setTimeout.bind(globalThis);
      this.clearTimer = options.clearTimer || globalThis.clearTimeout.bind(globalThis);
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
    }

    get ready() {
      return Boolean(this.authenticated && this.socket?.readyState === this.WebSocketClass.OPEN);
    }

    connect({ url, token }, { preserveCompletedPlayback = false } = {}) {
      if (!url || !token) throw new Error("Streaming configuration is incomplete");
      if (url !== VOICE_URL) throw new Error("Unexpected streaming endpoint");
      if (this.ready && this.url === url && this.token === token) return false;
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
        // No automatic reconnect. Stream tickets are single-use, so retrying
        // with the spent one is refused every time: the server logged three
        // accepted-then-rejected sockets after every idle close. The caller
        // mints a fresh ticket the next time a turn needs the stream.
        this.token = null;
        this.onEvent({ type: "stream.closed" });
      });
      this.socket = socket;
    }

    disconnect(reason = "disconnect", { preserveCompletedPlayback = false } = {}) {
      if (!(preserveCompletedPlayback && this.activeRequest?.complete)) this.cancel(reason);
      this.clearTimer(this.readyTimer);
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
      if (!request) return false;
      // The server already closed this turn (its VAD heard the pause first);
      // the turn is ended, so a late tap is not a failure.
      if (request.ended) return true;
      if (!this.ready) return false;
      request.ended = true;
      this.sendControl({ type: "end_of_speech", requestId: request.requestId });
      this.armWatchdog("first_audio_timeout", FIRST_RESPONSE_TIMEOUT_MS);
      return true;
    }

    armWatchdog(reason, delay) {
      this.clearTimer(this.audioTimer);
      this.audioTimer = this.setTimer(() => this.failActive(reason), delay);
    }

    // Any answer traffic means the server has closed the user's turn, whether
    // or not a tap did it: stop streaming mic audio into a finished turn and
    // tell the caller so it can release the microphone.
    noteServerProgress(message) {
      const request = this.activeRequest;
      if (!request || request.complete) return;
      if (!request.ended && message.type !== "transcript.delta") {
        request.ended = true;
        this.onEvent({ type: "turn.ended", requestId: request.requestId, via: message.type });
      }
      if (request.ended && !request.firstAudio) {
        // Transcript and end-of-speech acks come before the brain has said
        // anything, so they keep the first-answer window; only answer traffic
        // moves the turn onto the shorter stall deadline.
        const answering = message.type === "answer.delta" || message.type === "audio.start";
        this.armWatchdog("first_audio_timeout", answering ? RESPONSE_TIMEOUT_MS : FIRST_RESPONSE_TIMEOUT_MS);
      }
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
        this.onEvent(message);
      } else if (message.type === "audio.start" && this.matchesActive(message)) {
        this.noteServerProgress(message);
        this.audioFormat = message.format;
        this.audioRequestId = message.requestId;
        this.onEvent(message);
      } else if (message.type === "speech.end" && this.matchesActive(message)) {
        this.noteServerProgress(message);
      } else if (message.type === "transcript.delta" || message.type === "answer.delta" || message.type === "complete") {
        if (this.matchesActive(message)) {
          if (message.type !== "complete") this.noteServerProgress(message);
          else if (!this.activeRequest.ended) {
            this.activeRequest.ended = true;
            this.onEvent({ type: "turn.ended", requestId: message.requestId, via: "complete" });
          }
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
