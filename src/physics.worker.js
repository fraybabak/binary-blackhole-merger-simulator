// ─────────────────────────────────────────────────────────────────────────────
// physics.worker.js — post-Newtonian binary inspiral → merger → ringdown.
//
// Runs entirely off the render thread and posts Float32Array snapshots at the
// render rate (~60 Hz) via transferable buffers. Parameter changes arrive as
// plain messages and mutate the live state mid-inspiral without a reset.
//
// UNITS — geometric, G = c = 1 (defined ONLY here):
//   mass   : solar masses (1 M☉ ↔ GM☉/c² = 1.4766 km ↔ GM☉/c³ = 4.9255 μs)
//   length : GM☉/c²  (1 unit = 1.4766 km)
//   time   : GM☉/c³  (1 unit = 4.9255 μs)
//   energy : M☉·c²   (a radiated energy of 3.0 means three solar rest-masses)
// Scene units (used by the renderer) = geometric length / M_total, so the two
// holes always sum to 1 scene unit before the merger and the orbital geometry
// is invariant under rescaling the total mass.
//
// TIME-SCALE CONVERSION (the ONLY wall↔physical bridge in the project):
//   dt_physical = dt_wall × timeScale      (timeScale unitless; default 0.03
//   stretches the ~1.5 s GW150914 inspiral over ~50 s of viewing; 1.0 = real
//   time). DISK_TIME (visual swirl clock) advances with dt_wall instead, so
//   disk patterns move at the same apparent rate as the orbit the user sees.
// ─────────────────────────────────────────────────────────────────────────────

import { SNAPSHOT, SNAPSHOT_FLOATS } from './state-layout.js';

// SI constants — the only place SI appears.
const G = 6.67430e-11; // m³ kg⁻¹ s⁻²
const C = 299792458.0; // m s⁻¹
const MSUN = 1.98892e30; // kg
const T_G = (G * MSUN) / C ** 3; // 4.9255e-6 s — geometric time unit
const KM_GEO = (G * MSUN) / C ** 2 / 1e3; // 1.4766 km — geometric length unit
// Luminosity distance of the displayed source, in geometric length units.
// Stellar-mass runs display at GW150914's 410 Mpc; supermassive (Sgr A*-class)
// runs display at the Galactic-center distance, 8 kpc ≈ 26,000 ly — where
// such a merger would actually be observed from Earth.
const MPC = 3.0857e22; // meters per megaparsec
const KPC = 3.0857e19; // meters per kiloparsec
const D_LUM_STELLAR = (410 * MPC) / ((G * MSUN) / C ** 2);
const D_LUM_SMBH = (8 * KPC) / ((G * MSUN) / C ** 2);
// Threshold separating the two display regimes: total mass above this reads
// as a Galactic-center-like event.
const M_SMBH_THRESHOLD = 1e5; // M☉
const RESPONSE = 0.5; // orientation-averaged detector response folded into the displayed strain

// Current display distance for the strain formula (recomputed with the masses).
let dLum = D_LUM_STELLAR;

function currentDLum() {
  return M >= M_SMBH_THRESHOLD ? D_LUM_SMBH : D_LUM_STELLAR;
}

// ─── Simulation parameters (all documented magic numbers) ───────────────────
// Inspiral entry frequency is MASS-RELATIVE: f_start = START_F_FACTOR / M.
// At M = 65 M☉ this is exactly 16 Hz (just below the LIGO band, matching
// GW150914-class runs), and it scales as 1/M so the start separation is a
// fixed multiple (~7.5×) of the contact separation for ANY mass. Supermassive
// binaries (Sgr A*-class, M ~ 10⁶–10⁷) therefore start in the µHz LISA band —
// the physically correct regime — instead of inside their own horizons.
const START_F_FACTOR = 1040; // Hz × M☉ (16 Hz × 65 M☉); f_start = 1040/M
const R_CONTACT_F = 1.05; // merger when r ≤ 1.05 × (R_h1 + R_h2): horizons touching
const R_ENV_F = 1.35; // visual coalescence envelope starts at 1.35 × r_contact
const MAX_SUBSTEPS = 720; // substep cap per tick (bounds worst-case tick cost)
const MAX_DPHASE = Math.PI / 48; // max orbital phase advance per integration step (rad)
const E_INSP_FRAC = 0.80; // leading-order PN saturates at 80% of the total radiated energy
const PULL_F = 1.0; // visual convergence of the two holes: fully merged at p = 1
const WOBBLE_AMP = 0.16; // remnant QNM wobble amplitude, scene units (~8% of horizon)
const FLARE_GAIN = 1.4; // post-merger disk brightness flare (decays with τ_flare)
const TICK_MS = 16; // snapshot post rate ≈ render rate

// ─── Live state ──────────────────────────────────────────────────────────────
let m1 = 36.0; // hole 1 mass, M☉ (GW150914-like default)
let m2 = 29.0; // hole 2 mass, M☉
let M = m1 + m2;
let chirp = 0; // chirp mass, M☉
let roche1 = 0.4; // Eggleton lobe radius / separation, hole 1
let roche2 = 0.4; // ditto, hole 2

let r = 0; // separation, geometric length units
let rStart = 1; // separation at run start (progress denominator); ≥1 guard
let theta = 0.6; // orbital phase, rad
let tSim = 0; // physical time, geometric time units
let eRad = 0; // energy radiated during inspiral, M☉c² (geometric mass units)
let phase = 0; // 0 inspiral · 1 merger envelope · 2 ringdown · 3 settled remnant
let p = 0; // merger envelope progress 0..1
let tRing = 0; // time since ringdown began, geometric units
let eEnv0 = 0; // energy radiated when the envelope began

// Remnant (filled at mergerSetup, safe defaults before)
let M_merger = 65; // total mass frozen at merger (scene-unit normalizer)
let chiF = 0; // final spin χ_f
let mF = 0; // remnant mass, M☉
let eFit = 0; // total energy the full event will radiate, M☉c²
let fQNM = 0; // ℓ=m=2 ringdown frequency, Hz
let tauQNM = 0; // ringdown damping time, s
let tauW = 0.25; // QNM wobble decay (visual floor: max(τ, 0.25 s))
let tauFlare = 0.4; // disk flare decay (visual floor: max(τ, 0.4 s))
let phi0 = 0; // QNM wobble phase (2× orbital phase at contact — the l=2 mode axis)
let hContact = 0; // strain at horizon contact
let LContact = 0; // GW luminosity at contact (capped display value)

let timeScale = 0.03; // wall-seconds → physical-seconds multiplier
let paused = false;
let wallRun = 0; // DISK_TIME: visual wall-seconds of this run

// ─── Helpers ─────────────────────────────────────────────────────────────────
const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);
const ss = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;

// Eggleton Roche-lobe radius in units of the separation (q = m/m_companion).
function lobe(q) {
  const q3 = Math.cbrt(q);
  const q23 = q3 * q3;
  return (0.49 * q23) / (0.6 * q23 + Math.log(1 + q3));
}

// Bardeen 1972: prograde ISCO radius of a Kerr hole with spin χ, in units of M.
function kerrISCO(chi) {
  const z1 = 1 + Math.cbrt(1 - chi * chi) * (Math.cbrt(1 + chi) + Math.cbrt(1 - chi));
  const z2 = Math.sqrt(3 * chi * chi + z1 * z1);
  return 3 + z2 - Math.sqrt((3 - z1) * (3 + z1 + 2 * z2));
}

function recomputeDerived() {
  M = m1 + m2;
  chirp = Math.pow(m1 * m2, 0.6) / Math.pow(M, 0.2);
  roche1 = lobe(m1 / m2);
  roche2 = lobe(m2 / m1);
}

// Radiated-energy fit, M☉c²: quadratic anchored on the equal-mass NR value
// (≈ 4.8% of M at η = 0.25) and the test-particle plunge limit (E ≈ 0.0572·η).
function radiatedFit() {
  const eta = (m1 * m2) / (M * M);
  return M * (0.0572 * eta + 0.5392 * eta * eta);
}

// Final-spin fit, χ_f: quadratic anchored on the equal-mass NR value (0.6864)
// and the test-particle plunge slope (4√6/3 ≈ 3.266 per unit η).
function finalSpinFit() {
  const eta = (m1 * m2) / (M * M);
  return clamp(3.2655 * eta - 2.0816 * eta * eta, 0, 0.99);
}

function restart() {
  recomputeDerived();
  // Start the binary at the mass-relative GW frequency: r³ = M/(π·f)².
  // f_start = 1040/M Hz keeps r_start ≈ 7.5× r_contact for every mass — from
  // stellar (16 Hz, LIGO) to supermassive (µHz, LISA).
  const fg = (START_F_FACTOR / M) * T_G;
  r = Math.cbrt(M / (Math.PI * fg) ** 2);
  rStart = Math.max(r, 1); // whole-run progress denominator (never < contact)
  theta = 0.6;
  tSim = 0;
  eRad = 0;
  eEnv0 = 0;
  phase = 0;
  p = 0;
  tRing = 0;
  wallRun = 0;
  chiF = 0;
  mF = M;
  eFit = radiatedFit();
}

// One-time remnant setup at horizon contact (Berti et al. 2009 QNM fits).
function mergerSetup() {
  M_merger = M;
  const eta = (m1 * m2) / (M * M);
  chiF = finalSpinFit();
  eFit = radiatedFit();
  mF = M - eFit;
  // f₂₂ from the Berti fit: M_f·ω₂₂ = 1.5251 − 1.1568(1−χ)^0.1292
  const om22 = 1.5251 - 1.1568 * Math.pow(1 - chiF, 0.1292);
  const wGeom = om22 / mF; // geometric rad per t_g
  fQNM = wGeom / (2 * Math.PI) / T_G;
  // Q₂₂ = ωτ/2 from the same fit; τ = 2Q/ω in physical seconds
  const q22 = 0.7 + 1.4187 * Math.pow(1 - chiF, -0.499);
  tauQNM = ((2 * q22) / wGeom) * T_G;
  tauW = Math.max(tauQNM, 0.25); // visual floor so the wobble is visible in slow-mo
  tauFlare = Math.max(tauQNM, 0.4);
  phi0 = 2 * theta; // l=2 mode aligned with the binary axis at contact
  const omegaC = Math.sqrt(M / (r * r * r));
  hContact = (4 * Math.pow(chirp, 5 / 3) * Math.pow(omegaC, 2 / 3) * RESPONSE) / currentDLum();
  LContact = 300 * Math.pow(M / 65, 2); // display cap ≈ GW150914-class peak luminosity
}

// ─── Integration ─────────────────────────────────────────────────────────────
function integrate(dt) {
  tSim += dt;
  if (phase <= 1) {
    // Circular-orbit PN evolution (Peters 1964, geometric form):
    //   Ω = √(M/r³)              dr/dt = −(64/5)·m₁m₂M/r³
    //   L_GW = (32/5)·m₁²m₂²M/r⁵   (energy rate, consistent with dr/dt)
    const omega = Math.sqrt(M / (r * r * r));
    theta += omega * dt;
    r += (-(64 / 5) * m1 * m2 * M * dt) / (r * r * r);
    if (phase === 0) {
      const L = ((32 / 5) * m1 * m1 * m2 * m2 * M) / Math.pow(r, 5);
      eRad = Math.min(eRad + L * dt, E_INSP_FRAC * radiatedFit());
    }
    const rContact = R_CONTACT_F * 2 * M; // 1.05 × (R_h1 + R_h2)
    const rEnv = R_ENV_F * rContact;
    if (phase === 0 && r <= rEnv) {
      phase = 1;
      M_merger = M; // freeze the scene-unit normalizer at envelope entry
      eEnv0 = eRad;
    }
    if (phase === 1) {
      p = clamp((rEnv - r) / (rEnv - rContact), p, 1); // envelope driven by r
      eRad = mix(eEnv0, eFit, ss(0, 1, p));
      if (r <= rContact) {
        r = rContact;
        phase = 2;
        tRing = 0;
        mergerSetup();
      }
    }
  } else {
    tRing += dt;
    if (tRing * T_G > 6 * tauW) phase = 3; // settled once the wobble has decayed
  }
}

function advance(dtPhys) {
  // Convert wall→physical seconds (dt_wall × timeScale) into GEOMETRIC time
  // units (÷ T_G): all integration below runs in G = c = 1 units.
  let remaining = dtPhys / T_G;
  let n = 0;
  // Sub-step so the orbital phase advances at most MAX_DPHASE per integration
  // step — keeps the integration stable and frame-rate independent.
  while (remaining > 1e-14 && n < MAX_SUBSTEPS) {
    let dt = remaining;
    if (phase <= 1) {
      const omega = Math.sqrt(M / (r * r * r));
      if (omega * dt > MAX_DPHASE) dt = MAX_DPHASE / omega;
    }
    integrate(dt);
    remaining -= dt;
    n += 1;
  }
  // Pathological time scales (fast-forward at contact): take one bounded step.
  if (remaining > 1e-14) integrate(remaining);
}

// ─── Snapshot packing (all physical-unit conversions happen here) ────────────
function pack() {
  const s = new Float32Array(SNAPSHOT_FLOATS);
  const Mref = phase >= 1 ? M_merger : M; // scene-unit normalizer (frozen at merger)
  const rContact = R_CONTACT_F * 2 * M;

  s[SNAPSHOT.PHASE] = phase;
  s[SNAPSHOT.SIM_TIME] = tSim * T_G; // physical seconds
  s[SNAPSHOT.SEP_KM] = r * KM_GEO;
  s[SNAPSHOT.THETA] = theta;

  // Positions (world x,z in the y=0 orbital plane), pulled toward the center of
  // mass through the envelope so the horizons visibly coalesce.
  const pull = PULL_F * ss(0.45, 1.0, p);
  const arm1 = (r * m2) / M / Mref; // hole-1 orbital radius, scene units
  const arm2 = (r * m1) / M / Mref;
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  const wobOn = ss(0.85, 1.0, p);
  const tRingP = tRing * T_G; // physical seconds since ringdown began
  const decay = wobOn > 0 ? Math.exp(-tRingP / tauW) : 0;
  const wqnm = 2 * Math.PI * fQNM;
  const wx = wobOn * WOBBLE_AMP * decay * Math.cos(wqnm * tRingP + phi0);
  const wz = wobOn * WOBBLE_AMP * decay * Math.sin(wqnm * tRingP + phi0);

  s[SNAPSHOT.X1] = arm1 * (1 - pull) * ct + wx;
  s[SNAPSHOT.Y1] = arm1 * (1 - pull) * st + wz;
  s[SNAPSHOT.X2] = -arm2 * (1 - pull) * ct + wx;
  s[SNAPSHOT.Y2] = -arm2 * (1 - pull) * st + wz;

  // Masses blend into the remnant through the final 40% of the envelope.
  const blend = ss(0.6, 1.0, p);
  const m1vis = phase === 0 ? m1 : mix(m1, mF, blend);
  const m2vis = phase === 0 ? m2 : m2 * (1 - blend);
  s[SNAPSHOT.M1_SCENE] = m1vis / Mref;
  s[SNAPSHOT.M2_SCENE] = m2vis / Mref;
  s[SNAPSHOT.MERGER_PROGRESS] = p;
  // Whole-run coalescence progress 0..1. During the inspiral it is linear in
  // ELAPSED TIME: from the Peters solution T_c ∝ r⁴ the elapsed fraction is
  // exactly 1 − (r/r₀)⁴, so the bar advances smoothly from the first frame
  // instead of sitting at 0 until the final second. The last 15% of the bar
  // is reserved for the merger envelope itself (driven by r between r_env
  // and r_contact), so 85% marks horizon contact.
  const rEnvStart = R_ENV_F * R_CONTACT_F * 2 * M;
  const rContactNow = R_CONTACT_F * 2 * M;
  const runProgress =
    phase === 0
      ? 0.85 * (1 - Math.pow(clamp(r / rStart, 0, 1), 4))
      : 0.85 + 0.15 * clamp((rEnvStart - r) / Math.max(rEnvStart - rContactNow, 1e-9), 0, 1);
  s[SNAPSHOT.RUN_PROGRESS] = phase >= 2 ? 1 : clamp(runProgress, 0, 1);
  s[SNAPSHOT.RINGDOWN_T] = tRingP;

  // Frequencies, speeds, and countdowns.
  const omega = Math.sqrt(M / (r * r * r));
  const fGW = phase <= 1 ? omega / (Math.PI * T_G) : fQNM;
  s[SNAPSHOT.F_GW] = fGW;
  s[SNAPSHOT.V_ORB] = phase <= 1 ? Math.sqrt(M / r) : 0; // relative orbital speed, v/c
  s[SNAPSHOT.T_C] = phase <= 1 ? ((5 / 256) * Math.pow(r, 4)) / (m1 * m2 * M) * T_G : 0;
  s[SNAPSHOT.CHIRP_MASS] = chirp;
  s[SNAPSHOT.E_RAD] = eRad;
  // Strain: h ≈ 4·M_c^{5/3}(πf)^{2/3}/D at 410 Mpc (× orientation response).
  s[SNAPSHOT.STRAIN] =
    phase <= 1
      ? (4 * Math.pow(chirp, 5 / 3) * Math.pow(omega, 2 / 3) * RESPONSE) / currentDLum()
      : hContact * Math.exp(-tRingP / tauQNM);
  s[SNAPSHOT.DISK_TIME] = wallRun;

  // Disk geometry (scene units). Roche-truncated, but never collapsed inside
  // 1.35×ISCO — late inspiral keeps compact hot disks (NR-like common envelope).
  const in1 = 6 * m1; // Schwarzschild ISCO
  const in2 = 6 * m2;
  s[SNAPSHOT.DISK_IN1] = in1 / Mref;
  s[SNAPSHOT.DISK_IN2] = in2 / Mref;
  s[SNAPSHOT.DISK_OUT1] = clamp(roche1 * r, 1.35 * in1, 24 * m1) / Mref;
  s[SNAPSHOT.DISK_OUT2] = clamp(roche2 * r, 1.35 * in2, 24 * m2) / Mref;

  // Disk gains: disks brighten as they are squeezed, then crossfade to the
  // single remnant disk (which flares and settles after the merger).
  const squeeze = 1 + 0.6 * ss(0.3, 1.0, p);
  s[SNAPSHOT.DISK_GAIN1] = (1 - ss(0.55, 1.0, p)) * squeeze;
  s[SNAPSHOT.DISK_GAIN2] = (1 - ss(0.55, 1.0, p)) * squeeze;
  const flare = phase >= 2 ? FLARE_GAIN * Math.exp(-tRingP / tauFlare) : 0;
  s[SNAPSHOT.DISK_GAIN_R] = ss(0.45, 0.95, p) * (1 + flare);

  // Remnant bookkeeping.
  s[SNAPSHOT.M_REMNANT] = phase >= 2 ? mF : 0;
  s[SNAPSHOT.F_RINGDOWN] = fQNM;
  s[SNAPSHOT.X_REM] = wx;
  s[SNAPSHOT.Y_REM] = wz;
  s[SNAPSHOT.HORIZON_KM1] = 2 * m1vis * KM_GEO; // Schwarzschild radius, km
  s[SNAPSHOT.HORIZON_KM2] = 2 * m2vis * KM_GEO;
  const Lpn = phase <= 1 ? ((32 / 5) * m1 * m1 * m2 * m2 * M) / Math.pow(r, 5) / T_G : 0;
  s[SNAPSHOT.GW_LUMINOSITY] =
    phase <= 1 ? Math.min(Lpn, 300 * Math.pow(M / 65, 2)) : LContact * Math.exp((-2 * tRingP) / tauQNM);
  s[SNAPSHOT.STRAIN_TAU] = tauQNM;
  s[SNAPSHOT.DISK_IN_R] = (kerrISCO(chiF) * mF) / Mref; // Kerr ISCO of the remnant
  s[SNAPSHOT.DISK_OUT_R] = mix(2.2 * rContact, 16 * mF, ss(0.4, 1.0, p)) / Mref;
  s[SNAPSHOT.REMNANT_SPIN] = phase >= 2 ? chiF : 0;
  // Remnant mass for DISK SHADING only — after the merger the remnant IS hole 1
  // (uM1 carries it), so lensing/capture must not double-count this mass.
  s[SNAPSHOT.REMNANT_MASS_SCENE] = phase >= 1 ? mF / Mref : 0.0;

  return s;
}

// ─── Tick loop (drift-corrected to the render rate) ──────────────────────────
let lastNow = performance.now();
function tick() {
  const now = performance.now();
  const dtWall = Math.min((now - lastNow) / 1000, 0.25); // cap tab-throttle jumps
  lastNow = now;
  if (!paused) {
    advance(dtWall * timeScale);
    wallRun += dtWall; // visual clock: always wall-time, frozen on pause
  }
  const s = pack();
  postMessage(s, [s.buffer]); // zero-copy transferable snapshot
  const next = Math.max(0, lastNow + TICK_MS - performance.now());
  setTimeout(tick, next);
}

// ─── Messages from the render thread ─────────────────────────────────────────
onmessage = (e) => {
  const msg = e.data;
  switch (msg.type) {
    case 'setMasses': {
      // 3 M☉ (minimum stellar) → 10⁷ M☉ (supermassive, Sgr A*-class binaries).
      const n1 = clamp(Number(msg.m1) || m1, 3, 1e7);
      const n2 = clamp(Number(msg.m2) || m2, 3, 1e7);
      if (phase >= 1) {
        // The remnant is frozen — mass edits after the merger restart the run.
        m1 = n1;
        m2 = n2;
        restart();
      } else {
        // Live mutation, no reset: rates, chirp mass, lobes all recompute.
        m1 = n1;
        m2 = n2;
        recomputeDerived();
      }
      break;
    }
    case 'setTimeScale': {
      const v = Number(msg.value);
      // 0 (frozen) → 10⁶: supermassive inspirals last days of physical time and
      // need ~10³–10⁴× fast-forward to be watchable in seconds.
      if (Number.isFinite(v)) timeScale = clamp(v, 0, 1e6);
      break;
    }
    case 'setPaused':
      paused = !!msg.value;
      break;
    case 'restart':
      if (Number.isFinite(msg.m1)) m1 = clamp(msg.m1, 3, 1e7);
      if (Number.isFinite(msg.m2)) m2 = clamp(msg.m2, 3, 1e7);
      restart();
      break;
  }
};

restart();
tick();