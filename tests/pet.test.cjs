/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS VM harness exercises the browser scripts without transforming them. */
// NOX as a resident pet on the KYST wall (Cameron 2026-10-18, NOX 1: "make it a nox pet instead of opening
// the face page"). The pet is the default; the full-screen overlay from PR #31 stays one flag away.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const Avatar = require("../public/avatar/avatar.js");
const wall = fs.readFileSync(path.join(__dirname, "../public/wall.html"), "utf8");

class FakeElement {
  constructor() {
    this.hidden = true;
    this.dataset = {};
    this.children = [];
    this.listeners = {};
    this.textContent = "";
    this.scrollTop = 0;
    this.scrollHeight = 0;
    const classes = new Set();
    this.classList = {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
    };
    this.ownerDocument = { createElement: () => new FakeElement() };
    this.attributes = {};
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  click() { for (const fn of this.listeners.click || []) fn(); }
  appendChild(child) { this.children.push(child); }
  querySelector(selector) { return this.children.find((c) => `.${c.className}` === selector) || null; }
  setAttribute(name, value) { this.attributes[name] = value; }
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

function pet({ loadRenderer, onTap } = {}) {
  const els = { root: new FakeElement(), bubble: new FakeElement(), bubbleText: new FakeElement(), hitbox: new FakeElement() };
  const renderer = fakeRenderer();
  const t = fakeTimers();
  const controller = Avatar.createPetController({ ...els, loadRenderer: loadRenderer || (() => renderer), onTap, ...t });
  return { controller, renderer, t, ...els };
}

test("pet is the default presentation for the clip avatar; the overlay flag and the URL bring back the overlay", () => {
  assert.equal(Avatar.DEFAULT_PRESENTATION, "pet");
  assert.equal(Avatar.resolveAvatarPresentation({ mode: "nox" }), "pet");
  assert.equal(Avatar.resolveAvatarPresentation({ mode: "nox", flag: "pet" }), "pet");
  assert.equal(Avatar.resolveAvatarPresentation({ mode: "nox", flag: "nonsense" }), "pet");
  assert.equal(Avatar.resolveAvatarPresentation({ mode: "nox", flag: "overlay" }), "overlay");
  assert.equal(Avatar.resolveAvatarPresentation({ mode: "nox", flag: "pet", search: "?avatarPresentation=overlay" }), "overlay");
  assert.equal(Avatar.resolveAvatarPresentation({ mode: "nox", flag: "overlay", search: "?avatarPresentation=pet" }), "pet");
  // only the clip avatar has a pet body: holo, still (phones) and off keep the overlay exactly as before
  for (const mode of ["holo", "still", "off"]) {
    assert.equal(Avatar.resolveAvatarPresentation({ mode, flag: "pet" }), "overlay", mode);
  }
});

test("the wall defaults to pet in one line and keeps the overlay controller behind it", () => {
  assert.match(wall, /\n  window\.KYST_AVATAR_MODE = "pet";\n/);
  assert.equal((wall.match(/window\.KYST_AVATAR_MODE = "\w+";/g) || []).length, 1, "the flag is set in more than one place");
  assert.match(wall, /const avatarPresentation = KystAvatar\.resolveAvatarPresentation\(\{\n  mode: avatarMode, flag: window\.KYST_AVATAR_MODE, search: window\.location\.search,\n\}\);/);
  assert.match(wall, /const avatar = avatarPresentation === "pet" \? KystAvatar\.createPetController\(\{[\s\S]*?\}\) : KystAvatar\.createAvatarController\(\{/);
  // nothing PR #31 shipped is gone
  assert.match(wall, /<div id="holo-avatar" aria-hidden="true" hidden><\/div>/);
  assert.match(wall, /import\("\/avatar\/holo-avatar\.js"\)/);
  assert.match(wall, /\n  onDismiss: \(\) => setChatOpen\(false\),\n/);
  // the pet's tap is the mic's own handler, not a fork of it
  assert.match(wall, /\n  onTap: \(\) => mic\.click\(\),\n/);
  assert.equal((wall.match(/mic\.addEventListener\("click"/g) || []).length, 1);
  assert.match(wall, /<div id="nox-pet" hidden><button id="nox-pet-hit" type="button" aria-label="Ask NOX"/);
  assert.match(wall, /--nox-pet-height:34vh;/);
});

test("the wall reveals her on the start tap, feeds her the turn text and the status label", () => {
  const start = wall.match(/document\.getElementById\("start"\)\.addEventListener\("click", async \(\) => \{[\s\S]*?\n\}\);/)?.[0] || "";
  assert.match(start, /avatar\.reveal\(\);\n\}\);$/);
  const update = wall.match(/function updateChatTurn\(requestId, transcript, answer\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(update, /if \(requestId === activeRequestId\) avatar\.showTurn\(turn\.transcript, turn\.answer\);\n\}$/);
  const setVoiceState = wall.match(/function setVoiceState\(state, label\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(setVoiceState, /avatar\.setVoiceState\(state, label\);/);
});

// The wall's mic handler and setChatOpen, run as written, with the real pet controller behind them.
function wallTap({ presentation }) {
  const micClick = wall.match(/mic\.addEventListener\("click", \(\) => \{[\s\S]*?\n\}\);/)?.[0];
  const setChatOpen = wall.match(/function setChatOpen\(open\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(micClick && setChatOpen);
  const mic = new FakeElement();
  const chatPanel = new FakeElement();
  const holoRoot = new FakeElement();
  const log = [];
  const els = { root: new FakeElement(), bubble: new FakeElement(), bubbleText: new FakeElement(), hitbox: new FakeElement() };
  const renderer = fakeRenderer();
  const overlayRenderer = fakeRenderer();
  const avatar = presentation === "pet"
    ? Avatar.createPetController({ ...els, loadRenderer: () => renderer, onTap: () => mic.click(), ...fakeTimers() })
    : Avatar.createAvatarController({ mode: "nox", root: holoRoot, loadRenderer: () => overlayRenderer, ...fakeTimers() });
  const context = vm.createContext({
    mic, chatPanel, avatar,
    notifyBoardActivity: () => log.push("activity"),
    beginRecording: () => { log.push("beginRecording"); avatar.setVoiceState("listening", "Listening… tap to stop"); },
    stopRecording: () => log.push("stopRecording"),
    cancelActiveVoice: () => log.push("cancel"),
    recorder: null, pendingPlaybackRequestId: null, activeRequestId: null,
    progressiveAudio: {}, voiceAudio: {},
  });
  vm.runInContext(`${setChatOpen}\n${micClick}`, context);
  return { avatar, els, mic, chatPanel, holoRoot, log, renderer, overlayRenderer };
}

test("pet: a tap on her starts listening inline and never opens the full-screen overlay or the chat panel", async () => {
  const w = wallTap({ presentation: "pet" });
  await w.avatar.ready;
  w.avatar.reveal();
  w.els.hitbox.click();
  assert.deepEqual(w.log, ["activity", "beginRecording"]);
  assert.equal(w.holoRoot.hidden, true, "the full-screen overlay opened");
  assert.equal(w.holoRoot.classList.contains("open"), false);
  assert.equal(w.chatPanel.classList.contains("open"), false, "the chat panel opened over her");
  assert.equal(w.els.root.dataset.state, "listening");
  assert.equal(w.els.bubble.hidden, false);
  assert.equal(w.els.bubble.dataset.kind, "status");
  assert.equal(w.els.bubbleText.textContent, "Listening…");
  assert.deepEqual(w.renderer.calls.filter((c) => c[0] === "state").at(-1), ["state", "listening"]);
  // the "Tap to ask NOX" mic does the same
  w.mic.click();
  assert.deepEqual(w.log.slice(2), ["activity", "beginRecording"]);
  assert.equal(w.holoRoot.hidden, true);
});

test("overlay flag: the same tap still opens the full-screen avatar and the chat panel, as PR #31 shipped", async () => {
  const w = wallTap({ presentation: "overlay" });
  await w.avatar.ready;
  w.mic.click();
  assert.equal(w.holoRoot.hidden, false);
  assert.equal(w.holoRoot.classList.contains("open"), true);
  assert.equal(w.chatPanel.classList.contains("open"), true);
  assert.deepEqual(w.overlayRenderer.calls.filter((c) => c[0] === "enter"), [["enter"]]);
  assert.equal(w.avatar.presentation, "overlay");
});

test("pet: she waits for the start tap, then appears and waves once", async () => {
  const p = pet();
  await p.controller.ready;
  assert.equal(p.root.hidden, true, "she showed behind the start card");
  assert.deepEqual(p.renderer.calls, [["state", "idle"]]);
  p.controller.reveal();
  p.controller.reveal();
  assert.equal(p.root.hidden, false);
  assert.equal(p.root.classList.contains("open"), true);
  // the renderer's enter() plays the wave from idle, then hands back to the idle loop
  assert.deepEqual(p.renderer.calls.filter((c) => c[0] === "enter"), [["enter"]]);
  // open() and close() from the mic and the chat close button never move her
  p.controller.open();
  p.controller.close();
  assert.equal(p.root.hidden, false);
  assert.equal(p.controller.presentation, "pet");
  assert.equal(p.controller.wantsSpeech, false);
});

test("pet: a start tap before the clips load still reveals her once they do", async () => {
  let resolveLoad;
  const renderer = fakeRenderer();
  const p = pet({ loadRenderer: () => new Promise((resolve) => { resolveLoad = resolve; }) });
  p.controller.reveal();
  assert.equal(p.root.hidden, true);
  await Promise.resolve();
  resolveLoad(renderer);
  await p.controller.ready;
  assert.equal(p.root.hidden, false);
  assert.deepEqual(renderer.calls, [["state", "idle"], ["enter"]]);
});

test("pet: listening, thinking, the heard question and the streamed answer show in her bubble, then it fades", async () => {
  const p = pet();
  await p.controller.ready;
  p.controller.reveal();
  p.controller.setVoiceState("ready", "Tap to ask NOX");
  assert.equal(p.bubble.hidden, true);
  p.controller.setVoiceState("listening", "Listening… tap to stop");
  assert.deepEqual([p.bubble.dataset.kind, p.bubbleText.textContent], ["status", "Listening…"]);
  p.controller.showTurn("what's for dinner", "");
  assert.deepEqual([p.bubble.dataset.kind, p.bubbleText.textContent], ["you", "what's for dinner"]);
  p.controller.setVoiceState("thinking", "NOX is thinking…");
  assert.equal(p.root.dataset.state, "thinking");
  assert.deepEqual([p.bubble.dataset.kind, p.bubbleText.textContent], ["you", "what's for dinner"]);
  p.controller.showTurn("what's for dinner", "Tacos");
  assert.deepEqual([p.bubble.dataset.kind, p.bubbleText.textContent], ["nox", "Tacos"]);
  p.controller.setVoiceState("speaking", "NOX is speaking…");
  p.bubbleText.scrollHeight = 900;
  p.controller.showTurn("what's for dinner", "Tacos at six, then baths.");
  assert.equal(p.bubbleText.textContent, "Tacos at six, then baths.");
  assert.equal(p.bubbleText.scrollTop, 900, "a long answer does not keep its newest words in view");
  assert.deepEqual(p.renderer.calls.filter((c) => c[0] === "state").map((c) => c[1]),
    ["idle", "idle", "listening", "thinking", "speaking"]);
  assert.equal([...p.t.timers.values()].length, 0, "the bubble was set to fade mid-turn");
  p.controller.setVoiceState("ready", "Tap to ask NOX");
  assert.equal(p.bubbleText.textContent, "Tacos at six, then baths.", "the answer vanished the moment she stopped talking");
  p.t.fire(Avatar.PET_BUBBLE_LINGER_MS);
  assert.equal(p.bubble.hidden, true);
  assert.equal(p.bubble.classList.contains("open"), false);
});

test("pet: a new question clears the last answer, and a wall error shows instead of a stale answer", async () => {
  const p = pet();
  await p.controller.ready;
  p.controller.reveal();
  p.controller.setVoiceState("listening", "Listening… tap to stop");
  p.controller.showTurn("hi", "Hello!");
  p.controller.setVoiceState("ready", "Tap to ask NOX");
  p.controller.setVoiceState("listening", "Listening… tap to stop");
  assert.deepEqual([p.bubble.dataset.kind, p.bubbleText.textContent], ["status", "Listening…"]);
  p.controller.setVoiceState("ready", "I didn't hear anything. Tap to try again.");
  assert.deepEqual([p.bubble.dataset.kind, p.bubbleText.textContent], ["status", "I didn't hear anything. Tap to try again."]);
  p.controller.setVoiceState("unavailable", "Mic unavailable. Check browser permission.");
  assert.equal(p.bubbleText.textContent, "Mic unavailable. Check browser permission.");
  assert.equal(p.root.dataset.state, "unavailable");
  p.t.fire(Avatar.PET_BUBBLE_LINGER_MS);
  assert.equal(p.bubble.hidden, true);
});

test("pet: no bubble before the board has started", async () => {
  const p = pet();
  await p.controller.ready;
  p.controller.setVoiceState("unavailable", "Board is still loading. Try again.");
  assert.equal(p.bubble.hidden, true);
});

test("pet: clips that cannot load hide her and hand the wall back its chat panel, and her box takes no taps", async () => {
  const warn = console.warn;
  console.warn = () => {};
  let taps = 0;
  try {
    const p = pet({ loadRenderer: () => { throw new Error("nox_clip_error"); }, onTap: () => { taps += 1; } });
    p.controller.reveal();
    await p.controller.ready;
    assert.equal(p.root.hidden, true);
    assert.equal(p.controller.presentation, "off");
    assert.equal(p.controller.mode, "off");
    p.hitbox.click();
    assert.equal(taps, 0);
    p.controller.setVoiceState("listening", "Listening… tap to stop");
    assert.equal(p.bubble.hidden, true);
    // the wall follows her presentation, so the status pill beside the mic comes back
    assert.match(wall, /\navatar\.ready\?\.then\(\(\) => \{ document\.body\.dataset\.avatarPresentation = avatar\.presentation; \}\);\n/);
  } finally {
    console.warn = warn;
  }
});

test("pet: a tap on her bubble puts it away and cancels its fade", async () => {
  const p = pet();
  await p.controller.ready;
  p.controller.reveal();
  p.controller.setVoiceState("listening", "Listening… tap to stop");
  p.controller.showTurn("hi", "Hello! A long answer that covers the corner of the board.");
  p.controller.setVoiceState("ready", "Tap to ask NOX");
  assert.equal(p.bubble.hidden, false);
  assert.equal(p.t.timers.size, 1);
  p.bubble.click();
  assert.equal(p.bubble.hidden, true);
  assert.equal(p.bubble.classList.contains("open"), false);
  assert.equal(p.t.timers.size, 0, "the fade timer outlived the bubble");
});

test("the overlay controller answers the pet hooks as no-ops", () => {
  const controller = Avatar.createAvatarController({ mode: "nox", root: new FakeElement(), loadRenderer: () => fakeRenderer(), ...fakeTimers() });
  assert.equal(controller.presentation, "overlay");
  controller.reveal();
  controller.showTurn("a", "b");
  // a flag-off wall calls the same hooks on its start tap and on every turn
  const off = Avatar.createAvatarController({ mode: "off", root: new FakeElement() });
  assert.equal(off.mode, "off");
  assert.equal(off.presentation, "off");
  off.reveal();
  off.showTurn("a", "b");
  off.setVoiceState("listening", "Listening… tap to stop");
});
