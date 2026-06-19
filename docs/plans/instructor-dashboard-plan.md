# Implementation Plan — Instructor Analytics Dashboard

> Source: GitHub issue **#69 — "Instructor Analytics Dashboard"**, sliced into tracer-bullet
> sub-issues **#70** (data layer), **#71** (global overview page), **#72** (per-course tab).
>
> **Status:** #70 ✅ done · #71 ✅ done · #72 ⏳ pending.

This document breaks the PRD into sequenced, independently-reviewable build phases. Each
phase lists what to build, the files it touches, and its done/test criteria. The data layer
is proven by tests before any UI is wired up, so the UI phases are pure wiring.

---

## Architecture summary

A **two-level** dashboard, both levels scoped strictly to the signed-in instructor's own
courses:

1. **Global overview** at `/instructor/analytics` — cross-course headline metrics + a revenue
   trend chart (issue #71).
2. **Per-course analytics** at `/instructor/:courseId/analytics` — a deep-dive tab inside the
   course editor: revenue breakdown, lesson drop-off, quiz performance (issue #72).

- **New service:** `app/services/analyticsService.ts` — owns *all* aggregation. SQL-level
  aggregates (`SUM` / `COUNT` / `GROUP BY` / correlated subqueries), **never** per-student
  loops. Never imported into a client component; all data reaches the UI via loader data
  (project rule: no server imports in client components — see memory
  `server-import-leak-into-client`).
- **Access control:** mirror `instructor.tsx` — `getCurrentUserId` → 401 if absent,
  `getUserById` role check → 403 if not `Instructor`/`Admin`. Per-course routes additionally
  verify course ownership.
- **Time-range filter:** a URL search param `?range=7d|30d|12m|all`. Loaders parse it into an
  absolute `since: string | null` (ISO string; `null` = all time) before calling the service,
  so a filtered view is bookmarkable/shareable. The filter applies to `purchases.createdAt`
  and `enrollments.enrolledAt`; lesson-progress / quiz figures are cumulative and **not**
  time-filtered.
- **Charts:** Recharts (React 19–compatible, `^3.8.1`). Chart components are **client-only**
  (a `mounted` guard renders a same-height placeholder during SSR) to avoid SSR/hydration
  errors, and receive their data as props from the loader.

### Data model reference (from `app/db/schema.ts`)

| Concern | Table(s) | Key columns |
|---|---|---|
| Earnings / sales | `purchases` | `pricePaid` (cents), `courseId`, `createdAt` (ISO), `country` |
| Enrollments | `enrollments` | `userId`, `courseId`, `enrolledAt` |
| Lesson completion | `lessonProgress` + `lessons` + `modules` | `status`, `lessonId` |
| Comments (engagement) | `lessonComments` | `lessonId`, `deletedAt` (soft-deleted excluded) |
| Quiz performance | `quizAttempts` → `quizzes` → `lessons` → `modules` | `score` (0–1 real), `passed` |
| Ratings | `courseRatings` | `rating`, `courseId` |
| Course set / status | `courses` | `instructorId`, `status` |

> Conventions: money is integer **cents**; percentages are **0–100**; `since` is an **ISO
> string** (or `null` = all time) compared directly against ISO text columns. Schema names
> differ from the PRD prose: comments live in `lessonComments`, ratings in `courseRatings`.
>
> PPP pricing is already reflected — `purchases.pricePaid` is the actual amount paid after any
> discount, so revenue-by-country needs no extra logic. Coupon/team/free enrollments produce
> **no** `purchases` row, so revenue and enrollment counts legitimately diverge.

---

## Phase 1 — Analytics service: data layer (issue #70) ✅

**Goal:** all aggregation, fully unit-tested. No UI.

Create `app/services/analyticsService.ts` exposing five functions:

- **`getInstructorOverview(instructorId, since)`** — total revenue (cents), total sales,
  distinct enrolled students, best-selling course name, average rating across all the
  instructor's courses. `since` filters revenue/sales and student counts; rating is cumulative
  (not time-filtered). Returns zeros/nulls when there's no matching data.
- **`getRevenueTimeSeries(instructorId, since)`** — `Array<{ date, revenue }>` grouped by
  `date(purchases.createdAt)` (UTC), ascending; empty array when no purchases in range.
- **`getCourseRevenueSummary(courseId, since)`** — total revenue, sales count, average sale
  price (cents), top-5 revenue by country descending (null country → `"Unknown"`).
- **`getLessonDropoffData(courseId)`** — ordered lessons with `completionPct`
  (`completed / enrolled * 100`) and non-deleted `commentCount`, ordered by module then lesson
  position. Not time-filtered. Uses correlated subqueries so progress and comments can't fan
  out and double-count.
- **`getQuizPerformanceData(courseId)`** — per quiz, pass rate and average score (both 0–100)
  across all attempts; zero-attempt quiz → 0/0; empty array when the course has no quizzes.

**Tests** (`analyticsService.test.ts`, using `createTestDb` + `seedBaseData` +
`vi.mock("~/db")` getter — see `courseService.test.ts` / `ratingService.test.ts`): zero/empty
data, correct aggregation across multiple courses, strict instructor scoping (seed a second
instructor, assert isolation), `since` boundary timestamps, country ranking, divergence of
sales vs. enrolled counts. **21 tests, all passing.**

**User stories covered:** the data behind 1–5, 10–14, 17, 19, 22.

---

## Phase 2 — Global analytics overview page (issue #71) ✅

**Goal:** a cross-course health-check at `/instructor/analytics`.

- **Route:** register `route("instructor/analytics", "routes/instructor.analytics.tsx")` in
  `app/routes.ts` **before** `instructor/:courseId` so the param route doesn't swallow it.
- **Loader:** auth gate (401/403, Instructor or Admin); parse `?range` → `since`; call
  `getInstructorOverview` + `getRevenueTimeSeries`; also return whether the instructor owns any
  course (for the empty state) and the active range.
- **UI** (`instructor.analytics.tsx`): time-range pills (`<Link>` to `?range=…`, active
  highlighted); 5 KPI cards (Total Revenue, Total Sales, Total Students, Best-Selling Course,
  Average Rating); `RevenueChart` (`app/components/revenue-chart.tsx`, client-only Recharts
  `LineChart`); empty states for "no courses" and "no revenue in range"; `HydrateFallback` +
  `ErrorBoundary`.
- **Entry points in `instructor.tsx`:** an "Analytics Overview" header button, and a per-course
  "Analytics" icon link on each course card footer → `/instructor/:courseId/analytics`.

**Done when:** an instructor sees correct KPIs + trend for the selected range; range persists
in the URL; non-instructor gets 403, signed-out gets 401; typecheck + build are clean. (Per
PRD, UI routes/charts are verified manually, not unit-tested.)

**User stories covered:** 1–9, 21, 22.

---

## Phase 3 — Per-course analytics tab (issue #72) ⏳

**Goal:** a deep-dive tab at `/instructor/:courseId/analytics` inside the course editor.

- **Route:** register `route("instructor/:courseId/analytics", "routes/instructor.$courseId.analytics.tsx")`.
- **Loader:** verify the instructor **owns** the course (same check as `instructor.$courseId.tsx`);
  parse `?range` → `since`; call `getCourseRevenueSummary(courseId, since)`,
  `getLessonDropoffData(courseId)`, `getQuizPerformanceData(courseId)`; return all plus the
  active range.
- **UI:**
  - Time-range pills (same component/behaviour as the global page).
  - 4 revenue stat cards: Total Revenue, Sales Count, Average Sale Price, Revenue by Country
    (top-5 mini-table).
  - `LessonDropoffChart` (`app/components/lesson-dropoff-chart.tsx`, client-only Recharts
    `BarChart`; X = truncated lesson titles in position order, Y = 0–100%).
  - Lesson detail table (Lesson · Completion % · Comments); rows with **high comment count +
    low completion** are visually flagged (e.g. amber).
  - Quiz performance table (Quiz · Pass Rate · Avg Score); hidden entirely when there are no
    quizzes.
  - Revenue cards re-filter on range; drop-off and quiz data stay cumulative.
- **Entry point in `instructor.$courseId.tsx`:** add an "Analytics" tab trigger as a `<Link>`
  styled to match the existing tab triggers (the file is ~1600 lines — don't inline a
  `<TabsContent>`).

**Done when:** non-owner instructor gets 403; revenue cards reflect the range; drop-off chart
renders in lesson order; flagged rows appear; quiz table shows/hides correctly; the editor tab
navigates here; typecheck + build clean.

**User stories covered:** 9–20.

---

## Out of scope (per PRD #69)

Video-position-level drop-off heatmaps, CSV/data export, email digests, student-level
drill-down (covered by `/instructor/:courseId/students`), period-over-period comparison,
real-time updates, and coupon/discount analytics.

---

## Build order rationale

1. **Service before UI.** Aggregation is the risk-bearing part and the only part the PRD
   requires automated coverage for. Proving it first (Phase 1) makes the UI phases pure wiring.
2. **Global before per-course.** The global overview (Phase 2) uses the simpler two-function
   slice and establishes the shared range-filter + client-only-chart patterns that the
   per-course tab (Phase 3) then reuses.
