import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

test("Batch 1: global scroll-to-top, green online dot, 3-col login segments", () => {
  const appTsx = read("packages/web/src/App.tsx");
  assert.match(appTsx, /window\.scrollTo\(\{\s*top:\s*0,\s*left:\s*0,\s*behavior:\s*"instant"/);

  const css = read("packages/web/src/styles/ironlog.css");
  assert.match(css, /\.connection i\.online,\s*\.hero-status i\s*\{[^}]*background:\s*#22c55e/);
  assert.match(css, /\.auth-mode \.segments[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.login-form \.primary-button\s*\{[^}]*background-image:\s*none/);
});

test("Batch 1: calendar nowrap, unified dossier buttons, horizontal exercises & collapsible badges", () => {
  const calTsx = read("packages/web/src/views/CalendarView.tsx");
  assert.match(calTsx, /className="calendar-month-title"/);
  assert.match(calTsx, /同步中…/);

  const dossierTsx = read("packages/web/src/components/calendar/DayDossier.tsx");
  assert.match(dossierTsx, /className="secondary-button dossier-quick-btn"/);

  const exTsx = read("packages/web/src/views/ExercisesView.tsx");
  assert.match(exTsx, /muscle-pills-scroll-wrap/);
  assert.match(exTsx, /catalogue-submeta-row/);
  assert.match(exTsx, /exercise-muscle-glyph/);

  const badgesTsx = read("packages/web/src/views/BadgesView.tsx");
  assert.match(badgesTsx, /<details[\s\S]*className="badge-section badge-section-details"/);

  const css = read("packages/web/src/styles/ironlog.css");
  assert.match(css, /#exercise-results \.exercise-tile\s*\{[\s\S]*flex-direction:\s*row/);
  assert.match(css, /\.badge-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.badge-card\.is-locked \.badge-art img\s*\{[\s\S]*opacity:\s*0\.62/);
});

test("Batch 2: workout dedupe, PR filter, editor pills/ref-chip scoping & diet unification", () => {
  const workoutTsx = read("packages/web/src/views/WorkoutView.tsx");
  assert.match(workoutTsx, /launchpad-hero-map/);
  assert.doesNotMatch(workoutTsx, /launchpad-quick-row[\s\S]{0,400}\+\s*自由训练/);

  const editorTsx = read("packages/web/src/components/workout/WorkoutEditorModal.tsx");
  assert.match(editorTsx, /showSetRefChip/);
  assert.match(editorTsx, /setIdx === nextIncompleteSetIdx/);

  const dietTsx = read("packages/web/src/views/DietView.tsx");
  assert.match(dietTsx, /className="secondary-button meal-add-btn"/);

  const css = read("packages/web/src/styles/ironlog.css");
  assert.match(css, /\.workout-filter-bar\s*\{[\s\S]*flex-direction:\s*column/);
  assert.match(css, /\.set-action-pill\s*\{[\s\S]*border:\s*1px solid/);
  assert.match(css, /\.session-menu-body \.segments\s*\{[\s\S]*grid-template-columns:\s*repeat\(auto-fit/);
  assert.match(css, /\.meal-add-btn\s*\{/);
});

test("Batch 3: overview 4-cell load metrics, sparse chart guides, analytics layout & desktop settings restraint", () => {
  const chartsTsx = read("packages/web/src/components/Charts.tsx");
  assert.match(chartsTsx, /fourthMetric/);
  assert.match(chartsTsx, /gridline-v/);
  assert.match(chartsTsx, /chart-start-marker/);

  const analyticsTsx = read("packages/web/src/views/AnalyticsView.tsx");
  assert.match(analyticsTsx, /analytics-period-segments/);
  assert.match(analyticsTsx, /is-near-right/);

  const css = read("packages/web/src/styles/ironlog.css");
  assert.match(css, /\.load-metrics\s*\{[\s\S]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.dashboard\s*\{[\s\S]*align-items:\s*stretch/);
  assert.match(css, /\.analytics-period-segments,\s*\.apple-chart-subbar \.segments\s*\{[\s\S]*flex-wrap:\s*nowrap/);
  assert.match(css, /dialog \.hero-drawer-actions\s*\{[\s\S]*justify-content:\s*flex-start/);
  assert.match(css, /\.kpi-card-btn\.is-selected::after\s*\{[\s\S]*display:\s*none/);
  assert.match(css, /\.panel-plan-adherence\s*\{[\s\S]*grid-column:\s*1 \/ -1/);
  assert.match(css, /\.apple-signal-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.settings-hero-cta\s*\{[\s\S]*max-width:\s*440px/);
});
