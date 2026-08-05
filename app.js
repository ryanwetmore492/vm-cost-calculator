/* ================= VM Cost Calculator — client-side app =================
   No backend. State persists in the browser key-value store, portable via JSON export.
   ======================================================================= */
(() => {
'use strict';

const LS_KEY = 'vmcc.v1';

/* Storage adapter: uses the browser's persistent key/value store when the page
   is allowed to (normal tab), and falls back to an in-memory store when the
   page runs inside a sandboxed preview frame that blocks web storage. */
const STORE = (() => {
  const mem = { _m: {}, getItem(k) { return k in this._m ? this._m[k] : null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; }, persistent: false };
  try {
    const s = window[['local', 'Storage'].join('')];
    s.setItem('__vmcc_probe', '1'); s.removeItem('__vmcc_probe');
    return { getItem: k => s.getItem(k), setItem: (k, v) => s.setItem(k, v), removeItem: k => s.removeItem(k), persistent: true };
  } catch (e) { return mem; }
})();
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const uid = () => Math.random().toString(36).slice(2, 9);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = n => (isFinite(n) ? n : 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = n => (isFinite(n) ? n : 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

/* ---------------- defaults ---------------- */
function defaultPricing() {
  return {
    ratios: [
      { id: uid(), sku: '2721', label: '4:1', name: 'Enterprise Cloud Compute (4:1 Processor Ratio)', price: 10.00, isDefault: true },
      { id: uid(), sku: 'CUSTOM', label: '2:1', name: 'Enterprise Cloud Compute (2:1 Processor Ratio)', price: 15.00, isDefault: false }
    ],
    storage: [
      { id: uid(), sku: '3819', name: 'Enterprise Cloud Storage — Standard Flash', price: 333.00, unit: 'TB', isDefault: true },
      { id: uid(), sku: '3815', name: 'Enterprise Cloud Storage — High Performance Flash', price: 359.00, unit: 'TB', isDefault: false }
    ],
    dr: {
      storage: { sku: '', name: 'DR Storage — Zerto Replication', price: 0.15 },
      fee: { sku: '', name: 'Zerto Replication Fee', price: 25.00 }
    },
    vmwareLic: { sku: '2729', name: 'VMware Licensing', price: 10.00, enabled: true },
    spla: { sku: '2589', name: 'Microsoft Windows Server Licensing (SPLA)', price: 99.00 },
    addons: [],
    settings: { divisor: 1024, rounding: 'line' }
  };
}
function newClient(name, pricing) {
  return { id: uid(), name: name || 'New client', pricing: pricing || defaultPricing(), vms: [], updated: Date.now() };
}
function blankVm(pricing) {
  const dr = (pricing.ratios.find(r => r.isDefault) || pricing.ratios[0] || {}).id || '';
  const ds = (pricing.storage.find(s => s.isDefault) || pricing.storage[0] || {}).id || '';
  return { id: uid(), name: '', os: 'Linux', location: '', ram: 0, disk: 0, dr: false, drGb: 0, ratioId: dr, storageId: ds, tags: [], addons: pricing.addons.filter(a => a.defaultOn).map(a => a.id) };
}

/* ---------------- storage unit helpers ----------------
   Each storage tier is priced either per TB (default, disk GB ÷ divisor) or
   per GB (disk GB × price, no conversion). Tiers saved before this feature
   existed have no `unit` field and are treated as per TB. */
const SU = s => (s && String(s.unit).toUpperCase() === 'GB') ? 'GB' : 'TB';
/* per-GB rates are small numbers: show up to 4 decimals so $0.325/GB is not rounded away */
const rateNum = s => SU(s) === 'GB'
  ? (Number(s.price) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
  : num(s.price);
const rateStr = s => '$' + rateNum(s) + '/' + SU(s);
function normalizePricing(p) {
  (p.storage || []).forEach(s => { s.unit = SU(s); });
  // backward compat: profiles saved before Zerto DR existed have no `dr` block
  const d = defaultPricing().dr;
  p.dr = p.dr && typeof p.dr === 'object' ? p.dr : {};
  p.dr.storage = Object.assign({}, d.storage, p.dr.storage || {});
  p.dr.fee = Object.assign({}, d.fee, p.dr.fee || {});
  p.dr.storage.price = Number(p.dr.storage.price) || 0;
  p.dr.fee.price = Number(p.dr.fee.price) || 0;
  return p;
}

/* ---------------- Zerto DR helpers ----------------
   DR is opt-in per VM. `dr` is the protection flag, `drGb` the manually entered
   replication footprint (journal + replica) — never derived from provisioned disk.
   Older saved profiles / imported JSON have neither field: DR reads as off. */
function normalizeVmDr(v) {
  v.dr = v.dr === true || v.dr === 'true' || v.dr === 1;
  v.drGb = Number(v.drGb) || 0;
  return v;
}
const drRate = p => Number((p || P()).dr.storage.price) || 0;
const drFeeRate = p => Number((p || P()).dr.fee.price) || 0;
const drRateNum = n => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
function drSummary(p) {
  const q = p || P();
  return `$${drRateNum(drRate(q))}/GB DR storage + ${usd(drFeeRate(q))}/protected VM`;
}
/* human summary of how storage is billed, used in assumptions text */
function storageUnitSummary(p) {
  const tiers = (p || P()).storage || [];
  const gb = tiers.filter(s => SU(s) === 'GB'), tb = tiers.filter(s => SU(s) === 'TB');
  if (!gb.length) return `all storage tiers priced per TB (disk GB ÷ ${(p || P()).settings.divisor})`;
  if (!tb.length) return 'all storage tiers priced per GB of provisioned disk (no GB → TB conversion)';
  return `${tb.length} tier${tb.length === 1 ? '' : 's'} priced per TB (÷ ${(p || P()).settings.divisor}), `
    + `${gb.length} priced per GB: ` + gb.map(s => shortTier(s.name)).join(', ');
}

/* ---------------- VM tag helpers ----------------
   Tags are reusable free-form labels stored per VM as an array of strings.
   Normalisation rules (single source of truth for manual entry, bulk actions
   and CSV import): trim whitespace, collapse inner runs of whitespace, drop
   blanks, drop anything longer than TAG_MAX_LEN, de-duplicate
   case-insensitively while keeping the first readable casing, cap at
   TAG_MAX_PER_VM tags. Profiles saved before tags existed have no `tags`
   field at all — those VMs read as an empty list everywhere. */
const TAG_MAX_LEN = 32;
const TAG_MAX_PER_VM = 12;
const TAG_DELIM = ';'; // canonical export delimiter
const TAG_SPLIT = /[;,|]/; // accepted import delimiters
function cleanTag(t) {
  return String(t ?? '').replace(/[\s\u00a0]+/g, ' ').trim();
}
/* Returns { tags, dropped: [{tag, why}] } so callers can surface validation. */
function normalizeTagList(list) {
  const out = [], seen = new Set(), dropped = [];
  (Array.isArray(list) ? list : [list]).forEach(raw => {
    const t = cleanTag(raw);
    if (!t) { if (String(raw ?? '').length) dropped.push({ tag: String(raw), why: 'blank' }); return; }
    if (t.length > TAG_MAX_LEN) { dropped.push({ tag: t, why: `longer than ${TAG_MAX_LEN} characters` }); return; }
    const k = t.toLowerCase();
    if (seen.has(k)) { dropped.push({ tag: t, why: 'duplicate' }); return; }
    if (out.length >= TAG_MAX_PER_VM) { dropped.push({ tag: t, why: `over the ${TAG_MAX_PER_VM}-tag limit` }); return; }
    seen.add(k); out.push(t);
  });
  return { tags: out, dropped };
}
const normalizeVmTags = v => { v.tags = normalizeTagList(v.tags || []).tags; return v; };
const tagsOf = vm => (vm && Array.isArray(vm.tags) ? vm.tags : []);
const tagsKey = vm => tagsOf(vm).map(t => t.toLowerCase());
const tagsStr = vm => tagsOf(vm).join(TAG_DELIM + ' ');
/* accepts "prod; tier-1 | finance" from a single CSV cell */
const parseTagCell = s => normalizeTagList(String(s ?? '').split(TAG_SPLIT)).tags;
/* Suggestions are derived from the live inventory — never a separate catalog. */
function tagsUsed(vms) {
  const seen = new Map();
  (vms || VMS()).forEach(v => tagsOf(v).forEach(t => { const k = t.toLowerCase(); if (!seen.has(k)) seen.set(k, t); }));
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
}
function tagCounts(vms) {
  const m = new Map();
  (vms || VMS()).forEach(v => tagsOf(v).forEach(t => { const k = t.toLowerCase(); m.set(k, (m.get(k) || 0) + 1); }));
  return m;
}
function syncTagDatalist() {
  let dl = $('#tagList');
  if (!dl) { dl = document.createElement('datalist'); dl.id = 'tagList'; document.body.appendChild(dl); }
  dl.innerHTML = tagsUsed().map(t => `<option value="${esc(t)}">`).join('');
}

/* ---------------- location helpers ----------------
   Location is optional free text. Older saved profiles have no `location`
   field at all — those VMs read as "Unassigned" everywhere. */
const UNASSIGNED = 'Unassigned';
const locOf = vm => (String((vm && vm.location) || '').trim() || UNASSIGNED);
function locationsUsed(vms) {
  const seen = new Map();
  (vms || VMS()).forEach(v => { const l = String(v.location || '').trim(); if (l && !seen.has(l.toLowerCase())) seen.set(l.toLowerCase(), l); });
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
}
function syncLocationDatalist() {
  let dl = $('#locList');
  if (!dl) { dl = document.createElement('datalist'); dl.id = 'locList'; document.body.appendChild(dl); }
  dl.innerHTML = locationsUsed().map(l => `<option value="${esc(l)}">`).join('');
}

/* ---------------- state ---------------- */
let state = load();
let locFilter = ''; // '' = all locations
let pending = null; // csv import staging
let selected = new Set(); // Cost breakdown row selection (vm ids, session-only)

function load() {
  try {
    const raw = STORE.getItem(LS_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.clients && Object.keys(s.clients).length) {
        Object.values(s.clients).forEach(c => {
          c.pricing = normalizePricing(Object.assign(defaultPricing(), c.pricing));
          c.vms = c.vms || [];
          // backward compat: profiles saved before locations existed
          c.vms.forEach(v => { if (typeof v.location !== 'string') v.location = ''; normalizeVmDr(v); normalizeVmTags(v); });
        });
        if (!s.clients[s.activeId]) s.activeId = Object.keys(s.clients)[0];
        return s;
      }
    }
  } catch (e) { console.warn('load failed', e); }
  const c = newClient('Demo Client');
  return { clients: { [c.id]: c }, activeId: c.id };
}
function save(quiet) {
  const c = active(); if (c) c.updated = Date.now();
  try {
    STORE.setItem(LS_KEY, JSON.stringify(state));
    $('#savedStamp').textContent = 'saved ' + new Date().toLocaleTimeString();
    if (!quiet) toast('Client profile saved to this browser.');
  } catch (e) { toast('Could not write to browser storage: ' + e.message, true); }
}
const active = () => state.clients[state.activeId];
const P = () => active().pricing;
const VMS = () => active().vms;

/* ---------------- toast ---------------- */
function toast(msg, isErr) {
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 250); }, isErr ? 6000 : 3000);
}

/* ---------------- cost engine ---------------- */
const isWin = os => /windows/i.test(String(os || ''));
function tbOf(diskGb) { return (Number(diskGb) || 0) / (Number(P().settings.divisor) || 1024); }

function costVm(vm) {
  const p = P(), ram = Number(vm.ram) || 0, disk = Number(vm.disk) || 0;
  const ratio = p.ratios.find(r => r.id === vm.ratioId) || null;
  const st = p.storage.find(s => s.id === vm.storageId) || null;
  const tb = tbOf(disk);
  const round = p.settings.rounding === 'line' ? r2 : (x => x);
  const storageUnit = st ? SU(st) : 'TB';
  const storageQty = storageUnit === 'GB' ? disk : tb; // per GB skips the divisor entirely

  const compute = round(ram * (ratio ? Number(ratio.price) || 0 : 0));
  const vmware = round(p.vmwareLic.enabled ? ram * (Number(p.vmwareLic.price) || 0) : 0);
  const storage = round(storageQty * (st ? Number(st.price) || 0 : 0));
  const spla = round(isWin(vm.os) ? (Number(p.spla.price) || 0) : 0);
  // Zerto DR: protected VMs only. Unprotected VMs contribute $0 on both lines.
  const drOn = vm.dr === true;
  const drGb = drOn ? (Number(vm.drGb) || 0) : 0;
  const drStorage = round(drOn ? drGb * drRate(p) : 0);
  const drFee = round(drOn ? drFeeRate(p) : 0);
  const dr = r2(drStorage + drFee);
  let addons = 0; const addonDetail = [];
  (vm.addons || []).forEach(id => {
    const a = p.addons.find(x => x.id === id); if (!a) return;
    const q = a.unit === 'per-vm' ? 1 : a.unit === 'per-gb-ram' ? ram : tb;
    const amt = round(q * (Number(a.price) || 0));
    addons += amt; addonDetail.push({ addon: a, qty: q, amt });
  });
  addons = round(addons);
  const total = r2(compute + vmware + storage + spla + addons + dr);
  return {
    vm, ram, disk, tb, ratio, storageTier: st, location: locOf(vm), tags: tagsOf(vm),
    storageUnit, storageQty, drOn, drGb, drStorage, drFee, dr,
    ratioLabel: ratio ? (ratio.label || ratio.name) : '— none —',
    storageLabel: st ? st.name : '— none —',
    compute, vmware, storage, spla, addons, addonDetail, total, windows: isWin(vm.os)
  };
}
const allCosts = () => VMS().map(costVm);

/* ================= RENDER: pricing ================= */
function renderPricing() {
  const p = P();
  // ratio tiers
  $('#ratioTable tbody').innerHTML = p.ratios.map(r => `
    <tr data-kind="ratio" data-id="${r.id}">
      <td><input class="in mono sku" data-f="sku" value="${esc(r.sku)}" aria-label="SKU code"></td>
      <td><input class="in mono" style="max-width:5.5rem" data-f="label" value="${esc(r.label)}" aria-label="Tier label"></td>
      <td><input class="in" data-f="name" value="${esc(r.name)}" aria-label="Tier name"></td>
      <td class="num"><div class="money"><span>$</span><input class="in num mono" type="number" step="0.01" min="0" data-f="price" value="${r.price}" aria-label="Price per GB RAM"></div></td>
      <td class="w-act"><input type="radio" name="defRatio" data-f="isDefault" ${r.isDefault ? 'checked' : ''} aria-label="Default ratio tier" style="accent-color:var(--primary)"></td>
      <td class="w-act"><button class="btn row-x" data-del="ratio" title="Remove tier">✕</button></td>
    </tr>`).join('');

  // storage tiers
  $('#storageTable tbody').innerHTML = p.storage.map(s => `
    <tr data-kind="storage" data-id="${s.id}">
      <td><input class="in mono sku" data-f="sku" value="${esc(s.sku)}" aria-label="SKU code"></td>
      <td><input class="in" data-f="name" value="${esc(s.name)}" aria-label="Storage tier name"></td>
      <td><select data-f="unit" class="unit-sel" aria-label="Pricing unit for this storage tier">
        <option value="TB" ${SU(s) === 'TB' ? 'selected' : ''}>per TB</option>
        <option value="GB" ${SU(s) === 'GB' ? 'selected' : ''}>per GB</option>
      </select></td>
      <td class="num"><div class="money"><span>$</span><input class="in num mono" type="number" step="${SU(s) === 'GB' ? '0.001' : '0.01'}" min="0" data-f="price" value="${s.price}" placeholder="${SU(s) === 'GB' ? '0.325' : '333.00'}" aria-label="Price per ${SU(s)}"><span class="suffix">/ ${SU(s)}</span></div>
        <div class="rate-echo mono">${esc(rateStr(s))}</div></td>
      <td class="w-act"><input type="radio" name="defStorage" data-f="isDefault" ${s.isDefault ? 'checked' : ''} aria-label="Default storage tier" style="accent-color:var(--primary)"></td>
      <td class="w-act"><button class="btn row-x" data-del="storage" title="Remove tier">✕</button></td>
    </tr>`).join('');

  // licensing
  $('#licVmSku').value = p.vmwareLic.sku; $('#licVmName').value = p.vmwareLic.name;
  $('#licVmPrice').value = p.vmwareLic.price; $('#licVmEnabled').checked = !!p.vmwareLic.enabled;
  $('#splaSku').value = p.spla.sku; $('#splaName').value = p.spla.name; $('#splaPrice').value = p.spla.price;

  // add-ons
  const units = [['per-vm', 'per VM (flat)'], ['per-gb-ram', 'per GB RAM'], ['per-tb-disk', 'per TB disk']];
  $('#addonTable tbody').innerHTML = p.addons.map(a => `
    <tr data-kind="addon" data-id="${a.id}">
      <td><input class="in mono sku" data-f="sku" value="${esc(a.sku)}" aria-label="Add-on SKU"></td>
      <td><input class="in" data-f="name" value="${esc(a.name)}" aria-label="Add-on name"></td>
      <td><select data-f="unit" aria-label="Add-on unit">${units.map(u => `<option value="${u[0]}" ${a.unit === u[0] ? 'selected' : ''}>${u[1]}</option>`).join('')}</select></td>
      <td class="num"><div class="money"><span>$</span><input class="in num mono" type="number" step="0.01" min="0" data-f="price" value="${a.price}" aria-label="Add-on price"></div></td>
      <td class="w-act"><label class="switch"><input type="checkbox" data-f="defaultOn" ${a.defaultOn ? 'checked' : ''} aria-label="On by default"><span class="track"></span></label></td>
      <td class="w-act"><button class="btn row-x" data-del="addon" title="Remove add-on">✕</button></td>
    </tr>`).join('');
  $('#addonEmpty').hidden = p.addons.length > 0;
  $('#addonTable').hidden = p.addons.length === 0;

  // Zerto DR
  $('#drStoSku').value = p.dr.storage.sku || ''; $('#drStoName').value = p.dr.storage.name || '';
  $('#drStoPrice').value = p.dr.storage.price;
  $('#drFeeSku').value = p.dr.fee.sku || ''; $('#drFeeName').value = p.dr.fee.name || '';
  $('#drFeePrice').value = p.dr.fee.price;
  $('#drStoEcho').textContent = '$' + drRateNum(p.dr.storage.price) + '/GB';
  $('#drFeeEcho').textContent = usd(p.dr.fee.price) + '/VM';
  $('#drEcho').textContent = drSummary(p);

  $('#setDivisor').value = String(p.settings.divisor);
  $('#setRounding').value = p.settings.rounding;
  $('#divisorEcho').textContent = String(p.settings.divisor);
  $('#storageUnitEcho').textContent = storageUnitSummary(p);
  $('#storageUnitTag').textContent = 'per TB or per GB allocated / month';
}

/* config table edits (delegated) */
function bindCfg(tableSel) {
  const t = $(tableSel);
  t.addEventListener('input', e => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    const f = e.target.dataset.f; if (!f) return;
    if (f === 'unit') return; // selects are handled in the change listener below
    const list = { ratio: P().ratios, storage: P().storage, addon: P().addons }[tr.dataset.kind];
    const item = list.find(x => x.id === tr.dataset.id); if (!item) return;
    if (f === 'price') item.price = parseFloat(e.target.value) || 0;
    else if (f === 'isDefault') { list.forEach(x => x.isDefault = false); item.isDefault = true; }
    else if (f === 'defaultOn') item.defaultOn = e.target.checked;
    else item[f] = e.target.value;
    if (tr.dataset.kind === 'storage' && f === 'price') {
      const echo = tr.querySelector('.rate-echo'); // live rate echo without re-rendering (keeps focus)
      if (echo) echo.textContent = rateStr(item);
    }
    afterPricingChange(f === 'label' || f === 'name');
  });
  t.addEventListener('change', e => {
    if (e.target.dataset.f !== 'unit') return;
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    const list = { ratio: P().ratios, storage: P().storage, addon: P().addons }[tr.dataset.kind];
    const item = (list || []).find(x => x.id === tr.dataset.id); if (!item) return;
    item.unit = e.target.value;
    if (tr.dataset.kind === 'storage') {
      renderPricing(); // refresh price suffix / placeholder / rate echo
      toast(`${shortTier(item.name)} now priced ${rateStr(item)}.`);
    }
    afterPricingChange(true);
  });
  t.addEventListener('click', e => {
    const btn = e.target.closest('[data-del]'); if (!btn) return;
    const tr = btn.closest('tr'); const kind = btn.dataset.del; const id = tr.dataset.id;
    if (kind === 'ratio') {
      if (P().ratios.length <= 1) return toast('Keep at least one ratio tier.', true);
      const used = VMS().filter(v => v.ratioId === id).length;
      if (used && !confirm(`${used} VM(s) use this tier. Remove it? Those VMs will fall back to the default tier.`)) return;
      P().ratios = P().ratios.filter(x => x.id !== id);
      if (!P().ratios.some(x => x.isDefault)) P().ratios[0].isDefault = true;
      const def = P().ratios.find(x => x.isDefault).id;
      VMS().forEach(v => { if (v.ratioId === id) v.ratioId = def; });
    } else if (kind === 'storage') {
      if (P().storage.length <= 1) return toast('Keep at least one storage tier.', true);
      const used = VMS().filter(v => v.storageId === id).length;
      if (used && !confirm(`${used} VM(s) use this tier. Remove it? Those VMs will fall back to the default tier.`)) return;
      P().storage = P().storage.filter(x => x.id !== id);
      if (!P().storage.some(x => x.isDefault)) P().storage[0].isDefault = true;
      const def = P().storage.find(x => x.isDefault).id;
      VMS().forEach(v => { if (v.storageId === id) v.storageId = def; });
    } else {
      P().addons = P().addons.filter(x => x.id !== id);
      VMS().forEach(v => v.addons = (v.addons || []).filter(a => a !== id));
    }
    reconcileVmTiers();
    rulesDirty = true; // tier lists feed the rule value dropdowns
    renderPricing(); commit('pricing', { force: false });
  });
}

function afterPricingChange(structural) {
  if (structural) reconcileVmTiers();
  commit('pricing');
}

/* ================= RENDER: VM inventory ================= */
function renderVms() {
  reconcileVmTiers();
  renderImportSummary();
  const p = P(), vms = VMS();
  $('#vmCountPill').textContent = vms.length;
  renderClients();
  $('#vmEmpty').hidden = vms.length > 0;
  $('#vmTable').hidden = vms.length === 0;
  $('#bulkBar').hidden = vms.length === 0;
  $('#addonHead').hidden = p.addons.length === 0;

  const rOpts = v => p.ratios.map(r => `<option value="${r.id}" ${v === r.id ? 'selected' : ''}>${esc(r.label || r.name)} — $${num(r.price)}/GB</option>`).join('');
  const sOpts = v => p.storage.map(s => `<option value="${s.id}" ${v === s.id ? 'selected' : ''}>${esc(shortTier(s.name))} — ${esc(rateStr(s))}</option>`).join('');

  $('#vmTable tbody').innerHTML = vms.map((v, i) => `
    <tr data-id="${v.id}">
      <td class="w-idx mono">${i + 1}</td>
      <td><input class="in" data-f="name" value="${esc(v.name)}" placeholder="vm-name" aria-label="VM name"></td>
      <td><div class="os-field"><input class="in" data-f="os" list="osList" value="${esc(v.os)}" placeholder="Operating system" aria-label="Operating system">${isWin(v.os) ? '<span class="badge" title="Windows SPLA applies">SPLA</span>' : ''}</div></td>
      <td><input class="in" data-f="location" list="locList" value="${esc(v.location || '')}" placeholder="Unassigned" aria-label="Data center location"></td>
      <td class="num"><input class="in num mono" type="number" min="0" step="1" data-f="ram" value="${v.ram}" aria-label="RAM in GB"></td>
      <td class="num"><input class="in num mono" type="number" min="0" step="1" data-f="disk" value="${v.disk}" aria-label="Provisioned disk in GB"></td>
      <td class="dr-cell"><label class="switch" title="Protect this VM with Zerto replication"><input type="checkbox" data-f="dr" ${v.dr ? 'checked' : ''} aria-label="Zerto DR protected"><span class="track"></span></label></td>
      <td class="num">${v.dr
        ? `<input class="in num mono" type="number" min="0" step="1" data-f="drGb" value="${v.drGb || ''}" placeholder="0" aria-label="DR storage in GB">`
        : '<span class="dash" title="Enable Zerto DR to enter DR storage">—</span>'}</td>
      <td><select data-f="ratioId" aria-label="Ratio tier">${rOpts(v.ratioId)}</select></td>
      <td><select data-f="storageId" aria-label="Storage tier">${sOpts(v.storageId)}</select></td>
      <td class="tags-td">${tagBoxHtml(v)}</td>
      <td ${p.addons.length ? '' : 'hidden'}><div class="addon-cell">${p.addons.map(a => `
          <label class="addon-chip" title="${esc(a.name)} · ${usd(a.price)} ${a.unit}"><input type="checkbox" data-addon="${a.id}" ${(v.addons || []).includes(a.id) ? 'checked' : ''}>${esc(a.sku || a.name)}</label>`).join('') || '<span class="dash">—</span>'}</div></td>
      <td class="w-act">
        <button class="btn row-x" data-dup title="Duplicate VM">⧉</button>
        <button class="btn row-x" data-del title="Delete VM">✕</button>
      </td>
    </tr>`).join('');

  syncLocationDatalist();
  syncTagDatalist();
  if (!$('#osList')) {
    const dl = document.createElement('datalist'); dl.id = 'osList';
    dl.innerHTML = ['Microsoft Windows Server 2022', 'Microsoft Windows Server 2019', 'Microsoft Windows 11', 'Ubuntu Linux 22.04', 'Red Hat Enterprise Linux 9', 'CentOS Linux 7', 'Other'].map(o => `<option value="${o}">`).join('');
    document.body.appendChild(dl);
  }
  const bulkR = $('#bulkRatio'), bulkS = $('#bulkStorage');
  bulkR.innerHTML = '<option value="">Set ratio tier for all…</option>' + p.ratios.map(r => `<option value="${r.id}">${esc(r.label || r.name)}</option>`).join('');
  $('#bulkDr').value = '';
  bulkS.innerHTML = '<option value="">Set storage tier for all…</option>' + p.storage.map(s => `<option value="${s.id}">${esc(shortTier(s.name))} — ${esc(rateStr(s))}</option>`).join('');
}
const shortTier = n => String(n).replace(/^Enterprise Cloud Storage\s*[—-]\s*/i, '');

/* Chip/token editor for one VM's tags. Type + Enter (or , ; |) to add,
   ✕ or Backspace-on-empty to remove. Suggestions come from #tagList. */
function tagBoxHtml(v) {
  const tags = tagsOf(v);
  const label = esc(v.name || 'this VM');
  return `<div class="token-box" data-tagbox="${v.id}">
    ${tags.map(t => `<span class="tag-chip">${esc(t)}<button type="button" class="chip-x" data-tagdel="${esc(t)}" aria-label="Remove tag ${esc(t)} from ${label}" title="Remove tag">✕</button></span>`).join('')}
    <input class="in tag-input" data-tagadd list="tagList" placeholder="${tags.length ? '+ tag' : 'Add tag…'}" aria-label="Add a tag to ${label}" autocomplete="off" maxlength="${TAG_MAX_LEN}">
  </div>`;
}
/* Adds whatever is typed in a row's tag input to that VM. */
function commitRowTagInput(input) {
  const tr = input.closest('tr');
  const box = input.closest('[data-tagbox]');
  if (!tr || !box) return false;
  const raw = input.value;
  if (!cleanTag(raw)) { input.value = ''; return false; }
  const vm = VMS().find(x => x.id === tr.dataset.id);
  if (!vm) return false;
  const res = normalizeTagList([...tagsOf(vm), ...String(raw).split(TAG_SPLIT)]);
  const added = res.tags.length - tagsOf(vm).length;
  vm.tags = res.tags;
  input.value = '';
  if (res.dropped.length) {
    const d = res.dropped[0];
    toast(`“${d.tag.slice(0, 40)}” skipped — ${d.why}.`, true);
  }
  if (!added && !res.dropped.length) return false;
  const id = vm.id;
  commit('inventory', { force: true }); // the chip only appears if the row re-renders
  const again = $(`[data-tagbox="${id}"] .tag-input`);
  if (again) again.focus();
  return true;
}
function removeRowTag(tr, tag) {
  const vm = VMS().find(x => x.id === tr.dataset.id);
  if (!vm) return;
  const k = String(tag).toLowerCase();
  vm.tags = tagsOf(vm).filter(t => t.toLowerCase() !== k);
  const id = vm.id;
  commit('inventory', { force: true });
  const again = $(`[data-tagbox="${id}"] .tag-input`);
  if (again) again.focus();
}

/* ================= Cost breakdown: multi-sort =================
   `ui().sort` is an ordered list of { key, dir } — index 0 is the primary key,
   index 1 the first tie-breaker, and so on. It persists per client profile in
   the same `ui` bag as the column widths. Plain header click = single sort
   (re-click reverses); Shift-click = add the column as the next priority (or
   reverse it if it is already in the list). */
const SORT_TYPES = {
  name: 'text', os: 'text', location: 'text', tags: 'text', ratio: 'text', storage: 'text',
  ram: 'num', disk: 'num', compute: 'num', vmware: 'num', storageCost: 'num', spla: 'num',
  addons: 'num', dr: 'num', total: 'num', drOn: 'bool'
};
const SORT_MAX = 4;
const sortDefaultDir = key => (SORT_TYPES[key] === 'text' ? 'asc' : 'desc');
function sortSpec() {
  const u = ui();
  if (u.sort && !Array.isArray(u.sort) && u.sort.key) u.sort = [{ key: u.sort.key, dir: u.sort.dir === 'asc' ? 'asc' : 'desc' }]; // legacy single-key state
  if (!Array.isArray(u.sort) || !u.sort.length || !u.sort.every(s => s && SORT_TYPES[s.key])) u.sort = [{ key: 'total', dir: 'desc' }];
  return u.sort;
}
function sortVal(r, key) {
  switch (key) {
    case 'name': return String(r.vm.name || '').toLowerCase();
    case 'os': return String(r.vm.os || '').toLowerCase();
    case 'location': return r.location.toLowerCase();
    case 'tags': return r.tags.map(t => t.toLowerCase()).sort().join(' ');
    case 'ratio': return String(r.ratioLabel).toLowerCase();
    case 'storage': return shortTier(String(r.storageLabel)).toLowerCase();
    case 'storageCost': return r.storage;
    case 'drOn': return r.drOn ? 1 : 0;
    default: return Number(r[key]) || 0;
  }
}
function compareRows(a, b) {
  for (const s of sortSpec()) {
    const x = sortVal(a, s.key), y = sortVal(b, s.key);
    const c = typeof x === 'string' ? x.localeCompare(y) : (x - y);
    if (c) return s.dir === 'asc' ? c : -c;
  }
  // stable, predictable final tie-break so equal rows never shuffle between renders
  return String(a.vm.name || '').localeCompare(String(b.vm.name || ''));
}
function applySortClick(key, additive) {
  if (!SORT_TYPES[key]) return;
  const spec = sortSpec();
  const i = spec.findIndex(s => s.key === key);
  if (additive) {
    if (i >= 0) spec[i].dir = spec[i].dir === 'asc' ? 'desc' : 'asc';
    else if (spec.length >= SORT_MAX) return toast(`Up to ${SORT_MAX} sort columns — remove one first (click a header without Shift to start over).`, true);
    else spec.push({ key, dir: sortDefaultDir(key) });
  } else if (i === 0 && spec.length === 1) {
    spec[0].dir = spec[0].dir === 'asc' ? 'desc' : 'asc';
  } else {
    ui().sort = [{ key, dir: sortDefaultDir(key) }];
  }
  renderResults(); save(true);
}
const SORT_LABELS = { name: 'Name', os: 'OS', location: 'Location', tags: 'Tags', ratio: 'Ratio', storage: 'Storage tier', ram: 'RAM GB', disk: 'Disk GB', compute: 'Compute $', vmware: 'VMware lic $', storageCost: 'Storage $', spla: 'Win SPLA $', addons: 'Add-ons $', dr: 'DR $', total: 'Total / mo', drOn: 'Zerto' };
function sortSummaryText() {
  return sortSpec().map((s, i) => `${i ? 'then ' : ''}${SORT_LABELS[s.key]} ${s.dir === 'asc' ? '↑' : '↓'}`).join(', ');
}
function renderSortIndicators() {
  const spec = sortSpec();
  $$('#resTable th[data-sort]').forEach(th => {
    const key = th.dataset.sort;
    const i = spec.findIndex(s => s.key === key);
    const on = i >= 0;
    th.classList.toggle('sorted', on);
    th.setAttribute('aria-sort', on ? (spec[i].dir === 'asc' ? 'ascending' : 'descending') : 'none');
    const btn = th.querySelector('.th-sort');
    if (!btn) return;
    const ind = btn.querySelector('.sind');
    if (ind) ind.textContent = on ? ((spec[i].dir === 'asc' ? '↑' : '↓') + (spec.length > 1 ? String(i + 1) : '')) : '';
    btn.title = on
      ? `Sorted ${spec[i].dir === 'asc' ? 'ascending' : 'descending'}${spec.length > 1 ? ` (priority ${i + 1} of ${spec.length})` : ''} — click to reverse, Shift-click to change its priority direction`
      : 'Click to sort by this column, Shift-click to add it as an extra sort level';
  });
}

/* ================= Cost breakdown: advanced filter builder =================
   Rules live in `ui().filters` = { join:'AND'|'OR', rules:[{id,field,op,v1,v2}] }
   and persist per client profile. A rule with no value yet is inert (counted as
   “incomplete” in the summary) so a half-built rule never hides rows. */
const FILTER_FIELDS = [
  { key: 'name', label: 'Server name', type: 'text' },
  { key: 'os', label: 'OS', type: 'text' },
  { key: 'location', label: 'Location', type: 'select', options: () => locationsAll(allCosts()) },
  { key: 'tags', label: 'Tags', type: 'tags' },
  { key: 'ratio', label: 'Ratio tier', type: 'select', options: () => P().ratios.map(r => r.label || r.name) },
  { key: 'storage', label: 'Storage tier', type: 'select', options: () => P().storage.map(s => shortTier(s.name)) },
  { key: 'drOn', label: 'Zerto DR', type: 'bool', options: () => ['Protected', 'Not protected'] },
  { key: 'windows', label: 'Windows SPLA applies', type: 'bool', options: () => ['Yes', 'No'] },
  { key: 'ram', label: 'RAM GB', type: 'num' },
  { key: 'disk', label: 'Disk GB', type: 'num' },
  { key: 'drGb', label: 'DR storage GB', type: 'num' },
  { key: 'compute', label: 'Compute $', type: 'num' },
  { key: 'vmware', label: 'VMware lic $', type: 'num' },
  { key: 'storageCost', label: 'Storage $', type: 'num' },
  { key: 'spla', label: 'Win SPLA $', type: 'num' },
  { key: 'addons', label: 'Add-ons $', type: 'num' },
  { key: 'dr', label: 'DR $', type: 'num' },
  { key: 'total', label: 'Total / mo $', type: 'num' }
];
const FILTER_OPS = {
  text: [['contains', 'contains'], ['equals', 'equals'], ['not_contains', 'does not contain'], ['starts', 'starts with'], ['empty', 'is empty']],
  num: [['eq', '='], ['ne', '≠'], ['gt', '>'], ['gte', '≥'], ['lt', '<'], ['lte', '≤'], ['between', 'between']],
  select: [['is', 'is'], ['is_not', 'is not']],
  bool: [['is', 'is'], ['is_not', 'is not']],
  tags: [['any', 'contains any of'], ['all', 'contains all of'], ['none', 'contains none of'], ['empty', 'is empty']]
};
const fieldDef = k => FILTER_FIELDS.find(f => f.key === k) || FILTER_FIELDS[0];
function filterState() {
  const u = ui();
  if (!u.filters || typeof u.filters !== 'object' || !Array.isArray(u.filters.rules)) u.filters = { join: 'AND', rules: [] };
  if (u.filters.join !== 'OR') u.filters.join = 'AND';
  u.filters.rules = u.filters.rules.filter(r => r && FILTER_FIELDS.some(f => f.key === r.field));
  return u.filters;
}
function newRule() {
  return { id: uid(), field: 'tags', op: 'any', v1: '', v2: '' };
}
/* Does this rule actually constrain the row set? */
function ruleActive(rule) {
  const f = fieldDef(rule.field);
  if (rule.op === 'empty') return true;
  if (f.type === 'num') return rule.op === 'between'
    ? isFinite(parseFloat(rule.v1)) && isFinite(parseFloat(rule.v2))
    : isFinite(parseFloat(rule.v1));
  if (f.type === 'tags') return parseTagCell(rule.v1).length > 0;
  return String(rule.v1 || '').trim() !== '';
}
function rowField(r, key) {
  switch (key) {
    case 'name': return r.vm.name || '';
    case 'os': return r.vm.os || '';
    case 'location': return r.location;
    case 'ratio': return r.ratioLabel;
    case 'storage': return shortTier(r.storageLabel);
    case 'storageCost': return r.storage;
    case 'drGb': return r.drGb;
    default: return r[key];
  }
}
function evalRule(r, rule) {
  const f = fieldDef(rule.field);
  if (f.type === 'tags') {
    const have = r.tags.map(t => t.toLowerCase());
    if (rule.op === 'empty') return have.length === 0;
    const want = parseTagCell(rule.v1).map(t => t.toLowerCase());
    if (!want.length) return true;
    if (rule.op === 'all') return want.every(t => have.includes(t));
    if (rule.op === 'none') return !want.some(t => have.includes(t));
    return want.some(t => have.includes(t)); // 'any'
  }
  if (f.type === 'num') {
    const v = Number(rowField(r, rule.field)) || 0;
    if (rule.op === 'empty') return !v;
    const a = parseFloat(rule.v1);
    if (rule.op === 'between') {
      const b = parseFloat(rule.v2);
      if (!isFinite(a) || !isFinite(b)) return true;
      return v >= Math.min(a, b) && v <= Math.max(a, b);
    }
    if (!isFinite(a)) return true;
    const cmp = { eq: v === a, ne: v !== a, gt: v > a, gte: v >= a, lt: v < a, lte: v <= a };
    return cmp[rule.op] === true;
  }
  if (f.type === 'bool') {
    const on = rule.field === 'drOn' ? r.drOn : !!r.windows;
    const want = !(String(rule.v1) === 'no');
    return rule.op === 'is_not' ? on !== want : on === want;
  }
  if (f.type === 'select') {
    const cur = String(rowField(r, rule.field) || '');
    const want = String(rule.v1 || '');
    if (!want) return true;
    const same = cur.toLowerCase() === want.toLowerCase();
    return rule.op === 'is_not' ? !same : same;
  }
  const s = String(rowField(r, rule.field) || '').toLowerCase();
  if (rule.op === 'empty') return s.trim() === '';
  const q = String(rule.v1 || '').trim().toLowerCase();
  if (!q) return true;
  if (rule.op === 'equals') return s === q;
  if (rule.op === 'not_contains') return !s.includes(q);
  if (rule.op === 'starts') return s.startsWith(q);
  return s.includes(q);
}
/* Single source of truth for “what the Cost breakdown is showing”:
   location selection → filter rules → multi-sort. Table, KPI cards, both
   roll-ups, the totals row and the “visible results” CSV export all read this. */
function computeRows() {
  const all = allCosts();
  const loc = locFilter === '' ? all : all.filter(r => r.location === locFilter);
  const F = filterState();
  const active = F.rules.filter(ruleActive);
  const filtered = active.length
    ? loc.filter(r => F.join === 'OR' ? active.some(x => evalRule(r, x)) : active.every(x => evalRule(r, x)))
    : loc;
  return { all, loc, rows: filtered.slice().sort(compareRows), active, incomplete: F.rules.length - active.length, join: F.join };
}

/* Rebuilding the rule rows on every keystroke would steal focus, so the rows are
   only re-rendered after a structural change (add/remove/clear/field/op/join). */
let rulesDirty = true;
function renderFilterUi(V) {
  const F = filterState();
  const tags = tagsUsed();
  $('#filterCountPill').textContent = String(F.rules.length);
  $$('input[name="filterJoin"]').forEach(r => { r.checked = r.value === F.join; });
  if (!rulesDirty) { renderFilterSummary(V); return; }
  rulesDirty = false;
  $('#ruleList').innerHTML = F.rules.length ? F.rules.map((rule, i) => {
    const f = fieldDef(rule.field);
    const ops = FILTER_OPS[f.type];
    if (!ops.some(o => o[0] === rule.op)) rule.op = ops[0][0];
    let valHtml;
    if (rule.op === 'empty') {
      valHtml = '<span class="rule-note muted small">no value needed</span>';
    } else if (f.type === 'num') {
      valHtml = `<input class="in num mono" type="number" step="any" data-rv="1" value="${esc(rule.v1)}" aria-label="Value" placeholder="0">`
        + (rule.op === 'between' ? `<span class="rule-and">and</span><input class="in num mono" type="number" step="any" data-rv="2" value="${esc(rule.v2)}" aria-label="Upper value" placeholder="0">` : '');
    } else if (f.type === 'select') {
      const opts = f.options();
      valHtml = `<select data-rv="1" aria-label="Value"><option value="">— choose —</option>${opts.map(o => `<option value="${esc(o)}" ${String(rule.v1) === String(o) ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    } else if (f.type === 'bool') {
      const opts = f.options();
      if (rule.v1 !== 'yes' && rule.v1 !== 'no') rule.v1 = 'yes'; // keep state in step with the shown default
      valHtml = `<select data-rv="1" aria-label="Value"><option value="yes" ${rule.v1 !== 'no' ? 'selected' : ''}>${esc(opts[0])}</option><option value="no" ${rule.v1 === 'no' ? 'selected' : ''}>${esc(opts[1])}</option></select>`;
    } else if (f.type === 'tags') {
      valHtml = `<input class="in tag-input" data-rv="1" list="tagList" value="${esc(rule.v1)}" aria-label="Tags, separated by ; , or |" placeholder="prod; tier-1" autocomplete="off">`
        + (tags.length ? `<span class="rule-note muted small">${tags.length} tag${tags.length === 1 ? '' : 's'} in inventory</span>` : '<span class="rule-note muted small">no tags yet</span>');
    } else {
      valHtml = `<input class="in" data-rv="1" value="${esc(rule.v1)}" aria-label="Value" placeholder="text…">`;
    }
    return `<div class="rule" data-rid="${rule.id}">
      <span class="rule-join mono">${i === 0 ? 'Where' : (F.join === 'OR' ? 'or' : 'and')}</span>
      <select data-rf="field" aria-label="Field for rule ${i + 1}">${FILTER_FIELDS.map(x => `<option value="${x.key}" ${x.key === rule.field ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select>
      <select data-rf="op" aria-label="Operator for rule ${i + 1}">${ops.map(o => `<option value="${o[0]}" ${o[0] === rule.op ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select>
      <span class="rule-val">${valHtml}</span>
      <button class="btn icon rule-x" data-rdel aria-label="Remove rule ${i + 1}" title="Remove this rule">✕</button>
    </div>`;
  }).join('') : '<p class="muted small no-rules">No rules yet — add one to narrow the table. The location selector above still applies on its own.</p>';
  renderFilterSummary(V);
}
function renderFilterSummary(V) {
  const parts = [];
  parts.push(`<strong>${V.rows.length}</strong> of ${V.all.length} VM${V.all.length === 1 ? '' : 's'} shown`);
  parts.push(locFilter ? `location: ${esc(locFilter)}` : 'all locations');
  parts.push(V.active.length ? `${V.active.length} active rule${V.active.length === 1 ? '' : 's'} (${V.join})` : 'no active rules');
  if (V.incomplete) parts.push(`${V.incomplete} incomplete rule${V.incomplete === 1 ? '' : 's'} ignored`);
  parts.push(`sort: ${esc(sortSummaryText())}`);
  $('#filterSummary').innerHTML = parts.join(' · ');
}

/* ================= Cost breakdown: row selection + bulk tagging ================= */
function renderSelBar(V) {
  const visibleIds = V.rows.map(r => r.vm.id);
  const live = new Set(VMS().map(v => v.id));
  Array.from(selected).forEach(id => { if (!live.has(id)) selected.delete(id); }); // deleted VMs drop out
  const n = selected.size;
  const hidden = Array.from(selected).filter(id => !visibleIds.includes(id)).length;
  $('#selCount').textContent = `${n} VM${n === 1 ? '' : 's'} selected`;
  $('#selHidden').textContent = n
    ? (hidden ? `${hidden} of them ${hidden === 1 ? 'is' : 'are'} hidden by the current filters — tag actions still apply to all ${n}.` : 'all selected rows are visible')
    : 'Tick rows in the table, or use “Select all visible”.';
  ['#btnTagAdd', '#btnTagRemove', '#btnTagReplace', '#btnSelClear'].forEach(s => { $(s).disabled = n === 0; });
  const all = $('#selAll');
  const visSel = visibleIds.filter(id => selected.has(id)).length;
  all.checked = visibleIds.length > 0 && visSel === visibleIds.length;
  all.indeterminate = visSel > 0 && visSel < visibleIds.length;
}

/* ================= RENDER: results ================= */
function renderResults() {
  const all = allCosts();
  renderLocationFilter(all);
  const V = computeRows();
  const rows = V.rows;
  const has = all.length > 0;
  $('#filterPanel').hidden = !has;
  $('#selBar').hidden = !has;
  $('#resEmpty').hidden = has;
  $('#resTable').hidden = !has;
  $('#tierRollup').hidden = !has;
  $('#locRollup').hidden = !has;
  $('#locFilterBar').hidden = !has;
  $('#summaryCards').innerHTML = '';
  if (!has) {
    $('#resultsSub').textContent = 'Monthly recurring cost per VM.';
    selected.clear();
    return;
  }
  renderFilterUi(V);
  renderSelBar(V);

  const T = rows.reduce((a, r) => ({
    compute: a.compute + r.compute, vmware: a.vmware + r.vmware, storage: a.storage + r.storage,
    spla: a.spla + r.spla, addons: a.addons + r.addons, dr: a.dr + r.dr, total: a.total + r.total,
    ram: a.ram + r.ram, disk: a.disk + r.disk, drGb: a.drGb + r.drGb, drVms: a.drVms + (r.drOn ? 1 : 0)
  }), { compute: 0, vmware: 0, storage: 0, spla: 0, addons: 0, dr: 0, total: 0, ram: 0, disk: 0, drGb: 0, drVms: 0 });
  const winCount = rows.filter(r => r.windows).length;

  const narrowed = rows.length !== all.length;
  $('#resultsSub').textContent = `${rows.length}${narrowed ? ` of ${all.length}` : ''} VM${rows.length === 1 ? '' : 's'} · ${active().name}`
    + (locFilter ? ` · location: ${locFilter}` : ` · ${locationsAll(all).length} location${locationsAll(all).length === 1 ? '' : 's'}`)
    + (V.active.length ? ` · ${V.active.length} filter rule${V.active.length === 1 ? '' : 's'} (${V.join})` : '')
    + ' · monthly recurring, USD'
    + (narrowed ? ' · KPIs, totals and roll-ups below cover the visible rows only' : '');

  $('#summaryCards').innerHTML = `
    ${kpi('Total VMs', rows.length, `${winCount} Windows · ${rows.length - winCount} non-Windows`)}
    ${kpi('Total RAM', num(T.ram) + ' GB', 'billed per GB / month')}
    ${kpi('Total disk', num(T.disk) + ' GB', num(T.disk / P().settings.divisor) + ' TB @ ÷' + P().settings.divisor)}
    ${kpi('Zerto DR', usd(T.dr), `${T.drVms} of ${rows.length} protected · ${num(T.drGb)} DR GB`)}
    ${kpi('Monthly cost', usd(T.total), usd(T.total * 12) + ' / yr', true)}
    ${kpi('Avg cost / VM', rows.length ? usd(T.total / rows.length) : '—', rows.length ? 'across visible rows' : 'no rows match')}`;

  const sorted = rows;
  const COLSPAN = 18;
  $('#resTable tbody').innerHTML = sorted.length ? sorted.map((r, i) => `
    <tr${selected.has(r.vm.id) ? ' class="rowsel-on"' : ''}>
      <td class="w-sel stick stick-1"><input type="checkbox" class="rowsel" data-id="${r.vm.id}" ${selected.has(r.vm.id) ? 'checked' : ''} aria-label="Select ${esc(r.vm.name || '(unnamed)')} for bulk tagging"></td>
      <td class="w-idx mono stick stick-2">${i + 1}</td>
      <td class="txt strong stick stick-3 stick-edge" title="${esc(r.vm.name || '(unnamed)')}">${esc(r.vm.name || '(unnamed)')}</td>
      <td class="txt"><span class="os-tag ${r.windows ? 'win' : /linux|ubuntu|centos|rhel|red hat|debian|suse/i.test(r.vm.os) ? 'lin' : ''}">${esc(r.vm.os || '—')}</span></td>
      <td class="txt loc${r.location === UNASSIGNED ? ' unassigned' : ''}" title="${esc(r.location)}">${esc(r.location)}</td>
      <td class="txt tags-cell" title="${r.tags.length ? esc(r.tags.join(', ')) : 'No tags'}">${r.tags.length ? r.tags.map(t => `<span class="tag-chip ro">${esc(t)}</span>`).join('') : '<span class="muted">—</span>'}</td>
      <td class="num">${num(r.ram)}</td>
      <td class="num">${num(r.disk)}</td>
      <td class="txt">${esc(r.ratioLabel)}</td>
      <td class="txt">${esc(shortTier(r.storageLabel))}</td>
      <td class="num${r.compute ? '' : ' zero'}">${usd(r.compute)}</td>
      <td class="num${r.vmware ? '' : ' zero'}">${usd(r.vmware)}</td>
      <td class="num${r.storage ? '' : ' zero'}">${usd(r.storage)}</td>
      <td class="num${r.spla ? '' : ' zero'}">${usd(r.spla)}</td>
      <td class="num${r.addons ? '' : ' zero'}">${usd(r.addons)}</td>
      <td class="txt w-drs"><span class="st-tag${r.drOn ? ' on' : ''}">${r.drOn ? 'Protected' : 'No DR'}</span></td>
      <td class="num${r.dr ? '' : ' zero'}"${r.drOn ? ` title="${num(r.drGb)} DR GB × $${drRateNum(drRate(P()))}/GB + ${usd(drFeeRate(P()))} fee"` : ' title="Not Zerto-protected"'}>${usd(r.dr)}</td>
      <td class="num total">${usd(r.total)}</td>
      <td class="spacer"></td>
    </tr>`).join('')
    : `<tr class="no-match"><td colspan="${COLSPAN}">No VMs match the current location and filter rules. Adjust or clear the rules above.</td><td class="spacer"></td></tr>`;

  $('#resTable tfoot').innerHTML = `<tr>
      <td class="label stick stick-1 stick-edge" colspan="3">Total · ${rows.length} VM${rows.length === 1 ? '' : 's'} shown</td>
      <td class="label" colspan="2">${locFilter ? esc(locFilter) + ' subtotal' : (V.active.length ? 'Filtered total' : 'Grand total')}</td>
      <td></td>
      <td class="num">${num(T.ram)}</td><td class="num">${num(T.disk)}</td>
      <td colspan="2"></td>
      <td class="num">${usd(T.compute)}</td><td class="num">${usd(T.vmware)}</td><td class="num">${usd(T.storage)}</td>
      <td class="num">${usd(T.spla)}</td><td class="num">${usd(T.addons)}</td>
      <td class="txt w-drs label">${T.drVms} on</td>
      <td class="num">${usd(T.dr)}</td>
      <td class="num" style="color:var(--primary)">${usd(T.total)}</td>
      <td class="spacer"></td>
    </tr>`;

  renderSortIndicators();

  $('#resStorageNote').textContent = 'Storage: ' + storageUnitSummary(P()) + '. Zerto DR: ' + drSummary(P())
    + ` · ${T.drVms} protected VM${T.drVms === 1 ? '' : 's'}.`;
  $('#resStorageNote').hidden = false;

  renderRollup(rows);
  renderLocationRollup(rows);
  syncTagDatalist();
  syncColW();
}
const locationsAll = rows => Array.from(new Set(rows.map(r => r.location))).sort(locSort);
/* “Unassigned” always sorts last */
function locSort(a, b) {
  if (a === UNASSIGNED) return 1;
  if (b === UNASSIGNED) return -1;
  return a.localeCompare(b);
}
function renderLocationFilter(all) {
  const sel = $('#locFilter');
  const locs = locationsAll(all);
  if (locFilter && !locs.includes(locFilter)) locFilter = '';
  sel.innerHTML = `<option value="">All locations (${locs.length})</option>`
    + locs.map(l => `<option value="${esc(l)}" ${l === locFilter ? 'selected' : ''}>${esc(l)} — ${all.filter(r => r.location === l).length} VM${all.filter(r => r.location === l).length === 1 ? '' : 's'}</option>`).join('');
  sel.value = locFilter;
}
function locationTotals(rows) {
  const map = new Map();
  rows.forEach(r => {
    const k = r.location;
    if (!map.has(k)) map.set(k, { location: k, vms: 0, ram: 0, disk: 0, tb: 0, compute: 0, vmware: 0, storage: 0, spla: 0, addons: 0, dr: 0, drGb: 0, drVms: 0, total: 0 });
    const o = map.get(k);
    o.vms++; o.ram += r.ram; o.disk += r.disk; o.tb += r.tb;
    o.compute += r.compute; o.vmware += r.vmware; o.storage += r.storage;
    o.spla += r.spla; o.addons += r.addons; o.dr += r.dr;
    o.drGb += r.drGb; o.drVms += r.drOn ? 1 : 0; o.total += r.total;
  });
  return Array.from(map.values()).sort((a, b) => locSort(a.location, b.location));
}
function renderLocationRollup(rows) {
  const groups = locationTotals(rows);
  const G = groups.reduce((a, g) => ({
    vms: a.vms + g.vms, ram: a.ram + g.ram, disk: a.disk + g.disk,
    compute: a.compute + g.compute, vmware: a.vmware + g.vmware, storage: a.storage + g.storage,
    spla: a.spla + g.spla, addons: a.addons + g.addons, dr: a.dr + g.dr, total: a.total + g.total
  }), { vms: 0, ram: 0, disk: 0, compute: 0, vmware: 0, storage: 0, spla: 0, addons: 0, dr: 0, total: 0 });

  $('#locRollupCount').textContent = `${groups.length} location${groups.length === 1 ? '' : 's'}`;
  $('#locationRollup tbody').innerHTML = groups.map(g => `<tr>
      <td class="strong${g.location === UNASSIGNED ? ' unassigned' : ''}">${esc(g.location)}</td>
      <td class="num mono">${g.vms}</td>
      <td class="num mono">${num(g.ram)}</td>
      <td class="num mono">${num(g.disk)}</td>
      <td class="num mono${g.compute ? '' : ' zero'}">${usd(g.compute)}</td>
      <td class="num mono${g.vmware ? '' : ' zero'}">${usd(g.vmware)}</td>
      <td class="num mono${g.storage ? '' : ' zero'}">${usd(g.storage)}</td>
      <td class="num mono${g.spla ? '' : ' zero'}">${usd(g.spla)}</td>
      <td class="num mono${g.addons ? '' : ' zero'}">${usd(g.addons)}</td>
      <td class="num mono${g.dr ? '' : ' zero'}" title="${g.drVms} protected VM${g.drVms === 1 ? '' : 's'} · ${num(g.drGb)} DR GB">${usd(g.dr)}</td>
      <td class="num mono strong">${usd(g.total)}</td>
      <td class="num mono muted">${G.total ? (g.total / G.total * 100).toFixed(1) : '0.0'}%</td>
    </tr>`).join('');
  $('#locationRollup tfoot').innerHTML = `<tr>
      <td class="label">All locations</td>
      <td class="num">${G.vms}</td><td class="num">${num(G.ram)}</td><td class="num">${num(G.disk)}</td>
      <td class="num">${usd(G.compute)}</td><td class="num">${usd(G.vmware)}</td><td class="num">${usd(G.storage)}</td>
      <td class="num">${usd(G.spla)}</td><td class="num">${usd(G.addons)}</td><td class="num">${usd(G.dr)}</td>
      <td class="num" style="color:var(--primary)">${usd(G.total)}</td><td class="num">100%</td>
    </tr>`;
}
function kpi(k, v, s, hero) {
  return `<div class="kpi${hero ? ' hero' : ''}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
}

function renderRollup(rows) {
  const p = P(), out = [];
  p.ratios.forEach(rt => {
    const rr = rows.filter(r => r.ratio && r.ratio.id === rt.id);
    if (!rr.length) return;
    const ram = rr.reduce((a, r) => a + r.ram, 0);
    out.push([rt.sku, `${rt.name} (${rr.length} VM${rr.length > 1 ? 's' : ''})`, num(ram) + ' GB RAM', usd(rt.price) + ' /GB', rr.reduce((a, r) => a + r.compute, 0)]);
  });
  if (p.vmwareLic.enabled) {
    const ram = rows.reduce((a, r) => a + r.ram, 0);
    out.push([p.vmwareLic.sku, p.vmwareLic.name, num(ram) + ' GB RAM', usd(p.vmwareLic.price) + ' /GB', rows.reduce((a, r) => a + r.vmware, 0)]);
  }
  p.storage.forEach(st => {
    const rr = rows.filter(r => r.storageTier && r.storageTier.id === st.id);
    if (!rr.length) return;
    const u = SU(st);
    const qty = rr.reduce((a, r) => a + (u === 'GB' ? r.disk : r.tb), 0);
    out.push([st.sku, `${st.name} (${rr.length} VM${rr.length > 1 ? 's' : ''})`, num(qty) + ' ' + u, '$' + rateNum(st) + ' /' + u, rr.reduce((a, r) => a + r.storage, 0)]);
  });
  // Zerto DR: two rows — metered DR storage (total GB) and the flat per-protected-VM fee
  const prot = rows.filter(r => r.drOn);
  if (prot.length) {
    const gb = prot.reduce((a, r) => a + r.drGb, 0);
    out.push([p.dr.storage.sku, `${p.dr.storage.name} (${prot.length} protected VM${prot.length > 1 ? 's' : ''})`,
      num(gb) + ' GB', '$' + drRateNum(drRate(p)) + ' /GB', prot.reduce((a, r) => a + r.drStorage, 0)]);
    out.push([p.dr.fee.sku, `${p.dr.fee.name} (${prot.length} protected VM${prot.length > 1 ? 's' : ''})`,
      prot.length + ' VMs', usd(drFeeRate(p)) + ' /VM', prot.reduce((a, r) => a + r.drFee, 0)]);
  }
  const wins = rows.filter(r => r.windows);
  if (wins.length) out.push([p.spla.sku, p.spla.name, wins.length + ' VMs', usd(p.spla.price) + ' /VM', wins.reduce((a, r) => a + r.spla, 0)]);
  p.addons.forEach(a => {
    const det = rows.flatMap(r => r.addonDetail.filter(d => d.addon.id === a.id));
    if (!det.length) return;
    const q = det.reduce((s, d) => s + d.qty, 0);
    const unit = a.unit === 'per-vm' ? 'VMs' : a.unit === 'per-gb-ram' ? 'GB RAM' : 'TB';
    out.push([a.sku, a.name + ` (${det.length} VMs)`, num(q) + ' ' + unit, usd(a.price), det.reduce((s, d) => s + d.amt, 0)]);
  });
  $('#skuRollup tbody').innerHTML = out.map(o => `<tr>
      <td class="mono">${esc(o[0] || '—')}</td><td>${esc(o[1])}</td>
      <td class="num mono">${o[2]}</td><td class="num mono">${o[3]}</td><td class="num mono strong">${usd(o[4])}</td></tr>`).join('');
}

/* ================= client profiles ================= */
function renderClients() {
  const sel = $('#clientSelect');
  sel.innerHTML = Object.values(state.clients)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(c => `<option value="${c.id}" ${c.id === state.activeId ? 'selected' : ''}>${esc(c.name)} (${c.vms.length} VM${c.vms.length === 1 ? '' : 's'})</option>`).join('');
}
function renderAll() { rulesDirty = true; renderChrome(); renderPricing(); renderVms(); renderResults(); }

/* ================= reactivity core =================
   Single source of truth is `state`. Every tab re-renders from state when it
   becomes visible, and every mutation refreshes the shared chrome plus any
   currently visible view that did not originate the edit (so a focused input
   is never blown away mid-typing). Result: no tab can ever show stale data. */
const TABS = ['pricing', 'inventory', 'results'];
const activeTab = () => { const t = $('.tab.active'); return t ? t.dataset.tab : 'pricing'; };
function renderTab(name) {
  if (name === 'pricing') renderPricing();
  else if (name === 'inventory') renderVms();
  else if (name === 'results') renderResults();
}
/* chrome = UI shared by every tab: client picker, inventory count badge, location autocomplete */
function renderChrome() {
  renderClients();
  $('#vmCountPill').textContent = VMS().length;
  syncLocationDatalist();
}
/* Called after any state mutation. `origin` is the tab the edit came from — it
   already reflects the change in its own DOM, so it is not re-rendered unless
   `force` is set (results has no text inputs, so it always re-renders). */
function commit(origin, opts) {
  const o = opts || {};
  renderChrome();
  const cur = activeTab();
  if (cur !== origin || o.force || cur === 'results') renderTab(cur);
  if (o.silent !== false) save(true);
}
/* Guard: a VM must never point at a tier that no longer exists. */
function reconcileVmTiers() {
  const p = P();
  const dR = (p.ratios.find(r => r.isDefault) || p.ratios[0] || {}).id || '';
  const dS = (p.storage.find(s => s.isDefault) || p.storage[0] || {}).id || '';
  const okA = new Set(p.addons.map(a => a.id));
  VMS().forEach(v => {
    normalizeVmDr(v); // DR flag/GB always well-formed, whatever the profile vintage
    if (!p.ratios.some(r => r.id === v.ratioId)) v.ratioId = dR;
    if (!p.storage.some(s => s.id === v.storageId)) v.storageId = dS;
    v.addons = (v.addons || []).filter(a => okA.has(a));
  });
}

/* ================= results table: resizable + frozen columns =================
   Widths live in <col> elements (cheap, no per-cell writes) and persist per
   client profile. The first three columns (select checkbox, # and Name) are
   position:sticky, so the sticky offset of column 2 tracks column 1's live
   width and column 3's offset tracks columns 1 + 2. */
/* select box, #, Name, Tags (chips need room or every row grows three lines tall) */
const COLW_MIN = i => (i === 0 ? 44 : i === 1 ? 34 : i === 2 ? 120 : i === 5 ? 150 : 56);
const COLW_MAX = 720;
let suppressSort = false;
const resCols = () => $$('#resTable colgroup col:not(.spacer)');
const resHeads = () => $$('#resTable thead th:not(.spacer)');
function ui() { const c = active(); if (!c.ui || typeof c.ui !== 'object') c.ui = {}; return c.ui; }
function savedColW() {
  const w = ui().resColW;
  return Array.isArray(w) && w.length === resCols().length && w.every(n => isFinite(n) && n > 0) ? w.slice() : null;
}
function applyColW(w) {
  const t = $('#resTable');
  resCols().forEach((c, i) => { c.style.width = w[i] + 'px'; });
  t.classList.add('cols-fixed');
  // width:100% + min-width:sum lets the trailing spacer column absorb any slack
  t.style.width = '100%';
  t.style.minWidth = w.reduce((a, n) => a + n, 0) + 'px';
  t.style.setProperty('--stick-1w', w[0] + 'px');
  t.style.setProperty('--stick-2w', w[1] + 'px');
}
/* Natural (content-driven) widths: drop the fixed layout, let the browser lay
   the table out, then read each header cell back. */
function measureColW() {
  const t = $('#resTable');
  const prevW = t.style.width, prevMin = t.style.minWidth;
  t.classList.remove('cols-fixed');
  t.style.width = ''; t.style.minWidth = '';
  resCols().forEach(c => { c.style.width = ''; });
  /* Reserve room for the sort arrow + priority number on every sortable header,
     otherwise a column clips its own label the moment it joins the sort. */
  const w = resHeads().map((th, i) => {
    const pad = th.querySelector('.th-sort') ? 30 : 2;
    return Math.min(COLW_MAX, Math.max(COLW_MIN(i), Math.ceil(th.getBoundingClientRect().width) + pad));
  });
  t.style.width = prevW; t.style.minWidth = prevMin;
  return w;
}
function syncColW() {
  const t = $('#resTable');
  if (t.hidden || !t.offsetParent) return; // hidden tab measures as 0 — redone on activation
  let w = savedColW();
  if (!w) { w = measureColW(); ui().resColW = w; }
  applyColW(w);
}
function resetColW(quiet) {
  ui().resColW = null;
  const t = $('#resTable');
  if (t.hidden || !t.offsetParent) return;
  const w = measureColW(); ui().resColW = w; applyColW(w); save(true);
  if (!quiet) toast('Column widths auto-fitted to content.');
}
function autoFitCol(i) {
  const cur = savedColW() || measureColW();
  const nat = measureColW();
  cur[i] = nat[i];
  applyColW(cur); ui().resColW = cur; save(true);
}
function initColResize() {
  const ths = resHeads();
  ths.forEach((th, i) => {
    const h = document.createElement('span');
    h.className = 'col-resizer';
    h.dataset.i = String(i);
    h.setAttribute('role', 'separator');
    h.setAttribute('aria-orientation', 'vertical');
    h.title = 'Drag to resize · double-click to auto-fit';
    th.appendChild(h);
  });
  let drag = null;
  const head = $('#resTable thead');
  head.addEventListener('pointerdown', e => {
    const h = e.target.closest('.col-resizer'); if (!h) return;
    e.preventDefault(); e.stopPropagation();
    const i = Number(h.dataset.i);
    const arr = savedColW() || measureColW();
    drag = { i, x: e.clientX, w: arr[i], arr };
    suppressSort = true;
    $('#resTable').classList.add('resizing');
    document.body.classList.add('col-resizing');
    try { h.setPointerCapture(e.pointerId); } catch (err) { /* not fatal */ }
  });
  const move = e => {
    if (!drag) return;
    const w = Math.min(COLW_MAX, Math.max(COLW_MIN(drag.i), Math.round(drag.w + (e.clientX - drag.x))));
    drag.arr[drag.i] = w;
    applyColW(drag.arr);
  };
  const end = () => {
    if (!drag) return;
    ui().resColW = drag.arr.slice();
    drag = null;
    $('#resTable').classList.remove('resizing');
    document.body.classList.remove('col-resizing');
    save(true);
    setTimeout(() => { suppressSort = false; }, 250); // let the trailing click pass without sorting
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  head.addEventListener('dblclick', e => {
    const h = e.target.closest('.col-resizer'); if (!h) return;
    e.preventDefault(); e.stopPropagation();
    suppressSort = true;
    autoFitCol(Number(h.dataset.i));
    setTimeout(() => { suppressSort = false; }, 250);
  });
  head.addEventListener('click', e => { if (e.target.closest('.col-resizer')) e.stopPropagation(); }, true);
  // right-edge shadow only once the table is actually scrolled sideways
  const wrap = $('#resTable').closest('.table-scroll');
  const onScroll = () => wrap.classList.toggle('xscrolled', wrap.scrollLeft > 0);
  wrap.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  window.addEventListener('resize', () => { if (!savedColW()) syncColW(); });
}

/* ================= CSV helpers ================= */
function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime || 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
/* Tags column uses the canonical semicolon delimiter inside one quoted cell. */
const SAMPLE_CSV = `Name,OS,Location,RAM_GB,Disk_GB,Zerto,DR_Storage_GB,Ratio,StorageTier,Tags
WEB01,Microsoft Windows Server 2022,Columbus - DUB,16,200,yes,250,4:1,Standard Flash,"prod;web;tier-1"
SQL01,Microsoft Windows Server 2019,Columbus - DUB,64,1024,yes,1200,2:1,High Performance Flash,"prod;database;tier-1"
APP01,Ubuntu Linux 22.04,Indianapolis - 701 Congressional,32,500,no,,4:1,Standard Flash,"prod;app"
FILE01,Microsoft Windows Server 2022,Indianapolis - 701 Congressional,8,1500,no,,4:1,Standard Flash,"archive;file-services"
`;

/* CSV DR flag parsing: accept the common truthy spellings used in inventory exports */
function parseDrFlag(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return false;
  return ['yes', 'y', 'true', 't', '1', 'x', 'on', 'enabled', 'protected', 'replicated', 'active'].includes(s);
}

const FIELDS = [
  { key: 'name', label: 'VM name', req: true, hints: ['name', 'vm', 'vm name', 'vmname', 'virtual machine', 'hostname', 'server'] },
  { key: 'os', label: 'Operating system', req: false, hints: ['os', 'os according to the configuration file', 'guest os', 'guest', 'operating system', 'os according to the vmware tools'] },
  { key: 'ram', label: 'RAM', req: true, hints: ['ram', 'ram_gb', 'ram gb', 'memory', 'memory mb', 'memory (gb)', 'memory size', 'mem'] },
  { key: 'disk', label: 'Provisioned disk', req: true, hints: ['disk', 'disk_gb', 'disk gb', 'provisioned', 'provisioned mb', 'provisioned mib', 'storage', 'total disk capacity', 'capacity', 'in use mb', 'allocated'],
    /* a DR/replication size column is not the provisioned-disk column */
    avoid: /\b(dr|zerto|journal|replica|draas)\b|disaster recovery|replication/ },
  { key: 'location', label: 'Location (optional)', req: false, hints: ['location', 'site', 'datacenter', 'data center', 'dc', 'data centre', 'facility', 'region', 'site name', 'dc name', 'location name'] },
  { key: 'drFlag', label: 'Zerto DR protected (optional)', req: false, hints: ['zerto', 'dr', 'dr protected', 'dr flag', 'disaster recovery', 'replicated', 'replication', 'protected', 'zerto protected', 'zerto dr', 'draas'],
    /* never grab a size column (“DR Storage GB”, “Journal MB”…) as the on/off flag */
    avoid: /\b(gb|mb|tb|gib|mib|tib)\b|size|capacity|journal|replica/ },
  { key: 'drGb', label: 'DR storage (optional)', req: false, hints: ['dr gb', 'dr storage', 'dr storage gb', 'zerto gb', 'journal', 'journal gb', 'replica', 'replica gb', 'dr size', 'replication gb', 'dr capacity'] },
  { key: 'ratio', label: 'Ratio tier (optional)', req: false, hints: ['ratio', 'ratio tier', 'processor ratio', 'tier', 'compute tier'] },
  { key: 'storage', label: 'Storage tier (optional)', req: false, hints: ['storagetier', 'storage tier', 'storage_tier', 'datastore', 'storage policy', 'storage profile', 'policy'] },
  /* One cell may hold several tags separated by ; , or | — see parseTagCell(). */
  { key: 'tags', label: 'Tags (optional)', req: false, hints: ['tags', 'tag', 'labels', 'label', 'categories', 'category', 'tag list', 'custom attributes', 'annotation'] }
];

function autoMap(headers) {
  const map = {}; const used = new Set();
  const norm = h => String(h).toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
  FIELDS.forEach(f => {
    let best = '';
    for (const h of headers) {
      if (used.has(h)) continue;
      const n = norm(h);
      if (f.hints.includes(n)) { best = h; break; }
    }
    if (!best) for (const h of headers) {
      if (used.has(h)) continue;
      const n = norm(h);
      if (f.avoid && f.avoid.test(n)) continue;
      // short hints (dc, os, vm, ram…) must match as whole words to avoid false positives like “Org vDC” → DC
      if (f.hints.some(x => x.length <= 3
        ? new RegExp('\\b' + x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(n)
        : n.includes(x))) { best = h; break; }
    }
    if (best) { map[f.key] = best; used.add(best); }
  });
  return map;
}
function guessUnit(header, kind) {
  const h = String(header || '').toLowerCase();
  if (/\bmib?\b|\bmb\b/.test(h)) return 'MB';
  if (/\btib?\b|\btb\b/.test(h)) return kind === 'disk' ? 'TB' : 'GB';
  return 'GB';
}
function matchTier(list, value, keyFields) {
  const v = String(value || '').toLowerCase().trim();
  if (!v) return null;
  for (const t of list) {
    for (const kf of keyFields) {
      const tv = String(t[kf] || '').toLowerCase();
      if (!tv) continue;
      if (tv === v || shortTier(tv) === v) return t;
    }
  }
  for (const t of list) {
    for (const kf of keyFields) {
      const tv = shortTier(String(t[kf] || '').toLowerCase());
      if (tv && (tv.includes(v) || v.includes(tv))) return t;
    }
  }
  return null;
}

function openMapper(file, parsed) {
  pending = { file, rows: parsed.data, headers: parsed.meta.fields || [], map: autoMap(parsed.meta.fields || []) };
  const p = P();
  $('#mapFileInfo').innerHTML = `<span class="mono">${esc(file.name)}</span> · ${pending.rows.length} data row${pending.rows.length === 1 ? '' : 's'} · ${pending.headers.length} columns detected. Auto-mapping applied where recognised — adjust below.`;
  $('#mapGrid').innerHTML = FIELDS.map(f => `
    <label class="field"><span>${f.label}${f.req ? ' <span class="req">*</span>' : ''}</span>
      <select data-map="${f.key}">
        <option value="">— not mapped —</option>
        ${pending.headers.map(h => `<option value="${esc(h)}" ${pending.map[f.key] === h ? 'selected' : ''}>${esc(h)}</option>`).join('')}
      </select></label>`).join('');
  $('#mapDiskUnit').value = guessUnit(pending.map.disk, 'disk');
  $('#mapRamUnit').value = guessUnit(pending.map.ram, 'ram');
  $('#mapDrUnit').value = guessUnit(pending.map.drGb, 'disk');
  $('#mapRatio').innerHTML = p.ratios.map(r => `<option value="${r.id}" ${r.isDefault ? 'selected' : ''}>${esc(r.label || r.name)}</option>`).join('');
  $('#mapStorage').innerHTML = p.storage.map(s => `<option value="${s.id}" ${s.isDefault ? 'selected' : ''}>${esc(shortTier(s.name))} — ${esc(rateStr(s))}</option>`).join('');
  syncLocationDatalist();
  $('#mapLocation').value = '';
  /* Smart default: enrichment files (name mapped, no RAM/disk columns) against an
     existing inventory almost always mean "merge", not append. */
  const enrichment = VMS().length && pending.map.name && !pending.map.ram && !pending.map.disk;
  $('#mapMode').value = enrichment ? 'merge' : (VMS().length ? 'append' : 'replace');
  $('#mapUnmatched').value = 'add';
  $('#mapModal').hidden = false;
  refreshPreview();
}
function readMap() {
  const m = {}; $$('#mapGrid select').forEach(s => { if (s.value) m[s.dataset.map] = s.value; });
  return m;
}
/* ---------------- CSV import: mode helpers ---------------- */
/* Import modes: replace · append · merge (update existing VMs matched by name). */
function importMode() { const el = $('#mapMode'); return el ? el.value : 'append'; }
function unmatchedAction() { const el = $('#mapUnmatched'); return el ? el.value : 'add'; }
/* Merge matching is case-insensitive and whitespace-trimmed. */
const nameKey = s => String(s ?? '').trim().toLowerCase();

/* Builds one entry per CSV row:
   `full`  = a complete new VM (used by replace/append and by merge's "add unmatched")
   `patch` = ONLY the fields actually mapped in the modal (used by merge, so unmapped
             fields — and the fallback tier/location selectors — never clobber existing data). */
function buildImport() {
  const m = readMap(), p = P(), mode = importMode();
  const dScale = { GB: 1, MB: 1 / 1024, TB: 1024 }[$('#mapDiskUnit').value];
  const rScale = { GB: 1, MB: 1 / 1024 }[$('#mapRamUnit').value];
  const drScale = { GB: 1, MB: 1 / 1024, TB: 1024 }[$('#mapDrUnit').value];
  const fbR = $('#mapRatio').value, fbS = $('#mapStorage').value;
  const fbLoc = String($('#mapLocation').value || '').trim();
  const warns = [];
  const vms = [], entries = [];
  pending.rows.forEach((row, i) => {
    const name = m.name ? String(row[m.name] ?? '').trim() : '';
    const ramRaw = m.ram ? parseFloat(String(row[m.ram]).replace(/[^0-9.\-]/g, '')) : NaN;
    const diskRaw = m.disk ? parseFloat(String(row[m.disk]).replace(/[^0-9.\-]/g, '')) : NaN;
    const drGbRaw = m.drGb ? parseFloat(String(row[m.drGb]).replace(/[^0-9.\-]/g, '')) : NaN;
    if (!name && !isFinite(ramRaw) && !isFinite(diskRaw)) return; // blank row
    if (!name) warns.push(mode === 'merge'
      ? `Row ${i + 2}: missing name — cannot be matched, skipped.`
      : `Row ${i + 2}: missing name — imported as “(unnamed)”.`);
    if (m.ram && !isFinite(ramRaw)) warns.push(`Row ${i + 2}: RAM not numeric — set to 0.`);
    if (m.disk && !isFinite(diskRaw)) warns.push(`Row ${i + 2}: disk not numeric — set to 0.`);
    const drGb = r2((isFinite(drGbRaw) ? drGbRaw : 0) * drScale);
    // If only the GB column is mapped, a positive DR footprint implies the VM is protected.
    const drOn = m.drFlag ? parseDrFlag(row[m.drFlag]) : (m.drGb ? drGb > 0 : false);
    if (m.drFlag && drOn && m.drGb && !(drGb > 0)) warns.push(`Row ${i + 2}: Zerto DR flagged on but no DR storage GB — only the flat fee will apply.`);
    const rt = m.ratio ? matchTier(p.ratios, row[m.ratio], ['label', 'name', 'sku']) : null;
    const st = m.storage ? matchTier(p.storage, row[m.storage], ['name', 'sku']) : null;
    if (m.ratio && !rt && String(row[m.ratio] || '').trim()) warns.push(`Row ${i + 2}: ratio “${row[m.ratio]}” not recognised — ${mode === 'merge' ? 'tier left unchanged' : 'using fallback tier'}.`);
    if (m.storage && !st && String(row[m.storage] || '').trim()) warns.push(`Row ${i + 2}: storage tier “${row[m.storage]}” not recognised — ${mode === 'merge' ? 'tier left unchanged' : 'using fallback tier'}.`);

    const full = {
      id: uid(),
      name: name || '(unnamed)',
      os: m.os ? String(row[m.os] ?? '').trim() : '',
      location: (m.location ? String(row[m.location] ?? '').trim() : '') || fbLoc,
      ram: r2((isFinite(ramRaw) ? ramRaw : 0) * rScale),
      disk: r2((isFinite(diskRaw) ? diskRaw : 0) * dScale),
      dr: drOn,
      drGb: drOn ? drGb : 0,
      ratioId: rt ? rt.id : fbR,
      storageId: st ? st.id : fbS,
      tags: m.tags ? parseTagCell(row[m.tags]) : [],
      addons: p.addons.filter(a => a.defaultOn).map(a => a.id)
    };

    /* patch: mapped fields only. Blank cells in a mapped column are treated as
       "no data for this row" and are skipped, except the DR flag (an explicit
       "no"/blank flag legitimately means unprotected). */
    const patch = {};
    if (m.os && String(row[m.os] ?? '').trim() !== '') patch.os = String(row[m.os]).trim();
    if (m.location && String(row[m.location] ?? '').trim() !== '') patch.location = String(row[m.location]).trim();
    if (m.ram && isFinite(ramRaw)) patch.ram = r2(ramRaw * rScale);
    if (m.disk && isFinite(diskRaw)) patch.disk = r2(diskRaw * dScale);
    if (m.drFlag) { patch.dr = drOn; patch.drGb = drOn ? (m.drGb ? drGb : undefined) : 0; if (patch.drGb === undefined) delete patch.drGb; }
    else if (m.drGb && isFinite(drGbRaw)) { patch.dr = drOn; patch.drGb = drOn ? drGb : 0; }
    if (rt) patch.ratioId = rt.id;
    if (st) patch.storageId = st.id;
    /* Tags: a blank cell means “no tag data for this row”, so existing tags survive.
       A populated cell replaces the VM's tag list (predictable and round-trips). */
    if (m.tags && String(row[m.tags] ?? '').trim() !== '') patch.tags = parseTagCell(row[m.tags]);

    vms.push(full);
    entries.push({ row: i + 2, name, full, patch, fields: Object.keys(patch) });
  });
  const missing = mode === 'merge'
    ? (m.name ? [] : ['VM name'])
    : FIELDS.filter(f => f.req && !m[f.key]).map(f => f.label);
  return { vms, entries, warns, missing, mode, map: m };
}

/* Plans a merge without mutating state — used for both the preview and the commit. */
function planMerge(entries, action) {
  const inv = VMS();
  const idx = new Map();
  inv.forEach(v => { const k = nameKey(v.name); if (!idx.has(k)) idx.set(k, []); idx.get(k).push(v); });
  const dupCsv = [], noName = [];
  const last = new Map(); // CSV duplicates: last row wins
  entries.forEach(e => {
    if (!e.name) { noName.push(e.row); return; }
    const k = nameKey(e.name);
    if (last.has(k)) dupCsv.push(e.name);
    last.set(k, e);
  });
  const updates = [], adds = [], unmatched = [], dupInv = [];
  last.forEach((e, k) => {
    const targets = idx.get(k) || [];
    if (targets.length) {
      if (targets.length > 1) dupInv.push({ name: targets[0].name, n: targets.length });
      updates.push({ entry: e, targets });
    } else {
      unmatched.push(e.name);
      if (action === 'add') adds.push(e);
    }
  });
  return {
    updates, adds, unmatched, dupCsv, dupInv, noName,
    matchedRows: updates.length,
    updatedVms: updates.reduce((a, u) => a + u.targets.length, 0),
    added: adds.length,
    skipped: (action === 'add' ? 0 : unmatched.length) + noName.length
  };
}
/* Keeps the mode selector honest: merge needs a mapped Name column and existing VMs. */
function syncModeUi(mapped) {
  const sel = $('#mapMode'), opt = $('#mapModeMerge');
  if (!sel || !opt) return importMode();
  const nameOk = !!mapped.name, hasVms = VMS().length > 0;
  const why = !hasVms ? ' (no existing VMs)' : (!nameOk ? ' (map VM name first)' : '');
  opt.textContent = 'Merge / update existing VMs' + why;
  opt.disabled = !nameOk || !hasVms;
  if (opt.disabled && sel.value === 'merge') sel.value = hasVms ? 'append' : 'replace';
  const uf = $('#mapUnmatchedField');
  if (uf) uf.hidden = sel.value !== 'merge';
  /* in merge mode only the name column is required — hide the other required markers */
  $('#mapGrid').classList.toggle('merge', sel.value === 'merge');
  return sel.value;
}

function refreshPreview() {
  const built = buildImport();
  const mode = syncModeUi(built.map);
  /* selector may have flipped out of merge — rebuild so patches/warnings match the mode */
  const b = (mode === built.mode) ? built : buildImport();
  const ent = b.entries, miss = b.missing, wrn = b.warns.slice();
  const merge = mode === 'merge';
  const plan = merge ? planMerge(ent, unmatchedAction()) : null;

  const unchanged = '<span class="dash" title="left unchanged">unchanged</span>';
  /* rows that will be inserted as new VMs show their real (defaulted) values;
     rows that update an existing VM show “unchanged” for every unmapped field */
  const isAdd = e => !!plan && plan.adds.includes(e);
  const cell = (e, field, html) => (merge && !isAdd(e) && !e.fields.includes(field)) ? unchanged : html;
  const head = (merge ? ['Action'] : []).concat(['Name', 'OS', 'Location', 'RAM GB', 'Disk GB', 'Zerto DR', 'DR GB', 'Ratio', 'Storage tier', 'Tags']);
  const action = e => {
    if (!e.name) return '<span class="tag skip">skip</span>';
    const hit = (plan.updates.find(u => nameKey(u.entry.name) === nameKey(e.name)) || {});
    if (hit.targets && hit.entry === e) return `<span class="tag upd">update${hit.targets.length > 1 ? ' ×' + hit.targets.length : ''}</span>`;
    if (hit.targets) return '<span class="tag skip">superseded</span>';
    if (plan.adds.includes(e)) return '<span class="tag new">add new</span>';
    const dup = plan.dupCsv.length && ent.some(o => o !== e && nameKey(o.name) === nameKey(e.name) && ent.indexOf(o) > ent.indexOf(e));
    return dup ? '<span class="tag skip">superseded</span>' : '<span class="tag skip">skip</span>';
  };
  const rows = ent.slice(0, 8).map(e => {
    const v = e.full;
    return `<tr>${merge ? `<td>${action(e)}</td>` : ''}
      <td>${esc(v.name)}</td>
      <td>${cell(e, 'os', esc(v.os) || '<span class="dash">—</span>')}</td>
      <td class="${!merge && !v.location ? 'unassigned' : ''}">${cell(e, 'location', v.location ? esc(v.location) : `<span class="unassigned">${UNASSIGNED}</span>`)}</td>
      <td class="num mono">${cell(e, 'ram', num(v.ram))}</td>
      <td class="num mono">${cell(e, 'disk', num(v.disk))}</td>
      <td class="${v.dr ? 'mono' : 'unassigned'}">${cell(e, 'dr', v.dr ? 'yes' : 'no')}</td>
      <td class="num mono">${cell(e, 'drGb', v.dr ? num(v.drGb) : '<span class="dash">—</span>')}</td>
      <td>${cell(e, 'ratioId', esc((P().ratios.find(r => r.id === v.ratioId) || {}).label || '—'))}</td>
      <td>${cell(e, 'storageId', esc(shortTier((P().storage.find(s => s.id === v.storageId) || {}).name || '—')))}</td>
      <td>${cell(e, 'tags', (v.tags || []).length ? (v.tags || []).map(t => `<span class="tag-chip ro">${esc(t)}</span>`).join('') : '<span class="dash">—</span>')}</td></tr>`;
  }).join('');
  $('#mapPreview thead').innerHTML = `<tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>`;
  $('#mapPreview tbody').innerHTML = rows || `<tr><td colspan="${head.length}" class="muted">No importable rows with the current mapping.</td></tr>`;
  $('#mapPrevInfo').textContent = merge
    ? `${ent.length} row(s) · ${plan.updatedVms} VM${plan.updatedVms === 1 ? '' : 's'} to update · ${plan.added} to add · ${plan.skipped} skipped · showing first ${Math.min(8, ent.length)}`
    : `${ent.length} row(s) ready · showing first ${Math.min(8, ent.length)}`;

  const msgs = [];
  if (miss.length) {
    msgs.push(`<strong>Required column${miss.length > 1 ? 's' : ''} not mapped:</strong> ${miss.join(', ')} — the Import button is disabled until ${miss.length > 1 ? 'these are' : 'this is'} mapped.`);
    if (!merge && b.map.name && VMS().length)
      msgs.push(`<strong>Tip:</strong> only enriching existing VMs (e.g. adding Zerto DR data)? Switch <em>Existing VMs</em> to <strong>Merge / update existing VMs</strong> — merge matches by server name, needs only the VM name column, and writes only the columns you mapped.`);
  }
  if (merge) {
    const fields = ent.length ? Array.from(new Set([].concat(...ent.map(e => e.fields)))) : [];
    msgs.push(`<strong>Merge mode:</strong> matches existing VMs by name (case-insensitive). Only mapped fields are written — ${fields.length ? '<span class="mono">' + fields.map(esc).join(', ') + '</span>' : 'nothing yet'}. Fallback tiers and the default location apply to newly added rows only.`);
    if (plan.dupCsv.length) msgs.push(`<strong>Duplicate name${plan.dupCsv.length > 1 ? 's' : ''} in CSV:</strong> ${plan.dupCsv.slice(0, 5).map(esc).join(', ')}${plan.dupCsv.length > 5 ? ` …+${plan.dupCsv.length - 5}` : ''} — the last row for each name wins.`);
    if (plan.dupInv.length) msgs.push(`<strong>Duplicate name${plan.dupInv.length > 1 ? 's' : ''} in inventory:</strong> ${plan.dupInv.slice(0, 5).map(d => esc(d.name) + ' ×' + d.n).join(', ')} — every match will be updated.`);
    if (plan.unmatched.length) msgs.push(`<strong>${plan.unmatched.length} row${plan.unmatched.length > 1 ? 's' : ''} with no matching VM:</strong> ${plan.unmatched.slice(0, 5).map(esc).join(', ')}${plan.unmatched.length > 5 ? ` …+${plan.unmatched.length - 5}` : ''} — will be ${unmatchedAction() === 'add' ? 'added as new VMs' : 'skipped'}.`);
  }
  if (wrn.length) msgs.push(`<strong>${wrn.length} row note${wrn.length > 1 ? 's' : ''}:</strong><br>` + wrn.slice(0, 6).map(esc).join('<br>') + (wrn.length > 6 ? `<br>…and ${wrn.length - 6} more.` : ''));
  $('#mapWarn').innerHTML = msgs.join('<br><br>');
  $('#mapWarn').hidden = msgs.length === 0;

  const nothingToDo = merge ? (plan.updatedVms + plan.added === 0) : ent.length === 0;
  $('#btnConfirmImport').disabled = miss.length > 0 || nothingToDo;
  $('#btnConfirmImport').textContent = merge
    ? (nothingToDo ? 'Merge VMs' : `Merge ${plan.updatedVms} update${plan.updatedVms === 1 ? '' : 's'}${plan.added ? ' + ' + plan.added + ' new' : ''}`)
    : (ent.length ? `Import ${ent.length} VM${ent.length === 1 ? '' : 's'}` : 'Import VMs');
}

/* ---------------- import result summary panel (inventory tab) ---------------- */
let importSummary = null;
function renderImportSummary() {
  const box = $('#impSummary');
  if (!box) return;
  if (!importSummary) { box.hidden = true; box.innerHTML = ''; return; }
  const s = importSummary;
  const stat = (n, label, cls) => `<span class="imp-stat ${cls}"><b>${n}</b> ${label}</span>`;
  const notes = [];
  if (s.unmatched && s.unmatched.length) notes.push(`No inventory match for ${s.unmatched.slice(0, 5).map(esc).join(', ')}${s.unmatched.length > 5 ? ` …and ${s.unmatched.length - 5} more` : ''} — ${s.action === 'add' ? 'added as new VMs' : 'skipped'}.`);
  if (s.dupCsv && s.dupCsv.length) notes.push(`CSV had duplicate name${s.dupCsv.length > 1 ? 's' : ''} (${s.dupCsv.slice(0, 5).map(esc).join(', ')}) — last row won.`);
  if (s.dupInv && s.dupInv.length) notes.push(`Inventory has duplicate name${s.dupInv.length > 1 ? 's' : ''} (${s.dupInv.map(d => esc(d.name) + ' ×' + d.n).join(', ')}) — all matches were updated.`);
  if (s.noName) notes.push(`${s.noName} row${s.noName > 1 ? 's' : ''} had no name and could not be matched.`);
  if (s.fields && s.fields.length) notes.push(`Fields written: <span class="mono">${s.fields.map(esc).join(', ')}</span>. All other fields left untouched.`);
  box.innerHTML = `<div class="imp-row">
      <strong>${esc(s.title)}</strong>
      ${stat(s.updated, 'updated', 'upd')}${stat(s.added, 'added', 'new')}${stat(s.skipped, 'skipped', 'skip')}
      <button class="btn icon imp-x" id="impDismiss" aria-label="Dismiss import summary">✕</button>
    </div>${notes.length ? `<ul class="imp-notes">${notes.map(n => `<li>${n}</li>`).join('')}</ul>` : ''}`;
  box.hidden = false;
}

/* ---------------- CSV export (scope-aware) ----------------
   scope 'visible' = exactly the rows the Cost breakdown is showing (location +
   filter rules, in the current multi-sort order).
   scope 'all'     = every VM in the profile, in inventory order, ignoring the
                     location selector, filter rules and sort. */
function openExportModal() {
  if (!VMS().length) return toast('No VMs to export.', true);
  const V = computeRows();
  const vis = $('input[name="exportScope"][value="visible"]');
  $('#scopeVisibleInfo').textContent = `${V.rows.length} row${V.rows.length === 1 ? '' : 's'} · `
    + (locFilter ? `location: ${locFilter}` : 'all locations')
    + ` · ${V.active.length} active rule${V.active.length === 1 ? '' : 's'} (${V.join}) · sorted by ${sortSummaryText()}`;
  $('#scopeAllInfo').textContent = `${VMS().length} VM${VMS().length === 1 ? '' : 's'} · inventory order · ignores the location selector, filter rules and sort`;
  vis.disabled = V.rows.length === 0;
  if (V.rows.length === 0) $('input[name="exportScope"][value="all"]').checked = true;
  else vis.checked = true;
  $('#exportModal').hidden = false;
  $('#btnExportGo').focus();
}
function exportScope() {
  const el = $('input[name="exportScope"]:checked');
  return el && el.value === 'all' ? 'all' : 'visible';
}
function exportResultsCsv(scope) {
  scope = scope === 'all' ? 'all' : 'visible';
  const all = allCosts();
  const V = computeRows();
  const rows = scope === 'all' ? all : V.rows;
  if (!rows.length) return toast('No VMs to export.', true);
  const p = P();
  const head = ['Name', 'OS', 'Location', 'Tags', 'RAM_GB', 'Disk_GB', 'Disk_TB', 'RatioTier', 'RatioRate_perGB', 'StorageTier', 'StorageUnit', 'StorageBilledQty', 'StorageRate_perUnit',
    'ZertoDR', 'DRStorage_GB', 'Compute_USD', 'VMwareLicensing_USD', 'Storage_USD', 'WindowsSPLA_USD', 'Addons_USD', 'DR_USD', 'TotalMonthly_USD'];
  const lines = [head];
  rows.forEach(r => lines.push([
    r.vm.name, r.vm.os, r.location, r.tags.join(TAG_DELIM), r.ram, r.disk, r2(r.tb), r.ratioLabel, r.ratio ? r.ratio.price : 0,
    shortTier(r.storageLabel), r.storageUnit, r2(r.storageQty), r.storageTier ? r.storageTier.price : 0,
    r.drOn ? 'yes' : 'no', r2(r.drGb),
    r2(r.compute), r2(r.vmware), r2(r.storage), r2(r.spla), r2(r.addons), r2(r.dr), r2(r.total)
  ]));
  const T = rows.reduce((a, r) => [a[0] + r.ram, a[1] + r.disk, a[2] + r.compute, a[3] + r.vmware, a[4] + r.storage, a[5] + r.spla, a[6] + r.addons, a[7] + r.total, a[8] + r.dr, a[9] + r.drGb, a[10] + (r.drOn ? 1 : 0)], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  lines.push([]);
  lines.push(['TOTAL (' + rows.length + ' VMs)', '', '', '', T[0], T[1], r2(T[1] / p.settings.divisor), '', '', '', '', '', '', T[10] + ' protected', r2(T[9]), r2(T[2]), r2(T[3]), r2(T[4]), r2(T[5]), r2(T[6]), r2(T[8]), r2(T[7])]);

  // --- location summary block ---
  const groups = locationTotals(rows);
  lines.push([]);
  lines.push(['COST BY LOCATION']);
  lines.push(['Location', 'VMs', 'RAM_GB', 'Disk_GB', 'Disk_TB', 'ProtectedVMs', 'DRStorage_GB', 'Compute_USD', 'VMwareLicensing_USD', 'Storage_USD', 'WindowsSPLA_USD', 'Addons_USD', 'DR_USD', 'TotalMonthly_USD', 'ShareOfTotal_pct']);
  groups.forEach(g => lines.push([g.location, g.vms, r2(g.ram), r2(g.disk), r2(g.tb), g.drVms, r2(g.drGb), r2(g.compute), r2(g.vmware), r2(g.storage), r2(g.spla), r2(g.addons), r2(g.dr), r2(g.total), T[7] ? r2(g.total / T[7] * 100) : 0]));
  lines.push(['All locations (' + groups.length + ')', rows.length, r2(T[0]), r2(T[1]), r2(T[1] / p.settings.divisor), T[10], r2(T[9]), r2(T[2]), r2(T[3]), r2(T[4]), r2(T[5]), r2(T[6]), r2(T[8]), r2(T[7]), 100]);

  // --- Zerto DR roll-up (two SKU lines, protected VMs only) ---
  lines.push([]);
  lines.push(['ZERTO DR ROLL-UP']);
  lines.push(['SKU', 'Charge', 'Quantity', 'Rate', 'Monthly_USD']);
  lines.push([p.dr.storage.sku || '', p.dr.storage.name, r2(T[9]) + ' GB', '$' + drRateNum(drRate(p)) + ' per GB',
    r2(rows.reduce((a, r) => a + r.drStorage, 0))]);
  lines.push([p.dr.fee.sku || '', p.dr.fee.name, T[10] + ' protected VMs', usd(drFeeRate(p)) + ' per VM',
    r2(rows.reduce((a, r) => a + r.drFee, 0))]);

  // --- tag roll-up (tags present in the exported set) ---
  const tc = tagCounts(rows.map(r => r.vm));
  if (tc.size) {
    const label = new Map();
    rows.forEach(r => r.tags.forEach(t => { if (!label.has(t.toLowerCase())) label.set(t.toLowerCase(), t); }));
    lines.push([]);
    lines.push(['COST BY TAG (a VM with several tags counts once per tag — rows do not sum to the grand total)']);
    lines.push(['Tag', 'VMs', 'TotalMonthly_USD']);
    Array.from(tc.keys()).sort((a, b) => a.localeCompare(b)).forEach(k => {
      const set = rows.filter(r => r.tags.some(t => t.toLowerCase() === k));
      lines.push([label.get(k) || k, set.length, r2(set.reduce((a, r) => a + r.total, 0))]);
    });
    const untagged = rows.filter(r => !r.tags.length);
    lines.push(['(untagged)', untagged.length, r2(untagged.reduce((a, r) => a + r.total, 0))]);
  }

  lines.push([]);
  lines.push(['Client', active().name]);
  lines.push(['Export scope', scope === 'all'
    ? `All inventory (${rows.length} VMs) — location selector, filter rules and sort not applied`
    : `Current visible results (${rows.length} of ${all.length} VMs) — filters and sort applied`]);
  lines.push(['Location filter', scope === 'all' ? 'not applied (all inventory)' : (locFilter || 'All locations')]);
  lines.push(['Filter rules', scope === 'all' ? 'not applied (all inventory)'
    : (V.active.length ? `${V.join} · ` + V.active.map(describeRule).join(' · ') : 'none')]);
  lines.push(['Sort order', scope === 'all' ? 'inventory order' : sortSummaryText()]);
  lines.push(['Tags delimiter', `“${TAG_DELIM}” within the Tags cell (import also accepts , and |)`]);
  lines.push(['Generated', new Date().toLocaleString()]);
  lines.push(['GB to TB divisor', p.settings.divisor]);
  lines.push(['Storage pricing basis', storageUnitSummary(p)]);
  p.storage.forEach(s => lines.push(['Storage tier rate', `${s.sku ? s.sku + ' · ' : ''}${s.name}`, '$' + rateNum(s) + ' per ' + SU(s)]));
  lines.push(['VMware licensing applied', p.vmwareLic.enabled ? 'yes @ ' + usd(p.vmwareLic.price) + '/GB RAM' : 'no']);
  lines.push(['Windows SPLA', usd(p.spla.price) + ' per Windows VM']);
  lines.push(['Zerto DR basis', 'protected VMs only · ' + drSummary(p) + ' · DR storage GB entered manually per VM (not derived from provisioned disk)']);
  const csv = lines.map(l => l.map(c => {
    let s = String(c ?? '');
    // Neutralize spreadsheet formula injection (leading = + - @) in text cells
    if (/^[=+\-@]/.test(s) && isNaN(Number(s))) s = "'" + s;
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
  const slug = (active().name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '') || 'client');
  download(`vm-costs-${slug}-${new Date().toISOString().slice(0, 10)}-${scope === 'all' ? 'all-inventory' : 'visible'}.csv`, csv);
  toast(scope === 'all'
    ? `Exported all ${rows.length} VM${rows.length === 1 ? '' : 's'} (full inventory).`
    : `Exported ${rows.length} visible row${rows.length === 1 ? '' : 's'} in the current sort order.`);
}
/* Plain-English rule text used in the export summary block. */
function describeRule(rule) {
  const f = fieldDef(rule.field);
  const opLabel = (FILTER_OPS[f.type].find(o => o[0] === rule.op) || [rule.op, rule.op])[1];
  if (rule.op === 'empty') return `${f.label} is empty`;
  if (f.type === 'bool') return `${f.label} ${opLabel} ${(f.options()[String(rule.v1) === 'no' ? 1 : 0])}`;
  if (rule.op === 'between') return `${f.label} between ${rule.v1} and ${rule.v2}`;
  return `${f.label} ${opLabel} ${rule.v1}`;
}

/* ================= bulk tag modal =================
   One modal serves all three actions. Replace is destructive, so it requires an
   explicit in-modal confirmation checkbox before Apply enables — no separate
   browser confirm dialog. */
let tagMode = null; // 'add' | 'remove' | 'replace'
let tagDraft = [];
function selectedVms() {
  return VMS().filter(v => selected.has(v.id));
}
function openTagModal(mode) {
  const targets = selectedVms();
  if (!targets.length) return toast('Select at least one row first.', true);
  tagMode = mode; tagDraft = [];
  const n = targets.length;
  const titles = { add: 'Add tags', remove: 'Remove tags', replace: 'Replace all tags' };
  const subs = {
    add: `Tags you list here are added to the ${n} selected VM${n === 1 ? '' : 's'}. Existing tags are kept.`,
    remove: `Tags you list here are removed from the ${n} selected VM${n === 1 ? '' : 's'} if present. Other tags are kept.`,
    replace: `Every existing tag on the ${n} selected VM${n === 1 ? '' : 's'} is discarded and replaced with exactly the list below. Leave the list empty to clear all their tags.`
  };
  $('#tagModalTitle').textContent = `${titles[mode]} · ${n} VM${n === 1 ? '' : 's'}`;
  $('#tagModalSub').textContent = subs[mode];
  $('#tagModalInputLabel').textContent = mode === 'remove' ? 'Tags to remove' : 'Tags to apply';
  $('#tagReplaceNote').hidden = mode !== 'replace';
  $('#tagReplaceConfirm').checked = false;
  $('#tagReplaceText').textContent = `Yes — discard the current tags on ${n === 1 ? 'this VM' : `these ${n} VMs`} and use only the list above.`;
  $('#tagModal').hidden = false;
  renderTagModal();
  $('#tagModalInput').focus();
}
function closeTagModal() { $('#tagModal').hidden = true; tagMode = null; tagDraft = []; }
function renderTagModal() {
  const targets = selectedVms();
  const n = targets.length;
  $('#tagModalBox').innerHTML = tagDraft.map(t =>
    `<span class="tag-chip">${esc(t)}<button type="button" class="chip-x" data-draftdel="${esc(t)}" aria-label="Remove ${esc(t)} from the list">✕</button></span>`).join('')
    || '<span class="muted small">No tags listed yet.</span>';
  // suggestions: for remove, only tags actually on the selection; otherwise the whole inventory
  const pool = tagMode === 'remove' ? tagsUsed(targets) : tagsUsed();
  const counts = tagCounts(tagMode === 'remove' ? targets : VMS());
  const left = pool.filter(t => !tagDraft.some(d => d.toLowerCase() === t.toLowerCase()));
  $('#tagModalSuggest').innerHTML = left.length
    ? `<span class="muted small">Reused from inventory:</span> ` + left.slice(0, 20).map(t =>
      `<button type="button" class="btn tag-sug" data-sug="${esc(t)}">${esc(t)} <span class="muted">· ${counts.get(t.toLowerCase()) || 0}</span></button>`).join('')
    : '<span class="muted small">No further suggestions.</span>';

  let preview;
  if (tagMode === 'remove') {
    const hits = targets.filter(v => tagsOf(v).some(t => tagDraft.some(d => d.toLowerCase() === t.toLowerCase())));
    preview = tagDraft.length ? `${hits.length} of ${n} selected VM${n === 1 ? '' : 's'} carr${hits.length === 1 ? 'ies' : 'y'} at least one of these tags.` : 'List one or more tags to remove.';
  } else if (tagMode === 'replace') {
    preview = tagDraft.length
      ? `All ${n} selected VM${n === 1 ? '' : 's'} will end up with exactly: ${tagDraft.join(', ')}.`
      : `All tags will be cleared from the ${n} selected VM${n === 1 ? '' : 's'}.`;
  } else {
    const ex = targets[0];
    preview = tagDraft.length
      ? `Example — ${esc(ex.name || '(unnamed)')} would become: ${normalizeTagList([...tagsOf(ex), ...tagDraft]).tags.join(', ')}.`
      : 'List one or more tags to add.';
  }
  $('#tagModalPreview').innerHTML = preview;

  const needConfirm = tagMode === 'replace' && !$('#tagReplaceConfirm').checked;
  const labels = { add: 'Add tags', remove: 'Remove tags', replace: tagDraft.length ? 'Replace tags' : 'Clear all tags' };
  $('#btnTagApply').textContent = `${labels[tagMode]} on ${n} VM${n === 1 ? '' : 's'}`;
  $('#btnTagApply').disabled = needConfirm || (tagMode !== 'replace' && !tagDraft.length);
}
function addDraftTags(raw) {
  const res = normalizeTagList([...tagDraft, ...String(raw).split(TAG_SPLIT)]);
  if (res.dropped.length) toast(`“${res.dropped[0].tag.slice(0, 40)}” skipped — ${res.dropped[0].why}.`, true);
  tagDraft = res.tags;
  $('#tagModalInput').value = '';
  renderTagModal();
}
function applyTagAction() {
  const targets = selectedVms();
  if (!targets.length) return closeTagModal();
  const draftKeys = tagDraft.map(t => t.toLowerCase());
  let changed = 0, over = 0;
  targets.forEach(v => {
    const before = tagsOf(v).join('\u0001').toLowerCase();
    if (tagMode === 'add') {
      const res = normalizeTagList([...tagsOf(v), ...tagDraft]);
      if (res.dropped.some(d => /limit/.test(d.why))) over++;
      v.tags = res.tags;
    } else if (tagMode === 'remove') {
      v.tags = tagsOf(v).filter(t => !draftKeys.includes(t.toLowerCase()));
    } else {
      v.tags = normalizeTagList(tagDraft).tags;
    }
    if (v.tags.join('\u0001').toLowerCase() !== before) changed++;
  });
  const verb = { add: 'tagged', remove: 'untagged', replace: 'retagged' }[tagMode];
  closeTagModal();
  commit('inventory');
  toast(changed
    ? `${changed} VM${changed === 1 ? '' : 's'} ${verb}.` + (over ? ` ${over} hit the ${TAG_MAX_PER_VM}-tag limit.` : '')
    : 'No VM needed a change.');
}

/* ================= events ================= */
function initEvents() {
  // tabs
  $$('.tab').forEach(t => t.addEventListener('click', () => {
    $$('.tab').forEach(x => { x.classList.remove('active'); x.setAttribute('aria-selected', 'false'); });
    t.classList.add('active');
    t.setAttribute('aria-selected', 'true');
    TABS.forEach(id => $('#tab-' + id).hidden = id !== t.dataset.tab);
    // always rebuild the tab being shown from state — nothing can be stale
    renderChrome();
    renderTab(t.dataset.tab);
  }));
  $('#btnGoInventory').addEventListener('click', () => $('.tab[data-tab="inventory"]').click());
  $$('[data-proxy]').forEach(b => b.addEventListener('click', () => $('#' + b.dataset.proxy).click()));

  // theme
  $('#btnTheme').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme;
    document.documentElement.dataset.theme = cur === 'dark' ? 'light' : 'dark';
  });

  // pricing tables
  ['#ratioTable', '#storageTable', '#addonTable'].forEach(bindCfg);
  $('#btnAddRatio').addEventListener('click', () => {
    P().ratios.push({ id: uid(), sku: '', label: '1:1', name: 'Enterprise Cloud Compute (1:1 Processor Ratio)', price: 0, isDefault: false });
    renderPricing(); commit('pricing');
  });
  $('#btnAddStorage').addEventListener('click', () => {
    P().storage.push({ id: uid(), sku: '', name: 'New storage tier', price: 0, unit: 'TB', isDefault: false });
    renderPricing(); commit('pricing');
  });
  $('#btnAddAddon').addEventListener('click', () => {
    P().addons.push({ id: uid(), sku: 'ADDON', name: 'New add-on', unit: 'per-vm', price: 0, defaultOn: false });
    renderPricing(); commit('pricing');
  });
  $('#btnResetPricing').addEventListener('click', () => {
    if (!confirm('Reset all pricing, tiers and add-ons for this client to catalog defaults? VM inventory is kept (tiers reassigned to defaults).')) return;
    active().pricing = defaultPricing();
    const dr = P().ratios.find(r => r.isDefault).id, ds = P().storage.find(s => s.isDefault).id;
    VMS().forEach(v => { v.ratioId = dr; v.storageId = ds; v.addons = []; });
    renderAll(); save(true); toast('Pricing reset to defaults.');
  });
  // licensing fields
  const licBind = [['#licVmSku', p => v => p.vmwareLic.sku = v], ['#licVmName', p => v => p.vmwareLic.name = v],
    ['#splaSku', p => v => p.spla.sku = v], ['#splaName', p => v => p.spla.name = v]];
  licBind.forEach(([sel, fn]) => $(sel).addEventListener('input', e => { fn(P())(e.target.value); afterPricingChange(false); }));
  $('#licVmPrice').addEventListener('input', e => { P().vmwareLic.price = parseFloat(e.target.value) || 0; afterPricingChange(false); });
  $('#splaPrice').addEventListener('input', e => { P().spla.price = parseFloat(e.target.value) || 0; afterPricingChange(false); });

  // Zerto DR pricing
  const drBind = [['#drStoSku', v => P().dr.storage.sku = v], ['#drStoName', v => P().dr.storage.name = v],
    ['#drFeeSku', v => P().dr.fee.sku = v], ['#drFeeName', v => P().dr.fee.name = v]];
  drBind.forEach(([sel, fn]) => $(sel).addEventListener('input', e => { fn(e.target.value); afterPricingChange(false); }));
  $('#drStoPrice').addEventListener('input', e => {
    P().dr.storage.price = parseFloat(e.target.value) || 0;
    $('#drStoEcho').textContent = '$' + drRateNum(P().dr.storage.price) + '/GB';
    $('#drEcho').textContent = drSummary(P());
    afterPricingChange(false);
  });
  $('#drFeePrice').addEventListener('input', e => {
    P().dr.fee.price = parseFloat(e.target.value) || 0;
    $('#drFeeEcho').textContent = usd(P().dr.fee.price) + '/VM';
    $('#drEcho').textContent = drSummary(P());
    afterPricingChange(false);
  });
  $('#licVmEnabled').addEventListener('change', e => { P().vmwareLic.enabled = e.target.checked; afterPricingChange(false); toast(e.target.checked ? 'VMware licensing applied to all VMs.' : 'VMware licensing excluded.'); });
  $('#setDivisor').addEventListener('change', e => { P().settings.divisor = parseInt(e.target.value, 10); $('#divisorEcho').textContent = e.target.value; $('#storageUnitEcho').textContent = storageUnitSummary(P()); afterPricingChange(false); });
  $('#setRounding').addEventListener('change', e => { P().settings.rounding = e.target.value; afterPricingChange(false); });

  // VM table
  const vmt = $('#vmTable');
  vmt.addEventListener('input', e => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    const vm = VMS().find(v => v.id === tr.dataset.id); if (!vm) return;
    const f = e.target.dataset.f;
    if (f === 'ram' || f === 'disk' || f === 'drGb') vm[f] = parseFloat(e.target.value) || 0;
    else if (f === 'name') vm.name = e.target.value;
    else if (f === 'location') vm.location = e.target.value;
    else if (f === 'os') {
      const was = isWin(vm.os); vm.os = e.target.value;
      if (was !== isWin(vm.os)) { renderVms(); const el = $(`tr[data-id="${vm.id}"] [data-f="os"]`, vmt); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }
    }
    commit('inventory');
  });
  vmt.addEventListener('change', e => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    const vm = VMS().find(v => v.id === tr.dataset.id); if (!vm) return;
    if (e.target.dataset.f === 'location') syncLocationDatalist(); // refresh autocomplete after edit
    if (e.target.dataset.f === 'dr') {
      vm.dr = e.target.checked;
      // keep drGb on the VM when unprotected (cost is $0 either way) so re-enabling restores it
      renderVms(); // show / hide the DR storage input
      commit('inventory', { force: false });
      const gbEl = $(`tr[data-id="${vm.id}"] [data-f="drGb"]`, vmt);
      if (gbEl) gbEl.focus();
      return;
    }
    if (e.target.dataset.f === 'ratioId') vm.ratioId = e.target.value;
    if (e.target.dataset.f === 'storageId') vm.storageId = e.target.value;
    if (e.target.dataset.addon) {
      const id = e.target.dataset.addon;
      vm.addons = vm.addons || [];
      vm.addons = e.target.checked ? Array.from(new Set([...vm.addons, id])) : vm.addons.filter(a => a !== id);
    }
    commit('inventory');
  });
  // per-VM tag chips: Enter / , ; | commits, Backspace on an empty input pops the last chip
  vmt.addEventListener('keydown', e => {
    const inp = e.target.closest('.tag-input'); if (!inp) return;
    if (e.key === 'Enter' || e.key === ',' || e.key === ';' || e.key === '|') {
      e.preventDefault(); commitRowTagInput(inp); return;
    }
    if (e.key === 'Backspace' && inp.value === '') {
      const tr = inp.closest('tr[data-id]');
      const vm = tr && VMS().find(v => v.id === tr.dataset.id);
      const last = vm && tagsOf(vm).slice(-1)[0];
      if (last) { e.preventDefault(); removeRowTag(tr, last); }
    }
  });
  vmt.addEventListener('focusout', e => {
    const inp = e.target.closest('.tag-input');
    if (inp && cleanTag(inp.value)) commitRowTagInput(inp); // don't silently discard typed text
  });
  vmt.addEventListener('click', e => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    const chipX = e.target.closest('[data-tagdel]');
    if (chipX) { removeRowTag(tr, chipX.dataset.tagdel); return; }
    const i = VMS().findIndex(v => v.id === tr.dataset.id); if (i < 0) return;
    if (e.target.closest('[data-del]')) { VMS().splice(i, 1); renderVms(); commit('inventory'); }
    else if (e.target.closest('[data-dup]')) {
      const c = JSON.parse(JSON.stringify(VMS()[i])); c.id = uid(); c.name = c.name + '-copy';
      VMS().splice(i + 1, 0, c); renderVms(); commit('inventory');
    }
  });
  $('#btnAddVm').addEventListener('click', () => {
    VMS().push(blankVm(P())); renderVms(); commit('inventory');
    const rows = $$('#vmTable tbody tr'); const last = rows[rows.length - 1];
    if (last) last.querySelector('[data-f="name"]').focus();
  });
  $('#btnClearVms').addEventListener('click', () => {
    if (!VMS().length) return;
    if (!confirm(`Delete all ${VMS().length} VMs from “${active().name}”? Pricing configuration is kept.`)) return;
    active().vms = []; renderVms(); commit('inventory');
  });
  $('#bulkRatio').addEventListener('change', e => { if (!e.target.value) return; VMS().forEach(v => v.ratioId = e.target.value); e.target.value = ''; renderVms(); commit('inventory'); toast('Ratio tier applied to all VMs.'); });
  $('#bulkStorage').addEventListener('change', e => { if (!e.target.value) return; VMS().forEach(v => v.storageId = e.target.value); e.target.value = ''; renderVms(); commit('inventory'); toast('Storage tier applied to all VMs.'); });
  $('#btnBulkLocation').addEventListener('click', () => {
    const val = String($('#bulkLocation').value || '').trim();
    if (!VMS().length) return;
    if (!confirm(val ? `Set location “${val}” on all ${VMS().length} VMs?` : `Clear the location on all ${VMS().length} VMs (they become “${UNASSIGNED}”)?`)) return;
    VMS().forEach(v => v.location = val);
    $('#bulkLocation').value = '';
    renderVms(); commit('inventory');
    toast(val ? `Location “${val}” applied to all VMs.` : 'Location cleared on all VMs.');
  });
  $('#bulkDr').addEventListener('change', e => {
    const v = e.target.value; e.target.value = '';
    if (!v || !VMS().length) return;
    const on = v === 'on';
    if (!confirm(on ? `Enable Zerto DR on all ${VMS().length} VMs? Enter each VM’s DR storage GB afterwards.`
      : `Disable Zerto DR on all ${VMS().length} VMs? Their DR storage GB values will be cleared.`)) return;
    VMS().forEach(x => { x.dr = on; if (!on) x.drGb = 0; });
    renderVms(); commit('inventory');
    toast(on ? 'Zerto DR enabled on all VMs.' : 'Zerto DR disabled on all VMs.');
  });
  /* Location change keeps the selection intact — the selection bar reports how
     many selected rows are currently hidden. */
  $('#locFilter').addEventListener('change', e => { locFilter = e.target.value; renderResults(); });

  /* ---- multi-column sort: header buttons are real <button>s, so Enter/Space and
     Shift+Enter work from the keyboard exactly like click / Shift-click ---- */
  $('#resTable thead').addEventListener('click', e => {
    const btn = e.target.closest('.th-sort'); if (!btn) return;
    if (suppressSort) return; // a column resize drag just ended — don't sort
    applySortClick(btn.dataset.sort, e.shiftKey);
  });
  $('#btnResetSort').addEventListener('click', () => {
    ui().sort = [{ key: 'total', dir: 'desc' }];
    renderResults(); save(true); toast('Sort reset to Total / mo, highest first.');
  });

  /* ---- advanced filter builder ---- */
  const fp = $('#filterPanel');
  $('#btnToggleFilters').addEventListener('click', () => {
    const body = $('#filterBody');
    const open = body.hidden;
    body.hidden = !open;
    $('#btnToggleFilters').setAttribute('aria-expanded', String(open));
    fp.classList.toggle('open', open);
    if (open) { const s = $('#ruleList select'); if (s) s.focus(); }
  });
  $('#btnAddRule').addEventListener('click', () => {
    const F = filterState();
    F.rules.push(newRule());
    rulesDirty = true;
    $('#filterBody').hidden = false;
    $('#btnToggleFilters').setAttribute('aria-expanded', 'true');
    fp.classList.add('open');
    renderResults(); save(true);
    const rows = $$('#ruleList .rule');
    const last = rows[rows.length - 1];
    if (last) { const inp = last.querySelector('[data-rv="1"]'); if (inp) inp.focus(); }
  });
  $('#btnClearRules').addEventListener('click', () => {
    const F = filterState();
    if (!F.rules.length) return;
    const n = F.rules.length;
    F.rules = [];
    rulesDirty = true;
    renderResults(); save(true);
    toast(`${n} filter rule${n === 1 ? '' : 's'} cleared.`);
  });
  $$('input[name="filterJoin"]').forEach(r => r.addEventListener('change', () => {
    filterState().join = r.value === 'OR' ? 'OR' : 'AND';
    rulesDirty = true; // the and/or connector text between rows changes
    renderResults(); save(true);
  }));
  const ruleOf = el => {
    const row = el.closest('.rule');
    return row ? filterState().rules.find(x => x.id === row.dataset.rid) : null;
  };
  $('#ruleList').addEventListener('change', e => {
    const rule = ruleOf(e.target); if (!rule) return;
    if (e.target.dataset.rf === 'field') {
      rule.field = e.target.value;
      const t = fieldDef(rule.field).type;
      rule.op = FILTER_OPS[t][0][0];
      rule.v1 = t === 'bool' ? 'yes' : ''; // a yes/no rule is complete the moment it is added
      rule.v2 = '';
      rulesDirty = true;
    } else if (e.target.dataset.rf === 'op') {
      rule.op = e.target.value;
      rulesDirty = true; // between adds a second input; “is empty” removes the value field
    } else if (e.target.dataset.rv) {
      rule[e.target.dataset.rv === '2' ? 'v2' : 'v1'] = e.target.value;
    }
    renderResults(); save(true);
  });
  $('#ruleList').addEventListener('input', e => {
    if (!e.target.dataset.rv) return;
    const rule = ruleOf(e.target); if (!rule) return;
    rule[e.target.dataset.rv === '2' ? 'v2' : 'v1'] = e.target.value;
    renderResults(); save(true); // rulesDirty stays false so the caret keeps its place
  });
  $('#ruleList').addEventListener('click', e => {
    if (!e.target.closest('[data-rdel]')) return;
    const row = e.target.closest('.rule');
    const F = filterState();
    F.rules = F.rules.filter(x => x.id !== row.dataset.rid);
    rulesDirty = true;
    renderResults(); save(true);
    ($('#btnAddRule')).focus();
  });

  /* ---- row selection + bulk tagging ---- */
  $('#resTable').addEventListener('change', e => {
    const cb = e.target.closest('.rowsel'); if (!cb) return;
    if (cb.checked) selected.add(cb.dataset.id); else selected.delete(cb.dataset.id);
    cb.closest('tr').classList.toggle('rowsel-on', cb.checked);
    renderSelBar(computeRows());
  });
  $('#selAll').addEventListener('change', e => {
    const ids = computeRows().rows.map(r => r.vm.id);
    if (e.target.checked) ids.forEach(id => selected.add(id));
    else ids.forEach(id => selected.delete(id));
    renderResults();
  });
  $('#btnSelVisible').addEventListener('click', () => {
    computeRows().rows.forEach(r => selected.add(r.vm.id));
    renderResults();
  });
  $('#btnSelClear').addEventListener('click', () => { selected.clear(); renderResults(); });
  $('#btnTagAdd').addEventListener('click', () => openTagModal('add'));
  $('#btnTagRemove').addEventListener('click', () => openTagModal('remove'));
  $('#btnTagReplace').addEventListener('click', () => openTagModal('replace'));
  $$('#tagModal [data-close-tag]').forEach(b => b.addEventListener('click', closeTagModal));
  $('#tagModal').addEventListener('click', e => { if (e.target.id === 'tagModal') closeTagModal(); });
  $('#tagModalInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ';' || e.key === '|') {
      e.preventDefault();
      if (cleanTag(e.target.value)) addDraftTags(e.target.value);
    } else if (e.key === 'Backspace' && e.target.value === '' && tagDraft.length) {
      e.preventDefault(); tagDraft.pop(); renderTagModal();
    }
  });
  $('#tagModalInput').addEventListener('change', e => { if (cleanTag(e.target.value)) addDraftTags(e.target.value); });
  $('#tagModal').addEventListener('click', e => {
    const del = e.target.closest('[data-draftdel]');
    if (del) { const k = del.dataset.draftdel.toLowerCase(); tagDraft = tagDraft.filter(t => t.toLowerCase() !== k); renderTagModal(); return; }
    const sug = e.target.closest('[data-sug]');
    if (sug) { addDraftTags(sug.dataset.sug); $('#tagModalInput').focus(); }
  });
  $('#tagReplaceConfirm').addEventListener('change', renderTagModal);
  $('#btnTagApply').addEventListener('click', applyTagAction);

  $('#btnResetCols').addEventListener('click', () => resetColW(false));
  /* export always asks for scope so the user never guesses what a file contains */
  $('#btnExportCsv').addEventListener('click', openExportModal);
  $$('#exportModal [data-close-export]').forEach(b => b.addEventListener('click', () => { $('#exportModal').hidden = true; }));
  $('#exportModal').addEventListener('click', e => { if (e.target.id === 'exportModal') $('#exportModal').hidden = true; });
  $('#btnExportGo').addEventListener('click', () => {
    const scope = exportScope();
    $('#exportModal').hidden = true;
    exportResultsCsv(scope);
  });
  $('#btnPrint').addEventListener('click', () => window.print());

  // CSV import
  $('#btnSampleCsv').addEventListener('click', () => { download('sample-vm-inventory.csv', SAMPLE_CSV); toast('Sample CSV downloaded.'); });
  $('#btnImportCsv').addEventListener('click', () => $('#csvFile').click());
  $('#csvFile').addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    Papa.parse(file, {
      header: true, skipEmptyLines: 'greedy', dynamicTyping: false,
      complete: res => {
        e.target.value = '';
        if (!res.meta.fields || !res.meta.fields.length) return toast('No header row found in that CSV.', true);
        if (!res.data.length) return toast('That CSV has headers but no data rows.', true);
        openMapper(file, res);
      },
      error: err => toast('CSV parse failed: ' + err.message, true)
    });
  });
  $('#mapGrid').addEventListener('change', e => {
    if (e.target.dataset.map === 'disk') $('#mapDiskUnit').value = guessUnit(e.target.value, 'disk');
    if (e.target.dataset.map === 'ram') $('#mapRamUnit').value = guessUnit(e.target.value, 'ram');
    if (e.target.dataset.map === 'drGb') $('#mapDrUnit').value = guessUnit(e.target.value, 'disk');
    refreshPreview();
  });
  ['#mapDiskUnit', '#mapRamUnit', '#mapDrUnit', '#mapRatio', '#mapStorage', '#mapLocation', '#mapMode', '#mapUnmatched'].forEach(s => $(s).addEventListener('change', refreshPreview));
  $('#mapLocation').addEventListener('input', refreshPreview);
  $$('#mapModal [data-close]').forEach(b => b.addEventListener('click', () => { $('#mapModal').hidden = true; pending = null; }));
  $('#mapModal').addEventListener('click', e => { if (e.target.id === 'mapModal') { $('#mapModal').hidden = true; pending = null; } });
  $('#btnConfirmImport').addEventListener('click', () => {
    const { vms, entries, mode, map: m } = buildImport();
    if (mode === 'merge') {
      if (!m.name) return toast('Map the VM name column to merge.', true);
      const action = unmatchedAction();
      const plan = planMerge(entries, action);
      if (!plan.updatedVms && !plan.added) return toast('Nothing to merge with the current mapping.', true);
      // update matched VMs in place — only the mapped fields are written
      plan.updates.forEach(u => u.targets.forEach(v => Object.assign(v, u.entry.patch)));
      if (plan.adds.length) active().vms = VMS().concat(plan.adds.map(e => e.full));
      const fields = Array.from(new Set([].concat(...plan.updates.map(u => u.entry.fields))));
      importSummary = {
        title: 'CSV merge complete', action,
        updated: plan.updatedVms, added: plan.added, skipped: plan.skipped,
        unmatched: plan.unmatched, dupCsv: plan.dupCsv, dupInv: plan.dupInv,
        noName: plan.noName.length, fields
      };
      $('#mapModal').hidden = true; pending = null;
      renderVms(); commit('inventory');
      toast(`Merge: ${plan.updatedVms} VM${plan.updatedVms === 1 ? '' : 's'} updated, ${plan.added} added, ${plan.skipped} skipped.`);
      $('.tab[data-tab="results"]').click();
      return;
    }
    if (!vms.length) return;
    if (mode === 'replace') active().vms = vms; else active().vms = VMS().concat(vms);
    importSummary = {
      title: mode === 'replace' ? 'Inventory replaced from CSV' : 'CSV appended to inventory',
      action: 'add', updated: 0, added: vms.length, skipped: 0, unmatched: [], dupCsv: [], dupInv: [], noName: 0, fields: []
    };
    $('#mapModal').hidden = true; pending = null;
    renderVms(); commit('inventory');
    toast(`${vms.length} VM${vms.length === 1 ? '' : 's'} imported.`);
    $('.tab[data-tab="results"]').click();
  });
  $('#impSummary').addEventListener('click', e => {
    if (e.target.id === 'impDismiss') { importSummary = null; renderImportSummary(); }
  });

  // clients
  $('#clientSelect').addEventListener('change', e => {
    state.activeId = e.target.value;
    locFilter = ''; selected.clear(); rulesDirty = true; // sort + rules come from the new profile's ui state
    renderAll(); save(true);
  });
  $('#btnSaveClient').addEventListener('click', () => save());
  $('#btnNewClient').addEventListener('click', () => {
    const name = prompt('New client name:', 'Client ' + (Object.keys(state.clients).length + 1));
    if (name === null) return;
    const keep = confirm('Keep the current pricing configuration for this new client?\n\nOK = copy current pricing   ·   Cancel = reset to catalog defaults');
    const c = newClient(name.trim() || 'Untitled client', keep ? JSON.parse(JSON.stringify(P())) : defaultPricing());
    state.clients[c.id] = c; state.activeId = c.id;
    renderAll(); save(true); $('.tab[data-tab="inventory"]').click();
    toast(`Client “${c.name}” created with ${keep ? 'current' : 'default'} pricing.`);
  });
  const menu = $('#profileMenu');
  $('#btnProfileMenu').addEventListener('click', () => {
    menu.hidden = !menu.hidden; $('#btnProfileMenu').setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('click', e => { if (!e.target.closest('.menu-wrap')) { menu.hidden = true; $('#btnProfileMenu').setAttribute('aria-expanded', 'false'); } });
  menu.addEventListener('click', e => {
    const act = e.target.dataset.act; if (!act) return;
    menu.hidden = true;
    if (act === 'rename') {
      const n = prompt('Client name:', active().name); if (n === null) return;
      active().name = n.trim() || active().name; commit(null);
    } else if (act === 'duplicate') {
      const c = JSON.parse(JSON.stringify(active())); c.id = uid(); c.name = active().name + ' (copy)';
      c.vms.forEach(v => v.id = uid());
      state.clients[c.id] = c; state.activeId = c.id; renderAll(); save(true); toast('Client duplicated.');
    } else if (act === 'export') {
      const payload = { app: 'vm-cost-calculator', version: 1, exported: new Date().toISOString(), client: active() };
      download(`vmcc-${active().name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`, JSON.stringify(payload, null, 2), 'application/json');
      toast('Client profile exported as JSON.');
    } else if (act === 'exportall') {
      const payload = { app: 'vm-cost-calculator', version: 1, exported: new Date().toISOString(), clients: Object.values(state.clients) };
      download('vmcc-all-clients.json', JSON.stringify(payload, null, 2), 'application/json');
      toast(`${Object.keys(state.clients).length} profiles exported.`);
    } else if (act === 'import') {
      $('#jsonFile').click();
    } else if (act === 'delete') {
      if (Object.keys(state.clients).length <= 1) return toast('At least one client profile must exist.', true);
      if (!confirm(`Delete client “${active().name}” and its ${VMS().length} VMs? This cannot be undone.`)) return;
      delete state.clients[state.activeId];
      state.activeId = Object.keys(state.clients)[0];
      renderAll(); save(true); toast('Client deleted.');
    }
  });
  $('#jsonFile').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const fr = new FileReader();
    fr.onload = () => {
      e.target.value = '';
      try {
        const data = JSON.parse(fr.result);
        const list = data.clients ? data.clients : data.client ? [data.client] : Array.isArray(data) ? data : null;
        if (!list || !list.length) throw new Error('No client profiles found in this file.');
        let last = null;
        list.forEach(c => {
          const id = uid();
          const pr = normalizePricing(Object.assign(defaultPricing(), c.pricing));
          const dR = (pr.ratios.find(r => r.isDefault) || pr.ratios[0] || {}).id || '';
          const dS = (pr.storage.find(s => s.isDefault) || pr.storage[0] || {}).id || '';
          const cl = { id, name: (c.name || 'Imported client') + (Object.values(state.clients).some(x => x.name === c.name) ? ' (imported)' : ''), pricing: pr,
            vms: (c.vms || []).map(v => Object.assign({}, v, {
              id: uid(),
              location: typeof v.location === 'string' ? v.location : '', // legacy profiles: no location -> Unassigned
              dr: v.dr === true || v.dr === 'true' || v.dr === 1, // legacy profiles: no dr -> unprotected
              drGb: (v.dr === true || v.dr === 'true' || v.dr === 1) ? (Number(v.drGb) || 0) : 0,
              tags: normalizeTagList(Array.isArray(v.tags) ? v.tags : []).tags, // legacy profiles: no tags
              ratioId: v.ratioId || dR, storageId: v.storageId || dS, addons: v.addons || []
            })), updated: Date.now() };
          state.clients[id] = cl; last = id;
        });
        state.activeId = last; renderAll(); save(true);
        toast(`Imported ${list.length} client profile${list.length === 1 ? '' : 's'}.`);
      } catch (err) { toast('Import failed: ' + err.message, true); }
    };
    fr.readAsText(f);
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('#tagModal').hidden) return closeTagModal();
    if (!$('#exportModal').hidden) { $('#exportModal').hidden = true; return; }
    if (!$('#mapModal').hidden) { $('#mapModal').hidden = true; pending = null; }
  });
}

/* ================= boot ================= */
document.documentElement.dataset.theme = 'dark'; // dark-first: data-center aesthetic
initEvents();
initColResize();
renderAll();
$('#savedStamp').textContent = 'loaded ' + new Date().toLocaleTimeString();
$('#storageInfo').textContent = STORE.persistent ? 'browser storage' : 'in-memory (preview frame — export JSON to keep your work)';

// Seed a first-run demo inventory so the app is never a dead end.
if (!STORE.getItem(LS_KEY)) {
  const res = Papa.parse(SAMPLE_CSV.trim(), { header: true, skipEmptyLines: true });
  pending = { file: { name: 'sample-vm-inventory.csv' }, rows: res.data, headers: res.meta.fields, map: autoMap(res.meta.fields) };
  const fake = { value: '' };
  const built = (() => {
    // build with defaults without opening the modal
    const p = P();
    return res.data.map(row => {
      const rt = matchTier(p.ratios, row.Ratio, ['label', 'name', 'sku']);
      const st = matchTier(p.storage, row.StorageTier, ['name', 'sku']);
      const drOn = parseDrFlag(row.Zerto);
      return { id: uid(), name: row.Name, os: row.OS, location: (row.Location || '').trim(), ram: parseFloat(row.RAM_GB) || 0, disk: parseFloat(row.Disk_GB) || 0,
        dr: drOn, drGb: drOn ? (parseFloat(row.DR_Storage_GB) || 0) : 0,
        ratioId: (rt || p.ratios[0]).id, storageId: (st || p.storage[0]).id, tags: parseTagCell(row.Tags), addons: [] };
    });
  })();
  pending = null;
  active().vms = built;
  renderAll(); save(true);
}
})();
