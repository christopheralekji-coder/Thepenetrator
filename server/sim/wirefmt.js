// Binär wire-format — MÅSTE matcha game.js's encodeWorldBinary/decodeWorldBinary.
// Vid varje protokoll-bump (WP_MAGIC) måste båda filer uppdateras synkroniserat.
'use strict';

const WP_MAGIC = 0xA3;
const WP_FLAG_FULL = 1 << 0;
const WP_FLAG_PICKUPS = 1 << 1;
const WP_FLAG_GS = 1 << 2;
const WP_FLAG_DB = 1 << 3;
const WP_FLAG_TRUCK = 1 << 4;
const WP_ENUM_STRING = 0xFF;

const WP_WEAPON_ENUM = [
  'fists', 'knuckles', 'tonfa', 'bat', 'knife', 'machete', 'katana',
  'pistol', 'revolver', 'shotgun', 'smg', 'rifle', 'sniper', 'grenade', 'rocket', 'minigun',
  'axe', 'sledge', 'spear', 'whip', 'lightsaber',
  'shuriken', 'throwknife', 'crossbow', 'bow',
  'flame', 'plasma', 'tesla', 'frost', 'sonic',
  'boxgloves', 'sickle', 'mace', 'glaive', 'energysword',
  'burstpistol', 'railgun', 'blackhole',
  'boomerang', 'drone', 'timestop', 'pullwhip',
  'repair',
];
const WP_WEAPON_TO_IDX = new Map(WP_WEAPON_ENUM.map((w, i) => [w, i]));
const WP_ENEMY_TYPE_ENUM = [
  'grunt', 'runner', 'brute', 'shooter', 'ninja', 'swordsman', 'soldier', 'robot', 'dog',
  'healer', 'summoner', 'boss', 'minion',
];
const WP_ENEMY_TYPE_TO_IDX = new Map(WP_ENEMY_TYPE_ENUM.map((t, i) => [t, i]));
const WP_BULLET_COLOR_ENUM = [
  '#ff5a5a', '#ffd14a', '#ffae3a', '#ff6b3d', '#88ccff', '#5fd95f', '#bb88ff', '#9aff5a',
  '#ff3c3c', '#3cf0ff', '#cccccc', '#3acaff', '#ff7a2a', '#9af2ff', '#ff5ac4', '#ffffff',
  '#aa3aff', '#ffeb3b', '#aaaacc', '#7a5a3a', '#3a8a3a', '#ff8a3a', '#dab27a', '#fff',
];
const WP_BULLET_COLOR_TO_IDX = new Map(WP_BULLET_COLOR_ENUM.map((c, i) => [c, i]));

function clampI16(v) { v = Math.round(v); return v > 32767 ? 32767 : (v < -32768 ? -32768 : v); }
function clampU16(v) { v = Math.round(v); return v > 65535 ? 65535 : (v < 0 ? 0 : v); }
function clampU8(v) { v = Math.round(v); return v > 255 ? 255 : (v < 0 ? 0 : v); }

const _scratchBuf = new ArrayBuffer(32 * 1024);
const _scratchView = new DataView(_scratchBuf);
const _scratchU8 = new Uint8Array(_scratchBuf);

function encodeWorldBinary(pkt) {
  const view = _scratchView;
  const u8 = _scratchU8;
  let o = 0;
  view.setUint8(o++, WP_MAGIC);
  let flags = 0;
  if (pkt.full) flags |= WP_FLAG_FULL;
  if (pkt.pickups) flags |= WP_FLAG_PICKUPS;
  if (pkt.gs) flags |= WP_FLAG_GS;
  if (pkt.db) flags |= WP_FLAG_DB;
  if (pkt.tk) flags |= WP_FLAG_TRUCK;
  view.setUint8(o++, flags);
  view.setUint16(o, (pkt.seq || 0) & 0xFFFF, true); o += 2;

  const writeStr = (s) => {
    const bytes = Buffer.from(s == null ? '' : String(s), 'utf8');
    const len = Math.min(255, bytes.length);
    view.setUint8(o++, len);
    u8.set(bytes.subarray(0, len), o); o += len;
  };
  const writeWeapon = (s) => {
    const idx = WP_WEAPON_TO_IDX.get(s);
    if (idx !== undefined && idx < WP_ENUM_STRING) view.setUint8(o++, idx);
    else { view.setUint8(o++, WP_ENUM_STRING); writeStr(s); }
  };
  const writeEnemyType = (s) => {
    const idx = WP_ENEMY_TYPE_TO_IDX.get(s);
    if (idx !== undefined && idx < WP_ENUM_STRING) view.setUint8(o++, idx);
    else { view.setUint8(o++, WP_ENUM_STRING); writeStr(s); }
  };
  const writeBulletColor = (s) => {
    const idx = WP_BULLET_COLOR_TO_IDX.get(s);
    if (idx !== undefined && idx < WP_ENUM_STRING) view.setUint8(o++, idx);
    else { view.setUint8(o++, WP_ENUM_STRING); writeStr(s); }
  };

  const players = pkt.players || [];
  view.setUint8(o++, Math.min(255, players.length));
  for (const p of players) {
    view.setUint8(o++, clampU8(p.c));
    view.setInt16(o, clampI16(p.x), true); o += 2;
    view.setInt16(o, clampI16(p.y), true); o += 2;
    view.setUint16(o, clampU16(p.hp), true); o += 2;
    view.setInt16(o, Math.round((p.a || 0) * 1000), true); o += 2;
    writeWeapon(p.w);
    view.setUint8(o++, clampU8(p.rT));
  }

  const enemies = pkt.enemies || [];
  view.setUint16(o, enemies.length, true); o += 2;
  const fullMode = !!pkt.full;
  for (const e of enemies) {
    view.setInt16(o, clampI16(e.i), true); o += 2;
    view.setInt16(o, clampI16(e.x), true); o += 2;
    view.setInt16(o, clampI16(e.y), true); o += 2;
    view.setUint16(o, clampU16(e.hp), true); o += 2;
    if (fullMode) {
      view.setUint16(o, clampU16(e.mh || 0), true); o += 2;
      writeEnemyType(e.t);
      view.setUint8(o++, ((e.b ? 1 : 0) | ((e.mb ? 1 : 0) << 1)));
      writeStr(e.bk);
      view.setUint8(o++, clampU8(e.r || 0));
      writeStr(e.c);
      writeStr(e.n);
      view.setUint8(o++, clampU8(e.p || 0));
    }
  }

  const hb = pkt.hb || [];
  view.setUint16(o, hb.length, true); o += 2;
  for (const b of hb) {
    view.setInt16(o, clampI16(b.x), true); o += 2;
    view.setInt16(o, clampI16(b.y), true); o += 2;
    view.setInt16(o, clampI16(b.vx), true); o += 2;
    view.setInt16(o, clampI16(b.vy), true); o += 2;
    writeBulletColor(b.c);
    view.setUint8(o++, clampU8(b.r || 0));
  }

  if (flags & WP_FLAG_PICKUPS) {
    const pks = pkt.pickups || [];
    view.setUint8(o++, Math.min(255, pks.length));
    for (const p of pks) {
      view.setInt16(o, clampI16(p.x), true); o += 2;
      view.setInt16(o, clampI16(p.y), true); o += 2;
      writeStr(p.t);
    }
  }
  if (flags & WP_FLAG_GS) {
    const gs = pkt.gs;
    view.setUint8(o++, clampU8(gs.w || 0));
    writeStr(gs.cz);
    writeStr(gs.zs);
    view.setUint8(o++, clampU8(gs.bss || 0));
    view.setUint8(o++, gs.bd ? 1 : 0);
  }
  if (flags & WP_FLAG_DB) {
    const db = pkt.db;
    view.setInt16(o, clampI16(db.x || 0), true); o += 2;
    view.setInt16(o, clampI16(db.y || 0), true); o += 2;
    view.setUint8(o++, clampU8(db.reviveTimer || 0));
    writeStr(db.revivedBy);
    writeStr(db.color);
  }
  if (flags & WP_FLAG_TRUCK) {
    const t = pkt.tk;
    view.setInt16(o, clampI16(t.x), true); o += 2;
    view.setInt16(o, clampI16(t.y), true); o += 2;
    view.setUint16(o, clampU16(t.hp), true); o += 2;
    view.setUint16(o, clampU16(t.mh), true); o += 2;
    view.setInt16(o, Math.round((t.a || 0) * 1000), true); o += 2;
    view.setUint8(o++, t.al ? 1 : 0);
    const oc = t.oc || [];
    view.setUint8(o++, Math.min(255, oc.length));
    for (const id of oc) writeStr(id);
  }
  // Returnera Buffer-kopia så samma scratch kan återanvändas omedelbart för nästa peer
  return Buffer.from(u8.buffer, u8.byteOffset, o);
}

module.exports = { encodeWorldBinary, WP_MAGIC };
