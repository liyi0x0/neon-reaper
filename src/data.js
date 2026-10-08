'use strict';
// ============================================================
//  Game data: enemies, weapons, passives, characters, waves
// ============================================================

// ai: 0 chase, 1 shooter, 2 splitter, 3 bomber, 10+ bosses
const ENEMY_TYPES = [
  { key: 'drone',    name: '飞梭', shape: SH.TRI,     col: [1.0, 0.16, 0.55], r: 13, hp: 9,    speed: 80,  dmg: 5,  xp: 1,   kb: 0.0,  ai: 0 },
  { key: 'swarmer',  name: '蜂群', shape: SH.DIAMOND, col: [1.0, 0.55, 0.10], r: 10, hp: 5,    speed: 128, dmg: 4,  xp: 1,   kb: 0.0,  ai: 0 },
  { key: 'brute',    name: '重甲', shape: SH.SQUARE,  col: [1.0, 0.20, 0.18], r: 22, hp: 70,   speed: 50,  dmg: 9,  xp: 4,   kb: 0.6,  ai: 0 },
  { key: 'spitter',  name: '射手', shape: SH.PENT,    col: [0.30, 1.0, 0.45], r: 15, hp: 24,   speed: 62,  dmg: 7,  xp: 3,   kb: 0.2,  ai: 1 },
  { key: 'splitter', name: '裂变体', shape: SH.CIRCLE, col: [0.66, 0.34, 1.0], r: 19, hp: 36,   speed: 64,  dmg: 8, xp: 2,   kb: 0.3,  ai: 2 },
  { key: 'mini',     name: '裂片', shape: SH.CIRCLE,  col: [0.82, 0.52, 1.0], r: 9,  hp: 8,    speed: 108, dmg: 4,  xp: 1,   kb: 0.0,  ai: 0 },
  { key: 'bomber',   name: '自爆者', shape: SH.STAR,   col: [1.0, 0.86, 0.18], r: 14, hp: 16,   speed: 96,  dmg: 0,  xp: 2,   kb: 0.1,  ai: 3 },
  { key: 'tank',     name: '巨盾', shape: SH.HEX,     col: [0.20, 0.95, 0.95], r: 30, hp: 260,  speed: 40,  dmg: 16, xp: 12,  kb: 0.85, ai: 0 },
  { key: 'colossus', name: '巨像', shape: SH.HEX,     col: [1.0, 0.28, 0.22], r: 66, hp: 2000, speed: 95,  dmg: 20, xp: 0,   kb: 0.97, ai: 10, boss: true },
  { key: 'queen',    name: '虫后', shape: SH.STAR,    col: [1.0, 0.70, 0.12], r: 58, hp: 3600, speed: 110, dmg: 20, xp: 0,   kb: 0.97, ai: 11, boss: true },
  { key: 'voideye',  name: '虚空之眼', shape: SH.OCT,  col: [0.72, 0.30, 1.0], r: 84, hp: 14000, speed: 85, dmg: 24, xp: 0,   kb: 1.0,  ai: 12, boss: true },
];
const ET = {};
ENEMY_TYPES.forEach((t, i) => { ET[t.key] = i; });

// spawn-weight tables by run time (seconds)
const WAVES = [
  [0,   { drone: 10 }],
  [55,  { drone: 7, swarmer: 3 }],
  [115, { drone: 5, swarmer: 3, brute: 1, spitter: 1 }],
  [180, { drone: 4, swarmer: 3, brute: 1, spitter: 1, splitter: 1 }],
  [240, { drone: 3, swarmer: 3, brute: 2, spitter: 1, splitter: 1, bomber: 1 }],
  [300, { drone: 3, swarmer: 2, brute: 2, spitter: 1, splitter: 2, bomber: 1 }],
  [360, { drone: 2, swarmer: 3, brute: 2, spitter: 2, splitter: 1, bomber: 2, tank: 1 }],
  [420, { drone: 2, swarmer: 2, brute: 3, spitter: 2, splitter: 2, bomber: 2, tank: 1 }],
  [480, { drone: 2, swarmer: 3, brute: 2, spitter: 2, splitter: 2, bomber: 2, tank: 2 }],
  [540, { drone: 2, swarmer: 2, brute: 3, spitter: 2, splitter: 2, bomber: 3, tank: 2 }],
];

const RUN_LENGTH = 600; // final boss at 10:00

const EVENTS = [
  { t: 38,  type: 'ring', enemy: 'drone', n: 34 },
  { t: 62,  type: 'elite', enemy: 'drone' },
  { t: 88,  type: 'stampede', enemy: 'swarmer', n: 46 },
  { t: 118, type: 'elite', enemy: 'brute' },
  { t: 150, type: 'boss', enemy: 'colossus' },
  { t: 196, type: 'ring', enemy: 'swarmer', n: 48 },
  { t: 214, type: 'elite', enemy: 'spitter' },
  { t: 242, type: 'bombers', n: 28 },
  { t: 270, type: 'elite', enemy: 'splitter' },
  { t: 300, type: 'boss', enemy: 'queen' },
  { t: 340, type: 'stampede', enemy: 'swarmer', n: 90 },
  { t: 362, type: 'elite', enemy: 'tank' },
  { t: 390, type: 'ring', enemy: 'brute', n: 36 },
  { t: 418, type: 'elite', enemy: 'bomber' },
  { t: 450, type: 'boss', enemy: 'colossus', plus: true },
  { t: 482, type: 'elite', enemy: 'tank' },
  { t: 508, type: 'ring', enemy: 'drone', n: 140 },
  { t: 535, type: 'stampede', enemy: 'swarmer', n: 120 },
  { t: 548, type: 'bombers', n: 46 },
  { t: 568, type: 'elite', enemy: 'brute' },
  { t: 600, type: 'boss', enemy: 'voideye', final: true },
];

// ------------------------------------------------------------
//  Icons (48x48 line art, colored via currentColor)
// ------------------------------------------------------------
const svg = (body, extra = '') =>
  `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;

const ICONS = {
  bolt: svg('<circle cx="31" cy="17" r="7" fill="currentColor" fill-opacity=".25"/><path d="M7 41 21 27M5 31l13-6M17 43l6-13"/>'),
  orbit: svg('<circle cx="24" cy="24" r="4" fill="currentColor"/><circle cx="24" cy="24" r="15" stroke-dasharray="3 5" stroke-width="2"/><path d="M24 4q6 4 0 9q-6-5 0-9zM41 33q-1 7-8 4q2-7 8-4zM7 33q6-3 8 4q-7 3-8-4z" fill="currentColor" fill-opacity=".3"/>'),
  lightning: svg('<path d="M28 3 13 26h10l-5 19 18-26H26l6-16z" fill="currentColor" fill-opacity=".25"/>'),
  laser: svg('<path d="M10 34 44 14" stroke-width="5" opacity=".35"/><path d="M10 34 44 14"/><circle cx="9" cy="35" r="5" fill="currentColor" fill-opacity=".3"/><path d="M4 22l4 4M18 44l-2-5"/>'),
  nova: svg('<circle cx="24" cy="24" r="4" fill="currentColor"/><circle cx="24" cy="24" r="11"/><circle cx="24" cy="24" r="19" stroke-dasharray="5 4"/>'),
  missile: svg('<path d="M36 6l6 6-17 17-6-6z" fill="currentColor" fill-opacity=".25"/><path d="M19 23l-6 1-4 5 6 0M25 29l-1 6-5 4 0-6M11 37l-5 5"/>'),
  slash: svg('<path d="M8 40C26 36 38 24 41 6c-1 17-11 31-33 34z" fill="currentColor" fill-opacity=".3"/><path d="M6 30C18 28 27 21 31 12" stroke-width="2" opacity=".6"/>'),
  aura: svg('<path d="M24 5v38M7.5 14.5l33 19M7.5 33.5l33-19M24 11l-4-4M24 11l4-4M24 37l-4 4M24 37l4 4"/><circle cx="24" cy="24" r="5" fill="currentColor" fill-opacity=".3"/>'),
  blackhole: svg('<circle cx="24" cy="24" r="6" fill="currentColor"/><path d="M24 12a12 12 0 0 1 12 12M36 24a12 12 0 0 1-12 12M24 36a12 12 0 0 1-12-12M12 24a12 12 0 0 1 12-12" stroke-dasharray="1 0"/><path d="M24 4c11 0 20 9 20 20M4 24C4 13 13 4 24 4" opacity=".5"/>'),
  disc: svg('<circle cx="29" cy="19" r="10" fill="currentColor" fill-opacity=".2"/><circle cx="29" cy="19" r="3" fill="currentColor"/><path d="M5 35l11-7M8 43l12-9"/>'),
  might: svg('<path d="M24 4l4 24-4 5-4-5z" fill="currentColor" fill-opacity=".3"/><path d="M14 30h20M24 33v11"/>'),
  cooldown: svg('<path d="M14 6h20M14 42h20M16 6c0 10 8 12 8 18s-8 8-8 18M32 6c0 10-8 12-8 18s8 8 8 18"/><path d="M19 38h10l-5-6z" fill="currentColor"/>'),
  area: svg('<rect x="17" y="17" width="14" height="14" rx="2" fill="currentColor" fill-opacity=".3"/><path d="M5 5l8 8M5 5h6M5 5v6M43 5l-8 8M43 5h-6M43 5v6M5 43l8-8M5 43h6M5 43v-6M43 43l-8-8M43 43h-6M43 43v-6"/>'),
  duration: svg('<circle cx="24" cy="25" r="17"/><path d="M24 14v11l7 5M19 4h10"/>'),
  amount: svg('<circle cx="11" cy="30" r="5" fill="currentColor" fill-opacity=".3"/><circle cx="24" cy="18" r="5" fill="currentColor" fill-opacity=".3"/><circle cx="37" cy="30" r="5" fill="currentColor" fill-opacity=".3"/><path d="M14 41h20" opacity=".5"/>'),
  speed: svg('<path d="M6 12l11 12-11 12M18 12l11 12-11 12M30 12l11 12-11 12"/>'),
  regen: svg('<path d="M24 41C11 32 6 25 6 17a9 9 0 0 1 18-3 9 9 0 0 1 18 3c0 8-5 15-18 24z" fill="currentColor" fill-opacity=".15"/><path d="M24 18v14M17 25h14"/>'),
  magnet: svg('<path d="M12 7v17a12 12 0 0 0 24 0V7h-8v17a4 4 0 0 1-8 0V7z" fill="currentColor" fill-opacity=".2"/><path d="M12 13h8M28 13h8"/>'),
  projspd: svg('<path d="M5 24h34M27 13l12 11-12 11"/><path d="M5 15h12M5 33h12" opacity=".5"/>'),
  armor: svg('<path d="M24 4l16 6v14c0 10-8 17-16 20-8-3-16-10-16-20V10z" fill="currentColor" fill-opacity=".2"/><path d="M24 13v22" opacity=".6"/>'),
  maxhp: svg('<path d="M24 41C10 31 5 24 5 16a9 9 0 0 1 19-4 9 9 0 0 1 19 4c0 8-5 15-19 25z" fill="currentColor" fill-opacity=".35"/>'),
  luck: svg('<path d="M24 4l4 16 16 4-16 4-4 16-4-16-16-4 16-4z" fill="currentColor" fill-opacity=".3"/>'),
  growth: svg('<path d="M24 5l12 13h-7v24H19V18h-7z" fill="currentColor" fill-opacity=".25"/>'),
  heal: svg('<path d="M24 8v32M8 24h32" stroke-width="6"/>'),
  gold: svg('<circle cx="24" cy="24" r="16" fill="currentColor" fill-opacity=".25"/><path d="M24 14v20M19 18h8a3 3 0 0 1 0 6h-6a3 3 0 0 0 0 6h8"/>'),
  skull: svg('<path d="M24 5C14 5 8 12 8 21c0 5 2 8 5 10v7h22v-7c3-2 5-5 5-10 0-9-6-16-16-16z" fill="currentColor" fill-opacity=".2"/><circle cx="17.5" cy="22" r="3.5" fill="currentColor"/><circle cx="30.5" cy="22" r="3.5" fill="currentColor"/><path d="M20 38v-4M28 38v-4M24 38v-4"/>'),
  pause: svg('<path d="M17 10v28M31 10v28" stroke-width="5"/>'),
  chest: svg('<path d="M6 20h36v20H6zM6 20l4-10h28l4 10" fill="currentColor" fill-opacity=".2"/><path d="M20 26h8v6h-8z" fill="currentColor"/>'),
};

// ------------------------------------------------------------
//  Weapons
//  base stats + per-level deltas (levels 2..8) + evolved stats
// ------------------------------------------------------------
const MAX_WEAPON_LEVEL = 8;
const MAX_WEAPONS = 6;
const MAX_PASSIVES = 6;

const WEAPONS = {
  bolt: {
    name: '能量飞弹', evo: '星辉风暴', pair: 'cooldown', css: '#5ff4ff', rgb: [0.3, 0.92, 1.0],
    desc: '向最近的敌人发射追踪能量弹。',
    evoDesc: '星辉化作不息的洪流，追猎并贯穿一切。',
    base: { dmg: 11, cd: 1.0, amount: 1, pierce: 0, speed: 470, area: 1, dur: 1.7 },
    lv: [{ amount: 1 }, { dmg: 5 }, { amount: 1 }, { pierce: 1 }, { amount: 1 }, { dmg: 6 }, { pierce: 1 }],
    evoStats: { dmg: 24, cd: 0.085, amount: 1, pierce: 2, speed: 720, area: 1.25, dur: 1.4 },
  },
  orbit: {
    name: '旋转刃', evo: '银河环', pair: 'area', css: '#d77dff', rgb: [0.82, 0.42, 1.0],
    desc: '光刃环绕自身旋转，切开靠近的敌人。',
    evoDesc: '双层星环永不停转，正反交错绞碎敌群。',
    base: { dmg: 12, cd: 3.0, amount: 2, area: 1, speed: 3.4, dur: 3.2, radius: 78, kb: 150 },
    lv: [{ amount: 1 }, { area: 0.15, dmg: 3 }, { amount: 1 }, { dur: 0.6, speedMul: 1.2 }, { amount: 1 }, { dmg: 6 }, { area: 0.2, amount: 1 }],
    evoStats: { dmg: 30, cd: 0, amount: 5, area: 1.45, speed: 4.2, dur: 999, radius: 86, kb: 200 },
  },
  lightning: {
    name: '连锁闪电', evo: '雷神之怒', pair: 'might', css: '#8fb4ff', rgb: [0.55, 0.7, 1.0],
    desc: '雷电劈中敌人并在敌群间跳跃。',
    evoDesc: '自天穹召下雷柱，每一击都炸开雷暴。',
    base: { dmg: 18, cd: 1.6, amount: 1, chains: 2, area: 1, range: 430 },
    lv: [{ chains: 1 }, { dmg: 6 }, { amount: 1 }, { chains: 1 }, { dmg: 8 }, { amount: 1 }, { chains: 2, dmg: 6 }],
    evoStats: { dmg: 42, cd: 0.9, amount: 4, chains: 6, area: 1.3, range: 520 },
  },
  laser: {
    name: '棱镜激光', evo: '棱镜阵列', pair: 'duration', css: '#ff5fd2', rgb: [1.0, 0.35, 0.85],
    desc: '朝敌人方向发射贯穿一切的光束。',
    evoDesc: '四道彩虹光束环绕旋转，扫荡整片战场。',
    base: { dmg: 9, cd: 2.6, amount: 1, dur: 0.55, area: 1, length: 700, width: 14, tick: 0.12 },
    lv: [{ dmg: 3 }, { area: 0.3 }, { amount: 1 }, { dur: 0.3 }, { dmg: 4 }, { amount: 1 }, { area: 0.3, dmg: 4 }],
    evoStats: { dmg: 15, cd: 0, amount: 4, dur: 999, area: 1.6, length: 580, width: 16, tick: 0.11 },
  },
  nova: {
    name: '脉冲新星', evo: '超新星', pair: 'armor', css: '#ffb347', rgb: [1.0, 0.68, 0.25],
    desc: '以自身为中心释放冲击波，震退周围敌人。',
    evoDesc: '连续引爆恒星之心，烈焰冲击席卷四方。',
    base: { dmg: 16, cd: 2.4, amount: 1, area: 1, radius: 165, kb: 380 },
    lv: [{ area: 0.15 }, { dmg: 6 }, { cdMul: 0.88 }, { area: 0.15 }, { dmg: 8 }, { amount: 1 }, { dmg: 10, area: 0.1 }],
    evoStats: { dmg: 48, cd: 1.5, amount: 2, area: 1.75, radius: 170, kb: 520 },
  },
  missile: {
    name: '追踪导弹', evo: '蜂巢弹幕', pair: 'amount', css: '#ff7a3d', rgb: [1.0, 0.48, 0.2],
    desc: '发射追踪导弹，命中后范围爆炸。',
    evoDesc: '倾泻铺天盖地的微型导弹群。',
    base: { dmg: 24, cd: 2.0, amount: 2, area: 1, speed: 330, blast: 58 },
    lv: [{ amount: 1 }, { dmg: 8 }, { area: 0.2 }, { amount: 1 }, { dmg: 10 }, { cdMul: 0.85 }, { amount: 2 }],
    evoStats: { dmg: 36, cd: 1.25, amount: 10, area: 1.25, speed: 400, blast: 58 },
  },
  slash: {
    name: '光刃斩', evo: '血月斩', pair: 'speed', css: '#ff4d6d', rgb: [1.0, 0.3, 0.42],
    desc: '向移动方向挥出弧形光刃。',
    evoDesc: '血色满月回旋斩，360° 无死角。',
    base: { dmg: 22, cd: 1.25, amount: 1, area: 1, range: 128, kb: 220 },
    lv: [{ amount: 1 }, { dmg: 7 }, { area: 0.15 }, { dmg: 8 }, { cdMul: 0.85 }, { area: 0.15 }, { dmg: 12 }],
    evoStats: { dmg: 58, cd: 0.62, amount: 2, area: 1.55, range: 128, kb: 280 },
  },
  aura: {
    name: '冰霜领域', evo: '绝对零度', pair: 'regen', css: '#8ff0ff', rgb: [0.55, 0.92, 1.0],
    desc: '寒气环绕周身，持续伤害并减速敌人。',
    evoDesc: '周期性冻结领域内一切，冰封者碎裂殆尽。',
    base: { dmg: 6, tick: 0.45, area: 1, radius: 82, slow: 0.3 },
    lv: [{ area: 0.15 }, { dmg: 3 }, { slow: 0.1 }, { area: 0.15 }, { dmg: 4 }, { tickMul: 0.8 }, { area: 0.2, dmg: 4 }],
    evoStats: { dmg: 16, tick: 0.3, area: 1.9, radius: 82, slow: 0.55, freeze: 3.0 },
  },
  blackhole: {
    name: '奇点', evo: '事件视界', pair: 'magnet', css: '#b07bff', rgb: [0.7, 0.45, 1.0],
    desc: '投掷奇点吞噬周围敌人，结束时坍缩爆炸。',
    evoDesc: '巨型视界吞噬一切，残血之敌瞬间湮灭。',
    base: { dmg: 7, cd: 6.0, amount: 1, dur: 2.6, area: 1, radius: 125, pull: 260 },
    lv: [{ area: 0.15 }, { dmg: 3 }, { dur: 0.5 }, { amount: 1 }, { dmg: 4 }, { area: 0.2 }, { cdMul: 0.8 }],
    evoStats: { dmg: 16, cd: 4.6, amount: 2, dur: 4.0, area: 1.7, radius: 125, pull: 520 },
  },
  disc: {
    name: '弹射飞盘', evo: '无限回旋', pair: 'projspd', css: '#c8ff5a', rgb: [0.75, 1.0, 0.3],
    desc: '飞盘在敌人之间来回弹射。',
    evoDesc: '永不停歇的飞盘，每次弹射都炸开冲击。',
    base: { dmg: 15, cd: 1.7, amount: 1, bounces: 3, speed: 540, area: 1 },
    lv: [{ bounces: 1 }, { dmg: 5 }, { amount: 1 }, { bounces: 2 }, { speedMul: 1.2, dmg: 5 }, { amount: 1 }, { bounces: 3 }],
    evoStats: { dmg: 34, cd: 1.1, amount: 3, bounces: 24, speed: 780, area: 1.3 },
  },
};
const WEAPON_IDS = Object.keys(WEAPONS);

// ------------------------------------------------------------
//  Passives
// ------------------------------------------------------------
const PASSIVES = {
  might:    { name: '力量', max: 5, css: '#ff6b6b', desc: '所有伤害 +10%' },
  cooldown: { name: '急速', max: 5, css: '#5ff4ff', desc: '武器冷却 -8%' },
  area:     { name: '范围', max: 5, css: '#d77dff', desc: '攻击范围 +10%' },
  duration: { name: '持久', max: 5, css: '#ff5fd2', desc: '持续时间 +15%' },
  amount:   { name: '多重', max: 2, css: '#ff9a3d', desc: '投射物数量 +1' },
  speed:    { name: '疾风', max: 5, css: '#7dffb0', desc: '移动速度 +10%' },
  regen:    { name: '再生', max: 5, css: '#5dff8a', desc: '每秒回复 0.3 生命' },
  magnet:   { name: '磁力', max: 5, css: '#b07bff', desc: '拾取范围 +30%' },
  projspd:  { name: '弹速', max: 5, css: '#c8ff5a', desc: '投射物速度 +12%' },
  armor:    { name: '护甲', max: 5, css: '#ffb347', desc: '受到伤害 -1，击退 +10%' },
  maxhp:    { name: '生命', max: 5, css: '#ff4d6d', desc: '最大生命 +20%' },
  luck:     { name: '幸运', max: 5, css: '#ffd84a', desc: '暴击率 +6%，宝箱更丰厚' },
  growth:   { name: '成长', max: 5, css: '#8fe3ff', desc: '经验获取 +10%' },
};
const PASSIVE_IDS = Object.keys(PASSIVES);

// passive id -> weapon id it evolves
const EVOLVES_FROM = {};
for (const id of WEAPON_IDS) EVOLVES_FROM[WEAPONS[id].pair] = id;

// ------------------------------------------------------------
//  Characters
// ------------------------------------------------------------
const CHARACTERS = [
  { id: 'zero',  name: '零', title: '棱光射手', weapon: 'bolt',      rgb: [0.35, 0.95, 1.0], css: '#5ff4ff', bonus: { cooldown: 0.1 }, perk: '冷却 -10%' },
  { id: 'hi',    name: '绯', title: '断空剑姬', weapon: 'slash',     rgb: [1.0, 0.32, 0.45], css: '#ff4d6d', bonus: { maxhp: 30, armor: 1 }, perk: '生命 +30 · 护甲 +1' },
  { id: 'rai',   name: '雷', title: '雷霆术士', weapon: 'lightning', rgb: [0.6, 0.65, 1.0],  css: '#8fb4ff', bonus: { area: 0.15 }, perk: '范围 +15%' },
  { id: 'en',    name: '焰', title: '爆破专家', weapon: 'missile',   rgb: [1.0, 0.55, 0.22], css: '#ff7a3d', bonus: { might: 0.15 }, perk: '伤害 +15%' },
  { id: 'shimo', name: '霜', title: '永冻之心', weapon: 'aura',      rgb: [0.6, 0.92, 1.0],  css: '#8ff0ff', bonus: { regen: 0.5, maxhp: 20 }, perk: '再生 +0.5/秒 · 生命 +20' },
  { id: 'kan',   name: '环', title: '轮舞者',   weapon: 'orbit',     rgb: [0.85, 0.45, 1.0], css: '#d77dff', bonus: { speed: 0.12, magnet: 0.3 }, perk: '移速 +12% · 拾取 +30%' },
];

// ------------------------------------------------------------
//  Stat helpers
// ------------------------------------------------------------
const STAT_LABEL = {
  dmg: ['伤害', (v) => '+' + v],
  amount: ['数量', (v) => '+' + v],
  pierce: ['穿透', (v) => '+' + v],
  cdMul: ['冷却', (v) => '-' + Math.round((1 - v) * 100) + '%'],
  area: ['范围', (v) => '+' + Math.round(v * 100) + '%'],
  speedMul: ['速度', (v) => '+' + Math.round((v - 1) * 100) + '%'],
  dur: ['持续', (v) => '+' + v + '秒'],
  chains: ['连锁', (v) => '+' + v],
  bounces: ['弹射', (v) => '+' + v],
  slow: ['减速', (v) => '+' + Math.round(v * 100) + '%'],
  tickMul: ['频率', (v) => '+' + Math.round((1 / v - 1) * 100) + '%'],
};
function describeDelta(d) {
  return Object.keys(d).map((k) => STAT_LABEL[k][0] + ' ' + STAT_LABEL[k][1](d[k])).join('　');
}
function applyDelta(s, d) {
  for (const k in d) {
    if (k === 'cdMul') s.cd *= d[k];
    else if (k === 'speedMul') s.speed *= d[k];
    else if (k === 'tickMul') s.tick *= d[k];
    else s[k] = (s[k] || 0) + d[k];
  }
}
function weaponBaseStats(id, level, evolved) {
  const def = WEAPONS[id];
  if (evolved) return Object.assign({}, def.evoStats);
  const s = Object.assign({}, def.base);
  for (let i = 0; i < level - 1 && i < def.lv.length; i++) applyDelta(s, def.lv[i]);
  return s;
}

function xpForLevel(level) {
  if (level < 20) return 5 + (level - 1) * 6;
  if (level < 40) return 120 + (level - 20) * 14;
  return 400 + (level - 40) * 40;
}
