'use strict';
// Audit C268: gruppledare som köar ska dra med HELA gruppen (inte köa solo + stranda medlemmar).
const assert = require('assert');
const groups = require('./groups');
const matchmaker = require('./matchmaker');

function mkWs(id, acct) { return { id, accountId: acct, readyState: 1, playerName: id, roomCode: null, send() {} }; }
const leader = mkWs('L', 'accL');
const mem = mkWs('M', 'accM');
const accById = { accL: leader, accM: mem };

groups.setHelpers({ send() {}, wsForAccount: (id) => accById[id] });

// Forma grupp: ledare skapar, bjuder in M, M accepterar.
groups.handle(leader, { type: 'group_create' });
groups.handle(leader, { type: 'group_invite', toId: 'accM' });
groups.handle(mem, { type: 'group_accept', groupId: leader._groupId });
assert.ok(leader._groupId && mem._groupId === leader._groupId, 'grupp formad (ledare+medlem)');

const errs = [];
matchmaker.setHelpers({
  send: (w, o) => { if (o.type === 'queue_error') errs.push(w.id + ':' + o.code); },
  rooms: new Map(), createSim: () => ({}), startSim: () => {}, generateCode: () => 'CODE',
});

// Ledaren köar → BÅDA ska få samma ticket (TDM target=4 → ingen match formas än, men de står i kö ihop).
matchmaker.handle(leader, { type: 'queue_join', mode: 'tdm' });
assert.ok(leader._mmTicket, 'ledaren fick ticket');
assert.ok(mem._mmTicket, 'C268: MEDLEMMEN köades med (strandar inte längre)');
assert.strictEqual(leader._mmTicket, mem._mmTicket, 'ledare + medlem delar EN ticket');
assert.strictEqual(leader._mmTicket.members.length, 2, 'ticket innehåller hela gruppen (2)');
console.log('  C268: gruppledarens köning drar in medlemmen (ingen strand)');

// Icke-ledare som försöker köa → notleader (får inte starta party-köning).
matchmaker.handle(mem, { type: 'queue_join', mode: 'tdm' });
assert.ok(errs.includes('M:notleader'), 'medlem som köar nekas (notleader), fick: ' + JSON.stringify(errs));
console.log('  C268: icke-ledare nekas köning (notleader)');

// Städa upp så vi inte läcker state till ev. andra tester i samma process.
matchmaker.handle(leader, { type: 'queue_cancel' });
console.log('\nC268-PARTY OK');
