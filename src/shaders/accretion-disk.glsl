// ─────────────────────────────────────────────────────────────────────────────
// accretion-disk.glsl — plasma disk shading for the geodesic lensing pass.
//
// The disks are shaded at the exact y=0 plane crossings found by the ray
// integrator, which is what produces the Interstellar look: the primary image,
// the arc over/under the shadow, and the secondary Einstein-ring images all
// emerge from the same integration, lensed consistently with the starfield.
//
// Doppler beaming is computed per-fragment from the disk rotation rate and the
// fragment position (never in JS): the limb rotating toward the camera is
// brighter and blue-shifted, the receding limb dimmer and red-shifted, and the
// whole disk is additionally gravitationally red-shifted near the horizon.
//
// Declares its own uniforms (assembled once, before this file, in main.js).
// Requires hash13 / vnoise / fbm / blackbody from starfield.glsl.
// ─────────────────────────────────────────────────────────────────────────────

uniform float uDiskTime;   // visual swirl clock (wall-seconds; see physics worker)
uniform float uDiskIn1;    // disk 1 inner radius, scene units (Schwarzschild ISCO = 6 m̃)
uniform float uDiskOut1;   // disk 1 outer radius, scene units (Roche-truncated)
uniform float uDiskGain1;  // disk 1 brightness multiplier (merger crossfade)
uniform float uTemp1;      // disk 1 effective temperature at the inner edge, K
uniform float uDiskIn2;
uniform float uDiskOut2;
uniform float uDiskGain2;
uniform float uTemp2;
uniform float uDiskInR;    // remnant disk inner radius (Kerr ISCO, Bardeen formula)
uniform float uDiskOutR;
uniform float uDiskGainR;
uniform float uTempR;
// NOTE: uPos1/uM1, uPos2/uM2 and uPosR/uMR are declared by the lensing pass
// preamble (lensing.frag) and are shared — do NOT redeclare them here.

#define DISK_BEAM 3.0      // Doppler beaming exponent: I ∝ δ^(3+α), α ≈ 0
#define DISK_EMISSIVE 14.0 // emission scale (HDR, pre-tonemap)
#define DISK_SWIRL 1.0     // swirl-clock rate multiplier (visual)

// Shade one crossing of one disk.
//   p     crossing point, world space (y = 0)
//   rd    ray direction at the crossing (photon travel direction, camera → scene)
//   c     disk center (the hole), world space
//   m     hole mass, scene units (G = c = 1 in scene units)
//   rIn   inner radius, scene units
//   rOut  outer radius, scene units
//   gain  brightness multiplier from the physics worker
//   tempK effective inner-edge temperature, kelvin
// Returns premultiplied emission (rgb) and coverage (a).
vec4 shadeDisk(vec3 p, vec3 rd, vec3 c, float m, float rIn, float rOut, float gain, float tempK) {
  if (gain <= 0.002 || m <= 0.004 || rOut <= rIn) return vec4(0.0);

  vec3 rel = p - c;
  float r = length(rel.xz); // cylindrical radius in the orbital plane
  if (r < rIn * 0.98 || r > rOut) return vec4(0.0);

  // Radial band fades: soften the ISCO edge and the Roche-truncated rim.
  float fadeIn = smoothstep(rIn, rIn * 1.12, r);
  float fadeOut = 1.0 - smoothstep(rOut * 0.55, rOut, r);
  float fade = fadeIn * fadeOut;
  if (fade < 0.002) return vec4(0.0);

  // Keplerian differential rotation: Ω = √(m/r³) in scene units. The swirl
  // pattern is evaluated in the co-rotating frame, so flow shears with radius.
  float rr = max(r, 1e-4);
  float om = sqrt(m / max(rr * rr * rr, 1e-6));
  float ang = atan(rel.z, rel.x) - om * uDiskTime * DISK_SWIRL;
  vec3 q = vec3(cos(ang) * r, sin(ang) * r, 0.35 * r);
  float n = fbm(q * 1.15 + vec3(0.0, 0.0, uDiskTime * 0.05));
  float dens = 0.30 + 0.70 * smoothstep(0.32, 0.85, n);
  dens *= 0.78 + 0.34 * vnoise(q * 4.2);

  // Emission profile peaks at the inner edge and falls off outward.
  float em = pow(max(1.0 - sqrt(rIn * 0.95 / rr), 0.0), 0.6) * pow(rIn / rr, 2.0);

  // ── Relativistic shifts, both computed per-fragment ──────────────────────
  // Orbital speed (Keplerian, β = √(m/r), kept below plunge speeds).
  float v = clamp(sqrt(m / max(rr, 2.2 * m)), 0.0, 0.92);
  // Disk velocity direction from the rotation sense and the fragment position.
  vec3 tang = normalize(vec3(-rel.z, 0.0, rel.x));
  // μ = cos(angle between plasma velocity and the emitter→observer direction;
  // the traced ray rd points away from the camera, so the observer is at −rd).
  float mu = dot(tang, -rd);
  float dop = sqrt(1.0 - v * v) / (1.0 - v * mu);  // special-relativistic Doppler
  float gsh = sqrt(max(1.0 - 2.0 * m / rr, 0.03)); // gravitational redshift
  float s = dop * gsh;                             // total frequency ratio

  // Blackbody hue shifted by the total factor; brightness beamed by s³.
  vec3 col = blackbody(tempK * pow(rIn / rr, 0.75) * s);
  float I = em * dens * pow(s, DISK_BEAM);
  vec3 rgb = col * I * gain * DISK_EMISSIVE;

  // Hot inner rim: a bright clump orbiting just outside the ISCO.
  float rh = rIn * 1.30;
  float ah = 0.7071 * pow(rh, -1.5) * uDiskTime * DISK_SWIRL + 1.7;
  vec2 hp = vec2(cos(ah), sin(ah)) * rh;
  vec2 dv = rel.xz - hp;
  rgb += blackbody(tempK * 1.3 * s) * exp(-dot(dv, dv) * 5.0) * 9.0 * pow(s, DISK_BEAM) * gain;

  float alpha = clamp(dens * 1.25, 0.0, 1.0) * fade;
  return vec4(rgb * fade, alpha);
}

// Shade all three disks at one plane crossing (remnant + both binary disks).
// Emission accumulates front-to-back into the running transmittance.
// uPos1/uM1 and uPos2/uM2 (the holes) come from the lensing pass preamble.
void shadeDiskCrossings(vec3 hp, vec3 hd, inout vec3 col, inout float T) {
  vec4 d1 = shadeDisk(hp, hd, uPos1, uM1, uDiskIn1, uDiskOut1, uDiskGain1, uTemp1);
  if (d1.a > 0.0) { col += T * d1.rgb; T *= 1.0 - d1.a; }

  vec4 d2 = shadeDisk(hp, hd, uPos2, uM2, uDiskIn2, uDiskOut2, uDiskGain2, uTemp2);
  if (d2.a > 0.0) { col += T * d2.rgb; T *= 1.0 - d2.a; }

  vec4 dR = shadeDisk(hp, hd, uPosR, uMR, uDiskInR, uDiskOutR, uDiskGainR, uTempR);
  if (dR.a > 0.0) { col += T * dR.rgb; T *= 1.0 - dR.a; }
}