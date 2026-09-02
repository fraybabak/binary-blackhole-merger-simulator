// ─────────────────────────────────────────────────────────────────────────────
// post.frag — three post-processing pass sources. main.js splits this file on
// the __PASS__ section markers (one per pass) and assembles each section into
// its own full-screen ShaderMaterial; every section is a complete GLSL entry.
//
//   BRIGHT__     threshold the HDR lensing target (soft knee)
//   BLUR__       5-tap separable Gaussian (half & quarter res)
//   COMPOSITE__  scene + bloom, chromatic aberration, ACES, vignette, grain
// ─────────────────────────────────────────────────────────────────────────────

//__PASS__BRIGHT__
uniform sampler2D tex;
uniform float uThresh; // bloom threshold, HDR radiance units
varying vec2 vUv;

void main() {
  vec3 c = texture2D(tex, vUv).rgb;
  c = min(max(c, vec3(0.0)), vec3(48.0)); // clamp inputs (HDR headroom)
  if (any(notEqual(c, c))) c = vec3(0.0);  // NaN guard
  float l = max(max(c.r, c.g), c.b);
  float k = max(l - uThresh, 0.0);
  k = k / (k + 0.6); // soft-knee response
  gl_FragColor = vec4(c * k, 1.0);
}

//__PASS__BLUR__
uniform sampler2D tex;
uniform vec2 uDir; // blur direction × radius in UV units
varying vec2 vUv;

void main() {
  vec3 s = texture2D(tex, vUv).rgb * 0.2270270270;
  vec2 o1 = uDir * 1.3846153846;
  vec2 o2 = uDir * 3.2307692308;
  s += texture2D(tex, vUv + o1).rgb * 0.3162162162;
  s += texture2D(tex, vUv - o1).rgb * 0.3162162162;
  s += texture2D(tex, vUv + o2).rgb * 0.0702702703;
  s += texture2D(tex, vUv - o2).rgb * 0.0702702703;
  gl_FragColor = vec4(s, 1.0);
}

//__PASS__COMPOSITE__
uniform sampler2D tScene;
uniform sampler2D tB1;
uniform sampler2D tB2;
uniform float uExp;    // exposure multiplier
uniform float uBloom;  // bloom contribution weight
uniform float uTn;     // animated grain phase
uniform vec2 uRes2;    // render size for grain scaling
varying vec2 vUv;

// Filmic ACES tonemap (Narkowicz fit).
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

// tiny hash for grain
float h21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = vUv;
  vec2 cc = uv - 0.5;
  float r2 = dot(cc, cc);
  float ca = r2 * 0.055;                       // chromatic aberration strength
  vec3 col;
  col.r = texture2D(tScene, uv + cc * ca).r;  // R shifted outward
  col.g = texture2D(tScene, uv).g;
  col.b = texture2D(tScene, uv - cc * ca).b;
  vec3 bl = texture2D(tB1, uv).rgb * 0.9 + texture2D(tB2, uv).rgb * 0.75;
  col += bl * uBloom;
  col *= uExp;
  col = aces(col);
  col = pow(col, vec3(0.92));                 // mild gamma lift
  col *= 1.0 - 0.32 * smoothstep(0.15, 0.62, r2); // vignette
  col += (h21(uv * uRes2 + vec2(uTn, uTn * 1.7)) - 0.5) * 0.022; // grain
  gl_FragColor = vec4(col, 1.0);
}