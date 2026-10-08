'use strict';
// ============================================================
//  Game state, player, progression, frame update and render
// ============================================================
const G = {
  state: 'boot', demo: false,
  time: 0, real: 0, beat: 0,
  slowT: 0, slowScale: 1, hitstop: 0, trans: null,
  kills: 0, gold: 0, bossKills: 0, dmgDealt: 0,
  combo: 0, comboT: 0, bestCombo: 0,
  pendingLevels: 0, pendingChests: 0, victoryT: 0,
  flash: 0, chroma: 0, hurtFx: 0, danger: 0, dangerTarget: 0, freezeAll: 0,
  bosses: [], bossBeams: [],
  novas: [], lasers: [], bolts: [], slashes: [], holes: [], rings: [], tele: [], shocks: [],
  endless: false, won: false, rerolls: 3,
  xpBank: 0, gemSweepT: 0, dnBudget: 14, dmgTaken: {},
  dropCd: { heal: 0, magnet: 0, bomb: 0, freeze: 0 },
  fxMul: 1,
  frameMs: 16, autoQ: { t: 0, acc: 0, n: 0 },
};

const P = {
  x: 0, y: 0, vx: 0, vy: 0, r: 13, fx: 1, fy: 0, moving: false,
  hp: 100, maxHp: 100, iframes: 0, hurtT: 0, dead: false,
  level: 1, xp: 0, xpNext: 5,
  weapons: [], passives: [],
  char: null, col: [0.35, 0.95, 1.0],
};

const S = { might: 1, cd: 1, area: 1, dur: 1, amount: 0, speed: 1, projSpd: 1, magnet: 1, armor: 0, regen: 0, crit: 0.05, luck: 0, growth: 1, kb: 1 };

const Cam = { x: 0, y: 0, vw: 1280, vh: 720, trauma: 0, ox: 0, oy: 0 };

const SFX = () => (G.demo ? AudioSys.silent : AudioSys.sfx);
function addShake(a) { if (Settings.shake) Cam.trauma = Math.min(1, Cam.trauma + a); }
function hitStop(t) { if (!G.demo) G.hitstop = Math.max(G.hitstop, t); }
function slowMo(scale, dur) { G.slowScale = scale; G.slowT = Math.max(G.slowT, dur); }

const hasWeapon = (id) => P.weapons.some((w) => w.id === id);
const getWeapon = (id) => P.weapons.find((w) => w.id === id);
const getPassive = (id) => P.passives.find((p) => p.id === id);
const passiveLv = (id) => { const p = getPassive(id); return p ? p.level : 0; };

function recomputeStats() {
  const b = (P.char && P.char.bonus) || {};
  S.might = 1 + 0.1 * passiveLv('might') + (b.might || 0);
  S.cd = Math.max(0.45, (1 - 0.08 * passiveLv('cooldown')) * (1 - (b.cooldown || 0)));
  S.area = 1 + 0.1 * passiveLv('area') + (b.area || 0);
  S.dur = 1 + 0.15 * passiveLv('duration');
  S.amount = passiveLv('amount');
  S.speed = 1 + 0.1 * passiveLv('speed') + (b.speed || 0);
  S.projSpd = 1 + 0.12 * passiveLv('projspd');
  S.magnet = 1 + 0.3 * passiveLv('magnet') + (b.magnet || 0);
  S.armor = passiveLv('armor') + (b.armor || 0);
  S.regen = 0.3 * passiveLv('regen') + (b.regen || 0);
  S.crit = 0.05 + 0.06 * passiveLv('luck');
  S.luck = passiveLv('luck');
  S.growth = 1 + 0.1 * passiveLv('growth');
  S.kb = 1 + 0.1 * passiveLv('armor');
  const oldMax = P.maxHp;
  P.maxHp = Math.round((120 + (b.maxhp || 0)) * (1 + 0.2 * passiveLv('maxhp')));
  if (P.maxHp > oldMax) P.hp += P.maxHp - oldMax;
  P.hp = Math.min(P.hp, P.maxHp);
}

// ------------------------------------------------------------
//  Weapons & passives
// ------------------------------------------------------------
function giveWeapon(id) {
  const w = { id, def: WEAPONS[id], level: 1, evolved: false, slot: P.weapons.length, t: 0.4, st: null, dmgDone: 0, kills: 0, since: G.time };
  w.st = weaponBaseStats(id, 1, false);
  WEAPON_LOGIC[id].init(w);
  P.weapons.push(w);
  return w;
}
function levelWeapon(w) {
  if (w.evolved || w.level >= MAX_WEAPON_LEVEL) return;
  w.level++;
  w.st = weaponBaseStats(w.id, w.level, false);
}
function evolveWeapon(w) {
  w.evolved = true;
  w.st = weaponBaseStats(w.id, w.level, true);
  WEAPON_LOGIC[w.id].init(w);
  w.t = 0.2;
}
function givePassive(id) {
  const p = getPassive(id);
  if (p) p.level = Math.min(PASSIVES[id].max, p.level + 1);
  else P.passives.push({ id, level: 1 });
  recomputeStats();
}

function rollChoices() {
  const pool = [];
  for (const w of P.weapons) {
    if (!w.evolved && w.level < MAX_WEAPON_LEVEL) pool.push({ kind: 'weapon', id: w.id, weight: 1.7 });
  }
  for (const p of P.passives) {
    if (p.level < PASSIVES[p.id].max) pool.push({ kind: 'passive', id: p.id, weight: 1.15 });
  }
  if (P.weapons.length < MAX_WEAPONS) {
    for (const id of WEAPON_IDS) if (!hasWeapon(id)) pool.push({ kind: 'weapon', id, weight: P.weapons.length < 3 ? 1.6 : 1.0, isNew: true });
  }
  if (P.passives.length < MAX_PASSIVES) {
    for (const id of PASSIVE_IDS) {
      if (getPassive(id)) continue;
      const pairW = EVOLVES_FROM[id] && hasWeapon(EVOLVES_FROM[id]) ? 1.6 : 0.8;
      pool.push({ kind: 'passive', id, weight: pairW, isNew: true });
    }
  }
  const count = 3 + (Math.random() < 0.1 + S.luck * 0.08 ? 1 : 0);
  const out = [];
  while (out.length < count && pool.length) {
    const c = weightedPick(pool);
    out.push(c);
    pool.splice(pool.indexOf(c), 1);
  }
  if (!out.length) out.push({ kind: 'heal' }, { kind: 'gold' });
  return out;
}

function describeChoice(c) {
  if (c.kind === 'weapon') {
    const def = WEAPONS[c.id];
    const w = getWeapon(c.id);
    const pair = PASSIVES[def.pair];
    if (!w) {
      return { type: 'weapon', icon: ICONS[c.id], name: def.name, color: def.css, badge: '新武器', lv: 'Lv 1', desc: def.desc,
        hint: `进化：满级 +「${pair.name}」→ ${def.evo}`, ready: false };
    }
    const next = w.level + 1;
    return { type: 'weapon', icon: ICONS[c.id], name: def.name, color: def.css, badge: '', lv: `Lv ${w.level} → ${next}`,
      desc: describeDelta(def.lv[w.level - 1]),
      hint: next >= MAX_WEAPON_LEVEL ? (getPassive(def.pair) ? `满级！拾取宝箱即可进化为「${def.evo}」` : `满级后搭配「${pair.name}」可进化`) : '', ready: next >= MAX_WEAPON_LEVEL && !!getPassive(def.pair) };
  }
  if (c.kind === 'passive') {
    const def = PASSIVES[c.id];
    const p = getPassive(c.id);
    const evoW = EVOLVES_FROM[c.id];
    let hint = '';
    if (evoW && hasWeapon(evoW)) hint = `可使「${WEAPONS[evoW].name}」进化为「${WEAPONS[evoW].evo}」`;
    return { type: 'passive', icon: ICONS[c.id], name: def.name, color: def.css, badge: p ? '' : '新被动', lv: p ? `Lv ${p.level} → ${p.level + 1}` : 'Lv 1', desc: def.desc, hint, ready: false };
  }
  if (c.kind === 'heal') return { type: 'misc', icon: ICONS.heal, name: '能量补给', color: '#5dff8a', badge: '', lv: '', desc: '回复 40% 生命', hint: '', ready: false };
  return { type: 'misc', icon: ICONS.gold, name: '星币袋', color: '#ffd84a', badge: '', lv: '', desc: '获得 50 星币', hint: '', ready: false };
}

function applyChoice(c) {
  if (c.kind === 'weapon') {
    const w = getWeapon(c.id);
    if (w) levelWeapon(w); else giveWeapon(c.id);
  } else if (c.kind === 'passive') givePassive(c.id);
  else if (c.kind === 'heal') P.hp = Math.min(P.maxHp, P.hp + P.maxHp * 0.4);
  else if (c.kind === 'gold') G.gold += 50;
}

function chestRoll() {
  for (const w of P.weapons) {
    if (!w.evolved && w.level >= MAX_WEAPON_LEVEL && getPassive(w.def.pair)) {
      evolveWeapon(w);
      const gold = randInt(60, 120);
      G.gold += gold;
      return { evo: w, items: [], gold };
    }
  }
  const r = Math.random();
  const n = r < 0.06 + S.luck * 0.03 ? 5 : r < 0.3 + S.luck * 0.05 ? 3 : 1;
  const items = [];
  for (let k = 0; k < n; k++) {
    const pool = [];
    for (const w of P.weapons) if (!w.evolved && w.level < MAX_WEAPON_LEVEL) pool.push({ kind: 'weapon', id: w.id, weight: 1.5 });
    for (const p of P.passives) if (p.level < PASSIVES[p.id].max) pool.push({ kind: 'passive', id: p.id, weight: 1 });
    if (!pool.length) break;
    const c = weightedPick(pool);
    const d = describeChoice(c);
    applyChoice(c);
    items.push(d);
  }
  const gold = randInt(25, 60) * Math.max(1, n);
  G.gold += gold;
  return { evo: null, items, gold };
}

function hasUpgradesLeft() {
  if (P.weapons.length < MAX_WEAPONS || P.passives.length < MAX_PASSIVES) return true;
  for (const w of P.weapons) if (!w.evolved && w.level < MAX_WEAPON_LEVEL) return true;
  for (const p of P.passives) if (p.level < PASSIVES[p.id].max) return true;
  return false;
}

// fully built: level-ups resolve instantly as small heals + gold instead of a menu
function absorbMaxedLevels() {
  const n = G.pendingLevels;
  G.pendingLevels = 0;
  P.hp = Math.min(P.maxHp, P.hp + P.maxHp * 0.04 * n);
  G.gold += 10 * n;
  flashAt(P.x, P.y, 70, [0.5, 1.0, 1.0], 0.3, 0.6);
  for (let k = 0; k < 8; k++) {
    const a = rand(TAU), s = rand(80, 200);
    emit(P.x, P.y, Math.cos(a) * s, Math.sin(a) * s, 0.6, 5, 0, 0.7, 1.0, 1.2, 1, SH.SPARKLE, 2.5, 0, rand(TAU), 0);
  }
  if (G.real - (G.maxToastT || -99) > 12) { G.maxToastT = G.real; UI.toast('已满配 · 升级转化为生命与星币'); }
}

function addXp(v) {
  P.xp += v * S.growth;
  while (P.xp >= P.xpNext) {
    P.xp -= P.xpNext;
    P.level++;
    P.xpNext = xpForLevel(P.level);
    G.pendingLevels++;
  }
}

// ------------------------------------------------------------
//  Player damage / death
// ------------------------------------------------------------
function hurtPlayer(amount, src) {
  if (G.demo || P.dead || P.iframes > 0 || G.state !== 'playing') return;
  const dmg = Math.max(1, amount - S.armor);
  const key = src || 'other';
  G.dmgTaken[key] = (G.dmgTaken[key] || 0) + dmg;
  P.hp -= dmg;
  P.iframes = 0.6;
  P.hurtT = 0.3;
  G.hurtFx = 1;
  G.chroma = Math.max(G.chroma, 0.012);
  addShake(0.32);
  addDmgNum(P.x, P.y - 22, dmg, 2);
  sparks(P.x, P.y, 10, [1, 0.25, 0.3], 120, 360, 0.35, 4);
  SFX().hurt();
  if (P.hp <= 0) { P.hp = 0; P.dead = true; }
}

// ------------------------------------------------------------
//  Run setup
// ------------------------------------------------------------
function resetRun(charIdx, demo) {
  clearEnemies(); clearPickups();
  PR.n = 0; EB.n = 0; PT.n = 0; DN.t.fill(9);
  blastQ.length = 0;
  for (const k of ['bosses', 'bossBeams', 'novas', 'lasers', 'bolts', 'slashes', 'holes', 'rings', 'tele', 'shocks']) G[k].length = 0;
  Object.assign(G, {
    demo: !!demo, time: 0, slowT: 0, slowScale: 1, hitstop: 0, trans: null,
    kills: 0, gold: 0, bossKills: 0, dmgDealt: 0, combo: 0, comboT: 0, bestCombo: 0,
    pendingLevels: 0, pendingChests: 0, victoryT: 0,
    flash: 0, chroma: 0, hurtFx: 0, danger: 0, dangerTarget: 0, freezeAll: 0,
    endless: false, won: false, rerolls: 3, xpBank: 0, gemSweepT: 0, dmgTaken: {},
    dropCd: { heal: 15, magnet: 60, bomb: 45, freeze: 90 },
  });
  const ch = CHARACTERS[charIdx] || CHARACTERS[0];
  Object.assign(P, { x: 0, y: 0, vx: 0, vy: 0, fx: 1, fy: 0, moving: false, iframes: 0, hurtT: 0, dead: false,
    level: 1, xp: 0, xpNext: xpForLevel(1), weapons: [], passives: [], char: ch, col: ch.rgb.slice(), maxHp: 100, hp: 100 });
  recomputeStats();
  P.hp = P.maxHp;
  giveWeapon(ch.weapon);
  Director.reset();
  Cam.x = 0; Cam.y = 0; Cam.trauma = 0;
}

function setupDemo() {
  resetRun(5, true);
  P.weapons.length = 0;
  const build = [['orbit', 6], ['lightning', 5], ['bolt', 6], ['nova', 4], ['laser', 4], ['missile', 3]];
  for (const [id, lv] of build) { const w = giveWeapon(id); for (let k = 1; k < lv; k++) levelWeapon(w); }
  P.passives.push({ id: 'area', level: 2 }, { id: 'cooldown', level: 2 }, { id: 'might', level: 3 });
  recomputeStats();
  G.time = 120;
}

// ------------------------------------------------------------
//  Per-frame simulation
// ------------------------------------------------------------
const inputVec = { x: 0, y: 0 };

// autopilot for the title-screen demo and balance tests:
// flee nearby threats (closest dominate), otherwise go collect the nearest gem
function botInput(out) {
  let ax = 0, ay = 0;
  const n = queryEnemies(P.x, P.y, 260, qA);
  for (let k = 0; k < n; k++) {
    const i = qA[k];
    const ex = P.x - EN.x[i], ey = P.y - EN.y[i];
    const d = Math.hypot(ex, ey) || 1;
    const f = Math.max(0, 1 - (d - EN.r[i]) / 260);
    const w = f * f * (ENEMY_TYPES[EN.type[i]].boss ? 6 : 1.6);
    ax += (ex / d) * w; ay += (ey / d) * w;
  }
  for (let i = 0; i < EB.n; i++) {
    const ex = P.x - EB.x[i], ey = P.y - EB.y[i];
    const d = Math.hypot(ex, ey) || 1;
    if (d < 170) { const w = (1 - d / 170) * 2.4; ax += (ex / d) * w; ay += (ey / d) * w; }
  }
  const threat = Math.hypot(ax, ay);
  let best = -1, bd = 900 * 900;
  for (let i = 0; i < PK.n; i++) {
    if (!PK.alive[i] || PK.st[i]) continue;
    const dx = PK.x[i] - P.x, dy = PK.y[i] - P.y, d2 = dx * dx + dy * dy;
    if (d2 < bd) { bd = d2; best = i; }
  }
  if (best >= 0) {
    const d = Math.sqrt(bd) || 1;
    const w = threat > 1.1 ? 0.25 : 1.0;
    ax += ((PK.x[best] - P.x) / d) * w; ay += ((PK.y[best] - P.y) / d) * w;
  } else {
    ax += Math.cos(G.real * 0.31) * 0.6; ay += Math.sin(G.real * 0.23) * 0.6;
  }
  const l = Math.hypot(ax, ay);
  if (l > 0.12) { out.x = ax / l; out.y = ay / l; } else { out.x = 0; out.y = 0; }
}

function updatePlayer(dt) {
  if (G.demo || G.bot) botInput(inputVec);
  else if (P.dead) { inputVec.x = 0; inputVec.y = 0; }
  else Input.vector(inputVec);
  const spd = 205 * S.speed;
  const k = 1 - Math.exp(-dt * 16);
  P.vx += (inputVec.x * spd - P.vx) * k;
  P.vy += (inputVec.y * spd - P.vy) * k;
  P.x += P.vx * dt;
  P.y += P.vy * dt;
  const l = Math.hypot(inputVec.x, inputVec.y);
  P.moving = l > 0.1;
  if (P.moving) { P.fx = inputVec.x / l; P.fy = inputVec.y / l; }
  if (S.regen > 0 && !P.dead && P.hp < P.maxHp) P.hp = Math.min(P.maxHp, P.hp + S.regen * dt);
  if (P.iframes > 0) P.iframes -= dt;
  if (P.hurtT > 0) P.hurtT -= dt;
  if (P.moving && fxLoad() < 0.8 && !P.dead) {
    const c = P.col;
    emit(P.x - P.fx * 9 + rand(-3, 3), P.y - P.fy * 9 + rand(-3, 3), -P.vx * 0.25, -P.vy * 0.25, 0.32, 7, 0, c[0] * 0.7, c[1] * 0.7, c[2] * 0.7, 0.7, SH.GLOW, 2, 0);
  }
}

function collectPickup(i) {
  const kind = PK.kind[i], v = PK.val[i];
  const x = PK.x[i], y = PK.y[i];
  removePickup(i);
  switch (kind) {
    case 0: {
      // gems swept up far away are paid out gradually with nearby pickups
      const bonus = Math.min(G.xpBank, v * 3 + 2);
      G.xpBank -= bonus;
      addXp(v + bonus);
      SFX().gem();
      flashAt(P.x, P.y, 26, [0.4, 0.9, 1.0], 0.12, 0.5);
      break;
    }
    case 1: {
      const amt = P.maxHp * 0.3;
      P.hp = Math.min(P.maxHp, P.hp + amt);
      addDmgNum(P.x, P.y - 24, amt, 3);
      ring(P.x, P.y, 10, 90, 0.4, [0.35, 1.0, 0.5], 0.15);
      SFX().heal();
      break;
    }
    case 2: {
      for (let j = 0; j < PK.n; j++) if (PK.alive[j] && PK.kind[j] === 0) PK.st[j] = 2;
      ring(P.x, P.y, 20, 700, 0.7, [0.75, 0.5, 1.0], 0.06);
      shock(P.x, P.y, 600, 0.7, -0.6);
      UI.toast('磁暴 · 全屏吸取');
      SFX().magnet();
      break;
    }
    case 3: {
      const x0 = Cam.x - Cam.vw * 0.5, x1 = Cam.x + Cam.vw * 0.5, y0 = Cam.y - Cam.vh * 0.5, y1 = Cam.y + Cam.vh * 0.5;
      for (let j = 0; j < EN.n; j++) {
        if (!EN.alive[j]) continue;
        if (EN.x[j] < x0 || EN.x[j] > x1 || EN.y[j] < y0 || EN.y[j] > y1) continue;
        const boss = ENEMY_TYPES[EN.type[j]].boss;
        damageEnemy(j, boss ? EN.maxHp[j] * 0.06 : EN.hp[j] + 1, null, 0, 0, 0);
      }
      G.flash = 1.0;
      G.chroma = 0.03;
      shock(P.x, P.y, 900, 0.9, 1.4);
      addShake(0.7);
      UI.toast('湮灭 · 清屏');
      SFX().bomb();
      break;
    }
    case 4:
      G.pendingChests++;
      flashAt(x, y, 120, [1, 0.85, 0.3], 0.4, 1);
      break;
    case 5:
      G.freezeAll = 6;
      ring(P.x, P.y, 10, 800, 0.8, ICE, 0.05);
      UI.toast('时停 · 6 秒');
      SFX().freeze();
      break;
    case 6:
      G.gold += v;
      SFX().tink(0);
      break;
  }
}

function updatePickups(dt) {
  const mag = 95 * S.magnet;
  const mag2 = mag * mag;
  const cr = P.r + 12;
  const cr2 = cr * cr;
  const damp1 = Math.max(0, 1 - 5 * dt), damp2 = Math.max(0, 1 - 2.2 * dt);
  G.gemSweepT -= dt;
  const sweep = G.gemSweepT <= 0;
  if (sweep) G.gemSweepT = 0.5;
  for (let i = 0; i < PK.n; i++) {
    if (!PK.alive[i]) continue;
    if (sweep && PK.kind[i] === 0 && PK.st[i] === 0) {
      const fx = PK.x[i] - P.x, fy = PK.y[i] - P.y;
      if (fx * fx + fy * fy > 1700 * 1700) { G.xpBank += PK.val[i]; removePickup(i); continue; }
    }
    PK.t[i] += dt;
    const dx = P.x - PK.x[i], dy = P.y - PK.y[i];
    const d2 = dx * dx + dy * dy;
    const kind = PK.kind[i];
    if (PK.st[i] === 0) {
      PK.vx[i] *= damp1; PK.vy[i] *= damp1;
      if (kind === 4) {
        if (d2 < (P.r + 30) * (P.r + 30) && !P.dead) { collectPickup(i); continue; }
      } else if (d2 < mag2 && PK.t[i] > 0.25) {
        PK.st[i] = 1;
        const d = Math.sqrt(d2) || 1;
        PK.vx[i] = (-dx / d) * 170; PK.vy[i] = (-dy / d) * 170;
      }
    } else {
      const d = Math.sqrt(d2) || 1;
      const acc = PK.st[i] === 2 ? 3400 : 2600;
      PK.vx[i] = PK.vx[i] * damp2 + (dx / d) * acc * dt;
      PK.vy[i] = PK.vy[i] * damp2 + (dy / d) * acc * dt;
      if (d2 < cr2 && !P.dead) { collectPickup(i); continue; }
    }
    PK.x[i] += PK.vx[i] * dt;
    PK.y[i] += PK.vy[i] * dt;
  }
}

function updateMiscFx(dt) {
  for (let k = G.rings.length - 1; k >= 0; k--) { const r = G.rings[k]; r.t += dt; if (r.t >= r.life) G.rings.splice(k, 1); }
  for (let k = G.tele.length - 1; k >= 0; k--) { const t = G.tele[k]; t.t += dt; if (t.t >= t.life) G.tele.splice(k, 1); }
  for (let k = G.shocks.length - 1; k >= 0; k--) { const s = G.shocks[k]; s.t += dt; if (s.t >= s.life) G.shocks.splice(k, 1); }
  for (let i = 0; i < MAX_DN; i++) if (DN.t[i] < DN_LIFE) DN.t[i] += dt;
  if (G.comboT > 0) { G.comboT -= dt; if (G.comboT <= 0) { G.bestCombo = Math.max(G.bestCombo, G.combo); G.combo = 0; } }
  if (G.combo > G.bestCombo) G.bestCombo = G.combo;
  if (G.freezeAll > 0) G.freezeAll -= dt;
}

function simulate(dt) {
  if (dt <= 0) return;
  G.time += dt;
  G.dnBudget = 14;
  updatePlayer(dt);
  Director.update(dt);
  buildGrid();
  updateBosses(dt);
  updateEnemies(dt);
  for (let k = 0; k < P.weapons.length; k++) {
    const w = P.weapons[k];
    WEAPON_LOGIC[w.id].update(w, dt);
  }
  updateProjectiles(dt);
  updateWeaponFx(dt);
  processBlasts();
  updateBullets(dt);
  updatePickups(dt);
  updateParticles(dt);
  updateMiscFx(dt);
  if (!G.demo) AudioSys.setIntensity(G.time < 40 ? 1 : G.time < 130 ? 2 : 3);
}

// ------------------------------------------------------------
//  Transitions: level up, chest, death, victory
// ------------------------------------------------------------
function beginTransition(type, dur) { G.trans = { type, t: 0, dur }; }

function levelUpBurst() {
  const c = [0.45, 0.95, 1.0];
  ring(P.x, P.y, 10, 260, 0.5, c, 0.08);
  ring(P.x, P.y, 10, 160, 0.4, [1, 1, 1], 0.12);
  shock(P.x, P.y, 300, 0.5, 0.9);
  flashAt(P.x, P.y, 160, c, 0.4, 1);
  for (let k = 0; k < 26; k++) {
    const a = rand(TAU), s = rand(80, 340);
    emit(P.x, P.y, Math.cos(a) * s, Math.sin(a) * s, rand(0.5, 0.9), rand(4, 8), 0, 0.7, 1.0, 1.2, 1, SH.SPARKLE, 2.5, 0, rand(TAU), rand(-4, 4));
  }
  const n = queryEnemies(P.x, P.y, 280, qA);
  for (let k = 0; k < n; k++) {
    const i = qA[k];
    const ex = EN.x[i] - P.x, ey = EN.y[i] - P.y, d = Math.hypot(ex, ey) || 1;
    const f = 700 * (1 - EN.kbr[i]) * (1 - d / 320);
    EN.kx[i] += (ex / d) * f; EN.ky[i] += (ey / d) * f;
  }
  clearBulletsIn(P.x, P.y, 220);
  SFX().levelup();
}

function finishTransition() {
  const type = G.trans.type;
  G.trans = null;
  if (type === 'levelup') {
    G.state = 'levelup';
    AudioSys.muffle(true);
    UI.showLevelUp(rollChoices());
  } else if (type === 'chest') {
    G.state = 'chest';
    AudioSys.muffle(true);
    G.pendingChests--;
    UI.showChest(chestRoll());
  } else if (type === 'death') {
    G.state = 'over';
    UI.showResults(false);
  } else if (type === 'victory') {
    G.state = 'victory';
    UI.showResults(true);
  }
}

function resumePlay() {
  G.state = 'playing';
  AudioSys.muffle(false);
  P.iframes = Math.max(P.iframes, 0.5);
  UI.showHud();
}

function pickLevelChoice(c) {
  applyChoice(c);
  G.pendingLevels--;
  UI.refreshSlots();
  if (G.pendingLevels > 0) UI.showLevelUp(rollChoices());
  else resumePlay();
}

function rerollChoices() {
  if (G.rerolls <= 0) return null;
  G.rerolls--;
  return rollChoices();
}

function closeChest() {
  UI.refreshSlots();
  resumePlay();
}

function startEndless() {
  Director.startEndless();
  G.won = true;
  AudioSys.setMode('game');
  resumePlay();
}

function frameUpdate(rawDt) {
  G.real += rawDt;
  G.flash = Math.max(0, G.flash - rawDt * 2.5);
  G.chroma = Math.max(0, G.chroma - rawDt * 0.06);
  G.hurtFx = Math.max(0, G.hurtFx - rawDt * 2.2);
  G.danger = damp(G.danger, G.dangerTarget, 1.5, rawDt);
  Cam.trauma = Math.max(0, Cam.trauma - rawDt * 1.5);
  G.beat = AudioSys.beatPulse();

  if (G.state === 'playing' || G.state === 'title') {
    let ts = 1;
    if (G.slowT > 0) {
      G.slowT -= rawDt;
      const k = G.slowT > 0.4 ? 1 : Math.max(0, G.slowT) / 0.4;
      ts = lerp(1, G.slowScale, k);
    }
    if (G.hitstop > 0) { G.hitstop -= rawDt; ts = Math.min(ts, 0.06); }
    if (G.trans) {
      G.trans.t += rawDt;
      const p = Math.min(1, G.trans.t / G.trans.dur);
      ts = Math.min(ts, G.trans.type === 'death' ? lerp(0.3, 0.04, p) : 1 - easeOutCubic(p));
    }
    simulate(rawDt * ts);
    if (G.trans && G.trans.t >= G.trans.dur) finishTransition();
    else if (G.state === 'playing' && !G.trans) {
      if (P.dead) {
        beginTransition('death', 1.8);
        deathFx(P.x, P.y, 26, P.col, true);
        sparks(P.x, P.y, 60, [1, 1, 1], 200, 700, 0.9, 5);
        G.flash = 0.5;
        addShake(0.8);
        AudioSys.setMode('silent');
        SFX().gameOver();
      } else if (G.pendingLevels > 0 && !hasUpgradesLeft()) {
        absorbMaxedLevels();
      } else if (G.pendingLevels > 0) {
        beginTransition('levelup', 0.32);
        levelUpBurst();
      } else if (G.pendingChests > 0) {
        beginTransition('chest', 0.35);
        SFX().chest();
      } else if (G.victoryT > 0) {
        G.victoryT -= rawDt;
        if (G.victoryT <= 0) {
          beginTransition('victory', 0.6);
          SFX().victory();
          AudioSys.setMode('title');
        }
      }
    }
  }
  updateCamera(rawDt);
  autoQuality(rawDt);
}

function updateCamera(dt) {
  const k = 1 - Math.exp(-dt * 7);
  Cam.x += (P.x + P.vx * 0.12 - Cam.x) * k;
  Cam.y += (P.y + P.vy * 0.12 - Cam.y) * k;
  const s = Cam.trauma * Cam.trauma * 24;
  const t = G.real;
  Cam.ox = s * (Math.sin(t * 53.1) * 0.6 + Math.sin(t * 31.7 + 1.3) * 0.4);
  Cam.oy = s * (Math.sin(t * 47.3 + 2.1) * 0.6 + Math.sin(t * 27.9 + 0.4) * 0.4);
  const cw = Renderer.cssW, chh = Renderer.cssH;
  const area = Math.min(cw, chh) < 640 ? VIEW_AREA * 0.62 : VIEW_AREA;
  const z = Math.sqrt((cw * chh) / area);
  Cam.vw = cw / z;
  Cam.vh = chh / z;
}
const VIEW_AREA = 1400 * 800;

function autoQuality(dt) {
  if (Settings.quality !== 'auto' || G.state !== 'playing') return;
  const q = G.autoQ;
  q.acc += dt; q.n++;
  if (q.acc >= 4) {
    const avg = (q.acc / q.n) * 1000;
    q.acc = 0; q.n = 0;
    const cur = q.level || 'high';
    if (avg > 25 && cur !== 'low') {
      q.level = cur === 'high' ? 'medium' : 'low';
      applyQuality(q.level);
    }
  }
}
function applyQuality(level) {
  Renderer.setQuality(level);
  G.fxMul = level === 'low' ? 0.45 : level === 'medium' ? 0.75 : 1;
}

// ------------------------------------------------------------
//  Render
// ------------------------------------------------------------
const XP_COLS = [[0.3, 0.85, 1.0], [0.35, 1.0, 0.5], [1.0, 0.35, 0.85], [1.0, 0.8, 0.3]];
const tmpRGB = [0, 0, 0];

function renderWorld() {
  const R = Renderer;
  const camX = Cam.x + Cam.ox, camY = Cam.y + Cam.oy;
  R.setCamera(camX, camY, Cam.vw, Cam.vh);
  R.begin();
  const hx = Cam.vw * 0.5 + 70, hy = Cam.vh * 0.5 + 70;
  const t = G.real;
  const inView = (x, y, r) => Math.abs(x - camX) < hx + r && Math.abs(y - camY) < hy + r;

  // ---- ground layer
  for (const w of P.weapons) {
    if (w.id === 'aura' && w.R > 0) {
      const ev = w.evolved;
      R.sprite(P.x, P.y, w.R, w.R, w.rot, SH.FROST, ev ? 0.55 : 0.4, ev ? 0.9 : 0.8, ev ? 1.3 : 1.0, 0.75 + 0.6 * w.pulse + G.beat * 0.15, 0, 0);
    }
  }
  for (const h of G.holes) {
    if (h.t < h.travel) continue;
    const g = Math.min(1, (h.t - h.travel) * 4);
    R.sprite(h.x, h.y, h.R * 1.15 * g, h.R * 1.15 * g, 0, SH.GLOW, 0.22, 0.06, 0.4, 1, 0, 0);
  }
  for (const tl of G.tele) {
    const a = (0.35 + 0.35 * Math.sin(tl.t * 40)) * (1 - tl.t / tl.life * 0.3);
    R.beam(tl.x, tl.y, tl.x + tl.dx * tl.len, tl.y + tl.dy * tl.len, tl.w, 0.9, 0.1, 0.1, a, 0.15);
  }
  for (const bm of G.bossBeams) {
    if (bm.t >= bm.tele || !EN.alive[bm.i]) continue;
    const x0 = EN.x[bm.i], y0 = EN.y[bm.i];
    const a = 0.4 + 0.4 * Math.sin(bm.t * 30);
    for (let j = 0; j < bm.n; j++) {
      const ang = bm.ang + (j / bm.n) * TAU;
      R.beam(x0, y0, x0 + Math.cos(ang) * bm.len, y0 + Math.sin(ang) * bm.len, 6, 1.0, 0.15, 0.3, a, 0.3);
    }
  }

  // ---- pickups
  for (let i = 0; i < PK.n; i++) {
    if (!PK.alive[i]) continue;
    const x = PK.x[i], y = PK.y[i];
    if (!inView(x, y, 40)) continue;
    const kind = PK.kind[i];
    const bob = Math.sin(t * 4 + i) * 1.5;
    if (kind === 0) {
      const v = PK.val[i];
      const c = XP_COLS[v < 2 ? 0 : v < 8 ? 1 : v < 30 ? 2 : 3];
      const s = 4.5 + Math.min(9, Math.sqrt(v) * 1.5);
      R.sprite(x, y + bob, s * 2.8, s * 2.8, 0, SH.GLOW, c[0] * 0.35, c[1] * 0.35, c[2] * 0.35, 1, 0, 0);
      R.sprite(x, y + bob, s * 1.25, s, Math.PI / 2, SH.DIAMOND, c[0], c[1], c[2], 1, 0.55, 0.25);
    } else if (kind === 1) {
      const p = 1 + Math.sin(t * 6) * 0.08;
      R.sprite(x, y + bob, 30, 30, 0, SH.GLOW, 0.5, 0.1, 0.12, 1, 0, 0);
      R.sprite(x, y + bob, 11 * p, 11 * p, 0, SH.CROSS, 1.0, 0.25, 0.3, 1, 0.6, 0.25);
    } else if (kind === 2) {
      R.sprite(x, y + bob, 34, 34, 0, SH.GLOW, 0.35, 0.2, 0.6, 1, 0, 0);
      R.sprite(x, y + bob, 12, 12, t * 3, SH.RING, 0.75, 0.5, 1.0, 1, 0.3, 0.28);
      R.sprite(x, y + bob, 5, 5, 0, SH.CIRCLE, 0.9, 0.7, 1.0, 1, 0.8, 0.3);
    } else if (kind === 3) {
      const f = 0.6 + 0.4 * Math.sin(t * 14);
      R.sprite(x, y + bob, 32, 32, 0, SH.GLOW, 0.6 * f, 0.15, 0.05, 1, 0, 0);
      R.sprite(x, y + bob, 11, 11, t, SH.STAR, 1.0, 0.35, 0.15, 1, 0.5, 0.25);
    } else if (kind === 4) {
      const p = 1 + Math.sin(t * 5) * 0.06;
      R.beam(x, y + 10, x, y - 220, 34, 0.7, 0.5, 0.15, 0.45 + 0.15 * Math.sin(t * 3), 0.25);
      R.sprite(x, y, 70, 70, 0, SH.GLOW, 0.6, 0.45, 0.12, 1, 0, 0);
      R.sprite(x, y + bob, 17 * p, 14 * p, 0, SH.SQUARE, 1.0, 0.78, 0.25, 1, 0.45, 0.2);
      R.sprite(x, y + bob - 2, 6, 6, t * 2, SH.SPARKLE, 1.5, 1.3, 0.8, 1, 0, 0);
    } else if (kind === 5) {
      R.sprite(x, y + bob, 30, 30, 0, SH.GLOW, 0.2, 0.4, 0.6, 1, 0, 0);
      R.sprite(x, y + bob, 11, 11, t, SH.HEX, 0.6, 0.92, 1.0, 1, 0.5, 0.25);
    } else {
      const sx = Math.abs(Math.cos(t * 4 + i)) * 6 + 1.5;
      R.sprite(x, y + bob, 18, 18, 0, SH.GLOW, 0.35, 0.28, 0.05, 1, 0, 0);
      R.sprite(x, y + bob, sx, 6.5, 0, SH.CIRCLE, 1.0, 0.82, 0.25, 1, 0.55, 0.3);
    }
  }

  // ---- enemies
  const px = P.x, py = P.y;
  for (let i = 0; i < EN.n; i++) {
    if (!EN.alive[i]) continue;
    const x = EN.x[i], y = EN.y[i];
    const r0 = EN.r[i];
    if (!inView(x, y, r0 * 2)) continue;
    const T = ENEMY_TYPES[EN.type[i]];
    const uid = EN.uid[i];
    const sp = EN.spawnT[i];
    const scale = sp < 1 ? Math.max(0.05, easeOutBack(sp)) : 1;
    const rr = r0 * scale * (1 + 0.05 * Math.sin(t * 7 + uid * 1.7));
    let cr = T.col[0], cg = T.col[1], cb = T.col[2];
    if (EN.flash[i] > 0) {
      const f = Math.min(1, EN.flash[i] / 0.1) * (T.boss ? 0.3 : 0.75);
      cr = lerp(cr, 2.1, f); cg = lerp(cg, 2.1, f); cb = lerp(cb, 2.1, f);
    } else if (EN.freezeT[i] > 0 || (G.freezeAll > 0 && !T.boss)) { cr = 0.65; cg = 0.95; cb = 1.35; }
    else if (EN.slowAmt[i] > 0) { cr = lerp(cr, 0.5, 0.4); cg = lerp(cg, 0.85, 0.4); cb = lerp(cb, 1.2, 0.4); }
    if (T.boss) { drawBoss(i, T, rr, cr, cg, cb, t); continue; }
    let rot;
    const sh = T.shape;
    if (sh === SH.TRI || sh === SH.DIAMOND) rot = EN.st[i] === 1 ? Math.atan2(EN.dirY[i], EN.dirX[i]) : Math.atan2(py - y, px - x);
    else if (sh === SH.STAR) rot = t * 3 + uid;
    else if (sh === SH.PENT) rot = -t * 1.2 + uid;
    else rot = t * 0.7 + uid;
    if (EN.elite[i]) {
      R.sprite(x, y, rr * 2.6, rr * 2.6, 0, SH.GLOW, 0.5, 0.38, 0.08, 1, 0, 0);
      R.sprite(x, y, rr * 1.38, rr * 1.38, -t * 2, SH.RING, 1.0, 0.8, 0.3, 0.9, 0, 0.05);
    }
    if (T.ai === 3 && EN.fuse[i] > 0) {
      const f = Math.sin(EN.fuse[i] * 40) > 0;
      if (f) { cr = 2.2; cg = 2.0; cb = 1.2; }
      R.sprite(x, y, rr * 3, rr * 3, 0, SH.GLOW, 0.8, 0.6, 0.1, 1, 0, 0);
    }
    R.sprite(x, y, rr, rr, rot, sh, cr, cg, cb, 1, 0.3, rr > 20 ? 0.11 : 0.16);
    if (T.ai === 2) R.sprite(x, y, rr * 0.42, rr * 0.42, 0, SH.CIRCLE, cr * 1.2, cg * 1.2, cb * 1.2, 1, 0.9, 0.3);
    else if (T.ai === 1) R.sprite(x, y, rr * 0.3, rr * 0.3, 0, SH.GLOW, 1.5, 1.8, 1.5, 1, 0, 0);
    else if (sh === SH.HEX) R.sprite(x, y, rr * 0.5, rr * 0.5, -rot * 2, SH.HEX, cr, cg, cb, 1, 0.5, 0.2);
    if (EN.elite[i] && EN.hp[i] < EN.maxHp[i]) {
      const f = Math.max(0, EN.hp[i] / EN.maxHp[i]);
      R.sprite(x, y - rr - 12, rr, 2.5, 0, SH.RECT, 0.05, 0.02, 0.08, 0.85, 0, 0);
      R.sprite(x - rr + rr * f, y - rr - 12, rr * f, 2.5, 0, SH.RECT, 1.3, 0.85, 0.25, 1, 0, 0);
    }
  }

  // ---- player
  if (!P.dead || G.state === 'title') {
    const c = P.col;
    const blink = P.iframes > 0 && Math.sin(t * 50) > 0 ? 0.45 : 1;
    R.sprite(px, py, 60, 60, 0, SH.GLOW, c[0] * 0.3, c[1] * 0.3, c[2] * 0.3, 1, 0, 0);
    R.sprite(px, py, 20, 20, t * 2.2, SH.RING, c[0], c[1], c[2], 0.8 * blink, 0, 0.07);
    R.sprite(px + P.fx * 25, py + P.fy * 25, 6, 6, Math.atan2(P.fy, P.fx), SH.TRI, c[0], c[1], c[2], blink, 0.8, 0.3);
    R.sprite(px, py, 11.5, 11.5, -t * 1.5, SH.HEX, c[0], c[1], c[2], blink, 0.55, 0.22);
    R.sprite(px, py, 8, 8, 0, SH.GLOW, 1.6, 1.6, 1.6, blink, 0, 0);
    if (!G.demo) {
      const f = clamp(P.hp / P.maxHp, 0, 1);
      hsv(f * 0.33, 0.85, 1.25, tmpRGB);
      R.sprite(px, py + 27, 19, 2.6, 0, SH.RECT, 0.04, 0.02, 0.07, 0.85, 0, 0);
      R.sprite(px - 19 + 19 * f, py + 27, 19 * f, 2.6, 0, SH.RECT, tmpRGB[0], tmpRGB[1], tmpRGB[2], 1, 0, 0);
    }
  }

  // ---- orbit blades
  for (const w of P.weapons) {
    if (w.id !== 'orbit' || !w.nb) continue;
    const area = wArea(w);
    const s = 15 * Math.sqrt(area) * (0.6 + 0.4 * w.grow);
    const n1 = Math.min(14, wAmount(w));
    for (let b = 0; b < w.nb; b++) {
      const x = w.blades[b * 2], y = w.blades[b * 2 + 1];
      const outer = w.evolved && b >= n1;
      const c = outer ? COL_ORBIT2 : COL_ORBIT;
      const a = Math.atan2(y - py, x - px) + (outer ? -1 : 1) * Math.PI / 2;
      R.sprite(x, y, s * 2.4, s * 2.4, 0, SH.GLOW, c[0] * 0.4, c[1] * 0.4, c[2] * 0.4, 1, 0, 0);
      R.sprite(x, y, s, s, a, SH.BLADE, c[0] * 1.2, c[1] * 1.2, c[2] * 1.2, 1, 0.7, 0.3);
    }
  }

  // ---- projectiles
  for (let i = 0; i < PR.n; i++) {
    const x = PR.x[i], y = PR.y[i];
    if (!inView(x, y, 30)) continue;
    const r = PR.r[i];
    const k = PR.kind[i];
    if (k === PR_BOLT) {
      R.sprite(x, y, r * 3.4, r * 3.4, 0, SH.GLOW, 0.3, 0.8, 1.0, 1, 0, 0);
      R.sprite(x, y, r * 1.1, r * 0.8, Math.atan2(PR.vy[i], PR.vx[i]), SH.CIRCLE, 0.8, 1.6, 2.0, 1, 1, 0.3);
    } else if (k === PR_STAR) {
      R.sprite(x, y, r * 3.2, r * 3.2, PR.a1[i], SH.SPARKLE, 1.6, 1.3, 0.6, 1, 0, 0);
      R.sprite(x, y, r * 1.6, r * 1.6, 0, SH.GLOW, 1.5, 1.3, 0.8, 1, 0, 0);
    } else if (k === PR_MISSILE) {
      const a = Math.atan2(PR.vy[i], PR.vx[i]);
      R.sprite(x - Math.cos(a) * 8, y - Math.sin(a) * 8, 14, 14, 0, SH.GLOW, 1.2, 0.6, 0.15, 1, 0, 0);
      R.sprite(x, y, r * 1.3, r * 0.6, a, SH.TRI, 1.3, 0.75, 0.35, 1, 0.6, 0.25);
    } else {
      R.sprite(x, y, r * 3, r * 3, 0, SH.GLOW, 0.45, 0.6, 0.12, 1, 0, 0);
      R.sprite(x, y, r * 1.3, r * 1.3, PR.a1[i], SH.RING, COL_DISC[0] * 1.4, COL_DISC[1] * 1.4, COL_DISC[2] * 1.4, 1, 0.5, 0.3);
      R.sprite(x, y, r * 0.9, r * 0.35, PR.a1[i] * 1.7, SH.DIAMOND, 1.2, 1.5, 0.6, 1, 0.8, 0.3);
      R.sprite(x, y, r * 0.35, r * 0.35, 0, SH.GLOW, 1.4, 1.6, 1.0, 1, 0, 0);
    }
  }

  // ---- lasers
  for (const L of G.lasers) {
    const p = L.t / L.dur;
    const grow = Math.min(1, L.t / 0.06);
    const fade = p > 0.8 ? (1 - p) / 0.2 : 1;
    const wdt = L.width * grow * fade * (0.9 + 0.1 * Math.sin(t * 70));
    drawLaser(px, py, L.ang, L.len, wdt, 1.0, 0.35, 0.85);
  }
  for (const w of P.weapons) {
    if (w.id !== 'laser' || !w.evolved) continue;
    const n = wAmount(w);
    const len = w.st.length * (0.9 + 0.1 * wArea(w));
    const wdt = w.st.width * wArea(w) * (0.92 + 0.08 * Math.sin(t * 60));
    for (let k = 0; k < n; k++) {
      hsv(t * 0.15 + k / n, 0.9, 1.0, tmpRGB);
      drawLaser(px, py, w.ang + (k / n) * TAU, len, wdt, tmpRGB[0], tmpRGB[1], tmpRGB[2]);
    }
  }
  for (const bm of G.bossBeams) {
    if (bm.t < bm.tele || !EN.alive[bm.i]) continue;
    const x0 = EN.x[bm.i], y0 = EN.y[bm.i];
    const g = Math.min(1, (bm.t - bm.tele) * 6) * Math.min(1, (bm.tele + bm.dur - bm.t) * 4);
    for (let j = 0; j < bm.n; j++) {
      const a = bm.ang + (j / bm.n) * TAU;
      drawLaser(x0, y0, a, bm.len, bm.w * g * (0.9 + 0.1 * Math.sin(t * 50)), 1.0, 0.12, 0.35);
    }
  }

  // ---- lightning
  for (const b of G.bolts) {
    const pts = b.jag;
    if (!pts) continue;
    const a = (1 - b.t / b.life) * (0.75 + 0.25 * Math.random());
    for (let k = 2; k < pts.length; k += 2) {
      R.beam(pts[k - 2], pts[k - 1], pts[k], pts[k + 1], 13 * b.wide, 0.3, 0.45, 1.0, a * 0.75, 0);
      R.beam(pts[k - 2], pts[k - 1], pts[k], pts[k + 1], 3.2 * b.wide, 0.75, 0.85, 1.2, a, 0.7);
    }
  }

  // ---- slashes / novas / rings
  for (const s of G.slashes) {
    const p = s.t / s.life;
    const prog = Math.min(1.35, p * 2.8);
    const alpha = p < 0.45 ? 1 : 1 - (p - 0.45) / 0.55;
    const sc = s.R * (0.86 + 0.2 * easeOutCubic(p));
    const c = s.col;
    R.sprite(px, py, sc, sc, s.ang, SH.SLASH, c[0] * 2.2, c[1] * 2.2, c[2] * 2.2, alpha, prog, 0);
    if (s.big) R.sprite(px, py, sc * 0.82, sc * 0.82, s.ang + 0.4, SH.SLASH, 1.6, 0.4, 0.5, alpha * 0.7, prog, 0);
  }
  for (const nv of G.novas) {
    const p = nv.t / nv.dur;
    const r = nv.R * easeOutCubic(Math.min(1, p));
    const fade = p <= 1 ? 1 : Math.max(0, 1 - (nv.t - nv.dur) / 0.3);
    const c = nv.evo ? COL_SUPERNOVA : COL_NOVA;
    R.sprite(nv.x, nv.y, r + 8, r + 8, 0, SH.SOFTRING, c[0] * 1.3, c[1] * 1.3, c[2] * 1.3, fade, 0.035, nv.evo ? 0.12 : 0.09);
    if (nv.evo) R.sprite(nv.x, nv.y, r * 0.8 + 6, r * 0.8 + 6, 0, SH.SOFTRING, 1.3, 1.1, 0.9, fade * 0.4, 0, 0.05);
  }
  for (const rg of G.rings) {
    const p = rg.t / rg.life;
    const r = lerp(rg.r0, rg.r1, easeOutCubic(p));
    const c = rg.c;
    R.sprite(rg.x, rg.y, r, r, 0, SH.SOFTRING, c[0] * 1.6, c[1] * 1.6, c[2] * 1.6, (1 - p) * rg.a, 0, rg.th);
  }

  // ---- particles
  const load = fxLoad();
  for (let i = 0; i < PT.n; i++) {
    const x = PT.x[i], y = PT.y[i];
    if (Math.abs(x - camX) > hx || Math.abs(y - camY) > hy) continue;
    const p = 1 - PT.life[i] / PT.max[i];
    const s = PT.s0[i] + (PT.s1[i] - PT.s0[i]) * p;
    if (s <= 0.2) continue;
    const a = PT.a[i] * (1 - p * p);
    const sh = PT.shape[i];
    if (sh === SH.SPARK) {
      const vx = PT.vx[i], vy = PT.vy[i];
      const v = Math.sqrt(vx * vx + vy * vy);
      R.sprite(x, y, s * (1 + v * PT.stretch[i]), s * 0.32, Math.atan2(vy, vx), sh, PT.r[i], PT.g[i], PT.b[i], a, 0, 0);
    } else if (sh < 20) {
      R.sprite(x, y, s, s, PT.rot[i], sh, PT.r[i], PT.g[i], PT.b[i], a, 0.35, 0.22);
    } else {
      R.sprite(x, y, s, s, PT.rot[i], sh, PT.r[i], PT.g[i], PT.b[i], a, 0, 0);
    }
  }
  void load;

  // ---- black hole cores (drawn above particles so they swallow light)
  for (const h of G.holes) {
    if (h.t < h.travel) {
      R.sprite(h.x, h.y, 26, 26, 0, SH.GLOW, 0.5, 0.2, 0.9, 1, 0, 0);
      R.sprite(h.x, h.y, 14, 14, 0, SH.HOLE, 0.8, 0.4, 1.0, 1, 0, 0);
      continue;
    }
    const at = h.t - h.travel;
    const g = Math.min(1, at * 5) * Math.min(1, (h.dur - at) * 5 + 0.2);
    const core = (h.evo ? 30 : 20) * g * (1 + 0.06 * Math.sin(t * 9));
    R.sprite(h.x, h.y, h.R * 0.62, h.R * 0.62, h.spin, SH.SOFTRING, 0.55, 0.22, 1.0, 0.6 * g, 0.04, 0.22);
    R.sprite(h.x, h.y, core / 0.56, core / 0.56, 0, SH.HOLE, 1.0, 0.55, 0.3, 1, 0, 0);
  }

  // ---- enemy bullets
  for (let i = 0; i < EB.n; i++) {
    const x = EB.x[i], y = EB.y[i];
    if (!inView(x, y, 20)) continue;
    const r = EB.r[i];
    const k = EB.kind[i];
    const c = k === 0 ? [0.6, 1.0, 0.3] : k === 1 ? [1.0, 0.3, 0.15] : [1.0, 0.25, 0.75];
    R.sprite(x, y, r * 2.8, r * 2.8, 0, SH.GLOW, c[0] * 0.8, c[1] * 0.8, c[2] * 0.8, 1, 0, 0);
    R.sprite(x, y, r, r, 0, SH.CIRCLE, c[0] * 1.4, c[1] * 1.4, c[2] * 1.4, 1, 0.9, 0.35);
    R.sprite(x, y, r * 0.55, r * 0.55, 0, SH.GLOW, 1.6, 1.6, 1.6, 1, 0, 0);
  }

  // ---- damage numbers
  for (let i = 0; i < MAX_DN; i++) {
    const age = DN.t[i];
    if (age >= DN_LIFE) continue;
    const p = age / DN_LIFE;
    const kind = DN.kind[i];
    let h, cr, cg, cb;
    if (kind === 0) { h = 15; cr = 1.05; cg = 1.05; cb = 1.05; }
    else if (kind === 1) { h = 23; cr = 1.35; cg = 0.95; cb = 0.3; }
    else if (kind === 2) { h = 21; cr = 1.3; cg = 0.25; cb = 0.3; }
    else { h = 19; cr = 0.4; cg = 1.3; cb = 0.55; }
    const pop = p < 0.14 ? lerp(1.7, 1, p / 0.14) : 1;
    const y = DN.y[i] - easeOutCubic(Math.min(1, p * 1.6)) * 28;
    const a = p > 0.6 ? 1 - (p - 0.6) / 0.4 : 1;
    if (!inView(DN.x[i], y, 30)) continue;
    R.number(DN.s[i], DN.x[i], y, h * pop, cr, cg, cb, a);
  }

  // ---- off-screen markers: bosses, elites, chests
  if (!G.demo) {
    for (const b of G.bosses) if (EN.alive[b.i]) edgeMarker(EN.x[b.i], EN.y[b.i], camX, camY, 1.0, 0.25, 0.3, 1.25);
    for (let i = 0; i < EN.n; i++) if (EN.alive[i] && EN.elite[i]) edgeMarker(EN.x[i], EN.y[i], camX, camY, 1.0, 0.8, 0.3, 1);
    for (let i = 0; i < PK.n; i++) if (PK.alive[i] && PK.kind[i] === 4) edgeMarker(PK.x[i], PK.y[i], camX, camY, 1.0, 0.85, 0.35, 1.1);
  }
}

function drawLaser(x0, y0, ang, len, wdt, r, g, b) {
  if (wdt <= 0.2) return;
  const x1 = x0 + Math.cos(ang) * len, y1 = y0 + Math.sin(ang) * len;
  Renderer.beam(x0, y0, x1, y1, wdt * 2.4, r * 0.5, g * 0.5, b * 0.5, 0.65, 0);
  Renderer.beam(x0, y0, x1, y1, wdt, r * 1.05, g * 1.05, b * 1.05, 1, 0.75);
  Renderer.sprite(x0 + Math.cos(ang) * 8, y0 + Math.sin(ang) * 8, wdt * 1.8, wdt * 1.8, 0, SH.GLOW, r * 0.8, g * 0.8, b * 0.8, 1, 0, 0);
}

function edgeMarker(x, y, camX, camY, r, g, b, s) {
  const hw = Cam.vw * 0.5, hh = Cam.vh * 0.5;
  const dx = x - camX, dy = y - camY;
  if (Math.abs(dx) < hw - 10 && Math.abs(dy) < hh - 10) return;
  const m = 34;
  const k = Math.min((hw - m) / Math.max(Math.abs(dx), 1e-3), (hh - m) / Math.max(Math.abs(dy), 1e-3));
  const ex = camX + dx * k, ey = camY + dy * k;
  const a = Math.atan2(dy, dx);
  const pulse = 1 + 0.15 * Math.sin(G.real * 8);
  Renderer.sprite(ex, ey, 22 * s, 22 * s, 0, SH.GLOW, r * 0.5, g * 0.5, b * 0.5, 1, 0, 0);
  Renderer.sprite(ex, ey, 10 * s * pulse, 7 * s * pulse, a, SH.TRI, r, g, b, 1, 0.6, 0.3);
}

function drawBoss(i, T, rr, cr, cg, cb, t) {
  const R = Renderer;
  const x = EN.x[i], y = EN.y[i];
  const b = G.bosses.find((q) => q.i === i);
  const key = T.key;
  R.sprite(x, y, rr * 3.2, rr * 3.2, 0, SH.GLOW, T.col[0] * 0.35, T.col[1] * 0.35, T.col[2] * 0.35, 1, 0, 0);
  if (key === 'colossus') {
    const tele = b && b.state === 1;
    const k = tele && Math.sin(t * 40) > 0 ? 1.8 : 1;
    R.sprite(x, y, rr, rr, t * 0.4, SH.HEX, cr * k, cg * k, cb * k, 1, 0.3, 0.08);
    R.sprite(x, y, rr * 0.66, rr * 0.66, -t * 0.9, SH.HEX, cr, cg, cb, 1, 0.25, 0.12);
    R.sprite(x, y, rr * 0.3, rr * 0.3, t * 2, SH.SQUARE, 1.6, 1.2, 1.0, 1, 0.8, 0.3);
    for (let k2 = 0; k2 < 6; k2++) {
      const a = t * 0.4 + (k2 / 6) * TAU + Math.PI / 6;
      R.sprite(x + Math.cos(a) * rr * 1.15, y + Math.sin(a) * rr * 1.15, rr * 0.14, rr * 0.14, a, SH.TRI, cr, cg, cb, 1, 0.5, 0.25);
    }
  } else if (key === 'queen') {
    R.sprite(x, y, rr, rr, t * 0.8, SH.STAR, cr, cg, cb, 1, 0.3, 0.08);
    R.sprite(x, y, rr * 0.45, rr * 0.45, 0, SH.CIRCLE, 1.4, 1.0, 0.4, 1, 0.6, 0.25);
    for (let k2 = 0; k2 < 8; k2++) {
      const a = -t * 1.4 + (k2 / 8) * TAU;
      R.sprite(x + Math.cos(a) * rr * 1.35, y + Math.sin(a) * rr * 1.35, rr * 0.16, rr * 0.11, a, SH.DIAMOND, cr, cg * 0.8, cb, 1, 0.5, 0.25);
    }
  } else {
    const phase = b ? b.phase : 1;
    const rage = phase === 3 ? 1 : 0;
    const bc = rage ? [1.0, 0.2, 0.35] : [cr, cg, cb];
    for (let k2 = 0; k2 < 10; k2++) {
      const a = t * (0.3 + rage * 0.5) + (k2 / 10) * TAU;
      R.sprite(x + Math.cos(a) * rr * 1.08, y + Math.sin(a) * rr * 1.08, rr * 0.22, rr * 0.12, a, SH.TRI, bc[0], bc[1], bc[2], 1, 0.4, 0.2);
    }
    R.sprite(x, y, rr, rr, -t * 0.2, SH.OCT, bc[0], bc[1], bc[2], 1, 0.22, 0.06);
    R.sprite(x, y, rr * 0.72, rr * 0.72, t * 0.5, SH.RING, bc[0], bc[1], bc[2], 1, 0.2, 0.05);
    const dx = P.x - x, dy = P.y - y, d = Math.hypot(dx, dy) || 1;
    const ix = x + (dx / d) * rr * 0.22, iy = y + (dy / d) * rr * 0.22;
    R.sprite(ix, iy, rr * 0.42, rr * 0.42, 0, SH.CIRCLE, 1.6, 0.9, 1.8, 1, 0.35, 0.18);
    R.sprite(ix + (dx / d) * rr * 0.06, iy + (dy / d) * rr * 0.06, rr * 0.18 / 0.56, rr * 0.18 / 0.56, 0, SH.HOLE, 1.4, 0.6, 1.4, 1, 0, 0);
  }
}

function renderFrame() {
  renderWorld();
  // post-processing parameters
  const sb = renderFrame.buf || (renderFrame.buf = new Float32Array(32));
  let n = 0;
  const camX = Cam.x + Cam.ox, camY = Cam.y + Cam.oy;
  for (let k = 0; k < G.shocks.length && n < 8; k++) {
    const s = G.shocks[k];
    const p = s.t / s.life;
    const r = s.maxR * easeOutCubic(p);
    sb[n * 4] = (s.x - camX) / Cam.vw + 0.5;
    sb[n * 4 + 1] = 0.5 - (s.y - camY) / Cam.vh;
    sb[n * 4 + 2] = r / Cam.vh;
    sb[n * 4 + 3] = s.str * (1 - p) * (1 - p);
    n++;
  }
  for (let k = 0; k < G.holes.length && n < 8; k++) {
    const h = G.holes[k];
    if (h.t < h.travel) continue;
    const core = h.evo ? 30 : 20;
    sb[n * 4] = (h.x - camX) / Cam.vw + 0.5;
    sb[n * 4 + 1] = 0.5 - (h.y - camY) / Cam.vh;
    sb[n * 4 + 2] = (core * 2.2) / Cam.vh;
    sb[n * 4 + 3] = -0.55;
    n++;
  }
  let hurt = G.hurtFx * 0.6;
  if (!G.demo && G.state !== 'title' && P.hp / P.maxHp < 0.3 && !P.dead) hurt += (0.3 - P.hp / P.maxHp) * 1.6 * (0.6 + 0.4 * Math.sin(G.real * 7));
  Renderer.render({
    time: G.real, pulse: G.beat, px: P.x, py: P.y,
    tint: G.freezeAll > 0 ? [0.7, 1.0, 1.4] : [1, 1, 1],
    danger: G.danger,
    bloom: 0.95 + G.beat * 0.12,
    chroma: 0.0025 + G.chroma + G.danger * 0.002,
    vignette: 0.42,
    hurt,
    flash: G.flash * 0.55,
    exposure: 1.25,
    sat: 1.12,
    shocks: sb,
    shockN: n,
  });
}
