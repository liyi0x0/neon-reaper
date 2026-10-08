'use strict';
// ============================================================
//  Procedural audio: adaptive synthwave soundtrack + SFX
//  Everything is synthesized with Web Audio – no samples.
// ============================================================
const BPM = 130;
const BEAT = 60 / BPM;
const STEP16 = BEAT / 4;

const CHORDS = {
  Am: { root: 45, pad: [57, 60, 64, 69] },
  F:  { root: 41, pad: [57, 60, 65, 69] },
  C:  { root: 48, pad: [55, 60, 64, 67] },
  G:  { root: 43, pad: [55, 59, 62, 67] },
  Dm: { root: 38, pad: [57, 62, 65, 69] },
  E:  { root: 40, pad: [56, 59, 64, 68] },
};
const PROG_MAIN = ['Am', 'F', 'C', 'G'];
const PROG_BOSS = ['Am', 'F', 'Dm', 'E'];

// [bar, step, midi, lengthInSteps]
const MELODY_MAIN = [
  [0, 0, 76, 4], [0, 4, 74, 2], [0, 6, 76, 2], [0, 8, 81, 6], [0, 14, 79, 2],
  [1, 0, 77, 4], [1, 4, 76, 2], [1, 6, 72, 2], [1, 8, 69, 6], [1, 14, 72, 2],
  [2, 0, 76, 4], [2, 4, 74, 2], [2, 6, 76, 2], [2, 8, 79, 4], [2, 12, 76, 2], [2, 14, 72, 2],
  [3, 0, 74, 6], [3, 6, 71, 2], [3, 8, 67, 4], [3, 12, 71, 2], [3, 14, 74, 2],
  [4, 0, 76, 4], [4, 4, 74, 2], [4, 6, 76, 2], [4, 8, 81, 4], [4, 12, 83, 2], [4, 14, 84, 2],
  [5, 0, 84, 4], [5, 4, 83, 2], [5, 6, 81, 2], [5, 8, 77, 6], [5, 14, 81, 2],
  [6, 0, 79, 4], [6, 4, 76, 2], [6, 6, 72, 2], [6, 8, 76, 4], [6, 12, 79, 4],
  [7, 0, 83, 6], [7, 6, 81, 2], [7, 8, 79, 4], [7, 12, 74, 4],
];
const MELODY_BOSS = [
  [0, 0, 69, 2], [0, 3, 69, 1], [0, 4, 72, 2], [0, 6, 69, 2], [0, 8, 76, 3], [0, 11, 74, 1], [0, 12, 72, 2], [0, 14, 71, 2],
  [1, 0, 72, 2], [1, 3, 72, 1], [1, 4, 77, 2], [1, 6, 72, 2], [1, 8, 81, 4], [1, 12, 79, 2], [1, 14, 77, 2],
  [2, 0, 74, 2], [2, 3, 74, 1], [2, 4, 77, 2], [2, 6, 74, 2], [2, 8, 81, 3], [2, 11, 79, 1], [2, 12, 77, 2], [2, 14, 76, 2],
  [3, 0, 76, 4], [3, 4, 80, 4], [3, 8, 83, 4], [3, 12, 88, 4],
];
const ARP_PATTERN = [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 4, 3];
const BASS_EIGHTH = [0, -1, 0, -1, 12, -1, 0, -1, 0, -1, 0, -1, 12, -1, 0, -1];
const BASS_ROLL = [0, 0, 12, 0, 0, 12, 0, 0, 0, 0, 12, 0, 0, 12, 0, 12];
const GEM_SCALE = [81, 84, 86, 88, 91, 93, 96, 98, 100, 103, 105];

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

function createAudioEngine(ctx) {
  // ---------------- graph ----------------
  const sr = ctx.sampleRate;
  function makeNoise(sec) {
    const len = Math.floor(sr * sec);
    const b = ctx.createBuffer(1, len, sr);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function makeIR(sec, decay) {
    const len = Math.floor(sr * sec);
    const b = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < sr * 0.01 ? i / (sr * 0.01) : 1);
      }
    }
    return b;
  }
  const noiseBuf = makeNoise(2.5);
  function gainNode(v, dest) { const g = ctx.createGain(); g.gain.value = v; if (dest) g.connect(dest); return g; }
  function bq(type, f, q) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q !== undefined) b.Q.value = q; return b; }
  function panner(p, dest) {
    if (ctx.createStereoPanner) { const s = ctx.createStereoPanner(); s.pan.value = clamp(p, -1, 1); if (dest) s.connect(dest); return s; }
    return gainNode(1, dest);
  }

  const master = gainNode(0.9, ctx.destination);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -13; comp.knee.value = 8; comp.ratio.value = 4;
  comp.attack.value = 0.004; comp.release.value = 0.22;
  comp.connect(master);

  const musicFilter = bq('lowpass', 20000, 0.8);
  musicFilter.connect(comp);
  const musicVol = gainNode(0.5, musicFilter);
  const musicMix = gainNode(1, musicVol);
  const duck = gainNode(1, musicMix);
  const drumBus = gainNode(0.85, musicMix);
  const bassBus = gainNode(0.85, duck);
  const padBus = gainNode(0.5, duck);
  const arpBus = gainNode(0.6, duck);
  const leadBus = gainNode(0.7, musicMix);

  const conv = ctx.createConvolver();
  conv.buffer = makeIR(2.8, 3.0);
  const revSend = gainNode(1);
  const revLP = bq('lowpass', 5200);
  revSend.connect(conv); conv.connect(revLP); revLP.connect(gainNode(0.34, musicMix));

  const dlySend = gainNode(1);
  const dL = ctx.createDelay(2), dR = ctx.createDelay(2);
  dL.delayTime.value = BEAT * 0.75; dR.delayTime.value = BEAT * 0.75;
  const dOut = gainNode(0.42, musicMix);
  const pL = panner(-0.75, dOut), pR = panner(0.75, dOut);
  const fbLP = bq('lowpass', 3000);
  const fb = gainNode(0.38);
  dlySend.connect(dL); dL.connect(pL); dL.connect(dR); dR.connect(pR);
  dR.connect(fbLP); fbLP.connect(fb); fb.connect(dL);

  const sfxVol = gainNode(0.7, comp);
  const sconv = ctx.createConvolver();
  sconv.buffer = makeIR(1.5, 3.5);
  const sfxRev = gainNode(1);
  sfxRev.connect(sconv); sconv.connect(gainNode(0.3, sfxVol));

  // ---------------- primitives ----------------
  function osc(type, f, t, dur, dest) {
    const o = ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(f, t);
    o.connect(dest); o.start(t); o.stop(t + dur);
    return o;
  }
  function noise(t, dur, dest) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.connect(dest);
    s.start(t, Math.random() * 1.8);
    s.stop(t + dur);
    return s;
  }
  function adsr(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  // ---------------- music instruments ----------------
  let lastKick = -10;
  const kickQueue = [];
  function kick(t, v) {
    const g = gainNode(0, drumBus);
    const o = osc('sine', 160, t, 0.6, g);
    o.frequency.exponentialRampToValueAtTime(52, t + 0.07);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.4);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + 0.003);
    g.gain.setTargetAtTime(0, t + 0.07, 0.1);
    const cg = gainNode(0, drumBus);
    const chp = bq('highpass', 2500);
    noise(t, 0.03, chp); chp.connect(cg);
    cg.gain.setValueAtTime(v * 0.28, t);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.018);
    // sidechain pump
    duck.gain.setValueAtTime(1, t);
    duck.gain.linearRampToValueAtTime(0.32, t + 0.012);
    duck.gain.setTargetAtTime(1, t + 0.012, 0.1);
    kickQueue.push(t);
  }
  function clap(t, v) {
    const bp = bq('bandpass', 1500, 0.8);
    const g = gainNode(0, drumBus);
    noise(t, 0.35, bp);
    bp.connect(g);
    g.connect(revSend);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v * 0.5, t + 0.001);
    g.gain.exponentialRampToValueAtTime(v * 0.08, t + 0.01);
    g.gain.setValueAtTime(v * 0.45, t + 0.011);
    g.gain.exponentialRampToValueAtTime(v * 0.08, t + 0.02);
    g.gain.setValueAtTime(v * 0.42, t + 0.021);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.24);
    const tg = gainNode(0, drumBus);
    const o = osc('triangle', 220, t, 0.16, tg);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.1);
    adsr(tg, t, 0.002, v * 0.32, 0.12);
  }
  function hat(t, v, open) {
    const g = gainNode(0, drumBus);
    const hp = bq('highpass', 7200);
    const pk = bq('peaking', 10500, 1.2); pk.gain.value = 6;
    noise(t, open ? 0.45 : 0.08, hp);
    hp.connect(pk); pk.connect(g);
    g.gain.setValueAtTime(v * 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + (open ? 0.32 : 0.045));
  }
  function crash(t, v) {
    const g = gainNode(0, drumBus);
    const hp = bq('highpass', 4200);
    noise(t, 2.2, hp); hp.connect(g); g.connect(revSend);
    g.gain.setValueAtTime(v * 0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.0);
  }
  function tom(t, v, f) {
    const g = gainNode(0, drumBus);
    const o = osc('sine', f * 1.6, t, 0.35, g);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
    adsr(g, t, 0.002, v * 0.5, 0.25);
  }
  function riser(t, dur, v) {
    const bp = bq('bandpass', 300, 2.5);
    const g = gainNode(0, musicMix);
    noise(t, dur + 0.05, bp); bp.connect(g); g.connect(revSend);
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(7000, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v * 0.25, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.04);
  }
  function bass(t, midi, dur, v, bright) {
    const f = mtof(midi);
    const lp = bq('lowpass', 200, 6);
    const g = gainNode(0, bassBus);
    lp.connect(g);
    const o1 = osc('sawtooth', f, t, dur + 0.05, lp); o1.detune.value = -7;
    const o2 = osc('sawtooth', f, t, dur + 0.05, lp); o2.detune.value = 7;
    const sg = gainNode(0, bassBus);
    osc('sine', f * 0.5, t, dur + 0.05, sg);
    lp.frequency.setValueAtTime(160, t);
    lp.frequency.linearRampToValueAtTime(380 + 1700 * bright, t + 0.012);
    lp.frequency.setTargetAtTime(230, t + 0.012, 0.07);
    const hold = Math.max(0.03, dur - 0.025);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v * 0.3, t + 0.006);
    g.gain.setValueAtTime(v * 0.3, t + hold);
    g.gain.linearRampToValueAtTime(0, t + dur);
    sg.gain.setValueAtTime(0, t);
    sg.gain.linearRampToValueAtTime(v * 0.42, t + 0.006);
    sg.gain.setValueAtTime(v * 0.42, t + hold);
    sg.gain.linearRampToValueAtTime(0, t + dur);
  }
  function pad(t, notes, dur, v) {
    const lp = bq('lowpass', 900, 0.9);
    const g = gainNode(0, padBus);
    lp.connect(g); g.connect(revSend);
    lp.frequency.setValueAtTime(650, t);
    lp.frequency.linearRampToValueAtTime(2000, t + dur * 0.55);
    lp.frequency.linearRampToValueAtTime(900, t + dur + 0.6);
    for (let i = 0; i < notes.length; i++) {
      const f = mtof(notes[i]);
      for (let k = -1; k <= 1; k += 2) {
        const pn = panner(k * (0.25 + 0.15 * i), lp);
        const o = osc('sawtooth', f, t, dur + 0.8, pn);
        o.detune.value = k * (9 + i * 2);
      }
    }
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v * 0.09, t + 0.18);
    g.gain.setValueAtTime(v * 0.09, t + dur - 0.05);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.7);
  }
  function pluck(t, midi, v, soft) {
    const f = mtof(midi);
    const lp = bq('lowpass', 4000, soft ? 1 : 4);
    const g = gainNode(0, arpBus);
    lp.connect(g); g.connect(dlySend); g.connect(revSend);
    osc(soft ? 'triangle' : 'square', f, t, 0.45, lp);
    if (!soft) osc('sawtooth', f * 2, t, 0.45, lp).detune.value = 5;
    lp.frequency.setValueAtTime(soft ? 3000 : 5200, t);
    lp.frequency.setTargetAtTime(soft ? 900 : 500, t, 0.045);
    adsr(g, t, 0.002, v * (soft ? 0.16 : 0.085), soft ? 0.38 : 0.22);
  }
  function lead(t, midi, dur, v, soft) {
    const f = mtof(midi);
    const lp = bq('lowpass', 2600, 2);
    const g = gainNode(0, leadBus);
    lp.connect(g); g.connect(dlySend); g.connect(revSend);
    const end = dur + 0.25;
    let o1, o2;
    if (soft) {
      o1 = osc('triangle', f, t, end, lp);
      o2 = osc('sine', f * 2, t, end, lp);
      o2.detune.value = 3;
    } else {
      o1 = osc('sawtooth', f, t, end, lp); o1.detune.value = -8;
      o2 = osc('sawtooth', f, t, end, lp); o2.detune.value = 8;
      const sq = gainNode(0.35, lp);
      osc('square', f * 0.5, t, end, sq);
    }
    const lfo = ctx.createOscillator(); lfo.frequency.value = 5.6;
    const lg = gainNode(0); lfo.connect(lg); lg.connect(o1.frequency); lg.connect(o2.frequency);
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(0, t + Math.min(0.18, dur * 0.5));
    lg.gain.linearRampToValueAtTime(f * 0.007, t + Math.min(0.45, dur));
    lfo.start(t); lfo.stop(t + end);
    lp.frequency.setValueAtTime(soft ? 2200 : 1400, t);
    lp.frequency.linearRampToValueAtTime(soft ? 3200 : 4200, t + 0.03);
    lp.frequency.setTargetAtTime(soft ? 2000 : 2600, t + 0.03, 0.2);
    const peak = v * (soft ? 0.15 : 0.11);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.012);
    g.gain.linearRampToValueAtTime(peak * 0.8, t + Math.max(0.03, dur));
    g.gain.linearRampToValueAtTime(0, t + dur + 0.18);
  }

  // ---------------- sequencer ----------------
  let mode = 'silent', pendingMode = null, intensity = 1;
  let playing = false, nextTime = 0, stepInBar = 0, bar = 0;

  function chordFor(b) {
    const prog = mode === 'boss' ? PROG_BOSS : PROG_MAIN;
    return CHORDS[prog[b % 4]];
  }
  function melodyAt(mel, barInPhrase, st) {
    for (let i = 0; i < mel.length; i++) {
      const n = mel[i];
      if (n[0] === barInPhrase && n[1] === st) return n;
    }
    return null;
  }

  function arrangement(b) {
    const A = { kick: 0, clap: 0, hat: 0, open: 0, bass: 0, roll: 0, pad: 1, arp: 0, lead: 0, leadSoft: 0, crash: 0, fill: 0, riser: 0, mel: MELODY_MAIN, octave: 0, toms: 0 };
    if (mode === 'title') {
      const c = b % 16;
      A.kick = c >= 4 ? 2 : 0; A.hat = c >= 4 ? 1 : 0; A.clap = c >= 8 ? 2 : 0;
      A.bass = 2; A.arp = 1; A.lead = c >= 8 ? 1 : 0; A.leadSoft = 1; A.crash = c === 8 ? 1 : 0;
      return A;
    }
    if (mode === 'boss') {
      const c = b % 16;
      A.kick = 1; A.clap = 1; A.hat = 2; A.open = 1; A.bass = 1; A.roll = 1; A.arp = 1;
      A.lead = c >= 4 ? 1 : 0; A.mel = MELODY_BOSS; A.octave = c >= 12 ? 12 : 0;
      A.crash = c % 8 === 0 ? 1 : 0; A.fill = c % 4 === 3 ? 1 : 0; A.toms = c % 8 === 7 ? 1 : 0;
      return A;
    }
    // game
    if (intensity <= 1) {
      A.kick = 1; A.hat = 1; A.bass = 1; A.arp = 0;
      A.crash = b % 8 === 0 && b > 0 ? 1 : 0;
      return A;
    }
    if (intensity === 2) {
      A.kick = 1; A.clap = 1; A.hat = 1; A.bass = 1; A.arp = 1;
      A.crash = b % 8 === 0 ? 1 : 0; A.fill = b % 8 === 7 ? 1 : 0;
      return A;
    }
    const c = b % 32;
    if (c < 24) {
      A.kick = 1; A.clap = 1; A.hat = c >= 8 ? 2 : 1; A.bass = 1; A.arp = 1;
      A.open = c >= 16 ? 1 : 0; A.roll = c >= 16 ? 1 : 0;
      A.lead = c >= 8 ? 1 : 0; A.octave = 0;
      A.crash = c % 8 === 0 ? 1 : 0; A.fill = c % 8 === 7 ? 1 : 0;
    } else if (c < 28) {
      A.kick = 0; A.clap = 0; A.hat = 0; A.bass = 2; A.arp = 1; A.lead = 1; A.leadSoft = 1;
      A.crash = c === 24 ? 1 : 0;
    } else {
      A.kick = c >= 30 ? 1 : 3; A.clap = 0; A.hat = 1; A.bass = 1; A.arp = 1;
      A.fill = c === 31 ? 2 : 1; A.riser = c === 28 ? 1 : 0;
    }
    return A;
  }

  let A = null;
  function playStep(t) {
    const st = stepInBar;
    if (st === 0) {
      if (pendingMode !== null) {
        mode = pendingMode; pendingMode = null; bar = 0;
      }
      A = arrangement(bar);
      if (mode !== 'silent') {
        const ch = chordFor(bar);
        if (A.pad) pad(t, ch.pad, STEP16 * 16, mode === 'title' ? 1.0 : 0.85);
        if (A.crash) crash(t, 1);
        if (A.riser) riser(t, STEP16 * 64, 1);
      }
    }
    if (mode === 'silent' || !A) { advance(); return; }
    const ch = chordFor(bar);
    // drums
    if (A.kick === 1 && st % 4 === 0) kick(t, 0.95);
    else if (A.kick === 2 && (st === 0 || st === 10)) kick(t, 0.8);
    else if (A.kick === 3 && st % 8 === 0) kick(t, 0.85);
    if (A.clap === 1 && (st === 4 || st === 12)) clap(t, 0.9);
    else if (A.clap === 2 && st === 8) clap(t, 0.75);
    if (A.hat === 1 && st % 4 === 2) hat(t, 0.9, A.open === 1);
    else if (A.hat === 2) {
      if (st % 4 === 2) hat(t, 1.0, A.open === 1);
      else hat(t, st % 2 === 0 ? 0.55 : 0.35, false);
    }
    if (A.fill === 1 && st >= 12) clap(t, 0.35 + (st - 12) * 0.12);
    if (A.fill === 2 && st >= 8) clap(t, 0.25 + (st - 8) * 0.08);
    if (A.toms && st >= 8 && st % 2 === 0) tom(t, 0.8, 90 + (14 - st) * 18);
    // bass
    if (A.bass === 1) {
      const pat = A.roll ? BASS_ROLL : BASS_EIGHTH;
      const n = pat[st];
      if (n >= 0) bass(t, ch.root + n, STEP16 * (A.roll ? 0.9 : 1.6), st % 4 === 0 ? 1 : 0.8, A.roll ? 0.55 : 0.4);
    } else if (A.bass === 2 && (st === 0 || st === 8)) {
      bass(t, ch.root, STEP16 * 7.5, 0.75, 0.12);
    }
    // arp
    if (A.arp) {
      const notes = ch.pad;
      const idx = ARP_PATTERN[st];
      const midi = (idx < notes.length ? notes[idx] : notes[idx - notes.length] + 12) + 12;
      if (mode === 'title') { if (st % 2 === 0) pluck(t, midi, 0.8, true); }
      else pluck(t, midi, st % 4 === 0 ? 1 : 0.7, false);
    }
    // lead
    if (A.lead) {
      const phraseLen = A.mel === MELODY_BOSS ? 4 : 8;
      const n = melodyAt(A.mel, bar % phraseLen, st);
      if (n) lead(t, n[2] + A.octave, n[3] * STEP16, 1, A.leadSoft === 1);
    }
    advance();
  }
  function advance() {
    stepInBar++;
    if (stepInBar >= 16) { stepInBar = 0; bar++; }
  }

  function scheduleUntil(tEnd) {
    if (!playing) return;
    while (nextTime < tEnd) {
      playStep(nextTime);
      nextTime += STEP16;
    }
  }

  function startMusic(at) {
    if (playing) return;
    playing = true;
    nextTime = Math.max(at, ctx.currentTime + 0.06);
    stepInBar = 0; bar = 0;
  }
  function setMode(m) {
    if (m === 'silent') { mode = 'silent'; pendingMode = null; A = null; return; }
    if (pendingMode === null && m === mode) return;
    pendingMode = m === mode ? null : m;
    // from silence, start on the very next step instead of waiting for a bar line
    if (mode === 'silent' && pendingMode !== null) stepInBar = 0;
  }
  function setIntensity(i) { intensity = i; }

  // Visual beat pulse: 1 right after a kick reaches the speakers, decays fast
  function beatPulse() {
    const lat = (ctx.outputLatency || ctx.baseLatency || 0);
    const now = ctx.currentTime - lat;
    while (kickQueue.length && kickQueue[0] <= now) lastKick = kickQueue.shift();
    return Math.exp(-(now - lastKick) * 7);
  }

  // ---------------- SFX ----------------
  let voices = 0;
  const last = Object.create(null);
  function gate(key, gap) {
    const now = ctx.currentTime;
    if (last[key] !== undefined && now - last[key] < gap) return false;
    last[key] = now;
    return true;
  }
  function voice(src) { voices++; src.onended = () => { voices--; }; }
  function out(pan, rev, lpFreq) {
    const g = gainNode(0);
    let tail = g;
    if (lpFreq) { tail = bq('lowpass', lpFreq); g.connect(tail); }
    tail.connect(panner(pan || 0, sfxVol));
    if (rev) tail.connect(gainNode(rev, sfxRev));
    return g;
  }
  const T = () => ctx.currentTime + 0.005;

  let gemIdx = 0, gemLast = 0;

  const sfx = {
    hit(pan) {
      if (voices > 46 || !gate('hit', 0.028)) return;
      const t = T();
      const g = out(pan * 0.6);
      const b = bq('bandpass', rand(1800, 3400), 1.4);
      voice(noise(t, 0.04, b)); b.connect(g);
      adsr(g, t, 0.001, 0.16, 0.03);
    },
    kill(pan, big) {
      if (voices > 46 || !gate('kill', big ? 0.05 : 0.032)) return;
      const t = T();
      const g = out(pan * 0.6);
      const f = rand(520, 780) * (big ? 0.5 : 1);
      const o = osc('triangle', f, t, 0.12, g);
      o.frequency.exponentialRampToValueAtTime(f * 0.22, t + 0.09);
      voice(o);
      adsr(g, t, 0.002, big ? 0.22 : 0.13, 0.09);
      const ng = out(pan * 0.6, 0, big ? 1800 : 3500);
      noise(t, 0.08, ng);
      adsr(ng, t, 0.001, big ? 0.2 : 0.08, 0.06);
    },
    gem() {
      if (voices > 50 || !gate('gem', 0.026)) return;
      const t = T();
      if (t - gemLast > 0.45) gemIdx = 0;
      gemLast = t;
      const m = GEM_SCALE[Math.min(gemIdx, GEM_SCALE.length - 1)];
      gemIdx++;
      const g = out(0, 0.15);
      voice(osc('sine', mtof(m), t, 0.16, g));
      const g2 = gainNode(0.25, g);
      osc('triangle', mtof(m + 12), t, 0.1, g2);
      adsr(g, t, 0.002, 0.075, 0.12);
    },
    levelup() {
      const t = T();
      const notes = [72, 76, 79, 83, 86, 88, 91, 95];
      notes.forEach((m, i) => {
        const tt = t + i * 0.045;
        const g = out((i / notes.length - 0.5) * 0.8, 0.4);
        osc('triangle', mtof(m), tt, 0.5, g);
        osc('sine', mtof(m + 12), tt, 0.4, gainNode(0.3, g));
        adsr(g, tt, 0.004, 0.12, 0.4);
      });
      const g = out(0, 0.5, 2400);
      [60, 64, 67, 71, 74].forEach((m) => {
        const o = osc('sawtooth', mtof(m), t + 0.3, 1.4, g); o.detune.value = rand(-8, 8);
      });
      g.gain.setValueAtTime(0, t + 0.3);
      g.gain.linearRampToValueAtTime(0.05, t + 0.45);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    },
    hurt() {
      if (!gate('hurt', 0.08)) return;
      const t = T();
      const g = out(0, 0, 1000);
      const o = osc('square', 150, t, 0.25, g);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.18);
      adsr(g, t, 0.002, 0.3, 0.2);
      const ng = out(0, 0, 1600);
      noise(t, 0.15, ng);
      adsr(ng, t, 0.001, 0.25, 0.12);
    },
    bolt(pan) {
      if (voices > 44 || !gate('bolt', 0.05)) return;
      const t = T();
      const g = out(pan * 0.5);
      const o = osc('triangle', 1300, t, 0.08, g);
      o.frequency.exponentialRampToValueAtTime(520, t + 0.06);
      voice(o);
      adsr(g, t, 0.001, 0.05, 0.06);
    },
    star(pan) {
      if (voices > 44 || !gate('star', 0.07)) return;
      const t = T();
      const g = out(pan * 0.5, 0.2);
      const o = osc('sine', rand(1900, 2400), t, 0.08, g);
      o.frequency.exponentialRampToValueAtTime(1300, t + 0.06);
      voice(o);
      adsr(g, t, 0.001, 0.035, 0.06);
    },
    lightning(pan) {
      if (voices > 46 || !gate('zap', 0.07)) return;
      const t = T();
      const g = out(pan * 0.6, 0.3);
      const b = bq('bandpass', 2600, 0.9);
      voice(noise(t, 0.25, b)); b.connect(g);
      g.gain.setValueAtTime(0.0001, t);
      for (let i = 0; i < 9; i++) g.gain.setValueAtTime(rand(0.04, 0.22) * (1 - i / 10), t + i * 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      const g2 = out(pan * 0.6);
      const o = osc('sawtooth', 1800, t, 0.14, g2);
      o.frequency.exponentialRampToValueAtTime(180, t + 0.12);
      adsr(g2, t, 0.001, 0.05, 0.12);
    },
    thunder(pan) {
      if (!gate('thunder', 0.12)) return;
      const t = T();
      const g = out(pan * 0.5, 0.5);
      const lp = bq('lowpass', 900);
      voice(noise(t, 0.9, lp)); lp.connect(g);
      lp.frequency.setValueAtTime(3000, t); lp.frequency.exponentialRampToValueAtTime(200, t + 0.7);
      adsr(g, t, 0.003, 0.4, 0.8);
      sfx.lightning(pan);
    },
    laser(dur) {
      if (!gate('laser', 0.12)) return;
      const t = T();
      dur = Math.min(dur, 1.4);
      const g = out(0, 0.2);
      const lp = bq('lowpass', 600, 6); lp.connect(g);
      const o1 = osc('sawtooth', 110, t, dur + 0.1, lp); voice(o1);
      osc('sawtooth', 165.5, t, dur + 0.1, lp);
      lp.frequency.setValueAtTime(300, t);
      lp.frequency.exponentialRampToValueAtTime(3200, t + 0.05);
      lp.frequency.exponentialRampToValueAtTime(900, t + dur);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.09, t + 0.02);
      g.gain.setValueAtTime(0.07, t + dur);
      g.gain.linearRampToValueAtTime(0, t + dur + 0.08);
      const g2 = out(0);
      const o = osc('square', 1700, t, 0.16, g2);
      o.frequency.exponentialRampToValueAtTime(260, t + 0.14);
      adsr(g2, t, 0.001, 0.04, 0.14);
    },
    nova(big) {
      if (!gate('nova', 0.1)) return;
      const t = T();
      const g = out(0, 0.35);
      const b = bq('bandpass', 300, 1.2); b.connect(g);
      voice(noise(t, 0.5, b));
      b.frequency.setValueAtTime(220, t); b.frequency.exponentialRampToValueAtTime(big ? 4200 : 2800, t + 0.32);
      adsr(g, t, 0.01, big ? 0.38 : 0.26, 0.35);
      const g2 = out(0);
      const o = osc('sine', 150, t, 0.35, g2);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.3);
      adsr(g2, t, 0.002, big ? 0.5 : 0.32, 0.28);
    },
    missile(pan) {
      if (voices > 44 || !gate('missile', 0.07)) return;
      const t = T();
      const g = out(pan * 0.5);
      const b = bq('bandpass', 1100, 1.5); b.connect(g);
      voice(noise(t, 0.18, b));
      b.frequency.setValueAtTime(600, t); b.frequency.exponentialRampToValueAtTime(2400, t + 0.15);
      adsr(g, t, 0.005, 0.1, 0.14);
    },
    boom(pan, size) {
      if (voices > 46 || !gate('boom', 0.05)) return;
      const t = T();
      size = clamp(size || 1, 0.3, 2.5);
      const g = out(pan * 0.6, 0.25);
      const lp = bq('lowpass', 2400); lp.connect(g);
      voice(noise(t, 0.7, lp));
      lp.frequency.setValueAtTime(2600, t); lp.frequency.exponentialRampToValueAtTime(140, t + 0.5);
      adsr(g, t, 0.002, 0.22 * size, 0.55);
      const g2 = out(pan * 0.4);
      const o = osc('sine', 95, t, 0.45, g2);
      o.frequency.exponentialRampToValueAtTime(32, t + 0.38);
      adsr(g2, t, 0.002, 0.32 * size, 0.38);
    },
    slash(pan) {
      if (!gate('slash', 0.06)) return;
      const t = T();
      const g = out(pan * 0.5, 0.15);
      const b = bq('bandpass', 1000, 1.6); b.connect(g);
      voice(noise(t, 0.2, b));
      b.frequency.setValueAtTime(900, t); b.frequency.exponentialRampToValueAtTime(6500, t + 0.12);
      adsr(g, t, 0.008, 0.26, 0.13);
      const g2 = out(pan * 0.5);
      osc('triangle', 2400, t, 0.1, g2).frequency.exponentialRampToValueAtTime(3600, t + 0.08);
      adsr(g2, t, 0.002, 0.03, 0.08);
    },
    freeze() {
      if (!gate('freeze', 0.3)) return;
      const t = T();
      for (let i = 0; i < 7; i++) {
        const tt = t + i * 0.03;
        const g = out(rand(-0.6, 0.6), 0.4);
        osc('sine', rand(2600, 5200), tt, 0.12, g);
        adsr(g, tt, 0.002, 0.05, 0.1);
      }
      const g = out(0, 0.4);
      const hp = bq('highpass', 4000); hp.connect(g);
      voice(noise(t, 0.5, hp));
      adsr(g, t, 0.02, 0.12, 0.45);
    },
    hole() {
      if (!gate('hole', 0.2)) return;
      const t = T();
      const g = out(0, 0.4);
      const o = osc('sine', 70, t, 1.2, g);
      voice(o);
      const lfo = ctx.createOscillator(); lfo.frequency.value = 9;
      const lg = gainNode(25); lfo.connect(lg); lg.connect(o.frequency);
      lfo.start(t); lfo.stop(t + 1.2);
      o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(45, t + 1.0);
      adsr(g, t, 0.05, 0.3, 1.0);
    },
    implode(pan) {
      if (!gate('implode', 0.12)) return;
      const t = T();
      const g = out(pan * 0.5, 0.4);
      const b = bq('bandpass', 400, 1); b.connect(g);
      voice(noise(t, 0.45, b));
      b.frequency.setValueAtTime(4000, t); b.frequency.exponentialRampToValueAtTime(150, t + 0.25);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.2);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
      sfx.boom(pan, 1.2);
    },
    disc(pan) {
      if (voices > 44 || !gate('disc', 0.08)) return;
      const t = T();
      const g = out(pan * 0.5);
      const o = osc('triangle', 1500, t, 0.12, g);
      o.frequency.exponentialRampToValueAtTime(2600, t + 0.08);
      voice(o);
      adsr(g, t, 0.002, 0.05, 0.1);
    },
    tink(pan) {
      if (voices > 46 || !gate('tink', 0.045)) return;
      const t = T();
      const g = out(pan * 0.6, 0.2);
      voice(osc('sine', rand(2600, 3400), t, 0.09, g));
      adsr(g, t, 0.001, 0.06, 0.08);
    },
    orbit() {
      if (!gate('orbit', 0.4)) return;
      const t = T();
      const g = out(0, 0.3);
      const b = bq('bandpass', 600, 2); b.connect(g);
      voice(noise(t, 0.45, b));
      b.frequency.setValueAtTime(400, t); b.frequency.exponentialRampToValueAtTime(2600, t + 0.35);
      adsr(g, t, 0.05, 0.14, 0.35);
    },
    enemyShot(pan) {
      if (voices > 44 || !gate('eshot', 0.09)) return;
      const t = T();
      const g = out(pan * 0.6, 0, 1400);
      const o = osc('square', 420, t, 0.1, g);
      o.frequency.exponentialRampToValueAtTime(220, t + 0.08);
      voice(o);
      adsr(g, t, 0.001, 0.045, 0.08);
    },
    chest() {
      const t = T();
      const notes = [69, 72, 76, 81, 84, 88, 93];
      notes.forEach((m, i) => {
        const tt = t + i * 0.07;
        const g = out((i % 2 ? 0.4 : -0.4), 0.5);
        osc('triangle', mtof(m + 12), tt, 0.6, g);
        adsr(g, tt, 0.003, 0.09, 0.5);
      });
      const g = out(0, 0.5, 2600);
      [69, 73, 76, 81].forEach((m) => { osc('sawtooth', mtof(m), t + 0.5, 1.6, g).detune.value = rand(-10, 10); });
      g.gain.setValueAtTime(0, t + 0.5);
      g.gain.linearRampToValueAtTime(0.06, t + 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.0);
    },
    evolve() {
      const t = T();
      const r = bq('bandpass', 300, 2);
      const g = out(0, 0.5); r.connect(g);
      noise(t, 1.0, r);
      r.frequency.setValueAtTime(300, t); r.frequency.exponentialRampToValueAtTime(8000, t + 0.9);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.9); g.gain.linearRampToValueAtTime(0, t + 0.95);
      const g2 = out(0, 0.6, 3000);
      [57, 64, 69, 73, 76, 81].forEach((m) => { osc('sawtooth', mtof(m), t + 0.9, 2.4, g2).detune.value = rand(-12, 12); });
      g2.gain.setValueAtTime(0, t + 0.9);
      g2.gain.linearRampToValueAtTime(0.09, t + 0.95);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
      sfx.boom(0, 1.6);
    },
    bossWarn() {
      const t = T();
      for (let i = 0; i < 4; i++) {
        const tt = t + i * 0.42;
        const g = out(0, 0.3);
        const lp = bq('lowpass', 1800); lp.connect(g);
        osc('sawtooth', i % 2 ? 330 : 440, tt, 0.4, lp).detune.value = -6;
        osc('sawtooth', i % 2 ? 330 : 440, tt, 0.4, lp).detune.value = 6;
        g.gain.setValueAtTime(0, tt);
        g.gain.linearRampToValueAtTime(0.09, tt + 0.03);
        g.gain.setValueAtTime(0.09, tt + 0.34);
        g.gain.linearRampToValueAtTime(0, tt + 0.4);
      }
      const g = out(0, 0.5);
      const o = osc('sine', 60, t, 2.0, g);
      o.frequency.exponentialRampToValueAtTime(30, t + 1.8);
      adsr(g, t, 0.01, 0.5, 1.8);
    },
    bossDie() {
      const t = T();
      sfx.boom(0, 2.5);
      const g = out(0, 0.7);
      const lp = bq('lowpass', 3000); lp.connect(g);
      noise(t, 2.5, lp);
      lp.frequency.setValueAtTime(5000, t); lp.frequency.exponentialRampToValueAtTime(100, t + 2.2);
      adsr(g, t, 0.01, 0.45, 2.3);
    },
    magnet() {
      const t = T();
      const g = out(0, 0.4);
      const o = osc('sine', 220, t, 0.8, g);
      o.frequency.exponentialRampToValueAtTime(1760, t + 0.7);
      const o2 = osc('triangle', 330, t, 0.8, gainNode(0.4, g));
      o2.frequency.exponentialRampToValueAtTime(2640, t + 0.7);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + 0.5); g.gain.linearRampToValueAtTime(0, t + 0.78);
    },
    bomb() {
      const t = T();
      sfx.boom(0, 2.5);
      const g = out(0, 0.6);
      const hp = bq('highpass', 800); hp.connect(g);
      noise(t, 1.6, hp);
      adsr(g, t, 0.003, 0.3, 1.4);
    },
    heal() {
      const t = T();
      [76, 81, 88].forEach((m, i) => {
        const tt = t + i * 0.07;
        const g = out(0, 0.3);
        osc('sine', mtof(m), tt, 0.3, g);
        adsr(g, tt, 0.003, 0.1, 0.25);
      });
    },
    uiHover() {
      if (!gate('uih', 0.04)) return;
      const t = T();
      const g = out(0);
      osc('sine', 1900, t, 0.05, g);
      adsr(g, t, 0.001, 0.025, 0.04);
    },
    uiClick() {
      const t = T();
      const g = out(0, 0.2);
      const o = osc('triangle', 900, t, 0.1, g);
      o.frequency.exponentialRampToValueAtTime(1800, t + 0.06);
      adsr(g, t, 0.001, 0.08, 0.09);
    },
    gameOver() {
      const t = T();
      [69, 64, 60, 57, 52].forEach((m, i) => {
        const tt = t + i * 0.32;
        const g = out(0, 0.6);
        const lp = bq('lowpass', 1500); lp.connect(g);
        osc('sawtooth', mtof(m), tt, 1.2, lp).detune.value = -7;
        osc('sawtooth', mtof(m), tt, 1.2, lp).detune.value = 7;
        adsr(g, tt, 0.02, 0.07, 1.1);
      });
    },
    victory() {
      const t = T();
      const seq = [[60, 0], [64, 0.12], [67, 0.24], [72, 0.36], [76, 0.6], [79, 0.72], [84, 0.84]];
      seq.forEach(([m, dt]) => {
        const g = out(0, 0.5);
        osc('triangle', mtof(m), t + dt, 0.9, g);
        osc('sawtooth', mtof(m), t + dt, 0.9, gainNode(0.25, g)).detune.value = 6;
        adsr(g, t + dt, 0.005, 0.1, 0.8);
      });
      const g = out(0, 0.7);
      const lp = bq('lowpass', 2800); lp.connect(g);
      [48, 60, 64, 67, 72, 76].forEach((m) => { osc('sawtooth', mtof(m), t + 1.1, 3, lp).detune.value = rand(-10, 10); });
      g.gain.setValueAtTime(0, t + 1.1);
      g.gain.linearRampToValueAtTime(0.08, t + 1.2);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 4.0);
      crash(t + 1.1, 1.2);
    },
  };

  // ---------------- mix controls ----------------
  function setVolumes(music, fx) {
    const t = ctx.currentTime;
    musicVol.gain.setTargetAtTime(0.5 * music * music, t, 0.05);
    sfxVol.gain.setTargetAtTime(0.75 * fx * fx, t, 0.05);
  }
  function muffle(on, strong) {
    const t = ctx.currentTime;
    musicFilter.frequency.cancelScheduledValues(t);
    musicFilter.frequency.setValueAtTime(musicFilter.frequency.value, t);
    musicFilter.frequency.exponentialRampToValueAtTime(on ? (strong ? 420 : 750) : 20000, t + (on ? 0.25 : 0.6));
  }

  return {
    ctx, sfx, scheduleUntil, startMusic, setMode, setIntensity, beatPulse, setVolumes, muffle,
    get mode() { return pendingMode !== null ? pendingMode : mode; },
    get voices() { return voices; },
  };
}

// ============================================================
//  Live audio facade used by the game
// ============================================================
const AudioSys = (() => {
  let ctx = null, eng = null;
  const noop = () => {};
  const silentSfx = new Proxy({}, { get: () => noop });

  function init() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      ctx = new AC({ latencyHint: 'interactive' });
    } catch (e) { ctx = null; return; }
    eng = createAudioEngine(ctx);
    eng.setVolumes(Settings.music, Settings.sfx);
    eng.startMusic(ctx.currentTime + 0.05);
    if (ctx.state === 'suspended') ctx.resume();
  }
  function tick() {
    if (!eng || ctx.state !== 'running') return;
    eng.scheduleUntil(ctx.currentTime + 0.22);
  }
  // keep the music scheduled even if rAF is throttled
  setInterval(tick, 50);

  return {
    init,
    tick,
    get ready() { return !!eng; },
    get sfx() { return eng ? eng.sfx : silentSfx; },
    silent: silentSfx,
    setMode(m) { if (eng) eng.setMode(m); },
    setIntensity(i) { if (eng) eng.setIntensity(i); },
    beatPulse() { return eng && ctx.state === 'running' ? eng.beatPulse() : 0; },
    setVolumes() { if (eng) eng.setVolumes(Settings.music, Settings.sfx); },
    muffle(on, strong) { if (eng) eng.muffle(on, strong); },
    suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); },
    resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); },
    get mode() { return eng ? eng.mode : 'silent'; },
  };
})();
