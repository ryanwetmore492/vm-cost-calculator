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
- **Tags in CSV** — a `Tags` column is auto-detected on import and always written on export; multiple values live in one cell (see [Tags](#tags))
- **VM tags** — zero or more reusable free-form labels per VM (chip editor in the inventory, bulk tagging in the Cost breakdown, CSV round-trip). See [Tags](#tags).
- **Cost breakdown** — per-VM table (including a DR $ column) with **prioritized multi-column sorting**, an **advanced filter builder**, a Tags column, row selection for bulk tagging, drag-resizable columns, frozen checkbox / # / server-name columns, KPI summary cards, SKU roll-up, cost-by-location roll-up with location filter, and a scoped CSV export. See [Cost breakdown workflow](#cost-breakdown-workflow).
- **Multi-client profiles** — save/load client environments (VM list + pricing) in browser localStorage, with JSON export/import for backup and sharing

## Tags

Tags are free-form labels (`prod`, `tier-1`, `pci-scope`, `migrate-q3`…) attached to individual VMs. They are
stored with the client profile, so every client has its own tag vocabulary.

**Normalization rules** — applied everywhere (manual entry, bulk tagging, CSV import):

| Rule | Behaviour |
|------|-----------|
| Whitespace | Trimmed, internal runs collapsed to one space |
| Blanks | Dropped silently |
| Duplicates | De-duplicated case-insensitively, **first spelling wins** (`Prod` then `prod` → `Prod`) |
| Max length | 32 characters — longer tags are rejected with a toast |
| Max per VM | 12 tags — extras are rejected with a toast |

**Editing tags**

- *VM inventory tab* — each row has a chip editor. Type and press `Enter`, `;`, `,` or `|` to commit; blur also
  commits. Click a chip's `✕` to remove it, or press `Backspace` in an empty input to remove the last chip.
  Suggestions come from a datalist of the tags already used in the current profile — there is no separate catalog to maintain.
- *Cost breakdown tab* — tick rows (or **Select all visible**) and use **Add tags…**, **Remove tags…** or
  **Replace tags…**. The modal offers the profile's existing tags as one-click chips with usage counts.
  **Replace** overwrites the whole tag list on every selected VM and is gated by a confirmation checkbox inside
  the modal (the Apply button stays disabled until it is ticked); an empty list clears all tags. Bulk actions
  apply to **every selected VM**, including ones currently hidden by a filter — the selection bar states how
  many selected rows are hidden.

**CSV syntax**

- Canonical export delimiter is a **semicolon**: `"prod;web;tier-1"`. Quote the cell whenever it contains a
  delimiter or a comma.
- Imports accept `;`, `,` or `|` inside the cell: `"prod, web, tier-1"` and `"prod|web|tier-1"` parse identically.
- Header auto-detection matches `Tags`, `Tag`, `Labels`, `Categories`-style headers; otherwise map the column
  manually in the import dialog.
- In **merge** mode a *populated* Tags cell **replaces** that VM's tag list, while a *blank* cell leaves the
  existing tags untouched (the preview shows `unchanged`). Set **Rows with no matching VM → Skip them** when
  re-importing an exported file so summary rows are ignored.
- Tags round-trip: export → import (merge, unmatched = skip) reproduces the same tags.

See `sample-vm-inventory.csv` for a working example.

## Cost breakdown workflow

**Composition order** is always: full inventory → **location filter** → **filter rules** → **sort**. The table,
the KPI cards, the table footer totals, the SKU roll-up, the cost-by-location roll-up and the *visible results*
CSV export all consume that same row set, so every number on the tab agrees with the rows you can see. The
summary line above the table always spells out how many of the total VMs are shown, the active location, the
number of active rules and the current sort.

### Multi-column sorting

- **Click** a column header → sort by that column only; click again to reverse.
- **Shift-click** a header → add it as an extra sort level, or reverse it if it is already in the list.
- Direction and priority are shown in the header (`↑1`, `↓2`) and exposed to assistive tech via `aria-sort`;
  headers are real buttons, so `Enter` / `Space` (and `Shift`+`Enter`) work from the keyboard.
- Up to **4** sort levels; adding a fifth prompts you to remove one first. **Reset sort** returns to the default
  (Total / mo, descending).
- Every column sorts with a type-appropriate comparator: text (server name, OS, location, storage tier, tags),
  numeric (RAM, disk, ratio and all charge columns) and boolean (Zerto DR).
- Sort state is saved with the client profile, so it survives tab switches, reloads and profile changes.

### Advanced filter builder

Open **Advanced filters** and add rules over any inventory field or charge column. Operators depend on the
field type:

| Field type | Fields | Operators |
|------------|--------|-----------|
| Text | Server name, OS | contains · equals · does not contain · starts with · is empty |
| Categorical | Location, Ratio tier, Storage tier | is · is not |
| Boolean | Zerto DR, Windows SPLA applies | is · is not |
| Numeric | RAM GB, Disk GB, DR storage GB, Compute $, VMware lic $, Storage $, Win SPLA $, Add-ons $, DR $, Total / mo $ | = · ≠ · > · ≥ · < · ≤ · between |
| Tags | Tags | contains any of · contains all of · contains none of · is empty |

- Rules combine with **All rules (AND)** or **Any rule (OR)**.
- Text rules are case-insensitive; tag rules take a `;` / `,` / `|` separated list of tags.
- A rule with no value yet is **inert** — it is ignored and reported as "incomplete" in the summary rather than
  emptying the table.
- **Clear all rules** removes everything; the pill on the toggle button and the summary line show how many rules
  are active and how many rows survive.
- Rules are saved with the client profile alongside the sort state.

### Row selection

Selection is session-only (never persisted) and is **kept** when filters, location or sort change, so narrowing
the view does not silently drop VMs from a pending bulk action. **Select all visible** ticks the current result
set; **Clear selection** empties it.

### CSV export scope

**Export results CSV** opens a small scope dialog every time:

- **Current visible results** — exactly the filtered rows in the displayed sort order.
- **All inventory** — every VM in inventory order, ignoring location, rules and sort.

Both include the VM inputs, the intermediate cost columns, the Tags column, the SKU roll-up, the
cost-by-location roll-up and a **cost-by-tag** roll-up (a VM with several tags counts once per tag, so those rows
do not sum to the grand total), plus a header block restating the scope, location, rules, sort and tag delimiter.
Cells beginning `=`, `+`, `-`, `@`, tab or CR are prefixed with `'` to defeat spreadsheet formula injection.
Filenames follow `vm-costs-<client-slug>-<YYYY-MM-DD>-<visible|all-inventory>.csv`.

### Accessibility notes

Header sort buttons, filter rules, the selection bar, the tag chip editors and both modals are fully
keyboard-operable with visible focus rings; `Escape` closes any modal. Interactive targets are ~44px where the
table's density allows, and no text is rendered below 12px.

## Architecture

Static site — no backend, no build step. All data stays in the browser (localStorage).

| File | Purpose |
|------|---------|
| `index.html` | Layout, tabs, modals, templates |
| `app.js` | State, reactive rendering, cost math, tags, sort/filter engines, CSV import/export, profiles |
| `styles.css` | Dark/light enterprise theme |
| `sample-vm-inventory.csv` | Example import file (includes a `Tags` column) |

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
