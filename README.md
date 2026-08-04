# VM Cost Calculator

A reusable, pure client-side web app for calculating monthly cost per VM in a VMware Cloud Director environment. Built for MSP billing models based on Expedient Enterprise Cloud SKUs.

**Live app:** https://vmcost-vmw.pplx.app

## Features

- **Pricing configuration** — fully editable SKU catalog:
  - Compute ratio tiers per GB RAM (SKU 2721 4:1; add 2:1, 1:1, 8:1, etc.)
  - Storage tiers priced **per TB or per GB** (SKU 3815 High Performance Flash, 3819 Standard Flash)
  - VMware licensing per GB RAM (SKU 2729) with apply-to-all toggle
  - Windows Server SPLA per VM (SKU 2589), auto-applied when the OS contains "Windows"
  - Custom add-ons priced per VM, per GB RAM, or per TB disk
  - Configurable GB→TB divisor (1024 or 1000)
- **VM inventory** — manual entry or CSV import with a column-mapping step (auto-detects RVTools / Cloud Director headers, MB/GB/TB units, location columns), per-VM ratio tier, storage tier, data center location, and add-ons
- **Cost breakdown** — sortable per-VM table with drag-resizable columns and a frozen server-name column, KPI summary cards, SKU roll-up, cost-by-location roll-up with location filter, CSV export
- **Multi-client profiles** — save/load client environments (VM list + pricing) in browser localStorage, with JSON export/import for backup and sharing

## Architecture

Static site — no backend, no build step. All data stays in the browser (localStorage).

| File | Purpose |
|------|---------|
| `index.html` | Layout, tabs, modals, templates |
| `app.js` | State, reactive rendering, cost math, CSV import/export, profiles |
| `styles.css` | Dark/light enterprise theme |
| `sample-vm-inventory.csv` | Example import file |

Only third-party dependency: [PapaParse 5.4.1](https://www.papaparse.com/) via CDN (SRI-pinned) for CSV parsing.

## Cost model

```
monthly_cost(vm) =
    RAM_GB × ratio_tier_rate
  + RAM_GB × vmware_licensing_rate          (if enabled)
  + storage_qty × storage_tier_rate         (qty = Disk_GB or Disk_GB ÷ divisor, per tier unit)
  + SPLA_flat_fee                           (if OS contains "windows")
  + selected add-ons                        (per VM / per GB RAM / per TB disk)
```

## Development

Open `index.html` in a browser, or serve the directory with any static file server:

```bash
python3 -m http.server 8080
```

When changing `app.js` or `styles.css`, bump the `?v=` cache-busting query string in `index.html`.
