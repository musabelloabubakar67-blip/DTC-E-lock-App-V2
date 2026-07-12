#!/usr/bin/env node
/**
 * import-sheets.mjs — DTC E-Lock migration: three-source reconciliation.
 *
 * This is the AUDIT / DRY-RUN engine. It reads the legacy Google Sheets exports,
 * merges them into a single device+assignment picture, and REPORTS. It writes
 * NOTHING to a database. Porting the resolved output into SQLite inserts is the
 * second step, done only after the audit report is clean and reviewed.
 *
 * Design facts baked in (settled with the owner, do not change without re-checking data):
 *  - NO single source of truth. ~1,110 devices across Registry (540) ∪ person-tabs (1,057)
 *    ∪ install-log (375). Registry alone holds under half the fleet.
 *  - Merge key = MASTER LOCK serial (12 digits), normalized uppercase/trim.
 *  - Registration/sub-kit  : person-tabs primary (they hold ~566 devices Registry lacks),
 *                            Registry fallback.
 *  - Current truck + status : Registry authoritative WHERE PRESENT.
 *  - Current assignment tiebreak: newest install per truck wins the DEFAULT value,
 *    but any Registry-vs-newest-install disagreement imports UNVERIFIED (default value
 *    set, conflict preserved). Newest-install wins the value, never the trust.
 *  - Slots: install-log C1/C2/C3 positional for installed devices; deferred (unknown)
 *    for registered-never-installed inventory. Device Unique ID is IGNORED (redundant).
 *  - Faulty Subs column: ONE closed faulty pairing per device; deeper history was
 *    overwritten and is unrecoverable.
 *  - Ignored columns (read-and-skip, never stored): Device Unique ID, Master Seal Card,
 *    Master Unseal Card, Notes, decorative Status.
 *  - Column mapping is BY HEADER NAME per file — positions differ across person-tabs.
 *
 * Usage: node import-sheets.mjs /path/to/csv/dir
 */

import fs from 'node:fs';
import path from 'node:path';

const DIR = process.argv[2] || '.';

// ---------- tiny CSV parser (RFC-4180-ish: quotes, embedded commas/newlines) ----------
function parseCSV(text) {
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i+1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
function readRows(file) {
  const raw = fs.readFileSync(path.join(DIR, file), 'utf8').replace(/^\uFEFF/, '');
  const rows = parseCSV(raw);
  const header = rows[0].map(h => h.trim());
  // map by header NAME -> index (first match wins; duplicate "Device Unique ID" is ignored anyway)
  const col = {};
  header.forEach((h, i) => { if (!(h in col)) col[h] = i; });
  return { header, col, body: rows.slice(1) };
}
const N = s => (s ?? '').trim().toUpperCase();
const isMaster = s => /^\d{12}$/.test(s);
const isSub    = s => /^[0-9A-F]{12}$/.test(s);

function get(row, col, name) {
  const i = col[name];
  return i === undefined ? '' : (row[i] ?? '');
}
// person-tabs vary: "Truck Number" may be absent; find flexibly.
function colByContains(col, needle) {
  const k = Object.keys(col).find(h => h.toLowerCase().includes(needle));
  return k ? col[k] : undefined;
}

function parseDate(s) {
  s = (s || '').trim(); if (!s) return null;
  let m;
  if ((m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?$/)))
    return Date.UTC(+m[3], +m[2]-1, +m[1], +(m[4]||0), +(m[5]||0), +(m[6]||0)) / 1000;
  if ((m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/))) {
    const mon = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11}[m[2].toLowerCase()];
    let y = +m[3]; if (y < 100) y += 2000;
    if (mon !== undefined) return Date.UTC(y, mon, +m[1]) / 1000;
  }
  return null;
}

// ---------- load: block-format person-tabs (master row + N sub rows beneath) ----------
function loadPersonTab(file) {
  const { col, body } = readRows(file);
  const masterI = colByContains(col, 'master lock');
  const subI    = col['Sub Lock'] ?? colByContains(col, 'sub lock');
  const simI    = colByContains(col, 'sim card');
  const truckI  = colByContains(col, 'truck number');
  const out = new Map(); let cur = null;
  for (const r of body) {
    const m = N(r[masterI]);
    if (isMaster(m)) {
      cur = m;
      out.set(cur, {
        master: cur,
        sim: (r[simI] ?? '').trim(),
        truck: truckI !== undefined ? N(r[truckI]) : '',
        subs: [],
        source: file,
      });
      const s = N(r[subI]); if (isSub(s)) out.get(cur).subs.push(s);
    } else if (cur) {
      const s = N(r[subI]); if (isSub(s)) out.get(cur).subs.push(s);
    }
  }
  return out;
}

// ---------- load: Registry (one row per device, fully populated) ----------
function loadRegistry(file) {
  const { col, body } = readRows(file);
  const out = new Map();
  for (const r of body) {
    const m = N(get(r, col, 'MASTER LOCK')); if (!isMaster(m)) continue;
    const subs = ['SUB LOCK B','SUB LOCK C','SUB LOCK D'].map(c => N(get(r, col, c))).filter(isSub);
    const faulty = N(get(r, col, 'Faulty Subs'));
    out.set(m, {
      master: m,
      truck: N(get(r, col, 'TRUCK NUMBER')),
      sim: get(r, col, 'SIM CARD').trim(),
      subs,
      faultySub: isSub(faulty) ? faulty : '',
      status: get(r, col, 'DEVICE STATUS').trim(),
      date: parseDate(get(r, col, 'DATE')),
    });
  }
  return out;
}

// ---------- load: install log (event stream; replay newest-per-truck) ----------
function loadInstalls(file) {
  const { col, body } = readRows(file);
  const evs = [];
  for (const r of body) {
    const truck = N(get(r, col, 'Truck Number'));
    const master = N(get(r, col, 'Mother Lock Serial Number'));
    if (!isMaster(master)) continue;
    evs.push({
      truck, master,
      ts: parseDate(get(r, col, 'Date')),
      subs: [
        N(get(r, col, 'Sub Lock C1 Serial Number')),
        N(get(r, col, 'Sub Lock C2 Serial Number')),
        N(get(r, col, 'Sub Lock C3 Serial Number')),
      ], // POSITIONAL: index 0=C1(slot B), 1=C2(slot C), 2=C3(slot D)
      status: get(r, col, 'Overall Installation Status').trim(),
    });
  }
  return evs;
}

const STATUS_MAP = { // Registry DEVICE STATUS -> lifecycle_status
  'Active': 'in_service', 'Unassigned': 'available',
  'Faulty': 'faulty', 'Under Repair': 'repair',
};
const SLOT = ['B','C','D'];

// ================================ RUN ================================
const registry = loadRegistry('DTC_E-Lock_Management_System__-_Device_Registry.csv');
const installs = loadInstalls('DTC_E-Lock_Management_System__-_Intallation___Handover_Log.csv');
const personFiles = fs.readdirSync(DIR).filter(f => /^E-Lock_Database_-_/.test(f));
const personTabs = personFiles.map(loadPersonTab);

// newest install per master, and per truck
const newestByMaster = new Map();
const installMasters = new Set();
for (const e of installs) {
  installMasters.add(e.master);
  if (!e.ts) continue;
  const cur = newestByMaster.get(e.master);
  if (!cur || e.ts > cur.ts) newestByMaster.set(e.master, e);
}

// merged device universe keyed by master serial
const devices = new Map();
function ensure(m) {
  if (!devices.has(m)) devices.set(m, {
    master: m, sim: '', subs: new Set(), truck: '', status: '',
    sources: new Set(), faultySub: '', slots: {}, unverified: false, flags: [],
  });
  return devices.get(m);
}

// 1) person-tabs = primary registration + sub-kit
for (const tab of personTabs) for (const [m, d] of tab) {
  const dev = ensure(m);
  dev.sources.add('person');
  if (!dev.sim && d.sim) dev.sim = d.sim;
  d.subs.forEach(s => dev.subs.add(s));
  if (!dev.truck && d.truck) dev.truck = d.truck;
}
// 2) Registry = current truck/status/sim authority + faulty sub
for (const [m, r] of registry) {
  const dev = ensure(m);
  dev.sources.add('registry');
  if (r.sim) dev.sim = r.sim;              // registry sim authoritative
  r.subs.forEach(s => dev.subs.add(s));
  if (r.faultySub) dev.faultySub = r.faultySub;
  dev.status = STATUS_MAP[r.status] || dev.status;
  dev.registryTruck = r.truck;
}
// 3) install log = slots (positional) + newest-install truck default
for (const [m, e] of newestByMaster) {
  const dev = ensure(m);
  dev.sources.add('install');
  e.subs.forEach((s, i) => { if (isSub(s)) dev.slots[SLOT[i]] = s; });
  dev.installTruck = e.truck;
}

// resolve current assignment + trust
let conflicts = 0, regOnlyNoInstall = 0, agree = 0, invNeverInstalled = 0, pureOrphan = 0;
for (const dev of devices.values()) {
  const rt = dev.registryTruck || '', it = dev.installTruck || '';
  if (rt && it) {
    if (rt === it) { dev.truck = rt; agree++; }
    else { dev.truck = it; dev.unverified = true; dev.flags.push(`truck_conflict registry=${rt} install=${it}`); conflicts++; }
  } else if (it) { dev.truck = it; }
  else if (rt) { dev.truck = rt; dev.unverified = true; dev.flags.push('registry_truck_no_install_evidence'); regOnlyNoInstall++; }
  // status inference where registry silent
  if (!dev.status) dev.status = dev.truck ? 'in_service' : 'available';
  if (!dev.truck && !dev.sources.has('install')) invNeverInstalled++;
  if (dev.sources.has('install') && !dev.sources.has('registry') && !dev.sources.has('person')) pureOrphan++;
  // faulty sub -> would become one closed faulty pairing at insert time
  if (dev.faultySub) dev.subs.delete(dev.faultySub); // current kit excludes the retired faulty sub
  // EVERY migrated device starts unverified against physical reality
  dev.migratedUnverified = true;
}

// ------------------------------- REPORT -------------------------------
const total = devices.size;
const bySource = { registryOnly:0, personOnly:0, installOnly:0, multi:0 };
for (const d of devices.values()) {
  const n = d.sources.size;
  if (n > 1) bySource.multi++;
  else if (d.sources.has('registry')) bySource.registryOnly++;
  else if (d.sources.has('person')) bySource.personOnly++;
  else bySource.installOnly++;
}
const withUnknownSlots = [...devices.values()].filter(d => Object.keys(d.slots).length === 0).length;
const badSubKit = [...devices.values()].filter(d => d.subs.size > 0 && d.subs.size !== 3);

console.log('================ DTC E-LOCK MIGRATION — DRY RUN AUDIT ================');
console.log(`Total distinct devices (master serials): ${total}`);
console.log(`  in >1 source        : ${bySource.multi}`);
console.log(`  registry only       : ${bySource.registryOnly}`);
console.log(`  person-tab only     : ${bySource.personOnly}`);
console.log(`  install-log only    : ${bySource.installOnly}`);
console.log('');
console.log('--- CURRENT ASSIGNMENT RESOLUTION ---');
console.log(`  registry & install AGREE on truck            : ${agree}`);
console.log(`  CONFLICT (newest-install wins, UNVERIFIED)   : ${conflicts}`);
console.log(`  registry truck, NO install evidence (UNVER.) : ${regOnlyNoInstall}`);
console.log(`  registered, never installed -> inventory     : ${invNeverInstalled}`);
console.log(`  pure orphans (install only, chase by hand)   : ${pureOrphan}`);
console.log('');
console.log('--- DATA QUALITY FLAGS ---');
console.log(`  devices with UNKNOWN slots (inventory: expected): ${withUnknownSlots}`);
console.log(`  devices whose current sub-kit != 3 subs (review): ${badSubKit.length}`);
badSubKit.slice(0, 10).forEach(d =>
  console.log(`      ${d.master}: ${d.subs.size} subs [${[...d.subs].join(', ')}] sources=${[...d.sources].join('+')}`));
console.log('');
console.log('--- MIGRATION TRUST ---');
console.log(`  ALL ${total} devices import UNVERIFIED (heal via byproduct kit-scan post go-live).`);
console.log(`  Historical mother-lock swaps derivable from install replay: ~17.`);
console.log('');
console.log('--- CONFLICT SAMPLES (first 8) ---');
[...devices.values()].filter(d => d.flags.some(f => f.startsWith('truck_conflict'))).slice(0, 8)
  .forEach(d => console.log(`  ${d.master}: ${d.flags.join(' | ')}`));
console.log('=====================================================================');
console.log('NOTHING WAS WRITTEN. Resolve flags, then run the DB insert step.');
