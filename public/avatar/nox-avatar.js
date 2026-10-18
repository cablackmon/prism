// NOX avatar for the KYST wall: the Nox Face / Nox Pet Family v9 clips in
// place of the 3D hologram (Cameron 2026-10-18, option A). Same renderer
// contract as holo-avatar.js (enter, exit, setState, setSpeechAnalyser), so
// avatar.js drives it unchanged. The clips are matted VP9-alpha WebMs from
// projects/nox-face/art/clips/pet/outfits/family/; idle, listening, thinking
// and wave are the hash-pinned NOX-12111 accepted set.

export const CLIP_BASE = "/avatar/nox/";
export const CLIPS_FOR_STATE = Object.freeze({
  idle: ["idle"],
  listening: ["listening"],
  thinking: ["thinking"],
  speaking: ["talk1", "talk2", "talk3"],
  unavailable: ["idle"],
});
// looped while their state lasts; everything else plays once and hands back
const LOOPED = new Set(["idle", "listening", "thinking"]);
const GREETING = "wave";
const FADE_MS = 280;
const EXIT_MS = 450;
const FIRST_FRAME_TIMEOUT_MS = 15_000;

export function clipFor(state, talkTurn = 0) {
  const clips = CLIPS_FOR_STATE[state] || CLIPS_FOR_STATE.idle;
  return clips[talkTurn % clips.length];
}

export async function createNoxRenderer({ container, reserveRightPx = 0, reducedMotion = false, base = CLIP_BASE } = {}) {
  const doc = container.ownerDocument;
  const stage = doc.createElement("div");
  stage.className = "nox-stage";
  stage.style.right = `${Math.max(0, reserveRightPx)}px`;
  const videos = new Map();
  let state = "idle";
  let playing = null;
  let talkTurn = 0;
  let entered = false;
  let exitTimer = null;

  function video(name) {
    let element = videos.get(name);
    if (element) return element;
    element = doc.createElement("video");
    element.className = "nox-clip";
    element.muted = true;
    element.defaultMuted = true;
    element.playsInline = true;
    element.setAttribute("muted", "");
    element.setAttribute("playsinline", "");
    element.disablePictureInPicture = true;
    element.preload = "auto";
    element.loop = LOOPED.has(name);
    element.dataset.clip = name;
    element.src = `${base}${name}.webm`;
    element.addEventListener("ended", () => { if (playing === name && entered) onClipEnded(name); });
    stage.appendChild(element);
    videos.set(name, element);
    return element;
  }

  // The outgoing clip stays up until the incoming one has a decoded frame, so
  // NOX never blanks mid-turn while a clip is still loading.
  function play(name) {
    const next = video(name);
    const previous = [...videos.values()].find((element) => element !== next && element.classList.contains("active"));
    playing = name;
    next.loop = LOOPED.has(name);
    // read before the rewind: a seek can drop readyState without a new loadeddata
    const hasFrame = next.readyState >= 2;
    try { next.currentTime = 0; } catch { /* not seekable yet; it starts from 0 anyway */ }
    next.play()?.catch?.(() => {});
    const swap = () => {
      if (playing !== name) return;
      next.classList.add("active");
      if (previous) {
        previous.classList.remove("active");
        setTimeout(() => { if (playing !== previous.dataset.clip) previous.pause(); }, FADE_MS + 40);
      }
    };
    if (hasFrame) swap();
    else for (const type of ["loadeddata", "playing"]) next.addEventListener(type, swap, { once: true });
  }

  function nextForState() {
    if (state === "speaking") {
      const name = clipFor("speaking", talkTurn);
      talkTurn += 1;
      return name;
    }
    return clipFor(state);
  }

  function onClipEnded(name) {
    if (LOOPED.has(name)) return;
    play(nextForState());
  }

  // The first frame of idle must decode before the wall counts this renderer
  // as ready; a failure here sends the controller to the still image.
  const first = video("idle");
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("nox_clip_timeout")), FIRST_FRAME_TIMEOUT_MS);
    const done = (fn, value) => { clearTimeout(timer); fn(value); };
    if (first.readyState >= 2) return done(resolve);
    first.addEventListener("loadeddata", () => done(resolve), { once: true });
    first.addEventListener("error", () => done(reject, new Error("nox_clip_error")), { once: true });
  });
  // warm every clip a first voice turn reaches for, so no state change stalls
  for (const name of [GREETING, "listening", "thinking", ...CLIPS_FOR_STATE.speaking]) video(name);
  container.appendChild(stage);

  return {
    enter() {
      clearTimeout(exitTimer);
      entered = true;
      talkTurn = 0;
      play(reducedMotion || (state !== "idle" && state !== "listening") ? nextForState() : GREETING);
    },
    exit() {
      entered = false;
      clearTimeout(exitTimer);
      return new Promise((resolve) => {
        exitTimer = setTimeout(() => {
          for (const element of videos.values()) { element.pause(); element.classList.remove("active"); }
          playing = null;
          resolve();
        }, EXIT_MS);
      });
    },
    setState(next) {
      const resolved = CLIPS_FOR_STATE[next] ? next : "idle";
      if (resolved === state) return;
      state = resolved;
      if (!entered) return;
      // the greeting finishes before idle or listening take over; a reply or
      // a thinking pause interrupts it, and a reply starts on the first talk clip
      if (playing === GREETING && (state === "idle" || state === "listening")) return;
      if (state === "speaking") talkTurn = 0;
      play(nextForState());
    },
    // the clips carry their own motion; nothing reads the speech level
    setSpeechAnalyser() {},
    readState() {
      return { state, clip: playing, entered, loaded: [...videos.keys()] };
    },
  };
}
