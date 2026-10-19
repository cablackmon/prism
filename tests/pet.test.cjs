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
    this.style = {};
    this.captured = new Set();
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  click() { for (const fn of this.listeners.click || []) fn(); }
  fire(type, event = {}) { for (const fn of this.listeners[type] || []) fn(event); return event; }
  setPointerCapture(id) { this.captured.add(id); }
  releasePointerCapture(id) { this.captured.delete(id); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; }
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

function fakeStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

// Her box as the browser lays it out: 300x490 px, standing in her CSS corner (50 px in from the right, on
// the floor) until avatar.js gives her an inline left/top.
const PET_W = 300;
const PET_H = 490;
function layOut(root, view) {
  root.getBoundingClientRect = () => {
    const left = root.style.left ? parseFloat(root.style.left) : view.width - 50 - PET_W;
    const top = root.style.top ? parseFloat(root.style.top) : view.height - PET_H;
    return { left, top, width: PET_W, height: PET_H, right: left + PET_W, bottom: top + PET_H };
  };
}

function pet({ loadRenderer, onTap, storage = fakeStorage(), view = { width: 2560, height: 1440 } } = {}) {
  const els = { root: new FakeElement(), bubble: new FakeElement(), bubbleText: new FakeElement(), hitbox: new FakeElement() };
  layOut(els.root, view);
  const renderer = fakeRenderer();
  const t = fakeTimers();
  const clock = { now: 1000 };
  const win = new FakeElement();
  const controller = Avatar.createPetController({
    ...els, loadRenderer: loadRenderer || (() => renderer), onTap, ...t,
    storage, viewport: () => view, now: () => clock.now, win,
  });
  return { controller, renderer, t, clock, storage, view, win, ...els };
}

// one finger: down, any moves, up; each step advances the clock by `stepMs`
function press(p, points, { id = 1, pointerType = "touch", stepMs = 30, upAfterMs } = {}) {
  const [first, ...rest] = points;
  p.hitbox.fire("pointerdown", { pointerId: id, pointerType, button: 0, clientX: first[0], clientY: first[1] });
  for (const [x, y] of rest) {
    p.clock.now += stepMs;
    p.hitbox.fire("pointermove", { pointerId: id, pointerType, clientX: x, clientY: y });
  }
  p.clock.now += upAfterMs ?? stepMs;
  const last = points.at(-1);
  p.hitbox.fire("pointerup", { pointerId: id, pointerType, button: 0, clientX: last[0], clientY: last[1] });
  // the browser's follow-up click for a pointer tap carries detail 1
  p.hitbox.fire("click", { detail: 1 });
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
  const view = { width: 2560, height: 1440 };
  layOut(els.root, view);
  const renderer = fakeRenderer();
  const overlayRenderer = fakeRenderer();
  const clock = { now: 1000 };
  const avatar = presentation === "pet"
    ? Avatar.createPetController({
      ...els, loadRenderer: () => renderer, onTap: () => mic.click(), ...fakeTimers(),
      storage: fakeStorage(), viewport: () => view, now: () => clock.now, win: null,
    })
    : Avatar.createAvatarController({ mode: "nox", root: holoRoot, loadRenderer: () => overlayRenderer, ...fakeTimers() });
  const context = vm.createContext({
    mic, chatPanel, avatar,
    notifyBoardActivity: () => log.push("activity"),
    beginRecording: () => { log.push("beginRecording"); avatar.setVoiceState("listening", "Listening… tap to stop"); },
    stopRecording: () => log.push("stopRecording"),
    cancelActiveVoice: () => log.push("cancel"),
    recorder: null, pendingPlaybackRequestId: null, activeRequestId: null,
    progressiveAudio: {}, voiceAudio: {}, playAnswerHint: () => "",
  });
  vm.runInContext(`${setChatOpen}\n${micClick}`, context);
  return { avatar, els, mic, chatPanel, holoRoot, log, renderer, overlayRenderer, clock, ...els };
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

// Follow-up (Cameron 2026-10-18 19:02, NOX 1): no voice buttons beside her, and hold-and-move to drag her.

test("pet mode hides the whole voice cluster (mic and status pill); the mic stays in the DOM for her tap", () => {
  // the cluster is exactly the status pill and the mic; the mic is also the stop control while listening
  const cluster = wall.match(/<div id="voice" hidden>([\s\S]*?)\n<\/div>/)?.[1] || "";
  assert.deepEqual([...cluster.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]), ["voice-status", "mic"]);
  assert.match(wall, /\n  body\[data-avatar-presentation="pet"\] #voice \{ display:none; \}\n/);
  // nothing else hides the cluster by presentation, so overlay (and "off") shows it exactly as before
  assert.equal((wall.match(/data-avatar-presentation=[^\]]*\][^{]*#(voice|mic|voice-status)\b/g) || []).length, 1);
  assert.doesNotMatch(wall, /data-avatar-presentation="pet"\] #voice-status/);
  assert.match(wall, /\ndocument\.body\.dataset\.avatarPresentation = avatarPresentation;\n/);
  // her tap is still the mic's click handler, on a mic that is hidden but present
  assert.match(wall, /<button id="mic" type="button" aria-label="Ask NOX" title="Ask NOX">/);
  assert.match(wall, /\n  onTap: \(\) => mic\.click\(\),\n/);
  // a touch on her drags instead of scrolling or zooming the page
  assert.match(wall, /#nox-pet-hit \{[^}]*touch-action:none;/);
});

test("the body follows each presentation: pet hides the cluster, overlay and a failed pet show it", async () => {
  const readyLine = wall.match(/\navatar\.ready\?\.then\(\(\) => \{[^\n]*\}\);\n/)?.[0];
  assert.ok(readyLine);
  const run = async (avatar, initial) => {
    const document = { body: { dataset: { avatarPresentation: initial } } };
    vm.runInContext(readyLine, vm.createContext({ avatar, document }));
    await avatar.ready;
    await Promise.resolve();
    return document.body.dataset.avatarPresentation;
  };
  assert.equal(await run(pet().controller, "pet"), "pet");
  const overlay = Avatar.createAvatarController({ mode: "nox", root: new FakeElement(), loadRenderer: () => fakeRenderer(), ...fakeTimers() });
  assert.equal(await run(overlay, "overlay"), "overlay");
  const warn = console.warn;
  console.warn = () => {};
  try {
    const failed = pet({ loadRenderer: () => Promise.reject(new Error("nox_clip_error")) }).controller;
    // "off" no longer matches the pet rule, so the mic and the pill come back
    assert.equal(await run(failed, "pet"), "off");
  } finally {
    console.warn = warn;
  }
});

test("drag: a tap that stays under the threshold asks, once, through the mic handler", async () => {
  const w = wallTap({ presentation: "pet" });
  await w.avatar.ready;
  w.avatar.reveal();
  press(w, [[1500, 1200], [1505, 1204], [1497, 1206]]);
  assert.deepEqual(w.log, ["activity", "beginRecording"], "the follow-up click asked a second time");
  assert.equal(w.root.style.left, "", "a tap moved her");
  assert.equal(w.root.classList.contains("dragging"), false);
  // her pointer was captured on the press and let go on release
  assert.equal(w.hitbox.captured.size, 0);
});

test("drag: moving past the threshold drags her, the bubble follows, and nothing listens", async () => {
  let taps = 0;
  const p = pet({ onTap: () => { taps += 1; } });
  await p.controller.ready;
  p.controller.reveal();
  p.controller.setVoiceState("ready", "I didn't hear anything. Tap to try again.");
  const stateCalls = p.renderer.calls.length;
  const start = p.root.getBoundingClientRect();
  p.hitbox.fire("pointerdown", { pointerId: 7, pointerType: "touch", button: 0, clientX: 2400, clientY: 1200 });
  assert.equal(p.hitbox.captured.has(7), true, "the press did not capture the pointer");
  p.hitbox.fire("pointermove", { pointerId: 7, clientX: 2394, clientY: 1196 });
  assert.equal(p.root.style.left, "", "she moved before the threshold");
  p.hitbox.fire("pointermove", { pointerId: 7, clientX: 1900, clientY: 900 });
  assert.equal(p.root.classList.contains("dragging"), true);
  assert.deepEqual([p.root.style.left, p.root.style.top], [`${start.left - 500}px`, `${start.top - 300}px`]);
  assert.deepEqual([p.root.style.right, p.root.style.bottom], ["auto", "auto"]);
  // the bubble hangs off her head at her new spot
  assert.equal(p.bubble.style.top, `${start.top - 300 + PET_H * 0.03}px`);
  assert.equal(p.bubble.style.right, `${p.view.width - (start.left - 500 + PET_W * 0.26)}px`);
  // a pointer that is not hers does not move her
  p.hitbox.fire("pointermove", { pointerId: 8, clientX: 100, clientY: 100 });
  assert.equal(p.root.style.left, `${start.left - 500}px`);
  p.clock.now += 3000;
  p.hitbox.fire("pointerup", { pointerId: 7, clientX: 1900, clientY: 900 });
  p.hitbox.fire("click", { detail: 1 });
  assert.equal(taps, 0, "a drag asked NOX");
  assert.equal(p.root.classList.contains("dragging"), false);
  // her clip was never told to change while she was carried
  assert.equal(p.renderer.calls.length, stateCalls);
  assert.equal(p.controller.presentation, "pet");
});

test("drag: the drop spot is saved as fractions of her room and restored after a reload at another size", async () => {
  const storage = fakeStorage();
  const p = pet({ storage });
  await p.controller.ready;
  p.controller.reveal();
  const start = p.root.getBoundingClientRect();
  press(p, [[2400, 1200], [2400 - 1130, 1200 - 475]]);
  const left = start.left - 1130;
  const top = start.top - 475;
  assert.deepEqual([p.root.style.left, p.root.style.top], [`${left}px`, `${top}px`]);
  const saved = JSON.parse(storage.getItem(Avatar.PET_POSITION_KEY));
  assert.equal(Avatar.PET_POSITION_KEY, "kyst.noxPet.pos.v1");
  assert.ok(Math.abs(saved.x - left / (2560 - PET_W)) < 1e-9);
  assert.ok(Math.abs(saved.y - top / (1440 - PET_H)) < 1e-9);
  // the 03:00 reload on the same wall
  const same = pet({ storage });
  await same.controller.ready;
  assert.equal(same.root.style.left, undefined, "she was placed while still hidden behind the start card");
  same.controller.reveal();
  assert.deepEqual([same.root.style.left, same.root.style.top], [`${left}px`, `${top}px`]);
  // the same spot on a 1920x1080 screen, as the same share of her room
  const small = pet({ storage, view: { width: 1920, height: 1080 } });
  await small.controller.ready;
  small.controller.reveal();
  assert.ok(Math.abs(parseFloat(small.root.style.left) - saved.x * (1920 - PET_W)) < 1e-6);
  assert.ok(Math.abs(parseFloat(small.root.style.top) - saved.y * (1080 - PET_H)) < 1e-6);
  // nothing saved, or a broken entry: her CSS corner, bottom-right
  for (const entry of [{}, { [Avatar.PET_POSITION_KEY]: "{not json" }, { [Avatar.PET_POSITION_KEY]: '{"x":"a"}' }]) {
    const fresh = pet({ storage: fakeStorage(entry) });
    await fresh.controller.ready;
    fresh.controller.reveal();
    assert.deepEqual([fresh.root.style.left, fresh.root.style.top, fresh.root.style.right], ["", "", ""]);
  }
});

test("drag: she is clamped inside the viewport on drop and on resize", async () => {
  const storage = fakeStorage();
  const p = pet({ storage });
  await p.controller.ready;
  p.controller.reveal();
  // flung far past the top-left corner
  press(p, [[2400, 1200], [-3000, -3000]]);
  assert.deepEqual([p.root.style.left, p.root.style.top], ["0px", "0px"]);
  assert.deepEqual(JSON.parse(storage.getItem(Avatar.PET_POSITION_KEY)), { x: 0, y: 0 });
  // and past the bottom-right
  press(p, [[200, 200], [9000, 9000]]);
  assert.deepEqual([p.root.style.left, p.root.style.top], [`${2560 - PET_W}px`, `${1440 - PET_H}px`]);
  assert.deepEqual(JSON.parse(storage.getItem(Avatar.PET_POSITION_KEY)), { x: 1, y: 1 });
  // a smaller window keeps her on screen at the same share of her room
  p.view.width = 1280;
  p.view.height = 720;
  p.win.fire("resize");
  assert.deepEqual([p.root.style.left, p.root.style.top], [`${1280 - PET_W}px`, `${720 - PET_H}px`]);
  // a stored value outside 0..1 is clamped too
  const odd = pet({ storage: fakeStorage({ [Avatar.PET_POSITION_KEY]: '{"x":-4,"y":7}' }) });
  await odd.controller.ready;
  odd.controller.reveal();
  assert.deepEqual([odd.root.style.left, odd.root.style.top], ["0px", `${1440 - PET_H}px`]);
});

test("drag: a long still press does nothing; holding her still for 2 s sends her home", async () => {
  let taps = 0;
  const storage = fakeStorage();
  const p = pet({ storage, onTap: () => { taps += 1; } });
  await p.controller.ready;
  p.controller.reveal();
  press(p, [[2400, 1200], [600, 300]]);
  assert.ok(storage.getItem(Avatar.PET_POSITION_KEY));
  // 0.8 s still: not a tap, not a move, not a reset
  press(p, [[700, 400]], { upAfterMs: 800 });
  assert.equal(taps, 0, "a long press asked NOX");
  assert.ok(storage.getItem(Avatar.PET_POSITION_KEY));
  assert.equal(p.t.timers.size, 0, "the reset hold outlived the press");
  // hold still past 2 s: she goes back to her corner while still held, and the release does not ask
  p.hitbox.fire("pointerdown", { pointerId: 3, pointerType: "touch", button: 0, clientX: 700, clientY: 400 });
  assert.equal(Avatar.PET_RESET_HOLD_MS, 2000);
  p.clock.now += 2000;
  p.t.fire(Avatar.PET_RESET_HOLD_MS);
  assert.equal(storage.getItem(Avatar.PET_POSITION_KEY), null);
  assert.deepEqual([p.root.style.left, p.root.style.top, p.root.style.right, p.root.style.bottom], ["", "", "", ""]);
  // a wobble after the reset does not pick her up again
  p.hitbox.fire("pointermove", { pointerId: 3, clientX: 900, clientY: 600 });
  assert.equal(p.root.style.left, "");
  p.hitbox.fire("pointerup", { pointerId: 3, clientX: 900, clientY: 600 });
  p.hitbox.fire("click", { detail: 1 });
  assert.equal(taps, 0);
  // a drag cancels the reset hold
  p.hitbox.fire("pointerdown", { pointerId: 4, pointerType: "touch", button: 0, clientX: 2400, clientY: 1200 });
  p.hitbox.fire("pointermove", { pointerId: 4, clientX: 2000, clientY: 1000 });
  assert.equal(p.t.timers.size, 0);
  p.hitbox.fire("pointerup", { pointerId: 4, clientX: 2000, clientY: 1000 });
});

test("drag: right-click and the long-press menu do nothing; only her tap box starts a drag; a failed pet ignores presses", async () => {
  let taps = 0;
  const p = pet({ onTap: () => { taps += 1; } });
  await p.controller.ready;
  p.controller.reveal();
  p.hitbox.fire("pointerdown", { pointerId: 1, pointerType: "mouse", button: 2, clientX: 2400, clientY: 1200 });
  p.hitbox.fire("pointermove", { pointerId: 1, clientX: 1000, clientY: 1000 });
  p.hitbox.fire("pointerup", { pointerId: 1, clientX: 1000, clientY: 1000 });
  assert.equal(p.root.style.left, "");
  assert.equal(taps, 0);
  let prevented = false;
  p.hitbox.fire("contextmenu", { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  // a mouse press with the main button drags the same as a finger
  press(p, [[2400, 1200], [2000, 1000]], { pointerType: "mouse" });
  assert.equal(p.root.style.left, `${2560 - 50 - PET_W - 400}px`);
  // the bubble and her box around the figure have no press handlers at all
  assert.equal(p.bubble.listeners.pointerdown, undefined);
  assert.equal(p.root.listeners.pointerdown, undefined);
  // a pointercancel mid-drag leaves her where she got to and saves it
  p.hitbox.fire("pointerdown", { pointerId: 9, pointerType: "touch", button: 0, clientX: 1500, clientY: 1000 });
  p.hitbox.fire("pointermove", { pointerId: 9, clientX: 1400, clientY: 1000 });
  p.hitbox.fire("pointercancel", { pointerId: 9 });
  assert.equal(p.root.style.left, `${2560 - 50 - PET_W - 500}px`);
  assert.ok(p.storage.getItem(Avatar.PET_POSITION_KEY));
  assert.equal(taps, 0);
  const warn = console.warn;
  console.warn = () => {};
  try {
    const broken = pet({ loadRenderer: () => { throw new Error("nox_clip_error"); }, onTap: () => { taps += 1; } });
    await broken.controller.ready;
    press(broken, [[100, 100]]);
    assert.equal(taps, 0);
    assert.equal(broken.hitbox.captured.size, 0);
  } finally {
    console.warn = warn;
  }
});

test("drag: near the left edge her bubble flips to her right; back in her corner it hangs on her left", async () => {
  const p = pet();
  await p.controller.ready;
  p.controller.reveal();
  p.controller.setVoiceState("listening", "Listening… tap to stop");
  assert.equal(p.bubble.dataset.side, "left");
  // her CSS corner: the stylesheet places the bubble, no inline position
  assert.deepEqual([p.bubble.style.left, p.bubble.style.right, p.bubble.style.top], ["", "", ""]);
  press(p, [[2400, 1200], [-3000, 1200]]);
  assert.equal(p.root.style.left, "0px");
  assert.equal(p.bubble.dataset.side, "right");
  assert.deepEqual([p.bubble.style.left, p.bubble.style.right], [`${PET_W * 0.74}px`, "auto"]);
  // the middle of the board has room on her left again
  press(p, [[100, 1200], [1200, 1200]]);
  assert.equal(p.bubble.dataset.side, "left");
  assert.equal(p.bubble.style.left, "auto");
  // the flip follows her while she is carried, not only on drop
  p.hitbox.fire("pointerdown", { pointerId: 5, pointerType: "touch", button: 0, clientX: 1300, clientY: 1200 });
  p.hitbox.fire("pointermove", { pointerId: 5, clientX: 0, clientY: 1200 });
  assert.equal(p.bubble.dataset.side, "right");
  p.hitbox.fire("pointerup", { pointerId: 5, clientX: 0, clientY: 1200 });
  // the CSS tail flips with it
  assert.match(wall, /#nox-pet-bubble\[data-side="right"\]::after \{ right:auto; left:-19px;/);
});
