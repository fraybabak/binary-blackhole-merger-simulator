# Binary Black Hole Merger Simulator

An interactive, real-time WebGL simulation of two black holes spiraling into
each other and merging — visually grounded in General Relativity and
numerically anchored to **GW150914**, the first gravitational-wave detection.

**Live demo:** [glittering-duckanoo-b3ade7.netlify.app](https://glittering-duckanoo-b3ade7.netlify.app/)

![Inspiral — two black holes orbiting with accretion disks and gravitational
lensing](docs/screenshot-inspiral.png)

Everything is **100% procedural** — no textures, no external assets, no API
calls. The starfield, the accretion disks, the lensing, and the post chain are
all generated in-shader, so the app is fully offline-safe.

---

## What you're looking at

- **The black shadows** are the event horizons. They are *not* painted circles
  — the renderer shoots a light ray through curved spacetime for every pixel,
  and rays that fall into a horizon return pure black.
- **The bright arcs** around the shadows are real **gravitational lensing**:
  light from the background starfield bends around the holes, producing
  Einstein rings and multiple images of the same stars.
- **The glowing rings** are **accretion disks** — plasma spiraling into the
  holes. The side rotating *toward* you is brighter and blue-shifted
  (**Doppler beaming**); the receding side is dimmer and red-shifted. The disk
  wrapping over and under the shadow is the **lensed far side** of the same
  disk, visible because light from behind the hole bends over the top.
- **The wobble at the end** is the merged remnant **ringing down** — a
  distorted black hole settling into a sphere, emitting a final
  gravitational-wave chirp.

---

## How the physics works

The simulation runs two numerical systems in parallel:

### 1. The orbit — post-Newtonian evolution (Web Worker)

The binary's separation $r$, orbital phase $\theta$, and derived quantities
evolve via the **Peters (1964)** radiation-reaction equations, integrated in
**geometric units** ($G = c = 1$) inside a Web Worker so the render thread
never blocks:

$$\frac{dr}{dt} = -\frac{64}{5}\,\frac{m_1 m_2 (m_1+m_2)}{r^3}, \qquad
\Omega = \sqrt{\frac{M}{r^3}}, \qquad
f_{GW} = \frac{\Omega}{\pi}$$

The chirp mass $\mathcal{M} = \frac{(m_1 m_2)^{3/5}}{(m_1+m_2)^{1/5}}$ sets
the frequency evolution; the gravitational-wave luminosity
$L = \frac{32}{5}\frac{m_1^2 m_2^2 M}{r^5}$ sets the energy ledger.
Physical units (km, seconds, Hz) are derived **only at the display boundary**
— the worker itself stays in geometric units, which keeps every mass and
time-scale adjustable without touching the math.

**Inspiral → merger → ringdown** is driven by three checkpoints:

| Phase | Trigger | Physics |
|---|---|---|
| Inspiral | $f_{GW}$ reaches the entry frequency | Peters decay, energy accumulates |
| Merger | $r \le 1.05\,(R_{h1}+R_{h2})$ — horizons touch | NR-anchored fits take over |
| Ringdown | contact | remnant oscillates at the $\ell=m=2$ quasi-normal mode, decaying exponentially |

The **merger and ringdown** use closed-form fits anchored to numerical
relativity, evaluated once at contact:

- **Radiated energy:** $E_{rad} = M\,(0.0572\eta + 0.5392\eta^2)$ where
  $\eta = \frac{m_1 m_2}{M^2}$ — exact at the equal-mass NR value (≈4.8% of
  $M$) and the test-particle plunge limit.
- **Final spin:** $\chi_f = 3.2655\eta - 2.0816\eta^2$ — anchored at the
  equal-mass NR value 0.6864.
- **Ringdown frequency and decay time:** the Berti et al. (2009) fits for the
  $\ell=m=2$ mode: $M_f\omega_{22} = 1.5251 - 1.1568(1-\chi_f)^{0.1292}$.

For GW150914's masses (36 + 29 M☉) these reproduce the published numbers:

| Quantity | Simulation | GW150914 (published) |
|---|---|---|
| Chirp mass | 28.10 M☉ | 28.1 M☉ |
| Energy radiated | 3.06 M☉c² | ≈ 3.0 M☉c² |
| Remnant mass | 61.94 M☉ | ≈ 62 M☉ |
| Final spin $\chi_f$ | 0.680 | ≈ 0.68 |
| Ringdown frequency | 274.6 Hz | ≈ 250 Hz |
| Peak luminosity | ~200 M☉c²/s | 3.6×10⁴⁹ W — briefly brighter than **every star in the observable universe combined** |

### 2. The image — geodesic raymarching (GPU)

For every pixel, the lensing shader fires a ray and integrates it through the
mass-weighted gravitational field of **both** holes using second-order
Runge–Kutta on the null-geodesic form:

$$\vec{a} = -\frac{3}{2}\,\frac{m\,h^2}{r^5}\,\vec{r}, \qquad h = |\vec{r}\times\vec{d}|$$

Step size adapts to the height above the nearest horizon (fine at the photon
sphere for a crisp Einstein ring, coarse in the flat far field). Rays that
dip below $1.02\,r_s$ are captured and render black; rays that escape sample
the procedural starfield along their bent final direction. Because the same
integration shades the disks (at exact equatorial-plane crossings) and the
sky, the primary image, the over/under arcs, and the Einstein-ring images of
the disk all emerge **from the same physics** — nothing is composited.

The **Doppler beaming** is computed per-fragment from the Keplerian disk
velocity $\beta = \sqrt{m/r}$ and the ray direction — the approaching limb
is beamed brighter by $I \propto \delta^{3}$ and blue-shifted through the
blackbody color ramp; the receding limb is dimmed and reddened; the whole
disk is gravitationally red-shifted near the horizon by $\sqrt{1-2m/r}$.

### The Sgr A* preset — Milky Way center

![Sgr A* — the Milky Way's central black hole as a supermassive
binary](docs/screenshot-sgra.png)

Switching to the **Sgr A* — Milky Way center** preset (4.3M + 3.5M M☉ — the
supermassive binary that would merge to form today's Galactic-center black
hole) exercises the same math in a completely different regime:

| Quantity | GW150914 run | Sgr A* run |
|---|---|---|
| GW frequency at start | 16 Hz (LIGO band) | **133 µHz (LISA band)** |
| Inspiral duration | ~0.2 s in band | **~51 hours** |
| Start separation | ~1,500 km | **1.2 AU** |
| Horizon radii | 106 / 86 km | 12.7M / 10.3M km (0.15 AU combined) |
| Ringdown decay τ | 3.7 ms | **7.5 minutes** |

The entry frequency scales as $f_{start} = 1040/M$ Hz — a fixed 16 Hz entry
would place a supermassive binary *inside its own horizon*. Mass-relative
scaling keeps the start separation always ≈7.5× the contact separation, which
is why stellar runs stay unchanged while Sgr A* lands in the physically
correct µHz LISA regime.

---

## Screenshots

### Merger — horizon contact

![Merger — the two horizons touch; the merger-event capture panel freezes the
full data record at the impact moment](docs/screenshot-merger.png)

The red **MERGER EVENT CAPTURED** panel appears at the instant of contact and
freezes the complete data record — peak frequency, peak strain, peak
luminosity, orbital speed at contact, separation, energy ledger, and the
remnant's mass, spin, ringdown frequency and decay time — with a JSON export
button. A red dashed marker pins the moment onto the chirp chart.

### Ringdown — the remnant settles

![Ringdown — a single distorted remnant wobbling at its quasi-normal
mode](docs/screenshot-ringdown.png)

After contact, the remnant is a distorted Kerr black hole. It oscillates at
the $\ell=m=2$ quasi-normal mode while the strain decays exponentially with
the Berti-fitted damping time, then settles into a sphere.

---

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

**Share over a tunnel:** the dev server accepts any Host header
(`allowedHosts: true` in `vite.config.js`) and binds all interfaces, so it
works directly behind ngrok / localtunnel / cloudflared:

```bash
ngrok http 5173
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

## Deploy to Netlify

This project is deployed and live on Netlify:

**https://glittering-duckanoo-b3ade7.netlify.app/**

To deploy your own copy:

**Via the Netlify dashboard / Git integration (recommended):**
1. Push this repository to GitHub/GitLab/Bitbucket.
2. In Netlify: *Add new site → Import an existing project* → pick the repo.
3. Netlify auto-detects Vite from `package.json` — build command
   `npm run build`, publish directory `dist/`. Click **Deploy**.
   No environment variables needed; everything is procedural and
   self-contained (no external assets or APIs).

**Via the Netlify CLI:**
```bash
npm i -g netlify-cli
netlify deploy --build          # preview deploy
netlify deploy --build --prod   # production deploy
```

## Controls

| Input | Effect |
|---|---|
| System preset | GW150914, GW170104, GW170608, equal-mass, high-mass, or **Sgr A*** |
| M₁ / M₂ sliders | masses on a **log scale**, 3 M☉ → 10⁷ M☉ — live mutation, no reset |
| Time scale | 0 (frozen) → 10⁴× fast-forward; Sgr A*'s 51-hour inspiral fits in ~20 s |
| Accretion disks | toggle the Doppler-beamed plasma on/off |
| Lensing quality | raymarch step budget: 160 / 256 / 384 |
| Star seed | procedural sky variant (0–200) |
| Space / R / C | pause · restart · cycle debug views |
| Drag / scroll | orbit and zoom the camera |

The HUD shows every metric with a **descriptive companion line** — e.g. the
GW frequency notes which detection band it's in, the energy radiated is
compared to the Sun's lifetime output, horizons are given in Sun radii or AU,
and durations read as µs/ms/s/min/h/days/years as the run's timescale
demands. A live **chirp-envelope chart** tracks strain amplitude and
frequency through the inspiral.

## Validation

Four dev-only validation scripts are included:

```bash
node physics-check.mjs    # headless physics: chirp, merger, ringdown, NR-fit anchors
node render-check.mjs     # headless WebGL: shader compile + screenshot analysis
node hud-check.mjs        # HUD/controls: descriptors, chart, merger capture
node screenshots.mjs      # regenerate the docs/ screenshots
# (render-check, hud-check, screenshots need the dev server on :5173)
```

They verify the GW150914 anchors listed above, the Sgr A* LISA-band regime
(133 µHz start, 51 h inspiral, 1.2 AU separation), and that the merger-event
capture fires with the correct remnant parameters.

## Project layout

```
├── index.html                  # HUD + controls markup
├── vite.config.js              # ES-module workers, tunnel-friendly dev server
├── vercel.json                 # Vercel deploy config
├── src/
│   ├── main.js                 # render thread: camera, lensing pass, bloom chain, HUD
│   ├── physics.worker.js       # post-Newtonian orbit integration (G = c = 1)
│   ├── state-layout.js         # shared snapshot layout (worker → render thread)
│   ├── styles.css              # HUD/controls chrome
│   └── shaders/
│       ├── lensing.frag        # per-pixel geodesic raymarch (both holes + remnant)
│       ├── starfield.glsl      # procedural sky: hash stars, FBM galaxy, dust
│       ├── accretion-disk.glsl # Doppler-beamed, FBM-swirled plasma shading
│       └── post.frag           # bright-pass / blur / composite (ACES + grain)
└── docs/                       # screenshots
```

## Quality knobs

- `uSteps` (lensing pass) — raymarch iteration budget, the dominant GPU cost.
- Star lattice densities in `src/shaders/starfield.glsl` (30/104/300 cells).
- Bloom threshold/exposure in the composite pass uniforms (`main.js`).

## License

MIT — do whatever you like; attribution appreciated.