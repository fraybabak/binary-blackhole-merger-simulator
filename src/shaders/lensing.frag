// ─────────────────────────────────────────────────────────────────────────────
// lensing.frag — full-screen geodesic raymarch for a binary black hole.
//
// Per pixel: build a camera ray, integrate it through the mass-weighted
// gravitational field of BOTH holes (RK2 on the standard null-geodesic form,
// with the effective-potential term used for each mass), detect capture by
// either horizon, shade any orbital-plane (y=0) disk crossings found along the
// bent path, and sample the procedural starfield with the escaped direction.
// Einstein rings emerge naturally from the integration, not as a painted ring.
//
// Scene units: G = c = 1, 1 unit = G·M_total/c². Horizons at r = 2m̃ per hole.
// ─────────────────────────────────────────────────────────────────────────────

precision highp float;

uniform vec2  uRes;        // render target size, pixels
uniform float uT;          // wall-clock time, s (for grain/twinkle animation)
uniform vec3  uPos;        // camera position, world space
uniform vec3  uRt, uUp, uFw; // camera right/up/forward basis vectors
uniform float uFov;        // tan(fov/2)
uniform float uSteps;      // raymarch step cap (quality knob)
uniform float uStarSeed;   // sky seed
uniform int   uDebugMode;  // 0 final · 1 escape dir · 2 transmittance

// Binary state (scene units; all from the physics worker snapshot)
uniform vec3  uPos1;       // hole 1 position
uniform vec3  uPos2;       // hole 2 position
uniform vec3  uPosR;       // remnant center (rings down to a stop)
uniform float uM1;         // hole 1 mass (≤ 1 before merger, remnant after)
uniform float uM2;         // hole 2 mass (→ 0 through the merger envelope)
uniform float uMR;         // remnant mass, scene units
uniform float uPhase;      // 0 inspiral · 1 merger · 2 ringdown · 3 settled
uniform float uEscapeR;    // escape radius, scene units (camera-relative; set from JS)

varying vec2 vUv;

#define MAX_STEPS 512
#define ESCAPE_R2 6400.0   // r² > 6400 (r > 80 scene units) ⇒ escaped
#define DT_NEAR 0.05       // near-hole step floor, scene units
#define DT_FAR  0.7        // far-field step ceiling
#define HORIZON_MARGIN 1.02 // capture radius: 1.02 × Schwarzschild radius
#define CAPTURE_BRIGHTNESS 0.0 // rays inside the horizon render absolutely black

${STARFIELD}

${DISK}

// Mass-weighted null-geodesic acceleration through the combined binary field.
// For each mass: a = −(3/2)·m̃·h²·d/r⁵, where h = |d × dir| is the ray's
// angular momentum about that mass and d the displacement vector to it.
// Far away the superposition reduces to the monopole field of M_total; near
// each hole the local term dominates and reproduces that hole's capture radius.
vec3 geodesicAccel(vec3 pos, vec3 dir) {
  vec3 a = vec3(0.0);

  vec3 d1 = pos - uPos1;
  float r1 = max(length(d1), 1e-4);
  vec3 h1 = cross(d1, dir);
  float b1sq = dot(h1, h1) * uM1;
  a += -1.5 * b1sq * d1 / (r1 * r1 * r1 * r1 * r1);

  vec3 d2 = pos - uPos2;
  float r2 = max(length(d2), 1e-4);
  vec3 h2 = cross(d2, dir);
  float b2sq = dot(h2, h2) * uM2;
  a += -1.5 * b2sq * d2 / (r2 * r2 * r2 * r2 * r2);

  vec3 dR = pos - uPosR;
  float rR = max(length(dR), 1e-4);
  vec3 hR = cross(dR, dir);
  float bRsq = dot(hR, hR) * uMR;
  a += -1.5 * bRsq * dR / (rR * rR * rR * rR * rR);

  return a;
}

// Horizon capture test against all three masses. Rays captured by a horizon
// render absolutely black — light emitted inside never escapes.
bool captured(vec3 pos, float margin) {
  float rc1 = 2.0 * uM1 * margin;  // Schwarzschild radius × margin
  float rc2 = 2.0 * uM2 * margin;
  float rcR = 2.0 * uMR * margin;
  return (uM1 > 0.004 && dot(pos - uPos1, pos - uPos1) < rc1 * rc1)
      || (uM2 > 0.004 && dot(pos - uPos2, pos - uPos2) < rc2 * rc2)
      || (uMR > 0.004 && dot(pos - uPosR, pos - uPosR) < rcR * rcR);
}

void main() {
  // Screen → camera ray.
  vec2 ndc = vUv * 2.0 - 1.0;
  ndc.x *= uRes.x / uRes.y;
  vec3 rd = normalize(uFw + uFov * (ndc.x * uRt + ndc.y * uUp));

  vec3 pos = uPos;
  vec3 dir = rd;
  vec3 col = vec3(0.0);
  float T = 1.0;           // transmittance
  bool esc = false;
  vec3 ed = dir;           // escape direction
  float stepsTaken = 0.0;
  float hit = 0.0;

  for (int i = 0; i < MAX_STEPS; i += 1) {
    if (float(i) >= uSteps) break;

    if (captured(pos, HORIZON_MARGIN)) { hit = 1.0; break; }

    // Escaped: far outside the field and receding from the origin. The radius
    // is camera-relative so zooming out never strands rays mid-integration.
    float escR = max(uEscapeR, sqrt(ESCAPE_R2));
    float r2f = dot(pos, pos);
    if (r2f > escR * escR && dot(pos, dir) > 0.0) {
      esc = true;
      ed = normalize(dir);
      break;
    }

    // Step scales with the height ABOVE the nearest horizon: fine at the
    // photon sphere (crisp Einstein ring), coarse in the flat far field.
    float r1 = length(pos - uPos1);
    float r2 = length(pos - uPos2);
    float rR = length(pos - uPosR);
    float h1 = r1 - 2.0 * uM1;
    float h2 = r2 - 2.0 * uM2;
    float hR = rR - 2.0 * uMR;
    float hmin = min(min(h1, h2), hR);
    float dt = clamp(0.25 * max(hmin, 0.0), DT_NEAR, DT_FAR);

    // RK2 (midpoint) integration of the bent ray.
    vec3 a1 = geodesicAccel(pos, dir);
    vec3 pm = pos + dir * (dt * 0.5);
    vec3 vm = dir + a1 * (dt * 0.5);
    vec3 a2 = geodesicAccel(pm, vm);
    vec3 pn = pos + vm * dt;
    vec3 vn = dir + a2 * dt;

    // Disk crossing: the equatorial plane y = 0 crossed between prev and next.
    if (pos.y * pn.y < 0.0) {
      float f = pos.y / (pos.y - pn.y);
      vec3 hp = mix(pos, pn, f);
      vec3 hd = normalize(mix(dir, vn, f));
      shadeDiskCrossings(hp, hd, col, T);
      if (T < 0.02) break;
    }

    pos = pn;
    dir = vn;
    stepsTaken = float(i) + 1.0;
  }

  // Capped rays get a defined result: near the holes that is capture (black);
  // anywhere else they route to mean radiance rather than speckling an
  // arbitrary point sample of the sky.
  if (!esc && hit < 0.5) {
    float rmin = min(min(length(pos - uPos1), length(pos - uPos2)), length(pos - uPosR));
    if (rmin < 4.0) hit = 1.0;
    else { esc = true; ed = normalize(dir); }
  }

  // Debug views.
  if (uDebugMode == 1) {
    col = esc ? ed * 0.5 + 0.5 : vec3(0.04, 0.0, 0.0);
  } else if (uDebugMode == 2) {
    col = vec3(T);
  } else {
    if (esc) {
      // Ray-bundle footprint: widens where lensing compresses solid angle, so
      // the starfield is footprint-filtered (mean radiance, not speckle).
      float foot = clamp(0.5 * (length(dFdx(ed)) + length(dFdy(ed))), 0.0, 0.06);
      col += T * backgroundSky(ed, uStarSeed, foot);
    } else if (hit > 0.5) {
      col = vec3(0.0); // absolute black inside the horizon
    }
    col = min(col, vec3(64.0)); // HDR clamp feeding the bloom chain
  }

  if (any(notEqual(col, col))) col = vec3(0.0); // NaN guard
  gl_FragColor = vec4(col, 1.0);
}