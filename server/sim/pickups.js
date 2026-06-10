// Phase 5: Pickups (HP/ammo/gold/temp_dmg) med multi-target magnet.
// Speglar updatePickups (game.js:974-1033) + spawnPickup (game.js:233-235).
// Server-side skickar 'pickup_to_partner'-event istället för Audio/HUD-anrop.
'use strict';

const PICKUP_LIFE = 25;
const MAGNET_RANGE = 110;
const COLLECT_RANGE = 24;  // (player.r 14 + 10)

function spawnPickup(sim, x, y, type) {
  if (!type) return;
  if (!sim.pickups) sim.pickups = [];
  sim.pickups.push({ x, y, type, life: PICKUP_LIFE, vx: 0, vy: 0, magnetized: false, dead: false });
}

// Drop-tabell vid enemy/boss death — speglar killEnemy (game.js:5147+) drops
// För enkelhet: enemy → 50% chans gold, 15% hp, 10% ammo, 5% temp_dmg
function dropFromEnemyDeath(sim, e) {
  const r = Math.random();
  if (e.isBoss) {
    // Bossar droppar mer
    spawnPickup(sim, e.x, e.y, 'gold');
    spawnPickup(sim, e.x + 30, e.y, 'gold');
    spawnPickup(sim, e.x - 30, e.y, 'hp');
    spawnPickup(sim, e.x, e.y + 30, 'ammo');
    if (Math.random() < 0.5) spawnPickup(sim, e.x, e.y - 30, 'temp_dmg');
    return;
  }
  if (e.isMiniBoss) {
    spawnPickup(sim, e.x, e.y, 'gold');
    spawnPickup(sim, e.x + 20, e.y, 'hp');
    if (Math.random() < 0.5) spawnPickup(sim, e.x - 20, e.y, 'ammo');
    return;
  }
  // Vanlig enemy
  if (r < 0.50) spawnPickup(sim, e.x, e.y, 'gold');
  else if (r < 0.65) spawnPickup(sim, e.x, e.y, 'hp');
  else if (r < 0.75) spawnPickup(sim, e.x, e.y, 'ammo');
  else if (r < 0.80) spawnPickup(sim, e.x, e.y, 'temp_dmg');
}

function updatePickups(sim, dt) {
  if (!sim.pickups || !sim.pickups.length) return;
  // Bygg lista av levande spelare med ws-ref för pickup_to_partner-events
  const players = [];
  for (const [pid, ws] of sim.room.members) {
    const ps = ws.playerState;
    if (!ps || ps.hp <= 0) continue;
    players.push({ peerId: pid, ws, x: ps.x, y: ps.y, r: 14 });
  }
  if (players.length === 0) {
    // Inga levande — bara minska life
    for (const pk of sim.pickups) pk.life -= dt;
    sim.pickups = sim.pickups.filter(pk => pk.life > 0);
    return;
  }
  for (const pk of sim.pickups) {
    pk.life -= dt;
    if (pk.life <= 0) { pk.dead = true; continue; }
    // Hitta närmsta spelare
    let nearest = null, nearestD2 = Infinity;
    for (const pl of players) {
      const dx = pl.x - pk.x, dy = pl.y - pk.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < nearestD2) { nearestD2 = d2; nearest = pl; }
    }
    if (!nearest) continue;
    const dx = nearest.x - pk.x, dy = nearest.y - pk.y;
    const d = Math.sqrt(nearestD2);
    // v2: magnet-mästare-perken = 3× magnet-räckvidd (per spelare)
    const psN = nearest.ws.playerState;
    const magRange = (psN && psN.perks && psN.perks.magnetism) ? MAGNET_RANGE * 3 : MAGNET_RANGE;
    if (d < magRange) pk.magnetized = true;
    if (pk.magnetized && d > 0) {
      const speed = Math.min(600, 200 + Math.max(0, 1 - d / magRange) * 300);
      pk.x += (dx / d) * speed * dt;
      pk.y += (dy / d) * speed * dt;
    }
    if (d < (nearest.r + 10)) {
      pk.dead = true;
      // Skicka pickup-event till spelaren — klient applicerar effekt lokalt (HP/ammo/gold)
      // (Server kan inte uppdatera klientens save, gold eller ammo direkt)
      const json = JSON.stringify({ type: 'pickup_to_you', kind: pk.type });
      try { nearest.ws.send(json); } catch (e) {}
      // För hp: server uppdaterar playerState.hp så enemy-AI och hazards ser den
      if (pk.type === 'hp') {
        const ps = nearest.ws.playerState;
        if (ps) ps.hp = Math.min(100, ps.hp + 30);
      }
    }
  }
  sim.pickups = sim.pickups.filter(p => !p.dead);
}

module.exports = { spawnPickup, dropFromEnemyDeath, updatePickups };
