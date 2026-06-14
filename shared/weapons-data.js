// Shared weapons data — V2 ARSENAL-ÖVERSYN 2026-06-14.
// 42 vapen → 16 ikoniska SPELARVAPEN (perk + tydlig svaghet var) + 3 special-vapen
// (turret_mg/turret_rocket/gulag_knock — mode-givna, ej i shop). Designspec:
// se minnet penetrator_v2_weapon_redesign. CC bor ENBART i granaterna, ej i vapnen.
//
// Server är auktoritativ för skada → detta är källan. V2 (data/weapons.json + shop +
// NetLocalPlayer.WEAPONS) speglar samma id:n/stats. game.js (V1) är DÖTT — rör ej.
//
// NYA FLAGGOR (vissa inerta tills klient/server wirar dem i senare fas):
//   moveSpeedMul  — spelarens fart medan vapnet bärs (kniv/katana/tung-MG)
//   pierce        — skott/hugg går genom mål (katana-cleave, AWP, ...)
//   dualWield     — dubbel-vapen (visuell + eld-känsla)
//   burstCount/burstDelay/ammoCost — burst-eld (karbin)
//   pellets       — hagel-spridning
//   spinUp        — {startRate,rampMs}: eldhast. rampar från startRate→rate (tung MG)
//   recoilRamp    — spridning växer vid ihållande eld (AK)
//   zoom          — kamera-utzoom medan buren (AWP: 1.2 = ser ~20% mer)
//   burn          — DoT-stackar vid träff (eldkastare)
//   burningGround — lämnar brinnande mark/väggar några sek (eldkastare)
//   explosive     — AoE-explosion vid träff (granatgevär/raket)
'use strict';

const WEAPONS = [
  // ── OBEVÄPNAD (sentinel — EJ i shop). 'fists' används som "inget vapen"-tillstånd
  //    i hela servern (heist-intimidate, default-state, melee-demote). MÅSTE finnas.
  { id: 'fists',   type: 'melee', dmg: 8,   rate: 380, range: 36, color: '#dab27a' },

  // ── MELEE (2) — båda ger rörelse; ingen distans = svagheten ───────────────
  { id: 'knife',   type: 'melee', dmg: 26,  rate: 200, range: 40, color: '#bcc8d0', moveSpeedMul: 1.25 },
  { id: 'katana',  type: 'melee', dmg: 60,  rate: 330, range: 56, color: '#e6e6f0', moveSpeedMul: 1.10, pierce: true },

  // ── PISTOLER (2) ───────────────────────────────────────────────────────────
  // pistol: START, rent/pålitligt — noll spridning + snabb omladdning; låg DPS.
  { id: 'pistol',     type: 'gun', dmg: 24, rate: 300, speed: 820, mag: 14, reload: 900,  spread: 0.0,  color: '#ffd14a' },
  // dualpistol: run-and-gun spray; hög spridning + slukar ammo.
  { id: 'dualpistol', type: 'gun', dmg: 18, rate: 150, speed: 780, mag: 24, reload: 1400, spread: 0.11, color: '#ffae3a', dualWield: true },

  // ── HAGEL (2) ──────────────────────────────────────────────────────────────
  // shotgun: PUMP — stoppkraft nära; långsam pumpning + kort räckvidd.
  { id: 'shotgun',     type: 'gun', dmg: 16, rate: 760, speed: 760, mag: 6,  reload: 2000, spread: 0.28, pellets: 8, color: '#ff6b3d' },
  // autoshotgun: full-auto hagel; extrem spridning + äter ammo.
  { id: 'autoshotgun', type: 'gun', dmg: 11, rate: 300, speed: 720, mag: 10, reload: 2200, spread: 0.36, pellets: 6, color: '#ff8a3d' },

  // ── SMG (2) ────────────────────────────────────────────────────────────────
  // smg: MINI UZI — eldstorm + rörlig; låg skada/kula, kort räckvidd.
  { id: 'smg',     type: 'gun', dmg: 13, rate: 80,  speed: 720, mag: 28, reload: 1300, spread: 0.09, color: '#88ccff' },
  // dualuzi: max närstrids-DPS; usel träffbild, töms snabbt, lång omladdning.
  { id: 'dualuzi', type: 'gun', dmg: 11, rate: 55,  speed: 700, mag: 40, reload: 2000, spread: 0.17, color: '#aaccff', dualWield: true },

  // ── GEVÄR (3) ──────────────────────────────────────────────────────────────
  // ak: AK47 — tunghand (hög skada/skott); kraftig rekyl-ramp + lägre eldhast.
  { id: 'ak',     type: 'gun', dmg: 30, rate: 135, speed: 850, mag: 30, reload: 1900, spread: 0.045, color: '#caa46a', recoilRamp: 0.10 },
  // rifle: AUTOMATKARBIN — kontroll (tight 3-burst, hög precision); lägre topp-DPS.
  { id: 'rifle',  type: 'gun', dmg: 22, rate: 110, speed: 900, mag: 24, reload: 1400, spread: 0.025, color: '#5fd95f', burstCount: 3, burstDelay: 60, ammoCost: 3 },
  // sniper: AWP — örnöga (utzoom medan buren) + one-shot + pierce; långsam, 1 mag, värdelös nära.
  { id: 'sniper', type: 'gun', dmg: 200, rate: 1400, speed: 1800, mag: 1, reload: 2200, spread: 0.0, pierce: true, color: '#bb88ff', zoom: 1.32 },

  // ── TUNGA / SUSTAINED (3) ──────────────────────────────────────────────────
  // minigun: TUNG KULSPRUTA — undertryckning (enorm mag); spin-up + saktar dig (immobil).
  { id: 'minigun', type: 'gun', dmg: 18, rate: 45, speed: 900, mag: 120, reload: 4000, spread: 0.13, color: '#3cf0ff', spinUp: { startRate: 140, rampMs: 1200 }, moveSpeedMul: 0.7 },
  // lmg: LÄTT KULSPRUTA — rörlig eldkraft (stor mag, ingen spin-up); lägre DPS, lång omladdning.
  { id: 'lmg',     type: 'gun', dmg: 20, rate: 90, speed: 880, mag: 60,  reload: 2600, spread: 0.08, color: '#7ad0ff' },
  // flame: ELDKASTARE — brännmark (lång räckvidd, DoT, brinnande mark); låg direktskada, slukar bränsle.
  { id: 'flame',   type: 'gun', dmg: 10, rate: 45, speed: 680, mag: 100, reload: 2200, spread: 0.12, color: '#ff7a2a', burn: 7, burningGround: true },

  // ── EXPLOSIVT (2) ──────────────────────────────────────────────────────────
  // grenade: GRANATGEVÄR — lobb (bågskott, studsar, AoE); restid/båge, låg eldhast.
  { id: 'grenade', type: 'gun', dmg: 60,  rate: 700,  speed: 600, mag: 4, reload: 2400, spread: 0.03, explosive: 90,  color: '#9aff5a' },
  // rocket: RAKETGEVÄR — spränghuvud (störst AoE, raksikte); mkt lång omladdning, 1 raket.
  { id: 'rocket',  type: 'gun', dmg: 130, rate: 1500, speed: 560, mag: 1, reload: 3200, spread: 0.02, explosive: 140, color: '#ff3c3c' },

  // ── SPECIAL (mode-givna, EJ i shop/loot/gungame) ───────────────────────────
  // turret_mg: CTF-tornets MG (mountat). Hög DPS, ingen reload, immobil tradeoff.
  { id: 'turret_mg',  type: 'gun', dmg: 11, rate: 75, speed: 1100, mag: 9999, reload: 0, spread: 0.07, color: '#ff5a3a' },
  // turret_rocket: Siege-tornens raket. Långsam, hög dmg + AoE.
  { id: 'turret_rocket', type: 'gun', dmg: 70, rate: 1700, speed: 700, mag: 9999, reload: 0, spread: 0.0, color: '#ff8a3a', explosive: 80 },
  // gulag_knock: Gulag-knockback-kanon (The Void). 0 dmg, knuffar (bullets.js BR-hook).
  { id: 'gulag_knock', type: 'gun', dmg: 0, rate: 300, speed: 920, mag: 9999, reload: 0, spread: 0.03, color: '#5ac7ff', gulagKnock: true },
];

const W_BY_ID = Object.fromEntries(WEAPONS.map(w => [w.id, w]));

// De 16 spelarvapnen i kanonisk ordning (shop/gungame/loot/UI bygger på denna).
// Special-vapnen ingår INTE.
const PLAYER_WEAPON_IDS = [
  'knife', 'katana', 'pistol', 'dualpistol', 'shotgun', 'autoshotgun',
  'smg', 'dualuzi', 'ak', 'rifle', 'sniper', 'minigun', 'lmg', 'flame',
  'grenade', 'rocket',
];

module.exports = { WEAPONS, W_BY_ID, PLAYER_WEAPON_IDS };
