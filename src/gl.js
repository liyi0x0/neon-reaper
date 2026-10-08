'use strict';
// ============================================================
//  WebGL2 renderer
//  - every visible thing is one instanced quad; the fragment
//    shader draws it as an SDF shape (crisp at any zoom)
//  - premultiplied blending: alpha 0 = additive glow, alpha 1 = solid
//  - HDR scene -> bloom mip chain -> composite (shockwaves, CA, grain)
// ============================================================
const SH = {
  // neon solid shapes (fill + bright rim + soft outer glow)
  CIRCLE: 0, RING: 1, TRI: 2, SQUARE: 3, DIAMOND: 4, HEX: 5, STAR: 6, PENT: 7,
  BLADE: 8, CRESCENT: 9, CROSS: 10, OCT: 11,
  // additive / special
  GLOW: 20, SPARK: 21, BEAM: 22, SOFTRING: 23, HOLE: 24, SPARKLE: 25, SMOKE: 26,
  SLASH: 27, RECT: 28, FROST: 29, GLYPH: 30,
};

const Renderer = (() => {
  let gl = null, canvas = null;
  let W = 1, H = 1, cssW = 1, cssH = 1;
  let hdr = false, fmtInternal, fmtType;
  let quality = 'high';
  let progSprite, progBg, progDown, progUp, progComp;
  let uSprite = {}, uBg = {}, uDown = {}, uUp = {}, uComp = {};
  let vaoSprite, vaoEmpty, instBuf;
  const FLOATS = 12;
  const MAX_INST = 80000;
  const inst = new Float32Array(MAX_INST * FLOATS);
  let count = 0;
  let scene = null;
  let mips = [];
  let mipCount = 6;
  let fontTex = null;
  const GLYPHS = '0123456789!+-.KM';
  const glyphIndex = {};
  for (let i = 0; i < GLYPHS.length; i++) glyphIndex[GLYPHS[i]] = i;

  // camera (world units)
  let camX = 0, camY = 0, viewW = 1280, viewH = 720;

  // ---------------- shaders ----------------
  const VS_SPRITE = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aPS;
layout(location=2) in vec4 aRS;
layout(location=3) in vec4 aCol;
uniform vec4 uCam;
out vec2 vLocal;
out vec2 vSize;
flat out int vShape;
out vec4 vCol;
out vec2 vParam;
void main(){
  int shape = int(aRS.y + 0.5);
  float pad = shape < 20 ? 1.4 : 1.0;
  vec2 local = aCorner * pad;
  vec2 p = local * aPS.zw;
  float c = cos(aRS.x), s = sin(aRS.x);
  p = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  vec2 w = aPS.xy + p;
  gl_Position = vec4((w - uCam.xy) * uCam.zw, 0.0, 1.0);
  vLocal = local;
  vSize = aPS.zw;
  vShape = shape;
  vCol = aCol;
  vParam = aRS.zw;
}`;

  const FS_SPRITE = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec2 vSize;
flat in int vShape;
in vec4 vCol;
in vec2 vParam;
uniform sampler2D uFont;
uniform float uGlyphs;
out vec4 o;

float ndot(vec2 a, vec2 b){ return a.x*b.x - a.y*b.y; }
float sdTri(vec2 p){
  p = vec2(-p.y, p.x);
  const float k = 1.7320508;
  const float r = 0.8660254;
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}
float sdBox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
float sdRhombus(vec2 p, vec2 b){
  p = abs(p);
  float h = clamp(ndot(b - 2.0 * p, b) / dot(b, b), -1.0, 1.0);
  float d = length(p - 0.5 * b * vec2(1.0 - h, 1.0 + h));
  return d * sign(p.x * b.y + p.y * b.x - b.x * b.y);
}
float sdHex(vec2 p, float r){
  const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
  p = abs(p);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
  return length(p) * sign(p.y);
}
float sdPent(vec2 p, float r){
  const vec3 k = vec3(0.809016994, 0.587785252, 0.726542528);
  p = vec2(p.y, p.x);
  p.x = abs(p.x);
  p -= 2.0 * min(dot(vec2(-k.x, k.y), p), 0.0) * vec2(-k.x, k.y);
  p -= 2.0 * min(dot(vec2(k.x, k.y), p), 0.0) * vec2(k.x, k.y);
  p -= vec2(clamp(p.x, -r * k.z, r * k.z), r);
  return length(p) * sign(p.y);
}
float sdStar5(vec2 p, float r, float rf){
  const vec2 k1 = vec2(0.809016994375, -0.587785252292);
  const vec2 k2 = vec2(-k1.x, k1.y);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
float sdOct(vec2 p, float r){
  const vec3 k = vec3(-0.9238795325, 0.3826834323, 0.4142135623);
  p = abs(p);
  p -= 2.0 * min(dot(vec2(k.x, k.y), p), 0.0) * vec2(k.x, k.y);
  p -= 2.0 * min(dot(vec2(-k.x, k.y), p), 0.0) * vec2(-k.x, k.y);
  p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
  return length(p) * sign(p.y);
}
float sdVesica(vec2 p, float r, float d){
  p = abs(p);
  float b = sqrt(r * r - d * d);
  return ((p.y - b) * d > p.x * b) ? length(p - vec2(0.0, b)) : length(p - vec2(-d, 0.0)) - r;
}
float sdCross(vec2 p, vec2 b){
  p = abs(p); p = (p.y > p.x) ? p.yx : p.xy;
  vec2 q = p - b;
  float k = max(q.y, q.x);
  vec2 w = (k > 0.0) ? q : vec2(b.y - p.x, -k);
  return sign(k) * length(max(w, 0.0));
}

vec4 neon(float d, vec3 col, float a, float fillAmt, float rimW){
  float aa = max(fwidth(d), 1e-4) * 1.1;
  float inside = 1.0 - smoothstep(-aa, aa, d);
  float rim = inside * smoothstep(-rimW - aa, -rimW + aa, d);
  float glow = exp(-max(d, 0.0) * 7.0) * (1.0 - inside) * 0.5;
  vec3 c = col * (fillAmt * (1.0 - rim) * inside + 1.7 * rim + glow);
  return vec4(c * a, inside * a);
}

void main(){
  vec2 p = vLocal;
  vec3 col = vCol.rgb;
  float a = vCol.a;
  int s = vShape;
  if (s < 20) {
    float fillAmt = vParam.x;
    float rimW = vParam.y;
    float d;
    if (s == 0) d = length(p) - 1.0;
    else if (s == 1) { float th = max(rimW, 0.02); d = abs(length(p) - 1.0 + th) - th; rimW = th * 0.8; }
    else if (s == 2) d = sdTri(p);
    else if (s == 3) d = sdBox(p, vec2(0.84), 0.2);
    else if (s == 4) d = sdRhombus(p, vec2(1.0, 0.62));
    else if (s == 5) d = sdHex(p, 0.88);
    else if (s == 6) d = sdStar5(p, 1.0, 0.46);
    else if (s == 7) d = sdPent(p, 0.84);
    else if (s == 8) d = sdVesica(p.yx, 2.125, 1.875);
    else if (s == 9) d = max(length(p) - 1.0, 1.257 - length(p + vec2(0.607, 0.0)));
    else if (s == 10) d = sdCross(p, vec2(0.95, 0.34));
    else d = sdOct(p, 0.92);
    o = neon(d, col, a, fillAmt, rimW);
    return;
  }
  if (s == 20) {
    float f = clamp(1.0 - length(p), 0.0, 1.0);
    float k = f * f * (0.55 + 0.45 * f);
    o = vec4(col * k * a, 0.0);
  } else if (s == 21) {
    float k = clamp(1.0 - (abs(p.x) + abs(p.y)), 0.0, 1.0);
    o = vec4(col * k * k * a, 0.0);
  } else if (s == 22) {
    vec2 q = p * vSize;
    float hl = max(vSize.x - vSize.y, 0.0);
    float dd = length(vec2(max(abs(q.x) - hl, 0.0), q.y)) / max(vSize.y, 1e-3);
    float f = clamp(1.0 - dd, 0.0, 1.0);
    float core = smoothstep(0.6, 0.95, f);
    vec3 c = col * f * f + vec3(core) * vParam.x;
    o = vec4(c * a, 0.0);
  } else if (s == 23) {
    float r = length(p);
    float th = max(vParam.y, 0.01);
    float x = (r - (1.0 - th)) / th;
    float k = exp(-x * x * 4.0);
    k += vParam.x * (1.0 - smoothstep(0.0, 1.0, r));
    o = vec4(col * k * a, 0.0);
  } else if (s == 24) {
    float r = length(p);
    float aa = fwidth(r) * 1.5;
    float inside = 1.0 - smoothstep(0.56 - aa, 0.56 + aa, r);
    float rx = (r - 0.62) / 0.07;
    float ring = exp(-rx * rx);
    float halo = exp(-max(r - 0.6, 0.0) * 5.0) * (1.0 - inside) * 0.4;
    vec3 c = col * (ring * 1.8 + halo);
    o = vec4(c * a, inside * a);
  } else if (s == 25) {
    vec2 q = abs(p);
    float k = exp(-q.x * 16.0) * max(1.0 - q.y, 0.0) + exp(-q.y * 16.0) * max(1.0 - q.x, 0.0);
    k += exp(-dot(p, p) * 18.0) * 0.8;
    o = vec4(col * k * a, 0.0);
  } else if (s == 26) {
    float f = clamp(1.0 - length(p), 0.0, 1.0);
    f = f * f;
    o = vec4(col * f * a, f * a);
  } else if (s == 27) {
    float r0 = length(p);
    float d1 = max(r0 - 1.0, 1.257 - length(p + vec2(0.607, 0.0)));
    float aa = max(fwidth(d1), 1e-4);
    float inside = 1.0 - smoothstep(-aa, aa, d1);
    float ang = atan(p.y, p.x);
    float u = (ang + 1.4) / 2.8;
    float prog = vParam.x;
    float vis = 1.0 - smoothstep(prog - 0.04, prog + 0.02, u);
    float trail = exp(-max(prog - u, 0.0) * 2.5);
    float tips = smoothstep(0.0, 0.12, u) * (1.0 - smoothstep(0.88, 1.0, u));
    float edge = smoothstep(0.7, 1.0, r0);
    float k = inside * vis * tips * (0.3 + 0.7 * trail) * (0.35 + edge * 1.3);
    o = vec4(col * k * a, 0.0);
  } else if (s == 28) {
    o = vec4(col * a, a);
  } else if (s == 29) {
    float r = length(p);
    float aa = fwidth(r) * 2.0;
    float inside = 1.0 - smoothstep(1.0 - aa, 1.0, r);
    vec2 hp = p * 7.0;
    float g = cos(hp.x * 2.0) + cos(dot(hp, vec2(1.0, 1.7320508))) + cos(dot(hp, vec2(-1.0, 1.7320508)));
    float grid = smoothstep(1.6, 2.9, g);
    float rx = (r - 0.95) / 0.05;
    float rim = exp(-rx * rx);
    float fill = 0.10 + 0.22 * r * r * r;
    o = vec4(col * (fill * inside + rim * 0.9 + grid * 0.22 * inside * (0.4 + 0.6 * r)) * a, 0.0);
  } else {
    float idx = vParam.x;
    vec2 uv = vec2((idx + (p.x * 0.5 + 0.5)) / uGlyphs, p.y * 0.5 + 0.5);
    vec4 t = texture(uFont, uv);
    vec3 c = t.rgb * col;
    o = vec4(c * t.a * a, t.a * a);
  }
}`;

  const VS_FULL = `#version 300 es
out vec2 vUv;
void main(){
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

  const FS_BG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec4 uCam;
uniform float uTime;
uniform float uPulse;
uniform vec2 uPlayer;
uniform vec3 uTint;
uniform float uDanger;
out vec4 o;
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++){ v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return v;
}
float hexDist(vec2 p){
  p = abs(p);
  return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x);
}
void main(){
  vec2 off = (vUv - 0.5) * uCam.zw * vec2(1.0, -1.0);
  vec2 world = uCam.xy + off;
  vec3 col = vec3(0.016, 0.010, 0.036) + vec3(0.02, 0.0, 0.03) * (1.0 - vUv.y);

  // nebula (slow parallax)
  vec2 np = (uCam.xy * 0.22 + off) * 0.0012;
  float n = fbm(np + vec2(uTime * 0.012, 0.0));
  float n2 = fbm(np * 1.6 - vec2(0.0, uTime * 0.01) + 5.2);
  vec3 neb = mix(vec3(0.30, 0.04, 0.42), vec3(0.02, 0.22, 0.38), n2);
  neb = mix(neb, vec3(0.45, 0.05, 0.08), uDanger * 0.7);
  col += neb * smoothstep(0.38, 0.9, n) * 0.42 * uTint;

  // stars (mid parallax)
  vec2 sp = (uCam.xy * 0.5 + off) * 0.022;
  vec2 si = floor(sp);
  vec2 sf = fract(sp) - 0.5;
  float h = hash(si);
  if (h > 0.86) {
    vec2 so = vec2(hash(si + 3.1), hash(si + 7.7)) - 0.5;
    float d = length(sf - so * 0.7);
    float tw = 0.55 + 0.45 * sin(uTime * (1.0 + h * 3.0) + h * 40.0);
    col += vec3(0.65, 0.75, 1.0) * (1.0 - smoothstep(0.0, 0.07, d)) * tw * (h - 0.86) * 6.0;
  }

  // hex floor
  vec2 uv = world / 64.0;
  const vec2 r = vec2(1.0, 1.7320508);
  const vec2 hh = r * 0.5;
  vec2 a = mod(uv, r) - hh;
  vec2 b = mod(uv - hh, r) - hh;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  vec2 id = uv - gv;
  float edge = 0.5 - hexDist(gv);
  float fw = fwidth(edge);
  float line = 1.0 - smoothstep(fw * 0.5, fw * 1.6, edge);
  float soft = exp(-edge * 14.0) * 0.35;
  float dP = length(world - uPlayer);
  float light = 0.18 + 0.82 * exp(-dP * 0.0021);
  float t = hash(id);
  float lit = step(0.94, t) * (0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * 1.7 + t * 60.0)));
  float beatLit = step(0.975, hash(id + floor(uTime * 2.133))) * uPulse;
  vec3 gridCol = mix(vec3(0.10, 0.45, 1.0), vec3(0.75, 0.15, 1.0), 0.5 + 0.5 * sin(world.x * 0.0009 + world.y * 0.0006 + uTime * 0.15));
  gridCol = mix(gridCol, vec3(1.0, 0.12, 0.2), uDanger);
  float gi = (line * 0.16 + soft * 0.10) * light * (1.0 + uPulse * 0.7);
  col += gridCol * gi * uTint;
  col += gridCol * (lit * 0.05 + beatLit * 0.12) * light * (1.0 - smoothstep(0.0, 0.5, -edge + 0.5)) * uTint;
  o = vec4(col, 1.0);
}`;

  const FS_DOWN = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform int uPre;
uniform float uThreshold;
out vec4 o;
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 T(vec2 off){ return texture(uTex, vUv + uTexel * off).rgb; }
void main(){
  vec3 a = T(vec2(-2.0, 2.0)), b = T(vec2(0.0, 2.0)), c = T(vec2(2.0, 2.0));
  vec3 d = T(vec2(-2.0, 0.0)), e = T(vec2(0.0, 0.0)), f = T(vec2(2.0, 0.0));
  vec3 g = T(vec2(-2.0, -2.0)), h = T(vec2(0.0, -2.0)), i = T(vec2(2.0, -2.0));
  vec3 j = T(vec2(-1.0, 1.0)), k = T(vec2(1.0, 1.0)), l = T(vec2(-1.0, -1.0)), m = T(vec2(1.0, -1.0));
  vec3 res;
  if (uPre == 1) {
    vec3 g0 = (j + k + l + m) * 0.25;
    vec3 g1 = (a + b + d + e) * 0.25;
    vec3 g2 = (b + c + e + f) * 0.25;
    vec3 g3 = (d + e + g + h) * 0.25;
    vec3 g4 = (e + f + h + i) * 0.25;
    float w0 = 0.5 / (1.0 + luma(g0));
    float w1 = 0.125 / (1.0 + luma(g1));
    float w2 = 0.125 / (1.0 + luma(g2));
    float w3 = 0.125 / (1.0 + luma(g3));
    float w4 = 0.125 / (1.0 + luma(g4));
    res = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
    float br = max(res.r, max(res.g, res.b));
    float knee = uThreshold * 0.5;
    float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 1e-5);
    float contrib = max(soft, br - uThreshold) / max(br, 1e-5);
    res *= contrib;
  } else {
    res = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  o = vec4(res, 1.0);
}`;

  const FS_UP = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uWeight;
out vec4 o;
void main(){
  vec2 t = uTexel;
  vec3 s = texture(uTex, vUv).rgb * 4.0;
  s += (texture(uTex, vUv + vec2(-t.x, 0.0)).rgb + texture(uTex, vUv + vec2(t.x, 0.0)).rgb +
        texture(uTex, vUv + vec2(0.0, -t.y)).rgb + texture(uTex, vUv + vec2(0.0, t.y)).rgb) * 2.0;
  s += texture(uTex, vUv + vec2(-t.x, -t.y)).rgb + texture(uTex, vUv + vec2(t.x, -t.y)).rgb +
       texture(uTex, vUv + vec2(-t.x, t.y)).rgb + texture(uTex, vUv + vec2(t.x, t.y)).rgb;
  o = vec4(s / 16.0 * uWeight, 1.0);
}`;

  const FS_COMP = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomStr;
uniform float uChroma;
uniform float uVignette;
uniform float uHurt;
uniform float uFlash;
uniform float uTime;
uniform float uExposure;
uniform float uSat;
uniform vec2 uAspect;
uniform vec4 uShock[8];
uniform int uShockN;
out vec4 o;
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  vec2 uv = vUv;
  vec2 off = vec2(0.0);
  for (int i = 0; i < 8; i++) {
    if (i >= uShockN) break;
    vec4 s = uShock[i];
    vec2 d = (uv - s.xy) * uAspect;
    float r = length(d);
    float w = s.z * 0.22 + 0.015;
    float x = (r - s.z) / w;
    float k = exp(-x * x) * s.w;
    off += (d / max(r, 1e-4)) * k / uAspect;
  }
  uv -= off * 0.03;
  vec2 cd = uv - 0.5;
  float ca = uChroma * (0.25 + dot(cd, cd) * 2.5);
  vec2 co = cd * ca;
  vec3 sc = vec3(texture(uScene, uv - co).r, texture(uScene, uv).g, texture(uScene, uv + co).b);
  vec3 bl = vec3(texture(uBloom, uv - co * 1.6).r, texture(uBloom, uv).g, texture(uBloom, uv + co * 1.6).b);
  vec3 col = sc + bl * uBloomStr;
  col += vec3(uFlash);
  col = vec3(1.0) - exp(-col * uExposure);
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, uSat);
  float vd = length(cd * vec2(uAspect.x / max(uAspect.x, 1.0), 1.0) * 1.15);
  float vig = 1.0 - smoothstep(0.32, 0.95, vd);
  col *= mix(1.0 - uVignette, 1.0, vig);
  col = mix(col, vec3(0.75, 0.0, 0.08), clamp(uHurt * (1.0 - vig) * (1.0 - vig) * 0.85, 0.0, 0.7));
  col += (hash12(gl_FragCoord.xy + fract(uTime * 7.0) * 100.0) - 0.5) * 0.022;
  o = vec4(col, 1.0);
}`;

  // ---------------- GL helpers ----------------
  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      throw new Error('Shader compile error: ' + log);
    }
    return s;
  }
  function program(vs, fs, uniforms) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Program link error: ' + gl.getProgramInfoLog(p));
    const u = {};
    for (const name of uniforms) u[name] = gl.getUniformLocation(p, name);
    return [p, u];
  }

  function makeTarget(w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, fmtInternal, w, h, 0, gl.RGBA, fmtType, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, w, h, ok };
  }
  function freeTarget(t) {
    if (!t) return;
    gl.deleteTexture(t.tex);
    gl.deleteFramebuffer(t.fbo);
  }

  function detectHdr() {
    const ext = gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float');
    if (!ext) return false;
    fmtInternal = gl.RGBA16F; fmtType = gl.HALF_FLOAT;
    const t = makeTarget(4, 4);
    freeTarget(t);
    return t.ok;
  }

  function buildFont() {
    const cw = 48, ch = 64;
    const c = document.createElement('canvas');
    c.width = cw * GLYPHS.length; c.height = ch;
    const x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);
    x.font = '700 50px "Chakra Petch", "Arial Black", "Helvetica Neue", Arial, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.lineJoin = 'round';
    x.lineWidth = 10;
    x.strokeStyle = 'rgba(10,0,20,1)';
    x.fillStyle = '#fff';
    for (let i = 0; i < GLYPHS.length; i++) {
      x.strokeText(GLYPHS[i], cw * i + cw / 2, ch / 2 + 3);
    }
    for (let i = 0; i < GLYPHS.length; i++) {
      x.fillText(GLYPHS[i], cw * i + cw / 2, ch / 2 + 3);
    }
    if (!fontTex) fontTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, fontTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  // ---------------- public ----------------
  function init(cv) {
    canvas = cv;
    gl = canvas.getContext('webgl2', {
      antialias: false, alpha: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 不可用');
    hdr = detectHdr();
    if (!hdr) { fmtInternal = gl.RGBA8; fmtType = gl.UNSIGNED_BYTE; }

    [progSprite, uSprite] = program(VS_SPRITE, FS_SPRITE, ['uCam', 'uFont', 'uGlyphs']);
    [progBg, uBg] = program(VS_FULL, FS_BG, ['uCam', 'uTime', 'uPulse', 'uPlayer', 'uTint', 'uDanger']);
    [progDown, uDown] = program(VS_FULL, FS_DOWN, ['uTex', 'uTexel', 'uPre', 'uThreshold']);
    [progUp, uUp] = program(VS_FULL, FS_UP, ['uTex', 'uTexel', 'uWeight']);
    [progComp, uComp] = program(VS_FULL, FS_COMP, ['uScene', 'uBloom', 'uBloomStr', 'uChroma', 'uVignette', 'uHurt', 'uFlash', 'uTime', 'uExposure', 'uSat', 'uAspect', 'uShock', 'uShockN']);

    // sprite VAO
    vaoSprite = gl.createVertexArray();
    gl.bindVertexArray(vaoSprite);
    const corner = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, corner);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    instBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, inst.byteLength, gl.DYNAMIC_DRAW);
    const stride = FLOATS * 4;
    for (let k = 0; k < 3; k++) {
      gl.enableVertexAttribArray(1 + k);
      gl.vertexAttribPointer(1 + k, 4, gl.FLOAT, false, stride, k * 16);
      gl.vertexAttribDivisor(1 + k, 1);
    }
    gl.bindVertexArray(null);
    vaoEmpty = gl.createVertexArray();

    buildFont();
    resize();
    return { hdr };
  }

  function setQuality(q) {
    quality = q;
    mipCount = q === 'low' ? 4 : q === 'medium' ? 5 : 6;
    resize();
  }

  function resize() {
    if (!gl) return;
    cssW = Math.max(1, window.innerWidth);
    cssH = Math.max(1, window.innerHeight);
    const dpr = window.devicePixelRatio || 1;
    let scale = quality === 'low' ? Math.min(dpr, 1) * 0.75 : quality === 'medium' ? Math.min(dpr, 1.25) : Math.min(dpr, 2);
    const maxPixels = quality === 'high' ? 2560 * 1600 : 1920 * 1080;
    if (cssW * cssH * scale * scale > maxPixels) scale = Math.sqrt(maxPixels / (cssW * cssH));
    W = Math.max(1, Math.round(cssW * scale));
    H = Math.max(1, Math.round(cssH * scale));
    canvas.width = W;
    canvas.height = H;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    freeTarget(scene);
    for (const m of mips) freeTarget(m);
    scene = makeTarget(W, H);
    mips = [];
    let w = W, h = H;
    for (let i = 0; i < mipCount; i++) {
      w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
      mips.push(makeTarget(w, h));
    }
  }

  function setCamera(x, y, vw, vh) { camX = x; camY = y; viewW = vw; viewH = vh; }

  function begin() { count = 0; }

  function sprite(x, y, sx, sy, rot, shape, r, g, b, a, p1, p2) {
    if (count >= MAX_INST) return;
    const o = count * FLOATS;
    const d = inst;
    d[o] = x; d[o + 1] = y; d[o + 2] = sx; d[o + 3] = sy;
    d[o + 4] = rot; d[o + 5] = shape; d[o + 6] = p1; d[o + 7] = p2;
    d[o + 8] = r; d[o + 9] = g; d[o + 10] = b; d[o + 11] = a;
    count++;
  }

  // core: strength of the white-hot center line (0 for pure colored glow)
  function beam(x1, y1, x2, y2, width, r, g, b, a, core) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    const hw = width * 0.5;
    sprite((x1 + x2) * 0.5, (y1 + y2) * 0.5, len * 0.5 + hw, hw, Math.atan2(dy, dx), SH.BEAM, r, g, b, a, core === undefined ? 1 : core, 0);
  }

  // number as glyph quads, centered at x,y
  function number(str, x, y, h, r, g, b, a) {
    const n = str.length;
    const adv = h * 0.58;
    const gw = h * 0.75;
    let px = x - (n - 1) * adv * 0.5;
    for (let i = 0; i < n; i++) {
      const gi = glyphIndex[str[i]];
      if (gi !== undefined) sprite(px, y, gw * 0.5, h * 0.5, 0, SH.GLYPH, r, g, b, a, gi, 0);
      px += adv;
    }
  }

  function bindTex(unit, tex) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }

  // post = { time, pulse, player:[x,y], tint:[r,g,b], danger, bloom, chroma, vignette, hurt, flash, exposure, sat, shocks:Float32Array(32), shockN }
  function render(post) {
    // ---- scene ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);
    gl.useProgram(progBg);
    gl.uniform4f(uBg.uCam, camX, camY, viewW, viewH);
    gl.uniform1f(uBg.uTime, post.time);
    gl.uniform1f(uBg.uPulse, post.pulse);
    gl.uniform2f(uBg.uPlayer, post.px, post.py);
    gl.uniform3f(uBg.uTint, post.tint[0], post.tint[1], post.tint[2]);
    gl.uniform1f(uBg.uDanger, post.danger);
    gl.bindVertexArray(vaoEmpty);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (count > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(progSprite);
      gl.uniform4f(uSprite.uCam, camX, camY, 2 / viewW, -2 / viewH);
      gl.uniform1i(uSprite.uFont, 0);
      gl.uniform1f(uSprite.uGlyphs, GLYPHS.length);
      bindTex(0, fontTex);
      gl.bindVertexArray(vaoSprite);
      gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, inst, 0, count * FLOATS);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    }

    // ---- bloom ----
    gl.disable(gl.BLEND);
    gl.bindVertexArray(vaoEmpty);
    gl.useProgram(progDown);
    gl.uniform1i(uDown.uTex, 0);
    gl.uniform1f(uDown.uThreshold, hdr ? 0.85 : 0.62);
    let src = scene;
    for (let i = 0; i < mips.length; i++) {
      const dst = mips[i];
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
      gl.viewport(0, 0, dst.w, dst.h);
      gl.uniform1i(uDown.uPre, i === 0 ? 1 : 0);
      gl.uniform2f(uDown.uTexel, 1 / src.w, 1 / src.h);
      bindTex(0, src.tex);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      src = dst;
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(progUp);
    gl.uniform1i(uUp.uTex, 0);
    for (let i = mips.length - 1; i > 0; i--) {
      const s = mips[i], d = mips[i - 1];
      gl.bindFramebuffer(gl.FRAMEBUFFER, d.fbo);
      gl.viewport(0, 0, d.w, d.h);
      gl.uniform2f(uUp.uTexel, 1 / s.w, 1 / s.h);
      gl.uniform1f(uUp.uWeight, 1.0);
      bindTex(0, s.tex);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.BLEND);

    // ---- composite ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(progComp);
    gl.uniform1i(uComp.uScene, 0);
    gl.uniform1i(uComp.uBloom, 1);
    bindTex(0, scene.tex);
    bindTex(1, mips[0].tex);
    gl.uniform1f(uComp.uBloomStr, post.bloom * (hdr ? 1.0 : 1.4));
    gl.uniform1f(uComp.uChroma, post.chroma);
    gl.uniform1f(uComp.uVignette, post.vignette);
    gl.uniform1f(uComp.uHurt, post.hurt);
    gl.uniform1f(uComp.uFlash, post.flash);
    gl.uniform1f(uComp.uTime, post.time);
    gl.uniform1f(uComp.uExposure, post.exposure);
    gl.uniform1f(uComp.uSat, post.sat);
    gl.uniform2f(uComp.uAspect, viewW / viewH, 1);
    gl.uniform4fv(uComp.uShock, post.shocks);
    gl.uniform1i(uComp.uShockN, post.shockN);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    bindTex(1, null);
    bindTex(0, null);
  }

  return {
    init, resize, setQuality, setCamera, begin, sprite, beam, number, render, buildFont,
    get count() { return count; },
    get width() { return W; },
    get height() { return H; },
    get cssW() { return cssW; },
    get cssH() { return cssH; },
    get hdr() { return hdr; },
    get gl() { return gl; },
  };
})();
