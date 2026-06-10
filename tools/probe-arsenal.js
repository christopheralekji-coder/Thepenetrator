// Probe: mode-arsenal-validering (anti-cheat) i applyShoot.
//   A) GUNGAME: sim_shoot med 'rocket' (otillåtet) → clampas till tier-vapnet
//      (GUNGAME_WEAPONS[0] = throwknife); tier-vapnet själv passerar orört.
//   B) CTF: sim_shoot med 'railgun' (otillåtet) → clampas till pistol;
//      'rifle' (coop-arsenalen) passerar orört.
//   Verifiering via pvp_shot-eventets bullets (bs[].s = weapon-style) + att sim
//   inte kraschar (fler skott funkar efteråt).
//   node tools/probe-arsenal.js [ws://...]
const WebSocket = require(require('path').join(__dirname, '..', 'server', 'node_modules', 'ws'));
const URL = process.argv[2] || 'ws://localhost:8090';
const { GUNGAME_WEAPONS } = require(require('path').join(__dirname, '..', 'shared', 'gungame-arena'));

function runMode(startMsg, shots, label) {
  // shots: [{ send: weaponId, expect: style }]
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const seen = [];      // styles från pvp_shot i ordning
    let started = false;
    let inputTimer = null;
    const to = setTimeout(() => { clearInterval(inputTimer); try { ws.close(); } catch (e) {} resolve({ label, seen, timeout: true }); }, 15000);
    const finish = () => { clearTimeout(to); clearInterval(inputTimer); try { ws.close(); } catch (e) {} resolve({ label, seen }); };
    ws.on('error', reject);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'host', name: 'ARSPROBE', godot: 1 })));
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
      const events = m.type === 'sim_events' && Array.isArray(m.events) ? m.events : (m.type === 'pvp_shot' ? [m] : []);
      for (const ev of events) {
        if (ev.type === 'pvp_shot' && Array.isArray(ev.bs) && ev.bs.length) {
          seen.push(ev.bs[0].s);
          if (seen.length >= shots.length) { finish(); return; }
          // nästa skott
          const next = shots[seen.length];
          ws.send(JSON.stringify({ type: 'sim_shoot', weaponId: next.send, x: 500, y: 500, ang: 0 }));
        }
      }
      if (m.type === 'hosted') {
        ws.send(JSON.stringify(startMsg));
      } else if (!started && (m.type === 'sim_started')) {
        started = true;
        // håll spelaren vid liv + skjut första skottet
        inputTimer = setInterval(() => ws.send(JSON.stringify({ type: 'sim_input', x: 500, y: 500, hp: 100, aim: 0 })), 200);
        ws.send(JSON.stringify({ type: 'sim_shoot', weaponId: shots[0].send, x: 500, y: 500, ang: 0 }));
      }
    });
  });
}

(async () => {
  let fail = 0;
  const tier0 = GUNGAME_WEAPONS[0];

  // A) GUNGAME: otillåtet vapen → tier-vapen; tier-vapnet passerar
  const gg = await runMode(
    { type: 'sim_start', gungame: true },
    [{ send: 'rocket', expect: tier0 }, { send: tier0, expect: tier0 }],
    'gungame'
  );
  console.log('[GUNGAME] skickade [rocket, ' + tier0 + '] → pvp_shot styles:', JSON.stringify(gg.seen));
  if (gg.seen[0] === tier0 && gg.seen[1] === tier0) console.log('  ✅ rocket clampades till tier-vapnet, legit skott orört, sim lever');
  else { console.log('  ❌ FEL: väntade ["' + tier0 + '","' + tier0 + '"]'); fail++; }

  // B) CTF: railgun → pistol; rifle passerar
  const ctf = await runMode(
    { type: 'sim_start', ctf: true },
    [{ send: 'railgun', expect: 'pistol' }, { send: 'rifle', expect: 'rifle' }],
    'ctf'
  );
  console.log('[CTF] skickade [railgun, rifle] → pvp_shot styles:', JSON.stringify(ctf.seen));
  if (ctf.seen[0] === 'pistol' && ctf.seen[1] === 'rifle') console.log('  ✅ railgun clampades till pistol, rifle (coop-arsenal) orört, sim lever');
  else { console.log('  ❌ FEL: väntade ["pistol","rifle"]'); fail++; }

  if (fail === 0) { console.log('✅ ARSENAL-VALIDERING OK (gungame + ctf)'); process.exit(0); }
  console.log('❌ ARSENAL-PROBE: ' + fail + ' fel');
  process.exit(1);
})().catch(e => { console.log('❌ probe-fel:', e.message); process.exit(1); });
