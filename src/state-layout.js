// ─────────────────────────────────────────────────────────────────────────────
// Snapshot layout shared between physics.worker.js and main.js.
//
// The worker packs one Float32Array of SNAPSHOT_FLOATS and transfers it
// (zero-copy, transferable buffer) at ~60 Hz. All render-thread uniforms and
// every HUD readout are derived from these slots — the physics worker is the
// single source of truth for the simulation state.
//
// SCENE UNITS: 1 scene unit = G·M_total/c² (the geometric length of the total
// mass). The two hole masses therefore always sum to 1 scene unit before the
// merger, and the inspiral/merger geometry is invariant under rescaling M_total.
// The orbital plane is z = 0; both disks and both holes live in it.
// ─────────────────────────────────────────────────────────────────────────────

export const SNAPSHOT_FLOATS = 39;

export const SNAPSHOT = {
  PHASE: 0, // 0 inspiral · 1 merger · 2 ringdown · 3 settled remnant
  SIM_TIME: 1, // physical seconds of evolved system time since (re)start
  SEP_KM: 2, // hole–hole separation, km
  THETA: 3, // orbital phase, radians

  X1: 4, // hole 1 position (x, z) in the world XZ orbital plane; world y = 0
  Y1: 5,
  X2: 6, // hole 2 position, same convention
  Y2: 7,

  M1_SCENE: 8, // hole 1 mass, scene units (fraction of M_tot; becomes the remnant after merger)
  M2_SCENE: 9, // hole 2 mass, scene units (→ 0 through the merger envelope)

  MERGER_PROGRESS: 10, // 0..1 visual coalescence envelope
  RINGDOWN_T: 11, // physical seconds since the merger envelope completed

  F_GW: 12, // gravitational-wave frequency, Hz (2× orbital frequency; QNM f₂₂ in ringdown)
  V_ORB: 13, // relative orbital speed, fraction of c
  T_C: 14, // seconds until coalescence (0 once merged)
  CHIRP_MASS: 15, // chirp mass, solar masses
  E_RAD: 16, // cumulative energy radiated, solar masses × c²
  STRAIN: 17, // dimensionless GW strain amplitude at 410 Mpc

  DISK_TIME: 18, // visual clock in wall-seconds of the run (drives disk swirl; freezes on pause)

  DISK_OUT1: 19, // disk 1 outer radius, scene units (Roche-truncated by the separation)
  DISK_OUT2: 20, // disk 2 outer radius, scene units
  DISK_GAIN1: 21, // disk 1 brightness multiplier (merger crossfade)
  DISK_GAIN2: 22, // disk 2 brightness multiplier

  M_REMNANT: 23, // remnant mass, solar masses (0 before merger completes)
  F_RINGDOWN: 24, // quasi-normal-mode ringdown frequency f₂₂, Hz
  X_REM: 25, // remnant center (x, z), scene units (QNM wobble)
  Y_REM: 26,

  HORIZON_KM1: 27, // Schwarzschild radius of hole 1, km
  HORIZON_KM2: 28, // Schwarzschild radius of hole 2, km
  GW_LUMINOSITY: 29, // dE/dt radiated in gravitational waves, M☉c²/s
  DISK_IN1: 30, // disk 1 inner radius, scene units (Schwarzschild ISCO = 6·m̃)
  DISK_IN2: 31, // disk 2 inner radius, scene units

  STRAIN_TAU: 32, // ringdown strain damping time τ, physical seconds
  DISK_OUT_R: 33, // remnant disk outer radius, scene units
  DISK_IN_R: 34, // remnant disk inner radius, scene units (Kerr ISCO, Bardeen formula)
  DISK_GAIN_R: 35, // remnant disk brightness multiplier
  REMNANT_SPIN: 36, // dimensionless final spin χ_f (0 before the merger completes)
  REMNANT_MASS_SCENE: 37, // remnant mass in scene units (disk shading only; 0 before the envelope)
  RUN_PROGRESS: 38, // whole-run coalescence progress 0..1 (inspiral start → merged)
};

// km per geometric length unit (G·M☉/c²). Display-side conversion only — the
// physics worker derives its own value from SI constants.
export const GEO_KM = 1.476625;