# VM Cost Calculator

A reusable, pure client-side web app for calculating monthly cost per VM in a VMware Cloud Director environment. Built for MSP billing models based on Expedient Enterprise Cloud SKUs.

**Live app:** https://vmcost-vmw.pplx.app

## Features

- **Pricing configuration** — fully editable SKU catalog:
  - Compute ratio tiers per GB RAM (SKU 2721 4:1; add 2:1, 1:1, 8:1, etc.)
  - Storage tiers priced **per TB or per GB** (SKU 3815 High Performance Flash, 3819 Standard Flash)
  - VMware licensing per GB RAM (SKU 2729) with apply-to-all toggle
  - Windows Server SPLA per VM (SKU 2589), auto-applied when the OS contains "Windows"
  - **Disaster recovery (Zerto)** — DR storage priced per GB of replicated footprint plus a flat Zerto replication fee per protected VM (both with editable SKU codes)
  - Custom add-ons priced per VM, per GB RAM, or per TB disk
  - Configurable GB→TB divisor (1024 or 1000)
- **VM inventory** — manual entry or CSV import with a column-mapping step (auto-detects RVTools / Cloud Director headers, MB/GB/TB units, location columns, Zerto DR flag and DR storage columns), per-VM ratio tier, storage tier, data center location, **Zerto DR toggle with a manually entered DR storage (GB) value**, and add-ons
- **CSV import modes** — every import ends in a mapping modal where you choose what happens to the existing inventory:
  - **Replace inventory** — discard the current VM list and use the file
  - **Append to inventory** — add the file's rows as new VMs
  - **Merge / update existing VMs** — match rows to existing VMs by server name (case-insensitive, trimmed) and update **only the columns you mapped**. Everything else — including the fallback ratio tier, fallback storage tier and default location, which apply to newly added rows only — is left untouched. Requires the VM name column to be mapped. Rows with no matching VM can be **added as new VMs** or **skipped**; existing VMs absent from the file are never modified. Duplicate names in the CSV resolve to the last row (with a warning); duplicate names in the inventory are all updated. The preview tags each row `update` / `add new` / `skip` and shows `unchanged` for fields that will not be written, and an on-page summary reports how many VMs were updated, added and skipped plus the unmatched names.

    Typical use: a client inventory already priced without DR, then a CSV with just `Name,Zerto,DR_Storage_GB` merged in — DR costs appear for the matched VMs and nothing else changes.
- **Cost breakdown** — sortable per-VM table (including a DR $ column) with drag-resizable columns and a frozen server-name column, KPI summary cards, SKU roll-up, cost-by-location roll-up with location filter, CSV export
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
  + DR_storage_GB × dr_storage_rate         (if Zerto DR enabled for this VM, else 0)
  + zerto_replication_fee                   (if Zerto DR enabled for this VM, else 0)
```

Zerto DR charges apply only to VMs flagged as protected. `DR_storage_GB` is entered (or imported) per VM
and is never derived from provisioned disk. Example: 500 DR GB at $0.15/GB + a $25.00 replication fee = **$100.00 / mo** of DR cost.

## Development

Open `index.html` in a browser, or serve the directory with any static file server:

```bash
python3 -m http.server 8080
```

When changing `app.js` or `styles.css`, bump the `?v=` cache-busting query string in `index.html`.
