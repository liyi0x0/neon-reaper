'use strict';
// ============================================================
//  DOM UI: menus, HUD, level-up cards, chest, results
// ============================================================
const UI = (() => {
  const $ = (id) => document.getElementById(id);
  const scr = {};
  let current = 'title';
  let backTo = 'title';
  let choices = [];
  let armedAt = 0;
  let hudOn = false;
  let lastChar = 0;
  let bannerT = 0, warnT = 0, toastT = 0, comboPopT = 0;
  const hc = { lv: -1, time: -1, kills: -1, killsAt: 0, gold: -1, xp: -1, combo: -1, boss: -2, bossName: '', danger: null, fps: 0, fpsAcc: 0, fpsN: 0 };
  const best = Object.assign({ time: 0, kills: 0, level: 0, wins: 0 }, Store.get('neonreaper.best', {}));
  let el = {};

  function init() {
    for (const s of document.querySelectorAll('.screen')) scr[s.id.replace('scr-', '')] = s;
    el = {
      xpFill: $('xpFill'), lvNum: $('lvNum'), time: $('time'), kills: $('kills'), gold: $('gold'),
      boss: $('boss'), bossName: $('bossName'), bossFill: $('bossFill'), combo: $('combo'), comboNum: $('comboNum'),
      fps: $('fps'), hud: $('hud'),
    };
    $('btnPause').innerHTML = ICONS.pause;
    $('killIco').innerHTML = ICONS.skull;
    $('chestBox').innerHTML = ICONS.chest;
    buildChars();
    buildCodex();
    bindSettings();
    document.addEventListener('click', onAction);
    document.addEventListener('pointerover', (e) => {
      const t = e.target.closest && e.target.closest('.btn, .card, .char, .seg button');
      if (t && !t.contains(e.relatedTarget)) AudioSys.sfx.uiHover();
    });
    $('btnReroll').addEventListener('click', reroll);
    $('btnChest').addEventListener('click', closeChestUI);
    $('btnPause').addEventListener('click', () => App.pause());
    renderRecord();
  }

  // ---------------- navigation ----------------
  function show(name) {
    for (const k in scr) scr[k].hidden = k !== name;
    current = name;
    if (name && scr[name]) {
      const f = scr[name].querySelector('.btn-primary, .char, .btn');
      if (f && name !== 'levelup' && name !== 'chest') requestAnimationFrame(() => f.focus({ preventScroll: true }));
    }
  }
  function openSub(name) { backTo = current; show(name); }
  function back() {
    if (current === 'settings' || current === 'codex') { show(backTo); if (backTo === 'pause') showPause(); return; }
    if (current === 'chars') show('title');
  }
  function showHud() {
    show(null);
    hudOn = true;
    el.hud.hidden = false;
    hc.boss = -2; hc.time = -1; hc.lv = -1; hc.xp = -1; hc.gold = -1; hc.kills = -1;
    refreshSlots();
  }
  function hideHud() { hudOn = false; el.hud.hidden = true; }

  function onAction(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    AudioSys.init();
    AudioSys.sfx.uiClick();
    switch (act) {
      case 'play': show('chars'); focusChar(); break;
      case 'codex': openSub('codex'); break;
      case 'settings': openSub('settings'); syncSettings(); break;
      case 'back': back(); break;
      case 'resume': App.resume(); break;
      case 'restart': App.startRun(lastChar); break;
      case 'quit': App.toTitle(); break;
      case 'again': App.startRun(lastChar); break;
      case 'endless': startEndless(); break;
      case 'title': App.toTitle(); break;
    }
  }
  function focusChar() {
    const c = $('charGrid').children[lastChar];
    if (c) requestAnimationFrame(() => c.focus({ preventScroll: true }));
  }

  // ---------------- keyboard for menus ----------------
  function onKey(e) {
    const k = e.key;
    if (current === 'levelup') {
      if (k >= '1' && k <= '4') { pick(+k - 1); e.preventDefault(); return true; }
      if (k === 'r' || k === 'R') { reroll(); return true; }
    } else if (current === 'chest') {
      if (k === 'Enter' || k === ' ') { closeChestUI(); e.preventDefault(); return true; }
    } else if (current === 'chars') {
      if (k >= '1' && k <= '6') { startChar(+k - 1); return true; }
      if (k === 'Escape') { back(); return true; }
    } else if (current === 'settings' || current === 'codex') {
      if (k === 'Escape') { back(); return true; }
    } else if (current === 'title') {
      if (k === 'Enter' && document.activeElement === document.body) { show('chars'); focusChar(); return true; }
    }
    return false;
  }

  // ---------------- characters ----------------
  function buildChars() {
    const g = $('charGrid');
    CHARACTERS.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'char';
      b.style.setProperty('--c', c.css);
      b.style.setProperty('--i', i);
      const w = WEAPONS[c.weapon];
      b.innerHTML = `<div class="char-emblem"><span>${c.name}</span></div>
        <div class="char-info"><h3>${c.name}<small>${c.title}</small></h3>
        <p class="char-weapon"><i>${ICONS[c.weapon]}</i>${w.name}</p>
        <p class="char-perk">${c.perk}</p></div>`;
      b.addEventListener('click', () => startChar(i));
      g.appendChild(b);
    });
  }
  function startChar(i) {
    lastChar = i;
    AudioSys.init();
    AudioSys.sfx.uiClick();
    App.startRun(i);
  }

  // ---------------- codex ----------------
  function buildCodex() {
    let html = '<p class="cx-sep">武器 · 进化路线</p>';
    for (const id of WEAPON_IDS) {
      const d = WEAPONS[id], p = PASSIVES[d.pair];
      html += `<div class="cx" style="--c:${d.css}"><div class="ico">${ICONS[id]}</div><h3>${d.name}</h3><p>${d.desc}</p>
        <p class="evo">满级 +「${p.name}」→ <b>${d.evo}</b>　${d.evoDesc}</p></div>`;
    }
    html += '<p class="cx-sep">被动强化</p>';
    for (const id of PASSIVE_IDS) {
      const d = PASSIVES[id];
      const ev = EVOLVES_FROM[id];
      html += `<div class="cx" style="--c:${d.css}"><div class="ico">${ICONS[id]}</div><h3>${d.name}</h3><p>${d.desc} · 最高 ${d.max} 级</p>
        ${ev ? `<p class="evo">进化「${WEAPONS[ev].name}」</p>` : ''}</div>`;
    }
    $('codexGrid').innerHTML = html;
  }

  // ---------------- settings ----------------
  function bindSettings() {
    const m = $('setMusic'), s = $('setSfx');
    m.addEventListener('input', () => { Settings.music = +m.value; AudioSys.setVolumes(); saveSettings(); syncSettings(); });
    s.addEventListener('input', () => { Settings.sfx = +s.value; AudioSys.setVolumes(); saveSettings(); syncSettings(); });
    s.addEventListener('change', () => AudioSys.sfx.gem());
    $('setShake').addEventListener('change', (e) => { Settings.shake = e.target.checked; saveSettings(); });
    $('setDmg').addEventListener('change', (e) => { Settings.damageNumbers = e.target.checked; saveSettings(); });
    $('setFps').addEventListener('change', (e) => { Settings.showFps = e.target.checked; el.fps.hidden = !Settings.showFps; saveSettings(); });
    for (const b of $('setQuality').querySelectorAll('button')) {
      b.addEventListener('click', () => { Settings.quality = b.dataset.q; saveSettings(); App.applyQualitySetting(); syncSettings(); });
    }
    syncSettings();
  }
  function syncSettings() {
    const m = $('setMusic'), s = $('setSfx');
    m.value = Settings.music; s.value = Settings.sfx;
    m.style.setProperty('--v', Settings.music * 100 + '%');
    s.style.setProperty('--v', Settings.sfx * 100 + '%');
    $('outMusic').textContent = Math.round(Settings.music * 100);
    $('outSfx').textContent = Math.round(Settings.sfx * 100);
    $('setShake').checked = Settings.shake;
    $('setDmg').checked = Settings.damageNumbers;
    $('setFps').checked = Settings.showFps;
    el.fps.hidden = !Settings.showFps;
    for (const b of $('setQuality').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.q === Settings.quality));
  }

  // ---------------- level up ----------------
  function showLevelUp(list) {
    choices = list;
    $('luLevel').textContent = P.level - G.pendingLevels + 1;
    const wrap = $('cards');
    wrap.innerHTML = '';
    list.forEach((c, i) => {
      const d = describeChoice(c);
      const b = document.createElement('button');
      b.className = 'card' + (d.ready ? ' ready' : '');
      b.dataset.type = d.type;
      b.style.setProperty('--c', d.color);
      b.style.setProperty('--i', i);
      b.innerHTML = `<span class="card-key">${i + 1}</span><span class="card-badge">${d.badge}</span>
        <div class="card-icon">${d.icon}</div><h3 class="card-name">${d.name}</h3>
        <p class="card-lv">${d.lv}</p><p class="card-desc">${d.desc}</p><p class="card-hint">${d.hint}</p>`;
      b.addEventListener('click', () => pick(i));
      wrap.appendChild(b);
    });
    $('rerollN').textContent = G.rerolls;
    $('btnReroll').disabled = G.rerolls <= 0;
    show('levelup');
    armedAt = performance.now() + 380;
    setTimeout(() => { if (current === 'levelup' && wrap.firstChild) wrap.firstChild.focus({ preventScroll: true }); }, 400);
  }
  function pick(i) {
    if (performance.now() < armedAt || G.state !== 'levelup' || !choices[i]) return;
    AudioSys.sfx.uiClick();
    pickLevelChoice(choices[i]);
  }
  function reroll() {
    if (G.state !== 'levelup' || performance.now() < armedAt) return;
    const r = rerollChoices();
    if (r) { AudioSys.sfx.uiClick(); showLevelUp(r); }
  }

  // ---------------- chest ----------------
  function showChest(res) {
    const body = $('chestBody');
    const box = $('chestBox');
    body.innerHTML = '';
    box.classList.remove('open');
    show('chest');
    armedAt = performance.now() + 900;
    setTimeout(() => box.classList.add('open'), 520);
    if (res.evo) {
      const w = res.evo, d = w.def;
      body.innerHTML = `<p class="chest-title evo">武器进化</p>
        <div class="evo-row" style="--c:${d.css}"><div class="evo-icon">${ICONS[w.id]}</div><span class="evo-arrow">▶</span><div class="evo-icon after">${ICONS[w.id]}</div></div>
        <p class="evo-name" style="--c:${d.css}">${d.name} → ${d.evo}</p>
        <p class="evo-desc">${d.evoDesc}</p>
        <p class="chest-gold">+${res.gold} 星币</p>`;
      setTimeout(() => AudioSys.sfx.evolve(), 450);
    } else {
      let html = `<p class="chest-title">${res.items.length >= 5 ? '超级宝箱！' : res.items.length >= 3 ? '丰厚宝箱！' : '宝箱'}</p><div class="chest-items">`;
      res.items.forEach((d, i) => {
        html += `<div class="chest-item" style="--c:${d.color};--i:${i}"><div class="ci-icon">${d.icon}</div><div class="ci-text"><b>${d.name} <small>${d.lv}</small></b><small>${d.desc}</small></div></div>`;
      });
      if (!res.items.length) html += '<p class="evo-desc">所有装备均已满级</p>';
      html += `</div><p class="chest-gold">+${res.gold} 星币</p>`;
      body.innerHTML = html;
    }
    setTimeout(() => { if (current === 'chest') $('btnChest').focus({ preventScroll: true }); }, 900);
  }
  function closeChestUI() {
    if (current !== 'chest' || performance.now() < armedAt) return;
    AudioSys.sfx.uiClick();
    closeChest();
  }

  // ---------------- pause ----------------
  function showPause() {
    $('pauseTime').textContent = fmtTime(G.time) + ' · LV ' + P.level;
    let html = '<h3>武器</h3><div class="build-list">';
    for (const w of P.weapons) {
      const d = w.def;
      const dps = w.dmgDone / Math.max(1, G.time - w.since);
      html += `<div class="build-row" style="--c:${d.css}"><div class="ico">${ICONS[w.id]}</div>
        <div class="nm"><b>${w.evolved ? d.evo : d.name}</b><small>${w.evolved ? '已进化' : 'Lv ' + w.level + (w.level >= MAX_WEAPON_LEVEL ? ' · 满级' : '')} · 秒伤 ${fmtBig(dps)}</small></div>
        <div class="val">${fmtBig(w.dmgDone)}</div></div>`;
    }
    html += '</div><h3>被动</h3><div class="build-list">';
    if (!P.passives.length) html += '<p class="build-empty">尚未获得被动强化</p>';
    for (const p of P.passives) {
      const d = PASSIVES[p.id];
      html += `<div class="build-row" style="--c:${d.css}"><div class="ico">${ICONS[p.id]}</div><div class="nm"><b>${d.name}</b><small>${d.desc}</small></div><div class="val">Lv ${p.level}</div></div>`;
    }
    html += '</div><h3>进化路线</h3><div class="build-list">';
    for (const w of P.weapons) {
      const d = w.def, pp = PASSIVES[d.pair];
      const hasP = !!getPassive(d.pair);
      const status = w.evolved ? '✓ 已完成' : `${w.level >= MAX_WEAPON_LEVEL ? '✓' : '·'} 满级　${hasP ? '✓' : '·'} ${pp.name}`;
      html += `<p class="recipe">${d.name} + ${pp.name} → ${d.evo}　<span style="color:var(--dim)">${status}</span></p>`;
    }
    html += '</div>';
    $('build').innerHTML = html;
    show('pause');
  }

  // ---------------- results ----------------
  function showResults(victory) {
    hideHud();
    const s = scr.results;
    s.classList.toggle('victory', victory);
    s.classList.toggle('defeat', !victory);
    $('resEyebrow').textContent = victory ? 'VICTORY · 深渊已肃清' : 'GAME OVER · ' + (G.endless ? '无尽模式' : '再接再厉');
    $('resTitle').textContent = victory ? '收割完成' : '你已陨落';
    const recTime = G.time > best.time, recKills = G.kills > best.kills;
    const stats = [
      ['存活时间', fmtTime(G.time), recTime], ['等级', P.level, P.level > best.level], ['击杀', fmtNum(G.kills), recKills],
      ['最高连斩', fmtNum(G.bestCombo), false], ['BOSS 击破', G.bossKills, false], ['星币', fmtNum(G.gold), false],
    ];
    $('resStats').innerHTML = stats.map(([k, v, hl]) => `<div class="stat${hl ? ' hl' : ''}"><small>${k}${hl ? ' · 新纪录' : ''}</small><b>${v}</b></div>`).join('');
    const ws = P.weapons.slice().sort((a, b) => b.dmgDone - a.dmgDone);
    const top = Math.max(1, ws.length ? ws[0].dmgDone : 1);
    let t = '<thead><tr><th>武器</th><th>等级</th><th>伤害</th><th>秒伤</th></tr></thead><tbody>';
    for (const w of ws) {
      const d = w.def;
      const dps = w.dmgDone / Math.max(1, G.time - w.since);
      t += `<tr style="--c:${d.css}"><td><span class="wn"><i>${ICONS[w.id]}</i>${w.evolved ? d.evo : d.name}</span><div class="dmg-bar" style="width:${(w.dmgDone / top) * 100}%"></div></td>
        <td>${w.evolved ? 'EVO' : w.level}</td><td>${fmtNum(w.dmgDone)}</td><td>${fmtNum(dps)}</td></tr>`;
    }
    t += '</tbody>';
    $('resTable').innerHTML = t;
    best.time = Math.max(best.time, G.time);
    best.kills = Math.max(best.kills, G.kills);
    best.level = Math.max(best.level, P.level);
    if (victory) best.wins++;
    Store.set('neonreaper.best', best);
    $('resRecord').innerHTML = `历史最佳 · 存活 <b>${fmtTime(best.time)}</b> · 击杀 <b>${fmtNum(best.kills)}</b> · 最高 <b>LV ${best.level}</b>`;
    $('btnEndless').hidden = !victory;
    show('results');
    renderRecord();
  }
  function renderRecord() {
    const r = $('record');
    if (best.time > 0) {
      r.innerHTML = `最佳纪录 · 存活 <b>${fmtTime(best.time)}</b> · 击杀 <b>${fmtNum(best.kills)}</b>${best.wins ? ` · 通关 <b>${best.wins}</b> 次` : ''}`;
    } else r.textContent = '存活到第 10 分钟，击败虚空之眼即可通关';
  }

  // ---------------- HUD ----------------
  function refreshSlots() {
    let html = '';
    for (let k = 0; k < MAX_WEAPONS; k++) {
      const w = P.weapons[k];
      if (!w) { html += '<div class="slot empty"></div>'; continue; }
      const ready = !w.evolved && w.level >= MAX_WEAPON_LEVEL && getPassive(w.def.pair);
      html += `<div class="slot${w.evolved ? ' evo' : ''}${ready ? ' ready' : ''}" style="--c:${w.def.css}">${ICONS[w.id]}<i>${w.evolved ? '★' : w.level >= MAX_WEAPON_LEVEL ? 'M' : w.level}</i></div>`;
    }
    $('wSlots').innerHTML = html;
    html = '';
    for (let k = 0; k < MAX_PASSIVES; k++) {
      const p = P.passives[k];
      if (!p) { html += '<div class="slot empty"></div>'; continue; }
      const d = PASSIVES[p.id];
      html += `<div class="slot" style="--c:${d.css}">${ICONS[p.id]}<i>${p.level >= d.max ? 'M' : p.level}</i></div>`;
    }
    $('pSlots').innerHTML = html;
  }

  function hud(dt) {
    if (Settings.showFps) {
      hc.fpsAcc += dt; hc.fpsN++;
      if (hc.fpsAcc >= 0.5) {
        el.fps.textContent = `${Math.round(hc.fpsN / hc.fpsAcc)} FPS · ${EN.count} 敌 · ${PT.n} 粒子 · ${Renderer.count} 图元`;
        hc.fpsAcc = 0; hc.fpsN = 0;
      }
    }
    if (!hudOn) return;
    const xpf = P.xpNext > 0 ? Math.min(1, P.xp / P.xpNext) : 0;
    if (Math.abs(xpf - hc.xp) > 0.002) { hc.xp = xpf; el.xpFill.style.transform = `scaleX(${xpf.toFixed(4)})`; }
    if (P.level !== hc.lv) { hc.lv = P.level; el.lvNum.textContent = P.level; }
    const ts = Math.floor(G.time);
    if (ts !== hc.time) { hc.time = ts; el.time.textContent = fmtTime(ts); }
    const danger = G.bosses.length > 0;
    if (danger !== hc.danger) { hc.danger = danger; el.time.classList.toggle('danger', danger); }
    const now = performance.now();
    if (G.kills !== hc.kills && now - hc.killsAt > 90) { hc.kills = G.kills; hc.killsAt = now; el.kills.textContent = fmtNum(G.kills); }
    if (G.gold !== hc.gold) { hc.gold = G.gold; el.gold.textContent = fmtNum(G.gold); }
    if (G.bosses.length) {
      const b = G.bosses[0];
      const f = EN.alive[b.i] ? Math.max(0, EN.hp[b.i] / EN.maxHp[b.i]) : 0;
      if (hc.boss === -2 || hc.bossName !== b.name) {
        hc.bossName = b.name;
        el.bossName.textContent = (b.final ? '最终 · ' : '') + b.name;
        el.boss.hidden = false;
      }
      if (Math.abs(f - hc.boss) > 0.001) { hc.boss = f; el.bossFill.style.transform = `scaleX(${f.toFixed(4)})`; }
    } else if (hc.boss !== -2) { hc.boss = -2; hc.bossName = ''; el.boss.hidden = true; }
    const showCombo = G.combo >= 20;
    el.combo.classList.toggle('on', showCombo);
    if (showCombo && G.combo !== hc.combo) {
      hc.combo = G.combo;
      el.comboNum.textContent = fmtNum(G.combo);
      if (now - comboPopT > 140) {
        comboPopT = now;
        el.combo.classList.remove('pop');
        void el.combo.offsetWidth;
        el.combo.classList.add('pop');
      }
    }
  }

  // ---------------- banners ----------------
  function banner(text, kind) {
    if (G.demo) return;
    const b = $('banner');
    $('bannerText').textContent = text;
    b.className = 'banner' + (kind === 'boss' ? ' banner-alt' : '');
    b.hidden = false;
    void b.offsetWidth;
    b.classList.add('show');
    clearTimeout(bannerT);
    bannerT = setTimeout(() => { b.hidden = true; }, 2350);
  }
  function bossWarning(name, final) {
    if (G.demo) return;
    const w = $('warning');
    $('warnName').textContent = (final ? '最终 · ' : '') + name;
    w.hidden = false;
    w.classList.remove('show');
    void w.offsetWidth;
    w.classList.add('show');
    clearTimeout(warnT);
    warnT = setTimeout(() => { w.hidden = true; }, 2650);
  }
  function toast(text) {
    if (G.demo) return;
    const t = $('toast');
    t.textContent = text;
    t.hidden = false;
    t.classList.remove('show');
    void t.offsetWidth;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => { t.hidden = true; }, 1650);
  }
  function clearOverlays() {
    for (const id of ['banner', 'warning', 'toast']) $(id).hidden = true;
  }

  return {
    init, show, showHud, hideHud, onKey, showLevelUp, showChest, showPause, showResults,
    refreshSlots, hud, banner, bossWarning, toast, clearOverlays,
    get current() { return current; },
    get lastChar() { return lastChar; },
    set lastChar(v) { lastChar = v; },
  };
})();
