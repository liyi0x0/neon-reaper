'use strict';
// ============================================================
//  Input, app flow, main loop, boot
// ============================================================
const Input = (() => {
  const keys = new Set();
  const joy = { id: -1, ox: 0, oy: 0, x: 0, y: 0, active: false };
  const mouse = { down: false, x: 0, y: 0 };
  let joyEl = null, knobEl = null;
  let padPause = false;
  // getGamepads() throws inside iframes that lack the gamepad permission; stop polling after the first refusal
  let padsOk = !!navigator.getGamepads;
  function pads() {
    if (!padsOk) return [];
    try { return navigator.getGamepads() || []; } catch (e) { padsOk = false; return []; }
  }

  function vector(out) {
    let x = 0, y = 0;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
    if (keys.has('KeyW') || keys.has('ArrowUp')) y -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) y += 1;
    if (x || y) {
      const l = Math.hypot(x, y); x /= l; y /= l;
    } else if (joy.active) {
      x = joy.x; y = joy.y;
    } else if (mouse.down) {
      const dx = mouse.x - window.innerWidth / 2, dy = mouse.y - window.innerHeight / 2;
      const l = Math.hypot(dx, dy);
      if (l > 18) { const k = Math.min(1, (l - 18) / 60); x = (dx / l) * k; y = (dy / l) * k; }
    } else {
      for (const gp of pads()) {
        if (!gp) continue;
        const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
        const l = Math.hypot(ax, ay);
        if (l > 0.2) { const k = Math.min(1, (l - 0.2) / 0.75); x = (ax / l) * k; y = (ay / l) * k; }
        const db = gp.buttons;
        if (db[12] && db[12].pressed) y = -1;
        if (db[13] && db[13].pressed) y = 1;
        if (db[14] && db[14].pressed) x = -1;
        if (db[15] && db[15].pressed) x = 1;
        break;
      }
    }
    out.x = x; out.y = y;
  }

  function pollPadButtons() {
    for (const gp of pads()) {
      if (!gp) continue;
      const st = gp.buttons[9] && gp.buttons[9].pressed;
      if (st && !padPause) { if (G.state === 'playing') App.pause(); else if (G.state === 'paused') App.resume(); }
      padPause = !!st;
      break;
    }
  }

  function init(canvas) {
    joyEl = document.getElementById('joy');
    knobEl = document.getElementById('joyKnob');
    window.addEventListener('keydown', (e) => {
      AudioSys.init();
      if (UI.onKey(e)) return;
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (G.state === 'playing') App.pause();
        else if (G.state === 'paused' && UI.current === 'pause') App.resume();
        e.preventDefault();
        return;
      }
      if (G.state === 'playing' && /^(Arrow|Space)/.test(e.code)) e.preventDefault();
      keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => keys.delete(e.code));
    window.addEventListener('blur', () => { keys.clear(); mouse.down = false; endJoy(); });

    canvas.addEventListener('pointerdown', (e) => {
      AudioSys.init();
      if (G.state !== 'playing') return;
      if (e.pointerType === 'mouse') {
        if (e.button !== 0) return;
        mouse.down = true; mouse.x = e.clientX; mouse.y = e.clientY;
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      if (joy.active) return;
      joy.active = true; joy.id = e.pointerId; joy.ox = e.clientX; joy.oy = e.clientY; joy.x = 0; joy.y = 0;
      canvas.setPointerCapture(e.pointerId);
      joyEl.hidden = false;
      joyEl.style.transform = `translate(${joy.ox}px, ${joy.oy}px)`;
      knobEl.style.transform = 'translate(0px, 0px)';
    });
    canvas.addEventListener('pointermove', (e) => {
      if (mouse.down && e.pointerType === 'mouse') { mouse.x = e.clientX; mouse.y = e.clientY; return; }
      if (!joy.active || e.pointerId !== joy.id) return;
      let dx = e.clientX - joy.ox, dy = e.clientY - joy.oy;
      const l = Math.hypot(dx, dy), R = 56;
      if (l > R) {
        // drag the base along so the stick never "sticks" at the rim
        joy.ox += (dx / l) * (l - R); joy.oy += (dy / l) * (l - R);
        dx = e.clientX - joy.ox; dy = e.clientY - joy.oy;
        joyEl.style.transform = `translate(${joy.ox}px, ${joy.oy}px)`;
      }
      const m = Math.hypot(dx, dy);
      const k = m < 6 ? 0 : Math.min(1, m / R);
      joy.x = m ? (dx / m) * k : 0; joy.y = m ? (dy / m) * k : 0;
      knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
    });
    const up = (e) => {
      if (e.pointerType === 'mouse') { mouse.down = false; return; }
      if (e.pointerId === joy.id) endJoy();
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  function endJoy() { joy.active = false; joy.id = -1; joy.x = 0; joy.y = 0; if (joyEl) joyEl.hidden = true; }

  return { init, vector, pollPadButtons, reset() { keys.clear(); mouse.down = false; endJoy(); } };
})();

// ------------------------------------------------------------
//  App flow
// ------------------------------------------------------------
const App = {
  startRun(ci) {
    AudioSys.init();
    Input.reset();
    UI.lastChar = ci;
    UI.clearOverlays();
    resetRun(ci, false);
    G.bot = false;
    G.state = 'playing';
    UI.showHud();
    AudioSys.setMode('game');
    AudioSys.setIntensity(1);
    AudioSys.muffle(false);
    setTimeout(() => { if (G.state === 'playing' && G.time < 5) UI.banner('坚持 10 分钟', 'boss'); }, 600);
  },
  toTitle() {
    Input.reset();
    UI.hideHud();
    UI.clearOverlays();
    setupDemo();
    G.state = 'title';
    UI.show('title');
    AudioSys.setMode('title');
    AudioSys.muffle(false);
  },
  pause() {
    if (G.state !== 'playing' || G.trans) return;
    G.state = 'paused';
    Input.reset();
    AudioSys.muffle(true, true);
    UI.showPause();
  },
  resume() {
    if (G.state !== 'paused') return;
    G.state = 'playing';
    AudioSys.muffle(false);
    UI.showHud();
  },
  applyQualitySetting() {
    const q = Settings.quality === 'auto' ? (G.autoQ.level || defaultQuality()) : Settings.quality;
    applyQuality(q);
  },
};

function defaultQuality() {
  const small = Math.min(window.innerWidth, window.innerHeight) < 600;
  const touch = matchMedia('(pointer: coarse)').matches;
  return small || touch ? 'medium' : 'high';
}

// ------------------------------------------------------------
//  Main loop
// ------------------------------------------------------------
let lastFrame = 0;
function loop(now) {
  requestAnimationFrame(loop);
  let dt = lastFrame ? (now - lastFrame) / 1000 : 1 / 60;
  lastFrame = now;
  if (dt > 0.25) dt = 1 / 60;
  const sdt = Math.min(dt, 1 / 30);
  try {
    AudioSys.tick();
    Input.pollPadButtons();
    frameUpdate(sdt);
  } catch (e) { reportError(e); }
  try {
    renderFrame();
    UI.hud(dt);
  } catch (e) { reportError(e); }
}
let errorsShown = 0;
function reportError(e) {
  if (errorsShown++ < 5) console.error(e);
}

function boot() {
  const canvas = document.getElementById('gl');
  try {
    Renderer.init(canvas);
  } catch (e) {
    console.error(e);
    document.getElementById('glError').hidden = false;
    for (const s of document.querySelectorAll('.screen')) s.hidden = true;
    return;
  }
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    const er = document.getElementById('glError');
    er.querySelector('p').textContent = '图形上下文已丢失（可能是显卡驱动重置）。请刷新页面继续。';
    er.hidden = false;
  });
  App.applyQualitySetting();
  UI.init();
  Input.init(canvas);
  setupDemo();
  G.state = 'title';
  UI.show('title');

  const unlock = () => {
    AudioSys.init();
    if (AudioSys.ready && AudioSys.mode === 'silent') AudioSys.setMode(G.state === 'title' ? 'title' : 'game');
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);

  window.addEventListener('resize', () => Renderer.resize());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { App.pause(); AudioSys.suspend(); }
    else AudioSys.resume();
  });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { try { Renderer.buildFont(); } catch (e) { /* keep fallback glyphs */ } });
  }
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------
//  Test / balancing hooks
// ------------------------------------------------------------
window.__NR = {
  G, P, S, EN, PK, PR, PT, App, Renderer, AudioSys,
  // run the real simulation without rendering, auto-picking upgrades
  fastForward(seconds, opts) {
    opts = opts || {};
    const dt = 1 / 60;
    const log = [];
    const t0 = performance.now();
    G.bot = opts.bot !== false;
    const god = !!opts.god;
    for (let s = 0; s < seconds * 60; s++) {
      if (P.dead) break;
      if (god) P.hp = P.maxHp;
      simulate(dt);
      Cam.x = P.x; Cam.y = P.y;
      if (G.pendingLevels > 0 && !hasUpgradesLeft()) absorbMaxedLevels();
      while (G.pendingLevels > 0) {
        const cs = rollChoices();
        const pairOwned = (c) => c.kind === 'passive' && EVOLVES_FROM[c.id] && hasWeapon(EVOLVES_FROM[c.id]);
        const pref = cs.find((c) => c.kind === 'weapon' && getWeapon(c.id)) || cs.find(pairOwned) || cs.find((c) => c.kind === 'weapon') || cs[0];
        applyChoice(pref);
        G.pendingLevels--;
      }
      while (G.pendingChests > 0) { chestRoll(); G.pendingChests--; }
      if (G.victoryT > 0) { G.victoryT -= dt; if (G.victoryT <= 0) { log.push({ victory: true, t: G.time }); break; } }
      if (s % (opts.every || 1800) === 0) {
        log.push({ t: Math.round(G.time), lv: P.level, hp: Math.round(P.hp), en: EN.count, kills: G.kills, pt: PT.n, pr: PR.n,
          ws: P.weapons.map((w) => w.id + (w.evolved ? '*' : w.level)).join(' '), boss: G.bosses.map((b) => b.key + ':' + Math.round(EN.hp[b.i])).join(',') });
      }
    }
    G.bot = false;
    const taken = {};
    for (const k in G.dmgTaken) taken[k] = Math.round(G.dmgTaken[k]);
    return { log, dead: P.dead, t: Math.round(G.time), lv: P.level, kills: G.kills, taken, ms: Math.round(performance.now() - t0) };
  },
  give(id, lv, evo) {
    let w = getWeapon(id);
    if (!w) w = giveWeapon(id);
    while (w.level < (lv || MAX_WEAPON_LEVEL)) levelWeapon(w);
    if (evo) { if (!getPassive(WEAPONS[id].pair)) givePassive(WEAPONS[id].pair); evolveWeapon(w); }
    UI.refreshSlots();
    return w;
  },
  setTime(t) { G.time = t; },
};

const hot = window.claude && window.claude.hot;
if (hot && typeof hot.snapshot === 'function') {
  try { hot.snapshot(() => ({ settings: Object.assign({}, Settings) })); } catch (e) { /* optional */ }
}
if (hot && typeof hot.ready === 'function') hot.ready(() => boot());
else boot();
