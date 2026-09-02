// ─────────────────────────────────────────────────────────────────────────────
// screenshots.mjs — captures README screenshots of the simulator's key phases.
//
// Runs the app in headless Chromium at a clean 1600×900 viewport and captures:
//   docs/screenshot-inspiral.png   — two holes mid-inspiral with disks + lensing
//   docs/screenshot-merger.png    — horizon contact, bright common envelope
//   docs/screenshot-ringdown.png  — single wobbling remnant
//   docs/screenshot-sgra.png       — the Milky-Way-center supermassive preset
// Requires the dev server on :5173.
// ─────────────────────────────────────────────────────────────────────────────

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = 'http://localhost:5173/';
mkdirSync('docs', { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(URL, { waitUntil: 'networkidle' });

// 1) Inspiral: default GW150914 system, early inspiral.
await page.waitForTimeout(4000);
await page.screenshot({ path: 'docs/screenshot-inspiral.png' });
console.log('captured docs/screenshot-inspiral.png');

// 2) Merger: fast-forward to just before/at horizon contact and hold there.
//    The capture panel appears at contact — that's the shot.
await page.fill('#ctrl-timescale', '10');
await page.dispatchEvent('#ctrl-timescale', 'input');
await page.waitForFunction(
  () => !document.getElementById('merger-event').hidden,
  { timeout: 60000 },
).then(() => true).catch(() => console.log('  (merger capture timeout — using latest frame)'));
await page.waitForTimeout(300);
await page.screenshot({ path: 'docs/screenshot-merger.png' });
console.log('captured docs/screenshot-merger.png');

// 3) Ringdown: a few seconds later, single remnant + capture panel visible.
await page.waitForTimeout(4000);
await page.screenshot({ path: 'docs/screenshot-ringdown.png' });
console.log('captured docs/screenshot-ringdown.png');

// 4) Sgr A*: the supermassive Galactic-center preset, early inspiral.
await page.selectOption('#ctrl-preset', '4300000,3500000');
await page.waitForFunction(
  () => document.getElementById('phase-badge').textContent === 'INSPIRAL',
  { timeout: 10000 },
).then(() => true).catch(() => {});
await page.fill('#ctrl-timescale', '30');
await page.dispatchEvent('#ctrl-timescale', 'input');
await page.waitForTimeout(2500);
await page.screenshot({ path: 'docs/screenshot-sgra.png' });
console.log('captured docs/screenshot-sgra.png');

await browser.close();
console.log('done.');