// NOX hologram renderer for the KYST wall (NOX-11769, plan Phases 2-3).
// The shaders, the first-hit prepass, the screened bloom and the ground are
// the accepted Phase 1 viewer's, ported unchanged
// (projects/kyst-brand/nox-hologram-look/export/viewer/index.html). What is
// new here is the board side: framing that keeps the accepted stills'
// composition on any screen, the Night Sky v2.3 constellation stream in and
// out, and the state, speech and smile-guard drive from ./avatar.js.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const Core = globalThis.KystAvatar;
const ASSETS = {
  glb: "/avatar/assets/nox_hologram_v1.glb",
  manifest: "/avatar/assets/nox_hologram_v1.manifest.json",
  draco: "/avatar/vendor/three/draco/",
};

/* ------------------------------------------------------------------ hologram material (viewer, unchanged) */
const HOLO_VERT = `
varying vec3 vWorld; varying vec3 vNormalW; varying vec2 vUv;
#include <skinning_pars_vertex>
#include <morphtarget_pars_vertex>
void main(){
  vUv = uv;
  #include <beginnormal_vertex>
  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  vec4 wp = modelMatrix * vec4(transformed,1.0);
  vWorld = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * objectNormal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

// A term-for-term port of the LOOK01_Hologram group. It is an emission shader: the surface colour is the class
// Tint, and the source texture reaches the image through Fill x lum_factor. It writes linear radiance; AgX and the
// sRGB encode run in OutputPass.
const HOLO_FRAG = `
precision highp float;
varying vec3 vWorld; varying vec3 vNormalW; varying vec2 vUv;
uniform vec3 uOrig, uTint, uRimColor;
uniform float uTintMix, uFill, uLumMix, uAlphaMult, uRim, uRimPower, uEdge, uDiffuse, uOrigAlpha;
uniform float uFadeZ0, uFadeZ1, uClipY, uEdgeBand, uSatMask, uLevel, uExposure, uPrepass;
uniform sampler2D uMap; uniform float uHasMap;
void main(){
  // first-hit prepass (look03 T2 mode 1): only a real hologram surface in front of the ear plane blocks
  if (uPrepass > 0.5) {
    if (uOrigAlpha <= 0.5 || -vWorld.z >= uClipY) discard;
    gl_FragColor = vec4(0.0);
    return;
  }
  vec3 base = uOrig;
  if (uHasMap > 0.5) base = texture2D(uMap, vUv).rgb;
  vec3 col = mix(uTint, base, uTintMix);
  float lum = clamp(dot(base, vec3(0.2126, 0.7152, 0.0722)) * 2.2, 0.0, 1.0);
  float lumFactor = 1.0 - uLumMix * (1.0 - lum);
  float mx = max(base.r, max(base.g, base.b));
  float mn = min(base.r, min(base.g, base.b));
  float sat = mx > 0.0 ? (mx - mn) / mx : 0.0;
  float satm = clamp((sat - 0.28) * 3.0, 0.0, 1.0);
  float satE = (1.0 - uSatMask) + uSatMask * satm;
  float satA = (1.0 - uSatMask) + uSatMask * (0.25 + satm * 0.75);
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorld);
  float ndv = clamp(abs(dot(N, V)), 0.0, 1.0);
  float fres = clamp(pow(1.0 - ndv, uRimPower), 0.0, 1.0);
  // ear plane: Blender tests world_y < Clip Y on the deformed mesh. Blender y = -(three z).
  float by = -vWorld.z;
  float inside = by < uClipY ? 1.0 : 0.0;
  float edge = clamp(1.0 - clamp((uClipY - by) / uEdgeBand, 0.0, 1.0), 0.0, 1.0);
  // bottom dissolve, smoothstep on world z. Blender world z is the GLB y.
  float fz = clamp((vWorld.y - uFadeZ0) / (uFadeZ1 - uFadeZ0), 0.0, 1.0);
  float fade = fz * fz * (3.0 - 2.0 * fz);
  float eFill = uFill * lumFactor * satE;
  float eRim  = uRim * fres;
  float eEdge = uEdge * edge;
  float estr  = eFill + eRim + eEdge;
  float rimw  = clamp((eRim + eEdge) / (estr + 0.0001), 0.0, 1.0);
  vec3 ecol   = mix(col, uRimColor, rimw);
  vec3 outc = ecol * estr + col * uDiffuse * 0.6;
  float a0 = clamp(uLevel * uAlphaMult * uOrigAlpha * satA, 0.0, 1.0);
  float a1 = clamp(a0 + (1.0 - a0) * fres * 0.85, 0.0, 1.0);
  float a2 = a1 * inside * fade;
  float a3 = clamp(a2 + edge * min(uEdge, 1.0) * inside * fade * 0.6, 0.0, 1.0);
  if (a3 < 0.004) discard;
  gl_FragColor = vec4(outc * uExposure, a3);
}`;

// LOOK02_Eye, AMBER variant, as the viewer ported it. The iris colour is baked into the GLB (FIX2_Iris_OrigColor).
// The eye has no bottom dissolve of its own, so the reveal multiplies uLevel instead.
const EYE_FRAG = `
precision highp float;
varying vec3 vWorld; varying vec3 vNormalW; varying vec2 vUv;
uniform vec3 uTint, uSclera, uPupil;
uniform float uTintMix, uIrisAlpha, uIrisFill, uScleraAlpha, uScleraFill, uDiffuse, uLevel, uExposure, uPrepass;
uniform sampler2D uMap;
void main(){
  if (uPrepass > 0.5) { gl_FragColor = vec4(0.0); return; }
  vec3 base = texture2D(uMap, vUv).rgb;
  float mx = max(base.r, max(base.g, base.b));
  float mn = min(base.r, min(base.g, base.b));
  float s = mx > 0.0 ? (mx - mn) / mx : 0.0;
  float sat = clamp((s - 0.28) * 3.0, 0.0, 1.0);
  float bright = clamp((mx - 0.15) * 6.0, 0.0, 1.0);
  float pup = 1.0 - bright, satm = sat * bright, scl = (1.0 - sat) * bright;
  float aReg = (satm + pup) * uIrisAlpha + scl * uScleraAlpha;
  float a = clamp(clamp(uLevel * aReg, 0.0, 1.0), 0.0, 1.0);
  float estr = satm * uIrisFill + scl * uScleraFill;
  vec3 imix = mix(uTint, base, uTintMix);
  vec3 pmix = mix(uPupil, uSclera, bright);
  vec3 col = mix(pmix, imix, satm);
  vec3 outc = col * estr + col * uDiffuse * 0.6;
  if (a < 0.004) discard;
  gl_FragColor = vec4(outc * uExposure, a);
}`;

function eyeMaterial(ep, map, level) {
  const v3 = (a) => new THREE.Color().fromArray(a.slice(0, 3));
  const m = new THREE.ShaderMaterial({
    vertexShader: HOLO_VERT, fragmentShader: EYE_FRAG,
    transparent: true, depthWrite: false, depthTest: true, side: THREE.FrontSide, blending: THREE.NormalBlending,
    uniforms: {
      uTint: { value: v3(ep["Tint"]) }, uSclera: { value: v3(ep["Sclera Color"]) }, uPupil: { value: v3(ep["Pupil Color"]) },
      uTintMix: { value: ep["Tint Mix"] }, uIrisAlpha: { value: ep["Iris Alpha"] }, uIrisFill: { value: ep["Iris Fill"] },
      uScleraAlpha: { value: ep["Sclera Alpha"] }, uScleraFill: { value: ep["Sclera Fill"] }, uDiffuse: { value: ep["Diffuse"] },
      uLevel: { value: level }, uExposure: { value: 1.0 }, uPrepass: { value: 0 },
      uMap: { value: map },
    },
  });
  m.userData.holoClass = "iris";
  return m;
}

function holoMaterial(params, map, cls, level) {
  const c = (k) => new THREE.Color().fromArray((params[k] || [0.8, 0.8, 0.8, 1]).slice(0, 3));
  const f = (k, d) => (params[k] === undefined ? d : params[k]);
  // Cull is authoritative: look04 turned culling off on the mirrored feature cards (brows, liner, tear line)
  const cull = f("Cull", 1);
  const feature = f("Feature", 0) > 0.5;
  const m = new THREE.ShaderMaterial({
    vertexShader: HOLO_VERT, fragmentShader: HOLO_FRAG,
    transparent: true, depthWrite: false, depthTest: true,
    side: cull < 0.5 ? THREE.DoubleSide : THREE.FrontSide, blending: THREE.NormalBlending,
    polygonOffset: feature, polygonOffsetFactor: feature ? -1 : 0, polygonOffsetUnits: feature ? -4 : 0,
    uniforms: {
      uOrig: { value: c("Orig Color") }, uTint: { value: c("Tint") }, uRimColor: { value: c("Rim Color") },
      uTintMix: { value: f("Tint Mix", 0) }, uFill: { value: f("Fill", 0.5) },
      uLumMix: { value: f("Lum Mix", 0) }, uAlphaMult: { value: f("Alpha Mult", 1) },
      uRim: { value: f("Rim", 1) }, uRimPower: { value: f("Rim Power", 2) },
      uEdge: { value: f("Edge Glow", 0) }, uDiffuse: { value: f("Diffuse", 0.15) },
      uOrigAlpha: { value: f("Orig Alpha", 1) }, uSatMask: { value: f("Sat Mask", 0) },
      uFadeZ0: { value: f("Fade Z0", 1.0) }, uFadeZ1: { value: f("Fade Z1", 1.39) },
      uClipY: { value: f("Clip Y", 0.03) }, uEdgeBand: { value: 0.02 },
      uLevel: { value: level }, uExposure: { value: 1.0 }, uPrepass: { value: 0 },
      uMap: { value: map || null }, uHasMap: { value: map ? 1 : 0 },
    },
  });
  m.userData.holoClass = cls;
  m.userData.feature = feature;
  m.userData.fade = [f("Fade Z0", 1.0), f("Fade Z1", 1.39)];
  return m;
}

/* ------------------------------------------------------------------ Night Sky v2.3 constellation */
// The 40 named contour stars and edges of the KYST emblem (nightsky-chatmode-v2.html GEOMETRY), unit square.
const CONSTELLATION = {
  points: [
    [.805, .155], [.640, .072], [.430, .060], [.225, .210], [.075, .430], [.105, .700], [.330, .915], [.620, .975],
    [.944, .671], [.800, .890], [.560, .925], [.330, .820], [.165, .610], [.170, .365], [.380, .145], [.650, .080],
    [.186, .444], [.269, .452], [.269, .310], [.410, .322], [.337, .201], [.457, .249], [.538, .127], [.614, .210],
    [.688, .168], [.764, .287], [.742, .366], [.755, .446], [.742, .514], [.775, .560], [.745, .587], [.739, .624],
    [.720, .677], [.677, .688], [.616, .703], [.705, .738], [.626, .797], [.697, .866], [.656, .900], [.419, .639],
  ],
  edges: [
    [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11], [11, 12], [12, 13],
    [13, 14], [14, 15], [15, 0], [16, 17], [17, 18], [18, 19], [19, 20], [20, 21], [21, 22], [22, 23], [23, 24],
    [24, 25], [26, 27], [27, 28], [28, 29], [29, 30], [30, 31], [31, 32], [32, 33], [39, 34], [34, 35], [35, 36],
    [36, 37], [37, 38],
  ],
};
const PARTICLE_COUNT = 6200;
const CYAN = new THREE.Color("#5eeaff");
const VIOLET = new THREE.Color("#a46cff");

// v2.3's stream particle, with the point size scaled to the drawing buffer instead of v2.3's 2.1 m camera
const PARTICLE_VERT = `
attribute vec3 aTarget; attribute float aSeed;
uniform float uMorph, uTime, uPx;
varying float vSeed; varying float vMix;
void main(){
  float m = smoothstep(0.0, 1.0, uMorph);
  vec3 p = mix(position, aTarget, m);
  float arc = sin(m * 3.14159265);
  p.x += arc * sin(aSeed * 91.7 + uTime * 1.8) * .13;
  p.y += arc * sin(aSeed * 51.3 + uTime * .7) * .085;
  p.z += arc * cos(aSeed * 73.9 - uTime * .9) * .07;
  gl_PointSize = clamp((2.2 + aSeed * 2.8) * uPx, 1.2, 12.0 * uPx);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  vSeed = aSeed;
  vMix = clamp(.5 + (p.y - 1.45) * 1.3, 0.0, 1.0);
}`;
const PARTICLE_FRAG = `
uniform vec3 uCyan, uViolet; uniform float uOpacity;
varying float vSeed; varying float vMix;
void main(){
  vec2 q = gl_PointCoord - .5; float d = length(q) * 2.0; if (d > 1.0) discard;
  float core = exp(-d * d * 5.0); float halo = (1.0 - smoothstep(.18, 1.0, d)) * .32;
  gl_FragColor = vec4(mix(uViolet, uCyan, vMix) * (1.15 + vSeed * .45), (core + halo) * uOpacity);
}`;
const STAR_VERT = `
attribute float aPhase; uniform float uTime, uPx; varying float vTw;
void main(){
  vTw = .72 + .28 * sin(aPhase + uTime * (.5 + fract(aPhase) * .8));
  gl_PointSize = 13.0 * uPx;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const STAR_FRAG = `
uniform float uOpacity; varying float vTw;
void main(){
  vec2 q = gl_PointCoord - .5; float d = length(q) * 2.0; if (d > 1.0) discard;
  float core = exp(-d * d * 18.0); float halo = (1.0 - smoothstep(.1, 1.0, d)) * .45;
  gl_FragColor = vec4(mix(vec3(.63, .87, 1.0), vec3(1.0), core) * 1.4, (core + halo * .6) * uOpacity * vTw);
}`;

/* ------------------------------------------------------------------ first hit + bloom passes (viewer) */
// Two draws of the same meshes with the same vertex shader: depth only for every real hologram surface, then colour
// against it, so each pixel shades only the nearest surface. The constellation layer draws between them: it never
// writes depth, and the hologram blends over it.
class FirstHitRenderPass extends Pass {
  constructor(scene, fxScene, camera, setPass) {
    super();
    Object.assign(this, { scene, fxScene, camera, setPass });
    this.needsSwap = false;
    this.fxVisible = false;
  }
  render(renderer, writeBuffer, readBuffer) {
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.clear();
    this.setPass(true); renderer.render(this.scene, this.camera);
    if (this.fxVisible) renderer.render(this.fxScene, this.camera);
    this.setPass(false); renderer.render(this.scene, this.camera);
    renderer.autoClear = auto;
  }
}

// look09's bloom (manifest shader.bloom): display-space Gaussian, sigma = frame width / 120, x 0.35, screened. The
// blur runs in a buffer capped at 640 px. The sigma follows the accepted still's frame, not the whole screen.
const BLOOM_W = 640;
const BLUR_FRAG = `
precision highp float;
uniform sampler2D tDiffuse; uniform vec2 uDir; uniform float uSigma; varying vec2 vUv;
void main(){
  vec4 acc = vec4(0.0); float wsum = 0.0;
  int r = int(ceil(uSigma * 3.0));
  for (int i = -40; i <= 40; i++) {
    if (i < -r || i > r) continue;
    float w = exp(-0.5 * float(i * i) / (uSigma * uSigma));
    acc += texture2D(tDiffuse, vUv + uDir * float(i)) * w; wsum += w;
  }
  gl_FragColor = acc / wsum;
}`;
const SCREEN_FRAG = `
precision highp float;
uniform sampler2D tDiffuse; uniform sampler2D tGlow; uniform float uScale; varying vec2 vUv;
void main(){
  vec4 a = texture2D(tDiffuse, vUv);
  vec3 g = clamp(texture2D(tGlow, vUv).rgb * uScale, 0.0, 1.0);
  gl_FragColor = vec4(1.0 - (1.0 - clamp(a.rgb, 0.0, 1.0)) * (1.0 - g), 1.0);
}`;
const QUAD_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
class ScreenBloomPass extends Pass {
  constructor(scale) {
    super();
    const opt = { type: THREE.HalfFloatType, depthBuffer: false };
    this.rtA = new THREE.WebGLRenderTarget(BLOOM_W, BLOOM_W, opt);
    this.rtB = new THREE.WebGLRenderTarget(BLOOM_W, BLOOM_W, opt);
    this.blur = new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: BLUR_FRAG, depthTest: false,
      uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() }, uSigma: { value: BLOOM_W / 120 } } });
    this.screen = new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: SCREEN_FRAG, depthTest: false,
      uniforms: { tDiffuse: { value: null }, tGlow: { value: null }, uScale: { value: scale } } });
    this.quad = new FullScreenQuad(null);
    this.frameShare = 1;
  }
  setSize(w, h) {
    const bw = Math.min(BLOOM_W, w), bh = Math.max(1, Math.round(h * bw / w));
    this.rtA.setSize(bw, bh); this.rtB.setSize(bw, bh);
    this.blur.uniforms.uSigma.value = Math.min(13, bw * this.frameShare / 120);
  }
  render(renderer, writeBuffer, readBuffer) {
    const bw = this.rtA.width, bh = this.rtA.height;
    this.quad.material = this.blur;
    this.blur.uniforms.tDiffuse.value = readBuffer.texture; this.blur.uniforms.uDir.value.set(1 / bw, 0);
    renderer.setRenderTarget(this.rtA); this.quad.render(renderer);
    this.blur.uniforms.tDiffuse.value = this.rtA.texture; this.blur.uniforms.uDir.value.set(0, 1 / bh);
    renderer.setRenderTarget(this.rtB); this.quad.render(renderer);
    this.quad.material = this.screen;
    this.screen.uniforms.tDiffuse.value = readBuffer.texture; this.screen.uniforms.tGlow.value = this.rtB.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer); this.quad.render(renderer);
  }
}

// look09's ground as shipped (#0b0f1a under its screened bloom = (14,20,35)), as a linear pre-image of AgX (viewer)
const CLEAR_LINEAR = [0.0005396, 0.0006274, 0.001082];

/* ------------------------------------------------------------------ renderer */
export async function createHoloRenderer({ container, cameraKey = "A", reducedMotion = false, reserveRightPx = 0, assets = ASSETS } = {}) {
  if (!Core) throw new Error("avatar.js must load before holo-avatar.js");
  const canvas = document.createElement("canvas");
  canvas.className = "holo-canvas";
  // three r180 is WebGL2 only: the constructor throws without a WebGL2 context, and the wall falls back to the still
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setClearColor(new THREE.Color().setRGB(...CLEAR_LINEAR, THREE.LinearSRGBColorSpace), 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.0;

  const [manifest, gltf] = await Promise.all([
    fetch(assets.manifest).then((r) => { if (!r.ok) throw new Error(`manifest_${r.status}`); return r.json(); }),
    (() => {
      const loader = new GLTFLoader();
      const draco = new DRACOLoader();
      draco.setDecoderPath(assets.draco);
      loader.setDRACOLoader(draco);
      return loader.loadAsync(assets.glb).finally(() => draco.dispose());
    })(),
  ]);
  const guard = Core.createMorphGuard(manifest);
  const motion = Core.createMotion(manifest.motion);
  const blink = Core.createBlink(manifest.motion);
  const speech = Core.createSpeech({ jawMax: guard.cap("Jaw") });
  const transition = Core.createTransition({ reducedMotion });
  const level = manifest.shader.level ?? 0.6;
  const cam = manifest.cameras[cameraKey] || manifest.cameras.A;

  const scene = new THREE.Scene();
  const fxScene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(24, 1, 0.05, 100);
  const root = gltf.scene;
  scene.add(root);

  const holoMeshes = [];
  const morphMeshes = [];
  const bones = {};
  const rest = {};
  const rm = manifest.shader.runtime_materials || {};
  root.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
    if (!o.isMesh && !o.isSkinnedMesh) return;
    o.frustumCulled = false;
    const src = o.material && o.material.name;
    const info = rm[src] || rm["RT_" + src] || null;
    const map = (o.material && o.material.map) || null;
    if (map) { map.colorSpace = THREE.SRGBColorSpace; map.flipY = false; }
    o.material = (info && info.eye && map) ? eyeMaterial(info.eye, map, level) : holoMaterial(info ? info.params : {}, map, info ? info.class : null, level);
    // corneas, teeth and mouth interior are Transparent in look01/look02: nothing to draw and nothing that may block
    if (info && info.render === false) { o.visible = false; o.userData.hidden = true; }
    holoMeshes.push(o);
    if (o.morphTargetInfluences) morphMeshes.push(o);
  });
  for (const b of Object.values(bones)) rest[b.name] = b.quaternion.clone();

  function setPass(prepass) {
    for (const o of holoMeshes) {
      const m = o.material;
      if (o.userData.hidden) { o.visible = false; continue; }
      o.visible = !(prepass && m.userData.feature);
      m.colorWrite = !prepass;
      m.depthWrite = prepass;
      m.uniforms.uPrepass.value = prepass ? 1 : 0;
    }
  }

  /* particle targets: the figure's own vertices, in world metres, from the meshes that draw */
  root.updateMatrixWorld(true);
  const drawn = holoMeshes.filter((o) => !o.userData.hidden && o.material.userData.holoClass !== "iris");
  const counts = drawn.map((o) => o.geometry.attributes.position.count);
  const total = counts.reduce((a, b) => a + b, 0);
  const targets = new Float32Array(PARTICLE_COUNT * 3);
  const starts = new Float32Array(PARTICLE_COUNT * 3);
  const seeds = new Float32Array(PARTICLE_COUNT);
  const v = new THREE.Vector3();
  const headTop = manifest.scale.head_top;
  for (let i = 0, filled = 0; filled < PARTICLE_COUNT && i < PARTICLE_COUNT * 8; i += 1) {
    let pick = (Math.imul(i + 1, 2654435761) >>> 0) % total;
    let mi = 0;
    while (pick >= counts[mi]) { pick -= counts[mi]; mi += 1; }
    v.fromBufferAttribute(drawn[mi].geometry.attributes.position, pick).applyMatrix4(drawn[mi].matrixWorld);
    // only what the accepted framing shows: above the bottom dissolve and in front of the ear plane
    if (v.y < 1.2 || v.y > headTop + 0.02 || -v.z >= 0.03) continue;
    v.toArray(targets, filled * 3);
    seeds[filled] = (filled * 0.61803398875) % 1;
    filled += 1;
  }
  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute("position", new THREE.BufferAttribute(starts, 3));
  particleGeometry.setAttribute("aTarget", new THREE.BufferAttribute(targets, 3));
  particleGeometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
  const particleMaterial = new THREE.ShaderMaterial({
    vertexShader: PARTICLE_VERT, fragmentShader: PARTICLE_FRAG,
    uniforms: { uMorph: { value: 0 }, uOpacity: { value: 0 }, uTime: { value: 0 }, uPx: { value: 1 }, uCyan: { value: CYAN }, uViolet: { value: VIOLET } },
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  });
  const particles = new THREE.Points(particleGeometry, particleMaterial);
  particles.frustumCulled = false;

  const starPositions = new Float32Array(CONSTELLATION.points.length * 3);
  const starPhase = new Float32Array(CONSTELLATION.points.map((_, i) => (i * 2.399963) % (Math.PI * 2)));
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
  starGeometry.setAttribute("aPhase", new THREE.BufferAttribute(starPhase, 1));
  const starMaterial = new THREE.ShaderMaterial({
    vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
    uniforms: { uOpacity: { value: 0 }, uTime: { value: 0 }, uPx: { value: 1 } },
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  });
  const stars = new THREE.Points(starGeometry, starMaterial);
  stars.frustumCulled = false;
  const edgePositions = new Float32Array(CONSTELLATION.edges.length * 6);
  const edgeGeometry = new THREE.BufferGeometry();
  edgeGeometry.setAttribute("position", new THREE.BufferAttribute(edgePositions, 3));
  const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x50e7ff, transparent: true, opacity: 0, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending });
  const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
  edges.frustumCulled = false;
  fxScene.add(edges, stars, particles);

  /* framing: the accepted still's frame, contained in the screen, extended to the edges with the same ground. The
     frame keeps its composition and size; it only moves left of the chat panel's column when the two would collide,
     and shrinks only when there is no room beside the panel at all. */
  let viewW = 1, viewH = 1, frameW = 1, frameH = 1, frameCx = 0;
  const stillAspect = cam.resolution[0] / cam.resolution[1];
  function frameCamera() {
    viewW = Math.max(1, container.clientWidth || innerWidth);
    viewH = Math.max(1, container.clientHeight || innerHeight);
    frameH = Math.min(viewH, viewW / stillAspect);
    frameW = frameH * stillAspect;
    const free = Math.max(1, viewW - reserveRightPx);
    frameCx = viewW / 2;
    if (frameCx + frameW / 2 > free) frameCx = Math.max(frameW / 2, free - frameW / 2);
    if (frameCx + frameW / 2 > free) {
      frameW = free;
      frameH = frameW / stillAspect;
      frameCx = free / 2;
    }
    camera.position.fromArray(cam.three_yup.position);
    camera.quaternion.fromArray(cam.three_yup.quaternion_xyzw);
    // Blender fits the sensor horizontally: match the horizontal fov across the still's frame
    const fovx = THREE.MathUtils.degToRad(cam.fov_x_deg);
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(fovx / 2) / stillAspect));
    camera.aspect = stillAspect;
    camera.near = cam.clip[0];
    camera.far = Math.min(cam.clip[1], 200);
    // the still is a centred window of a larger virtual frame; the lens shift is a fraction of the frame width
    camera.setViewOffset(frameW, frameH,
      -(frameCx - frameW / 2) + frameW * cam.shift_x,
      -(viewH - frameH) / 2 - frameW * cam.shift_y,
      viewW, viewH);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }

  // Each of v2.3's 40 stars sits where the emblem is drawn on screen, on a plane through the face facing the camera,
  // so the stream starts exactly at the constellation and ends on the figure.
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane();
  function placeConstellation() {
    const facing = new THREE.Vector3();
    camera.getWorldDirection(facing);
    plane.setFromNormalAndCoplanarPoint(facing.clone().negate(), new THREE.Vector3(0, manifest.scale.eye_line_z, 0.02));
    const size = Math.min(frameW, frameH) * 0.78;
    const left = frameCx - size / 2, top = (viewH - size) * 0.44;
    const hit = new THREE.Vector3();
    const centres = CONSTELLATION.points.map(([px, py]) => {
      raycaster.setFromCamera({ x: (left + px * size) / viewW * 2 - 1, y: 1 - (top + py * size) / viewH * 2 }, camera);
      return raycaster.ray.intersectPlane(plane, hit) ? hit.clone() : new THREE.Vector3(0, manifest.scale.eye_line_z, 0);
    });
    centres.forEach((c, i) => c.toArray(starPositions, i * 3));
    CONSTELLATION.edges.forEach(([a, b], i) => { centres[a].toArray(edgePositions, i * 6); centres[b].toArray(edgePositions, i * 6 + 3); });
    for (let i = 0; i < PARTICLE_COUNT; i += 1) {
      const si = i % centres.length, ring = (i / centres.length) | 0;
      const angle = ring * 2.399963229728653 + si * 0.731;
      const halo = ring === 0 ? 0 : (0.28 + (ring % 7) * 0.24) * 0.0019;
      starts[i * 3] = centres[si].x + Math.cos(angle) * halo;
      starts[i * 3 + 1] = centres[si].y + Math.sin(angle) * halo;
      starts[i * 3 + 2] = centres[si].z;
    }
    starGeometry.attributes.position.needsUpdate = true;
    edgeGeometry.attributes.position.needsUpdate = true;
    particleGeometry.attributes.position.needsUpdate = true;
  }

  const firstHit = new FirstHitRenderPass(scene, fxScene, camera, setPass);
  const bloom = new ScreenBloomPass((manifest.shader.bloom && manifest.shader.bloom.scale) || 0.35);
  const composer = new EffectComposer(renderer);
  composer.addPass(firstHit);
  composer.addPass(new OutputPass());
  // after OutputPass, so the blur sees display-referred values, as the look09 composite did
  composer.addPass(bloom);

  function resize() {
    const w = container.clientWidth || innerWidth, h = container.clientHeight || innerHeight;
    if (w === viewW && h === viewH && renderer.domElement.width > 1) return;
    frameCamera();
    // 4K at most: the Phase 1 Acer bench cleared 55 fps at 2160p and nothing above it was measured
    const ratio = Math.min(devicePixelRatio || 1, 3840 / viewW, 2160 / viewH);
    renderer.setPixelRatio(ratio);
    renderer.setSize(viewW, viewH, false);
    bloom.frameShare = frameW / viewW;
    composer.setPixelRatio(ratio);
    composer.setSize(viewW, viewH);
    const px = (viewH * ratio) / 1080;
    particleMaterial.uniforms.uPx.value = px;
    starMaterial.uniforms.uPx.value = px;
    placeConstellation();
  }

  /* drive */
  let avatarState = "idle";
  // proofs only: hold the bind pose (no idle, no blink) so a frame compares with the accepted stills
  let held = false;
  let analyser = null;
  let wave = null;
  let levelScale = 1;
  let last = performance.now() / 1000;
  let running = false;
  let exitWaiters = [];
  let frames = 0;
  let lastPose = { yaw: 0, pitch: 0, sway: 0 };
  let lastMouth = { jaw: 0, press: 0, open: 0, levelDb: -Infinity, blink: 0 };
  let lastFrame = { phase: "hidden", focus: 0, reveal: 0 };
  const euler = new THREE.Euler();
  const q = new THREE.Quaternion();

  function rotBone(name, [yawDeg, pitchDeg, rollDeg]) {
    const b = bones[name];
    if (!b) return;
    euler.set(THREE.MathUtils.degToRad(pitchDeg), THREE.MathUtils.degToRad(yawDeg), THREE.MathUtils.degToRad(rollDeg), "XYZ");
    b.quaternion.copy(rest[name]).multiply(q.setFromEuler(euler));
  }

  function writeMorphs(values) {
    for (const mesh of morphMeshes) {
      const influences = mesh.morphTargetInfluences;
      influences.fill(0);
      for (const name of guard.driven) {
        const index = mesh.morphTargetDictionary[name];
        if (index !== undefined) influences[index] = guard.value(name, values[name]);
      }
    }
  }

  function tick() {
    if (!running) return;
    requestAnimationFrame(tick);
    const now = performance.now() / 1000;
    const dt = Math.min(0.05, now - last);
    last = now;
    const frame = transition.step(dt);
    if (analyser) analyser.getFloatTimeDomainData(wave);
    const mouth = speech.step(analyser ? wave : null, dt);
    const pose = motion.step(avatarState, now, dt, mouth.jaw);
    for (const [bone, angles] of Object.entries(pose.bones)) rotBone(bone, held ? [0, 0, 0] : angles);
    const blinkValue = held ? 0 : blink.step(avatarState, dt);
    writeMorphs({ Jaw: mouth.jaw, Press: mouth.press, Blink: blinkValue });

    // unavailable reads as a dimmer figure, eased
    levelScale += ((avatarState === "unavailable" ? 0.7 : 1) - levelScale) * (1 - Math.exp(-dt / 0.4));
    // the reveal is the manifest's dissolve_out run backwards: Fade Z0/Z1 travel down from above the head
    const travel = (1 - frame.reveal) * (headTop + 0.45 - 1.0);
    for (const o of holoMeshes) {
      const u = o.material.uniforms;
      // the eyes have no dissolve of their own: they arrive with the face, not ahead of it as ghost rings
      u.uLevel.value = level * levelScale * (o.material.userData.holoClass === "iris" ? Core.smooth(0.45, 1, frame.reveal) : 1);
      if (o.material.userData.fade) {
        u.uFadeZ0.value = o.material.userData.fade[0] + travel;
        u.uFadeZ1.value = o.material.userData.fade[1] + travel;
      }
    }
    particleMaterial.uniforms.uMorph.value = frame.particleMorph;
    particleMaterial.uniforms.uOpacity.value = frame.particleOpacity;
    particleMaterial.uniforms.uTime.value = now;
    starMaterial.uniforms.uOpacity.value = frame.constellation;
    starMaterial.uniforms.uTime.value = now;
    edgeMaterial.opacity = frame.constellation * 0.58;
    firstHit.fxVisible = frame.particleOpacity > 0.002 || frame.constellation > 0.002;
    container.style.setProperty("--holo-overlay", frame.overlay.toFixed(4));

    composer.render(dt);
    frames += 1;
    lastPose = pose;
    lastMouth = { ...mouth, blink: blinkValue };
    lastFrame = frame;
    if (frame.phase === "hidden") {
      running = false;
      const waiters = exitWaiters;
      exitWaiters = [];
      waiters.forEach((resolve) => resolve());
    }
  }

  function start() {
    if (running) return;
    running = true;
    last = performance.now() / 1000;
    requestAnimationFrame(tick);
  }

  container.appendChild(canvas);
  resize();
  addEventListener("resize", resize);
  // One frame at load, while the overlay is still hidden, compiles every
  // shader and uploads the GLB textures. Without it the first Ask NOX after a
  // reload opened on an 867 ms frame (Acer). A GPU that cannot draw the glow
  // targets throws here, so the controller shows the still instead.
  firstHit.fxVisible = true;
  composer.render(0);
  firstHit.fxVisible = false;

  const api = {
    enter() {
      resize();
      transition.enter();
      start();
    },
    exit() {
      if (transition.phase === "hidden") return Promise.resolve();
      transition.exit();
      start();
      return new Promise((resolve) => exitWaiters.push(resolve));
    },
    setState(state) { avatarState = state; },
    holdPose(value) { held = Boolean(value); },
    setSpeechAnalyser(node) {
      analyser = node;
      wave = node ? new Float32Array(node.fftSize) : null;
    },
    // read-only view for proofs: what the figure is doing now, in the manifest's units
    readState() {
      const nonZero = [];
      for (const mesh of morphMeshes) {
        for (const [name, index] of Object.entries(mesh.morphTargetDictionary)) {
          if (mesh.morphTargetInfluences[index] > 0 && !nonZero.includes(name)) nonZero.push(name);
        }
      }
      return {
        phase: transition.phase, state: avatarState, running, frames, camera: cameraKey,
        focus: +lastFrame.focus.toFixed(4), reveal: +lastFrame.reveal.toFixed(4),
        held,
        headYawDeg: held ? 0 : +(lastPose.yaw * 0.55).toFixed(2), headPitchDeg: held ? 0 : +(lastPose.pitch * 0.55).toFixed(2),
        bodySwayDeg: held ? 0 : +lastPose.sway.toFixed(2),
        jaw: +lastMouth.jaw.toFixed(3), press: +lastMouth.press.toFixed(3), blink: +lastMouth.blink.toFixed(3),
        // the envelope behind jaw and press: frame RMS in dBFS (null when silent) and its 0..1 openness
        levelDb: Number.isFinite(lastMouth.levelDb) ? +lastMouth.levelDb.toFixed(1) : null, open: +lastMouth.open.toFixed(3),
        speechAttached: Boolean(analyser), nonZeroMorphs: nonZero,
        frame: { viewW, viewH, frameW: +frameW.toFixed(1), frameH: +frameH.toFixed(1), frameCx: +frameCx.toFixed(1) },
        gl: renderer.getContext().getParameter(renderer.getContext().RENDERER),
      };
    },
  };
  return api;
}
