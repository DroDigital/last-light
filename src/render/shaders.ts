/** GLSL sources. All world shaders output HDR linear color; alpha marks foreground (1) vs sky (0). */

export const MAX_LIGHTS = 16;

export const LIGHTING_CHUNK = /* glsl */ `
uniform vec3 uStarDir;
uniform vec3 uStarColor;
uniform vec3 uAmbient;
uniform vec4 uLightPos[${MAX_LIGHTS}];
uniform vec3 uLightCol[${MAX_LIGHTS}];
uniform float uTime;

vec3 pointLights(vec3 p, vec3 n, float wrap) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    vec4 L = uLightPos[i];
    if (L.w <= 0.0) continue;
    vec3 d = L.xyz - p;
    float dist2 = dot(d, d);
    float r2 = L.w * L.w;
    if (dist2 > r2) continue;
    float att = 1.0 - dist2 / r2;
    att *= att;
    float ndl = (dot(n, d * inversesqrt(dist2 + 0.001)) + wrap) / (1.0 + wrap);
    acc += uLightCol[i] * att * max(ndl, 0.0);
  }
  return acc;
}
`;

export const HULL_VERT = /* glsl */ `
attribute float aEmit;
attribute vec3 color;
#ifdef USE_INSTANCING
attribute vec4 aFx;
#endif
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vAlbedo;
varying float vEmit;
varying vec4 vFx;
varying vec3 vTint;
varying vec3 vLocal;
uniform vec3 uTint;
uniform vec4 uFx;
void main() {
  vec4 local = vec4(position, 1.0);
  vec3 nrm = normal;
  vLocal = position;
#ifdef USE_INSTANCING
  local = instanceMatrix * local;
  nrm = mat3(instanceMatrix) * nrm;
  vFx = aFx;
#else
  vFx = uFx;
#endif
#ifdef USE_INSTANCING_COLOR
  vTint = instanceColor;
#else
  vTint = uTint;
#endif
  vec4 world = modelMatrix * local;
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * nrm);
  vAlbedo = color;
  vEmit = aEmit;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const HULL_FRAG = /* glsl */ `
${LIGHTING_CHUNK}
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vAlbedo;
varying float vEmit;
varying vec4 vFx; // x flash, y dissolve, z emissive boost, w cloak
varying vec3 vTint;
varying vec3 vLocal;
uniform float uRim;
uniform float uEmissive;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

void main() {
  // Dissolve into dithered static (Hush death) / cloak flicker
  if (vFx.y > 0.0) {
    float n = hash13(floor(vLocal * 7.0 + floor(uTime * 24.0)));
    if (n < vFx.y) discard;
  }
  if (vFx.w > 0.0) {
    float n = hash13(floor(gl_FragCoord.xyz * vec3(0.5, 0.5, 1.0)) + floor(uTime * 30.0));
    if (n < vFx.w) discard;
  }
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 v = normalize(cameraPosition - vWorld);
  float ndl = dot(n, uStarDir);
  // Panel lines: an object-space plating grid, anti-aliased and faded out
  // when it would turn into shimmer at distance.
  vec3 albedo = vAlbedo;
  if (vEmit < 0.5) {
    vec3 g = vLocal * vec3(2.2, 2.2, 1.4);
    vec3 fw = fwidth(g) + 1e-4;
    vec3 ln = 1.0 - smoothstep(vec3(0.0), fw * 1.2, abs(fract(g - 0.5) - 0.5));
    vec3 an = abs(n);
    float line = max(max(ln.y * an.x, ln.z * an.x), max(max(ln.x * an.y, ln.z * an.y), max(ln.x * an.z, ln.y * an.z)));
    float fade = 1.0 - smoothstep(0.18, 0.45, max(fw.x, max(fw.y, fw.z)));
    albedo *= 1.0 - line * 0.45 * fade;
    // faint per-plate value variation
    albedo *= 0.88 + 0.24 * hash13(floor(g));
  }
  // Wrapped key light + hemispheric ambient (sky above, warm bounce below)
  float wrapL = max((ndl + 0.25) / 1.25, 0.0);
  vec3 hemi = uAmbient * mix(0.55, 1.6, n.y * 0.5 + 0.5);
  vec3 diffuse = albedo * (uStarColor * wrapL * 0.6 + hemi);
  // Glossy highlight from the star (metal plating)
  vec3 hv = normalize(uStarDir + v);
  float spec = pow(max(dot(n, hv), 0.0), 48.0) * step(0.0, ndl);
  diffuse += uStarColor * spec * 0.6 * (1.0 - vEmit);
  // Strong rim from the nearest star: back-lit edges glow
  float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
  // rim only on edges that face the star (back-lit silhouettes)
  float facing = clamp(dot(n, uStarDir) + 0.2, 0.0, 1.0);
  float back = clamp(0.35 + 0.65 * dot(-v, uStarDir), 0.0, 1.0);
  vec3 rim = uStarColor * fres * uRim * facing * (0.5 + back * 1.5);
  vec3 pl = pointLights(vWorld, n, 0.3) * (albedo * 2.0 + 0.035 + fres * 0.45);
  vec3 emiss = vTint * vEmit * uEmissive * (1.0 + vFx.z);
  vec3 col = diffuse + rim + pl + emiss;
  // Aerial perspective: distance dissolves hulls into the nebula's haze, so
  // near things pop and colossal far things read as far
  float dist = length(cameraPosition - vWorld);
  float haze = 1.0 - exp(-max(dist - 120.0, 0.0) / 2400.0);
  col = mix(col, uAmbient * 2.2 + uStarColor * 0.035, haze * 0.7);
  // Hit flash: blow out to hot white
  col = mix(col, vec3(4.0, 3.8, 3.6), clamp(vFx.x, 0.0, 1.0));
  // Frozen tint on dissolve leading edge
  gl_FragColor = vec4(col, 1.0);
}
`;

export const NEBULA_VERT = /* glsl */ `
attribute vec4 aStroke;   // xyz center, w size
attribute vec4 aDir;      // xyz stroke direction, w aspect
attribute vec4 aCol;      // rgb tint (HDR), a seed
varying vec2 vUv;
varying vec3 vCol;
varying float vSeed;
varying vec3 vWorld;
uniform float uTime;
void main() {
  vec3 center = aStroke.xyz;
  // gentle drift so the nebula feels alive
  center += aDir.xyz * sin(uTime * 0.05 + aCol.a * 6.28) * aStroke.w * 0.03;
  center = (modelMatrix * vec4(center, 1.0)).xyz;
  vec4 mvCenter = viewMatrix * vec4(center, 1.0);
  vec3 dirV = normalize(mat3(viewMatrix) * aDir.xyz);
  vec2 along = normalize(dirV.xy + vec2(1e-4));
  vec2 across = vec2(-along.y, along.x);
  float len = aStroke.w * aDir.w;
  float wid = aStroke.w;
  vec2 off = along * position.x * len + across * position.y * wid;
  mvCenter.xy += off;
  vUv = position.xy;
  vCol = aCol.rgb;
  vSeed = aCol.a;
  vWorld = center;
  gl_Position = projectionMatrix * mvCenter;
}
`;

export const NEBULA_FRAG = /* glsl */ `
${LIGHTING_CHUNK}
varying vec2 vUv;
varying vec3 vCol;
varying float vSeed;
varying vec3 vWorld;
uniform float uIntensity;

float h(float x) { return fract(sin(x) * 43758.5453); }
float n1(float x) { float i = floor(x); float f = fract(x); return mix(h(i), h(i + 1.0), f * f * (3.0 - 2.0 * f)); }

void main() {
  // Brushed stroke: elongated ellipse with ragged bristle streaks along its length.
  vec2 uv = vUv; // -0.5..0.5
  float r = length(uv * vec2(1.0, 1.0)) * 2.0;
  float body = smoothstep(1.0, 0.2, r);
  float bristle = n1(uv.y * 38.0 + vSeed * 91.0) * 0.6 + n1(uv.y * 13.0 + vSeed * 17.0) * 0.4;
  float taper = smoothstep(0.5, 0.15, abs(uv.x)) ;
  float streak = mix(0.35, 1.0, bristle) * taper;
  float a = body * streak;
  if (a < 0.01) discard;
  vec3 lit = pointLights(vWorld, vec3(0.0, 0.0, 1.0), 1.0) * 0.012;
  vec3 col = vCol * a * uIntensity + lit * a * (0.6 + vCol);
  gl_FragColor = vec4(col, 0.0);
}
`;

export const STAR_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float s = length(modelMatrix[0].xyz);
  mv.xy += position.xy * s;
  gl_Position = projectionMatrix * mv;
}
`;

export const STAR_FRAG = /* glsl */ `
varying vec2 vUv;
uniform vec3 uColor;
uniform float uPower;
uniform float uTime;
uniform float uPulse;
float sh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sn(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(sh(i), sh(i + vec2(1, 0)), f.x), mix(sh(i + vec2(0, 1)), sh(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  float r = length(vUv) * 2.0;
  if (r > 1.0) discard;
  const float R = 0.3;
  float ang = atan(vUv.y, vUv.x);
  // photosphere: limb-darkened disc with boiling granulation
  float disc = smoothstep(R + 0.006, R - 0.006, r);
  float mu = sqrt(max(0.0, 1.0 - (r * r) / (R * R)));
  float gran = sn(vUv * 46.0 + vec2(uTime * 0.21, -uTime * 0.17)) * 0.6 + sn(vUv * 110.0 - uTime * 0.4) * 0.4;
  float photo = disc * (0.42 + 0.58 * pow(mu, 0.6)) * (0.82 + 0.3 * gran);
  // chromosphere: a thin hot rim just past the limb
  float chrom = exp(-abs(r - R) * 90.0) * 0.9;
  // corona: soft glow broken into slowly turning streamers
  float stream = sn(vec2(ang * 3.0 + uTime * 0.03, r * 3.0 - uTime * 0.05)) * 0.7 + sn(vec2(ang * 9.0 - uTime * 0.02, r * 6.0)) * 0.3;
  float corona = exp(-(r - R) * 5.5) * (0.35 + stream * 0.9) * (1.0 - disc);
  float halo = exp(-r * 3.0) * 0.5;
  // diffraction spikes (four long, four short) like a real lens
  float spikes = pow(max(0.0, 1.0 - abs(vUv.x * vUv.y) * 70.0), 8.0) * exp(-r * 2.0) * 0.6;
  vec2 ru = mat2(0.7071, -0.7071, 0.7071, 0.7071) * vUv;
  spikes += pow(max(0.0, 1.0 - abs(ru.x * ru.y) * 140.0), 8.0) * exp(-r * 4.5) * 0.3;
  float flick = 0.92 + 0.08 * sin(uTime * 2.3 + ang * 4.0);
  vec3 hot = mix(uColor, vec3(1.0), 0.35);
  vec3 col = hot * photo * 3.2 + uColor * (chrom * 1.6 + (corona + halo) * flick + spikes);
  col *= uPower * (1.0 + uPulse);
  gl_FragColor = vec4(col, disc);
}
`;

export const PARTICLE_VERT = /* glsl */ `
attribute vec3 aVel;
attribute vec4 aTime;   // birth, life, drag, gravity
attribute vec4 aColor;  // rgb HDR, a = fade curve (0 linear, 1 late)
attribute vec2 aSize;   // start, end (low-res pixels at distance 10)
uniform float uNow;
uniform float uPixelScale;
varying vec4 vColor;
varying float vT;
void main() {
  float t = uNow - aTime.x;
  float life = aTime.y;
  if (t < 0.0 || t > life || life <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  float k = aTime.z;
  float f = k > 0.0 ? (1.0 - exp(-k * t)) / k : t;
  vec3 p = position + aVel * f;
  p.y -= 0.5 * aTime.w * t * t;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float u = t / life;
  vT = u;
  float sz = mix(aSize.x, aSize.y, u);
  gl_PointSize = clamp(sz * 10.0 / max(-mv.z, 0.5) * uPixelScale, 0.0, 48.0);
  float fade = aColor.a > 0.5 ? 1.0 - smoothstep(0.6, 1.0, u) : 1.0 - u;
  vColor = vec4(aColor.rgb * fade, 1.0);
}
`;

export const PARTICLE_FRAG = /* glsl */ `
varying vec4 vColor;
varying float vT;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c) * 4.0;
  if (d > 1.0) discard;
  // hot desaturated core inside a soft coloured glow
  float glow = exp(-d * 2.6);
  float core = smoothstep(0.35, 0.0, d);
  vec3 pc = vColor.rgb * (0.25 + glow * 0.9) + vec3(max(vColor.r, max(vColor.g, vColor.b))) * core * 0.35;
  gl_FragColor = vec4(pc, 0.0);
}
`;

/** Streaks: screen-space quads between two world points (trails, beams, sparks, speed lines). */
export const STREAK_VERT = /* glsl */ `
attribute vec3 aA;
attribute vec3 aB;
attribute vec4 aCol;   // rgb HDR, a = width (world units)
attribute float aWidthB;
varying vec4 vCol;
varying vec2 vUv;
uniform vec2 uRes;
void main() {
  vec4 ca = projectionMatrix * viewMatrix * vec4(aA, 1.0);
  vec4 cb = projectionMatrix * viewMatrix * vec4(aB, 1.0);
  // avoid behind-camera explosion
  if (ca.w < 0.05) ca = cb;
  if (cb.w < 0.05) cb = ca;
  vec2 sa = ca.xy / ca.w;
  vec2 sb = cb.xy / cb.w;
  vec2 d = (sb - sa) * uRes;
  float L = length(d);
  vec2 dir = L > 0.001 ? d / L : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float t = position.x; // 0..1
  vec4 c = mix(ca, cb, t);
  float w = mix(aCol.a, aWidthB, t);
  // width in world units -> pixels via projection scale, min 1px
  float px = max(w * projectionMatrix[1][1] * uRes.y * 0.5 / c.w, 1.0);
  c.xy += nrm * position.y * px / uRes * 2.0 * c.w;
  // extend caps slightly
  c.xy += dir * (t - 0.5) * 2.0 / uRes * c.w;
  gl_Position = c;
  // ribbons that swing past the lens (engine trail in a hard turn) fade out
  // instead of smearing across the screen
  float nearFade = smoothstep(6.0, 16.0, c.w);
  vCol = vec4(aCol.rgb * nearFade, 1.0);
  vUv = vec2(t, position.y * 2.0);
}
`;

export const STREAK_FRAG = /* glsl */ `
varying vec4 vCol;
varying vec2 vUv;
void main() {
  // hot white core, soft coloured falloff
  float across = 1.0 - abs(vUv.y);
  float core = smoothstep(0.55, 1.0, across);
  vec3 c = vCol.rgb * (0.3 + across * 0.7) + vec3(dot(vCol.rgb, vec3(0.33))) * core * 0.35;
  gl_FragColor = vec4(c, 0.0);
}
`;

/** Bullets/pickups in the readability overlay. kind: 0 player bolt, 1 enemy ring, 2 enemy diamond, 3 pickup, 4 mine, 5 player orb */
export const BULLET_VERT = /* glsl */ `
attribute vec4 aPos;   // xyz, size (world)
attribute vec4 aVel;   // xyz velocity, kind
varying vec2 vUv;
varying float vKind;
varying float vStretch;
uniform vec2 uRes;
void main() {
  vec4 c0 = projectionMatrix * viewMatrix * vec4(aPos.xyz, 1.0);
  if (c0.w < 0.1) { gl_Position = vec4(2.0); return; }
  float kind = aVel.w;
  vec2 dir = vec2(1.0, 0.0);
  float stretch = 1.0;
  if (kind < 0.5 || (kind > 4.5 && kind < 5.5)) {
    vec4 c1 = projectionMatrix * viewMatrix * vec4(aPos.xyz - aVel.xyz * 0.03, 1.0);
    vec2 d = (c0.xy / c0.w - c1.xy / max(c1.w, 0.1)) * uRes;
    float L = length(d);
    if (L > 0.5) { dir = d / L; stretch = clamp(1.0 + L / 4.0, 1.0, 5.0); }
  }
  vec2 nrm = vec2(-dir.y, dir.x);
  float px = max(aPos.w * projectionMatrix[1][1] * uRes.y * 0.5 / c0.w, kind > 0.5 && kind < 2.5 ? 2.5 : 1.5);
  vec2 off = dir * position.x * px * stretch + nrm * position.y * px;
  c0.xy += off / uRes * 2.0 * c0.w;
  gl_Position = c0;
  vUv = position.xy;
  vKind = kind;
  vStretch = stretch;
}
`;

export const BULLET_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vKind;
varying float vStretch;
uniform vec3 uPlayerTone;
uniform vec3 uEnemyTone;
uniform vec3 uPickupTone;
uniform float uTime;
void main() {
  vec2 p = vUv * 2.0; // -1..1
  vec3 col;
  float a;
  if (vKind < 0.5 || (vKind > 4.5 && vKind < 5.5)) {
    // player bolt: bright capsule with white-hot core
    float d = length(vec2(p.x, p.y * 1.0));
    a = step(d, 1.0);
    col = mix(uPlayerTone, vec3(1.0), step(d, 0.45));
  } else if (vKind < 1.5) {
    // enemy ring: dark outline, danger ring, hot core
    float d = length(p);
    if (d > 1.0) discard;
    a = 1.0;
    col = d > 0.82 ? vec3(0.05, 0.0, 0.0) : (d > 0.45 ? uEnemyTone : mix(uEnemyTone, vec3(1.0, 0.9, 0.7), 0.6));
  } else if (vKind < 2.5) {
    // enemy diamond
    float d = abs(p.x) + abs(p.y);
    if (d > 1.0) discard;
    a = 1.0;
    col = d > 0.78 ? vec3(0.05, 0.0, 0.0) : (d > 0.35 ? uEnemyTone : vec3(1.0, 0.85, 0.6));
  } else if (vKind < 3.5) {
    // pickup mote: soft four-point sparkle
    float d = length(p);
    float cross = max(1.0 - abs(p.x) * 6.0, 0.0) + max(1.0 - abs(p.y) * 6.0, 0.0);
    a = step(d, 0.55) + step(d, 1.0) * cross * 0.9;
    if (a < 0.5) discard;
    col = uPickupTone;
  } else {
    // mine: pulsing danger square
    float d = max(abs(p.x), abs(p.y));
    if (d > 1.0) discard;
    float pulse = step(0.5, fract(uTime * 3.0));
    a = 1.0;
    col = d > 0.75 ? vec3(0.05, 0.0, 0.0) : mix(uEnemyTone * 0.6, uEnemyTone, pulse);
  }
  if (a < 0.5) discard;
  gl_FragColor = vec4(col, 1.0);
}
`;

export const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const BLOOM_DOWN_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
  c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  c /= 8.0;
  if (uThreshold > 0.0) {
    float l = max(c.r, max(c.g, c.b));
    c *= max(l - uThreshold, 0.0) / max(l, 1e-4);
  }
  gl_FragColor = vec4(c, 1.0);
}
`;

export const BLOOM_UP_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tSrc;
uniform sampler2D tBase;
uniform vec2 uTexel;
void main() {
  vec3 c = vec3(0.0);
  c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 0.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(1.0, 0.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(0.0, -1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(0.0, 1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(-0.7, -0.7)).rgb * 0.5;
  c += texture2D(tSrc, vUv + uTexel * vec2(0.7, -0.7)).rgb * 0.5;
  c += texture2D(tSrc, vUv + uTexel * vec2(-0.7, 0.7)).rgb * 0.5;
  c += texture2D(tSrc, vUv + uTexel * vec2(0.7, 0.7)).rgb * 0.5;
  c /= 6.0;
  gl_FragColor = vec4(c * 0.55 + texture2D(tBase, vUv).rgb, 1.0);
}
`;

/**
 * Final pass: low-res HDR -> tonemap -> OKLab palette quantization with ordered
 * dither -> readability overlay -> CRT accents, written at native resolution.
 */
export const POST_FRAG = /* glsl */ `
precision highp float;
precision highp int;
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform sampler2D tOverlay;
uniform vec2 uLowRes;
uniform vec2 uOutRes;
uniform vec3 uPalA[16];
uniform vec3 uPalB[16];
uniform float uPalMix;
uniform float uExposure;
uniform float uBloom;
uniform float uSpread;
uniform int uMatrix;     // 0 bayer4, 1 bayer8, 2 IGN, 3 off
uniform float uHush;      // 0..1 how much light has left this place
uniform float uFlare;     // 0..1 overdrive
uniform float uLowHp;
uniform float uDamage;    // glitch on damage
uniform float uWarp;
uniform float uFlash;     // full-screen flash (white-out)
uniform float uBreath;    // dither breathing (beat / hit)
uniform float uScan;
uniform float uVignette;
uniform float uTime;
uniform float uReduceFlash;
uniform mat3 uCamRot;
uniform vec2 uTanHalf;    // tan(fov/2) * aspect, tan(fov/2)
uniform float uSkyScale;
// Ink print (style A): 3-tone ink world, optional paper inversion, signal orange exempt
uniform vec3 uInkPal[3];
uniform float uInk;       // 0 = cosmos palette, 1 = ink print (dithered dissolve between)
uniform float uPaper;     // 1 = paper-white negative print
uniform vec3 uSignal;     // signal orange (sRGB), never dithered

vec3 srgbToLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 linearToSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }

vec3 toOklab(vec3 c) {
  float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
  float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
  float s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
  l = pow(max(l, 0.0), 1.0 / 3.0); m = pow(max(m, 0.0), 1.0 / 3.0); s = pow(max(s, 0.0), 1.0 / 3.0);
  return vec3(0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
              1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
              0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s);
}
vec3 fromOklab(vec3 c) {
  float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  float s = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
  l = l * l * l; m = m * m * m; s = s * s * s;
  return vec3(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
             -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
             -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

float bayer4(ivec2 p) {
  int x = p.x & 3; int y = p.y & 3;
  int v = ((x ^ y) & 1) * 8 + (y & 1) * 4 + (((x ^ y) >> 1) & 1) * 2 + ((y >> 1) & 1);
  return (float(v) + 0.5) / 16.0;
}
float bayer8(ivec2 p) {
  int x = p.x & 7; int y = p.y & 7;
  int xr = x ^ y;
  int v = ((xr & 1) << 5) | ((y & 1) << 4) | ((xr & 2) << 2) | ((y & 2) << 1) | ((xr & 4) >> 1) | ((y & 4) >> 2);
  return (float(v) + 0.5) / 64.0;
}
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

float threshold(ivec2 p) {
  if (uMatrix == 0) return bayer4(p);
  if (uMatrix == 1) return bayer8(p);
  if (uMatrix == 2) return ign(vec2(p));
  return 0.5;
}

void main() {
  vec2 frag = vUv * uOutRes;
  vec2 scale = uOutRes / uLowRes;
  vec2 lowPx = floor(frag / scale);

  // Warp: radial tunnel stretch toward the center
  vec2 uvL = (lowPx + 0.5) / uLowRes;
  if (uWarp > 0.0) {
    vec2 c = uvL - 0.5;
    float r = length(c);
    float pull = uWarp * 0.35 * (1.0 - r);
    uvL = 0.5 + c * (1.0 - pull);
  }
  float ab = uDamage * 0.006 + uWarp * 0.004;
  vec4 sc = texture2D(tScene, uvL);
  vec3 hdr = sc.rgb;
  if (ab > 0.0) {
    hdr.r = texture2D(tScene, uvL + vec2(ab, 0.0)).r;
    hdr.b = texture2D(tScene, uvL - vec2(ab, 0.0)).b;
  }
  hdr += texture2D(tBloom, uvL).rgb * uBloom * 0.3;
  // Anamorphic lens streak: the brightest light smears into a thin horizontal
  // flare (sampled from the soft bloom so it costs a handful of taps)
  vec3 ana = vec3(0.0);
  float px = 1.0 / uLowRes.x;
  for (int i = 1; i <= 10; i++) {
    float o = float(i) * 2.2 * px;
    float wgt = exp(-float(i) * 0.26);
    ana += (max(texture2D(tBloom, uvL + vec2(o, 0.0)).rgb - 0.6, 0.0) + max(texture2D(tBloom, uvL - vec2(o, 0.0)).rgb - 0.6, 0.0)) * wgt;
  }
  hdr += ana * vec3(0.55, 0.75, 1.0) * uBloom * 0.05;
  // Warp streak: smear along radial direction
  if (uWarp > 0.0) {
    vec2 c = uvL - 0.5;
    vec3 acc = vec3(0.0);
    for (int i = 1; i <= 6; i++) acc += texture2D(tScene, 0.5 + c * (1.0 - float(i) * 0.03 * uWarp)).rgb;
    hdr = mix(hdr, acc / 6.0 * (1.0 + uWarp), uWarp * 0.8);
  }

  vec3 col = aces(hdr * uExposure * (1.0 + uFlare * 0.6));
  vec3 lab = toOklab(col);

  // Juice: Flare pushes toward bright tones, low hp/hush drains chroma
  vec3 labRaw = lab;
  float drain = clamp(max(uHush * 0.85, uLowHp * 0.6), 0.0, 1.0);
  lab.yz *= (1.0 - drain);
  lab.x = lab.x + uFlare * 0.12 * (1.0 - lab.x);

  // Dither coordinate: sky pixels anchor to view direction so the pattern
  // travels with the background (no shimmer on slow pans); foreground pixels
  // use screen space.
  ivec2 dp;
  if (sc.a < 0.5) {
    vec2 ndc = (lowPx + 0.5) / uLowRes * 2.0 - 1.0;
    vec3 dir = normalize(uCamRot * vec3(ndc.x * uTanHalf.x, ndc.y * uTanHalf.y, -1.0));
    vec3 ad = abs(dir);
    vec2 cube;
    if (ad.x >= ad.y && ad.x >= ad.z) cube = dir.zy / ad.x + vec2(sign(dir.x) * 7.0, 0.0);
    else if (ad.y >= ad.z) cube = dir.xz / ad.y + vec2(0.0, sign(dir.y) * 7.0);
    else cube = dir.xy / ad.z + vec2(sign(dir.z) * 13.0, 3.0);
    dp = ivec2(floor(cube * uSkyScale));
  } else {
    dp = ivec2(lowPx);
  }
  float th = threshold(dp);
  float spread = uSpread * (1.0 + uBreath);

  // Two-nearest palette search in OKLab
  float d1 = 1e9; float d2 = 1e9;
  vec3 p1 = vec3(0.0); vec3 p2 = vec3(0.0);
  for (int i = 0; i < 16; i++) {
    vec3 p = mix(uPalA[i], uPalB[i], uPalMix);
    p.yz *= (1.0 - drain * 0.9);
    vec3 dv = (lab - p) * vec3(1.0, 1.2, 1.2);
    float d = dot(dv, dv);
    if (d < d1) { d2 = d1; p2 = p1; d1 = d; p1 = p; }
    else if (d < d2) { d2 = d; p2 = p; }
  }
  float s1 = sqrt(d1); float s2 = sqrt(d2);
  float t = s1 / max(s1 + s2, 1e-5); // 0 = exactly p1, 0.5 = halfway
  vec3 q = (uMatrix == 3) ? lab : ((th < t * spread) ? p2 : p1);
  vec3 outc = clamp(linearToSrgb(max(fromOklab(q), 0.0)), 0.0, 1.0);

  // --- Ink print: where light dies the world prints in three inks.
  if (uInk > 0.001) {
    float L = labRaw.x;
    // paper negative: push the empty sky to clean paper so only real forms print
    if (uPaper > 0.0) L = mix(L, 1.0 - clamp((L - 0.08) * 1.6, 0.0, 1.0), uPaper);
    // ink tones are near-neutral: quantize on lightness with ordered dither
    float i1 = 1e9; float i2 = 1e9; float l1 = 0.0; float l2 = 0.0; int k1 = 0; int k2 = 0;
    for (int i = 0; i < 3; i++) {
      float d = abs(L - uInkPal[i].x);
      if (d < i1) { i2 = i1; l2 = l1; k2 = k1; i1 = d; l1 = uInkPal[i].x; k1 = i; }
      else if (d < i2) { i2 = d; l2 = uInkPal[i].x; k2 = i; }
    }
    float ti = i1 / max(i1 + i2, 1e-5);
    int ki = (th < ti * mix(1.4, 0.9, uPaper)) ? k2 : k1;
    vec3 inkLab = uInkPal[0];
    if (ki == 1) inkLab = uInkPal[1];
    if (ki == 2) inkLab = uInkPal[2];
    vec3 inkc = clamp(linearToSrgb(max(fromOklab(inkLab), 0.0)), 0.0, 1.0);
    // hot light (fire, explosions, stars) prints as signal orange, undithered
    float chroma = length(labRaw.yz);
    float hot = step(0.13, chroma) * step(0.66, labRaw.x) * step(0.0, labRaw.y + labRaw.z * 0.5);
    inkc = mix(inkc, uSignal, hot * step(0.5, uInk));
    // dithered dissolve between the two posterizations (shifted pattern so it
    // does not correlate with the color dither)
    float th2 = bayer4(dp + ivec2(2, 1));
    if (th2 < uInk) outc = inkc;
  }

  // Readability overlay: reserved tones, never quantized
  vec4 ov = texture2D(tOverlay, (lowPx + 0.5) / uLowRes);
  outc = mix(outc, ov.rgb, ov.a);

  // Native-res accents
  vec2 sp = vUv - 0.5;
  float vig = 1.0 - dot(sp, sp) * uVignette * (1.0 + uLowHp * (1.6 + sin(uTime * 7.0) * 0.6));
  outc *= clamp(vig, 0.0, 1.0);
  outc = mix(outc, vec3(0.6, 0.02, 0.04), uLowHp * 0.18 * smoothstep(0.15, 0.7, length(sp)) * (0.6 + 0.4 * sin(uTime * 7.0)));
  float scan = 1.0 - uScan * (0.5 + 0.5 * sin(frag.y * 3.14159 / max(scale.y * 0.5, 1.0)));
  outc *= scan;
  if (uDamage > 0.01) {
    float band = step(0.92, fract(sin(floor(frag.y / 6.0) * 12.9898 + floor(uTime * 40.0)) * 43758.5)) * uDamage;
    outc = mix(outc, outc.gbr, band);
  }
  outc = mix(outc, vec3(1.0), clamp(uFlash * uReduceFlash, 0.0, 1.0));
  gl_FragColor = vec4(outc, 1.0);
}
`;

/** Full-res telegraphs: danger lines and rings, undithered. */
export const TELE_VERT = /* glsl */ `
attribute vec4 aCol;
varying vec4 vCol;
void main() {
  vCol = aCol;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;
export const TELE_FRAG = /* glsl */ `
varying vec4 vCol;
void main() { gl_FragColor = vCol; }
`;

/**
 * Shells: volumetric-looking expanding spheres. Mode 0 is a boiling fireball
 * (noise-displaced, white-hot → orange → ember ramp), mode 1 a shield bubble
 * (fresnel rim with a hex lattice), mode 2 a soft energy burst.
 */
export const SHELL_VERT = /* glsl */ `
attribute vec4 aSphere;  // xyz centre, w radius
attribute vec4 aShell;   // x age 0..1, y mode, z seed, w intensity
attribute vec3 aTint;
varying vec3 vN;
varying vec3 vWorld;
varying vec4 vShell;
varying vec3 vTint;
varying float vDisp;
float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
void main() {
  vec3 n = normalize(position);
  float t = aShell.x;
  float disp = 0.0;
  if (aShell.y < 0.5) {
    vec3 q = n * 2.3 + aShell.z * 17.0 + vec3(0.0, t * 1.6, 0.0);
    disp = n3(q) * 0.65 + n3(q * 2.3) * 0.35;
    disp = (disp - 0.45) * 0.55 * (1.0 - t * 0.5);
  } else if (aShell.y > 2.5 && aShell.y < 3.5) {
    // shockfront: a thin torn skin that ripples as it travels
    vec3 q = n * 3.1 + aShell.z * 11.0 + vec3(t * 3.0);
    disp = (n3(q) - 0.5) * 0.08;
  } else if (aShell.y > 4.5 && aShell.y < 5.5) {
    // umbra: crawling, boiling darkness
    vec3 q = n * 1.7 + aShell.z * 9.0 + vec3(0.0, -t * 2.5, t * 1.3);
    disp = (n3(q) * 0.7 + n3(q * 2.7) * 0.3 - 0.5) * 0.35;
  }
  vDisp = disp;
  vec3 world = aSphere.xyz + n * aSphere.w * (1.0 + disp);
  vN = n;
  vWorld = world;
  vShell = aShell;
  vTint = aTint;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

export const SHELL_FRAG = /* glsl */ `
varying vec3 vN;
varying vec3 vWorld;
varying vec4 vShell;
varying vec3 vTint;
varying float vDisp;
void main() {
  vec3 v = normalize(cameraPosition - vWorld);
  float ndv = abs(dot(normalize(vN), v));
  float fres = 1.0 - ndv;
  float t = vShell.x;
  float inten = vShell.w;
  vec3 col;
  if (vShell.y < 0.5) {
    // fireball: hottest in the middle of the ball and in the early frames
    float heat = clamp((1.0 - t) * (0.55 + ndv * 0.6) + vDisp * 1.4, 0.0, 1.0);
    vec3 ember = vec3(0.55, 0.08, 0.02);
    vec3 orange = vec3(2.2, 0.75, 0.12);
    vec3 yellow = vec3(3.0, 2.2, 0.8);
    vec3 white = vec3(4.0, 3.8, 3.4);
    vec3 ramp = heat < 0.33 ? mix(ember, orange, heat / 0.33) : heat < 0.66 ? mix(orange, yellow, (heat - 0.33) / 0.33) : mix(yellow, white, (heat - 0.66) / 0.34);
    ramp = mix(ramp, ramp * vTint * 1.6, 0.35);
    float fade = (1.0 - t) * (1.0 - t);
    col = ramp * fade * (0.35 + ndv * 0.65);
  } else if (vShell.y < 1.5) {
    // shield: rim light plus a faint hex lattice that ripples outward
    vec3 p = normalize(vN) * 9.0;
    vec2 hp = vec2(p.x + p.z * 0.5, p.y + p.z * 0.866);
    vec2 g = abs(fract(hp) - 0.5);
    float lattice = smoothstep(0.42, 0.5, max(g.x, g.y));
    float fade = 1.0 - t;
    col = vTint * (pow(fres, 2.5) * 1.6 + lattice * 0.35 + 0.05) * fade;
  } else if (vShell.y < 2.5) {
    float fade = (1.0 - t) * (1.0 - t);
    col = vTint * (pow(fres, 1.5) * 1.2 + 0.15) * fade;
  } else if (vShell.y < 3.5) {
    // shockfront: hard rim, interference bands running pole to pole, torn by noise
    vec3 nn = normalize(vN);
    float bands = 0.5 + 0.5 * sin(nn.y * 26.0 - t * 40.0 + vShell.z * 6.0);
    float tear = step(0.18, vDisp + 0.1);
    float rim = pow(fres, 3.0);
    col = vTint * (rim * 2.2 + bands * rim * 0.9 + 0.04) * mix(0.4, 1.0, tear) * (1.0 - t * 0.6);
  } else if (vShell.y < 4.5) {
    // event horizon: nothing in the middle, a razor photon ring, accretion streaks swirling round
    vec3 nn = normalize(vN);
    float ang = atan(nn.z, nn.x);
    float swirl = 0.5 + 0.5 * sin(ang * 7.0 + nn.y * 9.0 - vShell.x * 30.0);
    float ring = smoothstep(0.82, 0.97, fres);
    float disc = (1.0 - smoothstep(0.0, 0.22, abs(nn.y))) * swirl;
    col = vTint * (ring * 3.0 + disc * fres * 1.4);
  } else if (vShell.y < 5.5) {
    // umbra: a dim violet smoke whose edges burn
    float edge = smoothstep(0.55, 0.95, fres);
    float smoke = clamp(vDisp * 3.0 + 0.4, 0.0, 1.0);
    col = vTint * (edge * 1.4 * smoke + 0.06) ;
  } else {
    // crystal: hard facets that flash as they turn
    vec3 nn = normalize(vN);
    vec3 f = floor(nn * 3.5 + 0.5);
    float facet = fract(sin(dot(f, vec3(12.9898, 78.233, 37.719)) + vShell.x * 8.0) * 43758.5453);
    float edges = step(0.42, max(max(abs(fract(nn.x * 3.5) - 0.5), abs(fract(nn.y * 3.5) - 0.5)), abs(fract(nn.z * 3.5) - 0.5)));
    col = vTint * (pow(fres, 2.0) * 1.5 + facet * 0.5 * step(0.7, facet) + edges * 0.6);
  }
  gl_FragColor = vec4(col * inten, 0.0);
}
`;
