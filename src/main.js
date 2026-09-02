// ─────────────────────────────────────────────────────────────────────────────
// main.js — render thread: camera + OrbitControls, lensing pass, bloom chain,
// HUD, and controls. All physics lives in physics.worker.js; this file only
// receives transferable Float32Array snapshots and draws.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SNAPSHOT } from './state-layout.js';
import starfieldSrc from './shaders/starfield.glsl?raw';
import diskSrc from './shaders/accretion-disk.glsl?raw';
import lensingSrc from './shaders/lensing.frag?raw';
import postSrc from './shaders/post.frag?raw';

// ─── Renderer / camera / controls ────────────────────────────────────────────
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const camera = new THREE.PerspectiveCamera(
  55, // vertical FOV, degrees
  window.innerWidth / window.innerHeight,
  0.1,
  200
);
camera.position.set(0, 3.2, 26);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 4;
controls.maxDistance = 120;
controls.target.set(0, 0, 0);

// ─── Lensing pass uniforms (per-frame binary state) ──────────────────────────
const uniforms = {
  uRes: { value: new THREE.Vector2(2, 2) },
  uT: { value: 0 },
  uPos: { value: new THREE.Vector3() },
  uRt: { value: new THREE.Vector3(1, 0, 0) },
  uUp: { value: new THREE.Vector3(0, 1, 0) },
  uFw: { value: new THREE.Vector3(0, 0, -1) },
  uFov: { value: Math.tan((55 * Math.PI) / 180 / 2) },
  uSteps: { value: 160 },
  uStarSeed: { value: 42 },
  uDebugMode: { value: 0 },

  uPos1: { value: new THREE.Vector3() },
  uPos2: { value: new THREE.Vector3() },
  uPosR: { value: new THREE.Vector3() },
  uM1: { value: 0.5 },
  uM2: { value: 0.5 },
  uMR: { value: 0 },
  uPhase: { value: 0 },
  uEscapeR: { value: 80 }, // escape radius, scene units (camera-relative)

  // Disk uniforms (also declared in accretion-disk.glsl)
  uDiskTime: { value: 0 },
  uDiskIn1: { value: 0.3 },
  uDiskOut1: { value: 1.0 },
  uDiskGain1: { value: 1 },
  uTemp1: { value: 5800 },
  uDiskIn2: { value: 0.3 },
  uDiskOut2: { value: 1.0 },
  uDiskGain2: { value: 1 },
  uTemp2: { value: 5800 },
  uDiskInR: { value: 0.2 },
  uDiskOutR: { value: 3 },
  uDiskGainR: { value: 0 },
  uTempR: { value: 5800 },
};

// Assemble the lensing fragment source: substitutes the shared noise/hash/
// blackbody/starfield chunk, then the disk shading chunk.
const lensingFragment = lensingSrc
  .replace('${STARFIELD}', starfieldSrc)
  .replace('${DISK}', diskSrc);

// ─── Full-screen quad plumbing ───────────────────────────────────────────────
const FS_VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

function createPass(fragmentShader, passUniforms) {
  const scene = new THREE.Scene();
  const camera2 = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geometry = new THREE.PlaneGeometry(2, 2);
  const material = new THREE.ShaderMaterial({
    vertexShader: FS_VERTEX,
    fragmentShader,
    uniforms: passUniforms,
    depthWrite: false,
    depthTest: false,
  });
  scene.add(new THREE.Mesh(geometry, material));
  return { scene, camera: camera2, geometry, material, uniforms: passUniforms };
}

function runPass(rendererRef, pass, target) {
  rendererRef.setRenderTarget(target);
  rendererRef.render(pass.scene, pass.camera);
}

// Split the post.frag source into its three passes. Each section keeps its
// marker name as a leading token (e.g. "BRIGHT__"), so strip it off — leaving
// it in would produce invalid GLSL.
const PASS_MARKER = '//__PASS__';
const postSections = postSrc.split(PASS_MARKER);
const stripMarker = (section) => section.replace(/^[A-Z]+__/, '');
// Sections are: [preamble, BRIGHT__, BLUR__, COMPOSITE__]
const brightFrag = stripMarker(postSections[1]);
const blurFrag = stripMarker(postSections[2]);
const compositeFrag = stripMarker(postSections[3]);

// ─── Render targets ──────────────────────────────────────────────────────────
function createRT(width, height, type) {
  return new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

function selectRTType() {
  if (renderer.capabilities.isWebGL2) return THREE.HalfFloatType;
  if (
    renderer.extensions.get('OES_texture_half_float') &&
    renderer.extensions.get('OES_texture_half_float_linear')
  ) {
    return THREE.HalfFloatType;
  }
  return THREE.UnsignedByteType;
}

const targetType = selectRTType();
let width = 2;
let height = 2;
let sceneTarget = createRT(width, height, targetType);
let halfA = createRT(width, height, targetType);
let halfB = createRT(width, height, targetType);
let quarterA = createRT(width, height, targetType);
let quarterB = createRT(width, height, targetType);

// ─── Pass materials ──────────────────────────────────────────────────────────
const lensingPass = createPass(lensingFragment, uniforms);

const brightPass = createPass(brightFrag, {
  tex: { value: null },
  uThresh: { value: 0.85 },
});
const blurPass = createPass(blurFrag, {
  tex: { value: null },
  uDir: { value: new THREE.Vector2() },
});
const compositePass = createPass(compositeFrag, {
  tScene: { value: sceneTarget.texture },
  tB1: { value: null },
  tB2: { value: null },
  uExp: { value: 1.15 },
  uBloom: { value: 1.0 },
  uTn: { value: 0 },
  uRes2: { value: new THREE.Vector2(2, 2) },
});

// ─── Worker wiring ─────────────────────────────────────────.js ─────────────
const worker = new Worker(new URL('./physics.worker.js', import.meta.url), {
  type: 'module',
});

let latest = null;
worker.onmessage = (e) => {
  latest = e.data; // Float32Array snapshot, transferred zero-copy
};

function sendToWorker(msg) {
  worker.postMessage(msg);
}

// ─── DOM refs ────────────────────────────────────────────────────────────────
const el = (id) => document.getElementById(id);
const dom = {
  phaseBadge: el('phase-badge'),
  model: el('hud-model'),
  timeScaleRo: el('hud-time-scale-ro'),
  coalescencePct: el('coalescence-pct'),
  coalescenceFill: el('coalescence-fill'),
  coalescenceMarker: el('coalescence-marker'),
  sep: el('m-sep'),
  sepSub: el('m-sep-sub'),
  fgw: el('m-fgw'),
  fgwSub: el('m-fgw-sub'),
  vorb: el('m-vorb'),
  vorbSub: el('m-vorb-sub'),
  tc: el('m-tc'),
  tcSub: el('m-tc-sub'),
  strain: el('m-strain'),
  strainSub: el('m-strain-sub'),
  chirp: el('m-chirp'),
  chirpSub: el('m-chirp-sub'),
  erad: el('m-erad'),
  eradSub: el('m-erad-sub'),
  lum: el('m-lum'),
  lumSub: el('m-lum-sub'),
  rem: el('m-rem'),
  remSub: el('m-rem-sub'),
  spin: el('m-spin'),
  spinSub: el('m-spin-sub'),
  simtime: el('m-simtime'),
  simtimeSub: el('m-simtime-sub'),
  timescale: el('m-timescale'),
  timescaleSub: el('m-timescale-sub'),
  horizons: el('m-horizons'),
  horizonsSub: el('m-horizons-sub'),
  orbits: el('m-orbits'),
  orbitsSub: el('m-orbits-sub'),
  chirpCanvas: el('chirp-canvas'),
  chirpStart: el('chirp-start'),
  chirpEnd: el('chirp-end'),
  chirpYTop: el('chirp-y-top'),
  chirpYMid: el('chirp-y-mid'),
  chirpYBot: el('chirp-y-bot'),
  chirpNowH: el('chirp-now-h'),
  chirpNowF: el('chirp-now-f'),
  chirpMergerX: el('chirp-merger-x'),
  mergerEvent: el('merger-event'),
  mergerEventTime: el('merger-event-time'),
  mergerClose: el('merger-event-close'),
  mergerExport: el('merger-export'),
  meFgw: el('me-fgw'),
  meStrain: el('me-strain'),
  meLum: el('me-lum'),
  meVorb: el('me-vorb'),
  meSep: el('me-sep'),
  meErad: el('me-erad'),
  meEradTotal: el('me-erad-total'),
  meRem: el('me-rem'),
  meSpin: el('me-spin'),
  meFqnm: el('me-fqnm'),
  meTau: el('me-tau'),
  meBandTime: el('me-bandtime'),
};

// ─── Formatting helpers ───────────────────────────────────────────────────────
function fmt(value, digits = 2, unit = '') {
  if (!Number.isFinite(value)) return '—';
  const mag = Math.abs(value);
  if (mag >= 1e4 || (mag < 1e-2 && mag > 0)) {
    return `${value.toExponential(digits)}${unit}`;
  }
  return `${value.toFixed(digits)}${unit}`;
}

function fmtSci(value, digits = 2, unit = '') {
  if (!Number.isFinite(value) || value === 0) return '—';
  return `${value.toExponential(digits)}${unit}`;
}

// Human-readable duration across the full physical range this sim spans:
// microseconds (orbital period at contact) → years (long time scales).
// Always shows the exact leading unit plus a descriptive follow-up so the
// user never has to guess what "0.23 s" means relative to the event.
function fmtDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 1e-3) return `${(seconds * 1e6).toFixed(1)} μs`;
  if (seconds < 1) return `${(seconds * 1e3).toFixed(2)} ms`;
  if (seconds < 60) return `${seconds.toFixed(2)} s`;
  const minutes = Math.floor(seconds / 60);
  const s = seconds - minutes * 60;
  if (minutes < 60) return `${minutes}m ${s.toFixed(0)}s`;
  const hours = Math.floor(minutes / 60);
  const m = minutes - hours * 60;
  if (hours < 24) return `${hours}h ${m}m`;
  const days = Math.floor(hours / 24);
  const h = hours - days * 24;
  if (days < 30) return `${days}d ${h}h`;
  const months = Math.floor(days / 30.44);
  const d = days - months * 30.44;
  if (months < 12) return `${months}mo ${d.toFixed(0)}d`;
  const years = Math.floor(months / 12);
  const mo = months - years * 12;
  if (years < 1e4) return `${years}y ${mo}mo`;
  return `${(seconds / 3.156e7).toExponential(2)} yr`; // beyond 10k years
}

// Descriptive companion for fmtDuration: says what the number actually means.
function fmtDurationDesc(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  if (seconds < 1e-3) return 'light crosses the system ~1000×';
  if (seconds < 0.1) return 'final plunge timescale';
  if (seconds < 1) return 'sub-second merger regime';
  if (seconds < 10) return 'slowed for viewing';
  if (seconds < 60) return 'under a minute';
  if (seconds < 3600) return `${(seconds / 60).toFixed(0)} minutes total`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} hours total`;
  if (seconds < 2.63e6) return `${(seconds / 86400).toFixed(1)} days total`;
  if (seconds < 3.156e7) return `${(seconds / 2.63e6).toFixed(1)} months total`;
  return `${(seconds / 3.156e7).toFixed(1)} years total`;
}

const PHASE_LABELS = ['INSPIRAL', 'MERGER', 'RINGDOWN', 'REMNANT'];

// ─── HUD update (throttled to ~10 Hz) ────────────────────────────────────────
let lastHudUpdate = 0;

// Chirp-envelope chart ring buffer: { t, h, f } samples of the inspiral.
const CHIRP_MAX_SAMPLES = 600;
const chirpHistory = [];
let chirpMaxH = 1e-30; // running max strain for chart normalization

function updateHud(s) {
  const phase = s[SNAPSHOT.PHASE];
  dom.phaseBadge.textContent = PHASE_LABELS[phase] || 'INSPIRAL';
  dom.phaseBadge.dataset.phase = String(phase);

  // Merger event capture: freeze the full data record at the impact moment.
  trackPreMergerPeaks(s);
  checkMergerCapture(s);

  // Model line + time scale in the subtitle.
  dom.model.textContent = `M₁ ${fmtMass(sliderToMass(ctrlM1.value))} + M₂ ${fmtMass(sliderToMass(ctrlM2.value))}`;
  dom.timeScaleRo.textContent = `${timeScaleUI >= 1 ? timeScaleUI.toFixed(0) : timeScaleUI.toFixed(3)}× time`;

  // Coalescence progress: whole-run fraction from inspiral start → merged.
  // RUN_PROGRESS is time-linear through the inspiral (1 − (r/r₀)⁴), with the
  // final 15% reserved for the merger envelope — so the bar moves visibly
  // from the first frame instead of jumping 0→100 only at contact.
  const progress = s[SNAPSHOT.RUN_PROGRESS] ?? s[SNAPSHOT.MERGER_PROGRESS];
  const pct = (progress * 100).toFixed(1);
  dom.coalescencePct.textContent = `${pct}%`;
  dom.coalescenceFill.style.width = `${pct}%`;

  // Separation + descriptive companion: AU for supermassive binaries (Sgr A*
  // starts at ~1.4 AU), Mars–Sun multiples for stellar ones.
  dom.sep.textContent = fmtKm(s[SNAPSHOT.SEP_KM]);
  const au = s[SNAPSHOT.SEP_KM] / 1.496e8; // 1 AU = 1.496e8 km
  dom.sepSub.textContent =
    au >= 0.01 ? `${fmt(au, 2, ' AU')}` : `${fmt(s[SNAPSHOT.SEP_KM] / 6779, 1, '× Mars–Sun')}`;

  // GW frequency + where it sits relative to the detection bands.
  // Stellar-mass binaries chirp through LIGO (10–10³ Hz); supermassive
  // binaries like Sgr A* chirp in the µHz–mHz LISA band instead.
  const fgw = s[SNAPSHOT.F_GW];
  dom.fgw.textContent = fgw >= 1 ? fmt(fgw, 1, ' Hz') : fmtSci(fgw, 2, ' Hz');
  if (fgw < 1e-4) dom.fgwSub.textContent = 'below LISA band (<0.1 mHz)';
  else if (fgw < 1e-3) dom.fgwSub.textContent = 'LISA low band';
  else if (fgw < 0.1) dom.fgwSub.textContent = 'LISA sensitive band (mHz)';
  else if (fgw < 10) dom.fgwSub.textContent = 'below LIGO band';
  else if (fgw < 100) dom.fgwSub.textContent = 'in LIGO low band';
  else if (fgw < 1000) dom.fgwSub.textContent = 'LIGO sensitive band';
  else dom.fgwSub.textContent = 'ringdown frequencies';

  // Orbital speed as % c + descriptive companion (Milky Way escape, Sun's orbit).
  const v = s[SNAPSHOT.V_ORB];
  dom.vorb.textContent = fmt(v * 100, 1, '% c');
  dom.vorbSub.textContent =
    v > 0.5 ? 'strongly relativistic'
      : v > 0.25 ? 'relativistic regime'
        : v > 0.1 ? 'faster than any star in the galaxy'
          : v > 0 ? `${fmt(v * 299792, 0, ' km/s')}`
            : 'plunge complete';

  // Time to coalescence: leading unit + descriptive line.
  const tc = s[SNAPSHOT.T_C];
  if (tc > 0) {
    dom.tc.textContent = fmtDuration(tc);
    dom.tcSub.textContent = fmtDurationDesc(tc);
  } else {
    dom.tc.textContent = 'MERGED';
    dom.tcSub.textContent = 'coalescence complete';
  }

  // Strain + a physical anchor: how much an interferometer arm stretches.
  // The Milky-Way-center run is shown at the Sgr A* distance (8 kpc ≈ 26k ly)
  // instead of GW150914's 410 Mpc, since that is where such a merger would be.
  const h = s[SNAPSHOT.STRAIN];
  dom.strain.textContent = fmtSci(h, 2, '');
  const totalMNow = sliderToMass(ctrlM1.value) + sliderToMass(ctrlM2.value);
  const isSmbh = totalMNow >= 1e5;
  dom.strainSub.textContent =
    h > 0
      ? isSmbh
        ? `ΔL/L — ${fmtSci(h * 2.47e17, 2, ' m over 8 kpc (Sgr A*)')}`
        : `ΔL/L — ${fmtSci(h * 410e6, 2, ' m over 410 Mpc')}`
      : '—';

  // Chirp mass + mass ratio context.
  dom.chirp.textContent = s[SNAPSHOT.CHIRP_MASS] >= 1e4 ? fmtMass(s[SNAPSHOT.CHIRP_MASS]) : fmt(s[SNAPSHOT.CHIRP_MASS], 2, ' M☉');
  const ratio = sliderToMass(ctrlM1.value) / sliderToMass(ctrlM2.value);
  dom.chirpSub.textContent = `q = ${fmt(ratio, 2)} mass ratio`;

  // Energy radiated + descriptive comparison.
  const erad = s[SNAPSHOT.E_RAD];
  dom.erad.textContent = erad >= 1e4 ? fmtMass(erad) : fmt(erad, 3, ' M☉c²');
  // Sun's total lifetime output ≈ 0.007 M☉c² (0.7% fusion efficiency).
  // For supermassive runs this comparison can exceed a galaxy of stars —
  // cap the descriptor to scientific notation so it stays readable.
  const sunsEq = erad / 0.007;
  dom.eradSub.textContent =
    erad > 0
      ? sunsEq >= 1e6
        ? `≈ ${fmtSci(sunsEq, 2, ' Suns (lifetime)')}`
        : `≈ ${fmt(sunsEq, 0, ' Suns (lifetime)')}`
      : '—';

  // GW luminosity + comparison to the entire observable universe.
  const lum = s[SNAPSHOT.GW_LUMINOSITY];
  dom.lum.textContent = lum > 0 ? fmtSci(lum, 2, ' M☉c²/s') : '—';
  // All stars shine ~1e49 W ≈ 56 M☉c²/s (1 M☉c² = 1.79e47 J); GW150914 peaked
  // at 3.6e49 W ≈ 200 M☉c²/s — ~3.6× every star in the universe combined.
  const ALL_STARLIGHT = 56; // M☉c²/s
  dom.lumSub.textContent =
    lum > ALL_STARLIGHT ? `outshines every star in the universe`
      : lum > 0 ? `${fmtSci(lum / ALL_STARLIGHT, 1, '× all starlight')}`
        : '—';

  // Remnant mass + mass lost to gravitational waves.
  const rem = s[SNAPSHOT.M_REMNANT];
  dom.rem.textContent = rem > 0 ? fmtMass(rem) : '—';
  dom.remSub.textContent =
    rem > 0 ? `${fmtMass(sliderToMass(ctrlM1.value) + sliderToMass(ctrlM2.value) - rem)} lost as GWs` : 'awaiting merger';

  // Final spin + descriptive context.
  const spin = s[SNAPSHOT.REMNANT_SPIN];
  dom.spin.textContent = spin > 0 ? fmt(spin, 3) : '—';
  dom.spinSub.textContent =
    spin > 0.9 ? 'near-extremal Kerr'
      : spin > 0.6 ? 'rapidly rotating'
        : spin > 0 ? 'moderately rotating'
          : 'awaiting merger';

  // Sim time (physical) + descriptive duration line.
  const simtime = s[SNAPSHOT.SIM_TIME];
  dom.simtime.textContent = fmtDuration(simtime);
  dom.simtimeSub.textContent = fmtDurationDesc(simtime);

  // Time scale + what it means in practice.
  dom.timescale.textContent = timeScaleUI >= 1 ? `${timeScaleUI.toFixed(0)}×` : `${timeScaleUI.toFixed(3)}×`;
  // The scale maps wall seconds → physical seconds: <1 is slow-motion detail,
  // >1 is fast-forward (supermassive runs need ~10³–10⁴× to fit days into a
  // watchable span).
  dom.timescaleSub.textContent =
    timeScaleUI >= 1000 ? `1 real second = ${(timeScaleUI / 1000).toFixed(1)}k sim seconds`
      : timeScaleUI >= 1 ? `1 real second = ${timeScaleUI.toFixed(0)} sim seconds`
        : timeScaleUI > 0 ? `1 real second = ${(1 / timeScaleUI).toFixed(0)} sim seconds`
          : 'frozen (scale = 0)';

  // Horizon radii + a size comparison anchor (Sun radii for stellar masses,
  // AU for supermassive ones like Sgr A*).
  dom.horizons.textContent = `${fmtKm(s[SNAPSHOT.HORIZON_KM1])} / ${fmtKm(
    s[SNAPSHOT.HORIZON_KM2])}`;
  const rSun = 696340; // Sun radius, km
  const combinedKm = s[SNAPSHOT.HORIZON_KM1] + s[SNAPSHOT.HORIZON_KM2];
  dom.horizonsSub.textContent =
    s[SNAPSHOT.HORIZON_KM1] > 0
      ? combinedKm >= 1.496e8 * 0.01 // >1% of an AU ⇒ express in AU
        ? `combined ≈ ${fmt(combinedKm / 1.496e8, 2, ' AU')}`
        : `combined ≈ ${fmt(combinedKm / rSun, 2, '× Sun radius')}`
      : '—';

  // Orbits remaining until coalescence (from f_GW: N = f_orb × T_c).
  const fOrb = fgw / 2;
  const orbits = fOrb * tc;
  if (orbits > 0) {
    dom.orbits.textContent = fmtSci(orbits, 2, '');
    dom.orbitsSub.textContent = 'GW cycles until contact';
  } else {
    dom.orbits.textContent = '0';
    dom.orbitsSub.textContent = 'coalescence complete';
  }

  // Push a chirp-envelope sample for the chart (time → strain + frequency).
  if (chirpHistory.length === 0 || chirpHistory[chirpHistory.length - 1].t < simtime - 0.02) {
    chirpHistory.push({ t: simtime, h, f: fgw });
    chirpMaxH = Math.max(chirpMaxH, h);
    if (chirpHistory.length > CHIRP_MAX_SAMPLES) chirpHistory.shift();
    drawChirpChart();
  }

  // Chart time labels.
  dom.chirpStart.textContent = chirpHistory.length
    ? fmtDuration(chirpHistory[0].t)
    : '—';
  dom.chirpEnd.textContent = fmtDuration(simtime);
}

// ─── Merger event capture: full data frozen at the impact moment ─────────────
// The worker reaches PHASE ≥ 2 exactly at horizon contact (its first phase-2
// snapshot carries the contact values: clamped separation, peak strain,
// mergerSetup's remnant parameters). We fire on ANY transition into phase ≥ 2
// rather than the exact 1→2 sample edge — the merger envelope lasts only a
// fraction of the HUD's 10 Hz sampling interval, so requiring a phase-1
// sample would usually miss the moment entirely.
let lastPhaseSeen = -1;
let captureArmed = true; // re-armed on restart so a new run can capture again
let mergerCapture = null; // frozen full-data record at contact
let mergerCaptureX = null; // chart x-position of the merger, css px

// Running peaks through the inspiral: the worker zeroes V_ORB/F_GW after
// contact, so the impact-moment values must be tracked while approaching.
let peakVOrb = 0; // peak relative orbital speed, v/c
let peakFGw = 0; // peak GW frequency, Hz
let peakStrain = 0; // peak strain amplitude
let peakLum = 0; // peak GW luminosity, M☉c²/s

function trackPreMergerPeaks(s) {
  if (s[SNAPSHOT.PHASE] > 1) return;
  peakVOrb = Math.max(peakVOrb, s[SNAPSHOT.V_ORB]);
  peakFGw = Math.max(peakFGw, s[SNAPSHOT.F_GW]);
  peakStrain = Math.max(peakStrain, s[SNAPSHOT.STRAIN]);
  peakLum = Math.max(peakLum, s[SNAPSHOT.GW_LUMINOSITY]);
}

function checkMergerCapture(s) {
  const phase = s[SNAPSHOT.PHASE];
  const prev = lastPhaseSeen;
  lastPhaseSeen = phase;

  // A fresh run (restart/preset) drops the phase back below 2: re-arm and
  // retire the previous capture so each run can capture its own moment.
  if (phase < 2 && prev >= 2) {
    captureArmed = true;
    mergerCapture = null;
    mergerCaptureX = null;
    peakVOrb = 0;
    peakFGw = 0;
    peakStrain = 0;
    peakLum = 0;
    dom.mergerEvent.hidden = true;
    dom.chirpMergerX.style.display = 'none';
  }

  if (!captureArmed || phase < 2) return; // fire once, at first contact
  captureArmed = false;

  const tLigoEntry = chirpHistory.find((p) => p.f >= 10)?.t ?? 0;
  mergerCapture = {
    event: 'binary black hole merger — horizon contact',
    capturedAt: new Date().toISOString(),
    system: {
      m1_solar: sliderToMass(ctrlM1.value),
      m2_solar: sliderToMass(ctrlM2.value),
      total_mass_solar: sliderToMass(ctrlM1.value) + sliderToMass(ctrlM2.value),
      chirp_mass_solar: s[SNAPSHOT.CHIRP_MASS],
      mass_ratio_q: sliderToMass(ctrlM1.value) / sliderToMass(ctrlM2.value),
    },
    moment: {
      sim_time_s: s[SNAPSHOT.SIM_TIME],
      separation_km: s[SNAPSHOT.SEP_KM],
      // Peaks tracked through the inspiral — the worker reports zeros for
      // these after contact, but the impact moment holds their maxima.
      orbital_speed_frac_c: peakVOrb,
      gw_frequency_hz: peakFGw,
      strain_h_at_410mpc: peakStrain,
      gw_luminosity_msun_c2_per_s: peakLum,
      energy_radiated_to_contact_msun_c2: s[SNAPSHOT.E_RAD],
      time_in_ligo_band_s: s[SNAPSHOT.SIM_TIME] - tLigoEntry,
    },
    remnant: {
      mass_solar: s[SNAPSHOT.M_REMNANT],
      final_spin_chi: s[SNAPSHOT.REMNANT_SPIN],
      ringdown_f22_hz: s[SNAPSHOT.F_RINGDOWN],
      ringdown_tau_s: s[SNAPSHOT.STRAIN_TAU],
      energy_radiated_total_msun_c2: s[SNAPSHOT.E_RAD],
      horizon_km: 2 * s[SNAPSHOT.M_REMNANT] * 1.476625,
    },
  };

  // Pin the marker at the merger time on the chart's current time axis.
  // (The chart is drawn with t0 = first history sample → last sample; the
  // marker stores the capture time and re-derives its pixel position each
  // redraw, so it stays glued to the merger instant as the axis advances.)
  mergerCaptureX = s[SNAPSHOT.SIM_TIME];

  fillMergerPanel();
  dom.mergerEvent.hidden = false;
}

function fillMergerPanel() {
  if (!mergerCapture) return;
  const m = mergerCapture.moment;
  const rem = mergerCapture.remnant;
  dom.mergerEventTime.textContent = `t = ${fmtDuration(m.sim_time_s)} — physical time of contact`;
  dom.meFgw.textContent = fmt(m.gw_frequency_hz, 1, ' Hz');
  dom.meStrain.textContent = m.strain_h_at_410mpc.toExponential(2);
  dom.meLum.textContent = `${fmtSci(m.gw_luminosity_msun_c2_per_s, 2, ' M☉c²/s')}`;
  dom.meVorb.textContent = fmt(m.orbital_speed_frac_c * 100, 1, '% c');
  dom.meSep.textContent = fmt(m.separation_km, 1, ' km');
  dom.meErad.textContent = fmt(m.energy_radiated_to_contact_msun_c2, 3, ' M☉c²');
  dom.meEradTotal.textContent = fmt(rem.energy_radiated_total_msun_c2, 3, ' M☉c²');
  dom.meRem.textContent = fmtMass(rem.mass_solar);
  dom.meSpin.textContent = fmt(rem.final_spin_chi, 3);
  dom.meFqnm.textContent = fmt(rem.ringdown_f22_hz, 1, ' Hz');
  dom.meTau.textContent = fmtDuration(rem.ringdown_tau_s);
  dom.meBandTime.textContent = fmtDuration(m.time_in_ligo_band_s);
}

dom.mergerClose?.addEventListener('click', () => {
  dom.mergerEvent.hidden = true;
});

dom.mergerExport?.addEventListener('click', () => {
  if (!mergerCapture) return;
  const blob = new Blob([JSON.stringify(mergerCapture, null, 2)], {
    type: 'application/json',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `merger-capture-${mergerCapture.system.m1_solar}+${mergerCapture.system.m2_solar}Msun.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

// ─── Chirp chart rendering (2D canvas, ~10 Hz) ──────────────────────────────
// The frequency axis is LOG-scaled with its bottom pinned near the LIGO band
// floor (10 Hz), so the decade gridlines read as real frequency values. The
// strain envelope rides its own normalized scale underneath; both traces share
// the time axis. Endpoint dots + live labels indicate the current values.
const CHART_FLOOR_HZ = 10; // LIGO band floor, Hz — the y=bottom gridline value

function drawChirpChart() {
  const c = dom.chirpCanvas;
  if (!c) return;
  const ctx = c.getContext('2d');

  // DPR-sharp canvas: backing store = element size × device pixel ratio.
  const cssW = c.clientWidth || 300;
  const cssH = c.clientHeight || 84;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (c.width !== Math.round(cssW * dpr) || c.height !== Math.round(cssH * dpr)) {
    c.width = Math.round(cssW * dpr);
    c.height = Math.round(cssH * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = cssW;
  const h = cssH;
  ctx.clearRect(0, 0, w, h);

  if (chirpHistory.length < 2) return;

  // Time normalization: first sample → last sample across the full width.
  const t0 = chirpHistory[0].t;
  const t1 = chirpHistory[chirpHistory.length - 1].t;
  const tSpan = Math.max(t1 - t0, 1e-9);

  // Frequency normalization — LOG scale. The minimum is Math.min over the
  // samples floored near the LIGO band entry; the top is rounded up to the
  // next power of ten so gridlines land on round decade values. (This was
  // previously Math.max, which pinned the "minimum" to the largest sample and
  // collapsed the frequency trace into an invisible flat line at the bottom.)
  const fObsMin = Math.min(...chirpHistory.map((p) => p.f));
  const fObsMax = Math.max(...chirpHistory.map((p) => p.f));
  const fBot = Math.min(CHART_FLOOR_HZ, fObsMin * 0.9);
  const fTopPow = Math.pow(10, Math.ceil(Math.log10(fObsMax * 1.25)));
  const logBot = Math.log10(fBot);
  const logTop = Math.log10(fTopPow);
  // y for a frequency on the log axis (clamped into the plot box).
  const fY = (f) =>
    h - 4 - ((Math.log10(Math.max(f, fBot)) - logBot) / (logTop - logBot)) * (h - 10);

  // ── Decade gridlines ─────────────────────────────────────────────────────
  ctx.lineWidth = 1;
  for (let d = Math.ceil(logBot); d <= Math.floor(logTop); d += 1) {
    const fv = Math.pow(10, d); // gridline frequency, Hz
    const y = fY(fv);
    if (y < 3 || y > h - 3) continue;
    ctx.strokeStyle = 'rgba(120, 200, 255, 0.10)';
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // ── Strain envelope (own normalized scale) ────────────────────────────────
  const hY = (hv) => h - 4 - (hv / chirpMaxH) * (h - 14) * 0.92;
  const strainPts = chirpHistory.map((p) => ({
    x: ((p.t - t0) / tSpan) * w,
    y: hY(p.h),
  }));

  // Filled area under the envelope.
  ctx.beginPath();
  strainPts.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.lineTo(strainPts[strainPts.length - 1].x, h);
  ctx.lineTo(strainPts[0].x, h);
  ctx.closePath();
  ctx.fillStyle = 'rgba(127, 212, 255, 0.18)';
  ctx.fill();

  // Envelope stroke.
  ctx.beginPath();
  strainPts.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.strokeStyle = 'rgba(127, 212, 255, 0.9)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // ── Frequency trace (log scale) ──────────────────────────────────────────
  const freqPts = chirpHistory.map((p) => ({
    x: ((p.t - t0) / tSpan) * w,
    y: fY(p.f),
  }));
  ctx.beginPath();
  freqPts.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.strokeStyle = 'rgba(255, 209, 102, 0.85)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // ── "Now" markers: endpoint dot on each trace ────────────────────────────
  const lastStrain = strainPts[strainPts.length - 1];
  const lastFreq = freqPts[freqPts.length - 1];
  ctx.fillStyle = 'rgba(127, 212, 255, 1.0)';
  ctx.beginPath();
  ctx.arc(lastStrain.x, lastStrain.y, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 209, 102, 1.0)';
  ctx.beginPath();
  ctx.arc(lastFreq.x, lastFreq.y, 2.5, 0, Math.PI * 2);
  ctx.fill();

  // ── Indicators: axis labels + live endpoint values ───────────────────────
  dom.chirpYTop.textContent = `${fmtFreqLabel(fTopPow)} Hz`;
  const midDecade = Math.pow(10, Math.round((logBot + logTop) / 2));
  dom.chirpYMid.textContent =
    midDecade >= 10 && midDecade < fTopPow ? `${fmtFreqLabel(midDecade)} Hz` : '';
  dom.chirpYBot.textContent = `${fmtFreqLabel(fBot)} Hz`;

  // Live "now" values, vertically pinned to their trace endpoints.
  const last = chirpHistory[chirpHistory.length - 1];
  dom.chirpNowH.textContent = `h ${last.h.toExponential(1)}`;
  dom.chirpNowF.textContent = `${fmtFreqLabel(last.f)} Hz`;
  dom.chirpNowH.style.top = `${Math.max(2, Math.min(lastStrain.y - 9, cssH - 14))}px`;
  dom.chirpNowF.style.top = `${Math.max(2, Math.min(lastFreq.y - 9, cssH - 14))}px`;

  // ── Merger moment marker: a permanent indicator at the capture instant ──
  // Position is re-derived from the captured SIM_TIME each redraw, so the
  // marker stays glued to the merger as the time axis scrolls onward.
  if (mergerCaptureX !== null) {
    const mx = ((mergerCaptureX - t0) / tSpan) * w;
    if (mx >= 0 && mx <= w) {
      // Vertical line across the full plot height.
      ctx.strokeStyle = 'rgba(255, 122, 156, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(mx, 0);
      ctx.lineTo(mx, h);
      ctx.stroke();
      ctx.setLineDash([]);
      // The DOM label element is positioned to the same x.
      dom.chirpMergerX.style.left = `${mx}px`;
      dom.chirpMergerX.style.display = 'block';
    } else {
      dom.chirpMergerX.style.display = 'none';
    }
  }
}

// Compact frequency label for gridlines: 10 → "10", 1000 → "1k".
function fmtFreqLabel(f) {
  if (f >= 1e4) return `${(f / 1e3).toFixed(0)}k`;
  if (f >= 1000) return `${(f / 1e3).toFixed(f % 1e3 === 0 ? 0 : 1)}k`;
  return `${f.toFixed(0)}`;
}

// ─── Uniform update from snapshot ─────────────────────────────────────────────
function applySnapshot(s) {
  uniforms.uPhase.value = s[SNAPSHOT.PHASE];

  // Hole positions: worker (x, z) → world (x, 0, z) in the y=0 plane.
  uniforms.uPos1.value.set(s[SNAPSHOT.X1], 0, s[SNAPSHOT.Y1]);
  uniforms.uPos2.value.set(s[SNAPSHOT.X2], 0, s[SNAPSHOT.Y2]);
  uniforms.uPosR.value.set(s[SNAPSHOT.X_REM], 0, s[SNAPSHOT.Y_REM]);

  // Hole masses (scene units) — the remnant IS hole 1 after the merger.
  uniforms.uM1.value = s[SNAPSHOT.M1_SCENE];
  uniforms.uM2.value = s[SNAPSHOT.M2_SCENE];
  uniforms.uMR.value = s[SNAPSHOT.REMNANT_MASS_SCENE]; // disk shading only!

  // Disk state.
  uniforms.uDiskTime.value = s[SNAPSHOT.DISK_TIME];
  uniforms.uDiskIn1.value = s[SNAPSHOT.DISK_IN1];
  uniforms.uDiskOut1.value = s[SNAPSHOT.DISK_OUT1];
  uniforms.uDiskGain1.value = s[SNAPSHOT.DISK_GAIN1];
  uniforms.uDiskIn2.value = s[SNAPSHOT.DISK_IN2];
  uniforms.uDiskOut2.value = s[SNAPSHOT.DISK_OUT2];
  uniforms.uDiskGain2.value = s[SNAPSHOT.DISK_GAIN2];
  uniforms.uDiskInR.value = s[SNAPSHOT.DISK_IN_R];
  uniforms.uDiskOutR.value = s[SNAPSHOT.DISK_OUT_R];
  uniforms.uDiskGainR.value = s[SNAPSHOT.DISK_GAIN_R];
}

// ─── Derived-mass descriptors (horizon + ISCO in km) ─────────────────────
// 1 M☉ in geometric length = 1.4766 km; Schwarzschild horizon r_s = 2M and
// ISCO = 6M, each in units of the hole's own mass.
const GEO_KM_CTRL = 1.476625; // km per GM☉/c²

function horizonKm(mSun) {
  return 2 * mSun * GEO_KM_CTRL;
}

function iscoKm(mSun) {
  return 6 * mSun * GEO_KM_CTRL;
}

function fmtKm(km) {
  if (km >= 9.46e12) return `${(km / 9.46e12).toFixed(1)} ly`; // light-years
  if (km >= 1.496e8) return `${(km / 1.496e8).toFixed(1)} AU`; // astronomical units
  if (km >= 1e6) return `${(km / 1e6).toFixed(1)}M km`; // millions of km
  if (km >= 1e3) return `${(km / 1e3).toFixed(km >= 1e4 ? 0 : 1)}k km`;
  return `${km.toFixed(0)} km`;
}

// Mass formatting across 3 M☉ → 10⁷ M☉: stellar masses read as-is, and
// supermassive masses read in scientific or compact notation.
function fmtMass(mSun) {
  if (mSun >= 1e6) return `${(mSun / 1e6).toFixed(2)}M M☉`; // e.g. 4.30M M☉
  if (mSun >= 1e4) return `${(mSun / 1e3).toFixed(0)}k M☉`;
  return `${mSun.toFixed(mSun < 10 ? 1 : 0)} M☉`;
}

// Log-scale mass sliders: slider 0 → 3 M☉, slider 1000 → 10⁷ M☉.
// v → 3 · (10⁷/3)^(v/1000); the inverse recovers the slider position from a
// mass. Round-trip is exact at the endpoints and smooth everywhere between.
const MASS_MIN = 3; // minimum stellar-mass black hole, M☉
const MASS_MAX = 1e7; // supermassive cap (well past Sgr A*), M☉
const MASS_LOG_SPAN = Math.log(MASS_MAX / MASS_MIN);

function sliderToMass(v) {
  return MASS_MIN * Math.exp((Number(v) / 1000) * MASS_LOG_SPAN);
}

function massToSlider(mSun) {
  return Math.round(
    (Math.log(Math.max(mSun, MASS_MIN) / MASS_MIN) / MASS_LOG_SPAN) * 1000
  );
}

// Time-scale slider: 0 → 10⁴ maps linearly to 0 → 10⁴× physical seconds per
// real second. value 30 ≈ 30× (the default GW150914 viewing pace).
function sliderToTimeScale(v) {
  return Number(v); // slider IS the multiplier: 0–10000 → 0–10⁴×
}

// ─── Presets: named systems with their published/derived parameters ─────────
const PRESETS = {
  '36,29': { m1: 36, m2: 29, name: 'GW150914', note: '28.1 M☉ chirp · remnant ≈62 M☉ · χf ≈0.68' },
  '65,45': { m1: 65, m2: 45, name: 'High-mass BBH', note: 'heavier system · faster merger · stronger lensing' },
  '30,25': { m1: 30, m2: 25, name: 'GW170104', note: '35.1 M☉ chirp · remnant ≈48.7 M☉ · χf ≈0.64' },
  '14,8': { m1: 14, m2: 8, name: 'GW170608', note: '7.9 M☉ chirp · longest inspiral in band' },
  '50,50': { m1: 50, m2: 50, name: 'Equal mass', note: 'q = 1 · maximum energy radiated for M' },
  '4300000,3500000': {
    m1: 4.3e6, m2: 3.5e6, name: 'Sgr A* — Milky Way center',
    note: '133 µHz LISA-band chirp · ~51 h inspiral · horizons ≈ 12.7 + 10.3 AU',
  },
};

function applyMassReadouts() {
  const m1 = sliderToMass(ctrlM1.value);
  const m2 = sliderToMass(ctrlM2.value);
  roM1.textContent = fmtMass(m1);
  roM2.textContent = fmtMass(m2);
  roM1Sub.textContent = `horizon ${fmtKm(horizonKm(m1))} · ISCO ${fmtKm(iscoKm(m1))}`;
  roM2Sub.textContent = `horizon ${fmtKm(horizonKm(m2))} · ISCO ${fmtKm(iscoKm(m2))}`;
}

function applyTimeScaleReadouts() {
  const label =
    timeScaleUI >= 1000 ? 'extreme fast-forward'
      : timeScaleUI >= 100 ? 'very fast forward'
        : timeScaleUI >= 1 ? 'fast-forward'
          : timeScaleUI > 0 ? 'slow-motion detail'
            : 'frozen';
  roTimeScale.textContent =
    timeScaleUI >= 1 || timeScaleUI === 0
      ? `${timeScaleUI.toFixed(0)}× — ${label}`
      : `${timeScaleUI.toFixed(3)}× — ${label}`;
  roTimeScaleSub.textContent =
    timeScaleUI > 0
      ? timeScaleUI >= 1
        ? `1 real second advances ${(timeScaleUI).toFixed(0)} physical seconds`
        : `1 real second advances ${(1 / timeScaleUI).toFixed(0)} physical seconds`
      : 'drag right to resume evolution';
}

function applyPresetReadout() {
  const p = PRESETS[ctrlPreset.value] ?? PRESETS['36,29'];
  roPreset.textContent = `${p.name}: ${p.note}`;
}

// Keep the preset selector in sync when the user drags the mass sliders
// manually — no option matches once either mass leaves a preset's exact pair.
function syncPresetToSliders() {
  const m1 = sliderToMass(ctrlM1.value);
  const m2 = sliderToMass(ctrlM2.value);
  const key = [...ctrlPreset.options].find((o) => {
    const p = PRESETS[o.value];
    return p && Math.abs(p.m1 - m1) / p.m1 < 0.02 && Math.abs(p.m2 - m2) / p.m2 < 0.02;
  });
  if (key) ctrlPreset.value = key.value;
  applyPresetReadout();
}

// ─── Controls wiring (UI state) ──────────────────────────────────────────────
let timeScaleUI = 30; // slider 30 → 30 physical seconds per real second
let diskEnabled = true;

const ctrlM1 = el('ctrl-m1');
const ctrlM2 = el('ctrl-m2');
const ctrlTimeScale = el('ctrl-timescale');
const ctrlDisk = el('ctrl-disk');
const ctrlQuality = el('ctrl-quality');
const ctrlStarSeed = el('ctrl-starseed');
const ctrlPreset = el('ctrl-preset');
const btnPause = el('btn-pause');
const btnRestart = el('btn-restart');
const roM1 = el('ro-m1');
const roM2 = el('ro-m2');
const roM1Sub = el('ro-m1-sub');
const roM2Sub = el('ro-m2-sub');
const roTimeScale = el('ro-timescale');
const roTimeScaleSub = el('ro-timescale-sub');
const roDisk = el('ro-disk');
const roDiskSub = el('ro-disk-sub');
const roQualitySub = el('ro-quality-sub');
const roStarSeed = el('ro-starseed');
const roStarSeedSub = el('ro-starseed-sub');
const roPreset = el('ro-preset');

const QUALITY_STEPS = { low: 160, medium: 256, high: 384 };
const QUALITY_NOTES = {
  low: '160 steps — fastest, softer Einstein rings',
  medium: '256 steps — balanced fidelity and speed',
  high: '384 steps — sharpest lensing detail',
};

let pausedUI = false;
let debugModeUI = 0;
const DEBUG_MODES = 3; // 0 final · 1 escape direction · 2 transmittance

ctrlM1.addEventListener('input', () => {
  applyMassReadouts();
  syncPresetToSliders();
  // Live mutation mid-inspiral (no reset) with the slider's log-scale mass.
  sendToWorker({ type: 'setMasses', m1: sliderToMass(ctrlM1.value), m2: sliderToMass(ctrlM2.value) });
});
ctrlM2.addEventListener('input', () => {
  applyMassReadouts();
  syncPresetToSliders();
  sendToWorker({ type: 'setMasses', m1: sliderToMass(ctrlM1.value), m2: sliderToMass(ctrlM2.value) });
});
ctrlTimeScale.addEventListener('input', () => {
  timeScaleUI = sliderToTimeScale(ctrlTimeScale.value);
  applyTimeScaleReadouts();
  sendToWorker({ type: 'setTimeScale', value: timeScaleUI });
});
ctrlDisk.addEventListener('change', () => {
  diskEnabled = ctrlDisk.checked;
  roDisk.textContent = diskEnabled ? 'on' : 'off';
  roDiskSub.textContent = diskEnabled
    ? 'Doppler-beamed plasma; toggle off for bare shadows'
    : 'bare horizons — lensing still active';
});
ctrlQuality.addEventListener('change', () => {
  uniforms.uSteps.value = QUALITY_STEPS[ctrlQuality.value] ?? 160;
  roQualitySub.textContent = QUALITY_NOTES[ctrlQuality.value] ?? QUALITY_NOTES.low;
});
ctrlStarSeed.addEventListener('input', () => {
  uniforms.uStarSeed.value = Number(ctrlStarSeed.value);
  roStarSeed.textContent = String(ctrlStarSeed.value);
  roStarSeedSub.textContent = `sky variant ${ctrlStarSeed.value} of 200`;
});
ctrlPreset.addEventListener('change', () => {
  const p = PRESETS[ctrlPreset.value];
  if (!p) return;
  // Position the log-scale sliders for this preset's masses.
  ctrlM1.value = String(massToSlider(p.m1));
  ctrlM2.value = String(massToSlider(p.m2));
  applyMassReadouts();
  applyPresetReadout();
  // A preset is a new system — restart the run with those masses and a clean
  // chirp envelope.
  chirpHistory.length = 0;
  chirpMaxH = 1e-30;
  drawChirpChart();
  sendToWorker({ type: 'restart', m1: p.m1, m2: p.m2 });
});
btnPause.addEventListener('click', () => {
  pausedUI = !pausedUI;
  btnPause.textContent = pausedUI ? '▶ Resume' : '⏸ Pause';
  sendToWorker({ type: 'setPaused', value: pausedUI });
});
btnRestart.addEventListener('click', () => {
  // Clear the chirp envelope so the chart restarts with the simulation.
  chirpHistory.length = 0;
  chirpMaxH = 1e-30;
  drawChirpChart();
  applyMassReadouts();
  applyTimeScaleReadouts();
  sendToWorker({ type: 'restart', m1: sliderToMass(ctrlM1.value), m2: sliderToMass(ctrlM2.value) });
});

// ─── Keyboard shortcuts (space = pause, R = restart, C = cycle debug) ────────
window.addEventListener('keydown', (ev) => {
  if (ev.code === 'Space') {
    ev.preventDefault();
    btnPause.click();
  } else if (ev.code === 'KeyR') {
    btnRestart.click();
  } else if (ev.code === 'KeyC') {
    debugModeUI = (debugModeUI + 1) % DEBUG_MODES;
    uniforms.uDebugMode.value = debugModeUI;
  }
});

// ─── Resize ───────────────────────────────────────────────────────────────────
function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  setSize(w, h);
}

function setSize(nextWidth, nextHeight) {
  width = Math.max(1, Math.round(nextWidth));
  height = Math.max(1, Math.round(nextHeight));
  sceneTarget.setSize(width, height);
  halfA.setSize(width >> 1, height >> 1);
  halfB.setSize(width >> 1, height >> 1);
  quarterA.setSize(width >> 2, height >> 2);
  quarterB.setSize(width >> 2, height >> 2);
  uniforms.uRes.value.set(width, height);
  compositePass.uniforms.uRes2.value.set(width, height);
}

window.addEventListener('resize', onResize);
// ─── Initial control descriptors (before the first worker snapshot) ────────
applyMassReadouts();
applyTimeScaleReadouts();
applyPresetReadout();
roQualitySub.textContent = QUALITY_NOTES.low;
roStarSeedSub.textContent = 'sky variant 42 of 200';

onResize();

// ─── Render loop (pinned to 60 FPS) ────────────────────────────────────────────
const frameInterval = 1000 / 60; // 60 FPS target
let lastFrame = performance.now();
let frameCount = 0;

function updateCameraBasis() {
  camera.updateMatrixWorld(true);
  camera.getWorldDirection(uniforms.uFw.value);
  uniforms.uPos.value.copy(camera.position);
  uniforms.uRt.value.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
  uniforms.uUp.value.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
  uniforms.uFov.value = Math.tan((camera.fov * Math.PI) / 180 / 2);
  // Escape radius tracks the camera distance: rays must be able to reach the
  // far side of the field, and zooming out must not strand them mid-flight.
  uniforms.uEscapeR.value = Math.max(3 * camera.position.length(), 20);
}

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const delta = now - lastFrame;

  // Pin to ~60 FPS: skip if we're ahead of the frame budget.
  if (delta < frameInterval) return;
  lastFrame = now;
  frameCount += 1;

  controls.update();
  if (latest) {
    applySnapshot(latest);
    if (now - lastHudUpdate > 100) {
      lastHudUpdate = now;
      updateHud(latest);
    }
  }
  updateCameraBasis();
  uniforms.uT.value = now / 1000;
  compositePass.uniforms.uTn.value = (frameCount % 1024) * 0.618;

  // Disk gain gate from the UI toggle (multiplied into the physics-worker gain
  // so the merger crossfade and the toggle are independent).
  const g1 = diskEnabled ? latest?.[SNAPSHOT.DISK_GAIN1] ?? 1 : 0;
  const g2 = diskEnabled ? latest?.[SNAPSHOT.DISK_GAIN2] ?? 1 : 0;
  const gR = diskEnabled ? latest?.[SNAPSHOT.DISK_GAIN_R] ?? 0 : 0;
  uniforms.uDiskGain1.value = g1;
  uniforms.uDiskGain2.value = g2;
  uniforms.uDiskGainR.value = gR;

  // 1) lensing raymarch → HDR scene target
  runPass(renderer, lensingPass, sceneTarget);

  // 2) bright pass at half resolution
  brightPass.uniforms.tex.value = sceneTarget.texture;
  runPass(renderer, brightPass, halfA);

  // 3) separable blur chain at half resolution (2 iterations, growing radius)
  for (let i = 0; i < 2; i += 1) {
    const radius = 1.0 + i * 1.2; // px-equivalent blur radius growth
    blurPass.uniforms.tex.value = halfA.texture;
    blurPass.uniforms.uDir.value.set(radius / halfA.width, 0);
    runPass(renderer, blurPass, halfB);
    blurPass.uniforms.tex.value = halfB.texture;
    blurPass.uniforms.uDir.value.set(0, radius / halfA.height);
    runPass(renderer, blurPass, halfA);
  }

  // 4) quarter-res blur for the wide halo
  blurPass.uniforms.tex.value = halfA.texture;
  blurPass.uniforms.uDir.value.set(1.6 / quarterA.width, 0);
  runPass(renderer, blurPass, quarterA);
  blurPass.uniforms.tex.value = quarterA.texture;
  blurPass.uniforms.uDir.value.set(0, 1.6 / quarterA.height);
  runPass(renderer, blurPass, quarterB);

  // 5) composite to screen
  compositePass.uniforms.tScene.value = sceneTarget.texture;
  compositePass.uniforms.tB1.value = halfA.texture;
  compositePass.uniforms.tB2.value = quarterB.texture;
  runPass(renderer, compositePass, null);
}

animate();