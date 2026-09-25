/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS VM harness exercises the browser scripts without transforming them. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const Avatar = require("../public/avatar/avatar.js");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../public/avatar/assets/nox_hologram_v1.manifest.json"), "utf8"));
const wall = fs.readFileSync(path.join(__dirname, "../public/wall.html"), "utf8");

test("the avatar is on by default, ?avatarMode=off turns it off, and a phone or a GPU that cannot draw it gets the still", () => {
  let probes = 0;
  const probe = () => { probes += 1; return true; };
  assert.equal(Avatar.DEFAULT_MODE, "holo");
  assert.equal(Avatar.resolveAvatarMode({ search: "", viewportWidth: 3840, holoGpu: probe }), "holo");
  assert.equal(Avatar.resolveAvatarMode({ search: "?avatarMode=nonsense", viewportWidth: 3840, holoGpu: probe }), "holo");
  assert.equal(Avatar.resolveAvatarMode({ search: "", viewportWidth: 390, holoGpu: probe }), "still");
  assert.equal(Avatar.resolveAvatarMode({ search: "", viewportWidth: 3840, holoGpu: () => false }), "still");
  probes = 0;
  assert.equal(Avatar.resolveAvatarMode({ search: "?avatarMode=off", viewportWidth: 3840, holoGpu: probe }), "off");
  assert.equal(Avatar.resolveAvatarMode({ search: "", defaultMode: "off", holoGpu: probe }), "off");
  assert.equal(probes, 0, "a flag-off wall must not create a WebGL probe context");
  assert.equal(Avatar.resolveAvatarMode({ search: "?avatarMode=holo", viewportWidth: 3840, holoGpu: probe }), "holo");
  assert.equal(Avatar.resolveAvatarMode({ search: "?avatarMode=holo", viewportWidth: 390, holoGpu: probe }), "still");
  assert.equal(Avatar.resolveAvatarMode({ search: "?avatarMode=holo", viewportWidth: 3840, holoGpu: () => false }), "still");
  assert.equal(Avatar.resolveAvatarMode({ search: "?avatarMode=still", viewportWidth: 3840, holoGpu: probe }), "still");
  assert.equal(Avatar.resolveAvatarMode({ search: "?avatarMode=off", defaultMode: "holo", holoGpu: probe }), "off");
});

test("all five wall voice states bind to an avatar state, and Done is not one of them", () => {
  assert.deepEqual(
    ["ready", "listening", "thinking", "speaking", "unavailable"].map(Avatar.avatarStateFor),
    ["idle", "listening", "thinking", "speaking", "unavailable"],
  );
  assert.equal(Avatar.avatarStateFor("done"), "idle");
  // every state the wall can set is one setVoiceState actually uses
  for (const state of new Set([...wall.matchAll(/setVoiceState\("(\w+)"/g)].map((m) => m[1]))) {
    assert.ok(state in Avatar.AVATAR_STATE_FOR_VOICE, `wall state ${state} has no avatar state`);
  }
});

test("the smile guard lets only the manifest's driven morphs move, within their caps", () => {
  const guard = Avatar.createMorphGuard(manifest);
  assert.deepEqual([...guard.driven].sort(), ["Blink", "Jaw", "Press"]);
  const smileKeys = [
    ...Object.keys(manifest.smile_rule.clamp06_global_caps),
    ...Object.keys(manifest.smile_rule.clamp06_window_caps),
  ];
  assert.ok(smileKeys.includes("NX19_Smile_Joy"));
  for (const key of smileKeys) assert.equal(guard.value(key, 1), 0, `${key} must never move`);
  for (const morph of manifest.morphs.filter((m) => !m.runtime_driven)) assert.equal(guard.value(morph.name, 1), 0);
  // NOX-11813: the Jaw viseme is overdriven to the manifest's 1.5, and no further
  assert.equal(guard.cap("Jaw"), 1.5);
  assert.equal(guard.value("Jaw", 1.8), 1.5);
  assert.equal(guard.cap("Press"), 1);
  assert.equal(guard.cap("NX19_Smile_Joy"), 0);
  assert.equal(guard.value("Jaw", -0.4), 0);
  assert.equal(guard.value("Jaw", Number.NaN), 0);
  assert.equal(guard.value("Press", 0.25), 0.25);
});

test("a manifest that drives a joy key is refused, not rendered", () => {
  const bad = structuredClone(manifest);
  bad.morphs.find((m) => m.name === "NX19_Smile_Joy").runtime_driven = true;
  assert.throws(() => Avatar.createMorphGuard(bad), /smile_rule: NX19_Smile_Joy/);
  const capped = structuredClone(manifest);
  capped.morphs.find((m) => m.name === "Jaw").cap = 0.4;
  assert.equal(Avatar.createMorphGuard(capped).value("Jaw", 1), 0.4);
  capped.morphs.find((m) => m.name === "Jaw").cap = 7;
  assert.equal(Avatar.createMorphGuard(capped).value("Jaw", 9), Avatar.MAX_DRIVEN_CAP);
});

function sampleMotion(state, seconds = 60, jaw = 0) {
  const motion = Avatar.createMotion(manifest.motion);
  const samples = [];
  for (let t = 0; t <= seconds; t += 1 / 30) samples.push(motion.step(state, t, 1 / 30, jaw));
  return samples.slice(60);
}

test("the head and neck move in every state while the chest stays inside the sway cap", () => {
  const cap = manifest.motion.body_sway_max_deg;
  for (const state of ["idle", "listening", "thinking", "speaking", "unavailable"]) {
    const samples = sampleMotion(state, 60, state === "speaking" ? 0.6 : 0);
    const headYaw = samples.map((s) => s.bones.head[0]);
    assert.ok(Math.max(...headYaw) - Math.min(...headYaw) > 2, `${state}: head yaw barely moves`);
    const neckYaw = samples.map((s) => s.bones.neck2[0]);
    assert.ok(Math.max(...neckYaw) - Math.min(...neckYaw) > 1, `${state}: neck does not move`);
    for (const s of samples) {
      const chestYaw = ["spine1", "spine2", "spine3", "spine4"].reduce((sum, b) => sum + Math.abs(s.bones[b][0]), 0);
      assert.ok(chestYaw <= cap + 1e-9, `${state}: spine sway ${chestYaw} over the ${cap} deg cap`);
    }
  }
});

test("hours into a kiosk day, easing in and out of listening still moves the head smoothly", () => {
  const motion = Avatar.createMotion(manifest.motion);
  const start = 10 * 3600;
  let last = motion.step("idle", start, 1 / 60, 0).yaw;
  let worst = 0;
  for (let i = 1; i < 60 * 8; i += 1) {
    const state = i < 60 * 4 ? "listening" : "idle";
    const yaw = motion.step(state, start + i / 60, 1 / 60, 0).yaw;
    worst = Math.max(worst, Math.abs(yaw - last));
    last = yaw;
  }
  assert.ok(worst < 0.2, `head yaw jumped ${worst.toFixed(2)} deg in one frame`);
});

test("listening leans in, thinking looks away, and both ease in rather than snap", () => {
  const mean = (samples, key) => samples.reduce((sum, s) => sum + s[key], 0) / samples.length;
  const idle = sampleMotion("idle");
  assert.ok(mean(sampleMotion("listening"), "pitch") - mean(idle, "pitch") > 1.5);
  assert.ok(mean(sampleMotion("thinking"), "yaw") - mean(idle, "yaw") > 3);
  const motion = Avatar.createMotion(manifest.motion);
  const before = motion.step("idle", 10, 1 / 30, 0);
  const after = motion.step("thinking", 10 + 1 / 30, 1 / 30, 0);
  assert.ok(Math.abs(after.yaw - before.yaw) < 1, "a state change snapped the head");
});

test("speech nods the head only while the jaw is open", () => {
  const quiet = sampleMotion("speaking", 20, 0);
  const talking = sampleMotion("speaking", 20, 1);
  const range = (samples) => Math.max(...samples.map((s) => s.pitch)) - Math.min(...samples.map((s) => s.pitch));
  assert.ok(range(talking) > range(quiet));
});

test("blinks land on the manifest interval, and thinking blinks more often", () => {
  const blinks = (state) => {
    const blink = Avatar.createBlink(manifest.motion, () => 0.5);
    let count = 0;
    let wasOpen = true;
    for (let t = 0; t < 120; t += 1 / 60) {
      const v = blink.step(state, 1 / 60);
      if (v >= 1 && wasOpen) count += 1;
      wasOpen = v < 1;
    }
    return count;
  };
  const [lo, hi] = manifest.motion.blink_interval_s;
  const idle = blinks("idle");
  assert.ok(idle >= Math.floor(118 / hi) && idle <= Math.ceil(120 / lo), `idle blinked ${idle} times in 120 s`);
  assert.ok(blinks("thinking") > idle);
});

// 60 fps frames of the analyser's last 1024 samples (48 kHz): a 180 Hz voice carrier whose level swings between
// `peakDb` and `peakDb - depthDb` at `syllablesPerS`, which is how TTS speech moves at the analyser.
function syllables({ seconds, peakDb = -14, depthDb = 24, syllablesPerS = 4 } = {}) {
  const frames = [];
  for (let f = 0; f < seconds * 60; f += 1) {
    const end = Math.round((f + 1) * 800);
    const wave = new Float32Array(1024);
    for (let i = 0; i < 1024; i += 1) {
      const t = (end - 1024 + i) / 48000;
      const envDb = peakDb - depthDb * (0.5 - 0.5 * Math.cos(2 * Math.PI * syllablesPerS * t));
      wave[i] = Math.SQRT2 * 10 ** (envDb / 20) * Math.sin(2 * Math.PI * 180 * t);
    }
    frames.push(wave);
  }
  return frames;
}

function speak(speech, frames) {
  return frames.map((wave) => speech.step(wave, 1 / 60));
}

test("the mouth opens and shuts on every syllable instead of holding open (NOX-11813)", () => {
  const jawMax = Avatar.createMorphGuard(manifest).cap("Jaw");
  // 2 s from one trough (frame 69, t = 1.15 s) to another, after the first second settles the peak
  const out = speak(Avatar.createSpeech({ jawMax }), syllables({ seconds: 3.5, depthDb: 14 })).slice(69, 189);
  const jaws = out.map((o) => o.jaw);
  assert.ok(Math.max(...jaws) > 0.8 * jawMax, `jaw peaked at ${Math.max(...jaws)}`);
  assert.ok(Math.min(...jaws) < 0.15 * jawMax, `jaw never shut: min ${Math.min(...jaws)}`);
  let opens = 0;
  let up = false;
  for (const jaw of jaws) {
    if (!up && jaw > 0.5 * jawMax) { up = true; opens += 1; } else if (up && jaw < 0.2 * jawMax) up = false;
  }
  assert.equal(opens, 8, "one open per syllable over 2 s at 4 syllables/s");
  // between syllables the lips meet
  assert.ok(Math.max(...out.map((o) => o.press)) > 0.5);
});

// Codex P2s on d393c2d9: a quieter stretch must articulate at once, not after the old peak has leaked away
test("a quieter phrase after a pause opens fully from its first syllable", () => {
  const speech = Avatar.createSpeech({ jawMax: 1.5 });
  speak(speech, syllables({ seconds: 1, peakDb: -6 }));
  speak(speech, Array.from({ length: 12 }, () => new Float32Array(1024)));
  const jaws = speak(speech, syllables({ seconds: 0.5, peakDb: -22, depthDb: 14 })).map((o) => o.jaw);
  assert.ok(Math.max(...jaws.slice(0, 20)) > 1.2, `first syllable peaked at ${Math.max(...jaws.slice(0, 20))}`);
});

test("a quieter stretch without a pause is articulated within half a second", () => {
  const speech = Avatar.createSpeech({ jawMax: 1.5 });
  speak(speech, syllables({ seconds: 1, peakDb: -6 }));
  const jaws = speak(speech, syllables({ seconds: 1, peakDb: -22, depthDb: 14 })).map((o) => o.jaw);
  const late = jaws.slice(30, 60);
  assert.ok(Math.max(...late) > 1.2, `0.5-1 s after the drop the jaw peaked at ${Math.max(...late)}`);
  assert.ok(Math.min(...late) < 0.3, `and never shut: min ${Math.min(...late)}`);
});

test("quiet voiced speech just above the gate still opens the mouth fully", () => {
  for (const peakDb of [-45, -48]) {
    const jaws = speak(Avatar.createSpeech({ jawMax: 1.5 }), syllables({ seconds: 2, peakDb, depthDb: 1 })).slice(60).map((o) => o.jaw);
    assert.ok(Math.min(...jaws) > 1.2, `${peakDb} dBFS held the jaw at ${Math.min(...jaws)}`);
  }
});

test("the mouth moves the same at any playback gain: loud speech no longer pins the jaw", () => {
  const swing = (peakDb) => {
    const jaws = speak(Avatar.createSpeech({ jawMax: 1.5 }), syllables({ seconds: 3, peakDb })).slice(60).map((o) => o.jaw);
    return Math.max(...jaws) - Math.min(...jaws);
  };
  const loud = swing(-3);
  const quiet = swing(-30);
  assert.ok(loud > 1.1, `loud swing ${loud}`);
  assert.ok(Math.abs(loud - quiet) < 0.05, `gain changed the swing: ${loud} vs ${quiet}`);
});

test("after the answer the jaw shuts, the press lets go, and silence never goes NaN", () => {
  const speech = Avatar.createSpeech({ jawMax: 1.5 });
  assert.deepEqual(speech.step(new Float32Array(1024), 1 / 60), { jaw: 0, press: 0, open: 0, levelDb: -Infinity });
  speak(speech, syllables({ seconds: 1 }));
  let out;
  for (let i = 0; i < 60; i += 1) out = speech.step(new Float32Array(1024), 1 / 60);
  assert.ok(out.jaw < 0.01 && out.press < 0.01, `rest pose not restored: ${JSON.stringify(out)}`);
  for (const wave of [null, new Float32Array(0), new Float32Array(3).fill(1)]) {
    const odd = Avatar.createSpeech().step(wave, 1 / 60);
    assert.ok(Number.isFinite(odd.jaw) && Number.isFinite(odd.press), `NaN for ${wave && wave.length}`);
  }
});

test("the renderer feeds the speech model the analyser's waveform and the manifest's Jaw cap", () => {
  // holo-avatar.js needs three.js and a GPU, so its two speech lines are pinned in the source
  const holo = fs.readFileSync(path.join(__dirname, "../public/avatar/holo-avatar.js"), "utf8");
  assert.match(holo, /Core\.createSpeech\(\{ jawMax: guard\.cap\("Jaw"\) \}\)/);
  assert.match(holo, /analyser\.getFloatTimeDomainData\(wave\)/);
  assert.match(holo, /wave = node \? new Float32Array\(node\.fftSize\) : null/);
  assert.doesNotMatch(holo, /getByteFrequencyData/);
});

function runTransition(transition, seconds, dt = 1 / 60) {
  const frames = [];
  for (let t = 0; t < seconds; t += dt) frames.push(transition.step(dt));
  return frames;
}

test("the constellation streams into the figure and dissolves back out on the v2.3 timing", () => {
  const transition = Avatar.createTransition();
  transition.enter();
  const entering = runTransition(transition, Avatar.TRANSITION.enterSeconds + 0.3);
  assert.equal(entering.at(-1).phase, "shown");
  assert.ok(entering[0].reveal === 0 && entering[0].constellation > 0.99, "the figure was visible before the stars");
  assert.ok(Math.max(...entering.map((f) => f.particleOpacity)) > 0.5, "no particle stream");
  const shownAt = entering.findIndex((f) => f.phase === "shown");
  assert.ok(shownAt / 60 >= Avatar.TRANSITION.enterSeconds - 0.05);
  // nothing is drawn over the settled figure: it must be the accepted look alone
  assert.deepEqual([entering.at(-1).reveal, entering.at(-1).particleOpacity, entering.at(-1).constellation], [1, 0, 0]);
  transition.exit();
  const exiting = runTransition(transition, Avatar.TRANSITION.exitSeconds + 0.3);
  assert.equal(exiting.at(-1).phase, "hidden");
  assert.equal(exiting.at(-1).reveal, 0);
  assert.ok(exiting.findIndex((f) => f.phase === "hidden") / 60 >= Avatar.TRANSITION.exitSeconds - 0.05);
});

test("Done during the entrance and Ask NOX during the exit reverse from where the figure is", () => {
  const transition = Avatar.createTransition();
  transition.enter();
  const entering = runTransition(transition, 1.6);
  const before = entering.at(-1).focus;
  assert.ok(before > 0.2 && before < 0.9, `focus ${before} is not mid-entrance`);
  transition.exit();
  const firstOut = transition.step(1 / 60).focus;
  assert.ok(Math.abs(firstOut - before) < 0.05, `exit snapped from ${before} to ${firstOut}`);
  runTransition(transition, 0.4);
  const mid = transition.step(1 / 60).focus;
  transition.enter();
  const firstIn = transition.step(1 / 60).focus;
  assert.ok(Math.abs(firstIn - mid) < 0.05, `re-entry snapped from ${mid} to ${firstIn}`);
  assert.equal(runTransition(transition, Avatar.TRANSITION.enterSeconds + 0.3).at(-1).phase, "shown");
});

test("reduced motion fades without the particle stream", () => {
  const transition = Avatar.createTransition({ reducedMotion: true });
  transition.enter();
  const frames = runTransition(transition, Avatar.TRANSITION.reducedSeconds + 0.1);
  assert.equal(frames.at(-1).phase, "shown");
  assert.equal(Math.max(...frames.map((f) => f.particleOpacity)), 0);
});

class FakeElement {
  constructor() {
    this.hidden = true;
    this.dataset = {};
    this.children = [];
    this.listeners = {};
    const classes = new Set();
    this.classList = { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) };
    this.ownerDocument = { createElement: () => new FakeElement() };
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  click() { for (const fn of this.listeners.click || []) fn(); }
  appendChild(child) { this.children.push(child); }
  querySelector(selector) { return this.children.find((c) => `.${c.className}` === selector) || null; }
}

function fakeTimers() {
  const timers = new Map();
  let id = 0;
  return {
    timers,
    setTimer: (fn, delay) => { timers.set(++id, { fn, delay }); return id; },
    clearTimer: (timerId) => timers.delete(timerId),
    fire(delay) { for (const [key, t] of [...timers]) if (t.delay === delay) { timers.delete(key); t.fn(); } },
  };
}

function fakeRenderer() {
  const calls = [];
  return {
    calls,
    enter: () => calls.push(["enter"]),
    exit: () => { calls.push(["exit"]); return Promise.resolve(); },
    setState: (s) => calls.push(["state", s]),
    setSpeechAnalyser: (n) => calls.push(["analyser", n]),
  };
}

test("flag off, the controller is inert and wants no speech tap", () => {
  const controller = Avatar.createAvatarController({ mode: "off", root: new FakeElement() });
  assert.equal(controller.mode, "off");
  assert.equal(controller.wantsSpeech, false);
  controller.open();
  controller.setVoiceState("speaking");
  controller.close();
});

test("holo: open enters, states and the analyser reach the renderer whichever lands first", async () => {
  const root = new FakeElement();
  const renderer = fakeRenderer();
  const t = fakeTimers();
  let resolveLoad;
  const controller = Avatar.createAvatarController({
    mode: "holo", root, loadRenderer: () => new Promise((resolve) => { resolveLoad = resolve; }), ...t,
  });
  controller.attachSpeechAnalyser("tap");
  controller.setVoiceState("listening");
  controller.open();
  // the GLB is still loading: the load starts a microtask after creation
  await Promise.resolve();
  resolveLoad(renderer);
  await controller.ready;
  assert.deepEqual(renderer.calls, [["state", "listening"], ["analyser", "tap"], ["enter"]]);
  controller.setVoiceState("speaking");
  assert.deepEqual(renderer.calls.at(-1), ["state", "speaking"]);
  controller.close();
  assert.deepEqual(renderer.calls.at(-1), ["exit"]);
  await Promise.resolve();
  assert.equal(root.hidden, true);
});

test("a holo overlay stays hidden, and so cannot swallow taps, until its renderer can draw", async () => {
  const root = new FakeElement();
  const renderer = fakeRenderer();
  let resolveLoad;
  const controller = Avatar.createAvatarController({
    mode: "holo", root, loadRenderer: () => new Promise((resolve) => { resolveLoad = resolve; }), ...fakeTimers(),
  });
  controller.open();
  assert.equal(root.hidden, true, "an empty full-screen overlay was shown over the board");
  controller.close();
  controller.open();
  await Promise.resolve();
  resolveLoad(renderer);
  await controller.ready;
  assert.equal(root.hidden, false);
  assert.deepEqual(renderer.calls.filter((c) => c[0] === "enter"), [["enter"]]);
});

test("a load that fails after Ask NOX was pressed shows the still, not an empty overlay", async () => {
  const root = new FakeElement();
  let rejectLoad;
  const warn = console.warn;
  console.warn = () => {};
  try {
    const controller = Avatar.createAvatarController({
      mode: "holo", root, loadRenderer: () => new Promise((_, reject) => { rejectLoad = reject; }), ...fakeTimers(),
    });
    controller.open();
    await Promise.resolve();
    rejectLoad(new Error("glb_404"));
    await controller.ready;
    assert.equal(controller.mode, "still");
    assert.equal(root.hidden, false);
    assert.equal(root.children[0]?.className, "holo-still");
  } finally {
    console.warn = warn;
  }
});

test("an idle avatar dissolves after a minute, but never mid-answer", async () => {
  const root = new FakeElement();
  const renderer = fakeRenderer();
  const t = fakeTimers();
  const controller = Avatar.createAvatarController({ mode: "holo", root, loadRenderer: () => renderer, ...t });
  await controller.ready;
  controller.open();
  controller.setVoiceState("speaking");
  assert.equal([...t.timers.values()].some((x) => x.delay === Avatar.IDLE_DISMISS_MS), false);
  controller.setVoiceState("ready");
  t.fire(Avatar.IDLE_DISMISS_MS);
  assert.deepEqual(renderer.calls.at(-1), ["exit"]);
});

test("a tap on the hologram is Done: it dissolves the avatar and closes the chat", async () => {
  const root = new FakeElement();
  const renderer = fakeRenderer();
  let dismissed = 0;
  const controller = Avatar.createAvatarController({
    mode: "holo", root, loadRenderer: () => renderer, onDismiss: () => { dismissed += 1; }, ...fakeTimers(),
  });
  await controller.ready;
  controller.open();
  root.click();
  assert.equal(dismissed, 1);
  assert.deepEqual(renderer.calls.at(-1), ["exit"]);
});

test("a renderer that cannot start falls back to the still instead of an empty overlay", async () => {
  const root = new FakeElement();
  const warn = console.warn;
  console.warn = () => {};
  try {
    const controller = Avatar.createAvatarController({
      mode: "holo", root, loadRenderer: () => { throw new Error("webgl2_unavailable"); }, ...fakeTimers(),
    });
    await controller.ready;
    assert.equal(controller.mode, "still");
    controller.open();
    assert.equal(root.children[0].className, "holo-still");
    assert.equal(root.children[0].alt, "");
  } finally {
    console.warn = warn;
  }
});

// The wall's own progressiveAudio, run as written, against a fake Web Audio graph.
function playbackGraph({ wantsSpeech, contextState = "running", resumeTo = "running" }) {
  const block = wall.match(/const progressiveAudio = \(\(\) => \{[\s\S]*?\n\}\)\(\);/)?.[0];
  assert.ok(block, "progressiveAudio not found in wall.html");
  const connections = [];
  const attached = [];
  const events = [];
  const log = [];
  const contexts = [];
  let analysers = 0;
  class Node { constructor(name) { this.name = name; } connect(to) { connections.push([this.name, to.name]); } }
  class FakeContext {
    constructor() { this.state = contextState; this.currentTime = 0; this.destination = new Node("destination"); contexts.push(this); }
    resume() {
      resumes += 1;
      log.push("resume");
      return Promise.resolve().then(() => { this.state = resumeTo; });
    }
    createMediaElementSource(element) { mediaSources.push(element); return new Node("media"); }
    createBuffer(_c, length) { return { duration: length / 16000, getChannelData: () => new Float32Array(length) }; }
    createBufferSource() {
      const source = new Node("source");
      source.listeners = [];
      source.addEventListener = (_type, fn) => source.listeners.push(fn);
      source.start = () => {};
      sources.push(source);
      return source;
    }
    createAnalyser() {
      analysers += 1;
      const node = new Node("analyser");
      node.context = this;
      return node;
    }
  }
  const sources = [];
  const mediaSources = [];
  let resumes = 0;
  const mediaSourcesOpened = [];
  class FakeMediaSource {
    static isTypeSupported() { return true; }
    constructor() { this.listeners = {}; this.readyState = "open"; mediaSourcesOpened.push(this); }
    addEventListener(type, fn) { this.listeners[type] = fn; }
    addSourceBuffer() { return { updating: false, addEventListener() {}, appendBuffer() {} }; }
    endOfStream() {}
    open() { return this.listeners.sourceopen(); }
  }
  const voiceAudio = { pause() {}, play: () => { log.push(`play:${contexts[0]?.state}`); return Promise.resolve(); }, addEventListener() {} };
  const context = vm.createContext({
    window: { AudioContext: FakeContext, MediaSource: FakeMediaSource },
    MediaSource: FakeMediaSource,
    avatar: { wantsSpeech, attachSpeechAnalyser: (node) => attached.push(node) },
    voiceAudio,
    streamClient: { onEvent: (event) => events.push(event), failPlayback() {} },
    URL: { revokeObjectURL() {}, createObjectURL: () => "blob:mp3" },
    console,
    Int16Array, Float32Array, Promise, Set, Error,
  });
  vm.runInContext(`${block}\nthis.progressiveAudio = progressiveAudio;`, context);
  return {
    audio: context.progressiveAudio, connections, attached, events, sources, voiceAudio, mediaSources,
    analysers: () => analysers, resumes: () => resumes, log, contexts,
    openLatest: () => mediaSourcesOpened.at(-1).open(),
  };
}

test("flag off, answer audio still goes straight to the speakers", async () => {
  const g = playbackGraph({ wantsSpeech: false });
  await g.audio.push(new ArrayBuffer(640), "pcm16", "turn-1");
  assert.deepEqual(g.connections, [["source", "destination"]]);
  assert.equal(g.analysers(), 0);
  assert.equal(g.attached.length, 0);
});

test("holo, answer audio passes one analyser on its way to the speakers across all three turns", async () => {
  const g = playbackGraph({ wantsSpeech: true });
  for (const turn of ["turn-1", "turn-2", "turn-3"]) {
    await g.audio.push(new ArrayBuffer(640), "pcm16", turn);
    await g.audio.push(new ArrayBuffer(640), "pcm16", turn);
    g.audio.finish(turn);
    for (const source of g.sources.splice(0)) source.listeners.forEach((fn) => fn());
  }
  assert.equal(g.analysers(), 1);
  assert.equal(g.attached.length, 1);
  assert.deepEqual(g.connections[0], ["analyser", "destination"]);
  assert.deepEqual(g.connections.slice(1), Array(6).fill(["source", "analyser"]));
  // the tap changes nothing about when a turn ends: every turn still reports playback ended
  assert.deepEqual(g.events.map((e) => [e.type, e.requestId]), [
    ["audio.playback_ended", "turn-1"], ["audio.playback_ended", "turn-2"], ["audio.playback_ended", "turn-3"],
  ]);
});

test("holo, an MP3 answer feeds the same analyser, and only through a running context", () => {
  const running = playbackGraph({ wantsSpeech: true });
  running.audio.push(new ArrayBuffer(64), "mp3", "turn-mp3");
  assert.equal(running.voiceAudio.src, "blob:mp3", "mp3 playback did not start");
  assert.deepEqual(running.mediaSources, [running.voiceAudio]);
  assert.deepEqual(running.connections, [["analyser", "destination"], ["media", "analyser"]]);
  running.audio.push(new ArrayBuffer(64), "mp3", "turn-mp3-2");
  assert.equal(running.mediaSources.length, 1, "the element can only ever be tapped once");
  // a suspended context would silence the element for good: no tap, playback untouched, resume asked for
  const suspended = playbackGraph({ wantsSpeech: true, contextState: "suspended" });
  suspended.audio.push(new ArrayBuffer(64), "mp3", "turn-mp3");
  assert.equal(suspended.voiceAudio.src, "blob:mp3");
  assert.deepEqual(suspended.mediaSources, []);
  assert.equal(suspended.resumes(), 1);
  const off = playbackGraph({ wantsSpeech: false });
  off.audio.push(new ArrayBuffer(64), "mp3", "turn-mp3");
  assert.deepEqual([off.mediaSources, off.connections], [[], []]);
});

test("holo, a tapped context suspended between two MP3 answers is resumed before the second plays", async () => {
  const g = playbackGraph({ wantsSpeech: true });
  const first = g.audio.push(new ArrayBuffer(64), "mp3", "turn-1");
  await g.openLatest();
  await first;
  assert.deepEqual([g.mediaSources.length, g.log], [1, ["play:running"]]);
  // the kiosk's power management suspends the context the element is now bound to
  g.contexts[0].state = "suspended";
  const second = g.audio.push(new ArrayBuffer(64), "mp3", "turn-2");
  await g.openLatest();
  await second;
  assert.deepEqual(g.log, ["play:running", "resume", "play:running"], "the second answer played into a suspended context");
  // a new answer that lands while the resume is pending cancels the one waiting on it
  g.contexts[0].state = "suspended";
  const third = g.audio.push(new ArrayBuffer(64), "mp3", "turn-3");
  const opening = g.openLatest();
  g.audio.push(new ArrayBuffer(64), "mp3", "turn-4");
  await opening;
  await assert.rejects(third, /mp3_turn_cancelled/);
  assert.deepEqual(g.log.slice(3), ["resume"], "a cancelled answer still played after its resume");
});

test("holo, a tapped context that will not resume fails the MP3 turn instead of playing it silently", async () => {
  const g = playbackGraph({ wantsSpeech: true, resumeTo: "suspended" });
  const first = g.audio.push(new ArrayBuffer(64), "mp3", "turn-1");
  await g.openLatest();
  await first;
  g.contexts[0].state = "suspended";
  const second = g.audio.push(new ArrayBuffer(64), "mp3", "turn-2");
  await g.openLatest();
  await assert.rejects(second, /mp3_tap_context_suspended/);
  assert.deepEqual(g.log, ["play:running", "resume"]);
  // flag off the element is never tapped, so its context's state is irrelevant to playback
  const off = playbackGraph({ wantsSpeech: false, contextState: "suspended", resumeTo: "suspended" });
  const answer = off.audio.push(new ArrayBuffer(64), "mp3", "turn-1");
  await off.openLatest();
  await answer;
  assert.deepEqual([off.resumes(), off.log], [0, ["play:undefined"]]);
});

// A WebGL2 context double: which colour-buffer extensions exist, and what a
// half-float framebuffer reports when checked.
function fakeGl({ extensions = [], status = "complete" } = {}) {
  const calls = [];
  const gl = {
    TEXTURE_2D: "T2D", RGBA16F: "RGBA16F", RGBA: "RGBA", HALF_FLOAT: "HALF_FLOAT", FRAMEBUFFER: "FB",
    COLOR_ATTACHMENT0: "C0", FRAMEBUFFER_COMPLETE: "complete",
    getExtension(name) {
      calls.push(`ext:${name}`);
      if (name === "WEBGL_lose_context") return { loseContext: () => calls.push("lost") };
      return extensions.includes(name) ? {} : null;
    },
    createTexture: () => ({}), bindTexture() {}, createFramebuffer: () => ({}), bindFramebuffer() {}, framebufferTexture2D() {},
    texImage2D(...args) { calls.push(`tex:${args[2]}:${args[7]}`); },
    checkFramebufferStatus: () => status,
  };
  return { gl, calls };
}

test("WebGL2 without renderable half-float targets gets the still, not a hologram that fails at draw time", () => {
  assert.equal(Avatar.canRenderHolo(null), false);
  const bare = fakeGl();
  assert.equal(Avatar.canRenderHolo(bare.gl), false, "WebGL2 alone passed the probe");
  assert.equal(bare.calls.at(-1), "lost", "the probe context was not released");
  for (const extension of ["EXT_color_buffer_float", "EXT_color_buffer_half_float"]) {
    const capable = fakeGl({ extensions: [extension] });
    assert.equal(Avatar.canRenderHolo(capable.gl), true, extension);
    assert.ok(capable.calls.includes("tex:RGBA16F:HALF_FLOAT"), "the probe did not try a half-float target");
    assert.equal(capable.calls.at(-1), "lost");
  }
  const lying = fakeGl({ extensions: ["EXT_color_buffer_float"], status: "incomplete" });
  assert.equal(Avatar.canRenderHolo(lying.gl), false, "an incomplete half-float framebuffer passed the probe");
  // and resolveAvatarMode turns that answer into the still on a kiosk-sized screen
  const probe = () => Avatar.canRenderHolo(fakeGl().gl);
  assert.equal(Avatar.resolveAvatarMode({ search: "", viewportWidth: 3840, holoGpu: probe }), "still");
  assert.match(wall, /holoGpu: \(\) => \{ try \{ return KystAvatar\.canRenderHolo\(document\.createElement\("canvas"\)\.getContext\("webgl2"\)\); \}/);
});

test("the wall wires the avatar to the voice states, the mic, Done and the shared three.js import map", () => {
  assert.match(wall, /<script type="importmap">\s*\{"imports":\{"three":"\/avatar\/vendor\/three\/three\.module\.min\.js"/);
  assert.ok(wall.indexOf('<script src="/avatar/avatar.js"></script>') > wall.indexOf('<script src="/voice-streaming.js"></script>'));
  assert.match(wall, /<div id="holo-avatar" aria-hidden="true" hidden><\/div>/);
  const setVoiceState = wall.match(/function setVoiceState\(state, label\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(setVoiceState, /avatar\.setVoiceState\(state\);\n\}$/);
  const micClick = wall.match(/mic\.addEventListener\("click", \(\) => \{[\s\S]*?\n\}\);/)?.[0] || "";
  assert.match(micClick, /setChatOpen\(true\);\n  avatar\.open\(\);/);
  assert.match(wall, /\n  onDismiss: \(\) => setChatOpen\(false\),\n/, "a tap on the hologram must close the chat too");
  assert.match(wall, /chatClose\.addEventListener\("click", \(\) => \{\n  notifyBoardActivity\(\);\n  setChatOpen\(false\);\n  avatar\.close\(\);/);
  assert.match(wall, /source\.connect\(speechOutput\(nextContext\)\);/);
  assert.doesNotMatch(wall, /source\.connect\(nextContext\.destination\)/);
});

test("a token that arrives after the first audio does not relabel the answer as thinking", () => {
  // Live run 2026-09-25: every answer.delta after audio.first_chunk set "thinking", so the wall read "Preparing
  // NOX's voice…" and the avatar held its thinking pose for the whole spoken answer (133 of 134 samples in turn 1).
  const delta = wall.match(/if \(message\.type === "answer\.delta"\) \{[\s\S]*?\n    \}/)?.[0] || "";
  assert.match(delta, /if \(!mic\.classList\.contains\("speaking"\)\) setVoiceState\("thinking", "Preparing NOX's voice…"\);/);
  assert.equal((delta.match(/setVoiceState/g) || []).length, 1);
});

test("the board frame has an accessible name", () => {
  assert.match(wall.match(/<iframe[^>]+>/)?.[0] || "", /title="KYST family board"/);
});

test("the bridge's whole-answer audio and its tap-to-play retry resume a tapped context before playing", async () => {
  // kyst-board's wall still plays the bridge's kyst-voice-answer through voiceAudio. Once a streamed
  // answer has tapped that element, it only sounds while the context runs.
  const g = playbackGraph({ wantsSpeech: true });
  await g.audio.elementRunning();
  assert.equal(g.resumes(), 0, "an untapped element resumed a context");
  const first = g.audio.push(new ArrayBuffer(64), "mp3", "turn-1");
  await g.openLatest();
  await first;
  g.contexts[0].state = "suspended";
  await g.audio.elementRunning();
  assert.deepEqual(g.log, ["play:running", "resume"]);
  const stuck = playbackGraph({ wantsSpeech: true, resumeTo: "suspended" });
  const answer = stuck.audio.push(new ArrayBuffer(64), "mp3", "turn-1");
  await stuck.openLatest();
  await answer;
  stuck.contexts[0].state = "suspended";
  await assert.rejects(stuck.audio.elementRunning(), /mp3_tap_context_suspended/);
  const bridgeAnswer = wall.match(/if \(message\.type === "kyst-voice-answer"[\s\S]*?\n  \}\n\}\);/)?.[0] || "";
  assert.match(bridgeAnswer, /try \{\n      await progressiveAudio\.elementRunning\(\);\n      if \(activeRequestId !== requestId\) return;\n      await voiceAudio\.play\(\);/);
  assert.equal((bridgeAnswer.match(/voiceAudio\.play\(\)/g) || []).length, 1);
  const micClick = wall.match(/mic\.addEventListener\("click", \(\) => \{[\s\S]*?\n\}\);/)?.[0] || "";
  assert.match(micClick, /progressiveAudio\.elementRunning\(\)\.then\(\(\) => voiceAudio\.play\(\)\)\.catch\(/);
  assert.equal((micClick.match(/voiceAudio\.play\(\)/g) || []).length, 1);
});

// next.config.js as Next loads it, with its two build plugins stubbed: next-pwa's options are captured, both wrappers
// pass the config through.
function loadNextConfig() {
  const Module = require("node:module");
  const load = Module._load;
  let pwaOptions = null;
  Module._load = function stubbed(request, ...rest) {
    if (request === "next-pwa") return (options) => { pwaOptions = options; return (config) => config; };
    if (request === "@next/bundle-analyzer") return () => (config) => config;
    return load.call(this, request, ...rest);
  };
  const file = path.join(__dirname, "../next.config.js");
  try { delete require.cache[file]; return { config: require(file), pwaOptions }; } finally { Module._load = load; }
}

test("the hologram stays out of the service worker precache", () => {
  // next-pwa precaches every public/ file, past workbox's size cap, into every client that installs the worker.
  const { pwaOptions } = loadNextConfig();
  assert.deepEqual(pwaOptions.publicExcludes, ["!noprecache/**/*", "!avatar/**/*"]);
});

test("only the wall's CSP lets GLTFLoader fetch the blob: textures it creates", async () => {
  // Live run under kyst-board's CSP: all seven embedded textures were refused (connect-src had no blob:).
  const headers = await loadNextConfig().config.headers();
  const csp = (source) => headers.find((rule) => rule.source === source).headers
    .find((header) => header.key === "Content-Security-Policy").value;
  const directive = (policy, name) => policy.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name} `));
  assert.equal(directive(csp("/wall.html"), "connect-src"), "connect-src 'self' blob: https: wss:");
  assert.equal(directive(csp("/wall.html"), "frame-src"), "frame-src 'self' https://kyst-wall-proxy.fly.dev");
  assert.equal(directive(csp("/((?!wall\\.html$).*)"), "connect-src"), "connect-src 'self' https: wss:");
});
