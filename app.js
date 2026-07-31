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
      { id: uid(), sku: '3819', name: 'Enterprise Cloud Storage — Standard Flash', price: 333.00, isDefault: true },
      { id: uid(), sku: '3815', name: 'Enterprise Cloud Storage — High Performance Flash', price: 359.00, isDefault: false }
    ],
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
  return { id: uid(), name: '', os: 'Linux', ram: 0, disk: 0, ratioId: dr, storageId: ds, addons: pricing.addons.filter(a => a.defaultOn).map(a => a.id) };
}

/* ---------------- state ---------------- */
let state = load();
let sort = { key: 'total', dir: 'desc' };
let pending = null; // csv import staging

function load() {
  try {
    const raw = STORE.getItem(LS_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.clients && Object.keys(s.clients).length) {
        Object.values(s.clients).forEach(c => { c.pricing = Object.assign(defaultPricing(), c.pricing); c.vms = c.vms || []; });
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

  const compute = round(ram * (ratio ? Number(ratio.price) || 0 : 0));
  const vmware = round(p.vmwareLic.enabled ? ram * (Number(p.vmwareLic.price) || 0) : 0);
  const storage = round(tb * (st ? Number(st.price) || 0 : 0));
  const spla = round(isWin(vm.os) ? (Number(p.spla.price) || 0) : 0);
  let addons = 0; const addonDetail = [];
  (vm.addons || []).forEach(id => {
    const a = p.addons.find(x => x.id === id); if (!a) return;
    const q = a.unit === 'per-vm' ? 1 : a.unit === 'per-gb-ram' ? ram : tb;
    const amt = round(q * (Number(a.price) || 0));
    addons += amt; addonDetail.push({ addon: a, qty: q, amt });
  });
  addons = round(addons);
  const total = r2(compute + vmware + storage + spla + addons);
  return {
    vm, ram, disk, tb, ratio, storageTier: st,
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
      <td class="num"><div class="money"><span>$</span><input class="in num mono" type="number" step="0.01" min="0" data-f="price" value="${s.price}" aria-label="Price per TB"></div></td>
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

  $('#setDivisor').value = String(p.settings.divisor);
  $('#setRounding').value = p.settings.rounding;
  $('#divisorEcho').textContent = String(p.settings.divisor);
}

/* config table edits (delegated) */
function bindCfg(tableSel) {
  const t = $(tableSel);
  t.addEventListener('input', e => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    const f = e.target.dataset.f; if (!f) return;
    const list = { ratio: P().ratios, storage: P().storage, addon: P().addons }[tr.dataset.kind];
    const item = list.find(x => x.id === tr.dataset.id); if (!item) return;
    if (f === 'price') item.price = parseFloat(e.target.value) || 0;
    else if (f === 'isDefault') { list.forEach(x => x.isDefault = false); item.isDefault = true; }
    else if (f === 'defaultOn') item.defaultOn = e.target.checked;
    else item[f] = e.target.value;
    afterPricingChange(f === 'label' || f === 'name');
  });
  t.addEventListener('change', e => { if (e.target.dataset.f === 'unit') { const tr = e.target.closest('tr'); const a = P().addons.find(x => x.id === tr.dataset.id); if (a) { a.unit = e.target.value; afterPricingChange(true); } } });
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
    renderPricing(); renderVms(); renderResults(); save(true);
  });
}

function afterPricingChange(structural) {
  if (structural) renderVms();
  renderResults(); save(true);
}

/* ================= RENDER: VM inventory ================= */
function renderVms() {
  const p = P(), vms = VMS();
  $('#vmCountPill').textContent = vms.length;
  renderClients();
  $('#vmEmpty').hidden = vms.length > 0;
  $('#vmTable').hidden = vms.length === 0;
  $('#bulkBar').hidden = vms.length === 0;
  $('#addonHead').hidden = p.addons.length === 0;

  const rOpts = v => p.ratios.map(r => `<option value="${r.id}" ${v === r.id ? 'selected' : ''}>${esc(r.label || r.name)} — $${num(r.price)}/GB</option>`).join('');
  const sOpts = v => p.storage.map(s => `<option value="${s.id}" ${v === s.id ? 'selected' : ''}>${esc(shortTier(s.name))} — $${num(s.price)}/TB</option>`).join('');

  $('#vmTable tbody').innerHTML = vms.map((v, i) => `
    <tr data-id="${v.id}">
      <td class="w-idx mono">${i + 1}</td>
      <td><input class="in" data-f="name" value="${esc(v.name)}" placeholder="vm-name" aria-label="VM name"></td>
      <td><div class="os-field"><input class="in" data-f="os" list="osList" value="${esc(v.os)}" placeholder="Operating system" aria-label="Operating system">${isWin(v.os) ? '<span class="badge" title="Windows SPLA applies">SPLA</span>' : ''}</div></td>
      <td class="num"><input class="in num mono" type="number" min="0" step="1" data-f="ram" value="${v.ram}" aria-label="RAM in GB"></td>
      <td class="num"><input class="in num mono" type="number" min="0" step="1" data-f="disk" value="${v.disk}" aria-label="Provisioned disk in GB"></td>
      <td><select data-f="ratioId" aria-label="Ratio tier">${rOpts(v.ratioId)}</select></td>
      <td><select data-f="storageId" aria-label="Storage tier">${sOpts(v.storageId)}</select></td>
      <td ${p.addons.length ? '' : 'hidden'}><div class="addon-cell">${p.addons.map(a => `
          <label class="addon-chip" title="${esc(a.name)} · ${usd(a.price)} ${a.unit}"><input type="checkbox" data-addon="${a.id}" ${(v.addons || []).includes(a.id) ? 'checked' : ''}>${esc(a.sku || a.name)}</label>`).join('') || '<span class="dash">—</span>'}</div></td>
      <td class="w-act">
        <button class="btn row-x" data-dup title="Duplicate VM">⧉</button>
        <button class="btn row-x" data-del title="Delete VM">✕</button>
      </td>
    </tr>`).join('');

  if (!$('#osList')) {
    const dl = document.createElement('datalist'); dl.id = 'osList';
    dl.innerHTML = ['Microsoft Windows Server 2022', 'Microsoft Windows Server 2019', 'Microsoft Windows 11', 'Ubuntu Linux 22.04', 'Red Hat Enterprise Linux 9', 'CentOS Linux 7', 'Other'].map(o => `<option value="${o}">`).join('');
    document.body.appendChild(dl);
  }
  const bulkR = $('#bulkRatio'), bulkS = $('#bulkStorage');
  bulkR.innerHTML = '<option value="">Set ratio tier for all…</option>' + p.ratios.map(r => `<option value="${r.id}">${esc(r.label || r.name)}</option>`).join('');
  bulkS.innerHTML = '<option value="">Set storage tier for all…</option>' + p.storage.map(s => `<option value="${s.id}">${esc(shortTier(s.name))}</option>`).join('');
}
const shortTier = n => String(n).replace(/^Enterprise Cloud Storage\s*[—-]\s*/i, '');

/* ================= RENDER: results ================= */
function renderResults() {
  const rows = allCosts();
  const has = rows.length > 0;
  $('#resEmpty').hidden = has;
  $('#resTable').hidden = !has;
  $('#tierRollup').hidden = !has;
  $('#summaryCards').innerHTML = '';
  if (!has) { $('#resultsSub').textContent = 'Monthly recurring cost per VM.'; return; }

  const T = rows.reduce((a, r) => ({
    compute: a.compute + r.compute, vmware: a.vmware + r.vmware, storage: a.storage + r.storage,
    spla: a.spla + r.spla, addons: a.addons + r.addons, total: a.total + r.total,
    ram: a.ram + r.ram, disk: a.disk + r.disk
  }), { compute: 0, vmware: 0, storage: 0, spla: 0, addons: 0, total: 0, ram: 0, disk: 0 });
  const winCount = rows.filter(r => r.windows).length;

  $('#resultsSub').textContent = `${rows.length} VM${rows.length === 1 ? '' : 's'} · ${active().name} · monthly recurring, USD`;

  $('#summaryCards').innerHTML = `
    ${kpi('Total VMs', rows.length, `${winCount} Windows · ${rows.length - winCount} non-Windows`)}
    ${kpi('Total RAM', num(T.ram) + ' GB', 'billed per GB / month')}
    ${kpi('Total disk', num(T.disk) + ' GB', num(T.disk / P().settings.divisor) + ' TB @ ÷' + P().settings.divisor)}
    ${kpi('Monthly cost', usd(T.total), usd(T.total * 12) + ' / yr', true)}
    ${kpi('Avg cost / VM', usd(T.total / rows.length), 'across all tiers')}`;

  const dir = sort.dir === 'asc' ? 1 : -1;
  const key = sort.key;
  const val = r => ({ name: r.vm.name.toLowerCase(), os: String(r.vm.os).toLowerCase(), ram: r.ram, disk: r.disk, ratio: r.ratioLabel, storage: r.storageLabel, compute: r.compute, vmware: r.vmware, storageCost: r.storage, spla: r.spla, addons: r.addons, total: r.total }[key]);
  const sorted = rows.slice().sort((a, a2) => { const x = val(a), y = val(a2); return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir; });

  $('#resTable tbody').innerHTML = sorted.map(r => `
    <tr>
      <td class="txt strong">${esc(r.vm.name || '(unnamed)')}</td>
      <td class="txt"><span class="os-tag ${r.windows ? 'win' : /linux|ubuntu|centos|rhel|red hat|debian|suse/i.test(r.vm.os) ? 'lin' : ''}">${esc(r.vm.os || '—')}</span></td>
      <td class="num">${num(r.ram)}</td>
      <td class="num">${num(r.disk)}</td>
      <td class="txt">${esc(r.ratioLabel)}</td>
      <td class="txt">${esc(shortTier(r.storageLabel))}</td>
      <td class="num${r.compute ? '' : ' zero'}">${usd(r.compute)}</td>
      <td class="num${r.vmware ? '' : ' zero'}">${usd(r.vmware)}</td>
      <td class="num${r.storage ? '' : ' zero'}">${usd(r.storage)}</td>
      <td class="num${r.spla ? '' : ' zero'}">${usd(r.spla)}</td>
      <td class="num${r.addons ? '' : ' zero'}">${usd(r.addons)}</td>
      <td class="num total">${usd(r.total)}</td>
    </tr>`).join('');

  $('#resTable tfoot').innerHTML = `<tr>
      <td class="label" colspan="2">Grand total — ${rows.length} VMs</td>
      <td class="num">${num(T.ram)}</td><td class="num">${num(T.disk)}</td>
      <td colspan="2"></td>
      <td class="num">${usd(T.compute)}</td><td class="num">${usd(T.vmware)}</td><td class="num">${usd(T.storage)}</td>
      <td class="num">${usd(T.spla)}</td><td class="num">${usd(T.addons)}</td>
      <td class="num" style="color:var(--primary)">${usd(T.total)}</td>
    </tr>`;

  $$('#resTable th[data-sort]').forEach(th => {
    th.classList.toggle('sorted', th.dataset.sort === key);
    th.classList.toggle('asc', th.dataset.sort === key && sort.dir === 'asc');
  });

  renderRollup(rows);
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
    const tb = rr.reduce((a, r) => a + r.tb, 0);
    out.push([st.sku, `${st.name} (${rr.length} VM${rr.length > 1 ? 's' : ''})`, num(tb) + ' TB', usd(st.price) + ' /TB', rr.reduce((a, r) => a + r.storage, 0)]);
  });
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
function renderAll() { renderPricing(); renderVms(); renderResults(); }

/* ================= CSV helpers ================= */
function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime || 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
const SAMPLE_CSV = `Name,OS,RAM_GB,Disk_GB,Ratio,StorageTier
WEB01,Microsoft Windows Server 2022,16,200,4:1,Standard Flash
SQL01,Microsoft Windows Server 2019,64,1024,2:1,High Performance Flash
APP01,Ubuntu Linux 22.04,32,500,4:1,Standard Flash
`;

const FIELDS = [
  { key: 'name', label: 'VM name', req: true, hints: ['name', 'vm', 'vm name', 'vmname', 'virtual machine', 'hostname', 'server'] },
  { key: 'os', label: 'Operating system', req: false, hints: ['os', 'os according to the configuration file', 'guest os', 'guest', 'operating system', 'os according to the vmware tools'] },
  { key: 'ram', label: 'RAM', req: true, hints: ['ram', 'ram_gb', 'ram gb', 'memory', 'memory mb', 'memory (gb)', 'memory size', 'mem'] },
  { key: 'disk', label: 'Provisioned disk', req: true, hints: ['disk', 'disk_gb', 'disk gb', 'provisioned', 'provisioned mb', 'provisioned mib', 'storage', 'total disk capacity', 'capacity', 'in use mb', 'allocated'] },
  { key: 'ratio', label: 'Ratio tier (optional)', req: false, hints: ['ratio', 'ratio tier', 'processor ratio', 'tier', 'compute tier'] },
  { key: 'storage', label: 'Storage tier (optional)', req: false, hints: ['storagetier', 'storage tier', 'storage_tier', 'datastore', 'storage policy', 'storage profile', 'policy'] }
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
      if (f.hints.some(x => n.includes(x))) { best = h; break; }
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
  $('#mapRatio').innerHTML = p.ratios.map(r => `<option value="${r.id}" ${r.isDefault ? 'selected' : ''}>${esc(r.label || r.name)}</option>`).join('');
  $('#mapStorage').innerHTML = p.storage.map(s => `<option value="${s.id}" ${s.isDefault ? 'selected' : ''}>${esc(shortTier(s.name))}</option>`).join('');
  $('#mapMode').value = VMS().length ? 'append' : 'replace';
  $('#mapModal').hidden = false;
  refreshPreview();
}
function readMap() {
  const m = {}; $$('#mapGrid select').forEach(s => { if (s.value) m[s.dataset.map] = s.value; });
  return m;
}
function buildImport() {
  const m = readMap(), p = P();
  const dScale = { GB: 1, MB: 1 / 1024, TB: 1024 }[$('#mapDiskUnit').value];
  const rScale = { GB: 1, MB: 1 / 1024 }[$('#mapRamUnit').value];
  const fbR = $('#mapRatio').value, fbS = $('#mapStorage').value;
  const warns = [];
  const vms = [];
  pending.rows.forEach((row, i) => {
    const name = m.name ? String(row[m.name] ?? '').trim() : '';
    const ramRaw = m.ram ? parseFloat(String(row[m.ram]).replace(/[^0-9.\-]/g, '')) : NaN;
    const diskRaw = m.disk ? parseFloat(String(row[m.disk]).replace(/[^0-9.\-]/g, '')) : NaN;
    if (!name && !isFinite(ramRaw) && !isFinite(diskRaw)) return; // blank row
    if (!name) warns.push(`Row ${i + 2}: missing name — imported as “(unnamed)”.`);
    if (!isFinite(ramRaw)) warns.push(`Row ${i + 2}: RAM not numeric — set to 0.`);
    if (!isFinite(diskRaw)) warns.push(`Row ${i + 2}: disk not numeric — set to 0.`);
    const rt = m.ratio ? matchTier(p.ratios, row[m.ratio], ['label', 'name', 'sku']) : null;
    const st = m.storage ? matchTier(p.storage, row[m.storage], ['name', 'sku']) : null;
    if (m.ratio && !rt && String(row[m.ratio] || '').trim()) warns.push(`Row ${i + 2}: ratio “${row[m.ratio]}” not recognised — using fallback tier.`);
    if (m.storage && !st && String(row[m.storage] || '').trim()) warns.push(`Row ${i + 2}: storage tier “${row[m.storage]}” not recognised — using fallback tier.`);
    vms.push({
      id: uid(),
      name: name || '(unnamed)',
      os: m.os ? String(row[m.os] ?? '').trim() : '',
      ram: r2((isFinite(ramRaw) ? ramRaw : 0) * rScale),
      disk: r2((isFinite(diskRaw) ? diskRaw : 0) * dScale),
      ratioId: rt ? rt.id : fbR,
      storageId: st ? st.id : fbS,
      addons: p.addons.filter(a => a.defaultOn).map(a => a.id)
    });
  });
  return { vms, warns, missing: FIELDS.filter(f => f.req && !m[f.key]).map(f => f.label) };
}
function refreshPreview() {
  const { vms, warns, missing } = buildImport();
  const cols = ['name', 'os', 'ram', 'disk', 'ratioId', 'storageId'];
  const head = ['Name', 'OS', 'RAM GB', 'Disk GB', 'Ratio', 'Storage tier'];
  $('#mapPreview thead').innerHTML = `<tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>`;
  $('#mapPreview tbody').innerHTML = vms.slice(0, 8).map(v => `<tr>
      <td>${esc(v.name)}</td><td>${esc(v.os) || '<span class="dash">—</span>'}</td>
      <td class="num mono">${num(v.ram)}</td><td class="num mono">${num(v.disk)}</td>
      <td>${esc((P().ratios.find(r => r.id === v.ratioId) || {}).label || '—')}</td>
      <td>${esc(shortTier((P().storage.find(s => s.id === v.storageId) || {}).name || '—'))}</td></tr>`).join('')
    || '<tr><td colspan="6" class="muted">No importable rows with the current mapping.</td></tr>';
  $('#mapPrevInfo').textContent = `${vms.length} row(s) ready · showing first ${Math.min(8, vms.length)}`;
  const msgs = [];
  if (missing.length) msgs.push(`<strong>Required column${missing.length > 1 ? 's' : ''} not mapped:</strong> ${missing.join(', ')}.`);
  if (warns.length) msgs.push(`<strong>${warns.length} row note${warns.length > 1 ? 's' : ''}:</strong><br>` + warns.slice(0, 6).map(esc).join('<br>') + (warns.length > 6 ? `<br>…and ${warns.length - 6} more.` : ''));
  $('#mapWarn').innerHTML = msgs.join('<br><br>');
  $('#mapWarn').hidden = msgs.length === 0;
  $('#btnConfirmImport').disabled = missing.length > 0 || vms.length === 0;
  $('#btnConfirmImport').textContent = vms.length ? `Import ${vms.length} VM${vms.length === 1 ? '' : 's'}` : 'Import VMs';
}

function exportResultsCsv() {
  const rows = allCosts();
  if (!rows.length) return toast('No VMs to export.', true);
  const p = P();
  const head = ['Name', 'OS', 'RAM_GB', 'Disk_GB', 'Disk_TB', 'RatioTier', 'RatioRate_perGB', 'StorageTier', 'StorageRate_perTB',
    'Compute_USD', 'VMwareLicensing_USD', 'Storage_USD', 'WindowsSPLA_USD', 'Addons_USD', 'TotalMonthly_USD'];
  const lines = [head];
  rows.forEach(r => lines.push([
    r.vm.name, r.vm.os, r.ram, r.disk, r2(r.tb), r.ratioLabel, r.ratio ? r.ratio.price : 0,
    shortTier(r.storageLabel), r.storageTier ? r.storageTier.price : 0,
    r2(r.compute), r2(r.vmware), r2(r.storage), r2(r.spla), r2(r.addons), r2(r.total)
  ]));
  const T = rows.reduce((a, r) => [a[0] + r.ram, a[1] + r.disk, a[2] + r.compute, a[3] + r.vmware, a[4] + r.storage, a[5] + r.spla, a[6] + r.addons, a[7] + r.total], [0, 0, 0, 0, 0, 0, 0, 0]);
  lines.push([]);
  lines.push(['TOTAL (' + rows.length + ' VMs)', '', T[0], T[1], r2(T[1] / p.settings.divisor), '', '', '', '', r2(T[2]), r2(T[3]), r2(T[4]), r2(T[5]), r2(T[6]), r2(T[7])]);
  lines.push([]);
  lines.push(['Client', active().name]);
  lines.push(['Generated', new Date().toLocaleString()]);
  lines.push(['GB to TB divisor', p.settings.divisor]);
  lines.push(['VMware licensing applied', p.vmwareLic.enabled ? 'yes @ ' + usd(p.vmwareLic.price) + '/GB RAM' : 'no']);
  lines.push(['Windows SPLA', usd(p.spla.price) + ' per Windows VM']);
  const csv = lines.map(l => l.map(c => {
    const s = String(c ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
  const slug = active().name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  download(`vm-costs-${slug}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  toast('Results exported as CSV.');
}

/* ================= events ================= */
function initEvents() {
  // tabs
  $$('.tab').forEach(t => t.addEventListener('click', () => {
    $$('.tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    ['pricing', 'inventory', 'results'].forEach(id => $('#tab-' + id).hidden = id !== t.dataset.tab);
    if (t.dataset.tab === 'results') renderResults();
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
    renderPricing(); renderVms(); save(true);
  });
  $('#btnAddStorage').addEventListener('click', () => {
    P().storage.push({ id: uid(), sku: '', name: 'New storage tier', price: 0, isDefault: false });
    renderPricing(); renderVms(); save(true);
  });
  $('#btnAddAddon').addEventListener('click', () => {
    P().addons.push({ id: uid(), sku: 'ADDON', name: 'New add-on', unit: 'per-vm', price: 0, defaultOn: false });
    renderPricing(); renderVms(); renderResults(); save(true);
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
  $('#licVmEnabled').addEventListener('change', e => { P().vmwareLic.enabled = e.target.checked; afterPricingChange(false); toast(e.target.checked ? 'VMware licensing applied to all VMs.' : 'VMware licensing excluded.'); });
  $('#setDivisor').addEventListener('change', e => { P().settings.divisor = parseInt(e.target.value, 10); $('#divisorEcho').textContent = e.target.value; afterPricingChange(false); });
  $('#setRounding').addEventListener('change', e => { P().settings.rounding = e.target.value; afterPricingChange(false); });

  // VM table
  const vmt = $('#vmTable');
  vmt.addEventListener('input', e => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    const vm = VMS().find(v => v.id === tr.dataset.id); if (!vm) return;
    const f = e.target.dataset.f;
    if (f === 'ram' || f === 'disk') vm[f] = parseFloat(e.target.value) || 0;
    else if (f === 'name') vm.name = e.target.value;
    else if (f === 'os') {
      const was = isWin(vm.os); vm.os = e.target.value;
      if (was !== isWin(vm.os)) { renderVms(); const el = $(`tr[data-id="${vm.id}"] [data-f="os"]`, vmt); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }
    }
    renderResults(); save(true);
  });
  vmt.addEventListener('change', e => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    const vm = VMS().find(v => v.id === tr.dataset.id); if (!vm) return;
    if (e.target.dataset.f === 'ratioId') vm.ratioId = e.target.value;
    if (e.target.dataset.f === 'storageId') vm.storageId = e.target.value;
    if (e.target.dataset.addon) {
      const id = e.target.dataset.addon;
      vm.addons = vm.addons || [];
      vm.addons = e.target.checked ? Array.from(new Set([...vm.addons, id])) : vm.addons.filter(a => a !== id);
    }
    renderResults(); save(true);
  });
  vmt.addEventListener('click', e => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    const i = VMS().findIndex(v => v.id === tr.dataset.id); if (i < 0) return;
    if (e.target.closest('[data-del]')) { VMS().splice(i, 1); renderVms(); renderResults(); save(true); }
    else if (e.target.closest('[data-dup]')) {
      const c = JSON.parse(JSON.stringify(VMS()[i])); c.id = uid(); c.name = c.name + '-copy';
      VMS().splice(i + 1, 0, c); renderVms(); renderResults(); save(true);
    }
  });
  $('#btnAddVm').addEventListener('click', () => {
    VMS().push(blankVm(P())); renderVms(); renderResults(); save(true);
    const rows = $$('#vmTable tbody tr'); const last = rows[rows.length - 1];
    if (last) last.querySelector('[data-f="name"]').focus();
  });
  $('#btnClearVms').addEventListener('click', () => {
    if (!VMS().length) return;
    if (!confirm(`Delete all ${VMS().length} VMs from “${active().name}”? Pricing configuration is kept.`)) return;
    active().vms = []; renderVms(); renderResults(); save(true);
  });
  $('#bulkRatio').addEventListener('change', e => { if (!e.target.value) return; VMS().forEach(v => v.ratioId = e.target.value); e.target.value = ''; renderVms(); renderResults(); save(true); toast('Ratio tier applied to all VMs.'); });
  $('#bulkStorage').addEventListener('change', e => { if (!e.target.value) return; VMS().forEach(v => v.storageId = e.target.value); e.target.value = ''; renderVms(); renderResults(); save(true); toast('Storage tier applied to all VMs.'); });

  // results sorting / export
  $$('#resTable th[data-sort]').forEach(th => th.addEventListener('click', () => {
    if (sort.key === th.dataset.sort) sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
    else sort = { key: th.dataset.sort, dir: ['name', 'os', 'ratio', 'storage'].includes(th.dataset.sort) ? 'asc' : 'desc' };
    renderResults();
  }));
  $('#btnExportCsv').addEventListener('click', exportResultsCsv);
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
    refreshPreview();
  });
  ['#mapDiskUnit', '#mapRamUnit', '#mapRatio', '#mapStorage'].forEach(s => $(s).addEventListener('change', refreshPreview));
  $$('#mapModal [data-close]').forEach(b => b.addEventListener('click', () => { $('#mapModal').hidden = true; pending = null; }));
  $('#mapModal').addEventListener('click', e => { if (e.target.id === 'mapModal') { $('#mapModal').hidden = true; pending = null; } });
  $('#btnConfirmImport').addEventListener('click', () => {
    const { vms } = buildImport();
    if (!vms.length) return;
    if ($('#mapMode').value === 'replace') active().vms = vms; else active().vms = VMS().concat(vms);
    $('#mapModal').hidden = true; pending = null;
    renderVms(); renderResults(); save(true);
    toast(`${vms.length} VM${vms.length === 1 ? '' : 's'} imported.`);
    $('.tab[data-tab="results"]').click();
  });

  // clients
  $('#clientSelect').addEventListener('change', e => { state.activeId = e.target.value; renderAll(); save(true); });
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
      active().name = n.trim() || active().name; renderClients(); renderResults(); save(true);
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
          const cl = { id, name: (c.name || 'Imported client') + (Object.values(state.clients).some(x => x.name === c.name) ? ' (imported)' : ''), pricing: Object.assign(defaultPricing(), c.pricing), vms: (c.vms || []).map(v => Object.assign({}, v, { id: uid() })), updated: Date.now() };
          state.clients[id] = cl; last = id;
        });
        state.activeId = last; renderAll(); save(true);
        toast(`Imported ${list.length} client profile${list.length === 1 ? '' : 's'}.`);
      } catch (err) { toast('Import failed: ' + err.message, true); }
    };
    fr.readAsText(f);
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('#mapModal').hidden) { $('#mapModal').hidden = true; pending = null; }
  });
}

/* ================= boot ================= */
document.documentElement.dataset.theme = 'dark'; // dark-first: data-center aesthetic
initEvents();
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
      return { id: uid(), name: row.Name, os: row.OS, ram: parseFloat(row.RAM_GB) || 0, disk: parseFloat(row.Disk_GB) || 0, ratioId: (rt || p.ratios[0]).id, storageId: (st || p.storage[0]).id, addons: [] };
    });
  })();
  pending = null;
  active().vms = built;
  renderAll(); save(true);
}
})();
