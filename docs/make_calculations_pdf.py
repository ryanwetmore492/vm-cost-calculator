#!/usr/bin/env python3
"""Build CALCULATIONS.pdf — VM Cost Calculator calculation methodology.

All formulas mirror app.js (commit 8c75bee) exactly.
"""
import re
from pathlib import Path
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.enums import TA_LEFT
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, KeepTogether, HRFlowable, PageBreak)

FONTS = Path("/tmp/fonts")
pdfmetrics.registerFont(TTFont("Inter", FONTS / "Inter-Regular.ttf"))
pdfmetrics.registerFont(TTFont("Inter-Med", FONTS / "Inter-Medium.ttf"))
pdfmetrics.registerFont(TTFont("Inter-SB", FONTS / "Inter-SemiBold.ttf"))
pdfmetrics.registerFont(TTFont("Inter-Bold", FONTS / "Inter-Bold.ttf"))
pdfmetrics.registerFont(TTFont("Mono", FONTS / "Mono-Regular.ttf"))
pdfmetrics.registerFontFamily("Inter", normal="Inter", bold="Inter-Bold", italic="Inter", boldItalic="Inter-Bold")

BG = HexColor("#F7F6F2")
SURF = HexColor("#F9F8F5")
SURF2 = HexColor("#FBFBF9")
BORDER = HexColor("#D4D1CA")
TEXT = HexColor("#28251D")
MUTED = HexColor("#7A7974")
FAINT = HexColor("#BAB9B4")
ACCENT = HexColor("#01696F")

OUT = Path("/home/user/workspace/vm-cost-calculator/docs/CALCULATIONS.pdf")
OUT.parent.mkdir(parents=True, exist_ok=True)

APP_URL = "https://vmcost-vmw.pplx.app"
REPO_URL = "https://github.com/ryanwetmore492/vm-cost-calculator"
COMMIT = "8c75bee"

ss = getSampleStyleSheet()
body = ParagraphStyle("body", parent=ss["Normal"], fontName="Inter", fontSize=9.3, leading=13.4,
                      textColor=TEXT, spaceAfter=6)
small = ParagraphStyle("small", parent=body, fontSize=8.4, leading=12.2, textColor=MUTED)
h1 = ParagraphStyle("h1", parent=body, fontName="Inter-SB", fontSize=14.5, leading=18, textColor=TEXT,
                    spaceBefore=13, spaceAfter=6)
h2 = ParagraphStyle("h2", parent=body, fontName="Inter-SB", fontSize=10.6, leading=14, textColor=ACCENT,
                    spaceBefore=10, spaceAfter=4)
eyebrow = ParagraphStyle("eyebrow", parent=body, fontName="Inter-Med", fontSize=7.6, leading=10,
                         textColor=ACCENT, spaceAfter=3)
title = ParagraphStyle("title", parent=body, fontName="Inter-Bold", fontSize=25, leading=29,
                       textColor=TEXT, spaceAfter=6)
sub = ParagraphStyle("sub", parent=body, fontName="Inter", fontSize=10.6, leading=15, textColor=MUTED,
                     spaceAfter=4)
formula = ParagraphStyle("formula", parent=body, fontName="Mono", fontSize=8.3, leading=12.0,
                         textColor=TEXT, spaceBefore=2, spaceAfter=2, leftIndent=8, rightIndent=6)
code = ParagraphStyle("code", parent=body, fontName="Mono", fontSize=8.2, leading=12, textColor=MUTED)
bullet = ParagraphStyle("bullet", parent=body, leftIndent=12, bulletIndent=2, spaceAfter=3.5,
                        bulletFontName="Inter", bulletFontSize=9)
cellL = ParagraphStyle("cellL", parent=body, fontSize=8.4, leading=11.4, spaceAfter=0)
cellS = ParagraphStyle("cellS", parent=cellL, fontSize=7.9, leading=10.6, textColor=MUTED)
cellH = ParagraphStyle("cellH", parent=cellL, fontName="Inter-SB", fontSize=7.9, leading=10.4,
                       textColor=HexColor("#FFFFFF"))
cellM = ParagraphStyle("cellM", parent=cellL, fontName="Mono", fontSize=7.7, leading=10.6)
foot = ParagraphStyle("foot", parent=body, fontSize=7.6, leading=10, textColor=MUTED, spaceAfter=2)

PW, PH = LETTER
MX = 0.82 * inch
CW = PW - 2 * MX


def fbox(lines, label=None):
    """Formula block on a tinted surface."""
    flows = []
    if label:
        flows.append(Paragraph(label, ParagraphStyle("fl", parent=small, fontName="Inter-Med",
                                                     fontSize=7.6, textColor=MUTED, spaceAfter=2)))
    for ln in lines:
        ln = re.sub(r"  +", lambda m: "&nbsp;" * len(m.group(0)), ln)
        flows.append(Paragraph(ln or "&nbsp;", formula))
    t = Table([[flows]], colWidths=[CW])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), SURF2),
        ("BOX", (0, 0), (-1, -1), 0.6, BORDER),
        ("LINEBEFORE", (0, 0), (0, -1), 2.2, ACCENT),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return t



def align(rows):
    """rows: list of (label, expression, result) or ('-',) rule / ('',) blank."""
    w1 = max(len(r[0]) for r in rows if len(r) == 3)
    w2 = max(len(r[1]) for r in rows if len(r) == 3)
    out = []
    for r in rows:
        if len(r) == 1:
            out.append("-" * (w1 + w2 + 8) if r[0] == "-" else "")
        else:
            out.append(f"{r[0]:<{w1}} = {r[1]:<{w2}} = {r[2]}")
    return out


def dtable(rows, widths, aligns=None, header=True, size=7.9):
    data = []
    for i, r in enumerate(rows):
        out = []
        for j, c in enumerate(r):
            if isinstance(c, Paragraph):
                out.append(c)
            else:
                st = cellH if (header and i == 0) else cellL
                out.append(Paragraph(str(c), st))
        data.append(out)
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0)
    style = [
        ("GRID", (0, 0), (-1, -1), 0.4, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    if header:
        style += [("BACKGROUND", (0, 0), (-1, 0), ACCENT),
                  ("ROWBACKGROUNDS", (0, 1), (-1, -1), [SURF2, SURF])]
    else:
        style += [("ROWBACKGROUNDS", (0, 0), (-1, -1), [SURF2, SURF])]
    if aligns:
        for j, a in enumerate(aligns):
            style.append(("ALIGN", (j, 0), (j, -1), a))
    t.setStyle(TableStyle(style))
    return t


def para_rows(rows, mono_cols=(), muted_cols=(), head=True):
    out = []
    for i, r in enumerate(rows):
        if head and i == 0:
            out.append([Paragraph(str(c), cellH) for c in r])
            continue
        row = []
        for j, c in enumerate(r):
            st = cellM if j in mono_cols else (cellS if j in muted_cols else cellL)
            row.append(Paragraph(str(c), st))
        out.append(row)
    return out


# ---------------------------------------------------------------- page furniture
def page(canv, doc):
    canv.saveState()
    canv.setFillColor(BG)
    canv.rect(0, 0, PW, PH, stroke=0, fill=1)
    if doc.page > 1:
        canv.setFont("Inter-Med", 7.4)
        canv.setFillColor(MUTED)
        canv.drawString(MX, PH - 0.5 * inch, "VM Cost Calculator — Calculation Methodology")
        canv.setFillColor(FAINT)
        canv.drawRightString(PW - MX, PH - 0.5 * inch, f"commit {COMMIT} · Aug 4, 2026")
        canv.setStrokeColor(BORDER)
        canv.setLineWidth(0.5)
        canv.line(MX, PH - 0.58 * inch, PW - MX, PH - 0.58 * inch)
    canv.setStrokeColor(BORDER)
    canv.setLineWidth(0.5)
    canv.line(MX, 0.62 * inch, PW - MX, 0.62 * inch)
    canv.setFont("Inter", 7.4)
    canv.setFillColor(MUTED)
    canv.drawString(MX, 0.46 * inch, "Source of truth: app.js — costVm() / defaultPricing()")
    canv.setFont("Inter-Med", 7.4)
    canv.setFillColor(TEXT)
    canv.drawRightString(PW - MX, 0.46 * inch, f"Page {doc.page}")
    canv.restoreState()


doc = BaseDocTemplate(str(OUT), pagesize=LETTER,
                      leftMargin=MX, rightMargin=MX, topMargin=0.72 * inch, bottomMargin=0.76 * inch,
                      title="VM Cost Calculator — Calculation Methodology",
                      author="Perplexity Computer",
                      subject="Per-VM monthly cost calculation methodology, formulas, and worked examples")
frame = Frame(MX, 0.76 * inch, CW, PH - 0.72 * inch - 0.76 * inch, id="f", showBoundary=0,
              leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
doc.addPageTemplates([PageTemplate(id="main", frames=[frame], onPage=page)])

S = []
A = S.append

# ---------------------------------------------------------------- title page
A(Paragraph("METHODOLOGY DOCUMENTATION", eyebrow))
A(Paragraph("VM Cost Calculator", title))
A(Paragraph("Calculation Methodology", ParagraphStyle("t2", parent=title, fontName="Inter",
                                                      fontSize=17, leading=21, textColor=ACCENT,
                                                      spaceAfter=10)))
A(HRFlowable(width="100%", thickness=1.1, color=ACCENT, spaceBefore=2, spaceAfter=10))
A(Paragraph(
    "Authoritative reference for how the calculator derives monthly recurring cost per virtual machine. "
    "Every formula in this document is transcribed from the shipped implementation in "
    "<font name='Mono' size='8.6'>app.js</font> so that the pricing output can be independently audited "
    "and reproduced by hand.", sub))
A(Spacer(1, 10))

meta = [
    ["Document version", f"git commit {COMMIT} · Aug 4, 2026"],
    ["Implementation reviewed", "app.js — costVm(), allCosts(), defaultPricing(), tbOf(), isWin(), r2(), usd()"],
    ["Live application", f'<a href="{APP_URL}" color="#01696F">{APP_URL}</a>'],
    ["Source repository", f'<a href="{REPO_URL}" color="#01696F">{REPO_URL}</a>'],
    ["Currency / period", "USD, monthly recurring (MRC)"],
    ["Prepared by", "Perplexity Computer"],
]
A(dtable([[Paragraph(k, ParagraphStyle("mk", parent=cellL, fontName="Inter-SB")),
           Paragraph(v, cellL)] for k, v in meta],
         widths=[1.75 * inch, CW - 1.75 * inch], header=False))

A(Paragraph("1. Overview", h1))
A(Paragraph(
    "The calculator is a pure client-side model of an MSP billing sheet for a VMware Cloud Director "
    "environment. It computes one monthly figure per VM as the sum of six independent charge lines, then "
    "aggregates those per-VM figures into grand totals, per-location totals and a SKU roll-up.", body))
A(fbox([
    "monthly_cost(vm) = compute",
    "                 + vmware_licensing      (global toggle)",
    "                 + storage",
    "                 + windows_spla          (OS contains &quot;windows&quot;)",
    "                 + add_ons",
    "                 + zerto_dr              (per-VM toggle)",
], label="COST MODEL — costVm(vm), app.js"))
A(Spacer(1, 6))
A(Paragraph(
    "<font name='Inter-Bold'>All rates are user-configurable.</font> The values shipped in <font name='Mono' size='8.6'>"
    "defaultPricing()</font> are placeholders for demonstration only — they are not contract rates and "
    "must be replaced with the client's negotiated SKU pricing before any quote is issued. Every VM "
    "attribute (RAM, provisioned disk, OS string, ratio tier, storage tier, location, DR flag, DR GB, "
    "selected add-ons) is entered manually or imported from CSV.", body))
A(Spacer(1, 4))
_rate_tbl = dtable(para_rows([
    ["SKU", "Charge line", "Default rate", "Unit / basis"],
    ["2721", "Enterprise Cloud Compute (4:1 processor ratio)", "$10.00", "per GB RAM / month"],
    ["CUSTOM", "Enterprise Cloud Compute (2:1 processor ratio)", "$15.00", "per GB RAM / month"],
    ["2729", "VMware Licensing", "$10.00", "per GB RAM / month (enabled by default)"],
    ["3819", "Enterprise Cloud Storage — Standard Flash", "$333.00", "per TB provisioned / month"],
    ["3815", "Enterprise Cloud Storage — High Performance Flash", "$359.00", "per TB provisioned / month"],
    ["2589", "Microsoft Windows Server Licensing (SPLA)", "$99.00", "per Windows VM / month"],
    ["(blank)", "DR Storage — Zerto Replication", "$0.15", "per DR GB / month"],
    ["(blank)", "Zerto Replication Fee", "$25.00", "per protected VM / month"],
], mono_cols=(0, 2)), widths=[0.62 * inch, 2.72 * inch, 0.85 * inch, CW - 4.19 * inch],
    aligns=["LEFT", "LEFT", "RIGHT", "LEFT"])
A(Paragraph("Default rate catalogue (placeholders)", h2))
A(_rate_tbl)
A(Paragraph("Global settings: GB→TB divisor = 1024 (default) or 1000; rounding mode = "
            "<i>round each line item</i> (default) or <i>round totals only</i>. "
            "DR SKU codes ship blank and are editable.", small))

# ---------------------------------------------------------------- components
A(Paragraph("2. Charge lines", h1))
A(Paragraph("Notation: <font name='Mono' size='8.6'>RAM_GB</font> = configured memory in GB; "
            "<font name='Mono' size='8.6'>Disk_GB</font> = provisioned (allocated) disk in GB; "
            "<font name='Mono' size='8.6'>divisor</font> = the GB→TB setting; "
            "<font name='Mono' size='8.6'>round()</font> = the rounding mode function defined in §4.", body))

A(Paragraph("2.1 Compute — SKU 2721 (4:1) and additional ratio tiers", h2))
A(Paragraph(
    "Each VM is assigned exactly one processor-ratio tier. Compute is billed strictly on configured RAM; "
    "vCPU count is not an input to the model. The ratio tier only selects a per-GB rate — the ratio itself "
    "(4:1, 2:1, …) is a label, not a multiplier.", body))
A(fbox([
    "compute = round( RAM_GB &times; ratio_tier_rate )",
    "",
    "units:    GB &times; ($/GB/month) = $/month",
    "applies:  always (every VM has a ratio tier)",
]))
A(Paragraph("Edge case: if the VM's <font name='Mono' size='8.6'>ratioId</font> no longer matches any tier "
            "in the catalogue (tier deleted), the rate resolves to 0 and compute is $0.00 — the tier shows "
            "as “— none —” in the results table.", small))

A(Paragraph("2.2 VMware licensing — SKU 2729", h2))
A(Paragraph("A second per-GB-RAM charge, governed by one global toggle "
            "(<font name='Mono' size='8.6'>vmwareLic.enabled</font>) that applies to all VMs at once. "
            "There is no per-VM override.", body))
A(fbox([
    "vmware = round( RAM_GB &times; vmware_lic_rate )   if vmwareLic.enabled",
    "vmware = 0                                    otherwise",
    "",
    "units:    GB &times; ($/GB/month) = $/month",
    "applies:  all VMs, or none",
]))

A(Paragraph("2.3 Storage — SKU 3819 (Standard Flash) and 3815 (High Performance Flash)", h2))
A(Paragraph("Each VM is assigned one storage tier. A tier is priced either <font name='Inter-Bold'>per TB</font> (default) or "
            "<font name='Inter-Bold'>per GB</font>, and that choice determines the billed quantity:", body))
A(fbox([
    "tier priced per TB:   storage_qty = Disk_GB &divide; divisor",
    "tier priced per GB:   storage_qty = Disk_GB            (divisor bypassed)",
    "",
    "storage = round( storage_qty &times; storage_tier_rate )",
    "",
    "units:    TB &times; ($/TB/month)  or  GB &times; ($/GB/month) = $/month",
    "applies:  always; billed on provisioned disk, not consumed disk",
]))
A(Paragraph("Edge cases: (a) a per-GB tier <font name='Inter-Bold'>bypasses the divisor entirely</font> — no GB→TB conversion is "
            "applied, so changing the divisor has no effect on those tiers; (b) tiers saved before the "
            "per-GB feature existed have no unit field and are normalised to per TB; (c) if the VM's "
            "storage tier is missing, quantity defaults to the TB basis and the rate resolves to 0, "
            "yielding $0.00.", small))

A(Paragraph("2.4 Windows Server SPLA — SKU 2589", h2))
A(Paragraph("A flat per-VM licence fee, applied automatically from the OS string. The test is a "
            "case-insensitive substring match — the regular expression "
            "<font name='Mono' size='8.6'>/windows/i</font> against the VM's OS field. Any OS text "
            "containing “windows” in any casing qualifies; there is no manual override and no per-core or "
            "per-socket scaling.", body))
A(fbox([
    "windows_spla = round( spla_rate )   if /windows/i matches vm.os",
    "windows_spla = 0                    otherwise",
    "",
    "units:    $/VM/month (flat, independent of RAM, disk and vCPU)",
    "matches:  &quot;Microsoft Windows Server 2022&quot;, &quot;windows server 2019&quot;, &quot;WINDOWS 10&quot;",
    "does not: &quot;Ubuntu Linux 22.04&quot;, &quot;RHEL 9&quot;, blank / missing OS",
]))

A(Paragraph("2.5 Zerto disaster recovery — DR storage + replication fee", h2))
A(Paragraph("DR is opt-in <font name='Inter-Bold'>per VM</font>. It contributes two amounts, both zero unless that VM's Zerto "
            "toggle is on. The DR footprint <font name='Mono' size='8.6'>DR_Storage_GB</font> (journal + "
            "replica) is entered or imported manually and is <font name='Inter-Bold'>never derived from provisioned disk</font>.", body))
A(fbox([
    "if vm.dr is true:",
    "    dr_storage = round( DR_Storage_GB &times; dr_storage_rate )",
    "    dr_fee     = round( zerto_replication_fee )",
    "else:",
    "    dr_storage = 0 ;  dr_fee = 0",
    "",
    "zerto_dr = r2( dr_storage + dr_fee )      &lt;- always rounded to cents",
    "",
    "units:    GB &times; ($/GB/month) + $/protected VM/month",
    "applies:  only VMs whose Zerto toggle is on",
]))
A(Paragraph("Edge cases: (a) the DR subtotal is rounded to cents with "
            "<font name='Mono' size='8.6'>r2()</font> regardless of the rounding-mode setting; "
            "(b) a VM flagged as protected with 0 DR GB is still charged the flat replication fee; "
            "(c) toggling DR off leaves the stored DR GB value in place but contributes $0.00 to both "
            "lines; (d) the DR footprint does not pass through the GB→TB divisor.", small))

A(Paragraph("2.6 Add-ons", h2))
A(Paragraph("Add-ons are optional catalogue entries selected per VM. Each add-on has one of three unit "
            "types, which determines its quantity:", body))
A(dtable(para_rows([
    ["Unit type", "Quantity", "Formula", "Divisor used?"],
    ["per-vm", "1", "round( 1 &times; addon_rate )", "n/a"],
    ["per-gb-ram", "RAM_GB", "round( RAM_GB &times; addon_rate )", "No"],
    ["per-tb-disk", "Disk_GB &divide; divisor", "round( (Disk_GB &divide; divisor) &times; addon_rate )", "Yes — same tbOf()"],
], mono_cols=(0, 1, 2)), widths=[0.95 * inch, 1.15 * inch, 2.45 * inch, CW - 4.55 * inch]))
A(Spacer(1, 5))
A(fbox([
    "add_ons = round( &Sigma; round( qty(a) &times; rate(a) ) for each selected add-on a )",
]))
A(Paragraph("Note: per-TB-disk add-ons always use the TB basis "
            "(<font name='Mono' size='8.6'>Disk_GB ÷ divisor</font>) — they ignore whether the VM's "
            "storage tier is priced per GB. Each add-on amount is rounded individually and the subtotal "
            "is rounded again. A selected add-on that has since been deleted from the catalogue is "
            "silently skipped.", small))

# ---------------------------------------------------------------- conversions & rounding
A(Paragraph("3. Unit conversions", h1))
A(Paragraph("The model stores RAM and disk in GB. Only one conversion exists in the cost engine:", body))
A(fbox([
    "tbOf(Disk_GB) = Disk_GB &divide; divisor        divisor &isin; {1024, 1000}, default 1024",
    "",
    "1024  binary basis (TiB) — default",
    "1000  decimal basis (TB)",
], label="GB TO TB — tbOf(), app.js"))
A(Paragraph("The divisor affects: per-TB storage tiers, per-TB-disk add-ons, and the “total disk in TB” "
            "KPI. It does <font name='Inter-Bold'>not</font> affect: compute, VMware licensing, per-GB storage tiers, SPLA, or "
            "Zerto DR storage. If the setting is ever missing or non-numeric, the code falls back to 1024.", body))
A(Paragraph("CSV import unit scaling", h2))
A(Paragraph("At import time the mapping modal lets each numeric column declare its source unit. Values "
            "are scaled to GB and rounded to two decimals before being stored, so all downstream math "
            "always operates on GB:", body))
A(dtable(para_rows([
    ["Column", "Selectable units", "Scale factor applied", "Stored as"],
    ["Disk", "MB / GB / TB", "MB &times; 1/1024 · GB &times; 1 · TB &times; 1024", "r2(value &times; scale) GB"],
    ["RAM", "MB / GB", "MB &times; 1/1024 · GB &times; 1", "r2(value &times; scale) GB"],
    ["DR storage", "MB / GB / TB", "MB &times; 1/1024 · GB &times; 1 · TB &times; 1024", "r2(value &times; scale) GB"],
], mono_cols=(2, 3)), widths=[0.85 * inch, 1.15 * inch, 2.3 * inch, CW - 4.3 * inch]))
A(Paragraph("Import scaling always uses 1024 for MB/TB conversion — it is independent of the GB→TB "
            "billing divisor. Non-numeric cells are stripped of non-digit characters; if still not "
            "numeric they become 0 and a row-level warning is raised.", small))

A(Paragraph("4. Rounding and currency display", h1))
A(Paragraph("A single helper performs all monetary rounding — half-up to two decimals with an epsilon "
            "nudge to counter binary floating-point representation error:", body))
A(fbox([
    "r2(n) = Math.round( (n + Number.EPSILON) &times; 100 ) &divide; 100",
], label="ROUNDING PRIMITIVE — r2(), app.js"))
A(Paragraph("Rounding is <font name='Inter-Bold'>not</font> display-only — it changes the stored numbers that the totals are "
            "built from. The rounding-mode setting selects which function wraps each line item:", body))
A(dtable(para_rows([
    ["Mode", "Line items", "Per-VM total", "Effect"],
    ["Round each line item<br/>(<font name='Mono' size='7.4'>rounding = 'line'</font>, default)",
     "round() = r2() — each of compute, VMware, storage, SPLA, each add-on amount and the add-on subtotal "
     "is rounded to cents",
     "r2( sum of rounded lines )",
     "Totals are the exact sum of the cent-accurate line items shown in the table"],
    ["Round totals only<br/>(<font name='Mono' size='7.4'>rounding = 'total'</font>)",
     "round() = identity — line items keep full floating-point precision internally",
     "r2( sum of unrounded lines )",
     "A per-VM total may differ by up to a cent from adding up the displayed line items"],
], muted_cols=()), widths=[1.5 * inch, 2.0 * inch, 1.25 * inch, CW - 4.75 * inch]))
A(Spacer(1, 5))
A(Paragraph("Two amounts are always rounded with <font name='Mono' size='8.6'>r2()</font> irrespective of "
            "the mode: the Zerto DR subtotal (<font name='Mono' size='8.6'>dr = r2(dr_storage + dr_fee)"
            "</font>) and the per-VM grand total (<font name='Mono' size='8.6'>total = r2(...)</font>).", body))
A(Paragraph("Display formatting is a separate, purely cosmetic layer: "
            "<font name='Mono' size='8.6'>usd()</font> renders values with "
            "<font name='Mono' size='8.6'>toLocaleString('en-US')</font> as USD currency with exactly two "
            "fraction digits; non-finite values render as $0.00. Rate inputs are shown with more precision "
            "where needed — per-GB storage and DR rates display up to four decimals so a rate such as "
            "$0.325/GB is not visually rounded away — but the underlying stored rate is used unmodified in "
            "the arithmetic.", body))

# ---------------------------------------------------------------- aggregations
A(Paragraph("5. Aggregations", h1))
A(Paragraph("<font name='Inter-Bold'>All aggregates are plain sums of the per-VM values</font> produced by "
            "<font name='Mono' size='8.6'>costVm()</font> — no additional rounding, weighting, tiering, "
            "minimum commit or volume discount is applied at any aggregation level.", body))
A(dtable(para_rows([
    ["Aggregate", "Definition", "Notes"],
    ["Grand totals / KPI cards",
     "Sum of each component across the currently visible rows; monthly cost = &Sigma; total(vm)",
     "Respects the active location filter. “Annual” KPI = monthly &times; 12. "
     "Avg cost / VM = &Sigma; total &divide; row count."],
    ["Per-location roll-up",
     "VMs grouped by trimmed <font name='Mono' size='7.4'>vm.location</font>; each component summed within "
     "the group",
     "Blank or missing location groups under “Unassigned”. Share % = group total &divide; grand total &times; 100, "
     "shown to one decimal."],
    ["SKU roll-up",
     "One row per catalogue item actually in use: quantity = &Sigma; of the driving quantity, amount = &Sigma; of "
     "the matching per-VM line",
     "Compute rows per ratio tier (&Sigma; RAM GB); storage rows per tier (&Sigma; TB or &Sigma; GB per that tier's "
     "unit); SPLA counts Windows VMs; Zerto contributes two rows (&Sigma; DR GB and protected-VM count); "
     "unused items are omitted."],
], muted_cols=()), widths=[1.35 * inch, 2.5 * inch, CW - 3.85 * inch]))
A(Paragraph("Because each per-VM total is already rounded to cents in the default mode, a column total and "
            "the sum of its displayed cells always agree exactly.", small))

# ---------------------------------------------------------------- worked examples
A(PageBreak())
A(Paragraph("6. Worked examples", h1))
A(Paragraph("Using the shipped sample inventory (<font name='Mono' size='8.6'>sample-vm-inventory.csv"
            "</font>) with the default placeholder rates, divisor = 1024, rounding = <i>round each line "
            "item</i>, VMware licensing enabled, and no add-ons configured. Every intermediate value below "
            "is reproducible by hand.", body))

_in_tbl = dtable(para_rows([
    ["VM", "OS", "Location", "RAM<br/>GB", "Disk<br/>GB", "Ratio", "Storage tier", "Zerto", "DR<br/>GB"],
    ["WEB01", "Microsoft Windows Server 2022", "Columbus - DUB", "16", "200", "4:1", "Standard Flash", "on", "250"],
    ["SQL01", "Microsoft Windows Server 2019", "Columbus - DUB", "64", "1024", "2:1", "High Performance Flash", "on", "1200"],
    ["APP01", "Ubuntu Linux 22.04", "Indianapolis - 701 Congressional", "32", "500", "4:1", "Standard Flash", "off", "0"],
], mono_cols=(0, 3, 4, 8)),
    widths=[0.58 * inch, 1.3 * inch, 1.3 * inch, 0.48 * inch, 0.48 * inch, 0.42 * inch, 0.98 * inch, 0.5 * inch, 0.5 * inch],
    aligns=["LEFT", "LEFT", "LEFT", "RIGHT", "RIGHT", "LEFT", "LEFT", "LEFT", "RIGHT"])
A(KeepTogether([Paragraph("6.1 Inputs", h2), _in_tbl]))

A(Paragraph("6.2 Step-by-step derivation", h2))
A(KeepTogether([
    Paragraph("WEB01 — Windows, 4:1, per-TB Standard Flash, Zerto protected", ParagraphStyle(
        "ex", parent=body, fontName="Inter-SB", fontSize=9, spaceAfter=3)),
    fbox(align([
        ("compute", "r2( 16 \u00d7 $10.00 )", "$160.00"),
        ("vmware", "r2( 16 \u00d7 $10.00 )", "$160.00"),
        ("storage_qty", "200 \u00f7 1024", "0.1953125 TB"),
        ("storage", "r2( 0.1953125 \u00d7 $333.00 )", "r2($65.0390625) = $65.04"),
        ("windows_spla", "r2( $99.00 )  [/windows/i matches OS]", "$99.00"),
        ("dr_storage", "r2( 250 \u00d7 $0.15 )", "$37.50"),
        ("dr_fee", "r2( $25.00 )", "$25.00"),
        ("zerto_dr", "r2( 37.50 + 25.00 )", "$62.50"),
        ("-",),
        ("total", "r2( 160.00+160.00+65.04+99.00+0.00+62.50 )", "$546.54"),
    ])),
]))
A(Spacer(1, 8))
A(KeepTogether([
    Paragraph("SQL01 — Windows, 2:1, per-TB High Performance Flash, Zerto protected", ParagraphStyle(
        "ex2", parent=body, fontName="Inter-SB", fontSize=9, spaceAfter=3)),
    fbox(align([
        ("compute", "r2( 64 \u00d7 $15.00 )", "$960.00"),
        ("vmware", "r2( 64 \u00d7 $10.00 )", "$640.00"),
        ("storage_qty", "1024 \u00f7 1024", "1.0 TB"),
        ("storage", "r2( 1.0 \u00d7 $359.00 )", "$359.00"),
        ("windows_spla", "r2( $99.00 )", "$99.00"),
        ("dr_storage", "r2( 1200 \u00d7 $0.15 )", "$180.00"),
        ("dr_fee", "r2( $25.00 )", "$25.00"),
        ("zerto_dr", "r2( 180.00 + 25.00 )", "$205.00"),
        ("-",),
        ("total", "r2( 960.00+640.00+359.00+99.00+0.00+205.00 )", "$2,263.00"),
    ])),
]))
A(Spacer(1, 8))
A(KeepTogether([
    Paragraph("APP01 — Linux, 4:1, per-TB Standard Flash, DR off", ParagraphStyle(
        "ex3", parent=body, fontName="Inter-SB", fontSize=9, spaceAfter=3)),
    fbox(align([
        ("compute", "r2( 32 \u00d7 $10.00 )", "$320.00"),
        ("vmware", "r2( 32 \u00d7 $10.00 )", "$320.00"),
        ("storage_qty", "500 \u00f7 1024", "0.48828125 TB"),
        ("storage", "r2( 0.48828125 \u00d7 $333.00 )", "r2($162.59765625) = $162.60"),
        ("windows_spla", "0  [no 'windows' in 'Ubuntu Linux 22.04']", "$0.00"),
        ("zerto_dr", "0  [Zerto toggle off]", "$0.00"),
        ("-",),
        ("total", "r2( 320.00+320.00+162.60+0.00+0.00+0.00 )", "$802.60"),
    ])),
]))

A(Paragraph("6.3 Per-VM results and totals", h2))
A(dtable(para_rows([
    ["VM", "Compute", "VMware lic.", "Storage", "SPLA", "Add-ons", "Zerto DR", "Monthly total"],
    ["WEB01", "$160.00", "$160.00", "$65.04", "$99.00", "$0.00", "$62.50", "$546.54"],
    ["SQL01", "$960.00", "$640.00", "$359.00", "$99.00", "$0.00", "$205.00", "$2,263.00"],
    ["APP01", "$320.00", "$320.00", "$162.60", "$0.00", "$0.00", "$0.00", "$802.60"],
    ["<font name='Inter-Bold'>Total (3 VMs)</font>", "<font name='Inter-Bold'>$1,440.00</font>", "<font name='Inter-Bold'>$1,120.00</font>", "<font name='Inter-Bold'>$586.64</font>", "<font name='Inter-Bold'>$198.00</font>",
     "<font name='Inter-Bold'>$0.00</font>", "<font name='Inter-Bold'>$267.50</font>", "<font name='Inter-Bold'>$3,612.14</font>"],
], mono_cols=(1, 2, 3, 4, 5, 6, 7)),
    widths=[0.95 * inch, 0.83 * inch, 0.83 * inch, 0.78 * inch, 0.7 * inch, 0.7 * inch, 0.78 * inch,
            CW - 5.57 * inch],
    aligns=["LEFT", "RIGHT", "RIGHT", "RIGHT", "RIGHT", "RIGHT", "RIGHT", "RIGHT"]))
A(Spacer(1, 6))
A(Paragraph("Per-location roll-up for the same three VMs — sums of the per-VM totals above:", body))
A(dtable(para_rows([
    ["Location", "VMs", "RAM GB", "Disk GB", "Monthly total", "Share"],
    ["Columbus - DUB", "2", "80", "1,224", "$2,809.54", "77.8%"],
    ["Indianapolis - 701 Congressional", "1", "32", "500", "$802.60", "22.2%"],
    ["<font name='Inter-Bold'>All locations</font>", "<font name='Inter-Bold'>3</font>", "<font name='Inter-Bold'>112</font>", "<font name='Inter-Bold'>1,724</font>", "<font name='Inter-Bold'>$3,612.14</font>", "<font name='Inter-Bold'>100%</font>"],
], mono_cols=(1, 2, 3, 4, 5)),
    widths=[2.5 * inch, 0.5 * inch, 0.7 * inch, 0.72 * inch, 1.1 * inch, CW - 5.52 * inch],
    aligns=["LEFT", "RIGHT", "RIGHT", "RIGHT", "RIGHT", "RIGHT"]))
A(Paragraph("The fourth sample row (FILE01 — Windows, 8 GB RAM, 1500 GB Standard Flash, DR off) adds "
            "$80.00 compute + $80.00 VMware + $487.79 storage + $99.00 SPLA = $746.79, bringing the full "
            "four-VM sample inventory to $4,358.93 per month.", small))

# ---------------------------------------------------------------- assumptions
A(Paragraph("7. Assumptions and limitations", h1))
for txt in [
    "<font name='Inter-Bold'>Provisioned, not consumed.</font> Storage is billed on allocated disk as entered "
    "(<font name='Mono' size='8.6'>Disk_GB</font>). The model has no notion of thin-provision savings, "
    "deduplication, compression or actual utilisation.",
    "<font name='Inter-Bold'>Monthly recurring rates only.</font> Every rate is interpreted as a full-month charge. There is no "
    "proration for mid-month provisioning or decommissioning, no hourly or daily metering, and no "
    "partial-month credits. Annualised figures are simply the monthly total multiplied by 12.",
    "<font name='Inter-Bold'>Placeholder pricing.</font> The default catalogue values are illustrative. They must be replaced with "
    "the client's contracted SKU rates — including any negotiated discounts — before the output is used "
    "commercially.",
    "<font name='Inter-Bold'>RAM-based compute.</font> Compute and VMware licensing are functions of configured RAM only. vCPU "
    "count, CPU reservation, host overcommit and the ratio label itself do not enter the arithmetic; the "
    "ratio tier merely names the applicable per-GB rate.",
    "<font name='Inter-Bold'>SPLA by OS string.</font> Windows licensing is triggered solely by a case-insensitive “windows” "
    "substring in the OS field. A mistyped, abbreviated or blank OS value will silently omit the SPLA "
    "charge; a non-Windows VM whose OS text happens to contain “windows” will incur it.",
    "<font name='Inter-Bold'>DR footprint is manual.</font> DR GB is user-supplied and never inferred from provisioned disk, so its "
    "accuracy depends on the operator's Zerto journal and replica sizing.",
    "<font name='Inter-Bold'>No taxes, fees, or one-time charges.</font> The model excludes taxes, regulatory fees, bandwidth, "
    "backup, egress, professional services, hardware and any non-recurring setup costs. All amounts "
    "are USD; no FX conversion is applied.",
    "<font name='Inter-Bold'>Client-side and unversioned.</font> All inputs and rate cards live in browser localStorage. Figures "
    "reflect whatever the operator most recently entered; the app keeps no audit trail of rate changes, so "
    "quotes should be exported to CSV at the moment of issue.",
]:
    A(Paragraph(txt, bullet, bulletText="•"))

A(Paragraph("8. Reproducing and auditing the figures", h1))
A(Paragraph("The CSV export is the audit artefact. It writes, for every VM, the inputs and every "
            "intermediate quantity used above &mdash; including "
            "<font name='Mono' size='8.4'>Disk_TB</font>, "
            "<font name='Mono' size='8.4'>StorageUnit</font>, "
            "<font name='Mono' size='8.4'>StorageBilledQty</font> and "
            "<font name='Mono' size='8.4'>StorageRate_perUnit</font> &mdash; one column per charge line, a "
            "TOTAL row, the per-location roll-up, and the pricing settings in force (including the GB&rarr;TB "
            "divisor). Any figure in the application can therefore be re-derived from the exported file "
            "using only the formulas in sections 2 to 4.", body))
A(dtable(para_rows([
    ["Audit step", "What to check"],
    ["1. Confirm the rate card",
     "Compare every rate and SKU in the pricing tab against the contract. Defaults are placeholders (&sect;1)."],
    ["2. Confirm the settings",
     "GB&rarr;TB divisor (1024 or 1000) and rounding mode (per line item or totals only) &mdash; both change results."],
    ["3. Recompute a sample of VMs",
     "Apply &sect;2 line by line; each line rounds to cents before the per-VM total is summed and rounded again."],
    ["4. Check conditional charges",
     "SPLA appears exactly for VMs whose OS text contains &ldquo;windows&rdquo;; DR appears exactly for VMs with the "
     "Zerto toggle on, and the flat fee applies even at 0 DR GB."],
    ["5. Check the aggregates",
     "Grand totals, location roll-up and SKU roll-up must equal the plain sums of the per-VM columns (&sect;5)."],
], muted_cols=()), widths=[1.6 * inch, CW - 1.6 * inch]))

A(Spacer(1, 10))
A(HRFlowable(width="100%", thickness=0.6, color=BORDER, spaceAfter=6))
A(Paragraph("References", ParagraphStyle("refh", parent=body, fontName="Inter-SB", fontSize=8.6,
                                        spaceAfter=3)))
A(Paragraph(f'1. VM Cost Calculator (live application) — <a href="{APP_URL}" color="#01696F">{APP_URL}</a>', foot))
A(Paragraph(f'2. Source repository, commit {COMMIT} (app.js, README.md, sample-vm-inventory.csv) — '
            f'<a href="{REPO_URL}" color="#01696F">{REPO_URL}</a>', foot))
A(Paragraph('3. PapaParse 5.4.1 (CSV parsing, only third-party dependency) — '
            '<a href="https://www.papaparse.com/" color="#01696F">https://www.papaparse.com/</a>', foot))

doc.build(S)
print("wrote", OUT)
