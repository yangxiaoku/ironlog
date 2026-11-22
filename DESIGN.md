---
name: "Ironlog (铁记)"
description: "Monochrome strength-training, nutrition, and Apple Health workbench combining OLED obsidian and warm-mineral paper planes with 5x7 dot-matrix telemetry and restrained signal-red indicators."
colors:
  signal-red: "#fa4e47"
  signal-red-ink: "#ff7a73"
  signal-red-wash: "rgba(250, 78, 71, 0.13)"
  crimson-light: "#c9332b"
  crimson-light-ink: "#b42018"
  crimson-light-wash: "rgba(201, 51, 43, 0.10)"
  obsidian-ground: "#000000"
  obsidian-surface: "#0b0b0c"
  obsidian-inset: "#121215"
  obsidian-raised: "#1c1c20"
  obsidian-edge: "#26262a"
  ivory-ink: "#f4f3ef"
  hero-silver-muted: "#c2bfb8"
  warm-ash-muted: "#a6a39c"
  stone-soft: "#8d8982"
  mineral-light-ground: "#eeede9"
  paper-light-surface: "#fbfaf7"
  hero-light-base: "#ffffff"
  stone-light-inset: "#f2f1ec"
  pebble-light-raised: "#e3e1da"
  mineral-light-rule: "#e4e1d9"
  mineral-light-edge: "#d3d0c7"
  charcoal-light-ink: "#151411"
  hero-light-ink: "#141310"
  slate-light-muted: "#56534c"
  slate-light-soft: "#5f5b53"
  hero-light-muted: "#4a4740"
typography:
  display:
    fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif'
    fontSize: "clamp(34px, 4.2vw, 58px)"
    fontWeight: 800
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  headline:
    fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif'
    fontSize: "clamp(28px, 2.8vw, 38px)"
    fontWeight: 700
    lineHeight: 1.18
    letterSpacing: "-0.03em"
  title:
    fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif'
    fontSize: "17px"
    fontWeight: 680
    lineHeight: 1.35
    letterSpacing: "-0.018em"
  subtitle:
    fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif'
    fontSize: "15px"
    fontWeight: 650
    lineHeight: 1.35
    letterSpacing: "-0.01em"
  input-floor:
    fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif'
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "0em"
  body:
    fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.52
    letterSpacing: "0em"
  caption:
    fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0em"
  label:
    fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif'
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: "0em"
  micro:
    fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif'
    fontSize: "11px"
    fontWeight: 550
    lineHeight: 1.25
    letterSpacing: "0em"
  mono-kpi:
    fontFamily: '"Cascadia Code", "SFMono-Regular", ui-monospace, Consolas, monospace'
    fontSize: "clamp(22px, 2.35vw, 34px)"
    fontWeight: 650
    lineHeight: 1.28
    letterSpacing: "-0.035em"
    fontFeature: '"tnum"'
  mono-set:
    fontFamily: '"Cascadia Code", "SFMono-Regular", ui-monospace, Consolas, monospace'
    fontSize: "18px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "0em"
    fontFeature: '"tnum"'
  mono-meta:
    fontFamily: '"Cascadia Code", "SFMono-Regular", ui-monospace, Consolas, monospace'
    fontSize: "12px"
    fontWeight: 550
    lineHeight: 1.35
    letterSpacing: "0em"
    fontFeature: '"tnum"'
rounded:
  micro: "2px"
  tag: "4px"
  cell: "5px"
  sm: "8px"
  control: "9px"
  md: "10px"
  card-inset: "11px"
  inset: "12px"
  editor: "13px"
  panel: "14px"
  hero: "16px"
  sheet: "18px"
  pill: "999px"
spacing:
  xxs: "3px"
  xs: "6px"
  sm: "10px"
  md: "14px"
  panel: "18px"
  section: "24px"
  page-gutter: "clamp(20px, 3vw, 48px)"
  sidebar-width: "222px"
components:
  button-primary:
    backgroundColor: "{colors.ivory-ink}"
    textColor: "{colors.obsidian-ground}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "0 15px"
    height: "40px"
  button-secondary:
    backgroundColor: "{colors.obsidian-inset}"
    textColor: "{colors.ivory-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "0 15px"
    height: "40px"
  input-search:
    backgroundColor: "{colors.obsidian-inset}"
    textColor: "{colors.ivory-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "4px 8px 4px 12px"
    height: "38px"
  nav-sidebar-item:
    backgroundColor: "{colors.obsidian-inset}"
    textColor: "{colors.ivory-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 11px"
    height: "44px"
  segment-control:
    backgroundColor: "{colors.obsidian-surface}"
    textColor: "{colors.warm-ash-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "3px"
  week-rhythm-pill:
    backgroundColor: "{colors.obsidian-inset}"
    textColor: "{colors.ivory-ink}"
    typography: "{typography.mono-meta}"
    rounded: "{rounded.pill}"
    padding: "6px 2px"
    height: "52px"
  rir-toggle:
    backgroundColor: "{colors.signal-red-wash}"
    textColor: "{colors.signal-red-ink}"
    typography: "{typography.mono-meta}"
    rounded: "{rounded.pill}"
    padding: "0 9px"
    height: "26px"
  hero-masthead-card:
    backgroundColor: "{colors.obsidian-ground}"
    textColor: "{colors.ivory-ink}"
    typography: "{typography.display}"
    rounded: "{rounded.hero}"
    padding: "24px 26px"
  kpi-band-tile:
    backgroundColor: "{colors.obsidian-surface}"
    textColor: "{colors.ivory-ink}"
    typography: "{typography.mono-kpi}"
    rounded: "{rounded.panel}"
    padding: "15px 17px 14px"
  dot-meter:
    backgroundColor: "{colors.signal-red}"
    height: "5px"
    rounded: "{rounded.micro}"
  workout-set-row:
    backgroundColor: "{colors.obsidian-surface}"
    textColor: "{colors.ivory-ink}"
    typography: "{typography.mono-meta}"
    rounded: "{rounded.md}"
    padding: "6px 4px"
  dock-rest-ring:
    backgroundColor: "{colors.signal-red-wash}"
    textColor: "{colors.signal-red-ink}"
    typography: "{typography.mono-kpi}"
    rounded: "{rounded.inset}"
    padding: "7px 10px"
  radial-rest-dial:
    backgroundColor: "{colors.obsidian-surface}"
    textColor: "{colors.ivory-ink}"
    typography: "{typography.mono-kpi}"
    rounded: "{rounded.hero}"
    padding: "20px 22px 24px"
---

# Design System: Ironlog (铁记)

## Overview

**Creative North Star: "The Monochrome Telemetry Instrument"**

Ironlog is a private, self-hosted strength-training, nutrition, body-weight, and Apple Health workbench engineered to read like a precision hardware instrument rather than a conventional fitness tracker. Its visual language pairs stark monochrome planes—OLED obsidian in Dark mode and warm mineral paper in Light mode—with crisp 1px hairline borders, dotted internal dividers, corner viewfinder crosshairs, and custom 5×7 circular SVG dot-matrix numerals.

The system balances two distinct operating contexts without splitting into separate visual worlds: single-handed, distraction-free logging on the gym floor (390px mobile PWA) and dense multi-column longitudinal analysis on desktop (up to 1480px). Monochrome halftone photography anchors the Overview hero and primary subpage mastheads behind directional contrast masks, while high-contrast inverse capsule actions and restrained signal-red telemetry guide immediate attention to live timers, next pending sets, macro fulfillment, and personal records.

**Key Characteristics:**
- **Dual monochrome polarity:** True OLED obsidian ground (`#000000`) in Dark mode paired with warm mineral paper ground (`#eeede9`) in Light mode, stepped cleanly across four neutral surface tiers.
- **Dot-matrix and radial dial gauges:** Custom 5×7 SVG circular dot-matrix numerals render the `IRONLOG` lockup, hero day numbers, live clocks, and rest countdowns alongside 24-tick dock rings and 48-tick radial rest dials.
- **Halftone brand mastheads:** Monochrome halftone photography across Overview, Workout, Plan, Diet, and Exercises mastheads, framed with 9px registration crosshairs and directional fade masks.
- **Restrained signal red:** A single chromatic accent reserved strictly for active workout and rest telemetry, completed activity cells, lit dot-meter LEDs, positive progression deltas, focus outlines, and primary data series.
- **Zero external font or icon CDNs:** Offline-first PWA architecture powered by local platform CJK/monospace typography stacks and authored 24×24 SVG stroke icons (`1.65px` stroke width).

## Colors

Ironlog uses a strictly monochromatic structural palette built from four neutral plane steps and crisp hairline dividers, punctured by a single Signal Red chromatic accent calibrated independently for Dark and Light contrast.

### Primary
- **Signal Red** (`#fa4e47` dark, `--red`): Primary active telemetry fill on dark surfaces—lit segments in LED dot meters, active calendar heatmap cells, active navigation and status indicator dots, primary chart bars and lines, progress track fill, text caret color, and keyboard focus outlines.
- **Signal Red Ink** (`#ff7a73` dark, `--red-ink`): Lightened coral-red tuned for legible dark-mode text—positive KPI comparison deltas, rest countdown numerals, failure-set labels, estimated 1RM readouts, chart hover readouts, active RIR toggle text, and destructive action labels.
- **Signal Red Wash** (`rgba(250, 78, 71, 0.13)` dark, `--red-wash`): Translucent signal tint backing live rest clock banners, active RIR toggles, selected calendar dates, selected training-feeling choices, completion status badges, and active plan shortcut gradients.
- **Crimson Light** (`#c9332b` light, `--red`): Deeper signal crimson calibrated for legibility against warm mineral paper surfaces in Light mode.
- **Crimson Light Ink** (`#b42018` light, `--red-ink`): High-contrast dark crimson for text metrics, progression deltas, and active indicators in Light mode.
- **Crimson Light Wash** (`rgba(201, 51, 43, 0.10)` light, `--red-wash`): Subtle warm crimson translucent tint for Light-mode active rest docks, calendar selections, and active toggles.

### Neutral
- **Obsidian Ground** (`#000000` dark, `--bg` / `--hero-base`): Pure OLED black primary canvas, top utility bar ground, hero base behind dark halftone photography, and text color inside inverse light primary pills.
- **Obsidian Surface** (`#0b0b0c` dark, `--surface`): Primary card, dashboard panel, unified KPI band, sidebar rail, dialog container, and docked workout footer plane.
- **Obsidian Inset** (`#121215` dark, `--inset`): Recessed plane for form fields, active sidebar links, workout exercise cards, nested summary panels, and week-rhythm day pills.
- **Obsidian Raised** (`#1c1c20` dark, `--raised` / `--rule`): Highest monochrome surface step for unlit LED meter bars, exercise index badges, focused numeric inputs, workout report set chips, and subtle `1px` internal divider rules (`--rule`).
- **Obsidian Edge** (`#26262a` dark, `--edge`): Primary `1px` structural hairline border around panels, controls, inputs, dotted KPI dividers, and SVG chart gridlines.
- **Ivory Ink** (`#f4f3ef` dark, `--ink` / `--white-button` / `--hero-ink`): Primary warm off-white text, solid inverse primary button fill, active segmented tab fill, and checked set-checkbox fill.
- **Hero Silver Muted** (`#c2bfb8` dark, `--hero-muted`): High-legibility silver-gray for hero status badges, date year/month, and week-rhythm headers over halftone imagery.
- **Warm Ash Muted** (`#a6a39c` dark, `--muted`): Secondary descriptive copy, axis ticks, inactive navigation items, and metadata labels.
- **Stone Soft** (`#8d8982` dark, `--soft`): Tertiary subtle indicators—future dashed week pills, subtle icons, cold muscle silhouettes, and dashed goal reference lines.
- **Mineral Light Ground** (`#eeede9` light, `--bg`): Warm mineral paper canvas for Light mode, also serving as text ink on inverse charcoal primary buttons.
- **Paper Light Surface** (`#fbfaf7` light, `--surface`): Elevated warm paper panels, sidebar, unified KPI band, and modal dialogs in Light mode.
- **Hero Light Base** (`#ffffff` light, `--hero-base`): Crisp white base beneath Light-mode halftone mastheads.
- **Stone Light Inset** (`#f2f1ec` light, `--inset`): Recessed warm stone surface for inputs, workout exercise cards, and active navigation items in Light mode.
- **Pebble Light Raised** (`#e3e1da` light, `--raised`): Micro-surface for unlit dot-meter segments, report pills, and active hover steps in Light mode.
- **Mineral Light Rule** (`#e4e1d9` light, `--rule`): Subtle internal `1px` dividers in Light mode.
- **Mineral Light Edge** (`#d3d0c7` light, `--edge`): Primary `1px` structural hairline border and dotted divider tone in Light mode.
- **Charcoal Light Ink** (`#151411` light, `--ink` / `--white-button`): Primary deep charcoal text and solid inverse button/tab fill in Light mode.
- **Hero Light Ink** (`#141310` light, `--hero-ink`): High-contrast dark ink inside Light-mode halftone mastheads.
- **Slate Light Muted** (`#56534c` light, `--muted`): Secondary warm slate labels and inactive controls in Light mode.
- **Slate Light Soft** (`#5f5b53` light, `--soft`): Tertiary captions, dashed goal lines, and cold atlas shading in Light mode.
- **Hero Light Muted** (`#4a4740` light, `--hero-muted`): Secondary metadata and status text over Light masthead artwork.

### Named Rules
**The Signal-Only Red Rule.** Signal Red (#fa4e47 dark / #c9332b light) is never used as decorative branding chrome; it is reserved exclusively for live recording states, active workout/rest indicators, target progress, completed activity cells, breakthroughs/PRs, and primary data series.
**The Dual-World Polarity Rule.** Every surface, border, icon, and SVG element binds to CSS custom properties (--bg, --surface, --inset, --raised, --edge, --rule, --ink, --muted, --soft, --red, --red-ink, --red-wash, --white-button) so Dark OLED and Light warm-mineral themes invert cleanly without hardcoded theme overrides.

## Typography

**Display Font:** `"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif` (paired with custom 5×7 circular SVG dot-matrix glyphs for the `IRONLOG` wordmark, hero day numerals, workout clocks, rest dials, and set totals)
**Body Font:** `"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif`
**Label/Mono Font:** `"Cascadia Code", "SFMono-Regular", ui-monospace, Consolas, monospace`

**Character:** Clean platform CJK geometric sans handles Chinese editorial headings and dense gym-floor controls with zero external font network overhead, while tabular monospace (`--mono` with `tabular-nums`) and 5×7 SVG dot-matrix glyphs anchor every measurement, timer, and date in hardware-grade alignment.

### Hierarchy
- **Display** (`800`, `clamp(34px, 4.2vw, 58px)`, `1.08` line-height, `-0.035em` tracking): Overview hero headline and login display (`56px`); paired with 5×7 circular dot-matrix SVG numerals (`34px` in the hero date block, `clamp(42px, 8vw, 52px)` inside the radial rest dial).
- **Headline** (`700`, `clamp(28px, 2.8vw, 38px)`, `1.18` line-height, `-0.03em` tracking): Subpage masthead headings across Workout, Plan, Diet, Weight, Calendar, Exercises, and Settings.
- **Title** (`680`, `17px`, `1.35` line-height, `-0.018em` tracking): Dashboard panel headings, Today Summary titles, and mobile day-group headers.
- **Subtitle** (`650`, `15px`, `1.35` line-height, `-0.01em` tracking): Tertiary card subheadings, weight facts readouts, and compact mobile summary titles.
- **Input Floor** (`600`, `16px`, `1.35` line-height): Meal card headings, empty-state titles, exercise guide subheadings, and the minimum `16px` mobile numeric/search input font size preventing iOS Safari zoom.
- **Body** (`400`, `14px`, `1.52` line-height, `0em` tracking): General interface copy, exercise cues (`1.6` line-height), and plan rationale prose capped at `75ch` max line length.
- **Caption** (`400`, `13px`, `1.4` line-height): Secondary metadata, KPI labels, health list entries, session options, and floating toast copy.
- **Label** (`500`, `12px`, `1.35` line-height): Segmented control buttons, panel annotations, and footer descriptors.
- **Micro** (`550`, `11px`, `1.25` line-height): RIR toggle pills, plate-math labels, set-table column headers, calendar counts, and mobile dock tab labels.
- **Mono Telemetry** (`650`, `clamp(22px, 2.35vw, 34px)` KPIs / `clamp(24px, 2.8vw, 36px)` chart totals / `clamp(38px, 5vw, 60px)` weight readout, `-0.035em` to `-0.04em` tracking, `tabular-nums`): Primary metric figures and countdown readouts (`26px` dock / `44px–56px` dial).
- **Mono Set** (`650`, `18px`, `1.2` line-height, `tabular-nums`): Numeric weight/reps set inputs, Apple Health telemetry values, and sidebar dot-matrix brand sizing.
- **Mono Metadata** (`550`, `12px`, `1.35` line-height, `tabular-nums`): Topbar date pill, SVG chart axes, set indices, RIR tags, 1RM indicators, and hover chart readouts.

### Named Rules
**The Tabular Measurement Rule.** Every numeric counter, KPI figure, weight value, date pill, chart axis label, and live timer uses --mono with font-variant-numeric: tabular-nums so columns never jitter while counting or scrubbing data.
**The Dot-Matrix Focal Rule.** Custom 5×7 circular SVG glyphs are reserved strictly for focal telemetry landmarks—brand wordmark (IRONLOG), hero calendar day, active session timer, rest dial readout, and workout report set totals—never for body paragraphs or dense tables.

## Layout

Ironlog adapts cleanly from a spacious multi-column desktop workbench (`1480px` max content width) to a one-handed mobile PWA floor layout (`<= 630px`).

- **Desktop Navigation Shell (`> 850px`):** Fixed left sidebar (`222px` wide, stepping down to `170px` at `<= 1120px`) with `24px 16px 16px` padding; offset main workspace frame with a `64px` top utility bar and centered main container (`1480px` max width, `24px` top padding, `52px` bottom padding, `clamp(20px, 3vw, 48px)` horizontal page gutter).
- **Tablet Icon Rail (`<= 850px`):** Sidebar collapses to a `64px` icon rail displaying the `39×39px` square-rounded app icon mark and centered `20px` icons; two-column dashboard rows, diet summary/meal grids, calendar split, and exercise catalogue stacks collapse to single-column grids (`14px` gap; `9px` in exercise catalogue).
- **Overview Lead & Telemetry Grid:** Overview pairs the halftone hero (`1.65fr`, `1.45fr` at `<= 1120px`) beside the 2-column Today Summary strip (`10px` gap), transitioning to a stacked layout between `631px` and `925px` where Today Summary rearranges horizontally (`1.35fr 1fr 1fr`). Below lies the unified 4-column KPI band (`2×2` on mobile `<= 630px`) and modular 2-column dashboard rows (`14px` gap; asymmetric `1.56fr : 1fr` or `1fr : 1.56fr` split when pairing the primary Training Load chart).
- **Subpage Grids:** Diet pairs a `270px`–`.62fr` summary column with an auto-fit meal grid (`min(250px, 100%)`); Weight pairs a `240px`–`.58fr` summary card with a trend chart; Calendar pairs a `1.55fr` month grid with a `1fr` day-detail panel; Exercises pairs a sticky `195px–236px` filter sidebar with an `auto-fill` `172px` card grid (`2` columns on `<= 630px`); Settings pairs a `150px–210px` section rail with form panels.
- **Mobile Gym-Floor Shell (`<= 630px`):** Top utility bar tightens to `58px` height (`13px` horizontal padding) holding the mobile brand lockup, theme toggle, and Overview primary action; main content reserves `12px 11px calc(92px + env(safe-area-inset-bottom))` padding over a `74px` bottom fade so scrolling clears the floating 5-tab bottom navigation dock (`10px` side inset, safe-area bottom offset). Active workout logging switches to a full-viewport (`100dvh`) flex-column dialog—pinned overview and horizontal exercise-jump stack, independent scrolling set region, and anchored bottom session dock—so rest controls never occlude active set inputs.

### Named Rules
**The Non-Occluding Gym-Floor Stack Rule.** Active workout logging runs inside a three-part flex column (pinned overview and jump strip, independent scrolling set region, and non-overlapping docked footer) so rest timers and action bars never cover active set inputs.
**The Asymmetric Telemetry Pairing Rule.** High-series overview trend charts pair with compact companion modules in a 1.56fr : 1fr asymmetric desktop split, while primary summary + workspace subpages (Diet, Weight, Calendar) pair a narrower summary column (0.58fr–0.65fr equivalent) with a full working grid.

## Elevation & Depth

Ironlog is **flat and tonally layered by default**. Rather than floating cards on drop shadows, hierarchy emerges through four stepped monochrome planes (`--bg` → `--surface` → `--inset` → `--raised`) separated by `1px solid` structural borders (`--edge`) and `1px solid` or `1px dotted` internal hairlines (`--rule` / `--edge`). Interactive elevation is expressed through border contrast shifts, inverse solid fill, or translucent signal-red wash tinting.

### Shadow Vocabulary
- **Toast Float** (`box-shadow: 0 8px 26px rgba(0, 0, 0, .4)`): Reserved solely for the centered confirmation toast pill floating above active views and mobile docks.
- **Mobile Dock Float** (`box-shadow: 0 10px 30px rgba(0, 0, 0, .42)` paired with `backdrop-filter: blur(18px)` and `88%` translucent surface fill): Applied exclusively to the `<= 630px` floating bottom navigation dock so it separates cleanly from scrolling cards beneath it.
- **Modal Backdrop** (`rgba(0, 0, 0, .72)`): Neutral dimming scrim behind modal and bottom-sheet dialogs.

### Named Rules
**The Hairline Plane-Stepping Rule.** Standard panels, KPI bands, tiles, and embedded cards carry zero box shadows; plane separation is achieved strictly via tonal stepping (--bg, --surface, --inset, --raised) and crisp 1px structural or dotted hairlines.

## Shapes

Ironlog contrasts geometric full-capsule controls with disciplined hardware panels and technical registration details:

- **Capsule Pills (`999px` radius):** All primary, secondary, quiet, and icon buttons, segmented tab tracks, search bars, topbar date pills, hero status badges, 7-day consistency pills, muscle filter chips, barbell plate badges, feeling distribution bars, and toast notifications.
- **Outer Hardware Frames (`16px`–`18px` radius):** Halftone hero banners and subpage mastheads (`16px`), login hero (`16px`), desktop modal dialogs (`16px`), mobile floating nav dock (`18px`), and mobile bottom-sheet dialogs (`18px 18px 0 0`, collapsing to `0px` fullscreen for active mobile workout logging).
- **Dashboard & Embedded Modules (`11px`–`14px` radius):** Dashboard panels, unified KPI band, Today Summary tiles, and Apple Health sync accordion (`14px`); workout exercise editors and exercise catalogue tiles (`13px`); embedded workout overview, rest clock banner, finish panel, exercise picker, weight log, and history entries (`12px`); brand icon tiles, PR record cards, and collapsible training settings (`11px`).
- **Interactive Cells & Controls (`8px`–`10px` radius):** Sidebar nav items, set rows, set-completion checkboxes, mobile drawer links, and exercise pose figures (`10px`); standard inputs/selects/textareas, set-type cycler buttons, calendar day cells, record icon frames, and training-feeling radios (`9px`); exercise thumbnail frames and muscle distribution hover lines (`8px`).
- **Micro Indicators (`2px`–`5px` & `50%` radius):** 12-week activity heatmap cells (`5px`), session progress track (`4px`), LED dot-meter segments (`2px`), and live LED/navigation/calendar dots (`50%`).
- **Technical Framing Devices:** `9×9px` `1px` corner registration crosshairs (inset `10px` at top-left and bottom-right) mark halftone mastheads and the fullscreen radial rest dial; `1px dotted` hairline rules separate KPI columns, hero blocks, and panel footers; subtle `8×8px` radial dot patterns texture the hero overlay (`14%` opacity) and exercise art thumbnail frames.

### Named Rules
**The Hardware Capsule & Frame Contrast Rule.** Interactive actions, chips, and segmented controls take full 999px capsules, while structural containers step conservatively from 16px outer frames (14px panels, 12px inset modules) down to 9px–10px tactical inputs and set checkboxes.

## Components

### Buttons
Tactile pill affordances with `35px`–`46px` minimum hit height, `0.15s ease` transitions, `0.44` opacity when disabled, and `2px solid` signal-red keyboard focus rings (`2px` offset).
- **Shape:** Full capsule (`999px` radius).
- **Primary:** Inverse solid high-contrast fill (`--white-button` background with `--bg` text and matching `1px` border), `40px` min-height, `0 15px` padding, bold weight `700`.
- **Hover / Focus:** Dims gently to `0.88` opacity on hover; `2px solid` signal-red focus-visible ring (`2px` offset).
- **Secondary / Quiet / Icon / Danger:** Secondary uses recessed `--inset` fill, `--ink` text, `1px solid` `--edge` border (`--soft` on hover), `40px` min-height, `0 15px` padding; Quiet, circular Icon (`36px` square, `46×46px` inside the workout dock), and Destructive Danger (`--red-ink`) rest transparently until hover reveals a `1px` hairline and `--inset` tint.

### Chips
Compact interactive selectors and telemetry markers calibrated for high legibility across monochrome surfaces.
- **Style:** Segmented control tracks wrap `32px`-tall buttons inside a `--surface` `999px` capsule (`1px solid` `--edge`, `3px` padding). Week-rhythm day pills (`999px` radius, `52px` desktop / `44px` mobile height) sit on `--inset` with `1px solid` `--edge`. RIR toggles (`26px` tall, `0 9px` padding, `11px` mono) and barbell plate chips (`11px` mono) use `--surface` and `1px` hairlines. Muscle filter strips scroll horizontally on `34px`-tall pills.
- **State:** Selected segmented tabs, pressed muscle filters, and today's week pill invert to `--white-button` fill with `--bg` text; completed week days display a `5px` signal-red dot and future days adopt a dashed `--surface` frame; active RIR toggles illuminate with `--red-wash` background, red-tinted hairline border, and `--red-ink` text.

### Cards / Containers
Flat monochrome containers stepped across `--hero-base`, `--surface`, and `--inset` with zero drop shadows.
- **Corner Style:** `16px` radius on halftone mastheads and desktop dialogs; `14px` radius on dashboard panels, unified KPI bands, Today Summary tiles, and Apple Health sync accordions; `12px` radius on embedded workout modules and log lists.
- **Background:** `--hero-base` beneath masthead photography; `--surface` on top-level cards and KPI bands; `--inset` inside nested workout editors and embedded modules.
- **Shadow Strategy:** Flat by default with zero box shadows (see Elevation & Depth).
- **Border:** `1px solid` `--edge` outer frame; `1px dotted` `--edge` vertical seams inside the 4-column KPI band and horizontal separators in panel footers and hero headers; active plan shortcut carries a red-tinted hairline border and subtle `135deg` `--red-wash` highlight.
- **Internal Padding:** `24px 26px` on Overview hero (`15px` mobile), `20px 22px` on subpage mastheads (`14px` mobile), `17px 18px` on dashboard panels (`13px` mobile), `15px 17px 14px` on KPI cells, `13px 15px` on Today Summary cards.

### Inputs / Fields
Accessible gym-floor controls sized for thumb precision (`38px`–`45px` height) and protected against mobile browser viewport zoom.
- **Style:** Recessed `--inset` fill, `1px solid` `--edge` stroke, `9px` radius (`999px` on pill search bars), `38px` min-height, `7px 10px` padding. Set-row numeric inputs step to `--surface` (`42px` min-height, centered `18px` `650`-weight `--mono`, `max(16px, 1em)` font floor on `<= 630px`). Set-completion toggles render `40×40px` (`10px` radius) inside a `44×44px` hit box.
- **Focus:** `2px solid` signal-red `:focus-visible` outline (`2px` offset); numeric set inputs step to `--raised` on focus.
- **Error / Disabled:** Validation errors display in `--red-ink` (`13px`), framed by `--red-wash` inside the workout dock; read-only fields dim to `--muted`, and disabled controls dim to `0.44` opacity.

### Navigation
- **Style, typography, default/hover/active states, mobile treatment:** Fixed `222px` `--surface` sidebar (`1px` right hairline) displaying the `IRONLOG / 铁记` dot-matrix wordmark, `44px`-tall `10px`-radius navigation links (`14px` body sans, `--muted` default shifting to `--inset` fill + `--ink` text on hover, plus `1px solid` `--edge` and a `6px` signal-red dot when active), and a footer holding connection status LED and theme switcher. Collapses to a `64px` icon rail at `<= 850px` and transforms at `<= 630px` into a `5`-column frosted floating bottom capsule (`18px` radius, `88%` surface tint, `18px` backdrop blur, `0 10px 30px rgba(0, 0, 0, .42)` lift, `52px` tabs with `4px` active signal-red dot) paired with a `18px` bottom-sheet menu for secondary pages. Paired at the top with a `64px` (`58px` mobile) utility bar carrying breadcrumb, `34px` mono date pill, and Overview primary CTA.

### LED Segmented Dot Meter & Data Visualization
- **LED Dot Meter:** Row of `10`–`20` rectangular LED cells (`5px` tall, `2px` radius, `3px` gap) resting on `--raised` (`1px solid` `--rule`) and illuminating left-to-right in signal red (`--red`) across nutrition progress, macro ratios, muscle distribution, and training feeling.
- **Dot-Stacked Bar & Trend Charts:** Responsive SVG charts (`660×200`, `420×200`, or `344×200` viewBox) rendering bar volumes and calorie logs as vertically stacked rounded dot-matrix capsules (`--red` on the latest bar, `--muted` on prior bars, `0.35` opacity on partial nutrition days) and progression traces with a `0.22 -> 0` signal-red gradient fill and dashed `--soft` goal threshold.
- **Anatomical Muscle Heatmap & 12-Week Calendar:** Alpha-masked anterior/posterior muscle overlay tinted dynamically in `--red` (`0.32–1.00` heat opacity, `--red-ink` when selected) with circular hit targets; paired with an 84-day `7`-row square dot-matrix heatmap (`5px` radius, `--inset` resting vs `--red` active).

### Workout Set Logger & Radial Rest Dial
- **Single-Row Set Logger & Barbell Plate Math:** Dynamic CSS grid row pairing a set-type cycler (`常规`, dashed `热身`, red-edged `力竭`), weight and reps inputs, optional RIR selector, `44×44px` completion toggle, and remove control. Next pending rows carry a red-tinted hairline highlight, inline previous-session hint fill triggers, live Epley 1RM readout, and per-side `20kg`/`15kg` barbell plate chips.
- **Docked Rest Ring & 48-Tick Radial Dial:** Completing a set reveals a `--red-wash` rest dock (`12px` radius) housing a 24-tick `34×34px` SVG ring, `26px` dot-matrix countdown, and `-15s`/`+15s`/skip actions. Tapping expands the fullscreen `--surface` radial dial (`16px` framing, corner crosshairs, `296px` 48-tick ring with 12 major ticks lit in `--red`, centered `42px–52px` dot-matrix readout, next-set pill, and three `46px`-tall recovery controls).

### Named Rules
**The Live-State Tactile Control Rule.** Every gym-floor interactive control—set rows, set completion toggles, dock steppers, and rest dial controls—maintains at least 40px–46px hit targets and stays visibly distinct at rest via 1px hairlines before highlighting with --red-wash or inverse --white-button fill.

## Do's and Don'ts

### Do:
- **Do** reserve Signal Red (`#fa4e47` dark / `#c9332b` light) and its text companions (`#ff7a73` / `#b42018`) strictly for live recording states, active workout and rest telemetry, goal progress, PR breakthroughs, and primary chart data.
- **Do** bind every surface, border, icon, and SVG chart element to CSS custom properties (`--bg`, `--surface`, `--inset`, `--raised`, `--edge`, `--rule`, `--ink`, `--muted`, `--soft`, `--red`, `--red-ink`, `--red-wash`, `--white-button`) so Dark and Light themes remain symmetric.
- **Do** apply `--mono` with `font-variant-numeric: tabular-nums` on every KPI numeral, weight readout, timer, calendar day, and chart axis so dynamic updates never shift alignment.
- **Do** preserve the monochrome halftone mastheads (`athlete-halftone`, `plate-halftone`, `nutrition-halftone`, `equipment-halftone` and light equivalents) with directional `mask-image` gradients and `tl`/`br` registration crosshairs.
- **Do** keep active workout logging inside the non-occluding flex dialog stack with `>= 40px–44px` touch targets and `>= 16px` mobile numeric/search input font sizes (`<= 630px`) to prevent viewport zoom.
- **Do** render icons using Ironlog's authored `24×24` SVG stroke system (`1.65px` stroke width, rounded caps/joins) and render focal display numerals through 5×7 circular SVG dot-matrix glyphs.

### Don't:
- **Don't** add drop shadows to standard cards, KPI bands, or dashboard panels; keep them flat on stepped planes bounded by `1px` hairlines, reserving shadows strictly for the floating toast pill and the mobile floating navigation dock.
- **Don't** decorate cards with colored left accent stripes, unrequested multi-hue gradients, or decorative borders—the only shipped linear gradients are the active plan shortcut tint and login hero contrast scrim.
- **Don't** hardcode Dark or Light hex values inside view templates or inline styles where theme switching applies.
- **Don't** place fixed or sticky bottom footers over scrollable set rows or shrink mobile workout touch targets below `40px`.
- **Don't** introduce external CDN fonts, third-party icon packs, Unicode emoji icons, or generic progress rings in place of Ironlog's dot-matrix numerals, LED dot meters, and radial-tick dial primitives.
- **Don't** invent ungrounded decorative kickers above headings or scatter motion beyond `0.15s ease` interactive transitions and the `140ms ease-out` guided-exercise transition (both honoring `prefers-reduced-motion`).
