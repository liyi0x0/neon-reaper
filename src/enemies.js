'use strict';
// ============================================================
//  Enemy AI, spawn director, scripted events and bosses
// ============================================================

const Director = (() => {
  let spawnAcc = 0;
  let eventIdx = 0;
  let endlessT = 0, endlessBossT = 0, endlessCycle = 0;
  const pending = [];
  const tmp = { x: 0, y: 0 };

  const minutes = () => G.time / 60;
  function hpMul() { if (G.demo) return 1.8; const m = minutes(); return 1 + 0.55 * m + 0.07 * m * m; }
  function dmgMul() { return G.demo ? 1 : 1 + 0.1 * minutes(); }

  function reset() {
    spawnAcc = 0; eventIdx = 0; endlessT = 0; endlessBossT = 0; endlessCycle = 0;
    pending.length = 0;
  }

  // point on the rectangle just outside the view, in direction `angle` from the player
  function spawnPoint(angle, extra) {
    const hw = Cam.vw * 0.5 + 40, hh = Cam.vh * 0.5 + 40;
    const c = Math.cos(angle), s = Math.sin(angle);
    const k = Math.min(hw / Math.max(Math.abs(c), 1e-4), hh / Math.max(Math.abs(s), 1e-4)) + (extra || 0);
    tmp.x = P.x + c * k; tmp.y = P.y + s * k;
    return tmp;
  }

  function pickType() {
    let row = WAVES[0][1];
    for (let k = 0; k < WAVES.length; k++) if (G.time >= WAVES[k][0]) row = WAVES[k][1];
    let total = 0;
    for (const key in row) total += row[key];
    let r = Math.random() * total;
    for (const key in row) { r -= row[key]; if (r <= 0) return ET[key]; }
    return ET.drone;
  }

  function spawnRegular() {
    let a;
    const sp = Math.hypot(P.vx, P.vy);
    if (sp > 30 && Math.random() < 0.55) a = Math.atan2(P.vy, P.vx) + rand(-1.1, 1.1);
    else a = rand(TAU);
    const p = spawnPoint(a, rand(0, 90));
    spawnEnemy(pickType(), p.x, p.y, hpMul(), false);
  }

  function update(dt) {
    const m = minutes();
    const boss = G.bosses.length > 0 || pending.length > 0;
    let rate = 3.2 + 3.0 * m + 0.42 * m * m;
    let minAlive = 22 + 40 * m + 9 * m * m;
    if (G.demo) { rate = 26; minAlive = 260; }
    if (boss) { rate *= 0.4; minAlive *= 0.45; }
    if (G.time < 3 && !G.demo) rate *= 0.5;
    minAlive = Math.min(minAlive, MAX_ALIVE);
    spawnAcc += rate * dt;
    if (EN.count < minAlive) spawnAcc += (minAlive - EN.count) * dt * 1.5;
    let budget = 40;
    while (spawnAcc >= 1 && budget-- > 0) {
      spawnAcc -= 1;
      if (EN.count >= MAX_ALIVE) { spawnAcc = 0; break; }
      spawnRegular();
    }
    if (spawnAcc > 60) spawnAcc = 60;

    if (G.demo) return;
    while (eventIdx < EVENTS.length && G.time >= EVENTS[eventIdx].t) runEvent(EVENTS[eventIdx++]);

    for (let k = pending.length - 1; k >= 0; k--) {
      pending[k].t -= dt;
      if (pending[k].t <= 0) { actuallySpawnBoss(pending[k]); pending.splice(k, 1); }
    }

    if (G.endless) {
      endlessT -= dt; endlessBossT -= dt;
      if (endlessT <= 0) {
        endlessT = 35;
        const r = Math.random();
        if (r < 0.3) ringEvent(pick([ET.drone, ET.swarmer, ET.brute]), 120 + endlessCycle * 20);
        else if (r < 0.55) stampede(ET.swarmer, 120);
        else if (r < 0.75) bomberSwarm(50);
        else spawnElite(pick([ET.brute, ET.tank, ET.splitter, ET.spitter]));
      }
      if (endlessBossT <= 0) {
        endlessBossT = 150;
        endlessCycle++;
        spawnBoss(pick(['colossus', 'queen']), { plus: true });
      }
    }
  }

  function startEndless() { G.endless = true; endlessT = 20; endlessBossT = 90; }

  function runEvent(ev) {
    switch (ev.type) {
      case 'ring': ringEvent(ET[ev.enemy], ev.n); break;
      case 'stampede': stampede(ET[ev.enemy], ev.n); break;
      case 'bombers': bomberSwarm(ev.n); break;
      case 'elite': spawnElite(ET[ev.enemy]); break;
      case 'boss': spawnBoss(ev.enemy, ev); break;
    }
  }

  function ringEvent(ti, n) {
    UI.banner('被包围了！', 'warn');
    const R = Math.hypot(Cam.vw, Cam.vh) * 0.5 + 30;
    const hm = hpMul();
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU;
      const j = spawnEnemy(ti, P.x + Math.cos(a) * R, P.y + Math.sin(a) * R, hm, false);
      if (j >= 0) EN.spd[j] = ENEMY_TYPES[ti].speed * 0.8;
    }
  }
  function stampede(ti, n) {
    UI.banner('兽潮来袭！', 'warn');
    const a = rand(TAU);
    const dx = Math.cos(a), dy = Math.sin(a);
    const px = -dy, py = dx;
    const R = Math.hypot(Cam.vw, Cam.vh) * 0.5 + 60;
    const hm = hpMul();
    for (let k = 0; k < n; k++) {
      const off = rand(-280, 280), back = rand(0, 560);
      const j = spawnEnemy(ti, P.x - dx * (R + back) + px * off, P.y - dy * (R + back) + py * off, hm, false);
      if (j >= 0) { EN.st[j] = 1; EN.dirX[j] = dx; EN.dirY[j] = dy; EN.spd[j] = ENEMY_TYPES[ti].speed * 2.1; }
    }
  }
  function bomberSwarm(n) {
    UI.banner('自爆蜂群！', 'warn');
    const hm = hpMul();
    for (let k = 0; k < n; k++) {
      const p = spawnPoint(rand(TAU), rand(0, 240));
      spawnEnemy(ET.bomber, p.x, p.y, hm, false);
    }
  }
  function spawnElite(ti) {
    const p = spawnPoint(rand(TAU), 30);
    spawnEnemy(ti, p.x, p.y, hpMul(), true);
  }

  function spawnBoss(key, ev) {
    const ti = ET[key];
    pending.push({ ti, t: 2.4, plus: !!ev.plus, final: !!ev.final });
    UI.bossWarning(ENEMY_TYPES[ti].name, !!ev.final);
    SFX().bossWarn();
    AudioSys.setMode('boss');
    G.dangerTarget = 1;
  }

  function actuallySpawnBoss(pb) {
    const T = ENEMY_TYPES[pb.ti];
    const p = spawnPoint(-Math.PI / 2 + rand(-0.6, 0.6), 80);
    const i = spawnEnemy(pb.ti, p.x, p.y, 1, false);
    if (i < 0) return;
    const m = minutes();
    let hp = T.hp * (1 + 0.35 * m) * (pb.plus ? 1.8 : 1);
    if (G.endless) hp *= 1 + endlessCycle * 0.6;
    EN.hp[i] = hp; EN.maxHp[i] = hp;
    EN.spd[i] = T.speed * (pb.plus ? 1.15 : 1);
    EN.dmg[i] = T.dmg * dmgMul();
    EN.kbr[i] = T.kb;
    G.bosses.push({ i, uid: EN.uid[i], ti: pb.ti, key: T.key, name: T.name, plus: pb.plus, final: pb.final,
      t1: 2, t2: 5, t3: 3, t4: 6, state: 0, stT: 0, dx: 0, dy: 0, spin: rand(TAU), phase: 1, age: 0 });
    flashAt(p.x, p.y, 260, T.col, 0.6, 1);
    shock(p.x, p.y, 400, 0.8, 1.0);
    addShake(0.4);
  }

  function bossKilled(i, ti, x, y, r) {
    const idx = G.bosses.findIndex((b) => b.i === i);
    const b = idx >= 0 ? G.bosses[idx] : null;
    if (idx >= 0) G.bosses.splice(idx, 1);
    const T = ENEMY_TYPES[ti];
    // the big moment
    flashAt(x, y, r * 7, T.col, 0.9, 1);
    flashAt(x, y, r * 3, [1.5, 1.5, 1.5], 0.4, 1);
    for (let k = 0; k < 4; k++) ring(x, y, r * (0.5 + k * 0.3), r * (5 + k * 2.5), 0.6 + k * 0.2, k % 2 ? [1, 1, 1] : T.col, 0.08);
    sparks(x, y, 120, T.col, 200, 900, 1.0, 6);
    sparks(x, y, 50, [1.2, 1.2, 1.2], 300, 1100, 0.7, 5);
    for (let k = 0; k < 30; k++) {
      const a = rand(TAU), s = rand(100, 500);
      emit(x, y, Math.cos(a) * s, Math.sin(a) * s, rand(0.8, 1.6), r * rand(0.15, 0.35), 2, T.col[0], T.col[1], T.col[2], 1, SH.TRI, 2.2, 0, rand(TAU), rand(-10, 10));
    }
    shock(x, y, r * 10, 1.0, 1.4);
    addShake(0.9);
    G.flash = 0.6;
    G.chroma = 0.03;
    slowMo(0.22, 1.3);
    SFX().bossDie();
    dropPickup(x, y, 4, 1);
    for (let k = 0; k < 36; k++) {
      const gi = dropPickup(x + rand(-r, r), y + rand(-r, r), 0, k < 6 ? 60 : 12);
      if (gi >= 0) { const a = rand(TAU), s = rand(150, 420); PK.vx[gi] = Math.cos(a) * s; PK.vy[gi] = Math.sin(a) * s; }
    }
    dropPickup(x + 30, y, 1, 0);
    G.bossKills++;
    if (G.bosses.length === 0 && pending.length === 0) {
      AudioSys.setMode('game');
      G.dangerTarget = 0;
      G.bossBeams.length = 0;
    }
    if (b && b.final && !G.endless) G.victoryT = 3.2;
  }

  return { update, reset, hpMul, dmgMul, spawnPoint, bossKilled, startEndless, get pendingBoss() { return pending.length > 0; } };
})();

// ------------------------------------------------------------
//  Regular enemy update: movement, separation, contact damage
// ------------------------------------------------------------
function updateEnemies(dt) {
  const n = EN.n;
  const px = P.x, py = P.y;
  const hw = Cam.vw * 0.5, hh = Cam.vh * 0.5;
  const farX = hw + 720, farY = hh + 620;
  const stampedeEnd = Math.hypot(hw, hh) + 400;
  const start = Grid.start, items = Grid.items;
  const decay = Math.max(0, 1 - 7 * dt);
  const frozenAll = G.freezeAll > 0;
  const dmgK = Director.dmgMul();

  for (let i = 0; i < n; i++) {
    if (!EN.alive[i]) continue;
    const ti = EN.type[i];
    const T = ENEMY_TYPES[ti];
    EN.t[i] += dt;
    if (EN.spawnT[i] < 1) EN.spawnT[i] = Math.min(1, EN.spawnT[i] + dt * 3.5);
    if (EN.flash[i] > 0) EN.flash[i] -= dt;

    let x = EN.x[i], y = EN.y[i];
    const dx = px - x, dy = py - y;
    const d2 = dx * dx + dy * dy;
    const d = Math.sqrt(d2) || 1;

    let mv = 1;
    if (EN.freezeT[i] > 0) { EN.freezeT[i] -= dt; mv = 0; }
    if (EN.slowT[i] > 0) { EN.slowT[i] -= dt; mv *= 1 - EN.slowAmt[i]; } else EN.slowAmt[i] = 0;
    if (frozenAll && !T.boss) mv = 0;

    EN.kx[i] *= decay; EN.ky[i] *= decay;

    let vx = 0, vy = 0;
    if (T.boss) {
      vx = EN.dirX[i]; vy = EN.dirY[i];
      if (frozenAll) { vx *= 0.3; vy *= 0.3; }
    } else if (EN.st[i] === 1) {
      vx = EN.dirX[i] * EN.spd[i]; vy = EN.dirY[i] * EN.spd[i];
      if ((x - px) * EN.dirX[i] + (y - py) * EN.dirY[i] > stampedeEnd) {
        EN.alive[i] = 0; EN.count--; EN.free[EN.freeN++] = i;
        continue;
      }
    } else {
      let sp = EN.spd[i];
      if (T.ai === 1) {
        if (d < 230) sp = -sp * 0.6;
        else if (d < 310) sp = 0;
        EN.fuse[i] -= dt * mv;
        if (EN.fuse[i] <= 0) {
          EN.fuse[i] = rand(2.3, 3.2);
          if (d < 560 && !G.demo) {
            const bs = 215;
            spawnBullet(x + dx / d * EN.r[i], y + dy / d * EN.r[i], dx / d * bs, dy / d * bs, 7, 7 * dmgK, 0);
            flashAt(x + dx / d * EN.r[i], y + dy / d * EN.r[i], 22, T.col, 0.15, 0.9);
            SFX().enemyShot(panOf(x));
          }
        }
      } else if (T.ai === 3) {
        if (EN.fuse[i] > 0) {
          EN.fuse[i] -= dt;
          sp *= 0.25;
          if (EN.fuse[i] <= 0) {
            // self-destruct next to the player
            EN.alive[i] = 0; EN.count--; EN.free[EN.freeN++] = i;
            queueBlast(x, y, 82, 40 * Director.hpMul(), null, 300, 'bomber', G.demo ? 0 : 16 * dmgK);
            continue;
          }
        } else if (d < 60 && mv > 0) EN.fuse[i] = 0.55;
      }
      vx = (dx / d) * sp; vy = (dy / d) * sp;
    }
    vx *= mv; vy *= mv;

    // separation against neighbours (big ones push small ones)
    if (!T.boss) {
      const cx = Math.floor((x - Grid.ox) / CELL), cy = Math.floor((y - Grid.oy) / CELL);
      if (cx >= 1 && cy >= 1 && cx < GW - 1 && cy < GH - 1) {
        let sx = 0, sy = 0, checks = 0;
        const ri = EN.r[i], mi = ri * ri;
        outer:
        for (let oy = -1; oy <= 1; oy++) {
          const row = (cy + oy) * GW + cx;
          for (let ox = -1; ox <= 1; ox++) {
            const c = row + ox;
            for (let k = start[c], e = start[c + 1]; k < e; k++) {
              const j = items[k];
              if (j === i || !EN.alive[j]) continue;
              const ex = x - EN.x[j], ey = y - EN.y[j];
              const rj = EN.r[j];
              const rr = ri + rj;
              const dd = ex * ex + ey * ey;
              if (dd < rr * rr && dd > 1e-4) {
                const dl = Math.sqrt(dd);
                const mj = rj * rj;
                const push = ((rr - dl) / dl) * (mj / (mi + mj));
                sx += ex * push; sy += ey * push;
              }
              if (++checks > 26) break outer;
            }
          }
        }
        x += sx * 0.55; y += sy * 0.55;
      }
    }

    x += (vx + EN.kx[i]) * dt;
    y += (vy + EN.ky[i]) * dt;
    EN.x[i] = x; EN.y[i] = y;

    // contact damage
    if (EN.dmg[i] > 0 && mv > 0) {
      const rr = EN.r[i] + P.r - 3;
      if (d2 < rr * rr) hurtPlayer(EN.dmg[i], T.key);
    }

    // too far behind: bring it back in front of the player
    if (!T.boss && EN.st[i] !== 1 && (Math.abs(x - px) > farX || Math.abs(y - py) > farY)) {
      const p = Director.spawnPoint(Math.atan2(py - y, px - x) + rand(-0.7, 0.7), rand(0, 120));
      EN.x[i] = p.x; EN.y[i] = p.y; EN.kx[i] = 0; EN.ky[i] = 0;
    }
  }
}

// ------------------------------------------------------------
//  Enemy bullets
// ------------------------------------------------------------
function updateBullets(dt) {
  const frozen = G.freezeAll > 0;
  for (let i = EB.n - 1; i >= 0; i--) {
    EB.life[i] -= dt;
    if (EB.life[i] <= 0) { removeBullet(i); continue; }
    if (!frozen) { EB.x[i] += EB.vx[i] * dt; EB.y[i] += EB.vy[i] * dt; }
    const dx = EB.x[i] - P.x, dy = EB.y[i] - P.y, rr = EB.r[i] + P.r * 0.7;
    if (dx * dx + dy * dy < rr * rr) {
      hurtPlayer(EB.dmg[i], 'bullet' + EB.kind[i]);
      flashAt(EB.x[i], EB.y[i], 30, [1, 0.3, 0.3], 0.2, 1);
      removeBullet(i);
    }
  }
}

function radialBurst(x, y, n, speed, offset, dmg, r, kind) {
  for (let k = 0; k < n; k++) {
    const a = offset + (k / n) * TAU;
    spawnBullet(x + Math.cos(a) * 20, y + Math.sin(a) * 20, Math.cos(a) * speed, Math.sin(a) * speed, r || 8, dmg, kind || 1);
  }
}

// ------------------------------------------------------------
//  Bosses
// ------------------------------------------------------------
function distToSeg(px, py, x0, y0, dx, dy, len) {
  const ex = px - x0, ey = py - y0;
  let t = ex * dx + ey * dy;
  if (t < 0) t = 0; else if (t > len) t = len;
  const qx = x0 + dx * t - px, qy = y0 + dy * t - py;
  return Math.sqrt(qx * qx + qy * qy);
}

const BOSS_AI = {
  colossus(b, dt) {
    const i = b.i;
    const x = EN.x[i], y = EN.y[i];
    const dx = P.x - x, dy = P.y - y, d = Math.hypot(dx, dy) || 1;
    const dmgK = Director.dmgMul();
    const T = ENEMY_TYPES[b.ti];
    if (b.state === 1) {
      b.stT -= dt;
      EN.dirX[i] = 0; EN.dirY[i] = 0;
      if (b.stT <= 0) { b.state = 2; b.stT = 0.62; addShake(0.25); SFX().nova(true); }
    } else if (b.state === 2) {
      b.stT -= dt;
      EN.dirX[i] = b.dx * 660; EN.dirY[i] = b.dy * 660;
      if (Math.random() < 0.8) emit(x, y, -b.dx * 60 + rand(-40, 40), -b.dy * 60 + rand(-40, 40), 0.4, EN.r[i] * 0.8, EN.r[i] * 1.4, T.col[0] * 0.6, T.col[1] * 0.6, T.col[2] * 0.6, 0.5, SH.GLOW, 2, 0);
      if (b.stT <= 0) b.state = 0;
    } else {
      EN.dirX[i] = (dx / d) * EN.spd[i];
      EN.dirY[i] = (dy / d) * EN.spd[i];
      b.t1 -= dt; b.t2 -= dt;
      if (b.t1 <= 0) {
        b.t1 = b.plus ? 2.3 : 3.1;
        b.spin += 0.31;
        radialBurst(x, y, b.plus ? 26 : 18, 175, b.spin, 9 * dmgK, 9, 1);
        if (b.plus) radialBurst(x, y, 13, 120, b.spin + 0.12, 9 * dmgK, 12, 1);
        ring(x, y, EN.r[i], EN.r[i] * 2.2, 0.35, T.col, 0.15);
        SFX().enemyShot(panOf(x));
      }
      if (b.t2 <= 0 && d < 900) {
        b.t2 = b.plus ? 5.2 : 6.8;
        b.state = 1; b.stT = 0.85;
        b.dx = dx / d; b.dy = dy / d;
        G.tele.push({ x, y, dx: b.dx, dy: b.dy, len: 660 * 0.62 + 80, w: EN.r[i] * 1.7, t: 0, life: 0.85 });
      }
    }
  },
  queen(b, dt) {
    const i = b.i;
    const x = EN.x[i], y = EN.y[i];
    const dx = P.x - x, dy = P.y - y, d = Math.hypot(dx, dy) || 1;
    const dmgK = Director.dmgMul();
    const T = ENEMY_TYPES[b.ti];
    const strafe = Math.sin(b.age * 0.9) * 0.8;
    let sp = d > 220 ? EN.spd[i] : EN.spd[i] * 0.3;
    EN.dirX[i] = (dx / d) * sp + (-dy / d) * strafe * EN.spd[i];
    EN.dirY[i] = (dy / d) * sp + (dx / d) * strafe * EN.spd[i];
    b.t1 -= dt;
    if (b.t1 <= 0) {
      b.t1 = b.plus ? 3.6 : 4.8;
      const hm = Director.hpMul();
      const cnt = b.plus ? 12 : 9;
      for (let k = 0; k < cnt; k++) {
        const a = (k / cnt) * TAU;
        const j = spawnEnemy(ET.swarmer, x + Math.cos(a) * (EN.r[i] + 16), y + Math.sin(a) * (EN.r[i] + 16), hm, false);
        if (j >= 0) { EN.kx[j] = Math.cos(a) * 300; EN.ky[j] = Math.sin(a) * 300; }
      }
      ring(x, y, EN.r[i], EN.r[i] * 2.4, 0.4, T.col, 0.12);
    }
    if (b.state === 0) {
      b.t2 -= dt;
      if (b.t2 <= 0) { b.state = 1; b.stT = 3.0; b.t3 = 0; }
    } else {
      b.stT -= dt; b.t3 -= dt;
      if (b.t3 <= 0) {
        b.t3 = b.plus ? 0.08 : 0.1;
        const arms = b.plus ? 3 : 2;
        for (let k = 0; k < arms; k++) {
          const a = b.spin + (k / arms) * TAU;
          spawnBullet(x + Math.cos(a) * 30, y + Math.sin(a) * 30, Math.cos(a) * 185, Math.sin(a) * 185, 7, 8 * dmgK, 2);
        }
        b.spin += 0.24;
      }
      if (b.stT <= 0) { b.state = 0; b.t2 = 3.2; }
    }
  },
  voideye(b, dt) {
    const i = b.i;
    const x = EN.x[i], y = EN.y[i];
    const dx = P.x - x, dy = P.y - y, d = Math.hypot(dx, dy) || 1;
    const dmgK = Director.dmgMul();
    const T = ENEMY_TYPES[b.ti];
    const frac = EN.hp[i] / EN.maxHp[i];
    const phase = frac > 0.66 ? 1 : frac > 0.33 ? 2 : 3;
    if (phase !== b.phase) {
      b.phase = phase;
      UI.banner(phase === 2 ? '虚空之眼 · 觉醒' : '虚空之眼 · 狂怒', 'boss');
      SFX().bossWarn();
      shock(x, y, 600, 0.8, 1.2);
      addShake(0.5);
      G.flash = 0.35;
      clearBulletsIn(x, y, 400);
      b.t4 = 1.5;
    }
    const sp = EN.spd[i] * (phase === 3 ? 1.6 : 1);
    if (d > 300) { EN.dirX[i] = (dx / d) * sp; EN.dirY[i] = (dy / d) * sp; }
    else { EN.dirX[i] = (-dy / d) * sp * 0.9 - (dx / d) * sp * 0.2; EN.dirY[i] = (dx / d) * sp * 0.9 - (dy / d) * sp * 0.2; }
    // spiral (on/off)
    b.stT -= dt;
    if (b.stT <= 0) { b.state = b.state ? 0 : 1; b.stT = b.state ? 3.6 : 2.2; }
    if (b.state) {
      b.t1 -= dt;
      if (b.t1 <= 0) {
        b.t1 = phase === 3 ? 0.075 : 0.11;
        const arms = phase === 1 ? 3 : 4;
        for (let k = 0; k < arms; k++) {
          const a = b.spin + (k / arms) * TAU;
          spawnBullet(x + Math.cos(a) * 50, y + Math.sin(a) * 50, Math.cos(a) * 170, Math.sin(a) * 170, 8, 10 * dmgK, 2);
        }
        b.spin += phase === 3 ? 0.21 : 0.17;
      }
    }
    b.t2 -= dt;
    if (b.t2 <= 0) {
      b.t2 = phase === 1 ? 4.6 : phase === 2 ? 3.4 : 2.4;
      radialBurst(x, y, phase === 3 ? 32 : 24, 150, rand(TAU), 10 * dmgK, 11, 1);
      ring(x, y, EN.r[i], EN.r[i] * 2.5, 0.4, T.col, 0.12);
    }
    b.t3 -= dt;
    if (b.t3 <= 0) {
      b.t3 = phase === 3 ? 7 : 9.5;
      const hm = Director.hpMul();
      const cnt = 18;
      for (let k = 0; k < cnt; k++) {
        const a = (k / cnt) * TAU;
        const j = spawnEnemy(ET.drone, P.x + Math.cos(a) * 470, P.y + Math.sin(a) * 470, hm, false);
        if (j >= 0) EN.spawnT[j] = 0;
      }
    }
    if (phase >= 2) {
      b.t4 -= dt;
      if (b.t4 <= 0) {
        b.t4 = 11;
        G.bossBeams.push({ i, uid: EN.uid[i], ang: rand(TAU), n: phase === 2 ? 2 : 3, rot: (Math.random() < 0.5 ? -1 : 1) * (phase === 3 ? 0.7 : 0.55), t: 0, tele: 1.3, dur: 4.2, len: 950, w: 30, dmg: 14 * dmgK });
      }
    }
  },
};

function updateBosses(dt) {
  for (let k = G.bosses.length - 1; k >= 0; k--) {
    const b = G.bosses[k];
    if (!EN.alive[b.i] || EN.uid[b.i] !== b.uid) { G.bosses.splice(k, 1); continue; }
    b.age += dt;
    if (G.freezeAll > 0) { EN.dirX[b.i] *= 0.9; EN.dirY[b.i] *= 0.9; continue; }
    BOSS_AI[b.key](b, dt);
    // never let the player outrun a boss
    const dx = EN.x[b.i] - P.x, dy = EN.y[b.i] - P.y;
    if (Math.abs(dx) > Cam.vw * 0.5 + 700 || Math.abs(dy) > Cam.vh * 0.5 + 600) {
      const p = Director.spawnPoint(Math.atan2(dy, dx), 60);
      EN.x[b.i] = p.x; EN.y[b.i] = p.y;
    }
  }
  // rotating death beams (final boss)
  for (let k = G.bossBeams.length - 1; k >= 0; k--) {
    const bm = G.bossBeams[k];
    if (!EN.alive[bm.i] || EN.uid[bm.i] !== bm.uid) { G.bossBeams.splice(k, 1); continue; }
    bm.t += dt;
    if (bm.t > bm.tele + bm.dur) { G.bossBeams.splice(k, 1); continue; }
    if (bm.t > bm.tele) {
      bm.ang += bm.rot * dt;
      const x0 = EN.x[bm.i], y0 = EN.y[bm.i];
      for (let j = 0; j < bm.n; j++) {
        const a = bm.ang + (j / bm.n) * TAU;
        if (distToSeg(P.x, P.y, x0, y0, Math.cos(a), Math.sin(a), bm.len) < bm.w * 0.5 + P.r * 0.6) hurtPlayer(bm.dmg, 'beam');
      }
    }
  }
}
