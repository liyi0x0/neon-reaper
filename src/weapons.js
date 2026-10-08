'use strict';
// ============================================================
//  Weapon behaviours + projectile simulation
// ============================================================
const wDmg = (w) => w.st.dmg * S.might;
const wCd = (w) => Math.max(0.04, w.st.cd * S.cd);
const wArea = (w) => w.st.area * S.area;
const wAmount = (w) => w.st.amount + S.amount;
const wDur = (w) => w.st.dur * S.dur;
const wSpeed = (w) => w.st.speed * S.projSpd;

const COL_BOLT = [0.3, 0.92, 1.0];
const COL_STAR = [1.0, 0.85, 0.45];
const COL_LIGHT = [0.55, 0.7, 1.0];
const COL_NOVA = [1.0, 0.62, 0.22];
const COL_SUPERNOVA = [1.0, 0.85, 0.55];
const COL_SLASH = [1.0, 0.32, 0.45];
const COL_MOON = [1.0, 0.1, 0.22];
const COL_HOLE = [0.72, 0.42, 1.0];
const COL_DISC = [0.75, 1.0, 0.3];
const COL_ORBIT = [0.82, 0.42, 1.0];
const COL_ORBIT2 = [0.45, 0.6, 1.0];
const COL_MISSILE = [1.0, 0.5, 0.2];
const tmpPt = { x: 0, y: 0 };
let novaSeq = 0;

// single-target weapons focus a boss when one is close enough
function bossInRange(range) {
  for (let k = 0; k < G.bosses.length; k++) {
    const i = G.bosses[k].i;
    if (!EN.alive[i] || EN.uid[i] !== G.bosses[k].uid) continue;
    const dx = EN.x[i] - P.x, dy = EN.y[i] - P.y;
    if (dx * dx + dy * dy < range * range) return i;
  }
  return -1;
}

function pickTarget(range) {
  const e = randomEnemyNear(P.x, P.y, range);
  return e >= 0 ? e : nearestEnemy(P.x, P.y, range * 1.4, 0);
}

const WEAPON_LOGIC = {
  // ---------------------------------------------------------- bolt
  bolt: {
    init(w) { w.burst = 0; w.bt = 0; },
    update(w, dt) {
      w.t -= dt;
      if (w.burst > 0) {
        w.bt -= dt;
        while (w.burst > 0 && w.bt <= 0) { fireBolt(w, w.burstIdx++); w.burst--; w.bt += 0.07; }
      }
      if (w.t > 0) return;
      if (EN.count === 0) { w.t = 0; return; }
      if (w.evolved) {
        let guard = 0;
        while (w.t <= 0 && guard++ < 6) {
          w.t += wCd(w);
          const n = wAmount(w);
          for (let k = 0; k < n; k++) fireStar(w);
        }
      } else {
        w.t = wCd(w);
        w.burst = wAmount(w); w.bt = 0; w.burstIdx = 0;
      }
    },
  },
  // ---------------------------------------------------------- orbit
  orbit: {
    init(w) { w.active = false; w.grow = 0; w.ang = 0; w.at = 0; w.t = 0.4; w.blades = new Float32Array(64); w.nb = 0; },
    update(w, dt) {
      if (w.evolved) w.active = true;
      else if (w.active) { w.at -= dt; if (w.at <= 0) { w.active = false; w.t = wCd(w); } }
      else { w.t -= dt; if (w.t <= 0) { w.active = true; w.at = wDur(w); SFX().orbit(); } }
      w.grow = w.active ? Math.min(1, w.grow + dt * 4) : Math.max(0, w.grow - dt * 4);
      w.nb = 0;
      if (w.grow <= 0) return;
      w.ang += w.st.speed * dt;
      const area = wArea(w);
      const R = w.st.radius * area * easeOutBack(w.grow);
      const n = Math.min(14, wAmount(w));
      const bladeR = 15 * Math.sqrt(area);
      const dmg = wDmg(w);
      const rings = w.evolved ? 2 : 1;
      const slot = w.slot;
      for (let ringI = 0; ringI < rings; ringI++) {
        const rad = ringI === 0 ? R : R * 1.65;
        const dir = ringI === 0 ? 1 : -1;
        const cnt = ringI === 0 ? n : n + 2;
        for (let bI = 0; bI < cnt; bI++) {
          const a = dir * w.ang * (ringI ? 0.75 : 1) + (bI / cnt) * TAU;
          const bx = P.x + Math.cos(a) * rad, by = P.y + Math.sin(a) * rad;
          if (w.nb < 30) {
            w.blades[w.nb * 2] = bx; w.blades[w.nb * 2 + 1] = by;
            w.nb++;
          }
          const m = queryEnemies(bx, by, bladeR, qA);
          for (let k = 0; k < m; k++) {
            const i = qA[k];
            const h = i * HITCD + slot;
            if (EN.hitCd[h] > G.time) continue;
            EN.hitCd[h] = G.time + 0.32;
            const ex = EN.x[i] - P.x, ey = EN.y[i] - P.y, ed = Math.hypot(ex, ey) || 1;
            damageEnemy(i, dmg, w, ex / ed, ey / ed, w.st.kb);
          }
          // motion trail ghost
          if (fxLoad() < 0.75) {
            const c = ringI ? COL_ORBIT2 : COL_ORBIT;
            emit(bx, by, 0, 0, 0.11, bladeR * 0.9, bladeR * 0.6, c[0], c[1], c[2], 0.22, SH.BLADE, 0, 0, a + dir * Math.PI / 2, 0);
          }
        }
      }
    },
  },
  // ---------------------------------------------------------- lightning
  lightning: {
    init(w) { w.queue = 0; w.qt = 0; },
    update(w, dt) {
      w.t -= dt;
      if (w.queue > 0) {
        w.qt -= dt;
        if (w.qt <= 0) { w.queue--; w.qt = w.evolved ? 0.07 : 0.1; strikeLightning(w); }
      }
      if (w.t > 0) return;
      if (EN.count === 0) { w.t = 0.1; return; }
      w.t = wCd(w);
      w.queue = wAmount(w); w.qt = 0;
    },
  },
  // ---------------------------------------------------------- laser
  laser: {
    init(w) { w.ang = rand(TAU); },
    update(w, dt) {
      if (w.evolved) {
        w.ang += 1.25 * dt;
        const n = wAmount(w);
        const len = w.st.length * (0.9 + 0.1 * wArea(w));
        const width = w.st.width * wArea(w);
        const dmg = wDmg(w);
        for (let k = 0; k < n; k++) laserDamage(w, P.x, P.y, w.ang + (k / n) * TAU, len, width, dmg);
        w.hum = (w.hum || 0) - dt;
        if (w.hum <= 0) { w.hum = 2.0; SFX().laser(1.2); }
        return;
      }
      w.t -= dt;
      if (w.t > 0) return;
      let tgt = bossInRange(800);
      if (tgt < 0) tgt = nearestEnemy(P.x, P.y, 680, 0);
      if (tgt < 0) { w.t = 0.15; return; }
      const dur = wDur(w);
      w.t = wCd(w) + dur;
      const base = Math.atan2(EN.y[tgt] - P.y, EN.x[tgt] - P.x);
      const n = wAmount(w);
      for (let k = 0; k < n; k++) {
        G.lasers.push({ w, ang: base + (k - (n - 1) / 2) * 0.24, t: 0, dur, len: w.st.length, width: w.st.width * wArea(w) });
      }
      SFX().laser(dur);
    },
  },
  // ---------------------------------------------------------- nova
  nova: {
    init(w) { w.queue = 0; w.qt = 0; w.t = 0.8; },
    update(w, dt) {
      w.t -= dt;
      if (w.queue > 0) {
        w.qt -= dt;
        if (w.qt <= 0) { w.queue--; w.qt = 0.2; fireNova(w); }
      }
      if (w.t > 0) return;
      w.t = wCd(w);
      w.queue = wAmount(w); w.qt = 0;
    },
  },
  // ---------------------------------------------------------- missile
  missile: {
    init(w) { w.t = 0.6; },
    update(w, dt) {
      w.t -= dt;
      if (w.t > 0) return;
      if (EN.count === 0) { w.t = 0.2; return; }
      w.t = wCd(w);
      const n = wAmount(w);
      const evo = w.evolved;
      const base = rand(TAU);
      const dmg = wDmg(w);
      for (let k = 0; k < n; k++) {
        const a = evo ? base + (k / n) * TAU : Math.atan2(P.fy, P.fx) + Math.PI + (k % 2 ? 1 : -1) * (0.9 + 0.25 * (k >> 1));
        let tgt = k % 2 === 0 ? bossInRange(900) : -1;
        if (tgt < 0) tgt = pickTarget(620);
        const i = spawnProj(PR_MISSILE, w.slot, P.x, P.y, Math.cos(a) * 170, Math.sin(a) * 170, evo ? 7 : 9, dmg, 0, 3.2);
        if (i < 0) break;
        PR.spd[i] = wSpeed(w);
        PR.a1[i] = w.st.blast * wArea(w);
        setProjTarget(i, tgt);
      }
      SFX().missile(0);
    },
  },
  // ---------------------------------------------------------- slash
  slash: {
    init(w) { w.queue = 0; w.qt = 0; w.qa = 0; w.t = 0.3; },
    update(w, dt) {
      w.t -= dt;
      if (w.queue > 0) {
        w.qt -= dt;
        if (w.qt <= 0) { w.queue--; w.qt = 0.13; doSlash(w, w.qa, w.evolved); w.qa += w.evolved ? Math.PI / 2 : Math.PI; }
      }
      if (w.t > 0) return;
      w.t = wCd(w);
      const n = wAmount(w);
      const base = Math.atan2(P.fy, P.fx);
      doSlash(w, base, w.evolved);
      w.queue = n - 1;
      w.qa = base + (w.evolved ? Math.PI / 2 : Math.PI);
      w.qt = 0.13;
    },
  },
  // ---------------------------------------------------------- aura
  aura: {
    init(w) { w.ft = 2; w.R = 0; w.rot = 0; w.pulse = 0; },
    update(w, dt) {
      const R = w.st.radius * wArea(w);
      w.R = R;
      w.rot += dt * 0.4;
      w.pulse = Math.max(0, w.pulse - dt * 2);
      const n = queryEnemies(P.x, P.y, R, qA);
      const tick = w.st.tick * (0.5 + 0.5 * S.cd);
      const dmg = wDmg(w);
      const slow = w.st.slow;
      const slot = w.slot;
      for (let k = 0; k < n; k++) {
        const i = qA[k];
        EN.slowT[i] = 0.15;
        if (EN.slowAmt[i] < slow) EN.slowAmt[i] = slow;
        const h = i * HITCD + slot;
        if (EN.hitCd[h] > G.time) continue;
        EN.hitCd[h] = G.time + tick;
        const ex = EN.x[i] - P.x, ey = EN.y[i] - P.y, ed = Math.hypot(ex, ey) || 1;
        damageEnemy(i, dmg, w, ex / ed, ey / ed, 30);
      }
      if (w.evolved) {
        w.ft -= dt;
        if (w.ft <= 0) {
          w.ft = w.st.freeze * (0.6 + 0.4 * S.cd);
          w.pulse = 1;
          const m = queryEnemies(P.x, P.y, R, qA);
          for (let k = 0; k < m; k++) {
            const i = qA[k];
            if (!ENEMY_TYPES[EN.type[i]].boss) EN.freezeT[i] = 1.6;
            else EN.slowT[i] = 1.0;
          }
          ring(P.x, P.y, R * 0.3, R * 1.1, 0.5, ICE, 0.1);
          shock(P.x, P.y, R * 1.1, 0.45, 0.5);
          SFX().freeze();
        }
      }
      if (fxLoad() < 0.6 && Math.random() < 0.5 * G.fxMul) {
        const a = rand(TAU), rr = Math.sqrt(Math.random()) * R;
        emit(P.x + Math.cos(a) * rr, P.y + Math.sin(a) * rr, rand(-15, 15), rand(-30, -5), rand(0.6, 1.1), rand(2, 4), 0, 0.6, 0.9, 1.0, 0.8, SH.SPARKLE, 0.5, 0);
      }
    },
  },
  // ---------------------------------------------------------- blackhole
  blackhole: {
    init(w) { w.t = 1.0; },
    update(w, dt) {
      w.t -= dt;
      if (w.t > 0) return;
      if (EN.count === 0) { w.t = 0.3; return; }
      w.t = wCd(w);
      const n = wAmount(w);
      const area = wArea(w);
      for (let k = 0; k < n; k++) {
        let tx, ty;
        if (k === 0 && densestSpot(P.x, P.y, Math.min(Cam.vw, Cam.vh) * 0.45, tmpPt)) { tx = tmpPt.x; ty = tmpPt.y; }
        else {
          const e = pickTarget(480);
          if (e >= 0) { tx = EN.x[e]; ty = EN.y[e]; }
          else { const a = rand(TAU); tx = P.x + Math.cos(a) * 250; ty = P.y + Math.sin(a) * 250; }
        }
        G.holes.push({ w, sx: P.x, sy: P.y, x: P.x, y: P.y, tx, ty, t: 0, travel: 0.32, dur: wDur(w), R: w.st.radius * area, dmg: wDmg(w), pull: w.st.pull, evo: w.evolved, spin: rand(TAU) });
      }
      SFX().hole();
    },
  },
  // ---------------------------------------------------------- disc
  disc: {
    init(w) { w.t = 0.5; },
    update(w, dt) {
      w.t -= dt;
      if (w.t > 0) return;
      let first = bossInRange(800);
      if (first < 0) first = nearestEnemy(P.x, P.y, 620, 0);
      if (first < 0) { w.t = 0.15; return; }
      w.t = wCd(w);
      const n = wAmount(w);
      const spd = wSpeed(w);
      const r = 14 * Math.sqrt(wArea(w));
      for (let k = 0; k < n; k++) {
        const tgt = k === 0 ? first : pickTarget(520);
        const tx = tgt >= 0 ? EN.x[tgt] : EN.x[first], ty = tgt >= 0 ? EN.y[tgt] : EN.y[first];
        const a = Math.atan2(ty - P.y, tx - P.x) + (k ? rand(-0.25, 0.25) : 0);
        const i = spawnProj(PR_DISC, w.slot, P.x, P.y, Math.cos(a) * spd, Math.sin(a) * spd, r, wDmg(w), w.st.bounces, 4.5);
        if (i < 0) break;
        PR.a1[i] = rand(TAU);
      }
      SFX().disc(0);
    },
  },
};

// ------------------------------------------------------------
//  Firing helpers
// ------------------------------------------------------------
function fireBolt(w, idx) {
  let tgt = idx % 2 === 0 ? bossInRange(900) : -1;
  if (tgt < 0) tgt = idx === 0 ? nearestEnemy(P.x, P.y, 700, 0) : pickTarget(520);
  if (tgt < 0) return;
  const a = Math.atan2(EN.y[tgt] - P.y, EN.x[tgt] - P.x) + rand(-0.08, 0.08);
  const spd = wSpeed(w);
  const r = 7 * Math.sqrt(wArea(w));
  const i = spawnProj(PR_BOLT, w.slot, P.x, P.y, Math.cos(a) * spd, Math.sin(a) * spd, r, wDmg(w), w.st.pierce, w.st.dur);
  if (i < 0) return;
  setProjTarget(i, tgt);
  flashAt(P.x + Math.cos(a) * 14, P.y + Math.sin(a) * 14, 22, COL_BOLT, 0.1, 0.9);
  SFX().bolt(0);
}
function fireStar(w) {
  let tgt = Math.random() < 0.35 ? bossInRange(850) : -1;
  if (tgt < 0) tgt = pickTarget(560);
  if (tgt < 0) return;
  const a = Math.atan2(EN.y[tgt] - P.y, EN.x[tgt] - P.x) + rand(-0.5, 0.5);
  const spd = wSpeed(w);
  const r = 8 * Math.sqrt(wArea(w));
  const i = spawnProj(PR_STAR, w.slot, P.x, P.y, Math.cos(a) * spd, Math.sin(a) * spd, r, wDmg(w), w.st.pierce, w.st.dur);
  if (i < 0) return;
  setProjTarget(i, tgt);
  PR.a1[i] = rand(TAU);
  SFX().star(0);
}

function strikeLightning(w) {
  const evo = w.evolved;
  const area = wArea(w);
  const range = Math.min(w.st.range * (0.85 + 0.15 * area), Math.max(Cam.vw, Cam.vh) * 0.6);
  let cur = Math.random() < 0.5 ? bossInRange(Math.max(range, 700)) : -1;
  if (cur < 0) cur = randomEnemyNear(P.x, P.y, range);
  if (cur < 0) cur = nearestEnemy(P.x, P.y, range * 1.4, 0);
  if (cur < 0) return;
  const dmg = wDmg(w);
  const jump = 170 * area;
  const pts = [];
  if (evo) pts.push(EN.x[cur] + rand(-60, 60), EN.y[cur] - 720);
  else pts.push(P.x, P.y);
  const hit = [];
  const chains = w.st.chains;
  for (let c = 0; c <= chains && cur >= 0; c++) {
    const ex = EN.x[cur], ey = EN.y[cur];
    pts.push(ex, ey);
    hit.push(EN.uid[cur]);
    damageEnemy(cur, c === 0 && evo ? dmg * 1.5 : dmg, w, 0, 0, 0);
    flashAt(ex, ey, evo ? 60 : 34, COL_LIGHT, 0.22, 1);
    if (fxLoad() < 0.7) sparks(ex, ey, 5, [0.75, 0.85, 1.0], 120, 380, 0.25, 3);
    if (evo) queueBlast(ex, ey, 64 * area, dmg * 0.55, w, 140, 'thunder');
    // next link: nearest enemy not yet struck
    const m = queryEnemies(ex, ey, jump, qA);
    let best = -1, bd = 1e12;
    for (let k = 0; k < m; k++) {
      const j = qA[k];
      if (!EN.alive[j] || hit.indexOf(EN.uid[j]) >= 0) continue;
      const qx = EN.x[j] - ex, qy = EN.y[j] - ey, dd = qx * qx + qy * qy;
      if (dd < bd) { bd = dd; best = j; }
    }
    cur = best;
  }
  G.bolts.push({ pts, t: 0, life: evo ? 0.32 : 0.22, wide: evo ? 1.7 : 1, jag: null, jt: 0 });
  if (evo) { SFX().thunder(0); addShake(0.07); }
  else SFX().lightning(0);
}

function laserDamage(w, x0, y0, ang, len, width, dmg) {
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const slot = w.slot, tick = w.st.tick;
  const n = EN.n, half = width * 0.5;
  // quick reject box
  const x1 = x0 + dx * len, y1 = y0 + dy * len;
  const minX = Math.min(x0, x1) - half - 40, maxX = Math.max(x0, x1) + half + 40;
  const minY = Math.min(y0, y1) - half - 40, maxY = Math.max(y0, y1) + half + 40;
  for (let i = 0; i < n; i++) {
    if (!EN.alive[i]) continue;
    const xi = EN.x[i], yi = EN.y[i];
    if (xi < minX || xi > maxX || yi < minY || yi > maxY) continue;
    const ex = xi - x0, ey = yi - y0;
    const along = ex * dx + ey * dy;
    const ri = EN.r[i];
    if (along < -ri || along > len + ri) continue;
    if (Math.abs(ex * dy - ey * dx) > half + ri) continue;
    const h = i * HITCD + slot;
    if (EN.hitCd[h] > G.time) continue;
    EN.hitCd[h] = G.time + tick;
    damageEnemy(i, dmg, w, dx, dy, 25);
  }
}

function fireNova(w) {
  const evo = w.evolved;
  const R = w.st.radius * wArea(w);
  G.novas.push({ w, x: P.x, y: P.y, R, rPrev: 0, t: 0, dur: evo ? 0.45 : 0.36, dmg: wDmg(w), kb: w.st.kb, evo, id: ++novaSeq });
  const c = evo ? COL_SUPERNOVA : COL_NOVA;
  flashAt(P.x, P.y, evo ? 100 : 60, c, 0.22, 0.5);
  shock(P.x, P.y, R, evo ? 0.5 : 0.42, evo ? 1.1 : 0.65);
  addShake(evo ? 0.12 : 0.05);
  SFX().nova(evo);
}

function doSlash(w, ang, full) {
  const R = w.st.range * wArea(w);
  const dmg = wDmg(w);
  const n = queryEnemies(P.x, P.y, R, qA);
  const half = full ? Math.PI : 1.4;
  for (let k = 0; k < n; k++) {
    const i = qA[k];
    const ex = EN.x[i] - P.x, ey = EN.y[i] - P.y;
    const d = Math.hypot(ex, ey) || 1;
    if (!full && Math.abs(angleDiff(ang, Math.atan2(ey, ex))) > half + EN.r[i] / d) continue;
    damageEnemy(i, dmg, w, ex / d, ey / d, w.st.kb);
  }
  const col = w.evolved ? COL_MOON : COL_SLASH;
  if (full) {
    for (let k = 0; k < 2; k++) G.slashes.push({ ang: ang + k * Math.PI, R, t: 0, life: 0.3, col, big: true });
  } else G.slashes.push({ ang, R, t: 0, life: 0.24, col, big: false });
  if (fxLoad() < 0.7) {
    const m = Math.round((full ? 16 : 8) * G.fxMul);
    for (let k = 0; k < m; k++) {
      const a = ang + (full ? rand(TAU) : rand(-1.3, 1.3));
      const rr = R * rand(0.7, 1.0);
      emit(P.x + Math.cos(a) * rr, P.y + Math.sin(a) * rr, Math.cos(a + Math.PI / 2) * 160, Math.sin(a + Math.PI / 2) * 160, rand(0.15, 0.3), rand(2, 3.5), 0, col[0], col[1] * 1.5, col[2] * 1.5, 1, SH.SPARK, 3, 0.03);
    }
  }
  SFX().slash(0);
}

// ------------------------------------------------------------
//  Persistent weapon effects (novas, lasers, holes, bolts, slashes)
// ------------------------------------------------------------
function updateWeaponFx(dt) {
  // novas
  for (let k = G.novas.length - 1; k >= 0; k--) {
    const nv = G.novas[k];
    nv.t += dt;
    const p = Math.min(1, nv.t / nv.dur);
    const r = nv.R * easeOutCubic(p);
    if (nv.t <= nv.dur) {
      const n = queryEnemies(nv.x, nv.y, r, qA);
      const slot = nv.w.slot;
      for (let q = 0; q < n; q++) {
        const i = qA[q];
        const ex = EN.x[i] - nv.x, ey = EN.y[i] - nv.y;
        const d = Math.hypot(ex, ey) || 1;
        if (d + EN.r[i] < nv.rPrev - 6) continue;
        const h = i * HITCD + slot;
        if (EN.hitCd[h] > G.time) continue;
        EN.hitCd[h] = G.time + 0.12;
        damageEnemy(i, nv.dmg, nv.w, ex / d, ey / d, nv.kb);
      }
      clearBulletsIn(nv.x, nv.y, r);
      if (fxLoad() < 0.6) {
        const c = nv.evo ? COL_SUPERNOVA : COL_NOVA;
        const m = Math.round(5 * G.fxMul);
        for (let q = 0; q < m; q++) {
          const a = rand(TAU);
          emit(nv.x + Math.cos(a) * r, nv.y + Math.sin(a) * r, Math.cos(a) * 160, Math.sin(a) * 160, rand(0.2, 0.4), rand(2.5, 4), 0, c[0], c[1], c[2], 1, SH.SPARK, 3, 0.03);
        }
      }
    }
    nv.rPrev = r;
    if (nv.t > nv.dur + 0.3) G.novas.splice(k, 1);
  }
  // lasers (normal)
  for (let k = G.lasers.length - 1; k >= 0; k--) {
    const L = G.lasers[k];
    L.t += dt;
    if (L.t > L.dur) { G.lasers.splice(k, 1); continue; }
    laserDamage(L.w, P.x, P.y, L.ang, L.len, L.width, wDmg(L.w));
  }
  // black holes
  for (let k = G.holes.length - 1; k >= 0; k--) {
    const h = G.holes[k];
    h.t += dt;
    if (h.t < h.travel) {
      const p = easeOutCubic(h.t / h.travel);
      h.x = lerp(h.sx, h.tx, p); h.y = lerp(h.sy, h.ty, p);
      continue;
    }
    h.x = h.tx; h.y = h.ty;
    h.spin += dt * 3;
    const at = h.t - h.travel;
    if (at < h.dur) {
      const grow = Math.min(1, at * 4);
      const R = h.R * grow;
      const n = queryEnemies(h.x, h.y, R, qA);
      const slot = h.w.slot;
      for (let q = 0; q < n; q++) {
        const i = qA[q];
        const ex = h.x - EN.x[i], ey = h.y - EN.y[i];
        const d = Math.hypot(ex, ey) || 1;
        const res = 1 - EN.kbr[i];
        if (d > 10 && res > 0) {
          const f = h.pull * (0.35 + 0.65 * (1 - d / (R + 1))) * res * dt;
          const step = Math.min(f, d - 6);
          EN.x[i] += (ex / d) * step + (-ey / d) * step * 0.45;
          EN.y[i] += (ey / d) * step + (ex / d) * step * 0.45;
        }
        if (h.evo && d < R * 0.25 && EN.hp[i] < EN.maxHp[i] * 0.15 && !ENEMY_TYPES[EN.type[i]].boss) {
          flashAt(EN.x[i], EN.y[i], 30, COL_HOLE, 0.2, 1);
          damageEnemy(i, EN.hp[i] + 1, h.w, 0, 0, 0);
          continue;
        }
        const hh = i * HITCD + slot;
        if (EN.hitCd[hh] > G.time) continue;
        EN.hitCd[hh] = G.time + 0.25;
        damageEnemy(i, h.dmg, h.w, 0, 0, 0);
      }
      if (fxLoad() < 0.7) {
        const m = Math.round((h.evo ? 6 : 4) * G.fxMul);
        for (let q = 0; q < m; q++) {
          const a = rand(TAU), rr = R * rand(0.55, 1.05);
          const tx = -Math.sin(a), ty = Math.cos(a);
          const c = Math.random() < 0.3 ? [1.0, 0.55, 0.3] : Math.random() < 0.5 ? [0.85, 0.35, 1.0] : [0.45, 0.4, 1.0];
          emit(h.x + Math.cos(a) * rr, h.y + Math.sin(a) * rr, tx * 220 - Math.cos(a) * 160, ty * 220 - Math.sin(a) * 160, rand(0.3, 0.55), rand(2.5, 4.5), 0.5, c[0], c[1], c[2], 1, SH.SPARK, 0.5, 0.03);
        }
      }
    } else {
      queueBlast(h.x, h.y, h.R * 0.85, h.dmg * 4, h.w, 260, 'implode');
      G.holes.splice(k, 1);
    }
  }
  // lightning visuals
  for (let k = G.bolts.length - 1; k >= 0; k--) {
    const b = G.bolts[k];
    b.t += dt;
    b.jt -= dt;
    if (b.t > b.life) { G.bolts.splice(k, 1); continue; }
    if (b.jt <= 0 || !b.jag) { b.jag = jaggedPath(b.pts); b.jt = 0.045; }
  }
  for (let k = G.slashes.length - 1; k >= 0; k--) {
    const s = G.slashes[k];
    s.t += dt;
    if (s.t > s.life) G.slashes.splice(k, 1);
  }
}

function jaggedPath(pts) {
  const out = [];
  out.push(pts[0], pts[1]);
  for (let k = 2; k < pts.length; k += 2) {
    const x0 = pts[k - 2], y0 = pts[k - 1], x1 = pts[k], y1 = pts[k + 1];
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const segs = Math.max(2, Math.min(14, Math.round(len / 22)));
    const nx = -dy / len, ny = dx / len;
    const amp = Math.min(22, len * 0.12);
    for (let s = 1; s < segs; s++) {
      const t = s / segs;
      const o = rand(-amp, amp) * Math.sin(t * Math.PI);
      out.push(x0 + dx * t + nx * o, y0 + dy * t + ny * o);
    }
    out.push(x1, y1);
  }
  return out;
}

// ------------------------------------------------------------
//  Projectiles
// ------------------------------------------------------------
function steerProj(i, turn, dt) {
  let tg = PR.tgt[i];
  if (tg < -1) return;
  if (tg >= 0 && (!EN.alive[tg] || EN.uid[tg] !== PR.tuid[i])) { PR.tgt[i] = -1; tg = -1; }
  if (tg < 0) return;
  const vx = PR.vx[i], vy = PR.vy[i];
  const cur = Math.atan2(vy, vx);
  const want = Math.atan2(EN.y[tg] - PR.y[i], EN.x[tg] - PR.x[i]);
  const diff = angleDiff(cur, want);
  const maxT = turn * dt;
  const na = cur + (diff > maxT ? maxT : diff < -maxT ? -maxT : diff);
  const sp = Math.hypot(vx, vy);
  PR.vx[i] = Math.cos(na) * sp; PR.vy[i] = Math.sin(na) * sp;
}

function updateProjectiles(dt) {
  const load = fxLoad();
  let i = 0;
  while (i < PR.n) {
    PR.life[i] -= dt;
    PR.t[i] += dt;
    const kind = PR.kind[i];
    const w = P.weapons[PR.w[i]];
    let dead = PR.life[i] <= 0 || !w;
    if (!dead) {
      if (kind === PR_BOLT) steerProj(i, 7, dt);
      else if (kind === PR_STAR) { steerProj(i, 9, dt); PR.a1[i] += dt * 12; }
      else if (kind === PR_MISSILE) {
        if (PR.tgt[i] < 0 && PR.t[i] > 0.15) {
          const e = nearestEnemy(PR.x[i], PR.y[i], 520, 0);
          if (e >= 0) setProjTarget(i, e);
        }
        steerProj(i, PR.t[i] < 0.18 ? 1.5 : 6.5, dt);
        const sp = Math.hypot(PR.vx[i], PR.vy[i]);
        const ns = Math.min(PR.spd[i], sp + 1100 * dt);
        PR.vx[i] *= ns / (sp || 1); PR.vy[i] *= ns / (sp || 1);
      } else if (kind === PR_DISC) {
        PR.a1[i] += dt * 18;
        if (PR.tgt[i] === -2) {
          // boomerang home
          const hx = P.x - PR.x[i], hy = P.y - PR.y[i], hd = Math.hypot(hx, hy) || 1;
          const s2 = PR.spd[i] * 1.1;
          PR.vx[i] += ((hx / hd) * s2 - PR.vx[i]) * Math.min(1, dt * 8);
          PR.vy[i] += ((hy / hd) * s2 - PR.vy[i]) * Math.min(1, dt * 8);
          if (hd < 26) { dead = true; }
        } else if (PR.t[i] > 1.1 && PR.tgt[i] === -1 && PR.hitN[i] === 0) {
          PR.tgt[i] = -2;
        }
      }

      PR.x[i] += PR.vx[i] * dt;
      PR.y[i] += PR.vy[i] * dt;
      const x = PR.x[i], y = PR.y[i];

      // trails
      if (load < 0.8) {
        if (kind === PR_BOLT) emit(x, y, 0, 0, 0.18, PR.r[i] * 1.5, 0, COL_BOLT[0] * 0.8, COL_BOLT[1] * 0.8, COL_BOLT[2] * 0.8, 0.8, SH.GLOW, 0, 0);
        else if (kind === PR_STAR) emit(x, y, rand(-20, 20), rand(-20, 20), 0.3, PR.r[i] * 1.1, 0, COL_STAR[0], COL_STAR[1], COL_STAR[2], 0.7, SH.SPARKLE, 1, 0, rand(TAU), 0);
        else if (kind === PR_MISSILE) {
          emit(x, y, rand(-20, 20), rand(-20, 20), 0.22, 7, 2, 1.0, 0.6, 0.2, 1, SH.GLOW, 0, 0);
          if (Math.random() < 0.35) emit(x, y, rand(-15, 15), rand(-15, 15), rand(0.4, 0.7), 4, 10, 0.1, 0.06, 0.12, 0.35, SH.SMOKE, 1, 0);
        } else if (kind === PR_DISC) emit(x, y, 0, 0, 0.18, PR.r[i] * 1.1, PR.r[i] * 0.4, COL_DISC[0], COL_DISC[1], COL_DISC[2], 0.4, SH.RING, 0, 0, 0, 0);
      }

      // collision
      const m = queryEnemies(x, y, PR.r[i], qA);
      for (let k = 0; k < m && !dead; k++) {
        const e = qA[k];
        const uid = EN.uid[e];
        if (projHasHit(i, uid)) continue;
        if (kind === PR_MISSILE) {
          queueBlast(x, y, PR.a1[i], PR.dmg[i], w, 200, w.evolved ? 'micro' : 'missile');
          dead = true;
          break;
        }
        const sp = Math.hypot(PR.vx[i], PR.vy[i]) || 1;
        projAddHit(i, uid);
        damageEnemy(e, PR.dmg[i], w, PR.vx[i] / sp, PR.vy[i] / sp, kind === PR_DISC ? 120 : 70);
        if (kind === PR_DISC) {
          if (w.evolved) queueBlast(x, y, 54 * Math.sqrt(wArea(w)), PR.dmg[i] * 0.5, w, 90, 'discshock');
          SFX().tink(panOf(x));
          PR.pierce[i] -= 1;
          if (PR.pierce[i] < 0) { dead = true; break; }
          // bounce to the next closest enemy that wasn't hit recently
          const q = queryEnemies(x, y, 360, qB);
          let best = -1, bd = 1e12;
          for (let z = 0; z < q; z++) {
            const j = qB[z];
            if (!EN.alive[j] || projHasHit(i, EN.uid[j])) continue;
            const ox = EN.x[j] - x, oy = EN.y[j] - y, dd = ox * ox + oy * oy;
            if (dd < bd) { bd = dd; best = j; }
          }
          if (best >= 0) {
            const ox = EN.x[best] - x, oy = EN.y[best] - y, dl = Math.sqrt(bd) || 1;
            const s2 = PR.spd[i];
            PR.vx[i] = (ox / dl) * s2; PR.vy[i] = (oy / dl) * s2;
            PR.life[i] = Math.max(PR.life[i], 1.2);
          } else {
            PR.tgt[i] = -2;
            PR.life[i] = Math.max(PR.life[i], 2.5);
          }
          sparks(x, y, 4, COL_DISC, 100, 300, 0.2, 3);
          break;
        }
        // bolt / star
        const c = kind === PR_STAR ? COL_STAR : COL_BOLT;
        flashAt(x, y, kind === PR_STAR ? 30 : 24, c, 0.12, 1);
        PR.pierce[i] -= 1;
        if (PR.pierce[i] < 0) { dead = true; break; }
      }
    } else if (kind === PR_MISSILE && w) {
      queueBlast(PR.x[i], PR.y[i], PR.a1[i], PR.dmg[i], w, 200, w.evolved ? 'micro' : 'missile');
    }
    if (dead) {
      const l = --PR.n;
      if (i !== l) moveProj(l, i);
    } else i++;
  }
}
