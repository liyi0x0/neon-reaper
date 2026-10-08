'use strict';
// ============================================================
//  World: struct-of-arrays entity pools, spatial grid,
//  damage pipeline, particles, pickups, bullets
// ============================================================
const f32 = (n) => new Float32Array(n);

// ---------------- enemies ----------------
const MAX_EN = 3000;
const MAX_ALIVE = 1800;
const HITCD = 8;
const EN = {
  n: 0, count: 0, freeN: 0,
  alive: new Uint8Array(MAX_EN), type: new Uint8Array(MAX_EN), elite: new Uint8Array(MAX_EN), st: new Uint8Array(MAX_EN),
  x: f32(MAX_EN), y: f32(MAX_EN), kx: f32(MAX_EN), ky: f32(MAX_EN), r: f32(MAX_EN),
  hp: f32(MAX_EN), maxHp: f32(MAX_EN), spd: f32(MAX_EN), dmg: f32(MAX_EN), xp: f32(MAX_EN),
  flash: f32(MAX_EN), slowT: f32(MAX_EN), slowAmt: f32(MAX_EN), freezeT: f32(MAX_EN), kbr: f32(MAX_EN),
  t: f32(MAX_EN), ang: f32(MAX_EN), spawnT: f32(MAX_EN), dirX: f32(MAX_EN), dirY: f32(MAX_EN), fuse: f32(MAX_EN),
  uid: new Int32Array(MAX_EN),
  hitCd: f32(MAX_EN * HITCD),
  free: new Int32Array(MAX_EN),
};
let uidCounter = 1;

function spawnEnemy(ti, x, y, hpMul, elite) {
  let i;
  if (EN.freeN > 0) i = EN.free[--EN.freeN];
  else if (EN.n < MAX_EN) i = EN.n++;
  else return -1;
  const T = ENEMY_TYPES[ti];
  EN.alive[i] = 1; EN.type[i] = ti; EN.elite[i] = elite ? 1 : 0; EN.st[i] = 0;
  EN.x[i] = x; EN.y[i] = y; EN.kx[i] = 0; EN.ky[i] = 0;
  EN.r[i] = T.r * (elite ? 1.7 : 1);
  const hp = T.hp * hpMul * (elite ? 14 : 1);
  EN.hp[i] = hp; EN.maxHp[i] = hp;
  EN.spd[i] = T.speed * (elite ? 0.92 : rand(0.9, 1.12));
  EN.dmg[i] = T.dmg * Director.dmgMul() * (elite ? 1.4 : 1);
  EN.xp[i] = T.xp * (elite ? 12 : 1);
  EN.kbr[i] = elite ? Math.max(0.75, T.kb) : T.kb;
  EN.flash[i] = 0; EN.slowT[i] = 0; EN.slowAmt[i] = 0; EN.freezeT[i] = 0;
  EN.t[i] = rand(0, 2.5); EN.ang[i] = rand(TAU); EN.spawnT[i] = 0;
  EN.dirX[i] = 0; EN.dirY[i] = 0; EN.fuse[i] = 0;
  EN.uid[i] = uidCounter++;
  const h = i * HITCD;
  for (let k = 0; k < HITCD; k++) EN.hitCd[h + k] = 0;
  EN.count++;
  return i;
}

function clearEnemies() {
  EN.alive.fill(0); EN.n = 0; EN.count = 0; EN.freeN = 0;
}

// ---------------- spatial grid ----------------
const CELL = 64, GW = 80, GH = 80;
const Grid = {
  ox: 0, oy: 0,
  cnt: new Int32Array(GW * GH),
  start: new Int32Array(GW * GH + 1),
  cur: new Int32Array(GW * GH),
  items: new Int32Array(MAX_EN * 6),
};
const qStamp = new Uint32Array(MAX_EN);
let qId = 0;
const qA = new Int32Array(MAX_EN), qB = new Int32Array(MAX_EN), qC = new Int32Array(MAX_EN);

function buildGrid() {
  const ox = Grid.ox = (Math.floor(P.x / CELL) - (GW >> 1)) * CELL;
  const oy = Grid.oy = (Math.floor(P.y / CELL) - (GH >> 1)) * CELL;
  const cnt = Grid.cnt, start = Grid.start, cur = Grid.cur, items = Grid.items;
  cnt.fill(0);
  const n = EN.n;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      if (!EN.alive[i]) continue;
      const big = EN.r[i] > 30 ? EN.r[i] : 0;
      let cx0 = Math.floor((EN.x[i] - big - ox) / CELL), cx1 = Math.floor((EN.x[i] + big - ox) / CELL);
      let cy0 = Math.floor((EN.y[i] - big - oy) / CELL), cy1 = Math.floor((EN.y[i] + big - oy) / CELL);
      if (cx1 < 0 || cy1 < 0 || cx0 >= GW || cy0 >= GH) continue;
      if (cx0 < 0) cx0 = 0; if (cy0 < 0) cy0 = 0;
      if (cx1 >= GW) cx1 = GW - 1; if (cy1 >= GH) cy1 = GH - 1;
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const c = cy * GW + cx;
          if (pass === 0) cnt[c]++;
          else if (cur[c] < start[c + 1]) items[cur[c]++] = i;
        }
      }
    }
    if (pass === 0) {
      let s = 0;
      const cells = GW * GH;
      for (let c = 0; c < cells; c++) {
        start[c] = s;
        cur[c] = s;
        s += cnt[c];
        if (s > items.length) s = items.length;
      }
      start[cells] = s;
    }
  }
}

// enemies whose circle overlaps circle (x,y,r); returns count written to out
function queryEnemies(x, y, r, out) {
  qId = (qId + 1) >>> 0;
  if (qId === 0) { qStamp.fill(0); qId = 1; }
  const R = r + 32;
  let cx0 = Math.floor((x - R - Grid.ox) / CELL), cx1 = Math.floor((x + R - Grid.ox) / CELL);
  let cy0 = Math.floor((y - R - Grid.oy) / CELL), cy1 = Math.floor((y + R - Grid.oy) / CELL);
  if (cx1 < 0 || cy1 < 0 || cx0 >= GW || cy0 >= GH) return 0;
  if (cx0 < 0) cx0 = 0; if (cy0 < 0) cy0 = 0;
  if (cx1 >= GW) cx1 = GW - 1; if (cy1 >= GH) cy1 = GH - 1;
  const start = Grid.start, items = Grid.items;
  let n = 0;
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const c = cy * GW + cx;
      for (let k = start[c], e = start[c + 1]; k < e; k++) {
        const i = items[k];
        if (qStamp[i] === qId) continue;
        qStamp[i] = qId;
        if (!EN.alive[i]) continue;
        const dx = EN.x[i] - x, dy = EN.y[i] - y, rr = r + EN.r[i];
        if (dx * dx + dy * dy <= rr * rr) out[n++] = i;
      }
    }
  }
  return n;
}

function nearestEnemy(x, y, maxR, skipUid) {
  let best = -1, bd = maxR * maxR;
  const n = EN.n;
  for (let i = 0; i < n; i++) {
    if (!EN.alive[i] || EN.uid[i] === skipUid) continue;
    const dx = EN.x[i] - x, dy = EN.y[i] - y;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function randomEnemyNear(x, y, r) {
  const n = queryEnemies(x, y, r, qC);
  if (n === 0) return -1;
  return qC[(Math.random() * n) | 0];
}

// center of the densest grid cell near (x,y) within r
function densestSpot(x, y, r, out) {
  let best = -1, bc = 0;
  const cr = Math.ceil(r / CELL);
  const ccx = Math.floor((x - Grid.ox) / CELL), ccy = Math.floor((y - Grid.oy) / CELL);
  for (let cy = Math.max(0, ccy - cr); cy <= Math.min(GH - 1, ccy + cr); cy++) {
    for (let cx = Math.max(0, ccx - cr); cx <= Math.min(GW - 1, ccx + cr); cx++) {
      const c = cy * GW + cx;
      const k = Grid.cnt[c] + Math.random() * 0.5;
      if (k > bc) { bc = k; best = c; }
    }
  }
  if (best < 0 || bc < 1) return false;
  out.x = Grid.ox + ((best % GW) + 0.5) * CELL;
  out.y = Grid.oy + (Math.floor(best / GW) + 0.5) * CELL;
  return true;
}

// ---------------- particles ----------------
const MAX_PT = 24000;
const PT = {
  n: 0,
  x: f32(MAX_PT), y: f32(MAX_PT), vx: f32(MAX_PT), vy: f32(MAX_PT),
  life: f32(MAX_PT), max: f32(MAX_PT), s0: f32(MAX_PT), s1: f32(MAX_PT),
  r: f32(MAX_PT), g: f32(MAX_PT), b: f32(MAX_PT), a: f32(MAX_PT),
  rot: f32(MAX_PT), rv: f32(MAX_PT), drag: f32(MAX_PT), stretch: f32(MAX_PT),
  shape: new Uint8Array(MAX_PT),
};
function emit(x, y, vx, vy, life, s0, s1, r, g, b, a, shape, drag, stretch, rot, rv) {
  if (PT.n >= MAX_PT) return -1;
  const i = PT.n++;
  PT.x[i] = x; PT.y[i] = y; PT.vx[i] = vx; PT.vy[i] = vy;
  PT.life[i] = life; PT.max[i] = life; PT.s0[i] = s0; PT.s1[i] = s1;
  PT.r[i] = r; PT.g[i] = g; PT.b[i] = b; PT.a[i] = a;
  PT.shape[i] = shape; PT.drag[i] = drag || 0; PT.stretch[i] = stretch || 0;
  PT.rot[i] = rot || 0; PT.rv[i] = rv || 0;
  return i;
}
function movePT(s, d) {
  PT.x[d] = PT.x[s]; PT.y[d] = PT.y[s]; PT.vx[d] = PT.vx[s]; PT.vy[d] = PT.vy[s];
  PT.life[d] = PT.life[s]; PT.max[d] = PT.max[s]; PT.s0[d] = PT.s0[s]; PT.s1[d] = PT.s1[s];
  PT.r[d] = PT.r[s]; PT.g[d] = PT.g[s]; PT.b[d] = PT.b[s]; PT.a[d] = PT.a[s];
  PT.rot[d] = PT.rot[s]; PT.rv[d] = PT.rv[s]; PT.drag[d] = PT.drag[s]; PT.stretch[d] = PT.stretch[s];
  PT.shape[d] = PT.shape[s];
}
function updateParticles(dt) {
  let n = PT.n, i = 0;
  while (i < n) {
    const l = PT.life[i] - dt;
    if (l <= 0) { n--; if (i !== n) movePT(n, i); continue; }
    PT.life[i] = l;
    const d = PT.drag[i];
    if (d > 0) { let k = 1 - d * dt; if (k < 0) k = 0; PT.vx[i] *= k; PT.vy[i] *= k; }
    PT.x[i] += PT.vx[i] * dt;
    PT.y[i] += PT.vy[i] * dt;
    PT.rot[i] += PT.rv[i] * dt;
    i++;
  }
  PT.n = n;
}
function fxLoad() { return PT.n / MAX_PT; }

function sparks(x, y, n, col, s0, s1, life, size, bias, biasX, biasY) {
  n = Math.round(n * G.fxMul);
  for (let k = 0; k < n; k++) {
    let a = rand(TAU);
    if (bias) a = Math.atan2(biasY, biasX) + rand(-bias, bias);
    const s = rand(s0, s1);
    emit(x, y, Math.cos(a) * s, Math.sin(a) * s, life * rand(0.6, 1.25), size * rand(0.7, 1.3), 0,
      col[0], col[1], col[2], 1, SH.SPARK, 3.2, 0.035);
  }
}
function flashAt(x, y, size, col, life, a) {
  emit(x, y, 0, 0, life, size * 0.6, size, col[0], col[1], col[2], a === undefined ? 1 : a, SH.GLOW, 0, 0);
}
function ring(x, y, r0, r1, life, col, th, a) {
  if (G.rings.length > 160) return;
  G.rings.push({ x, y, r0, r1, t: 0, life, c: col, th: th || 0.12, a: a === undefined ? 1 : a });
}
function shock(x, y, maxR, life, str) {
  if (G.shocks.length >= 8) G.shocks.shift();
  G.shocks.push({ x, y, maxR, t: 0, life, str });
}
function deathFx(x, y, r, col, big) {
  const m = G.fxMul;
  const load = fxLoad();
  flashAt(x, y, r * (big ? 5 : 2.6), col, big ? 0.35 : 0.18, 0.9);
  if (load > 0.85 && !big) return;
  const n = Math.round((big ? 30 : 7) * m * (load > 0.6 ? 0.5 : 1));
  for (let k = 0; k < n; k++) {
    const a = rand(TAU), s = rand(90, 360) * (big ? 1.6 : 1);
    emit(x, y, Math.cos(a) * s, Math.sin(a) * s, rand(0.22, 0.48), rand(2.5, 4.5), 0,
      col[0] * 1.3, col[1] * 1.3, col[2] * 1.3, 1, SH.SPARK, 3.5, 0.035);
  }
  const ns = Math.round((big ? 12 : 3) * m * (load > 0.6 ? 0.4 : 1));
  for (let k = 0; k < ns; k++) {
    const a = rand(TAU), s = rand(60, 220);
    emit(x, y, Math.cos(a) * s, Math.sin(a) * s, rand(0.35, 0.75), r * rand(0.25, 0.42), r * 0.05,
      col[0], col[1], col[2], 1, SH.TRI, 3, 0, rand(TAU), rand(-14, 14));
  }
  if (big) {
    ring(x, y, r, r * 6, 0.5, col, 0.1);
    shock(x, y, r * 6, 0.5, 0.6);
  }
}
const ICE = [0.6, 0.92, 1.0];
function shatterFx(x, y, r) {
  const n = Math.round(6 * G.fxMul);
  for (let k = 0; k < n; k++) {
    const a = rand(TAU), s = rand(80, 260);
    emit(x, y, Math.cos(a) * s, Math.sin(a) * s, rand(0.3, 0.6), r * rand(0.2, 0.4), 1,
      0.7, 0.95, 1.2, 1, SH.DIAMOND, 4, 0, rand(TAU), rand(-10, 10));
  }
}

// ---------------- damage numbers ----------------
const MAX_DN = 260;
const DN_LIFE = 0.75;
const DN = { head: 0, x: f32(MAX_DN), y: f32(MAX_DN), t: f32(MAX_DN).fill(9), kind: new Uint8Array(MAX_DN), s: new Array(MAX_DN).fill('') };
function addDmgNum(x, y, v, kind) {
  if (!Settings.damageNumbers || G.demo) return;
  // keep late-game screens readable: cap plain numbers per frame, crits get extra headroom
  if (kind <= 1) {
    if (G.dnBudget <= (kind === 1 ? -8 : 0)) return;
    G.dnBudget--;
  }
  const i = DN.head;
  DN.head = (DN.head + 1) % MAX_DN;
  DN.x[i] = x + rand(-8, 8); DN.y[i] = y + rand(-4, 4); DN.t[i] = 0; DN.kind[i] = kind;
  DN.s[i] = fmtBig(Math.max(1, Math.round(v))) + (kind === 1 ? '!' : '');
  if (kind === 3) DN.s[i] = '+' + DN.s[i];
}

// ---------------- pickups ----------------
// kinds: 0 xp, 1 heal, 2 magnet, 3 bomb, 4 chest, 5 freeze, 6 gold
const MAX_PK = 4000;
const PK = {
  n: 0, count: 0, freeN: 0,
  alive: new Uint8Array(MAX_PK), kind: new Uint8Array(MAX_PK), st: new Uint8Array(MAX_PK),
  x: f32(MAX_PK), y: f32(MAX_PK), vx: f32(MAX_PK), vy: f32(MAX_PK), val: f32(MAX_PK), t: f32(MAX_PK),
  free: new Int32Array(MAX_PK),
};
function dropPickup(x, y, kind, val) {
  let i;
  if (PK.freeN > 0) i = PK.free[--PK.freeN];
  else if (PK.n < MAX_PK) i = PK.n++;
  else {
    if (kind !== 0) return -1;
    // pool full: fold the value into the closest of a few sampled gems
    let best = -1, bd = Infinity;
    for (let k = 0; k < 48; k++) {
      const j = (Math.random() * PK.n) | 0;
      if (!PK.alive[j] || PK.kind[j] !== 0) continue;
      const dx = PK.x[j] - x, dy = PK.y[j] - y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = j; }
    }
    if (best >= 0) PK.val[best] += val; else G.xpBank += val;
    return best;
  }
  PK.alive[i] = 1; PK.kind[i] = kind; PK.st[i] = 0; PK.val[i] = val; PK.t[i] = 0;
  const a = rand(TAU), s = kind === 4 ? 0 : rand(30, 90);
  PK.x[i] = x; PK.y[i] = y; PK.vx[i] = Math.cos(a) * s; PK.vy[i] = Math.sin(a) * s;
  PK.count++;
  return i;
}
function removePickup(i) { PK.alive[i] = 0; PK.free[PK.freeN++] = i; PK.count--; }
function clearPickups() { PK.alive.fill(0); PK.n = 0; PK.count = 0; PK.freeN = 0; }

// ---------------- player projectiles ----------------
const MAX_PR = 2500;
const PR_BOLT = 0, PR_STAR = 1, PR_MISSILE = 2, PR_DISC = 3;
const PR_HITS = 6;
const PR = {
  n: 0,
  kind: new Uint8Array(MAX_PR), w: new Int8Array(MAX_PR), hitN: new Uint8Array(MAX_PR),
  x: f32(MAX_PR), y: f32(MAX_PR), vx: f32(MAX_PR), vy: f32(MAX_PR), r: f32(MAX_PR),
  dmg: f32(MAX_PR), pierce: f32(MAX_PR), life: f32(MAX_PR), t: f32(MAX_PR), spd: f32(MAX_PR), a1: f32(MAX_PR),
  tgt: new Int32Array(MAX_PR), tuid: new Int32Array(MAX_PR),
  hits: new Int32Array(MAX_PR * PR_HITS),
};
function spawnProj(kind, wslot, x, y, vx, vy, r, dmg, pierce, life) {
  if (PR.n >= MAX_PR) return -1;
  const i = PR.n++;
  PR.kind[i] = kind; PR.w[i] = wslot; PR.hitN[i] = 0;
  PR.x[i] = x; PR.y[i] = y; PR.vx[i] = vx; PR.vy[i] = vy; PR.r[i] = r;
  PR.dmg[i] = dmg; PR.pierce[i] = pierce; PR.life[i] = life; PR.t[i] = 0;
  PR.spd[i] = Math.sqrt(vx * vx + vy * vy); PR.a1[i] = 0;
  PR.tgt[i] = -1; PR.tuid[i] = 0;
  return i;
}
function moveProj(s, d) {
  PR.kind[d] = PR.kind[s]; PR.w[d] = PR.w[s]; PR.hitN[d] = PR.hitN[s];
  PR.x[d] = PR.x[s]; PR.y[d] = PR.y[s]; PR.vx[d] = PR.vx[s]; PR.vy[d] = PR.vy[s]; PR.r[d] = PR.r[s];
  PR.dmg[d] = PR.dmg[s]; PR.pierce[d] = PR.pierce[s]; PR.life[d] = PR.life[s]; PR.t[d] = PR.t[s];
  PR.spd[d] = PR.spd[s]; PR.a1[d] = PR.a1[s]; PR.tgt[d] = PR.tgt[s]; PR.tuid[d] = PR.tuid[s];
  for (let k = 0; k < PR_HITS; k++) PR.hits[d * PR_HITS + k] = PR.hits[s * PR_HITS + k];
}
function projHasHit(i, uid) {
  const b = i * PR_HITS, n = Math.min(PR.hitN[i], PR_HITS);
  for (let k = 0; k < n; k++) if (PR.hits[b + k] === uid) return true;
  return false;
}
function projAddHit(i, uid) {
  PR.hits[i * PR_HITS + (PR.hitN[i] % PR_HITS)] = uid;
  PR.hitN[i] = Math.min(255, PR.hitN[i] + 1);
}
function setProjTarget(i, e) { PR.tgt[i] = e; PR.tuid[i] = e >= 0 ? EN.uid[e] : 0; }

// ---------------- enemy bullets ----------------
const MAX_EB = 1600;
const EB = { n: 0, x: f32(MAX_EB), y: f32(MAX_EB), vx: f32(MAX_EB), vy: f32(MAX_EB), r: f32(MAX_EB), dmg: f32(MAX_EB), life: f32(MAX_EB), kind: new Uint8Array(MAX_EB) };
function spawnBullet(x, y, vx, vy, r, dmg, kind) {
  if (EB.n >= MAX_EB) return;
  const i = EB.n++;
  EB.x[i] = x; EB.y[i] = y; EB.vx[i] = vx; EB.vy[i] = vy; EB.r[i] = r; EB.dmg[i] = dmg; EB.life[i] = 7; EB.kind[i] = kind || 0;
}
function removeBullet(i) {
  const l = --EB.n;
  if (i === l) return;
  EB.x[i] = EB.x[l]; EB.y[i] = EB.y[l]; EB.vx[i] = EB.vx[l]; EB.vy[i] = EB.vy[l];
  EB.r[i] = EB.r[l]; EB.dmg[i] = EB.dmg[l]; EB.life[i] = EB.life[l]; EB.kind[i] = EB.kind[l];
}
function clearBulletsIn(x, y, r) {
  for (let i = EB.n - 1; i >= 0; i--) {
    const dx = EB.x[i] - x, dy = EB.y[i] - y;
    if (dx * dx + dy * dy < r * r) {
      flashAt(EB.x[i], EB.y[i], 16, [1, 0.5, 0.3], 0.15, 0.7);
      removeBullet(i);
    }
  }
}

// ---------------- deferred blasts (avoid nested queries) ----------------
const blastQ = [];
let blastHead = 0;
function queueBlast(x, y, r, dmg, w, kb, vis, playerDmg) {
  blastQ.push({ x, y, r, dmg, w, kb, vis, pd: playerDmg || 0 });
}
function processBlasts() {
  let guard = 0;
  while (blastHead < blastQ.length && guard++ < 400) {
    const b = blastQ[blastHead++];
    blastVisual(b);
    const n = queryEnemies(b.x, b.y, b.r, qB);
    for (let k = 0; k < n; k++) {
      const i = qB[k];
      if (!EN.alive[i]) continue;
      const dx = EN.x[i] - b.x, dy = EN.y[i] - b.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      damageEnemy(i, b.dmg, b.w, dx / d, dy / d, b.kb);
    }
    if (b.pd > 0) {
      const dx = P.x - b.x, dy = P.y - b.y;
      if (dx * dx + dy * dy < (b.r + P.r) * (b.r + P.r)) hurtPlayer(b.pd, 'blast');
    }
  }
  blastQ.length = 0;
  blastHead = 0;
}
const COL_FIRE = [1.0, 0.55, 0.18];
const COL_BOMB = [1.0, 0.85, 0.25];
function blastVisual(b) {
  const r = b.r;
  const pan = panOf(b.x);
  if (b.vis === 'bomber') {
    flashAt(b.x, b.y, r * 1.8, COL_BOMB, 0.3, 1);
    ring(b.x, b.y, r * 0.3, r * 1.1, 0.35, COL_BOMB, 0.18);
    sparks(b.x, b.y, 14, COL_BOMB, 120, 420, 0.4, 4);
    shock(b.x, b.y, r * 1.6, 0.4, 0.45);
    SFX().boom(pan, 0.8);
    addShake(0.12);
  } else if (b.vis === 'thunder') {
    flashAt(b.x, b.y, r * 1.6, [0.6, 0.75, 1.0], 0.25, 1);
    ring(b.x, b.y, r * 0.2, r, 0.3, [0.6, 0.75, 1.0], 0.15);
  } else if (b.vis === 'implode') {
    flashAt(b.x, b.y, r * 1.5, [0.75, 0.45, 1.0], 0.35, 1);
    ring(b.x, b.y, r * 0.2, r * 1.2, 0.45, [0.8, 0.5, 1.0], 0.12);
    sparks(b.x, b.y, 22, [0.85, 0.55, 1.0], 150, 520, 0.5, 4.5);
    shock(b.x, b.y, r * 1.5, 0.5, 0.8);
    SFX().implode(pan);
    addShake(0.18);
  } else if (b.vis === 'discshock') {
    ring(b.x, b.y, 6, r, 0.25, [0.75, 1.0, 0.3], 0.2);
  } else if (b.vis === 'bomb') {
    // screen-clearing bomb: visuals handled by caller
  } else {
    // missile
    const big = b.vis === 'missile';
    flashAt(b.x, b.y, r * 1.5, COL_FIRE, 0.22, 1);
    ring(b.x, b.y, r * 0.25, r * 1.05, 0.28, [1.0, 0.65, 0.3], 0.16);
    if (fxLoad() < 0.7) {
      sparks(b.x, b.y, big ? 10 : 6, COL_FIRE, 100, 360, 0.35, 3.5);
      const ns = Math.round(3 * G.fxMul);
      for (let k = 0; k < ns; k++) {
        const a = rand(TAU), s = rand(20, 70);
        emit(b.x, b.y, Math.cos(a) * s, Math.sin(a) * s, rand(0.5, 0.9), r * 0.35, r * 0.7, 0.12, 0.06, 0.1, 0.55, SH.SMOKE, 2, 0);
      }
    }
    if (big) shock(b.x, b.y, r * 1.3, 0.3, 0.25);
    SFX().boom(pan, big ? 0.8 : 0.5);
    addShake(big ? 0.05 : 0.025);
  }
}

// ---------------- damage pipeline ----------------
function panOf(x) { return clamp((x - Cam.x) / (Cam.vw * 0.5), -1, 1); }

function damageEnemy(i, base, w, nx, ny, kb) {
  if (!EN.alive[i]) return false;
  let dmg = base * (0.9 + Math.random() * 0.2);
  let crit = false;
  if (Math.random() < S.crit) { dmg *= 2; crit = true; }
  if (EN.freezeT[i] > 0) dmg *= 1.25;
  EN.hp[i] -= dmg;
  EN.flash[i] = 0.09;
  if (kb) {
    const k = kb * (1 - EN.kbr[i]) * S.kb;
    EN.kx[i] += nx * k; EN.ky[i] += ny * k;
  }
  if (w) w.dmgDone += dmg;
  G.dmgDealt += dmg;
  addDmgNum(EN.x[i], EN.y[i] - EN.r[i] - 4, dmg, crit ? 1 : 0);
  if (EN.hp[i] <= 0) { killEnemy(i, w); return true; }
  if (fxLoad() < 0.5 && Math.random() < 0.6) {
    const T = ENEMY_TYPES[EN.type[i]];
    sparks(EN.x[i] - nx * EN.r[i] * 0.5, EN.y[i] - ny * EN.r[i] * 0.5, crit ? 5 : 2, crit ? [1.0, 0.85, 0.4] : T.col, 80, 260, 0.2, 3, 0.9, nx, ny);
  }
  SFX().hit(panOf(EN.x[i]));
  return false;
}

function killEnemy(i, w) {
  const ti = EN.type[i], T = ENEMY_TYPES[ti];
  const x = EN.x[i], y = EN.y[i], r = EN.r[i], elite = EN.elite[i], xp = EN.xp[i];
  const frozen = EN.freezeT[i] > 0;
  EN.alive[i] = 0;
  EN.count--;
  G.kills++;
  G.combo++;
  G.comboT = 2.2;
  if (w) w.kills++;
  if (T.boss) {
    EN.free[EN.freeN++] = i;
    Director.bossKilled(i, ti, x, y, r);
    return;
  }
  deathFx(x, y, r, T.col, elite);
  if (frozen) shatterFx(x, y, r);
  SFX().kill(panOf(x), elite);
  if (xp > 0) dropPickup(x, y, 0, xp);
  if (elite) {
    dropPickup(x, y, 4, 1);
    addShake(0.25);
    G.flash = Math.max(G.flash, 0.15);
    hitStop(0.06);
  } else if (!G.demo) {
    // special drops are rolled per kill but gated by cooldowns so the late-game kill rate can't flood the map
    const rr = Math.random();
    const dc = G.dropCd;
    if (rr < 0.02 && G.time > dc.heal) { dropPickup(x, y, 1, 0); dc.heal = G.time + 10; }
    else if (rr < 0.004 && G.time > dc.magnet) { dropPickup(x, y, 2, 0); dc.magnet = G.time + 50; }
    else if (rr < 0.003 && G.time > dc.bomb) { dropPickup(x, y, 3, 0); dc.bomb = G.time + 55; }
    else if (rr < 0.002 && G.time > dc.freeze) { dropPickup(x, y, 5, 0); dc.freeze = G.time + 70; }
    else if (rr < 0.025) dropPickup(x, y, 6, randInt(1, 3));
  }
  if (T.ai === 2) {
    const hm = Director.hpMul();
    for (let k = 0; k < 3; k++) {
      const a = k / 3 * TAU + rand(-0.4, 0.4);
      const j = spawnEnemy(ET.mini, x + Math.cos(a) * 10, y + Math.sin(a) * 10, hm, false);
      if (j >= 0) { EN.kx[j] = Math.cos(a) * 260; EN.ky[j] = Math.sin(a) * 260; EN.spawnT[j] = 0.3; }
    }
  }
  if (T.ai === 3) queueBlast(x, y, 78, 40 * Director.hpMul(), null, 300, 'bomber', 0);
  // free the slot last so the minis above cannot reuse it in this call
  EN.free[EN.freeN++] = i;
}
