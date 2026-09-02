# Procedural Starfield & Celestial Phenomena - Three.js Skill

A Claude Code skill for generating stunning procedural night skies in Three.js — from scientifically-grounded starfields to dreamy nebulae to dramatic celestial events. **WebGPU compute with WebGL2 fallback**.

Part of the **Teaching Three.js** skill series.

## What This Skill Does

When installed, this skill teaches Claude Code how to generate complete night skies including:

- **Starfield** with blackbody spectral colors (O through M class), magnitude-based brightness/sizing, multi-frequency twinkle, and diffraction spikes on bright stars
- **Sky dome** with multi-stop gradient, horizon glow, light pollution, zodiacal light, and moon halo
- **Milky Way** band with FBM structure, dust lane subtraction, Sagittarius core brightening, and warm/cool tinting
- **Nebulae** — 5 types: emission (H-alpha/OIII/SII), reflection (blue scattering), dark (absorption silhouettes), planetary (shell structures), supernova remnants (filamentary). Volumetric raymarching on WebGPU, billboard sprites on WebGL
- **Moon** with procedural Voronoi craters, phase-accurate lighting, earthshine on dark side, and atmospheric glow sprite
- **Shooting stars / meteors** with flare-and-fade lifecycle and configurable shower rates
- **Comets** with dual-tail rendering (straight ion tail + curved dust tail)
- **Eclipses** — solar (corona, diamond ring) and lunar (blood red)
- **Constellations** with RA/Dec star positioning and line overlays
- **Deep-sky presets** — Orion, Pillars of Creation, Horsehead, Ring, Crab, Pleiades
- **Sky controller** orchestrating all layers with time-of-night progression
- **WGSL compute** for GPU star catalog generation with spectral distribution

## Installation

### Claude Code (CLI)

```bash
claude install-skill path/to/procedural-starfield
```

Or copy the `procedural-starfield/` folder into your Claude Code skills directory.

### Manual Usage

| File | Purpose |
|------|---------|
| `SKILL.md` | Main skill — all 7 layers, celestial bodies, controller, presets |
| `references/celestial-shaders.md` | Complete GLSL/WGSL for stars, sky dome, Milky Way, nebula, moon |
| `references/celestial-catalog.md` | 5 nebula types, deep-sky presets, constellations, eclipses, mood profiles |

## Quick Start Prompts

> "Create a pristine mountain night sky with vivid Milky Way and shooting stars"

> "Build a deep space scene with emission nebulae and dense starfield"

> "Generate a full moon night with soft horizon glow and twinkling stars"

> "Create an alien sky with three moons and colorful nebulae"

> "Build a night sky with Orion constellation highlighted and proper star colors"

> "Create a meteor shower scene with 15,000 stars on a new moon night"

> "Generate a fantasy starfield with oversized moon and vivid purple-pink nebulae"

## Requirements

- **Three.js r170+** for WebGPU support and TSL node materials
- WebGPU browser (Chrome 121+, Edge 121+) for volumetric nebula raymarching and compute
- WebGL2 fallback (billboard nebulae, vertex-shader stars) works everywhere

## Skill Architecture

```
procedural-starfield/
├── SKILL.md                           # Core skill (read first)
├── README.md                          # This file
└── references/
    ├── celestial-shaders.md           # GLSL, WGSL shader code
    └── celestial-catalog.md           # Nebula types, objects, constellations, moods
```

## Key Concepts

### Layered Rendering

The night sky is composed of 7 additive layers, all using `THREE.AdditiveBlending` — no transparency sorting needed:

| Layer | Content | Draw Calls |
|-------|---------|-----------|
| 1. Sky Dome | Gradient + horizon glow | 1 |
| 2. Stars | Points with spectral color | 1 |
| 3. Milky Way | FBM band on sphere | 1 |
| 4. Nebulae | Raymarched or billboard | 1–3 |
| 5. Celestial Bodies | Moon + glow | 2 |
| 6. Transients | Meteors, comets | 0–3 |
| 7. Deep Space | Galaxies, clusters | 0–2 |

**Total: 5–8 draw calls** for a complete night sky.

### Scientifically-Grounded Star Colors

Stars aren't white. Each star gets a temperature from the real spectral class distribution (76% red M-class, 12% orange K, 8% yellow G, etc.) converted to RGB via blackbody radiation. The result: a naturally warm-toned starfield with rare blue-white jewels.

### Five Nebula Types

Each type has distinct physics, appearance, and artistic character — from the vivid tendrils of emission nebulae to the ghostly absorption of dark nebulae to the jewel-like shells of planetary nebulae.

## Sky Mood Presets

| Preset | Feel | Stars | Milky Way | Moon |
|--------|------|-------|-----------|------|
| Pristine Mountain | Awe | 12K | Vivid | New |
| Full Moon Night | Romantic | 4K | Faint | Full |
| Suburban | Familiar | 2K | Hidden | Quarter |
| Meteor Shower | Exciting | 10K | Rich | New |
| Deep Space | Cosmic | 20K | Maximum | None |
| Fantasy | Dreamy | 20K | Exaggerated | Oversized |

## Series: Teaching Three.js

Independent skills that compose for complete environments:

- [procedural-landscapes](../procedural-landscapes/) — terrain
- [procedural-grass](../procedural-grass/) — ground cover
- [procedural-clouds](../procedural-clouds/) — daytime skies
- [procedural-weather](../procedural-weather/) — precipitation and atmosphere
- **procedural-starfield** ← this skill — night skies and celestial phenomena

## License

MIT — use freely in your projects.
