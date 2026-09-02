// ─────────────────────────────────────────────────────────────────────────────
// physics-check.mjs — headless verification of physics.worker.js evolution.
//
// Loads the worker source, injects the shared snapshot layout, and drives the
// tick loop with a controlled fake clock: verifies the inspiral → merger →
// ringdown → remnant phase progression, the GW frequency chirp, and that the
// reported physical quantities stay finite and physically ordered.
//
// Not part of the app bundle — a development test only. Run:
//   node physics-check.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { SNAPSHOT, SNAPSHOT_FLOATS } from './src/state-layout.js';

const src = readFileSync(new URL('./src/physics.worker.js', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '')   // layout injected below
  .replace(/^export .*$/gm, '');

// Worker-like environment
const snaps = [];
let fakeNow = 0;
const fakeTimers = [];
const env = {
  performance: { now: () => fakeNow },
  postMessage: (s) => snaps.push(s),
  setTimeout: (fn, ms) => fakeTimers.push(fn),
  onmessage: null,
  SNAPSHOT,
  SNAPSHOT_FLOATS,
};

const tickWorker = new Function(...Object.keys(env), `${src}\nreturn { tick, get onmessage() { return onmessage; } };`);
const api = tickWorker(...Object.values(env));
// The worker assigns the module-scope `onmessage = ...`; re-expose it.
const messageHandler = api.onmessage;

// Drive the loop: 1 wall-second per iteration at 16 ms ticks.
const drive = (seconds, ts) => {
  const ticks = Math.round((seconds * 1000) / 16);
  for (let i = 0; i < ticks; i += 1) {
    fakeNow += 16;
    api.tick();
  }
  return snaps[snaps.length - 1];
};

const failures = [];
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok  ${name}${detail ? ' — ' + detail : ''}`);
  else { failures.push(name); console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};

console.log('── Phase progression (timeScale = 0.03, ~60 s wall) ──');
let prevPhase = 0;
let sawRingdown = false;
for (let i = 0; i < 60; i += 1) {
  const s = drive(1, 0.03);
  const phase = s[SNAPSHOT.PHASE];
  if (phase < prevPhase) check('phase monotonic', false, `regressed ${prevPhase} → ${phase}`);
  if (phase === 2) sawRingdown = true;
  prevPhase = phase;
}
const finalSnap = snaps[snaps.length - 1];
check('reaches ringdown/remnant', finalSnap[SNAPSHOT.PHASE] >= 2, `final phase = ${finalSnap[SNAPSHOT.PHASE]}`);
check('remnant mass ≈ 62 M☉', Math.abs(finalSnap[SNAPSHOT.M_REMNANT] - 62) < 3, `${finalSnap[SNAPSHOT.M_REMNANT].toFixed(2)} M☉`);
check('final spin ≈ 0.68', Math.abs(finalSnap[SNAPSHOT.REMNANT_SPIN] - 0.68) < 0.03, `χf = ${finalSnap[SNAPSHOT.REMNANT_SPIN].toFixed(4)}`);
check('energy radiated ≈ 3.0 M☉c²', Math.abs(finalSnap[SNAPSHOT.E_RAD] - 3.0) < 0.5, `${finalSnap[SNAPSHOT.E_RAD].toFixed(3)} M☉c²`);
check('all values finite', Array.from(finalSnap).every(Number.isFinite));

console.log('── Chirp ordering (monotone f_GW rise through inspiral) ──');
const inspiralSnaps = snaps.filter((s) => s[SNAPSHOT.PHASE] === 0);
let mono = true;
for (let i = 1; i < inspiralSnaps.length; i += 1) {
  if (inspiralSnaps[i][SNAPSHOT.F_GW] < inspiralSnaps[i - 1][SNAPSHOT.F_GW] - 1e-9) { mono = false; break; }
}
check('f_GW monotonically rises', mono);
check('f_GW within LIGO band', finalSnap[SNAPSHOT.F_GW] > 100 && finalSnap[SNAPSHOT.F_GW] < 300,
  `f_ringdown = ${finalSnap[SNAPSHOT.F_RINGDOWN].toFixed(1)} Hz (GW150914 ≈ 250 Hz)`);

console.log('── Live parameter mutation (no restart mid-inspiral) ──');
// Reset and mutate masses mid-inspiral via the message handler.
snaps.length = 0;
fakeNow = 0;
messageHandler({ data: { type: 'restart', m1: 36, m2: 29 } });
drive(5, 0.03);
const before = snaps[snaps.length - 1];
messageHandler({ data: { type: 'setMasses', m1: 60, m2: 40 } });
drive(5, 0.03);
const after = snaps[snaps.length - 1];
check('separation evolved continuously', Math.abs(after[SNAPSHOT.SEP_KM] - before[SNAPSHOT.SEP_KM]) > 0,
  `r: ${before[SNAPSHOT.SEP_KM].toFixed(1)} → ${after[SNAPSHOT.SEP_KM].toFixed(1)} km`);
check('chirp mass updated live', Math.abs(after[SNAPSHOT.CHIRP_MASS] - 42.47) < 1.5,
  `M_c = ${after[SNAPSHOT.CHIRP_MASS].toFixed(2)} M☉ (expected ≈ 42.5 for 60+40)`);
check('phase still inspiral after mutation', after[SNAPSHOT.PHASE] === 0);

console.log(failures.length === 0 ? '\nAll physics checks passed.' : `\n${failures.length} check(s) FAILED.`);
process.exit(failures.length === 0 ? 0 : 1);