// Spatial hash-grid för O(1) nearby-queries istället för O(N) linear scan.
// Används av bullets-collision, applySeparation, chain-effekter, explode.
//
// Cell-size 200px valdt för balans: tillräckligt stort så få celler queryas
// (max 4 vid 50px-radie queries), tillräckligt litet så cell-density är låg
// (typiskt 1-5 enemies/cell vid 80 enemies på 4000×3000 arena).
//
// Build O(E), query O(E_within_cell) — typiskt 5x snabbare än linear scan
// vid 80 entities. Vid 200+ entities blir gain ~10×.
'use strict';

const CELL_SIZE = 200;

class SpatialGrid {
  constructor() {
    this.cells = new Map();         // cellKey → array of entities
    this.size = 0;
  }
  _key(cx, cy) { return cx * 65536 + cy; }
  clear() {
    // Re-use map för att undvika GC-tryck per tick
    if (this.size > 0) {
      this.cells.clear();
      this.size = 0;
    }
  }
  // Lägg in en entity (måste ha .x och .y)
  insert(entity) {
    const cx = Math.floor(entity.x / CELL_SIZE);
    const cy = Math.floor(entity.y / CELL_SIZE);
    const k = this._key(cx, cy);
    let arr = this.cells.get(k);
    if (!arr) { arr = []; this.cells.set(k, arr); }
    arr.push(entity);
    this.size++;
  }
  // Iterera entities inom radie r från (x, y). Calling code måste verifiera
  // exact distance — det här är broad-phase.
  queryRadius(x, y, r, callback) {
    const minCx = Math.floor((x - r) / CELL_SIZE);
    const maxCx = Math.floor((x + r) / CELL_SIZE);
    const minCy = Math.floor((y - r) / CELL_SIZE);
    const maxCy = Math.floor((y + r) / CELL_SIZE);
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const arr = this.cells.get(this._key(cx, cy));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          callback(arr[i]);
        }
      }
    }
  }
  // Bekvämlighet: returnera array (cost: allocation). Använd queryRadius för
  // hot-paths där du vill undvika array-alloc.
  getNearby(x, y, r) {
    const result = [];
    this.queryRadius(x, y, r, e => result.push(e));
    return result;
  }
  // v1.656: noll-alloc-variant — fyller en ÅTERANVÄND array (out) istället för att
  // allokera en ny per anrop. För hot-paths (bullet-collision @ 60Hz × N bullets)
  // där getNearby:s per-anrops-array var den största GC-tryck-källan. Inlinad cell-
  // iteration (ingen closure-alloc). Returnerar out för bekvämlighet.
  queryInto(x, y, r, out) {
    out.length = 0;
    const minCx = Math.floor((x - r) / CELL_SIZE);
    const maxCx = Math.floor((x + r) / CELL_SIZE);
    const minCy = Math.floor((y - r) / CELL_SIZE);
    const maxCy = Math.floor((y + r) / CELL_SIZE);
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const arr = this.cells.get(this._key(cx, cy));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) out.push(arr[i]);
      }
    }
    return out;
  }
}

module.exports = { SpatialGrid, CELL_SIZE };
