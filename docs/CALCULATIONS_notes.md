# CALCULATIONS.pdf — build notes

- Output: `/home/user/workspace/vm-cost-calculator/docs/CALCULATIONS.pdf` (8 pages, letter)
- Generator (re-runnable): `docs/make_calculations_pdf.py` (ReportLab; downloads Inter + JetBrains Mono to /tmp/fonts, instances static weights with fontTools using `updateFontNames=True` — required, otherwise ReportLab dedupes the faces and bold silently renders as regular)
- Page previews: `docs/page-1.png` … `page-8.png`
- Metadata: Title "VM Cost Calculator — Calculation Methodology", Author "Perplexity Computer"
- Clickable links: live app + repo on the title page, plus the References block (app, repo, PapaParse)
- Version note: git commit `8c75bee`, Aug 4, 2026

## Code facts documented (all read from app.js, commit 8c75bee)

- `costVm()`: total = r2(compute + vmware + storage + spla + addons + dr)
- compute = round(ram × ratio.price); vmware = round(ram × vmwareLic.price) only if `vmwareLic.enabled`
- storage: `SU(tier)` = 'GB' → qty = disk (divisor bypassed); else qty = disk ÷ divisor (`tbOf`)
- spla = round(spla.price) when `/windows/i` matches `vm.os`
- DR: only when `vm.dr === true`; dr_storage = round(drGb × dr.storage.price), dr_fee = round(dr.fee.price), `dr = r2(dr_storage + dr_fee)` (always r2, regardless of rounding mode)
- add-ons: per-vm qty 1, per-gb-ram qty = ram, per-tb-disk qty = tb (uses divisor); each amount rounded, subtotal rounded
- rounding setting: `'line'` → round() = r2() (affects stored numbers, not display-only); `'total'` → identity
- `usd()` = toLocaleString en-US currency, exactly 2 fraction digits (display layer only)
- divisor setting: 1024 (default) | 1000; fallback 1024 if missing
- CSV import scaling: disk/DR MB×1/1024, GB×1, TB×1024; RAM MB×1/1024, GB×1; stored via r2()
- aggregations (grand/KPI, per-location, SKU roll-up) are plain sums of per-VM values

## Worked examples (verified in Python against the JS semantics)

Defaults: 4:1 $10/GB, 2:1 $15/GB, VMware lic $10/GB, 3819 $333/TB, 3815 $359/TB, SPLA $99/VM,
DR $0.15/GB + $25/VM, divisor 1024, rounding = line.

| VM | Compute | VMware | Storage | SPLA | DR | Total |
|---|---|---|---|---|---|---|
| WEB01 (16 GB, 200 GB SF, Win, 250 DR GB) | 160.00 | 160.00 | 65.04 | 99.00 | 62.50 | **546.54** |
| SQL01 (64 GB 2:1, 1024 GB HPF, Win, 1200 DR GB) | 960.00 | 640.00 | 359.00 | 99.00 | 205.00 | **2,263.00** |
| APP01 (32 GB, 500 GB SF, Linux, no DR) | 320.00 | 320.00 | 162.60 | 0.00 | 0.00 | **802.60** |
| FILE01 (8 GB, 1500 GB SF, Win, no DR) | 80.00 | 80.00 | 487.79 | 99.00 | 0.00 | **746.79** |

3-VM subtotal $3,612.14; full 4-VM sample inventory $4,358.93.
Locations: Columbus - DUB $2,809.54 (77.8%), Indianapolis $802.60 (22.2%) for the 3-VM set.
