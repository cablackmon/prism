// NOX hologram avatar for the KYST wall (NOX-11769): the flag, the state map,
// the motion model, the smile guard and the bridge wall.html drives. Nothing
// here touches three.js, so node tests load it the way they load
// voice-streaming.js; the renderer is public/avatar/holo-avatar.js.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.KystAvatar = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  // On by default once main NOX approved the flip (NOX-11769). ?avatarMode=off
  // is the per-URL kill switch and restores the pre-avatar wall exactly.
  const DEFAULT_MODE = "holo";
  // wall.html's own phone breakpoint. A phone gets the static still, never the
  // 16.6 MB GLB (plan open question 2, default "still").
  const PHONE_MAX_WIDTH = 520;
  const REQUESTABLE_MODES = new Set(["off", "holo", "still"]);

  function resolveAvatarMode({ search = "", defaultMode = DEFAULT_MODE, viewportWidth = Infinity, holoGpu = true } = {}) {
    const requested = new URLSearchParams(search).get("avatarMode");
    const mode = REQUESTABLE_MODES.has(requested) ? requested : defaultMode;
    if (mode === "off") return "off";
    if (mode === "still" || viewportWidth <= PHONE_MAX_WIDTH) return "still";
    // a function, so a flag-off wall never creates a probe context
    if (!(typeof holoGpu === "function" ? holoGpu() : holoGpu)) return "still";
    return "holo";
  }

  // WebGL2 alone is not enough: the glow pass and its composer render into
  // HalfFloatType targets, which only EXT_color_buffer_float or
  // EXT_color_buffer_half_float make renderable. Without one the composer
  // fails at draw time, after createHoloRenderer() has already succeeded, so
  // the still fallback never runs. Decide here instead, and confirm a
  // half-float framebuffer is actually complete rather than trust the name.
  // `gl` is a throwaway probe context, released here whatever the answer.
  function canRenderHolo(gl) {
    if (!gl) return false;
    try {
      if (!gl.getExtension("EXT_color_buffer_float") && !gl.getExtension("EXT_color_buffer_half_float")) return false;
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 4, 4, 0, gl.RGBA, gl.HALF_FLOAT, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    } finally {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  }

  // setVoiceState has five values and no "done": the end of a turn is "ready"
  // (Phase 3 consumer notes, section 8). Done is the chat close button, which
  // dissolves the avatar through close(), not through a voice state.
  const AVATAR_STATE_FOR_VOICE = Object.freeze({
    ready: "idle",
    listening: "listening",
    thinking: "thinking",
    speaking: "speaking",
    unavailable: "unavailable",
  });

  function avatarStateFor(voiceState) {
    return AVATAR_STATE_FOR_VOICE[voiceState] || "idle";
  }

  function clamp(value, low = 0, high = 1) {
    return Math.min(high, Math.max(low, value));
  }

  function smooth(edge0, edge1, value) {
    const t = clamp((value - edge0) / (edge1 - edge0));
    return t * t * (3 - 2 * t);
  }

  // The smile rule is enforced where influences are written, not trusted to
  // the bake. Only morphs the manifest marks runtime_driven may move at all,
  // each within its cap; every other morph, including every joy key, is held
  // at 0 every frame. A manifest that marks a capped smile key as driven is
  // refused outright rather than rendered.
  function createMorphGuard(manifest) {
    const smileRule = manifest.smile_rule || {};
    const smileKeys = new Set([
      ...Object.keys(smileRule.clamp06_global_caps || {}),
      ...Object.keys(smileRule.clamp06_window_caps || {}),
    ]);
    const caps = new Map();
    for (const morph of manifest.morphs || []) {
      if (morph.runtime_driven !== true) continue;
      if (smileKeys.has(morph.name)) throw new Error(`smile_rule: ${morph.name} may not be runtime driven`);
      caps.set(morph.name, clamp(Number(morph.cap ?? 1)));
    }
    return {
      driven: Object.freeze([...caps.keys()]),
      value(name, requested) {
        const cap = caps.get(name);
        if (cap === undefined || !Number.isFinite(requested)) return 0;
        return clamp(requested, 0, cap);
      },
    };
  }

  // The Phase 1 viewer's motion model (export/viewer/index.html tick()), which
  // the plan names as the reference implementation, plus the manifest's state
  // table: listening pitches forward and slows into a wider yaw, thinking holds
  // the head off-axis. The state offsets ease in so a state change never snaps.
  const MOTION_SEEDS = [0.31, 0.77, 1.43, 2.11];
  const STATE_ATTITUDE = Object.freeze({
    idle: { yaw: 0, pitch: 0, yawScale: 1, slow: 1 },
    unavailable: { yaw: 0, pitch: 0, yawScale: 1, slow: 1 },
    listening: { yaw: 0, pitch: 2.5, yawScale: 1.25, slow: 1.4 },
    thinking: { yaw: 5, pitch: -2, yawScale: 0.7, slow: 1 },
    speaking: { yaw: 0, pitch: 0, yawScale: 1, slow: 1 },
  });
  const ATTITUDE_TAU_S = 0.45;
  const NOD_PERIOD_S = 0.85;
  // The head carries most of the turn and the neck the rest, so it reads as a
  // neck and not a ball joint. Sway is spread over four spine joints whose
  // shares sum to 1, so the chest never leans past body_sway_max_deg.
  const HEAD_SHARE = { head: [0.55, 0.55, 0.10], neck2: [0.28, 0.30, 0], neck1: [0.17, 0.15, 0] };
  const SPINE_SHARE = { spine4: [0.34, 0.20], spine3: [0.28, 0.16], spine2: [0.22, 0.12], spine1: [0.16, 0.08] };

  function createMotion(motion) {
    const attitude = { ...STATE_ATTITUDE.idle };
    // Listening slows the yaw oscillators. Their phase is integrated from dt:
    // dividing absolute page time by an easing period moves the phase by
    // uptime x the change in rate, which after hours on the kiosk swings the
    // head across its whole range in a single frame.
    const yawPhase = [MOTION_SEEDS[0], MOTION_SEEDS[1]];
    return {
      step(state, seconds, dt, jaw) {
        const target = STATE_ATTITUDE[state] || STATE_ATTITUDE.idle;
        const k = 1 - Math.exp(-Math.max(0, dt) / ATTITUDE_TAU_S);
        for (const key of Object.keys(attitude)) attitude[key] += (target[key] - attitude[key]) * k;
        const TAU = Math.PI * 2;
        const [pA, pB] = motion.head_idle_period_s;
        const slow = attitude.slow;
        yawPhase[0] += TAU * Math.max(0, dt) / (pB * slow);
        yawPhase[1] += TAU * Math.max(0, dt) / (pA * 1.37 * slow);
        let yaw = motion.head_idle_yaw_deg * attitude.yawScale *
          (0.62 * Math.sin(yawPhase[0]) + 0.38 * Math.sin(yawPhase[1]));
        let pitch = motion.head_idle_pitch_deg *
          (0.55 * Math.sin(TAU * seconds / (pB * 1.21) + MOTION_SEEDS[2]) +
           0.45 * Math.sin(TAU * seconds / (pA * 1.91) + MOTION_SEEDS[3]));
        yaw += attitude.yaw;
        pitch += attitude.pitch;
        pitch += motion.speech_nod_deg * Math.sin(TAU * seconds / NOD_PERIOD_S) * clamp(jaw || 0);
        const sway = motion.body_sway_max_deg * Math.sin(TAU * seconds / (pB * 1.7) + 0.9);
        const bones = {};
        for (const [bone, [y, p, r]] of Object.entries(HEAD_SHARE)) bones[bone] = [yaw * y, pitch * p, yaw * r];
        for (const [bone, [y, r]] of Object.entries(SPINE_SHARE)) bones[bone] = [sway * y, 0, sway * r];
        return { yaw, pitch, sway, bones };
      },
    };
  }

  // The v2.3 blink shape as the viewer ported it: shut fast, open slower, on
  // the manifest's interval. Thinking shortens the interval (manifest states).
  const BLINK_SHAPE = { close: 0.07, hold: 0.045, open: 0.11 };
  const THINKING_BLINK_SCALE = 0.6;

  function createBlink(motion, random = Math.random) {
    let next = 2;
    let t = -1;
    return {
      step(state, dt, force = false) {
        if (t < 0) {
          next -= dt;
          if (next > 0 && !force) return 0;
          t = 0;
          const scale = state === "thinking" ? THINKING_BLINK_SCALE : 1;
          const [lo, hi] = motion.blink_interval_s;
          next = (lo + random() * (hi - lo)) * scale;
          return 0;
        }
        t += dt;
        const { close, hold, open } = BLINK_SHAPE;
        if (t < close) return t / close;
        if (t < close + hold) return 1;
        if (t < close + hold + open) return 1 - (t - close - hold) / open;
        t = -1;
        return 0;
      },
    };
  }

  // Jaw and Press from the streamed TTS audio's spectrum, the viewer's
  // analyser shape. Integer bin bounds: a fractional index into a Uint8Array
  // is undefined and turns the whole chain NaN (export HANDOFF, do not repeat).
  function createSpeech() {
    let jaw = 0;
    let press = 0;
    return {
      step(freq, dt) {
        let jawTarget = 0;
        let pressTarget = 0;
        if (freq && freq.length) {
          const n = freq.length;
          const b1 = Math.floor(n * 0.12);
          const b2 = Math.floor(n * 0.45);
          let lo = 0;
          let hi = 0;
          for (let i = 2; i < b1; i += 1) lo += freq[i];
          for (let i = b1; i < b2; i += 1) hi += freq[i];
          lo /= Math.max(1, b1 - 2) * 255;
          hi /= Math.max(1, b2 - b1) * 255;
          const energy = Math.min(1, lo * 1.9 + hi * 0.7);
          jawTarget = clamp((energy - 0.06) * 1.15);
          // a lip press is voiced energy with the jaw shut: high band low, some low band
          pressTarget = clamp(lo * 2.6 - hi * 1.6) * (1 - jawTarget);
        }
        const k = 1 - Math.exp(-Math.max(0, dt) * 22);
        jaw += (jawTarget - jaw) * k;
        press += (pressTarget - press) * k;
        return { jaw, press };
      },
    };
  }

  // Night Sky chat mode v2.3's entrance and exit (nightsky-chatmode-v2.html
  // CHAT, updateChat, updateThree): the constellation's stars stream into the
  // figure, then the hologram resolves. The hologram's own reveal is the
  // manifest's dissolve run backwards: Fade Z0/Z1 lowered from above the head
  // to their shipped values, and raised again on the way out.
  const TRANSITION = Object.freeze({ enterSeconds: 3.05, exitSeconds: 2.55, reducedSeconds: 0.45, stepCap: 0.12 });

  // The seconds into a curve at which it reads `value`, so a reversal mid-way
  // (Done during the entrance, Ask NOX during the exit) continues from where
  // the figure is instead of snapping to an end state first.
  function curveTime(value, seconds, reducedMotion) {
    if (reducedMotion) return clamp(value) * seconds;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i += 1) {
      const mid = (lo + hi) / 2;
      if (smooth(0, 1, mid) < value) lo = mid; else hi = mid;
    }
    return lo * seconds;
  }

  function createTransition({ reducedMotion = false } = {}) {
    let phase = "hidden";
    let focus = 0;
    let elapsed = 0;
    const seconds = (key) => (reducedMotion ? TRANSITION.reducedSeconds : TRANSITION[key]);
    return {
      get phase() { return phase; },
      enter() {
        if (phase === "entering" || phase === "shown") return;
        phase = "entering";
        elapsed = curveTime(focus, seconds("enterSeconds"), reducedMotion);
      },
      exit() {
        if (phase === "hidden" || phase === "exiting") return;
        phase = "exiting";
        elapsed = curveTime(1 - focus, seconds("exitSeconds"), reducedMotion);
      },
      step(dt) {
        elapsed += Math.max(0, dt);
        if (phase === "entering") {
          const p = elapsed / seconds("enterSeconds");
          focus = reducedMotion ? clamp(p) : Math.min(smooth(0, 1, p), focus + TRANSITION.stepCap);
          if (p >= 1 && focus >= 0.999) { focus = 1; phase = "shown"; }
        } else if (phase === "exiting") {
          const p = elapsed / seconds("exitSeconds");
          focus = reducedMotion ? 1 - clamp(p) : Math.max(1 - smooth(0, 1, p), focus - TRANSITION.stepCap);
          if (p >= 1 && focus <= 0.001) { focus = 0; phase = "hidden"; }
        }
        const entering = phase === "entering";
        // v2.3 left an 0.18 shimmer of particles on the finished head; here it
        // fades out by focus 1, so the settled figure is the accepted look09 B
        // and nothing is drawn over it.
        const stream = focus <= 0.01 ? 0 :
          clamp(smooth(0.02, 0.2, focus) * (1 - smooth(0.93, 1, focus)) + 0.18 * smooth(0.84, 1, focus) * (1 - smooth(0.98, 1, focus)));
        const ignition = entering ? smooth(0, 0.1, elapsed) * (1 - smooth(0.24, 0.72, elapsed)) : 0;
        return {
          phase,
          focus,
          particleMorph: reducedMotion ? 1 : smooth(0.08, 0.88, focus),
          particleOpacity: reducedMotion ? 0 : Math.max(stream, ignition),
          constellation: reducedMotion ? 0 : 1 - smooth(0.02, 0.43, focus),
          reveal: reducedMotion ? focus : smooth(0.55, 0.98, focus),
          overlay: reducedMotion ? focus : smooth(0, 0.18, focus),
        };
      },
    };
  }

  // wall.html's side. Created once; mode "off" returns an inert controller so
  // the wall calls it unconditionally and a flag-off wall does nothing new.
  const IDLE_DISMISS_MS = 60_000;

  function createAvatarController({ mode, root, loadRenderer, onDismiss = () => {}, setTimer = setTimeout, clearTimer = clearTimeout, idleDismissMs = IDLE_DISMISS_MS } = {}) {
    if (mode !== "holo" && mode !== "still") {
      return { mode: "off", wantsSpeech: false, open() {}, close() {}, setVoiceState() {}, attachSpeechAnalyser() {} };
    }
    let current = mode;
    let isOpen = false;
    let voiceState = "ready";
    let analyser = null;
    let idleTimer = null;
    let renderer = null;
    let hideTimer = null;
    root.dataset.mode = current;

    function showStill() {
      if (!root.querySelector(".holo-still")) {
        const img = root.ownerDocument.createElement("img");
        img.className = "holo-still";
        img.alt = "";
        img.src = "/avatar/assets/nox_hologram_v1_still_A.jpg";
        root.appendChild(img);
      }
    }

    // A renderer that cannot start (no WebGL2 context, GLB fetch failure)
    // degrades to the still instead of leaving an empty overlay.
    // The overlay is only unhidden once there is something to draw: a holo
    // overlay shown while the GLB still loads is invisible but full screen,
    // and would swallow taps meant for the board.
    function show() {
      clearTimer(hideTimer);
      root.hidden = false;
      if (current === "still") showStill();
      // one frame hidden first, so the opacity transition runs
      root.getBoundingClientRect?.();
      root.classList.add("open");
      renderer?.enter();
    }

    const ready = current === "holo" && loadRenderer
      ? Promise.resolve().then(loadRenderer).then((created) => {
        renderer = created;
        renderer.setState(avatarStateFor(voiceState));
        if (analyser) renderer.setSpeechAnalyser(analyser);
        if (isOpen) show();
        return renderer;
      }).catch((error) => {
        console.warn("kyst_avatar_renderer_failed", error?.message || String(error));
        current = "still";
        root.dataset.mode = current;
        if (isOpen) show();
        return null;
      })
      : Promise.resolve(null);

    function armIdleDismiss() {
      clearTimer(idleTimer);
      idleTimer = null;
      if (isOpen && voiceState === "ready") {
        idleTimer = setTimer(() => { idleTimer = null; close(); }, idleDismissMs);
      }
    }

    function open() {
      if (!isOpen) {
        isOpen = true;
        if (current === "still" || renderer) show();
      }
      armIdleDismiss();
    }

    function close() {
      if (!isOpen) return;
      isOpen = false;
      clearTimer(idleTimer);
      idleTimer = null;
      root.classList.remove("open");
      if (root.hidden) return;
      if (renderer && current === "holo") {
        renderer.exit().then(() => { if (!isOpen) root.hidden = true; });
      } else {
        hideTimer = setTimer(() => { if (!isOpen) root.hidden = true; }, 500);
      }
    }

    root.addEventListener("click", () => { close(); onDismiss(); });

    return {
      get mode() { return current; },
      wantsSpeech: mode === "holo",
      ready,
      open,
      close,
      setVoiceState(state) {
        voiceState = state;
        renderer?.setState(avatarStateFor(state));
        armIdleDismiss();
      },
      attachSpeechAnalyser(node) {
        analyser = node;
        renderer?.setSpeechAnalyser(node);
      },
    };
  }

  return {
    DEFAULT_MODE,
    PHONE_MAX_WIDTH,
    AVATAR_STATE_FOR_VOICE,
    TRANSITION,
    IDLE_DISMISS_MS,
    resolveAvatarMode,
    canRenderHolo,
    avatarStateFor,
    createMorphGuard,
    createMotion,
    createBlink,
    createSpeech,
    createTransition,
    createAvatarController,
    smooth,
  };
});
