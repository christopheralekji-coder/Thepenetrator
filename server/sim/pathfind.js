// Nav-grid + A* pathfinding för bots (v1.667).
//
// Tidigare: bots använde reaktiv "steerAround" (probe framåt, vrid undan). Det räcker
// för enkla väggöppningar men fastnar i konkava rum, U-formade baser och labyrint-cover.
// Nu: en coarse navigations-grid byggs per arena (cachas på walls-arrayen), A* hittar en
// väg cell-för-cell, och vägen string-pullas (line-of-sight) till en gles waypoint-lista.
//
// Designval:
//  - Grid-cell 70px, väggar inflaterade med bot-radie (~22px) så bots inte skär hörn.
//  - 8-riktad rörelse, ingen hörn-cut (diagonal kräver båda ortogonala grannar fria).
//  - Path cachas per bot; recompute bara när målet flyttat sig mycket / vägen slut /
//    blivit gammal (~700ms). LoS-genväg: är målet fritt synligt går boten rakt (ingen A*).
//  - Allt är rent reaktivt mot statiska väggar; andra spelare/bots är inte hinder i griden
//    (de hanteras av combat-strafe + clamp). Räcker gott för game-feel.
'use strict';

// v1.672 KRITISK FIX: GRID_CELL var 70 + WALL_PAD 22 → bas-öppningarna (där flaggor
// + spawns sitter) FÖRSEGLADES i griden (flood-fill: flaggorna ej nåbara från mitten).
// A* kunde då aldrig rutta in/ut ur baserna → computePath null → boten gick rakt →
// fastnade vid bas-väggen → unstick-strafe = "står kvar i basen / upp-ner bakom vägg".
// CELL=50 + pad=16 (=bot-radie) återansluter ALLA baser + spawns (verifierat via
// flood-fill). Finare grid = ~2x celler men A* throttlas (700ms) + få bots → ok CPU.
const GRID_CELL = 50;       // världs-px per cell
const WALL_PAD = 16;        // inflatera väggar med bot-radie så path håller avstånd
const PATH_MAX_AGE_MS = 700;
const PATH_GOAL_MOVE = 130; // recompute om målet flyttat sig mer än så
const WAYPOINT_REACH = 40;  // hur nära en waypoint innan vi går till nästa (skalat med cell)

const _gridCache = new WeakMap();   // walls-array → byggd grid

function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// Bygg (eller hämta cachad) nav-grid för en walls-array + world-dims.
function getGrid(walls, worldW, worldH) {
  let g = _gridCache.get(walls);
  if (g && g.worldW === worldW && g.worldH === worldH) return g;
  const cols = Math.max(1, Math.ceil(worldW / GRID_CELL));
  const rows = Math.max(1, Math.ceil(worldH / GRID_CELL));
  const blocked = new Uint8Array(cols * rows);
  for (let cy = 0; cy < rows; cy++) {
    const ry = cy * GRID_CELL;
    for (let cx = 0; cx < cols; cx++) {
      const rx = cx * GRID_CELL;
      let b = 0;
      for (let i = 0; i < walls.length; i++) {
        const w = walls[i];
        if (rectsOverlap(rx, ry, GRID_CELL, GRID_CELL,
            w.x - WALL_PAD, w.y - WALL_PAD, w.w + 2 * WALL_PAD, w.h + 2 * WALL_PAD)) {
          b = 1; break;
        }
      }
      blocked[cy * cols + cx] = b;
    }
  }
  g = { cols, rows, blocked, worldW, worldH };
  _gridCache.set(walls, g);
  return g;
}

function cellIdx(g, cx, cy) { return cy * g.cols + cx; }
function inBounds(g, cx, cy) { return cx >= 0 && cy >= 0 && cx < g.cols && cy < g.rows; }
function isFree(g, cx, cy) { return inBounds(g, cx, cy) && g.blocked[cellIdx(g, cx, cy)] === 0; }

// Närmsta fria cell via expanderande ring (start/mål kan ligga inne i inflaterad vägg).
function nearestFree(g, cx, cy) {
  if (isFree(g, cx, cy)) return [cx, cy];
  for (let r = 1; r <= 8; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // bara ringens kant
        if (isFree(g, cx + dx, cy + dy)) return [cx + dx, cy + dy];
      }
    }
  }
  return null;
}

// Min-heap på f-score (par av [f, idx]).
function heapPush(heap, node) {
  heap.push(node);
  let i = heap.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heap[p][0] <= heap[i][0]) break;
    const t = heap[p]; heap[p] = heap[i]; heap[i] = t;
    i = p;
  }
}
function heapPop(heap) {
  const top = heap[0];
  const last = heap.pop();
  if (heap.length > 0) {
    heap[0] = last;
    let i = 0;
    const n = heap.length;
    for (;;) {
      const l = 2 * i + 1, r = 2 * i + 2;
      let s = i;
      if (l < n && heap[l][0] < heap[s][0]) s = l;
      if (r < n && heap[r][0] < heap[s][0]) s = r;
      if (s === i) break;
      const t = heap[s]; heap[s] = heap[i]; heap[i] = t;
      i = s;
    }
  }
  return top;
}

const SQRT2 = 1.41421356;

// A* över griden. Returnerar array av cell-index (start→mål) eller null.
function astar(g, sIdx, gIdx) {
  const n = g.cols * g.rows;
  const gScore = new Float32Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const sx = sIdx % g.cols, sy = (sIdx / g.cols) | 0;
  const gx = gIdx % g.cols, gy = (gIdx / g.cols) | 0;
  const h = (cx, cy) => {
    const dx = Math.abs(cx - gx), dy = Math.abs(cy - gy);
    return (dx + dy) + (SQRT2 - 2) * Math.min(dx, dy); // octile
  };
  gScore[sIdx] = 0;
  const heap = [];
  heapPush(heap, [h(sx, sy), sIdx]);
  const maxIter = n * 2;
  let iter = 0;
  while (heap.length && iter++ < maxIter) {
    const [, cur] = heapPop(heap);
    if (cur === gIdx) {
      const path = [];
      let c = cur;
      while (c !== -1) { path.push(c); c = came[c]; }
      path.reverse();
      return path;
    }
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % g.cols, cy = (cur / g.cols) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx, ny = cy + dy;
        if (!isFree(g, nx, ny)) continue;
        // ingen hörn-cut: diagonal kräver båda ortogonala grannar fria
        if (dx !== 0 && dy !== 0 && (!isFree(g, cx + dx, cy) || !isFree(g, cx, cy + dy))) continue;
        const ni = cellIdx(g, nx, ny);
        if (closed[ni]) continue;
        const step = (dx !== 0 && dy !== 0) ? SQRT2 : 1;
        const tentative = gScore[cur] + step;
        if (tentative < gScore[ni]) {
          gScore[ni] = tentative;
          came[ni] = cur;
          heapPush(heap, [tentative + h(nx, ny), ni]);
        }
      }
    }
  }
  return null;
}

// Är linjen (x0,y0)->(x1,y1) fri från blockerade celler? (string-pull-test, grov DDA.)
function lineClear(g, x0, y0, x1, y1) {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(dist / (GRID_CELL * 0.5)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
    const cx = Math.min(g.cols - 1, Math.max(0, (x / GRID_CELL) | 0));
    const cy = Math.min(g.rows - 1, Math.max(0, (y / GRID_CELL) | 0));
    if (g.blocked[cellIdx(g, cx, cy)]) return false;
  }
  return true;
}

function cellCenter(g, idx) {
  const cx = idx % g.cols, cy = (idx / g.cols) | 0;
  return { x: cx * GRID_CELL + GRID_CELL / 2, y: cy * GRID_CELL + GRID_CELL / 2 };
}

// String-pull: kollapsa cell-kedjan till glesa waypoints via line-of-sight.
function smooth(g, cells, startX, startY, goalX, goalY) {
  const pts = cells.map(c => cellCenter(g, c));
  // Snäpp sista punkten till det riktiga målet (cell-center kan ligga lite fel).
  if (pts.length) { pts[pts.length - 1] = { x: goalX, y: goalY }; }
  const out = [];
  let anchorX = startX, anchorY = startY;
  let i = 0;
  while (i < pts.length) {
    // hitta längsta hopp framåt som har fri LoS från ankaret
    let j = i;
    for (let k = pts.length - 1; k >= i; k--) {
      if (lineClear(g, anchorX, anchorY, pts[k].x, pts[k].y)) { j = k; break; }
    }
    out.push(pts[j]);
    anchorX = pts[j].x; anchorY = pts[j].y;
    i = j + 1;
  }
  return out;
}

// Beräkna en väg från (sx,sy) till (gx,gy). Returnerar waypoint-array (exkl. startpunkt)
// eller null om mål inte nåbart / ingen väg behövs.
function computePath(walls, worldW, worldH, sx, sy, gx, gy) {
  if (!walls || !walls.length) return null;
  const g = getGrid(walls, worldW, worldH);
  // Direkt LoS → ingen path behövs, gå rakt.
  if (lineClear(g, sx, sy, gx, gy)) return null;
  const sc = nearestFree(g, Math.min(g.cols - 1, Math.max(0, (sx / GRID_CELL) | 0)),
                              Math.min(g.rows - 1, Math.max(0, (sy / GRID_CELL) | 0)));
  const gc = nearestFree(g, Math.min(g.cols - 1, Math.max(0, (gx / GRID_CELL) | 0)),
                              Math.min(g.rows - 1, Math.max(0, (gy / GRID_CELL) | 0)));
  if (!sc || !gc) return null;
  const sIdx = cellIdx(g, sc[0], sc[1]);
  const gIdx = cellIdx(g, gc[0], gc[1]);
  if (sIdx === gIdx) return null;
  const cells = astar(g, sIdx, gIdx);
  if (!cells || cells.length < 2) return null;
  return smooth(g, cells, sx, sy, gx, gy);
}

// Per-bot path-hjälpare. Returnerar nästa waypoint {x,y} att gå mot, eller null
// (= gå rakt mot målet, ingen väg behövs/hittades). Hanterar cache + recompute.
//   bot._path:        waypoint-array
//   bot._pathIdx:     index i _path
//   bot._pathGoalX/Y: mål vägen beräknades för
//   bot._pathAt:      tidsstämpel
function nextWaypoint(bot, walls, worldW, worldH, sx, sy, gx, gy, now) {
  const goalMoved = bot._pathGoalX == null ||
    Math.hypot(gx - bot._pathGoalX, gy - bot._pathGoalY) > PATH_GOAL_MOVE;
  const stale = !bot._pathAt || (now - bot._pathAt) > PATH_MAX_AGE_MS;
  const exhausted = !bot._path || bot._pathIdx >= (bot._path ? bot._path.length : 0);
  if (goalMoved || stale || exhausted) {
    bot._path = computePath(walls, worldW, worldH, sx, sy, gx, gy);
    bot._pathIdx = 0;
    bot._pathGoalX = gx; bot._pathGoalY = gy;
    bot._pathAt = now;
  }
  if (!bot._path || !bot._path.length) return null;  // rak väg
  // Avancera förbi nådda waypoints
  while (bot._pathIdx < bot._path.length - 1) {
    const wp = bot._path[bot._pathIdx];
    if (Math.hypot(sx - wp.x, sy - wp.y) <= WAYPOINT_REACH) bot._pathIdx++;
    else break;
  }
  return bot._path[bot._pathIdx] || null;
}

module.exports = { computePath, nextWaypoint, getGrid, _GRID_CELL: GRID_CELL };
