/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS VM harness exercises the browser script without transforming it. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { TARGET_RATE, VOICE_URL, VoiceStreamClient, pcm16FromFloat32 } = require("../public/voice-streaming.js");

test("the kiosk wall mints tickets the bridge answers and never uses the retired batch path", () => {
  // kyst-wall-proxy's bridge drops a ticket request without a requestId, so the
  // wall on kyst-board had no socket and every tap fell to batch /ask, whose
  // worker is disabled: "NOX is thinking..." and no answer (NOX-11812).
  const wall = fs.readFileSync(path.join(__dirname, "../public/wall.html"), "utf8");
  assert.match(wall, /type:"kyst-voice-stream-ticket", requestId: pendingStreamTicketId/);
  assert.match(wall, /if \(!message\.requestId \|\| message\.requestId !== pendingStreamTicketId\) return;/);
  assert.match(wall, /function reportStreamUnavailable\(requestId, reason\) \{/);
  assert.match(wall, /setVoiceState\("ready", "NOX's voice connection dropped\. Tap to try again\."\)/);
  assert.doesNotMatch(wall, /submitBatchFallback|type: "kyst-voice-ask"/);
});

class FakeSocket {
  static OPEN = 1;
  static CLOSING = 2;
  constructor(url) { this.url = url; this.readyState = 0; this.listeners = {}; this.sent = []; }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  emit(type, data) { for (const listener of this.listeners[type] || []) listener(data); }
  open() { this.readyState = FakeSocket.OPEN; this.emit("open", {}); }
  message(data) { this.emit("message", { data }); }
  send(data) { this.sent.push(data); }
  close() { this.readyState = 3; }
}

function harness() {
  const events = [], fallbacks = [], played = [], stopped = [];
  let timerId = 0;
  const timers = new Map();
  const client = new VoiceStreamClient({
    WebSocketClass: FakeSocket,
    onEvent: (event) => events.push(event),
    onFallback: (event) => fallbacks.push(event),
    playAudio: (...args) => { played.push(args); return true; },
    stopAudio: () => stopped.push(true),
    setTimer: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimer: (id) => timers.delete(id),
    now: () => 1234,
  });
  return { client, events, fallbacks, played, stopped, timers };
}

function connectReady(client) {
  client.connect({ url: VOICE_URL, token: "secret" });
  client.socket.open();
  assert.deepEqual(JSON.parse(client.socket.sent[0]), { type: "auth", token: "secret" });
  client.socket.message(JSON.stringify({ type: "ready" }));
}

test("auth is the first frame and capture uses contract-v1 controls", () => {
  const { client } = harness();
  connectReady(client);
  assert.equal(client.begin({ requestId: "one" }), true);
  client.sendPcm(new ArrayBuffer(1280));
  assert.equal(client.end(), true);
  const sent = client.socket.sent;
  assert.deepEqual(JSON.parse(sent[1]), { type: "start", requestId: "one", format: "pcm16", rate: 16000, channels: 1 });
  assert.equal(sent[2].byteLength, 1280);
  assert.deepEqual(JSON.parse(sent[3]), { type: "end_of_speech", requestId: "one" });
});

test("barge-in sends cancel before the next start and stops playback", () => {
  const { client, stopped } = harness();
  connectReady(client);
  client.begin({ requestId: "old" });
  client.begin({ requestId: "new" });
  const controls = client.socket.sent.filter((item) => typeof item === "string").map(JSON.parse);
  assert.deepEqual(controls.slice(-2).map((item) => item.type), ["cancel", "start"]);
  assert.ok(stopped.length >= 1);
});

test("progressive text and binary audio are delivered without waiting for complete", () => {
  const { client, events, played } = harness();
  connectReady(client);
  client.begin({ requestId: "one" });
  client.socket.message(JSON.stringify({ type: "answer.delta", requestId: "one", text: "Hello" }));
  client.socket.message(JSON.stringify({ type: "audio.start", requestId: "one", format: "mp3" }));
  client.socket.message(new ArrayBuffer(32));
  assert.equal(events.some((event) => event.type === "answer.delta" && event.text === "Hello"), true);
  assert.equal(events.some((event) => event.type === "audio.first_chunk"), true);
  assert.equal(played.length, 1);
  assert.equal(played[0][1], "mp3");
});

test("first audio is recorded only after asynchronous playback starts", async () => {
  const { client, events, fallbacks } = harness();
  connectReady(client);
  let rejectPlayback;
  client.playAudio = () => new Promise((resolve, reject) => { rejectPlayback = reject; });
  client.begin({ requestId: "one" });
  client.end();
  client.socket.message(JSON.stringify({ type: "audio.start", requestId: "one", format: "mp3" }));
  client.socket.message(new ArrayBuffer(32));
  assert.equal(events.some((event) => event.type === "audio.first_chunk"), false);
  rejectPlayback(new Error("autoplay blocked"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(fallbacks, [{ requestId: "one", reason: "audio_playback_failed" }]);
});

test("replaced sockets and stale turn frames cannot affect the active turn", () => {
  const { client, played, fallbacks } = harness();
  connectReady(client);
  const oldSocket = client.socket;
  client.connect({ url: VOICE_URL, token: "replacement" });
  const newSocket = client.socket;
  newSocket.open();
  newSocket.message(JSON.stringify({ type: "ready" }));
  client.begin({ requestId: "new" });
  oldSocket.emit("close", {});
  newSocket.message(JSON.stringify({ type: "audio.start", requestId: "old", format: "mp3" }));
  newSocket.message(new ArrayBuffer(16));
  assert.equal(client.ready, true);
  assert.equal(client.activeRequest.requestId, "new");
  assert.equal(played.length, 0);
  assert.equal(fallbacks.length, 0);
});

test("healthy duplicate configuration does not reconnect or cancel", () => {
  const { client } = harness();
  connectReady(client);
  const socket = client.socket;
  client.begin({ requestId: "one" });
  assert.equal(client.connect({ url: VOICE_URL, token: "secret" }), false);
  assert.equal(client.socket, socket);
  assert.equal(client.activeRequest.requestId, "one");
});

test("ready and first-audio deadlines trigger fallback", () => {
  const first = harness();
  first.client.connect({ url: VOICE_URL, token: "secret" });
  first.client.socket.open();
  const readyTimer = [...first.timers.values()].find((timer) => timer.delay === 3000);
  assert.ok(readyTimer);
  readyTimer.fn();
  assert.equal(first.client.socket, null);
  // A spent single-use ticket is never retried.
  assert.equal(first.timers.size, 0);

  const second = harness();
  connectReady(second.client);
  second.client.begin({ requestId: "one" });
  second.client.end();
  const audioTimer = [...second.timers.values()].find((timer) => timer.delay === 15000);
  assert.ok(audioTimer);
  audioTimer.fn();
  assert.deepEqual(second.fallbacks, [{ requestId: "one", reason: "first_audio_timeout" }]);
});

test("audio progress resets an idle watchdog until complete", () => {
  const { client, events, timers } = harness();
  connectReady(client);
  client.begin({ requestId: "one" });
  client.end();
  client.socket.message(JSON.stringify({ type: "audio.start", requestId: "one", format: "mp3" }));
  client.socket.message(new ArrayBuffer(32));
  const firstIdleTimer = [...timers.entries()].find(([, timer]) => timer.delay === 6000);
  assert.ok(firstIdleTimer);
  client.socket.message(new ArrayBuffer(32));
  assert.equal(timers.has(firstIdleTimer[0]), false);
  const latestIdleTimer = [...timers.entries()].find(([, timer]) => timer.delay === 6000);
  assert.ok(latestIdleTimer);
  latestIdleTimer[1].fn();
  assert.equal(events.some((event) => event.type === "error" && event.reason === "audio_idle_timeout"), true);

  const completed = harness();
  connectReady(completed.client);
  completed.client.begin({ requestId: "two" });
  completed.client.socket.message(JSON.stringify({ type: "audio.start", requestId: "two", format: "mp3" }));
  completed.client.socket.message(new ArrayBuffer(32));
  completed.client.socket.message(JSON.stringify({ type: "complete", requestId: "two" }));
  assert.equal([...completed.timers.values()].some((timer) => timer.delay === 6000), false);
});

test("complete without audio falls back while complete waits for pending playback", async () => {
  const empty = harness();
  connectReady(empty.client);
  empty.client.begin({ requestId: "empty" });
  empty.client.end();
  empty.client.socket.message(JSON.stringify({ type: "complete", requestId: "empty" }));
  assert.deepEqual(empty.fallbacks, [{ requestId: "empty", reason: "complete_without_audio" }]);

  const pending = harness();
  let startPlayback;
  pending.client.playAudio = () => new Promise((resolve) => { startPlayback = resolve; });
  connectReady(pending.client);
  pending.client.begin({ requestId: "pending" });
  pending.client.end();
  pending.client.socket.message(JSON.stringify({ type: "audio.start", requestId: "pending", format: "pcm16" }));
  pending.client.socket.message(new ArrayBuffer(32));
  pending.client.socket.message(JSON.stringify({ type: "complete", requestId: "pending" }));
  assert.equal(pending.client.activeRequest.requestId, "pending");
  startPlayback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pending.events.some((event) => event.type === "audio.first_chunk"), true);
  assert.equal(pending.fallbacks.length, 0);
});

test("socket closure never retries its spent single-use ticket", () => {
  // The server logged three accepted-then-refused sockets after every idle
  // close: the client was replaying a ticket the server had already burned.
  const { client, events, timers } = harness();
  connectReady(client);
  const closed = client.socket;
  closed.emit("close", {});
  assert.equal(client.socket, null);
  assert.equal(client.ready, false);
  assert.equal(timers.size, 0);
  assert.equal(events.some((event) => event.type === "stream.closed"), true);
  // The next turn brings a fresh ticket and connects normally.
  client.connect({ url: VOICE_URL, token: "fresh" });
  assert.notEqual(client.socket, closed);
  client.socket.open();
  assert.deepEqual(JSON.parse(client.socket.sent[0]), { type: "auth", token: "fresh" });
  client.socket.message(JSON.stringify({ type: "ready" }));
  assert.equal(client.ready, true);
});

test("socket close after complete preserves local playback", () => {
  const { client, fallbacks, stopped, timers } = harness();
  connectReady(client);
  client.begin({ requestId: "complete-close" });
  client.socket.message(JSON.stringify({ type: "audio.start", requestId: "complete-close", format: "mp3" }));
  client.socket.message(new ArrayBuffer(32));
  client.socket.message(JSON.stringify({ type: "complete", requestId: "complete-close" }));

  const stoppedBeforeClose = stopped.length;
  const closed = client.socket;
  closed.emit("close", {});

  assert.equal(client.activeRequest.requestId, "complete-close");
  assert.equal(stopped.length, stoppedBeforeClose);
  assert.equal(fallbacks.length, 0);
  assert.equal([...timers.values()].some((timer) => timer.delay === 500), false);
  assert.equal(client.socket, null);
  assert.equal(client.activeRequest.requestId, "complete-close");
  assert.equal(stopped.length, stoppedBeforeClose);
  assert.equal(fallbacks.length, 0);
});

test("socket error after complete preserves local playback", () => {
  const { client, events, fallbacks, stopped } = harness();
  connectReady(client);
  client.begin({ requestId: "complete-error" });
  client.socket.message(JSON.stringify({ type: "audio.start", requestId: "complete-error", format: "pcm16" }));
  client.socket.message(new ArrayBuffer(32));
  client.socket.message(JSON.stringify({ type: "complete", requestId: "complete-error" }));

  const stoppedBeforeError = stopped.length;
  client.socket.emit("error", {});

  assert.equal(client.activeRequest.requestId, "complete-error");
  assert.equal(stopped.length, stoppedBeforeError);
  assert.equal(fallbacks.length, 0);
  assert.equal(events.some((event) => event.type === "stream.unavailable" && event.reason === "socket_error"), true);
});

test("float capture is downsampled to mono PCM16 at 16 kHz", () => {
  const input = new Float32Array(48000).fill(.5);
  const output = new Int16Array(pcm16FromFloat32(input, 48000));
  assert.equal(TARGET_RATE, 16000);
  assert.equal(output.length, 16000);
  assert.ok(output.every((sample) => sample > 16000 && sample < 16400));
});

test("resampler carries partial input across capture callbacks without clock drift", () => {
  const state = {};
  let outputSamples = 0;
  for (let index = 0; index < 24; index += 1) {
    outputSamples += new Int16Array(pcm16FromFloat32(new Float32Array(2048).fill(.25), 48000, state)).length;
  }
  assert.equal(outputSamples, Math.floor((24 * 2048) / 3));
  assert.equal(state.tail.length, (24 * 2048) % 3);
});

test("resampler preserves fractional phase at 44.1 kHz", () => {
  const state = {};
  let outputSamples = 0;
  for (let index = 0; index < 24; index += 1) {
    outputSamples += new Int16Array(pcm16FromFloat32(new Float32Array(2048).fill(.25), 44100, state)).length;
  }
  assert.equal(outputSamples, Math.floor((24 * 2048) / (44100 / TARGET_RATE)));
  assert.ok(state.position >= 0 && state.position < 1);
});

test("stale failure controls cannot cancel the active turn", () => {
  const { client, fallbacks } = harness();
  connectReady(client);
  client.begin({ requestId: "old" });
  client.begin({ requestId: "new" });
  client.socket.message(JSON.stringify({ type: "fallback", requestId: "old", reason: "stale" }));
  client.socket.message(JSON.stringify({ type: "error", requestId: "old", reason: "stale" }));
  assert.equal(client.activeRequest.requestId, "new");
  assert.equal(fallbacks.length, 0);
});

test("synchronous playback setup failure falls back before first-audio success", () => {
  const result = harness();
  result.client.playAudio = () => { throw new Error("unsupported"); };
  connectReady(result.client);
  result.client.begin({ requestId: "one" });
  result.client.socket.message(JSON.stringify({ type: "audio.start", requestId: "one", format: "mp3" }));
  result.client.socket.message(new ArrayBuffer(32));
  assert.deepEqual(result.fallbacks, [{ requestId: "one", reason: "audio_playback_failed" }]);
  assert.equal(result.events.some((event) => event.type === "audio.first_chunk"), false);
});

test("rejects mixed-content and missing-token configurations", () => {
  const { client } = harness();
  assert.throws(() => client.connect({ url: "ws://tailnet.test/voice", token: "secret" }), /endpoint/);
  assert.throws(() => client.connect({ url: VOICE_URL }), /incomplete/);
});

test("default timers survive being called as instance methods", () => {
  // Regression for the bug that kept the wall from ever opening a websocket.
  // Browsers require a Window receiver for setTimeout/clearTimeout, so storing
  // them bare on the instance made every this.setTimer(...) / this.clearTimer(...)
  // throw "Illegal invocation" -- and connect() clears a timer before it builds
  // the socket, so no turn ever reached the server. Every other test in this file
  // injects fake timers, which is precisely why the default path shipped broken.
  const globalSetTimeout = globalThis.setTimeout;
  const globalClearTimeout = globalThis.clearTimeout;
  // Stand in for the browser's receiver check: reject any non-global `this`.
  globalThis.setTimeout = function (fn, ms) {
    if (this !== globalThis) throw new TypeError("Illegal invocation");
    return globalSetTimeout.call(globalThis, fn, ms);
  };
  globalThis.clearTimeout = function (id) {
    if (this !== globalThis) throw new TypeError("Illegal invocation");
    return globalClearTimeout.call(globalThis, id);
  };
  try {
    const client = new VoiceStreamClient({ WebSocketClass: FakeSocket });
    assert.doesNotThrow(() => client.clearTimer(null));
    const handle = client.setTimer(() => {}, 0);
    client.clearTimer(handle);
    // The real symptom: connect() must reach the socket construction.
    client.connect({ url: VOICE_URL, token: "header.payload.sig.nonce.exp" });
    assert.ok(client.socket instanceof FakeSocket, "connect must construct the socket");
    assert.equal(client.socket.url, VOICE_URL);
  } finally {
    globalThis.setTimeout = globalSetTimeout;
    globalThis.clearTimeout = globalClearTimeout;
  }
});

test("transcript revisions replace while answer tokens accumulate", () => {
  // transcript.delta restates the whole utterance each time; answer.delta is a
  // token stream. Sharing one append rule made the "You said" bubble repeat the
  // question once per revision on the real board.
  const wall = fs.readFileSync(path.join(__dirname, "../public/wall.html"), "utf8");
  assert.doesNotMatch(wall, /appendChatDelta/);
  assert.match(wall, /function applyChatDelta\(requestId, field, text\)/);
  assert.match(
    wall,
    /const next = field === "answer" \? `\$\{turn\[field\] \|\| ""\}\$\{text\}` : text;/
  );
  assert.match(wall, /if \(message\.type === "transcript\.delta"\) applyChatDelta\(/);
});

test("a turn the server ends stops mic streaming and releases the recorder", () => {
  // 2026-09-24 08:45: Silero ended turn 2, the board kept streaming its open
  // mic into the finished turn, and the next tap only stopped that recording.
  const { client, events } = harness();
  connectReady(client);
  client.begin({ requestId: "one" });
  client.sendPcm(new ArrayBuffer(640));
  const sentBefore = client.socket.sent.length;
  client.socket.message(JSON.stringify({ type: "answer.delta", requestId: "one", text: "Yes" }));
  const ended = events.filter((event) => event.type === "turn.ended");
  assert.deepEqual(ended, [{ type: "turn.ended", requestId: "one", via: "answer.delta" }]);
  client.sendPcm(new ArrayBuffer(640));
  // The recorder's own stop then calls end(): the turn is over, so that is
  // success, and no second end_of_speech goes out.
  assert.equal(client.end(), true);
  assert.equal(client.socket.sent.length, sentBefore);
  client.socket.message(JSON.stringify({ type: "answer.delta", requestId: "one", text: " I hear you." }));
  assert.equal(events.filter((event) => event.type === "turn.ended").length, 1);
  // Transcript revisions while the user is still talking do not end the turn.
  client.begin({ requestId: "two" });
  client.socket.message(JSON.stringify({ type: "transcript.delta", requestId: "two", text: "What" }));
  assert.equal(events.filter((event) => event.type === "turn.ended").length, 1);
  assert.equal(client.activeRequest.ended, false);
});

test("a first answer slower than six seconds is still played", () => {
  // Phase B measured 7,215 ms and 6,032 ms end-to-first-audio on its two
  // longest answers; a 6 s first-audio deadline dropped both requests and the
  // board then scheduled none of their frames.
  const { client, fallbacks, played, timers } = harness();
  connectReady(client);
  client.begin({ requestId: "slow" });
  client.end();
  assert.equal([...timers.values()].some((timer) => timer.delay === 6000), false);
  assert.ok([...timers.values()].find((timer) => timer.delay === 15000));
  // The final transcript lands before the brain answers: still the long window.
  client.socket.message(JSON.stringify({ type: "transcript.delta", requestId: "slow", text: "What", final: true }));
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].delay, 15000);
  client.socket.message(JSON.stringify({ type: "answer.delta", requestId: "slow", text: "It is" }));
  // Progress re-arms the shorter stall watchdog in place of the first-answer one.
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].delay, 6000);
  client.socket.message(JSON.stringify({ type: "audio.start", requestId: "slow", format: "pcm16" }));
  client.socket.message(new ArrayBuffer(32));
  assert.equal(played.length, 1);
  assert.equal(fallbacks.length, 0);
});

test("the wall opens the voice socket on tap, not on board load", () => {
  const wall = fs.readFileSync(path.join(__dirname, "../public/wall.html"), "utf8");
  const bridgeReady = wall.match(/if \(message\.type === "kyst-voice-bridge-ready"\) \{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(bridgeReady, "bridge-ready handler not found");
  // Only a tap already waiting on a ticket may re-request one after a reload.
  assert.match(bridgeReady, /if \(streamConnect\) requestStreamConfig\(\);/);
  assert.doesNotMatch(bridgeReady.replace("if (streamConnect) requestStreamConfig();", ""), /requestStreamConfig|connectStream/);
  const begin = wall.match(/async function beginRecording\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(begin, /connectStream\(\)\.then\(/);
  assert.match(wall, /if \(message\.type === "turn\.ended" && recorder\?\.state === "recording"\) stopRecording\(\);/);
  assert.match(wall, /setInterval\(\(\) => \{ boardFrame\.src = proxyRoot; \}, 10 \* 60 \* 1000\);/);
});

test("a dropped or stalled stream releases the mic and its socket", () => {
  // Behaviour is driven on kyst-board by lifecycle-check.cjs (NOX-11812 PR #22
  // round 1); these pin the two statements that behaviour rests on.
  const wall = fs.readFileSync(path.join(__dirname, "../public/wall.html"), "utf8");
  const report = wall.match(/function reportStreamUnavailable\(requestId, reason\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.ok(report, "reportStreamUnavailable not found");
  assert.match(report, /recorder = null;\n    cleanupRecording\(\);\n    if \(staleRecorder\.state === "recording"\) staleRecorder\.stop\(\);/);
  const connect = wall.match(/function connectStream\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(connect, /streamClient\.disconnect\("connect_timeout", \{ preserveCompletedPlayback: true \}\);\n    finishStreamConnect\(false, "connect_timeout"\);/);
});
