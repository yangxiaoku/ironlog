# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Personal strength-training and health-tracking lifters using Ironlog (铁记) daily. Primary flow is mobile PWA one-handed logging on the gym floor (starting routines, recording sets/weights/reps/RIR, resting with countdown timers, checking exercise cues), paired with desktop multi-column review for progress charts, planning, nutrition targets, body weight, calendar history, and Apple Health sync.

## Product Purpose

Deliver a self-hosted, private, friction-free training, nutrition, body-weight, and Apple Health workbench in Chinese, built for serious lifters who want clear data ownership, fast set logging, and objective progression analytics without social bloat.

## Positioning

Combines the fast single-hand set logging and rest timer cadence of 训记, the analytical depth of openGym (muscle distribution heatmap, 1RM estimation, barbell plate math, RIR tracking), and the scannable daily health summaries of Apple Health, all expressed through a cohesive Nothing Design hardware aesthetic.

## Operating Context

- **Gym floor (mobile PWA, primary):** One-handed operation under gym lighting, intermittent connectivity, frequent switching between active workout sets, rest countdowns, historical set hints, and plate loading checks. Supports offline local draft recovery per account, wake-lock screen keep-on, and optional Web Audio rest chimes.
- **Review & planning (desktop & tablet):** Multi-panel statistics (7/30/90/365 days), 5,650-exercise bilingual catalogue search with pose illustrations, routine templates, AI/MCP plan drafts, nutrition & weight logging, Apple Health workout/HR integration, and preferences configuration.
- **Technical constraints:** Vanilla HTML, CSS, and ES Modules in `web/src/` compiled to `web/dist/` via `scripts/build-web.mjs` (esbuild + sharp); zero external CDN font/UI library dependencies; must preserve PWA caching (`sw.js`), Hono API contracts, existing record schemas (including `set.rir`, `profile` macros/targets), and dark/light theme support.

## Brand Commitments

- **Identity:** `IRONLOG / 铁记` dot-matrix wordmark and industrial hardware precision.
- **Visual World (user-pinned):** Nothing Design style (high-contrast monochrome dark & light worlds, dot-matrix display numerals, hairline technical framing, restrained signal red `#FA4E47` reserved for live state, primary progress, and breakthroughs), explicitly preserving the existing halftone monochrome visual banners (`athlete-halftone`, `plate-halftone`, `nutrition-halftone`, `equipment-halftone` and light equivalents) on Overview and primary subpages.
- **Visual References:** `图片参考/` (radial-tick rest dial, dot-matrix bar/sparkline graphics, viewfinder brackets, clean pill actions) alongside Apple Health, openGym, and 训记 interaction benchmarks.

## Evidence on Hand

- Working Hono + SQLite backend (`packages/server/`), shared domain logic and schemas (`packages/shared/`), 5,650 exercises with muscle atlas layers (`web/assets/muscles/atlas-*.png`), and monochrome halftone artwork (`web/assets/visuals/`).
- Demo mode (`npm run web:demo`) and 78 existing tests (`npm test`).

## Product Principles

1. **Gym-floor ergonomics first:** Active set rows, rest countdown controls, and primary CTAs must stay unobstructed, one-thumb reachable, and lag-free on 390px viewports.
2. **Data earns its ink:** Every chart, muscle highlight, and macro meter translates stored backend truth (1RM, volume, muscle sets, macro goals, Apple Health HR/energy) rather than decorative chrome.
3. **Preserved brand drama, disciplined layout:** Retain the signature halftone banners while enforcing tight alignment, balanced multi-column desktop grids, and consistent dark/light readability.
4. **Restrained hardware signal:** Signal red and dot-matrix numerals mark live timers, active states, PRs, and primary progress—never decorative clutter or side-tab borders.
