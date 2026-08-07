# VM Cost Calculator

A reusable, pure client-side web app for calculating monthly cost per VM in a VMware Cloud Director environment. Built for MSP billing models based on Expedient Enterprise Cloud SKUs.

**Live app:** https://vmcost-vmw.pplx.app

## Features

- **Pricing configuration** — fully editable SKU catalog:
  - Compute ratio tiers per GB RAM (SKU 2721 4:1; add 2:1, 1:1, 8:1, etc.)
  - Storage tiers priced **per TB or per GB** (SKU 3815 High Performance Flash, 3819 Standard Flash)
  - VMware licensing per GB RAM (SKU 2729) with apply-to-all toggle
  - Windows Server SPLA per VM (SKU 2589), auto-applied when the OS contains "Windows"
  - **Disaster recovery (Zerto)** — an open-ended table of DR storage tiers, each priced per GB of replicated footprint (its own SKU, name and rate — add/remove tiers and set a default, same as storage tiers), plus a single flat Zerto replication fee per protected VM shared across all tiers (also editable SKU/name/rate). Each protected VM picks its own DR storage tier independently of its primary storage tier — useful when a client replicates some VMs to standard DR storage and others to a higher-performance tier.
  - Custom add-ons priced per VM, per GB RAM, or per TB disk
  - Configurable GB→TB divisor (1024 or 1000)
- **VM inventory** — manual entry or CSV import with a column-mapping step (auto-detects RVTools / Cloud Director headers, MB/GB/TB units, location columns, Zerto DR flag, DR storage and DR storage tier columns), per-VM ratio tier, storage tier, data center location, **Zerto DR toggle with a manually entered DR storage (GB) value and its own DR storage tier picker**, and add-ons. The table has the same **drag-resizable columns** (with a "Reset column widths" auto-fit) and **sticky horizontal scrollbar pinned to the bottom of the viewport** as the Cost breakdown table, so a wide inventory or a long VM list can be panned sideways without scrolling to either edge first.
- **CSV import modes** — every import ends in a mapping modal where you choose what happens to the existing inventory:
  - **Replace inventory** — discard the current VM list and use the file
  - **Append to inventory** — add the file's rows as new VMs
  - **Merge / update existing VMs** — match rows to existing VMs and update **only the columns you mapped**. Everything else — including the fallback ratio tier, fallback storage tier and default location, which apply to newly added rows only — is left untouched. Requires the VM name column to be mapped. Rows with no matching VM can be **added as new VMs** or **skipped**; existing VMs absent from the file are never modified. The preview tags each row `update` / `add new` / `skip`, shows `unchanged` for fields that will not be written, and diffs any mapped field that's actually changing on a single-VM match as **old → new**; an on-page summary reports how many VMs were updated, added and skipped plus the unmatched names.

    **Match existing VMs by** — **Name** (case-insensitive, trimmed) or **Name + location**. Same-named VMs at different sites are common (templated hostnames across data centers); matching by name alone would update every VM sharing that name, so name+location scopes the match to the one at the mapped location. Needs a mapped location column — without one, matching falls back to name only, with a note in the preview. The mapper defaults to name+location automatically when the current inventory already has the same name at more than one location. Duplicate rows in the CSV resolve to the last row (with a warning); duplicate matches in the inventory (same name, or same name **and** location) are all updated.

    **Also match after stripping a trailing vCenter ID** — Cloud Director creates the underlying vCenter VM object with a random 4-character suffix (e.g. `SERVER01-a1B2`) whenever the vCD-visible name needs disambiguating in vCenter. Tools that read vCenter directly — Zerto Analytics, RVTools by MoRef, etc. — report that suffixed name, while vCD's own exports usually show the clean one, so the same VM can appear under two different-looking names. When this option is on, a CSV row that doesn't match any VM as-is gets a second try with a trailing `-XXXX` stripped from its name; a successful stripped match is flagged `· ID stripped` in the preview and counted separately in the summary. The mapper defaults this on when it detects unmatched CSV names that would resolve after stripping.

    **DR storage GB with no protected/unprotected column mapped** — some sources (Zerto Analytics' own VM report, for example) have no explicit yes/no flag column at all, since every row in the export is inherently a protected VM. In that case a **positive** DR storage value is treated as authoritative proof of protection and turns DR on for the matched VM; a **zero or blank** value only updates the stored footprint number and never turns DR off on its own, since it can't be told apart from "no data for this VM in this file."

    Typical use: a client inventory already priced without DR, then a CSV with just `Name,Zerto,DR_Storage_GB` merged in — DR costs appear for the matched VMs and nothing else changes. Or: a Zerto Analytics VM report merged in with only its `VM Name` and `Used Storage (MB)` columns mapped — DR turns on and the footprint is set (converted from MB) for every VM Zerto reports as protected, matched by name even where Cloud Director and vCenter disagree on it. A `DR storage tier` column maps the same way as ratio/storage tier columns — matched against the configured DR storage tiers by name or SKU (exact, then fuzzy), with an unrecognised value falling back to a configurable fallback tier (new rows) or left unchanged (merge updates).
- **Undo last change** — CSV import (replace, append or merge) and the Inventory tab's "apply to all VMs" bulk actions (ratio tier, storage tier, DR storage tier, location, Zerto DR, Clear all) each leave a single-level undo behind: a banner naming what just happened appears above the inventory table with an **Undo** button and a dismiss. Taking another one of these actions replaces whatever was pending — it's one step back, not a history. The snapshot lives in memory only (a page reload loses it) and is scoped to the client it was taken on, so switching profiles hides it until you switch back.
- **Tags in CSV** — a `Tags` column is auto-detected on import and always written on export; multiple values live in one cell (see [Tags](#tags))
- **VM tags** — zero or more reusable free-form labels per VM (chip editor in the inventory, bulk tagging in the Cost breakdown, CSV round-trip). See [Tags](#tags).
- **Cost breakdown** — per-VM table (including a DR $ column) with **prioritized multi-column sorting**, an **advanced filter builder**, **column visibility presets**, a **sticky horizontal scrollbar pinned to the bottom of the viewport**, a Tags column, row selection for bulk tagging, drag-resizable columns, frozen checkbox / # / server-name columns, KPI summary cards, SKU roll-up, cost-by-location roll-up with location filter, and a scoped CSV export. See [Cost breakdown workflow](#cost-breakdown-workflow).
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
- In **merge** mode, once a Tags column is mapped a **Tags** option appears choosing what a *populated* cell does
  to that VM's existing list — **Replace existing tags** (default) overwrites it entirely, **Add to existing
  tags** unions the cell's tags in instead, using the same normalization as everywhere else (case-insensitive
  dedup, first spelling wins, capped at 12 per VM — extras from the union are dropped silently, same as any other
  tag entry point). A *blank* cell always leaves existing tags untouched either way (the preview shows
  `unchanged`). Set **Rows with no matching VM → Skip them** when re-importing an exported file so summary rows
  are ignored.
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

### Column visibility

The **Columns** button (next to *Reset sort*) opens a dialog listing all 18 table columns grouped by purpose.
Tick or untick individual columns, or apply a preset:

| Preset | Columns shown (besides the frozen Selection / # / Name) |
|--------|--------------------------------------------------------|
| **VM configuration** | OS · Location · Tags · RAM GB · Disk GB · Ratio · Storage tier · Total / mo |
| **Core costs** | RAM GB · Disk GB · Compute $ · VMware lic $ · Storage $ · Total / mo |
| **Licensing** | OS · VMware lic $ · Win SPLA $ · Add-ons $ · Total / mo |
| **Storage & DR** | Disk GB · Storage tier · Storage $ · Zerto · DR $ · Total / mo |
| **All columns** | Everything (default) |

*Total / mo* anchors every preset so a bottom-line figure is always on screen.

- **Selection, # and Name cannot be hidden** — they stay visible and frozen at the left edge, so the sticky
  offsets never move when other columns are hidden.
- Presets apply immediately. Changing any checkbox afterwards keeps the new set and reports the state as
  **Custom**. Unticking the last remaining data column is refused: *Total / mo* is kept.
- **Hiding a column is visual only.** Sorting, filter rules, the footer totals, the KPI cards, the SKU and
  location roll-ups, bulk tagging and **both CSV export scopes always use the full data set** — a hidden column
  still contributes every field to `Export results CSV`.
- If a hidden column is still driving the view, that is stated in words (never colour alone): the summary line
  above the table appends `sort: Location ↑ (hidden column)`, an `N columns hidden` count and a
  `⚠ hidden columns still applied: …` note, and the Columns dialog repeats the warning at the top.
- Column widths are stored per column, not per position, so a column you hide and re-show returns at its own
  width; a newly revealed column is auto-fitted to its content. Resizing, auto-fit (double-click an edge) and
  **Reset column widths** all work on whatever is currently visible.
- The visible set and the selected preset are saved in the client profile, alongside sort, filter rules and
  column widths — they survive tab switches, reloads and profile switching, and each client keeps its own.

### Sticky horizontal scrollbar

Wide tables are hard to pan when their native scrollbar sits far below the fold, so a second horizontal
scrollbar pins itself to the bottom of the viewport. It follows whichever of the **Results** or **VM inventory**
tables is on screen — one at a time, since only one tab is visible at once — and appears only when all of the
following are true:

- the **Results** or **VM inventory** tab is active and its table is rendered,
- that table is actually overflowed horizontally,
- part of the table is on screen, and
- the table's own bottom scrollbar is **not** in view (once it is, the sticky bar disappears — the native
  scrollbar is always preserved).

It matches the table's left edge and width, mirrors the table's scroll position in both directions, and
re-measures on window resize, column resize and column show/hide. The thumb is drawn rather than native, because
overlay scrollbars (macOS, some Chrome builds) fade out and would leave an empty strip. It is a real
`role="scrollbar"` control: focusable, with `aria-valuenow` and a live percentage readout (and an `aria-label`
naming whichever table it currently controls), draggable, click-to-jump on the track, and `←` / `→` (hold `Shift`
for a bigger step), `Page Up` / `Page Down`, `Home` and `End` from the keyboard. On touch-width screens it spans
the full width and grows to a 40px bar with a 26px track. It never covers page controls, is pushed clear of the
footer, and never prints.

The VM inventory table also has the same drag-resizable columns as Results (drag an edge to resize, double-click
to auto-fit one column, **Reset column widths** to auto-fit all of them) — minus column show/hide and frozen
columns, which inventory doesn't have. Widths are saved per client profile the same way.

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

Header sort buttons, filter rules, the selection bar, the tag chip editors, the Columns dialog, the sticky
horizontal scrollbar and every modal are fully keyboard-operable with visible focus rings; `Escape` closes any
modal and returns focus to the button that opened it. Status text, hidden-column counts and hidden-but-applied
warnings are spelled out in words, never signalled by colour alone. Interactive targets are ~44px where the
table's density allows, and no text is rendered below 12px.

## Architecture

Static site — no backend, no build step. All data stays in the browser (localStorage).

| File | Purpose |
|------|---------|
| `index.html` | Layout, tabs, modals, templates |
| `app.js` | State, reactive rendering, cost math, tags, sort/filter engines, column visibility, sticky scrollbar, CSV import/export, profiles |
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
  + DR_storage_GB × dr_storage_tier_rate    (rate from this VM's own DR storage tier, if Zerto DR enabled, else 0)
  + zerto_replication_fee                   (flat, same rate for every protected VM regardless of DR storage tier)
```

Zerto DR charges apply only to VMs flagged as protected. `DR_storage_GB` is entered (or imported) per VM
and is never derived from provisioned disk. Each protected VM is billed at its own DR storage tier's rate —
tiers are configured in Pricing config the same way as primary storage tiers (add, remove, set a default),
but the flat Zerto replication fee is a single global rate, not tier-specific. Example: a VM on a 500 DR GB
footprint assigned to a $0.15/GB tier plus the $25.00 replication fee = **$100.00 / mo** of DR cost; another
VM on the same footprint assigned to a $0.25/GB tier instead = **$150.00 / mo**.

## Development

Open `index.html` in a browser, or serve the directory with any static file server:

```bash
python3 -m http.server 8080
```

When changing `app.js` or `styles.css`, bump the `?v=` cache-busting query string in `index.html` —
and update the visible version badge in the topbar (`#appVersion` and its `title="Build …"` tooltip,
right next to it) to match. There's no build step to keep these in sync automatically.
