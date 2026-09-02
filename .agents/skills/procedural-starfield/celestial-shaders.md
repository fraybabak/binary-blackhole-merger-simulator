# Celestial Shaders Reference

Complete shader implementations for night sky rendering: sky dome gradient, starfield
with twinkle and spectral color, Milky Way band, volumetric nebula raymarching, moon
surface with procedural craters, and WGSL compute star generation.

## Sky Dome Fragment Shader

Multi-stop gradient with horizon glow and moon ambient illumination.

```glsl
// sky_dome.frag
precision highp float;

uniform vec3  zenithColor;
uniform vec3  midColor;
uniform vec3  horizonColor;
uniform vec3  horizonGlow;
uniform float glowStrength;
uniform float lightPollution;
uniform vec3  moonPos;
uniform float moonGlowStr;

varying vec3 vWorldDir;

void main() {
  vec3 dir = normalize(vWorldDir);
  float elevation = dir.y; // -1 (nadir) to +1 (zenith)

  // Multi-stop gradient
  vec3 sky;
  if (elevation > 0.3) {
    sky = mix(midColor, zenithColor, (elevation - 0.3) / 0.7);
  } else if (elevation > 0.0) {
    sky = mix(horizonColor, midColor, elevation / 0.3);
  } else {
    sky = mix(horizonGlow, horizonColor, (elevation + 1.0));
  }

  // Horizon glow band
  float horizonBand = exp(-abs(elevation) * 8.0) * glowStrength;
  sky += horizonGlow * horizonBand;

  // Light pollution: warm orange-ish brightening at horizon
  float pollution = exp(-abs(elevation) * 4.0) * lightPollution;
  sky += vec3(0.15, 0.1, 0.05) * pollution;

  // Moon ambient glow
  float moonAngle = max(dot(dir, normalize(moonPos)), 0.0);
  float moonHalo = pow(moonAngle, 16.0) * moonGlowStr;
  float moonWideGlow = pow(moonAngle, 3.0) * moonGlowStr * 0.15;
  sky += vec3(0.6, 0.65, 0.8) * (moonHalo + moonWideGlow);

  // Zodiacal light (faint cone along ecliptic near horizon)
  float zodiacal = exp(-abs(elevation) * 6.0) * 0.02 * (1.0 - lightPollution);
  sky += vec3(0.12, 0.1, 0.08) * zodiacal;

  gl_FragColor = vec4(sky, 1.0);
}
```

## Star Vertex Shader

Magnitude-based sizing, spectral coloring, and multi-frequency twinkle.

```glsl
// star.vert
attribute vec4 aStarData; // rgb color, magnitude

uniform float time;
uniform float twinkleSpeed;
uniform float brightnessExp;
uniform float baseSizePx;
uniform float exposure;

varying vec3  vColor;
varying float vBrightness;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec3 starColor = aStarData.rgb;
  float magnitude = aStarData.w;

  // Magnitude → brightness: each magnitude is ~2.512× dimmer
  // Normalized so mag 0 = 1.0 brightness
  float brightness = pow(2.512, -magnitude) * exposure;

  // Point size from brightness
  float size = baseSizePx * pow(brightness, 0.5);
  size = clamp(size, 0.5, 8.0);

  // Twinkle: multi-frequency scintillation
  float twinklePhase = hash(position.xy) * 6.283;
  float twinkle1 = sin(time * twinkleSpeed * 2.3 + twinklePhase) * 0.15;
  float twinkle2 = sin(time * twinkleSpeed * 5.7 + twinklePhase * 2.0) * 0.08;
  float twinkle3 = sin(time * twinkleSpeed * 11.0 + twinklePhase * 3.0) * 0.04;
  float twinkle = 1.0 + twinkle1 + twinkle2 + twinkle3;

  // Brighter stars twinkle less (they're larger apparent discs)
  float twinkleAmt = mix(1.0, twinkle, clamp(1.0 - brightness * 0.5, 0.2, 1.0));

  vColor = starColor;
  vBrightness = brightness * twinkleAmt;

  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPos;
  gl_PointSize = size * twinkleAmt;
}
```

## Star Fragment Shader

Soft glow falloff for natural star appearance.

```glsl
// star.frag
precision highp float;

uniform float glowFalloff;

varying vec3  vColor;
varying float vBrightness;

void main() {
  vec2 center = gl_PointCoord - 0.5;
  float dist = length(center);

  // Core + glow profile
  float core = smoothstep(0.5, 0.05, dist);
  float glow = exp(-dist * dist / (glowFalloff * glowFalloff)) * 0.6;
  float alpha = core + glow;

  // Bright stars get a slight diffraction spike hint
  float spike = 0.0;
  if (vBrightness > 0.5) {
    float angle = atan(center.y, center.x);
    spike = pow(abs(cos(angle * 2.0)), 32.0) * (1.0 - dist * 3.0);
    spike = max(spike, 0.0) * (vBrightness - 0.5) * 0.3;
  }

  vec3 col = vColor * vBrightness;
  gl_FragColor = vec4(col, (alpha + spike) * vBrightness);
}
```

## Milky Way Fragment Shader

Procedural galactic band with FBM structure, dust lanes, and core brightening.

```glsl
// milky_way.frag
precision highp float;

uniform float brightness;
uniform float bandWidth;
uniform float bandTilt;
uniform float coreGlow;
uniform float dustLanes;
uniform vec3  warmTint;
uniform vec3  coolTint;
uniform float time;

varying vec3 vWorldDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
}

float fbm(vec2 p, int oct) {
  float sum = 0.0, amp = 1.0, maxA = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    sum += noise(p) * amp; maxA += amp;
    amp *= 0.5; p *= 2.1;
  }
  return sum / maxA;
}

void main() {
  vec3 dir = normalize(vWorldDir);

  // Transform to galactic coordinates (tilted band)
  float galLat = dir.y * cos(bandTilt) - dir.z * sin(bandTilt);
  float galLon = atan(dir.x, dir.z * cos(bandTilt) + dir.y * sin(bandTilt));

  // Band envelope
  float band = exp(-galLat * galLat / (bandWidth * bandWidth));

  // FBM structure (star clouds)
  vec2 uv = vec2(galLon * 2.0, galLat * 8.0);
  float structure = fbm(uv * 3.0, 5);
  structure = structure * 0.7 + 0.3;

  // Dust lanes (dark absorbing regions)
  float dust = fbm(uv * 4.0 + 1.7, 4);
  dust = smoothstep(0.35, 0.55, dust) * dustLanes;

  // Core brightening (Sagittarius direction ≈ galLon ≈ 0)
  float core = exp(-galLon * galLon * 2.0) * coreGlow;

  // Combine
  float mw = band * structure * (1.0 - dust) + core * band;
  mw *= brightness;

  // Color: warmer near core, cooler at edges
  vec3 col = mix(coolTint, warmTint, core * 2.0 + 0.3);
  col *= mw;

  // Scattered star-like noise (tiny bright points in the band)
  float starNoise = noise(uv * 80.0);
  starNoise = pow(starNoise, 8.0) * band * 0.3;
  col += vec3(1.0) * starNoise;

  gl_FragColor = vec4(col, mw);
}
```

## Volumetric Nebula Fragment Shader

Raymarched emission nebula with multi-color layering and absorption.

```glsl
// nebula.frag
precision highp float;

uniform vec3  cameraPos;
uniform float nebulaScale;
uniform vec3  color1;
uniform vec3  color2;
uniform vec3  color3;
uniform float density;
uniform float brightness;
uniform float time;
uniform int   nebulaType; // 0=emission, 1=reflection, 2=dark, 3=planetary

varying vec3 vWorldPos;

#define MAX_STEPS 48
#define STEP_SIZE 0.04

vec3 hash3(vec3 p) {
  p = vec3(dot(p, vec3(127.1,311.7,74.7)),
           dot(p, vec3(269.5,183.3,246.1)),
           dot(p, vec3(113.5,271.9,124.6)));
  return fract(sin(p) * 43758.5453);
}

float noise3D(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = dot(hash3(i), f);
  float b = dot(hash3(i + vec3(1,0,0)), f - vec3(1,0,0));
  float c = dot(hash3(i + vec3(0,1,0)), f - vec3(0,1,0));
  float d = dot(hash3(i + vec3(1,1,0)), f - vec3(1,1,0));
  float e = dot(hash3(i + vec3(0,0,1)), f - vec3(0,0,1));
  float f1 = dot(hash3(i + vec3(1,0,1)), f - vec3(1,0,1));
  float g = dot(hash3(i + vec3(0,1,1)), f - vec3(0,1,1));
  float h = dot(hash3(i + vec3(1,1,1)), f - vec3(1,1,1));
  return mix(mix(mix(a,b,f.x), mix(c,d,f.x), f.y),
             mix(mix(e,f1,f.x), mix(g,h,f.x), f.y), f.z);
}

float fbm(vec3 p, int oct) {
  float s = 0.0, a = 1.0, m = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    s += noise3D(p) * a; m += a;
    a *= 0.5; p *= 2.0;
  }
  return s / m;
}

// Ray-box intersection
vec2 boxIntersect(vec3 ro, vec3 rd) {
  vec3 inv = 1.0 / rd;
  vec3 t1 = (-0.5 - ro) * inv;
  vec3 t2 = (0.5 - ro) * inv;
  vec3 tmin = min(t1, t2);
  vec3 tmax = max(t1, t2);
  float near = max(max(tmin.x, tmin.y), tmin.z);
  float far = min(min(tmax.x, tmax.y), tmax.z);
  return vec2(max(near, 0.0), far);
}

void main() {
  vec3 ro = (inverse(modelMatrix) * vec4(cameraPos, 1.0)).xyz;
  vec3 rd = normalize(vWorldPos - cameraPos);
  rd = normalize((inverse(modelMatrix) * vec4(rd, 0.0)).xyz);

  vec2 t = boxIntersect(ro, rd);
  if (t.x > t.y) discard;

  vec4 result = vec4(0.0);
  float step = (t.y - t.x) / float(MAX_STEPS);
  float tt = t.x;

  for (int i = 0; i < MAX_STEPS; i++) {
    if (result.a > 0.95) break;
    vec3 p = ro + rd * tt;

    // Multi-scale density
    float d = fbm(p * 3.0 + time * 0.01, 5);
    d = smoothstep(0.3, 0.7, d) * density;

    if (d > 0.001) {
      // Color layers based on position within volume
      float r = length(p);
      vec3 col;
      if (nebulaType == 3) {
        // Planetary: shell structure
        float shell = abs(r - 0.3);
        d *= exp(-shell * shell * 20.0);
        col = mix(color1, color2, smoothstep(0.2, 0.4, r));
      } else {
        // Emission/reflection: layered color by noise
        float colorNoise = fbm(p * 2.0, 3);
        col = mix(color1, color2, smoothstep(0.3, 0.6, colorNoise));
        col = mix(col, color3, smoothstep(0.55, 0.8, colorNoise));
      }

      // Bright filament highlights
      float filament = pow(fbm(p * 8.0, 4), 3.0);
      col += vec3(1.0) * filament * 0.4;

      // Central glow
      float centralGlow = exp(-r * r * 6.0) * 0.5;
      col += color1 * centralGlow;

      col *= brightness;

      float alpha = 1.0 - exp(-d * step * 20.0);
      result.rgb += col * alpha * (1.0 - result.a);
      result.a += alpha * (1.0 - result.a);
    }

    tt += step;
  }

  if (nebulaType == 2) {
    // Dark nebula: absorb background light
    result.rgb = vec3(0.0);
    result.a = result.a * 0.8;
    gl_FragColor = vec4(result.rgb, result.a);
  } else {
    gl_FragColor = result;
  }
}
```

## Nebula Vertex Shader

Pass world position for raymarching origin calculation.

```glsl
// nebula.vert
varying vec3 vWorldPos;
void main() {
  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
```

## Moon Fragment Shader

Procedural cratered surface with phase-accurate lighting.

```glsl
// moon.frag
precision highp float;

uniform vec3  sunDir;
uniform vec3  moonColor;
uniform vec3  shadowColor;
uniform float craterScale;
uniform float craterDepth;

varying vec3 vNormal;
varying vec3 vPosition;

float hash(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}

// Simplified crater function using Voronoi
float craters(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p);
  float minDist = 1.0;
  for (int x = -1; x <= 1; x++)
  for (int y = -1; y <= 1; y++)
  for (int z = -1; z <= 1; z++) {
    vec3 nb = vec3(float(x), float(y), float(z));
    vec3 pt = vec3(hash(i+nb), hash((i+nb)*1.3), hash((i+nb)*1.7));
    float d = length(nb + pt - f);
    minDist = min(minDist, d);
  }
  return smoothstep(0.0, 0.4, minDist); // Crater rim profile
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 L = normalize(sunDir);

  // Crater surface detail
  float c1 = craters(vPosition * craterScale);
  float c2 = craters(vPosition * craterScale * 3.0) * 0.4;
  float surface = c1 + c2;

  // Perturb normal by crater depth
  vec3 perturbedN = normalize(N + dFdx(surface) * craterDepth * 10.0
                                 + dFdy(surface) * craterDepth * 10.0);

  // Phase lighting
  float NdotL = dot(perturbedN, L);
  float diffuse = max(NdotL, 0.0);

  // Lunar surface: mix lit moonColor with dark shadowColor
  vec3 color = mix(shadowColor, moonColor * surface, diffuse);

  // Subtle limb darkening
  float limbDark = pow(max(dot(N, normalize(-vPosition)), 0.0), 0.3);
  color *= 0.7 + 0.3 * limbDark;

  // Earthshine: very faint illumination on dark side
  float earthshine = max(-NdotL, 0.0) * 0.03;
  color += vec3(0.3, 0.35, 0.5) * earthshine;

  gl_FragColor = vec4(color, 1.0);
}
```

## Moon Vertex Shader

```glsl
// moon.vert
varying vec3 vNormal;
varying vec3 vPosition;
void main() {
  vNormal = normalize(normalMatrix * normal);
  vPosition = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
```

## WGSL Compute: Star Catalog Generation

Generate a large starfield on the GPU with proper spectral distribution.

```wgsl
// star_generate.wgsl
struct Star {
  position: vec4<f32>,  // xyz on unit sphere, w = magnitude
  color: vec4<f32>,     // rgb spectral color, w = twinkle seed
}

@group(0) @binding(0) var<storage, read_write> stars: array<Star>;
@group(0) @binding(1) var<uniform> params: StarGenParams;

struct StarGenParams {
  count: u32,
  radius: f32,
  minMag: f32,
  maxMag: f32,
  seed: f32,
}

fn hash(n: f32) -> f32 { return fract(sin(n) * 43758.5453); }
fn hash2(p: vec2<f32>) -> f32 { return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453); }

fn blackbody(tempK: f32) -> vec3<f32> {
  let t = tempK / 100.0;
  var r: f32; var g: f32; var b: f32;
  if (t <= 66.0) {
    r = 1.0;
    g = (99.47 * log(t) - 161.12) / 255.0;
    if (t <= 19.0) { b = 0.0; }
    else { b = (138.52 * log(t - 10.0) - 305.04) / 255.0; }
  } else {
    r = 329.7 * pow(t - 60.0, -0.1332) / 255.0;
    g = 288.12 * pow(t - 60.0, -0.0755) / 255.0;
    b = 1.0;
  }
  return clamp(vec3<f32>(r, g, b), vec3<f32>(0.0), vec3<f32>(1.0));
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.count) { return; }

  let i = f32(gid.x);
  let s = params.seed + i;

  // Uniform sphere distribution
  let theta = hash(s * 1.1) * 6.283185;
  let phi = acos(2.0 * hash(s * 2.2) - 1.0);
  let pos = vec3<f32>(
    sin(phi) * cos(theta),
    sin(phi) * sin(theta),
    cos(phi)
  ) * params.radius;

  // Magnitude (exponential: many faint, few bright)
  let mag = params.minMag + pow(hash(s * 3.3), 0.4) * (params.maxMag - params.minMag);

  // Temperature from spectral distribution
  let r = hash(s * 4.4);
  var temp: f32;
  if (r < 0.003) { temp = 30000.0 + r * 5000000.0; }
  else if (r < 0.01) { temp = 10000.0 + r * 1000000.0; }
  else if (r < 0.04) { temp = 7500.0 + r * 60000.0; }
  else if (r < 0.11) { temp = 6000.0 + r * 15000.0; }
  else if (r < 0.23) { temp = 5200.0 + r * 5000.0; }
  else if (r < 0.50) { temp = 3700.0 + r * 3000.0; }
  else { temp = 2400.0 + r * 2600.0; }

  let col = blackbody(temp);
  let twinkleSeed = hash(s * 5.5);

  stars[gid.x].position = vec4<f32>(pos, mag);
  stars[gid.x].color = vec4<f32>(col, twinkleSeed);
}
```

## Performance Notes

- **Additive blending everywhere**: All celestial layers use `THREE.AdditiveBlending` — no transparency sorting needed. This is the single biggest performance win.
- **Star twinkle in vertex shader**: Multi-frequency sine with hash-based phase — each star is unique, zero JS cost.
- **Diffraction spikes**: Only computed for stars with `vBrightness > 0.5` (the brightest ~5%). Cheap branch.
- **Nebula step count**: 48 steps is the sweet spot. Below 32 you get banding, above 64 gives diminishing returns.
- **Billboard nebulae**: Pre-bake to canvas once. For animated nebulae, update canvas at 2–4 FPS, not every frame.
- **Moon craters**: Voronoi computed in fragment shader. For static moons, bake to texture once.
