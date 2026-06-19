# Implementation Plan — Instructor Executive Dashboard

> Source: GitHub issue **#1 — "PRD: Instructor Executive Dashboard"** (label `ready-for-agent`).
> Scope here is **Phase 1: the executive overview** only. Deep-dive pages, custom date
> ranges, and windowed structural metrics are explicitly out of scope (see PRD "Out of Scope").

This document breaks the PRD into sequenced, independently-reviewable build phases. Each
phase lists what to build, the files it touches, and its done/test criteria. Phases are
ordered so that every phase is shippable and verifiable on its own — the data layer is
proven by tests before any UI is wired up.

---

## Architecture summary

- **New route:** `app/routes/instructor.dashboard.tsx` at `/instructor/dashboard`,
  registered in `app/routes.ts` inside the `layout.app.tsx` group, next to the existing
  `instructor` routes.
- **New service:** `app/services/analyticsService.ts` — owns *all* aggregation. SQL-level
  aggregates (`SUM` / `COUNT` / `GROUP BY` / date filtering / score bucketing), **never**
  per-student loops. Never imported into a client component; all data reaches the UI via
  loader data (project rule: no server imports in client components — see memory
  `server-import-leak-into-client`).
- **Access control:** mirror `instructor.tsx` exactly — `getCurrentUserId` → 401 if absent,
  `getUserById` role check → 403 if not `UserRole.Instructor`. Data scoped to the signed-in
  instructor's own courses.
- **Filter state:** held in URL query params, read by the loader, which re-queries. One
  global filter re-scopes the whole page.
- **Timezone:** a single exported constant `America/New_York`; UTC→ET bucketing done in JS
  via `Intl` (SQLite has no tz database), not in SQL.
- **Charts:** add Recharts (React 19–compatible, pinned) for bar/distribution charts; the
  7×24 heatmap is a hand-rolled CSS grid. Width-dependent charts render post-hydration via
  the existing `HydrateFallback` pattern.

### Data model reference (from `app/db/schema.ts`)

| Concern | Table(s) | Key columns |
|---|---|---|
| Earnings | `purchases` | `pricePaid` (cents), `courseId`, `createdAt` (ISO) |
| Enrollments | `enrollments` | `userId`, `courseId`, `enrolledAt`, `completedAt` |
| Completion (reached 100%) | `lessonProgress` + `lessons` + `modules` | `status`, `completedAt` |
| Quiz scores | `quizAttempts` | `userId`, `quizId`, `score` (0–1 real), `attemptedAt` |
| Quiz → course join | `quizzes` → `lessons` → `modules` → `courses` | |
| Drop-off funnel | `lessonProgress` ordered by `modules.position`, `lessons.position` | |
| Course set / status | `courses` | `instructorId`, `status` |

> Note: coupon/team redeemers and free/seeded enrollments produce **no** `purchases` row,
> so earnings and enrollment counts legitimately diverge — the dashboard surfaces both.

---

## Phase 0 — Dependency & scaffold

**Goal:** get Recharts in and a reachable (empty) route, so later phases have a home.

- Add Recharts at a React 19–compatible pinned version; confirm dev build + SSR boot
  with no hydration warnings.
- Register `route("instructor/dashboard", "routes/instructor.dashboard.tsx")` in
  `app/routes.ts` (place it before `instructor/:courseId` so it isn't shadowed by the
  `:courseId` param route).
- Create `instructor.dashboard.tsx` with: the loader's auth gate (copy the 401/403 pattern
  from `instructor.tsx`), a minimal loader returning `{}`, a placeholder component, a
  `HydrateFallback`, and an `ErrorBoundary` (reuse `instructor.tsx`'s 401/403 messaging).
- Add a **"Dashboard"** nav item to `app/components/sidebar.tsx` (`navItems` array,
  `roles: [UserRole.Instructor]`, `to: "/instructor/dashboard"`, a `lucide-react` icon).

**Done when:** an instructor can navigate to `/instructor/dashboard` from the sidebar and
see a placeholder; a non-instructor gets 403; a signed-out user gets 401. Routes typecheck.

**User stories covered:** 1, 2, 4 (and the scaffolding for 3).

---

## Phase 1 — Analytics service: flow metrics (earnings + enrollments)

**Goal:** the windowed money/audience aggregates, fully unit-tested. No UI.

Create `app/services/analyticsService.ts`. Establish the shared types and a filter
argument used by every function:

```ts
type DashboardFilter = {
  instructorId: number;
  statuses: CourseStatus[];   // default: all three
  courseId?: number;          // undefined = all instructor courses
};
type TimeWindow = "all" | "30d" | "90d" | "180d";
```

Functions:
- **`getEarningsByWindow(filter)`** — `SUM(purchases.pricePaid)` joined to the instructor's
  in-scope courses, returned for all four windows, plus a **paid-purchase count** per
  window. Windowing compares `createdAt` (ISO string) against a computed cutoff (ISO string
  comparison is valid). Archived courses still count (no status exclusion baked in here —
  status filtering comes from `filter.statuses`).
- **`getEnrollmentsByWindow(filter)`** — total enrolled (all enrollments, paid or not) +
  new-enrollment counts for 30/90/180d via `enrolledAt`.

**Tests** (`analyticsService.test.ts`, using the existing `createTestDb` + `seedBaseData` +
`vi.mock("~/db")` seam — see `ratingService.test.ts`):
- Earnings sum only `purchases` rows; enrollments without purchases contribute 0.
- Scoped strictly to the instructor's courses (seed a second instructor, assert isolation).
- Each of the four windows, with **boundary timestamps** straddling each cutoff.
- Paid-purchase count vs. enrolled count diverge as expected (coupon/free enrollment).

**User stories covered:** 5, 6, 7, 8, 9, 10, 11, 12, 42 (lifetime includes archived).

---

## Phase 2 — Analytics service: structural metrics (completion + avg quiz score)

**Goal:** current-state aggregates for the remaining KPI cards. No UI.

- **`getCompletionStats(filter)`** — two independent figures:
  (a) **official** = enrollments with `completedAt` set;
  (b) **reached 100%** = enrollments whose completed-lesson count equals the course's total
  lesson count, computed via SQL aggregation (NOT the per-student progress calc — avoid N+1).
- **`getAverageQuizScore(filter)`** — single mastery number across the instructor's quizzes
  (join `quizAttempts` → `quizzes` → `lessons` → `modules` → `courses`).

**Tests:** official vs. reached-100% computed independently **including the disagreement
case** (a student at 100% lessons but no `completedAt`, and vice versa); empty data → 0/"—"
rather than throwing.

**User stories covered:** 13, 14, 15. (3 reinforced via scoping assertions.)

---

## Phase 3 — Analytics service: quiz-score distributions

**Goal:** per-course first/last/best histograms. No UI.

- **`getQuizScoreDistribution(filter)`** — per course, three series (**first** = earliest by
  `attemptedAt`, **last** = most recent, **best** = max `score`), each reduced to **one value
  per student per quiz**, then bucketed into ranges **0–59 / 60–69 / 70–79 / 80–89 / 90–100**
  (scores stored 0–1 → percentages).

**Tests:** first/last/best each reduce correctly with multiple attempts and multiple
students; bucket boundary values land in the right bucket; empty → empty.

**User stories covered:** 16, 17, 18, 19, 20.

---

## Phase 4 — Analytics service: timing heatmap

**Goal:** the 7×24 day-of-week × hour-of-day attempt grid. No UI.

- Export `const DASHBOARD_TIMEZONE = "America/New_York"` (single source of truth).
- **`getQuizTimingHeatmap(filter)`** — count quiz attempts bucketed into a 7×24 grid.
  Convert each attempt's UTC `attemptedAt` to ET **in JS via `Intl`** (handles DST), then
  bucket. Aggregates across all the instructor's quizzes by default; re-scopes to one course
  when `filter.courseId` is set. Return total attempt count so the UI can show "based on N
  attempts".

**Tests** (timezone-deterministic — fixed input timestamps asserted against the fixed
constant, never machine-local time):
- A timestamp that crosses a **date boundary** in ET lands in the expected day/hour cell.
- One timestamp inside DST and one outside, to prove `Intl` offset handling.
- Aggregate vs. single-course scoping.
- Zero data → empty map, no throw.

**User stories covered:** 21, 22, 23, 24, 39 (attempt-count surfacing).

---

## Phase 5 — Analytics service: drop-off funnel

**Goal:** per-course worst drop-off lesson. No UI.

- **`getDropOffFunnel(filter)`** — for each lesson in course order (`modules.position`, then
  `lessons.position`), the percentage of **non-completing** enrolled students who completed
  that lesson. The funnel only descends; identify the **largest step-down** between
  consecutive lessons → that lesson + the drop size. Course completers (`enrollments.completedAt`
  set) are **excluded** from the denominator.

**Tests:** module/lesson ordering correct; completers excluded; largest step-down correctly
identified; degenerate cases — no lessons, all students completed, single lesson — return a
sane empty/zero result rather than throwing.

**User stories covered:** 30, 31, 32.

---

## Phase 6 — Loader, filter parsing & scoping

**Goal:** wire the service to the route with the global filter; still minimal UI.

- In `instructor.dashboard.tsx` loader: parse filter query params (status multiselect +
  `courseId`), build the `DashboardFilter`, and call every analytics function, returning all
  results as loader data. Default = all statuses, all courses.
- Reflect selections in the URL so a scoped view is bookmarkable/shareable.
- Ensure **every** section's data comes from the same filter so the page is internally
  consistent.

**Tests:** if a lightweight seam exists for loader param parsing, cover the param→filter
mapping (default-all, status narrowing, single-course). Otherwise rely on the service-seam
coverage above and verify the loader manually. (Per PRD: param parsing is optional-coverage;
aggregation is the risk-bearing part and is fully covered.)

**User stories covered:** 34, 35, 36, 37.

---

## Phase 7 — UI: filter bar + KPI cards

**Goal:** the top of the page renders real data.

- **Filter bar:** course-status multiselect + course selector ("All" or one course),
  controlled by URL params (a `Form`/`useSearchParams` submit re-runs the loader).
- **KPI cards:** Earnings (with paid-purchase count + 30/90/180/all-time), Students (with
  windowed new enrollments), Completion (both definitions), Avg quiz score. Reuse the
  existing `Card` components. Degrade to `0` / `"—"` when there's no data.

**User stories covered:** 5–15 (visual), 33–37 (filter interaction), 40 (graceful zeros).

---

## Phase 8 — UI: charts, heatmap & master table

**Goal:** the analytical body of the page.

- **Per-course quiz distributions:** Recharts bar charts (first/last/best series), one per
  course, rendered **post-hydration** (width-dependent) behind `HydrateFallback`.
- **Quiz-timing heatmap:** hand-rolled CSS grid of shaded cells (consistent with existing
  hand-rolled progress bars); show "based on N attempts".
- **Per-course master table:** one sortable row per course — Course · Status · Students ·
  Earnings · Completed % (official) · Reached 100% · Worst-drop lesson + drop %. Sorting is
  client-side over loader data.
- **Layout (top→bottom):** filter bar → KPI cards → distributions → heatmap → master table.
- **Empty/sparse states:** every section shows a clear empty state for a brand-new course;
  sparse sections note their data-point count.

**User stories covered:** 16–24, 25–33, 38, 39, 40.

---

## Phase 9 — Performance, polish & manual verification

**Goal:** confirm it's usable in practice and visually correct.

- Confirm all aggregation stays at the SQL level — no accidental N+1 (no per-student
  `getUserById` / `calculateProgress` / `getBestAttempt` loops; that roster pattern is the
  one we are explicitly **not** extending).
- Sanity-check load time with a larger seeded dataset (many students/courses).
- Manual UI verification (per PRD, charts/heatmap visuals are manual-only): empty-state
  course, single-course filter, status filtering, sort interactions, URL bookmark round-trip,
  hydration warning-free.
- Run the full test + typecheck + lint suite.

**User stories covered:** 41, plus regression confidence for 38–40.

---

## Coverage check — all 42 user stories

| Phase | Stories |
|---|---|
| 0 | 1, 2, 4 |
| 1 | 5, 6, 7, 8, 9, 10, 11, 12, 42 |
| 2 | 13, 14, 15, 3 |
| 3 | 16, 17, 18, 19, 20 |
| 4 | 21, 22, 23, 24, 39 |
| 5 | 30, 31, 32 |
| 6 | 34, 35, 36, 37 |
| 7 | (KPI visuals) 5–15, 33, 40 |
| 8 | 25, 26, 27, 28, 29, 33, 38 |
| 9 | 41 |

Every story 1–42 is accounted for. Out-of-scope items (deep-dive pages, custom date ranges,
windowed structural metrics, refunds, video-level drop-off, exports) are intentionally absent.

---

## Build order rationale

1. **Service before UI.** The aggregation logic is the risk-bearing part and is the only part
   the PRD requires automated coverage for. Proving it first (Phases 1–5) means the UI phases
   are pure wiring.
2. **Flow → structural → distribution → heatmap → drop-off** orders the service functions
   from simplest aggregate to most involved (the heatmap's tz handling and the funnel's
   ordered step-down are the trickiest), so each builds confidence for the next.
3. **Filter wiring (Phase 6) sits between service and UI** so that by the time charts render,
   the single global filter already re-scopes everything consistently.
