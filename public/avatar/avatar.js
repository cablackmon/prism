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
  // Default is now "nox": the Nox Face / Nox Pet Family v9 clips (Cameron
  // 2026-10-18, option A). ?avatarMode=holo still brings back the 3D hologram.
  const DEFAULT_MODE = "nox";
  // wall.html's own phone breakpoint. A phone gets the static still, never the
  // 16.6 MB GLB or the clip set (plan open question 2, default "still").
  const PHONE_MAX_WIDTH = 520;
  const REQUESTABLE_MODES = new Set(["off", "nox", "holo", "still"]);
  // modes that draw through a loaded renderer rather than the still image
  const RENDERER_MODES = new Set(["nox", "holo"]);
  const STILL_SRC = "/avatar/nox/nox_family_v9_still.jpg";

  function resolveAvatarMode({ search = "", defaultMode = DEFAULT_MODE, viewportWidth = Infinity, holoGpu = true } = {}) {
    const requested = new URLSearchParams(search).get("avatarMode");
    const mode = REQUESTABLE_MODES.has(requested) ? requested : defaultMode;
    if (mode === "off") return "off";
    if (mode === "still" || viewportWidth <= PHONE_MAX_WIDTH) return "still";
    // the clips are plain <video>, so only the hologram needs the GPU probe
    if (mode === "nox") return "nox";
    // a function, so a flag-off wall never creates a probe context
    if (!(typeof holoGpu === "function" ? holoGpu() : holoGpu)) return "still";
    return "holo";
  }

  // Where the clip avatar lives (Cameron 2026-10-18, NOX 1: "make it a nox pet instead of opening the face
  // page"). "pet" stands her in the corner of the board all day and answers inline; "overlay" is the
  // full-screen #holo-avatar from PR #31. Only the clip avatar has a pet body, so holo, still and off keep
  // the overlay exactly as before. wall.html's window.KYST_AVATAR_MODE is the one-line rollback, and
  // ?avatarPresentation= overrides it per URL.
  const DEFAULT_PRESENTATION = "pet";
  const PRESENTATIONS = new Set(["pet", "overlay"]);

  function resolveAvatarPresentation({ mode, flag, search = "" } = {}) {
    const requested = new URLSearchParams(search).get("avatarPresentation");
    const chosen = PRESENTATIONS.has(requested) ? requested : PRESENTATIONS.has(flag) ? flag : DEFAULT_PRESENTATION;
    return mode === "nox" && chosen === "pet" ? "pet" : "overlay";
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
  // refused outright rather than rendered. A driven cap may exceed 1 (the Jaw
  // viseme is overdriven past its baked frame, NOX-11813), never past 2.
  const MAX_DRIVEN_CAP = 2;

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
      caps.set(morph.name, clamp(Number(morph.cap ?? 1), 0, MAX_DRIVEN_CAP));
    }
    return {
      driven: Object.freeze([...caps.keys()]),
      cap(name) {
        return caps.get(name) ?? 0;
      },
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

  // NOX-11841, Cameron 2026-09-25 on the live wall: "She does not blink." The
  // v2.3 blink was a 45 ms linear close. Here the lids ease shut, stay shut
  // for about 120 ms and ease open a little slower, on the manifest's 2.5-6 s
  // interval in every state; one blink in eight is a double. The value is a
  // fraction of the renderer's Blink cap.
  const BLINK_SHAPE = Object.freeze({ close: 0.07, hold: 0.12, open: 0.14, doubleGap: 0.12, doubleEvery: 8 });

  function createBlink(motion, random = Math.random) {
    const [lo, hi] = motion.blink_interval_s;
    const interval = () => lo + random() * (hi - lo);
    const { close, hold, open, doubleGap, doubleEvery } = BLINK_SHAPE;
    let wait = interval();
    let t = -1;
    let queued = 0;
    return {
      step(dt) {
        dt = Math.max(0, dt);
        if (t < 0) {
          wait -= dt;
          if (wait > 0) return 0;
          t = 0;
          // the second of a double is never itself doubled
          if (queued > 0) queued -= 1; else queued = random() < 1 / doubleEvery ? 1 : 0;
          return 0;
        }
        t += dt;
        if (t < close) return smooth(0, close, t);
        if (t < close + hold) return 1;
        if (t < close + hold + open) return 1 - smooth(0, open, t - close - hold);
        t = -1;
        wait = queued > 0 ? doubleGap : interval();
        return 0;
      },
    };
  }

  // NOX-11841 expressions bound to the voice state: "There are no facial
  // expressions." Listening lifts the brows a little (attentive); thinking
  // knits them, breathing slowly; speaking relaxes them and gives a warm smile
  // beat at each sentence start; idle, unavailable and the exit are neutral.
  // Weights are fractions of each morph's baked frame, and the smile guard
  // clamps them again on write. Every target reaches the face through two
  // cascaded lags, an S-shaped ease that settles in about half a second.
  const EXPRESSION = Object.freeze({
    listening: Object.freeze({ NX5_Performance_Brow_Surprise: 0.4 }),
    thinking: Object.freeze({ NX5_Performance_Brow_Furrow: 0.4, NX5_Performance_Brow_Concern: 0.3 }),
    smile: Object.freeze({ NX19_Smile_Warm: 0.4, NX19_Warm_Corner_Fairing: 0.4 }),
  });
  const FACE = Object.freeze({
    easeSeconds: 0.12,    // per lag: 95% of a step in about 0.57 s
    breathePeriodS: 4.5,  // thinking brows swell and ease on this slow cycle
    breatheDepth: 0.3,    // down to 70% of the thinking target, never above it
    sentenceGapS: 0.35,   // this long without voice, and the next voiced frame starts a sentence
    beatSeconds: 0.9,     // the smile target holds this long, then eases back out
    beatSpacingS: 2.5,    // a string of short sentences smiles at most this often
  });
  const EXPRESSION_KEYS = Object.freeze([...new Set([
    ...Object.keys(EXPRESSION.listening), ...Object.keys(EXPRESSION.thinking), ...Object.keys(EXPRESSION.smile),
  ])]);

  function createExpression() {
    const lag1 = Object.fromEntries(EXPRESSION_KEYS.map((key) => [key, 0]));
    const face = { ...lag1 };
    let breathe = 0;
    let quiet = Infinity;
    let beat = -1;
    let sinceBeat = Infinity;
    let lastState = null;
    return {
      step(state, dt, { levelDb = -Infinity, neutral = false } = {}) {
        dt = Math.max(0, dt);
        breathe += dt;
        sinceBeat += dt;
        // entering speaking, the first voiced frame is a sentence start
        if (state !== lastState && state === "speaking") quiet = Infinity;
        lastState = state;
        const voiced = levelDb > SPEECH.gateDb;
        // the analyser only carries answer audio. After an autoplay rejection the wall's tap-to-play retry plays
        // the answer while the voice state is still "ready" (idle), and that answer smiles too.
        const answering = state === "speaking" || state === "idle";
        if (answering && voiced && quiet >= FACE.sentenceGapS && sinceBeat >= FACE.beatSpacingS) {
          beat = 0;
          sinceBeat = 0;
        }
        quiet = voiced ? 0 : quiet + dt;
        if (beat >= 0) beat = beat + dt < FACE.beatSeconds && answering ? beat + dt : -1;
        const target = neutral ? {} :
          state === "listening" ? EXPRESSION.listening :
          state === "thinking" ? EXPRESSION.thinking :
          answering && beat >= 0 ? EXPRESSION.smile : {};
        const swell = state === "thinking"
          ? 1 - FACE.breatheDepth * (0.5 - 0.5 * Math.cos(2 * Math.PI * breathe / FACE.breathePeriodS)) : 1;
        const k = 1 - Math.exp(-dt / FACE.easeSeconds);
        for (const key of EXPRESSION_KEYS) {
          lag1[key] += ((target[key] || 0) * swell - lag1[key]) * k;
          face[key] += (lag1[key] - face[key]) * k;
        }
        return face;
      },
    };
  }

  // Jaw and Press from the streamed TTS audio's waveform (NOX-11813). The
  // viewer's byte spectrum saturated: at playback level most bins sit above
  // the analyser's -30 dB ceiling, so the jaw was pinned at its cap for a
  // whole answer (median 1.0 on the board) and the mouth held open instead of
  // moving. Here the frame's RMS level is read against the phrase's own
  // peak, so every syllable opens the jaw from shut whatever the playback
  // gain, and while speech is going on the lips press together in the gaps.
  // The peak follows any voiced level, however quiet, restarts at every
  // pause, and after a syllable's hold falls fast enough that a quieter
  // stretch without a pause still opens the mouth. After the answer the press lets go and the rest pose
  // returns.
  const SPEECH = Object.freeze({
    gateDb: -50,         // below this the frame is silence (the tap outputs zeros between answers)
    rangeDb: 12,         // a syllable peak opens fully; 12 dB under the peak is shut
    peakHoldSeconds: 0.3, // about one syllable: a trough is read against the syllable before it
    peakReleaseDbPerS: 30, // then the peak falls to meet a quieter stretch
    gapSeconds: 0.12,    // this long since the last voiced frame is a pause: the next phrase sets its own peak
    shape: 1,            // openness is linear in dB; below 1 held the jaw open through consonants
    pressMax: 0.85,
    holdSeconds: 0.35,   // how long the lips keep pressing after the last voiced frame
    openRate: 30,        // 1/s, the jaw drops fast on a syllable onset
    closeRate: 24,       // and closes a little slower, fast enough to shut between syllables
  });

  function createSpeech({ jawMax = 1, ...tuning } = {}) {
    const cfg = { ...SPEECH, ...tuning };
    let jaw = 0;
    let press = 0;
    let peakDb = cfg.gateDb;
    let hold = 0;
    let quiet = 0;
    let peakAge = 0;
    let levelDb = -Infinity;
    let open = 0;
    return {
      step(samples, dt) {
        dt = Math.max(0, dt);
        let sum = 0;
        const n = samples ? samples.length : 0;
        for (let i = 0; i < n; i += 1) sum += samples[i] * samples[i];
        const rms = n ? Math.sqrt(sum / n) : 0;
        levelDb = rms > 0 && Number.isFinite(rms) ? 20 * Math.log10(rms) : -Infinity;
        const voiced = levelDb > cfg.gateDb;
        // measured to this tick before it is cleared, so the frame that resumes speech still sees the pause
        const sinceVoiced = quiet + dt;
        quiet = voiced ? 0 : sinceVoiced;
        peakAge += dt;
        if (sinceVoiced >= cfg.gapSeconds) peakDb = cfg.gateDb;
        else if (peakAge > cfg.peakHoldSeconds) peakDb = Math.max(cfg.gateDb, peakDb - cfg.peakReleaseDbPerS * dt);
        if (voiced && levelDb >= peakDb) { peakDb = levelDb; peakAge = 0; }
        open = voiced ? clamp((levelDb - (peakDb - cfg.rangeDb)) / cfg.rangeDb) ** cfg.shape : 0;
        hold = voiced ? cfg.holdSeconds : Math.max(0, hold - dt);
        const jawTarget = open * jawMax;
        const pressTarget = hold > 0 ? cfg.pressMax * (1 - open) ** 2 : 0;
        const rate = jawTarget > jaw ? cfg.openRate : cfg.closeRate;
        jaw += (jawTarget - jaw) * (1 - Math.exp(-dt * rate));
        press += (pressTarget - press) * (1 - Math.exp(-dt * cfg.closeRate));
        return { jaw, press, open, levelDb };
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
    if (!RENDERER_MODES.has(mode) && mode !== "still") {
      return {
        mode: "off", presentation: "off", wantsSpeech: false,
        open() {}, close() {}, setVoiceState() {}, attachSpeechAnalyser() {}, reveal() {}, showTurn() {},
      };
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
        img.src = STILL_SRC;
        root.appendChild(img);
      }
    }

    // A renderer that cannot start (no WebGL2 context, GLB or clip fetch failure)
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

    const ready = RENDERER_MODES.has(current) && loadRenderer
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
      if (renderer && RENDERER_MODES.has(current)) {
        renderer.exit().then(() => { if (!isOpen) root.hidden = true; });
      } else {
        hideTimer = setTimer(() => { if (!isOpen) root.hidden = true; }, 500);
      }
    }

    root.addEventListener("click", () => { close(); onDismiss(); });

    return {
      get mode() { return current; },
      presentation: "overlay",
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
      // the pet's hooks; the overlay keeps its own chat panel
      reveal() {},
      showTurn() {},
    };
  }

  // The resident pet: the same clip renderer as the overlay, mounted in a small box in the corner of the
  // board. It never opens #holo-avatar. A tap on her is the mic's own tap (onTap), so the wall's mic and
  // turn handlers run unchanged; the controller only shows what they report. Her bubble beside her head
  // says "Listening…" and "Thinking…", then shows what was heard and the answer as it streams, and fades a
  // little after the turn ends. A renderer that cannot start hides her and reports presentation "off", so
  // the wall falls back to its chat panel, the pre-avatar wall.
  const PET_STATUS = Object.freeze({ listening: "Listening…", thinking: "Thinking…" });
  const PET_READY_LABEL = "Tap to ask NOX";
  const PET_BUBBLE_LINGER_MS = 20_000;
  // Drag to move (Cameron 2026-10-18, NOX 1: "hold your finger on it and then move the pet around"). A press
  // is a drag only once the pointer travels past PET_DRAG_THRESHOLD_PX, so a plain tap still asks. A release
  // inside PET_TAP_MS without that travel is a tap; a longer still press does nothing, and holding her still
  // for PET_RESET_HOLD_MS sends her back to her corner. (Not a double tap: the first tap of a double tap would
  // already have started listening and the second would stop it.)
  // 15 CSS px is Chrome's own touch slop for a tap on Windows (ui/events/gesture_detection
  // max_touch_move_in_pixels_for_click_, Aura default), about 4 mm on the Acer's 32" 4K panel at 1.5x, so
  // any press Chrome would call a tap also asks NOX
  const PET_DRAG_THRESHOLD_PX = 15;
  const PET_TAP_MS = 500;
  const PET_RESET_HOLD_MS = 2000;
  // where she was dropped, as fractions (0..1) of the room she can move in across and down the viewport, so
  // a dropped spot survives the 03:00 reload and a new resolution; no entry = her bottom-right corner
  const PET_POSITION_KEY = "kyst.noxPet.pos.v1";
  // the bubble hangs off her head on her left; it flips to her right when her left has no room for it.
  // Her figure is about 18-80% of her box; the bubble's tail sits at 26% (left side) or 74% (right side).
  const PET_BUBBLE_MAX_PX = 560;
  const PET_BUBBLE_MAX_VW = 0.36;

  function defaultPetStorage() {
    try { return globalThis.localStorage || null; } catch { return null; }
  }

  function defaultPetViewport() {
    return { width: globalThis.innerWidth || 0, height: globalThis.innerHeight || 0 };
  }

  function clamp01(value) {
    return Math.min(1, Math.max(0, value));
  }

  function createPetController({
    root, bubble, bubbleText, hitbox, loadRenderer, onTap = () => {},
    setTimer = setTimeout, clearTimer = clearTimeout, lingerMs = PET_BUBBLE_LINGER_MS,
    storage = defaultPetStorage(), viewport = defaultPetViewport, now = () => Date.now(), win = globalThis,
  } = {}) {
    let renderer = null;
    let failed = false;
    let revealed = false;
    let voiceState = "ready";
    let label = "";
    let transcript = "";
    let answer = "";
    let lingerTimer = null;
    let press = null;
    let position = readPosition();
    // true once avatar.js stands her with an inline left/top (a drag in progress, or a saved spot)
    let placed = false;
    root.dataset.state = voiceState;

    function readPosition() {
      try {
        const saved = JSON.parse(storage?.getItem(PET_POSITION_KEY) || "null");
        if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y)) return { x: clamp01(saved.x), y: clamp01(saved.y) };
      } catch { /* a bad entry is her corner */ }
      return null;
    }

    function writePosition() {
      try {
        if (position) storage?.setItem(PET_POSITION_KEY, JSON.stringify(position));
        else storage?.removeItem(PET_POSITION_KEY);
      } catch { /* storage full or blocked: she still moves, she just forgets on reload */ }
    }

    // her box in px, and how far it can travel inside the viewport
    function room() {
      const box = root.getBoundingClientRect();
      const view = viewport();
      return { box, view, freeX: Math.max(0, view.width - box.width), freeY: Math.max(0, view.height - box.height) };
    }

    function placeAt(left, top) {
      const { freeX, freeY } = room();
      const x = Math.min(freeX, Math.max(0, left));
      const y = Math.min(freeY, Math.max(0, top));
      Object.assign(root.style, { left: `${x}px`, top: `${y}px`, right: "auto", bottom: "auto" });
      placed = true;
      return { x: freeX ? x / freeX : 0, y: freeY ? y / freeY : 0 };
    }

    // a saved spot is replayed against today's viewport; none leaves her where the CSS stands her
    function applyPosition() {
      if (root.hidden) return;
      if (position) {
        const { freeX, freeY } = room();
        placeAt(position.x * freeX, position.y * freeY);
      } else {
        Object.assign(root.style, { left: "", top: "", right: "", bottom: "" });
        placed = false;
      }
      placeBubble();
    }

    function placeBubble() {
      if (root.hidden) return;
      const { box, view } = room();
      const maxBubble = Math.min(PET_BUBBLE_MAX_PX, view.width * PET_BUBBLE_MAX_VW);
      const leftRoom = box.left + box.width * 0.26;
      const rightRoom = view.width - (box.left + box.width * 0.74);
      const side = leftRoom >= maxBubble || leftRoom >= rightRoom ? "left" : "right";
      bubble.dataset.side = side;
      if (!placed && side === "left") {
        Object.assign(bubble.style, { left: "", right: "", top: "" });
        return;
      }
      Object.assign(bubble.style, side === "left"
        ? { left: "auto", right: `${view.width - leftRoom}px`, top: `${box.top + box.height * 0.03}px` }
        : { left: `${view.width - rightRoom}px`, right: "auto", top: `${box.top + box.height * 0.03}px` });
    }

    function resetPosition() {
      position = null;
      writePosition();
      applyPosition();
    }

    function say(kind, text) {
      bubble.dataset.kind = kind;
      bubbleText.textContent = text;
      bubble.hidden = false;
      bubble.classList.add("open");
      placeBubble();
      // a long answer keeps its newest words in view as it streams; a finger can scroll back up
      bubbleText.scrollTop = bubbleText.scrollHeight;
    }

    function hideBubble() {
      clearTimer(lingerTimer);
      lingerTimer = null;
      bubble.classList.remove("open");
      bubble.hidden = true;
    }

    function render() {
      clearTimer(lingerTimer);
      lingerTimer = null;
      if (failed || !revealed) return hideBubble();
      const settled = voiceState === "ready" || voiceState === "unavailable";
      // an error or a hint from the wall ("I didn't hear anything…") wins over a stale answer
      if (settled && label && label !== PET_READY_LABEL) say("status", label);
      else if (answer) say("nox", answer);
      else if (voiceState === "listening" || voiceState === "thinking") {
        if (transcript) say("you", transcript); else say("status", PET_STATUS[voiceState]);
      } else if (voiceState === "speaking" && transcript) say("you", transcript);
      else return hideBubble();
      if (settled) lingerTimer = setTimer(hideBubble, lingerMs);
    }

    function show() {
      root.hidden = false;
      // one frame hidden first, so the fade-in runs; her box has a size from here on
      applyPosition();
      root.classList.add("open");
      renderer.enter();
    }

    const ready = Promise.resolve().then(loadRenderer).then((created) => {
      renderer = created;
      renderer.setState(avatarStateFor(voiceState));
      if (revealed) show();
      return renderer;
    }).catch((error) => {
      console.warn("kyst_pet_renderer_failed", error?.message || String(error));
      failed = true;
      root.hidden = true;
      hideBubble();
      return null;
    });

    function endPress() {
      if (!press) return null;
      const ended = press;
      press = null;
      clearTimer(ended.resetTimer);
      root.classList.remove("dragging");
      try { hitbox.releasePointerCapture?.(ended.id); } catch { /* already released */ }
      return ended;
    }

    // Only her tap box takes the press, so a drag never starts from the bubble or the board around her.
    hitbox.addEventListener("pointerdown", (event) => {
      if (failed || press || (event.pointerType === "mouse" && event.button !== 0)) return;
      const { box } = room();
      press = {
        id: event.pointerId, x: event.clientX, y: event.clientY, left: box.left, top: box.top,
        at: now(), dragging: false, reset: false,
        resetTimer: setTimer(() => {
          if (!press || press.dragging) return;
          press.reset = true;
          resetPosition();
        }, PET_RESET_HOLD_MS),
      };
      // she keeps the pointer even when a fast finger leaves her box
      try { hitbox.setPointerCapture?.(event.pointerId); } catch { /* the pointer is already gone */ }
    });
    hitbox.addEventListener("pointermove", (event) => {
      if (!press || event.pointerId !== press.id || press.reset) return;
      const dx = event.clientX - press.x;
      const dy = event.clientY - press.y;
      if (!press.dragging) {
        if (Math.hypot(dx, dy) <= PET_DRAG_THRESHOLD_PX) return;
        press.dragging = true;
        clearTimer(press.resetTimer);
        root.classList.add("dragging");
      }
      // she follows the pointer; her clip keeps playing and the bubble comes with her
      placeAt(press.left + dx, press.top + dy);
      placeBubble();
    });
    hitbox.addEventListener("pointerup", (event) => {
      if (!press || event.pointerId !== press.id) return;
      const ended = endPress();
      if (ended.dragging) {
        const { box } = room();
        position = placeAt(box.left, box.top);
        writePosition();
        placeBubble();
      } else if (!ended.reset && now() - ended.at <= PET_TAP_MS) {
        onTap();
      }
    });
    function abandonPress(event) {
      if (!press || event.pointerId !== press.id) return;
      const ended = endPress();
      if (!ended.dragging) return;
      // the browser took the pointer mid-drag: she stays where she got to
      const { box } = room();
      position = placeAt(box.left, box.top);
      writePosition();
      placeBubble();
    }
    hitbox.addEventListener("pointercancel", abandonPress);
    // capture lost with no pointerup (her box hidden or detached mid-press) ends the press as well, so a
    // stale press can never swallow every later tap while the mic is hidden; after a pointerup it is a no-op
    hitbox.addEventListener("lostpointercapture", abandonPress);
    // a long press is not a right-click menu on a touch screen
    hitbox.addEventListener("contextmenu", (event) => event.preventDefault());
    // A pointer tap is decided on pointerup above, so its follow-up click (detail >= 1) is ignored; a
    // keyboard Enter or Space on the focused button, and a scripted click(), arrive with detail 0 and ask.
    hitbox.addEventListener("click", (event) => { if (!failed && !event?.detail) onTap(); });
    // a tap on the bubble puts it away, so a long answer never sits over the board's own buttons
    bubble.addEventListener("click", hideBubble);
    // a new window size replays the saved spot, so she is never left off screen
    win?.addEventListener?.("resize", () => { if (!press) applyPosition(); });

    return {
      get mode() { return failed ? "off" : "nox"; },
      get presentation() { return failed ? "off" : "pet"; },
      wantsSpeech: false,
      ready,
      // she is resident: the mic's open() and the chat close's close() never move her
      open() {},
      close() { hideBubble(); },
      // the board's start tap; she waves once here, so the wave is not spent behind the start card
      reveal() {
        if (revealed) return;
        revealed = true;
        if (renderer) show();
      },
      setVoiceState(state, nextLabel = "") {
        // a new question starts a clean bubble
        if (state === "listening" && voiceState !== "listening") { transcript = ""; answer = ""; }
        voiceState = state;
        label = nextLabel || "";
        root.dataset.state = state;
        renderer?.setState(avatarStateFor(state));
        render();
      },
      showTurn(nextTranscript, nextAnswer) {
        transcript = nextTranscript || "";
        answer = nextAnswer || "";
        render();
      },
      attachSpeechAnalyser() {},
    };
  }

  return {
    DEFAULT_MODE,
    DEFAULT_PRESENTATION,
    PET_STATUS,
    PET_BUBBLE_LINGER_MS,
    PET_DRAG_THRESHOLD_PX,
    PET_TAP_MS,
    PET_RESET_HOLD_MS,
    PET_POSITION_KEY,
    STILL_SRC,
    PHONE_MAX_WIDTH,
    AVATAR_STATE_FOR_VOICE,
    TRANSITION,
    SPEECH,
    BLINK_SHAPE,
    EXPRESSION,
    FACE,
    MAX_DRIVEN_CAP,
    IDLE_DISMISS_MS,
    resolveAvatarMode,
    resolveAvatarPresentation,
    canRenderHolo,
    avatarStateFor,
    createMorphGuard,
    createMotion,
    createBlink,
    createExpression,
    createSpeech,
    createTransition,
    createAvatarController,
    createPetController,
    smooth,
  };
});
