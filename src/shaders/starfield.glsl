// ─────────────────────────────────────────────────────────────────────────────
// starfield.glsl — procedural background sampled by the lensing pass.
//
// Directional field evaluated on the bent (escaped) ray direction only, so the
// image is lensed correctly rather than a swirl of an already rendered image.
// Everything is hash/FBM-based: no textures, fully offline-safe.
// ─────────────────────────────────────────────────────────────────────────────

// Integer-hash noise family (Dave Hoskins) — the workhorse of the whole shader.
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
vec2 hash23(vec3 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + vec2(p3.y, p3.z)) * p3.zy);
}
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

// 3D value noise + 4-octave FBM.
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = hash13(i + vec3(0.0, 0.0, 0.0));
  float b = hash13(i + vec3(1.0, 0.0, 0.0));
  float c = hash13(i + vec3(0.0, 1.0, 0.0));
  float d = hash13(i + vec3(1.0, 1.0, 0.0));
  float e = hash13(i + vec3(0.0, 0.0, 1.0));
  float g = hash13(i + vec3(1.0, 0.0, 1.0));
  float h = hash13(i + vec3(0.0, 1.0, 1.0));
  float k = hash13(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y),
             mix(mix(e, g, u.x), mix(h, k, u.x), u.y), u.z);
}
float fbm(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i += 1) {
    s += a * vnoise(p);
    p = p * 2.02 + vec3(11.7, 7.3, 5.1);
    a *= 0.5;
  }
  return s;
}

// Planck-locus blackbody color; temperature sets hue only (not brightness).
vec3 blackbody(float tK) {
  float t = clamp(tK, 1000.0, 40000.0) * 0.01;
  float r, g, b;
  if (t <= 66.0) {
    r = 255.0;
    g = 99.4708025861 * log(t) - 1.611195681661e2;
  } else {
    r = 329.698727446 * pow(t - 60.0, -0.1332047592);
    g = 288.1221695283 * pow(t - 60.0, -0.0755148492);
  }
  if (t >= 66.0) {
    b = 255.0;
  } else if (t <= 19.0) {
    b = 0.0;
  } else {
    b = 138.5177312231 * log(t - 10.0) - 305.0447927307;
  }
  vec3 c = clamp(vec3(r, g, b) / 255.0, 0.0, 1.0);
  return c * c;
}

// Star layer: a cube-face lattice — one candidate star per cell, flux-conserving
// point spread tied to the ray-bundle footprint `foot` (see lensing pass).
// uStarSeed shifts the lattice so different skies can be dialed in.
vec3 starLayer(vec3 D, float cells, float dens, float lum, float seed, float foot) {
  vec3 aD = abs(D);
  float face = 0.0;                    // dominant cube face
  if (aD.y >= aD.x && aD.y >= aD.z) face = D.y < 0.0 ? 1.0 : 2.0;
  else if (aD.z >= aD.x) face = D.z < 0.0 ? 3.0 : 4.0;
  else face = D.x < 0.0 ? 5.0 : 6.0;
  vec2 uv;
  if (face < 2.5) uv = D.xz;
  else if (face < 4.5) uv = D.xy;
  else uv = D.yz;
  uv = uv / max((face < 2.5 ? aD.y : (face < 4.5 ? aD.z : aD.x)), 1e-4);
  vec3 col = vec3(0.0);
  // 3×3 cell neighbourhood scan
  vec2 cellAng = vec2(1.0 / cells);
  vec2 cbase = uv * cells - 0.5;
  for (int i = -1; i <= 1; i += 1) {
    for (int j = -1; j <= 1; j += 1) {
      vec2 cell = floor(cbase) + vec2(float(i), float(j));
      vec3 h = hash33(vec3(cell, face * 17.0 + seed));
      // existence threshold from the star's own direction, not the pixel's
      vec2 sp = (cell + 0.5 + (h.xy - 0.5) * 0.9) / cells;
      float u0 = max(hash13(vec3(cell, face * 13.0 + seed)), 0.004); // clamp the N(m) power-law tail
      float giant = step(0.972, u0);
      float flux = lum * pow(u0, -2.0/3.0) * mix(1.0, 2.3, giant);
      if (h.z <= dens && flux > 2e-4) {
        float d = length(uv - sp);
        float S0 = 0.0003;               // intrinsic angular radius, radians
        // spread widens with the ray-bundle footprint (never below S0, never
        // beyond half a cell), and the peak scales as S0²/s² so total flux is
        // invariant — compression at a lensing rim brightens the star.
        float s = clamp(max(foot, S0), S0, 0.5 / cells);
        float k = (S0 * S0) / (s * s);    // flux-conserving peak
        float I = flux * k * (exp(-0.5 * d * d / (s * s)) + 0.005 * exp(-d * d / (18.0 * s * s)));
        // spectral colour: temperature correlated with flux (hotter = brighter),
        // red giants deliberately break the correlation
        float ts = clamp(0.62 * pow(u0, 6.5) + 0.38 * (1.0 - pow(u0, 0.30)), 0.0, 1.0);
        ts = mix(ts, 0.015 + 0.05 * u0, giant);
        vec3 colT = blackbody(mix(2700.0, 24000.0, ts));
        vec3 tint = mix(vec3(1.0), colT, clamp(0.35 + 0.55 * log2(1.0 + 6.0 * flux), 0.35, 1.0));
        col += I * tint;
      }
    }
  }
  return col;
}

// One galaxy model: milky band + bulge, ridged-multifractal dust, wavelength-
// dependent extinction, arm-gated emission/reflection nebula complexes.
vec3 galaxyField(vec3 D, float seed, vec3 pole, vec3 core, float scaleH, float sDens, float sLum, float dustAmp, vec3 armTint, vec3 bulgeTint, float foot) {
  float sb = dot(D, pole);
  float lon = 0.42 + 0.58 * smoothstep(-0.55, 0.95, dot(D, core));
  float disc = exp(-0.5 * sb * sb / (scaleH * scaleH));
  float dpl = exp(-0.5 * sb * sb / pow(0.55 * scaleH, 2.0));
  float bulge = pow(max(dot(D, core), 0.0), 3.2) * exp(-0.5 * sb * sb / (0.11 * 0.11));

  // Domain-warped ridged multifractal → dust filaments, not blobs.
  vec3 q = D * 3.1 + vec3(seed * 17.0);
  vec3 w = vec3(fbm(q + vec3(0.0)), fbm(q + vec3(5.2)), fbm(q + vec3(9.7)));
  float fil = 1.0 - abs(2.0 * fbm(D * 2.2 + 7.0 * w) - 1.0);
  float bulk = fbm(D * 1.5 + w.xyy);
  float tau = dustAmp * dpl * lon * (0.30 * bulk + 1.25 * smoothstep(0.34, 0.88, fil) * (0.35 + 0.65 * bulk));
  vec3 ext = exp(-tau * vec3(1.00, 1.24, 1.52));   // A ~ 1/λ: dimmed AND reddened

  // Unresolved starlight: band + bulge, tinted and extincted.
  vec3 unresolved = (armTint * disc * lon + bulgeTint * bulge) * ext;
  vec3 col = unresolved;

  // Arm-gated emission + reflection nebulae; ~half the dust sits in front.
  float detail = 1.0 - smoothstep(0.0035, 0.028, foot);
  float armGate = smoothstep(0.38, 0.82, fbm(D * 2.6 + w.zzx + vec3(seed * 7.3)));
  vec3 neb = vec3(0.32, 0.16, 0.42) * pow(fbm(D * 3.4 + w.xxy), 2.2) + vec3(0.10, 0.24, 0.38) * pow(fbm(D * 4.6 - w.yzz), 2.6);
  col += armGate * neb * disc * detail * sqrt(ext);
  return col;
}

// Full sky: three star populations + the galaxy field, all footprint-filtered.
vec3 backgroundSky(vec3 D, float seed, float foot) {
  vec3 col = galaxyField(D, seed,
    normalize(vec3(0.22, 0.92, 0.31)),            // galactic pole
    normalize(vec3(-0.41, 0.03, 0.91)),           // galactic core direction
    0.185,                                          // band half-thickness
    1.0, 1.0,                                      // base density/luminosity
    1.15,                                           // dust amplitude
    vec3(0.30, 0.26, 0.22),                        // cool arm tint
    vec3(0.42, 0.30, 0.18),                        // warm bulge tint
    foot);
  col += starLayer(D, 30.0, 0.46, 0.60, seed + 1.0, foot);
  col += starLayer(D, 104.0, 0.34, 0.18, seed + 11.0, foot);
  col += starLayer(D, 300.0, 0.22, 0.055, seed + 23.0, foot);
  return col;
}