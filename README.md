# Binary Black Hole Merger Simulator

Interactive real-time WebGL simulation of a binary black hole merger
(GW150914-like, 36 + 29 M☉): post-Newtonian inspiral physics in a Web Worker,
RK2 null-geodesic gravitational lensing against a procedural starfield,
Doppler-beamed accretion disks, and a live descriptive telemetry HUD.

## Run locally

```bash
npm install
npm run dev      # dev server at http://localhost:5173
```

Production build:

```bash
npm run build    # bundles to dist/
npm run preview  # preview the production build locally
```

## Deploy to Vercel

The repo ships with `vercel.json` (framework preset: Vite, build: `npm run
build`, output: `dist/`).

**Via the Vercel dashboard / Git integration (recommended):**
1. Push this repository to GitHub/GitLab/Bitbucket.
2. In Vercel: *Add New → Project* → import the repo.
3. Vercel auto-detects Vite from `vercel.json` / `package.json` — click
   **Deploy**. No environment variables needed; everything is procedural and
   self-contained (no external assets or APIs).

**Via the Vercel CLI:**
```bash
npm i -g vercel
vercel          # preview deploy
vercel --prod   # production deploy
```

## Physics checks

Two dev-only validation scripts are included:

```bash
node physics-check.mjs   # headless physics: chirp, merger, ringdown, fits
node render-check.mjs    # headless WebGL: shader compile + screenshot analysis
# (render-check needs the dev server running on :5173)
```

They verify the GW150914 anchors: chirp mass 28.1 M☉, ≈3 M☉c² radiated,
remnant ≈62 M☉ spinning at χf ≈ 0.68, ringdown ≈250–275 Hz.

## Controls

| Input | Effect |
|---|---|
| M₁ / M₂ sliders | masses in solar masses — live mutation, no reset |
| Time scale | 0 (frozen) → 1.0 (real time); default 0.030× slow motion |
| Accretion disks | toggle plasma disks on/off |
| Lensing quality | raymarch step budget: 160 / 256 / 384 |
| Star seed | procedural sky variant |
| Space / R / C | pause · restart · cycle debug views |
| Drag / scroll | orbit and zoom the camera |

## Quality knobs

- `uSteps` (lensing pass) — raymarch iteration budget, the dominant cost.
- Star lattice densities in `src/shaders/starfield.glsl` (30/104/300 cells).
- Bloom threshold/exposure in the composite pass uniforms (`main.js`).

No textures, no external fetches: the sky, disks, and post chain are 100%
procedural GLSL — fully offline-safe.