// ─────────────────────────────────────────────────────────────────────────────
// render-check.mjs — headless validation of the WebGL render pipeline.
//
// Loads the dev server in headless Chromium, captures every console error and
// WebGL shader-infolog warning, waits for the lensing pass to draw, then
// screenshots the inspiral, the merger, and the ringdown for visual checks.
// Run after `npm run dev` (expects the server on :5173):
//   node render-check.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { chromium } from 'playwright';

const URL = 'http://localhost:5173/';
const failures = [];
const logs = [];

const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok  ${name}${detail ? ' — ' + detail : ''}`);
  else { failures.push(name); console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--enable-webgl', '--enable-unsafe-webgpu'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

page.on('console', (msg) => {
  const text = msg.text();
  logs.push(`[${msg.type()}] ${text}`);
  if (msg.type() === 'error') failures.push(`console: ${text}`);
});
page.on('pageerror', (err) => {
  logs.push(`[pageerror] ${err.message}`);
  failures.push(`pageerror: ${err.message}`);
});

console.log('── Loading page ──');
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500); // let the lensing pass draw a few frames

check('page loaded', true, URL);

// Shader compile failures surface as console errors mentioning programs.
const shaderErrs = logs.filter((l) => /shader|program|GLSL|compile/i.test(l));
check('no shader compile errors', shaderErrs.length === 0, shaderErrs.join(' | ') || 'clean');

// The canvas readback is unreliable (no preserveDrawingBuffer), so validate
// rendering by decoding actual screenshots and measuring real pixel content.
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const shotStats = (path) => {
  const png = PNG.sync.read(readFileSync(path));
  let sum = 0;
  let bright = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const l = (png.data[i] + png.data[i + 1] + png.data[i + 2]) / 3;
    sum += l;
    if (l > 24) bright += 1;
  }
  const n = png.width * png.height;
  return { mean: sum / n, litFrac: bright / n };
};

console.log('── Screenshots through the merger ──');
await page.screenshot({ path: 'shot-inspiral.png' });
const inspiralStats = await shotStats('shot-inspiral.png');
check('lensing pass rendering', inspiralStats.litFrac > 0.02,
  `lit pixels ${(inspiralStats.litFrac * 100).toFixed(1)}%, mean luma ${inspiralStats.mean.toFixed(1)}/255`);
console.log('  saved shot-inspiral.png');

// Fast-forward to the merger: crank the time scale, wait, capture.
await page.fill('#ctrl-timescale', '1');
await page.dispatchEvent('#ctrl-timescale', 'input');
await page.waitForTimeout(6000);
await page.screenshot({ path: 'shot-merger.png' });
console.log('  saved shot-merger.png (timeScale = 1.0, ~6 s of evolution)');

// Ringdown: a few more seconds at real time.
await page.waitForTimeout(4000);
await page.screenshot({ path: 'shot-ringdown.png' });
console.log('  saved shot-ringdown.png');

// HUD should show the phase progressing.
const badge = await page.textContent('#phase-badge');
console.log(`  phase badge after fast-forward: ${badge}`);

// Restore slow motion.
await page.fill('#ctrl-timescale', '0.03');
await page.dispatchEvent('#ctrl-timescale', 'input');

if (logs.length) {
  console.log('── Captured console output ──');
  for (const l of logs.slice(0, 30)) console.log(`  ${l}`);
}

await browser.close();
console.log(failures.length === 0 ? '\nAll render checks passed.' : `\n${failures.length} check(s) FAILED.`);
process.exit(failures.length === 0 ? 0 : 1);