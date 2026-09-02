# Celestial Catalog Reference

Nebula type profiles, deep-sky object presets, constellation data format, eclipse
configurations, and artistic direction for different sky moods.

## Nebula Types

### Emission Nebula

**Character**: Glowing gas clouds ionized by nearby hot stars. Vivid colors —
hydrogen-alpha red/pink, oxygen-III teal/green, sulfur-II orange.

```javascript
const EMISSION = {
  colors: {
    primary: 0xff2266,     // H-alpha (hydrogen, dominant)
    secondary: 0x22aaff,   // OIII (oxygen)
    tertiary: 0xffaa22,    // SII (sulfur)
  },
  density: 0.6,
  brightness: 1.4,
  noiseOctaves: 5,
  filamentStrength: 0.5,
  centralGlow: 0.4,
  examples: ['Orion Nebula (M42)', 'Eagle Nebula (M16)', 'Lagoon Nebula (M8)'],
  artistic: `
    Rich, vivid, and dramatic. Tendrils of glowing gas wrap around dark
    voids. Central regions are brightest with colors bleeding outward.
    Filaments of brighter emission thread through the volume. Think "cosmic
    watercolor" — colors should blend and layer, never feel flat or uniform.
    The Hubble Palette (SHO) maps SII→red, H-alpha→green, OIII→blue for
    extra-vivid false color if desired.
  `,
};
```

### Reflection Nebula

**Character**: Dust clouds reflecting starlight. Blue-dominant (scatters blue
light more efficiently, like Earth's sky).

```javascript
const REFLECTION = {
  colors: {
    primary: 0x4488dd,     // Scattered blue
    secondary: 0x6699cc,   // Cooler blue
    tertiary: 0xaabbdd,    // Pale blue-white
  },
  density: 0.4,
  brightness: 0.8,
  noiseOctaves: 4,
  filamentStrength: 0.2,
  centralGlow: 0.6,        // Central star illumination
  examples: ['Witch Head (IC 2118)', 'Pleiades nebulosity'],
  artistic: `
    Ethereal and delicate. Soft blue glow around a central bright point.
    Less structured than emission — more like a soft diffuse haze. Edges
    fade gently into space. Beautiful when combined with a prominent
    central star. The color is almost always blue due to Rayleigh-like
    scattering physics.
  `,
};
```

### Dark Nebula

**Character**: Dense dust clouds that absorb background starlight. Visible only
as silhouettes against brighter fields.

```javascript
const DARK = {
  colors: {
    primary: 0x000000,     // Pure absorption
    secondary: 0x110808,   // Very faint reddened edges
    tertiary: 0x080808,
  },
  density: 0.8,
  brightness: 0.0,         // Absorbs, doesn't emit
  noiseOctaves: 5,
  filamentStrength: 0.6,   // Dark tendrils reaching out
  examples: ['Horsehead Nebula', 'Barnard 68', 'Coal Sack'],
  artistic: `
    The absence of light as art. Dark nebulae carve dramatic shapes out
    of the star field behind them. Edges can be razor-sharp or soft and
    pillowy. They work best when placed against a rich star background or
    bright emission region. The Horsehead is the classic example — a dark
    silhouette against a red emission backdrop.
  `,
  rendering: `
    Render as opacity mask: high density → high alpha but zero color.
    In the shader, set result.rgb = vec3(0) and use result.a to darken
    background. Requires non-additive blending (NormalBlending).
  `,
};
```

### Planetary Nebula

**Character**: Dying star's expelled shell. Small, bright, often ring or
hourglass shaped. Intense colors.

```javascript
const PLANETARY = {
  colors: {
    primary: 0x00ffaa,     // OIII (very common)
    secondary: 0xff4488,   // H-alpha
    tertiary: 0x4444ff,    // HeII
  },
  density: 0.7,
  brightness: 1.6,
  noiseOctaves: 4,
  shellRadius: 0.3,        // Normalized shell distance from center
  shellWidth: 0.08,
  centralStar: true,
  examples: ['Ring Nebula (M57)', 'Helix Nebula (NGC 7293)', 'Cat\'s Eye (NGC 6543)'],
  artistic: `
    Jewel-like and geometric. Unlike diffuse nebulae, planetaries have
    clear structure — rings, shells, bipolar lobes. A bright central
    white dwarf star sits at the center. Colors can be extremely vivid,
    almost neon. Small scale but intense impact. Think "cosmic gemstone."
    The shell structure creates natural bright edges and dark centers.
  `,
};
```

### Supernova Remnant

**Character**: Expanding shockwave from stellar explosion. Filamentary, energetic,
chaotic structure.

```javascript
const SUPERNOVA_REMNANT = {
  colors: {
    primary: 0xff4422,     // Shock-heated hydrogen
    secondary: 0x22aaff,   // Synchrotron (blue)
    tertiary: 0xffee44,    // Hot ejecta
  },
  density: 0.5,
  brightness: 1.0,
  noiseOctaves: 6,         // High detail for filaments
  filamentStrength: 0.8,   // Very filamentary
  expansionShell: true,
  examples: ['Crab Nebula (M1)', 'Veil Nebula (NGC 6960)', 'Cassiopeia A'],
  artistic: `
    Wild and energetic. Unlike the soft glow of emission nebulae, SNRs
    have sharp filamentary structure — think tangled threads of light.
    Colors can include unusual combinations (red + blue synchrotron).
    Often asymmetric and chaotic. The sense of explosive energy should
    come through in the visual texture. Use high noise octaves for
    detailed filamentary structure.
  `,
};
```

## Deep-Sky Object Presets

Pre-configured objects for quick scene building.

```javascript
const DEEP_SKY_OBJECTS = {
  orionNebula: {
    type: 'emission',
    position: new THREE.Vector3(-80, 40, -300),
    scale: 60,
    colors: [0xff3366, 0x4488cc, 0xffaa44],
    brightness: 1.2,
  },
  pillarsOfCreation: {
    type: 'emission',
    position: new THREE.Vector3(120, 60, -280),
    scale: 45,
    colors: [0xff6633, 0x22aa55, 0x3366cc],
    brightness: 1.0,
  },
  horsehead: {
    type: 'dark',  // Dark against emission background
    position: new THREE.Vector3(-50, 70, -320),
    scale: 30,
    colors: [0x000000, 0x110505, 0x050505],
    brightness: 0,
    backgroundEmission: { color: 0xff3344, brightness: 0.6 },
  },
  ringNebula: {
    type: 'planetary',
    position: new THREE.Vector3(200, 100, -250),
    scale: 20,
    colors: [0x00ffaa, 0xff4488, 0x4444ff],
    brightness: 1.5,
  },
  crabNebula: {
    type: 'supernova_remnant',
    position: new THREE.Vector3(-150, 90, -350),
    scale: 25,
    colors: [0xff4422, 0x22aaff, 0xffee44],
    brightness: 1.0,
  },
  pleiadesCluster: {
    type: 'reflection',
    position: new THREE.Vector3(60, 110, -280),
    scale: 50,
    colors: [0x4488dd, 0x6699cc, 0xaabbdd],
    brightness: 0.7,
    embeddedStars: 7,  // Bright blue stars within
  },
};
```

## Constellation Data Format

Store constellations as star positions + line connections for optional overlays.

```javascript
const CONSTELLATION_FORMAT = {
  name: 'Orion',
  stars: [
    { id: 'betelgeuse', ra: 88.79,  dec: 7.41,  mag: 0.5,  temp: 3500 },
    { id: 'rigel',      ra: 78.63,  dec: -8.20, mag: 0.13, temp: 11000 },
    { id: 'bellatrix',  ra: 81.28,  dec: 6.35,  mag: 1.64, temp: 22000 },
    { id: 'mintaka',    ra: 83.00,  dec: -0.30, mag: 2.23, temp: 30000 },
    { id: 'alnilam',    ra: 84.05,  dec: -1.20, mag: 1.69, temp: 27500 },
    { id: 'alnitak',    ra: 85.19,  dec: -1.94, mag: 1.77, temp: 30000 },
    { id: 'saiph',      ra: 86.94,  dec: -9.67, mag: 2.09, temp: 26000 },
  ],
  lines: [
    ['betelgeuse', 'bellatrix'],
    ['betelgeuse', 'mintaka'],
    ['bellatrix', 'mintaka'],
    ['mintaka', 'alnilam'],
    ['alnilam', 'alnitak'],
    ['alnitak', 'saiph'],
    ['mintaka', 'rigel'],
    ['rigel', 'saiph'],
  ],
};

// Convert RA/Dec to 3D position on sky sphere
function raDecToPosition(ra, dec, radius = 400) {
  const raRad = (ra / 360) * Math.PI * 2;
  const decRad = (dec / 180) * Math.PI;
  return new THREE.Vector3(
    Math.cos(decRad) * Math.cos(raRad) * radius,
    Math.sin(decRad) * radius,
    Math.cos(decRad) * Math.sin(raRad) * radius
  );
}

// Render constellation lines
function drawConstellationLines(scene, constellation, radius = 400) {
  const positions = {};
  for (const star of constellation.stars) {
    positions[star.id] = raDecToPosition(star.ra, star.dec, radius);
  }

  const points = [];
  for (const [a, b] of constellation.lines) {
    points.push(positions[a], positions[b]);
  }

  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const mat = new THREE.LineBasicMaterial({
    color: 0x334466, transparent: true, opacity: 0.3,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  return new THREE.LineSegments(geo, mat);
}
```

## Eclipse Configurations

### Solar Eclipse

Dramatic darkening with corona visible around the moon disc.

```javascript
const SOLAR_ECLIPSE = {
  moonOverlap: 1.0,          // 1.0 = total, 0.5 = partial
  coronaBrightness: 0.8,
  coronaColor: 0xeeeeff,
  skyDarkening: 0.9,          // Nearly night during totality
  horizonSunsetGlow: true,    // 360° sunset at horizon during totality
  diamondRing: true,          // Bright point as moon edge aligns
  rendering: `
    Position moon sprite directly over sun position. Add corona as a
    larger sprite behind moon with radial gradient and noise-modulated
    streamers. During totality, shift sky dome toward night colors and
    enable starfield at reduced brightness. The "diamond ring" effect
    is a single bright point at the moon's edge just before/after totality.
  `,
};
```

### Lunar Eclipse

Moon turns deep red-orange (Earth's atmosphere refracts red light onto moon).

```javascript
const LUNAR_ECLIPSE = {
  umbralCoverage: 1.0,        // 1.0 = total
  moonColor: 0x8b2500,        // Deep blood red
  penumbraColor: 0xcc6633,    // Orange-brown penumbra
  skyBrightening: false,      // Stars become more visible
  rendering: `
    Shift moon material's moonColor toward blood red. The lighting
    direction remains the same but the "sunlight" reaching the moon
    is filtered through Earth's atmosphere — only long wavelengths
    (red/orange) survive. The effect is eerie and beautiful.
  `,
};
```

## Sky Mood Profiles

Artistic direction for different emotional tones.

### Serene / Contemplative

```javascript
const SERENE = {
  starCount: 6000,
  starBrightness: 0.8,       // Slightly dimmed for softness
  milkyWay: 0.15,             // Subtle, not overwhelming
  nebulae: [],                // Clean, uncluttered
  moonPhase: 0.35,            // Crescent — delicate
  meteorRate: 0.05,           // Rare, special moments
  horizonGlow: 0.2,
  palette: 'Cool blues and silvers. No warm tones. Deep, still, quiet.',
};
```

### Awe / Cosmic Wonder

```javascript
const AWE = {
  starCount: 15000,
  starBrightness: 1.2,
  milkyWay: 0.4,              // Rich, prominent
  nebulae: ['orionNebula', 'pillarsOfCreation'],
  moonPhase: 0.0,             // New moon — darkest sky
  meteorRate: 0.3,
  horizonGlow: 0.05,
  palette: 'Maximum contrast. Vivid nebula colors against pure black. Stars should feel infinite.',
};
```

### Romantic / Warm

```javascript
const ROMANTIC = {
  starCount: 5000,
  starBrightness: 0.9,
  milkyWay: 0.1,
  nebulae: [],
  moonPhase: 0.5,             // Full moon — warm glow
  meteorRate: 0.1,            // Occasional shooting star wish
  horizonGlow: 0.4,           // Warm horizon
  palette: 'Warm moonlight. Horizon glows amber. Stars are soft, not sharp. Dreamy.',
};
```

### Ominous / Unsettling

```javascript
const OMINOUS = {
  starCount: 3000,
  starBrightness: 0.6,
  milkyWay: 0.05,
  nebulae: [{ type: 'dark', scale: 150 }],  // Large dark void
  moonPhase: 0.48,            // Almost full, slightly off
  moonTint: 0xffccaa,         // Slightly orange
  meteorRate: 0.0,
  horizonGlow: 0.1,
  palette: 'Desaturated. Dark nebula eats stars. Moon feels too close. Wrong and beautiful.',
};
```

### Fantasy / Dreamy

```javascript
const FANTASY = {
  starCount: 20000,
  starBrightness: 1.5,
  milkyWay: 0.5,              // Exaggerated, vivid
  nebulae: [
    { type: 'emission', colors: [0xff22aa, 0x22ffdd, 0xaa44ff], scale: 100 },
    { type: 'planetary', colors: [0x44ffaa, 0xff44aa, 0x4444ff], scale: 30 },
  ],
  moonPhase: 0.5,
  moonScale: 2.0,             // Oversized moon
  meteorRate: 0.5,
  horizonGlow: 0.3,
  palette: 'Over-saturated, larger-than-life. Break realism for beauty. More nebulae, more color, more magic.',
};
```

## Multi-Moon Configuration

For fantasy/sci-fi scenes with multiple moons.

```javascript
function createMultipleMoons(scene, moons) {
  // moons: array of { phase, elevation, azimuth, radius, color, distance }
  return moons.map(config => {
    const moon = new Moon(scene, {
      radius: config.radius ?? 8,
      distance: config.distance ?? 350,
    });
    moon.material.uniforms.moonColor.value.set(config.color ?? 0xf5f0e0);
    moon.setPhaseAndPosition(config.phase, config.elevation, config.azimuth);
    return moon;
  });
}

// Example: alien world with three moons
const alienMoons = [
  { phase: 0.3, elevation: 55, azimuth: -30, radius: 10, color: 0xf5f0e0 },
  { phase: 0.7, elevation: 30, azimuth: 45, radius: 5, color: 0xffccaa, distance: 380 },
  { phase: 0.1, elevation: 70, azimuth: 10, radius: 3, color: 0xccddff, distance: 420 },
];
```
