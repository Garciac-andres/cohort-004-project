import { eq, and, desc, gte, inArray, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  purchases,
  enrollments,
  courses,
  modules,
  lessons,
  lessonProgress,
  lessonComments,
  quizzes,
  quizAttempts,
  courseRatings,
  CourseStatus,
  LessonProgressStatus,
} from "~/db/schema";

// ─── Analytics Service ───
// Owns ALL instructor-dashboard aggregation (GitHub #69 / #70). Every figure is
// computed at the SQL level (SUM / COUNT / GROUP BY / correlated subqueries) —
// never via per-student loops. Never imported into a client component; data
// reaches the UI through loader data only (see memory
// `server-import-leak-into-client`).
//
// Conventions:
// - Money (`pricePaid`) is in integer cents; revenue figures are summed cents.
// - `since` is an ISO timestamp string (or null = all time) and is compared
//   directly against the ISO text columns (ISO 8601 sorts lexicographically).
// - Percentages (`completionPct`, `passRate`, `averageScore`) are 0–100.
// - The schema names differ from the PRD: comments live in `lessonComments`
//   (soft-deleted rows excluded from engagement counts) and ratings in
//   `courseRatings`.
// - The executive-dashboard KPIs take a `DashboardFilter` (status set + course)
//   so the whole page re-scopes together; it defaults to `ALL_COURSES_FILTER`
//   (the instructor's entire portfolio) via the shared `courseScope` predicate.

export type InstructorOverview = {
  totalRevenue: number; // cents
  totalSales: number;
  totalStudents: number; // distinct enrolled users
  bestSellingCourse: string | null;
  averageRating: number | null;
};

export type RevenuePoint = { date: string; revenue: number };

export type CountryRevenue = { country: string; revenue: number };

export type CourseRevenueSummary = {
  totalRevenue: number; // cents
  salesCount: number;
  averageSalePrice: number; // cents; 0 when no sales
  revenueByCountry: CountryRevenue[]; // top 5, revenue descending
};

export type LessonDropoff = {
  lessonId: number;
  title: string;
  position: number;
  completionPct: number; // 0–100
  commentCount: number;
};

export type QuizPerformance = {
  quizId: number;
  title: string;
  passRate: number; // 0–100
  averageScore: number; // 0–100
};

export type EarningsWindow = {
  earnings: number; // cents
  paidPurchases: number;
};

export type InstructorEarnings = {
  allTime: EarningsWindow;
  last30Days: EarningsWindow;
  last90Days: EarningsWindow;
  last180Days: EarningsWindow;
};

export type InstructorStudents = {
  totalStudents: number; // distinct enrolled users across the instructor's courses
  newLast30Days: number; // new enrollments (rows) in each window
  newLast90Days: number;
  newLast180Days: number;
};

export type InstructorCompletion = {
  officialCompletions: number; // enrollments with a completion timestamp
  reached100: number; // enrollments whose completed lessons == course total lessons
};

// Days-ago cutoff as an ISO string, for comparing against stored ISO timestamps
// (ISO 8601 sorts lexicographically, so a string `>=` is a chronological `>=`).
function isoCutoff(now: Date, days: number): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

// The global dashboard filter (GitHub #6). Re-scopes every KPI at once:
// `statuses` narrows to a subset of course statuses (empty = all, no narrowing)
// and `courseId` narrows to a single course (null = all). Threaded into every
// aggregate so the whole page stays internally consistent.
export type DashboardFilter = {
  statuses: CourseStatus[];
  courseId: number | null;
};

// The unfiltered default — all statuses, all courses. Used as the parameter
// default so existing call sites (and tests) keep their whole-portfolio scope.
export const ALL_COURSES_FILTER: DashboardFilter = {
  statuses: [],
  courseId: null,
};

// Course-scoping predicate shared by every dashboard aggregate: always limits to
// the instructor's own courses, then narrows by the selected statuses (empty =
// all) and an optional single course. Returns a drizzle condition for a
// `.where(...)` over a query that joins `courses`.
function courseScope(instructorId: number, filter: DashboardFilter) {
  return and(
    eq(courses.instructorId, instructorId),
    filter.statuses.length > 0
      ? inArray(courses.status, filter.statuses)
      : undefined,
    filter.courseId != null ? eq(courses.id, filter.courseId) : undefined
  );
}

/**
 * Headline metrics across all of an instructor's courses. `since` (ISO string)
 * filters revenue/sales (`purchases.createdAt`) and student counts
 * (`enrollments.enrolledAt`); `null` means all time. Average rating is not
 * time-filtered (ratings are a cumulative satisfaction signal). Returns
 * zeros/nulls when the instructor has no matching data.
 */
export function getInstructorOverview(
  instructorId: number,
  since: string | null
): InstructorOverview {
  const purchaseSince = since ? gte(purchases.createdAt, since) : undefined;

  const revenue = db
    .select({
      totalRevenue: sql<number>`coalesce(sum(${purchases.pricePaid}), 0)`,
      totalSales: sql<number>`count(*)`,
    })
    .from(purchases)
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(and(eq(courses.instructorId, instructorId), purchaseSince))
    .get();

  const students = db
    .select({
      totalStudents: sql<number>`count(distinct ${enrollments.userId})`,
    })
    .from(enrollments)
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .where(
      and(
        eq(courses.instructorId, instructorId),
        since ? gte(enrollments.enrolledAt, since) : undefined
      )
    )
    .get();

  const best = db
    .select({
      title: courses.title,
      revenue: sql<number>`sum(${purchases.pricePaid})`,
    })
    .from(purchases)
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(and(eq(courses.instructorId, instructorId), purchaseSince))
    .groupBy(courses.id)
    .orderBy(desc(sql`sum(${purchases.pricePaid})`))
    .limit(1)
    .get();

  const rating = db
    .select({ average: sql<number | null>`avg(${courseRatings.rating})` })
    .from(courseRatings)
    .innerJoin(courses, eq(courseRatings.courseId, courses.id))
    .where(eq(courses.instructorId, instructorId))
    .get();

  return {
    totalRevenue: revenue?.totalRevenue ?? 0,
    totalSales: revenue?.totalSales ?? 0,
    totalStudents: students?.totalStudents ?? 0,
    bestSellingCourse: best?.title ?? null,
    averageRating: rating?.average ?? null,
  };
}

/**
 * Daily revenue points for the trend chart, scoped to the instructor's courses
 * and grouped by calendar day (UTC, via SQLite `date()`). Ordered ascending;
 * empty array when there are no purchases in range.
 */
export function getRevenueTimeSeries(
  instructorId: number,
  since: string | null
): RevenuePoint[] {
  return db
    .select({
      date: sql<string>`date(${purchases.createdAt})`,
      revenue: sql<number>`sum(${purchases.pricePaid})`,
    })
    .from(purchases)
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(
      and(
        eq(courses.instructorId, instructorId),
        since ? gte(purchases.createdAt, since) : undefined
      )
    )
    .groupBy(sql`date(${purchases.createdAt})`)
    .orderBy(sql`date(${purchases.createdAt})`)
    .all();
}

/**
 * Revenue breakdown for a single course: total, sales count, average sale price
 * (cents), and top-5 revenue by country (null country → "Unknown"), descending.
 * `since` filters `purchases.createdAt`. Course ownership is enforced by the
 * route, not here. Returns zeros / empty for a course with no purchases.
 */
export function getCourseRevenueSummary(
  courseId: number,
  since: string | null
): CourseRevenueSummary {
  const courseSince = since ? gte(purchases.createdAt, since) : undefined;

  const totals = db
    .select({
      totalRevenue: sql<number>`coalesce(sum(${purchases.pricePaid}), 0)`,
      salesCount: sql<number>`count(*)`,
    })
    .from(purchases)
    .where(and(eq(purchases.courseId, courseId), courseSince))
    .get();

  const totalRevenue = totals?.totalRevenue ?? 0;
  const salesCount = totals?.salesCount ?? 0;

  const revenueByCountry = db
    .select({
      country: sql<string>`coalesce(${purchases.country}, 'Unknown')`,
      revenue: sql<number>`sum(${purchases.pricePaid})`,
    })
    .from(purchases)
    .where(and(eq(purchases.courseId, courseId), courseSince))
    .groupBy(sql`coalesce(${purchases.country}, 'Unknown')`)
    .orderBy(desc(sql`sum(${purchases.pricePaid})`))
    .limit(5)
    .all();

  return {
    totalRevenue,
    salesCount,
    averageSalePrice: salesCount > 0 ? totalRevenue / salesCount : 0,
    revenueByCountry,
  };
}

/**
 * Per-lesson drop-off for a course: completion percentage (completed / enrolled)
 * and (non-deleted) comment count, ordered by module then lesson position.
 * Not time-filtered — lesson progress is a cumulative state. Completion uses
 * correlated subqueries so joining progress and comments can't fan out and
 * double-count. Empty array for a course with no lessons; 0% when nobody has
 * completed a lesson (including zero enrollments).
 */
export function getLessonDropoffData(courseId: number): LessonDropoff[] {
  const enrolled = db
    .select({ count: sql<number>`count(*)` })
    .from(enrollments)
    .where(eq(enrollments.courseId, courseId))
    .get();
  const enrolledCount = enrolled?.count ?? 0;

  const rows = db
    .select({
      lessonId: lessons.id,
      title: lessons.title,
      position: lessons.position,
      completedCount: sql<number>`(
        select count(*) from ${lessonProgress}
        where ${lessonProgress.lessonId} = ${lessons.id}
          and ${lessonProgress.status} = ${LessonProgressStatus.Completed}
      )`,
      commentCount: sql<number>`(
        select count(*) from ${lessonComments}
        where ${lessonComments.lessonId} = ${lessons.id}
          and ${lessonComments.deletedAt} is null
      )`,
    })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .orderBy(modules.position, lessons.position)
    .all();

  return rows.map((row) => ({
    lessonId: row.lessonId,
    title: row.title,
    position: row.position,
    completionPct:
      enrolledCount > 0 ? (row.completedCount / enrolledCount) * 100 : 0,
    commentCount: row.commentCount,
  }));
}

/**
 * Per-quiz performance for a course: pass rate and average score (both 0–100)
 * across all attempts. Quizzes with no attempts return 0 for both. Empty array
 * when the course has no quizzes.
 */
export function getQuizPerformanceData(courseId: number): QuizPerformance[] {
  const rows = db
    .select({
      quizId: quizzes.id,
      title: quizzes.title,
      attempts: sql<number>`(
        select count(*) from ${quizAttempts}
        where ${quizAttempts.quizId} = ${quizzes.id}
      )`,
      passedCount: sql<number>`(
        select count(*) from ${quizAttempts}
        where ${quizAttempts.quizId} = ${quizzes.id}
          and ${quizAttempts.passed} = 1
      )`,
      avgScore: sql<number | null>`(
        select avg(${quizAttempts.score}) from ${quizAttempts}
        where ${quizAttempts.quizId} = ${quizzes.id}
      )`,
    })
    .from(quizzes)
    .innerJoin(lessons, eq(quizzes.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .orderBy(modules.position, lessons.position, quizzes.id)
    .all();

  return rows.map((row) => ({
    quizId: row.quizId,
    title: row.title,
    passRate: row.attempts > 0 ? (row.passedCount / row.attempts) * 100 : 0,
    averageScore: row.avgScore != null ? row.avgScore * 100 : 0,
  }));
}

/**
 * Earnings (sum of `pricePaid`, cents) and the paid-purchase count behind them,
 * across all of an instructor's courses, for four nested windows: all-time and
 * the last 30 / 90 / 180 days. Earnings are drawn from the purchases log, so
 * free / seeded / coupon-redeemed enrollments (which have no purchase row)
 * contribute zero, and the paid-purchase count exposes the gap between enrolled
 * students and paying customers. No course-status filter: archived courses that
 * earned money still count toward lifetime earnings. Window cutoffs compare the
 * stored ISO timestamp against a computed ISO cutoff (ISO 8601 sorts
 * lexicographically). `now` is injectable so window boundaries are deterministic
 * in tests. One SQL aggregate with conditional sums — no per-student loops.
 */
export function getInstructorEarnings(
  instructorId: number,
  filter: DashboardFilter = ALL_COURSES_FILTER,
  now: Date = new Date()
): InstructorEarnings {
  const c30 = isoCutoff(now, 30);
  const c90 = isoCutoff(now, 90);
  const c180 = isoCutoff(now, 180);

  const earningsSince = (since: string) =>
    sql<number>`coalesce(sum(case when ${purchases.createdAt} >= ${since} then ${purchases.pricePaid} else 0 end), 0)`;
  const countSince = (since: string) =>
    sql<number>`coalesce(sum(case when ${purchases.createdAt} >= ${since} then 1 else 0 end), 0)`;

  const row = db
    .select({
      allEarnings: sql<number>`coalesce(sum(${purchases.pricePaid}), 0)`,
      allCount: sql<number>`count(*)`,
      earnings30: earningsSince(c30),
      count30: countSince(c30),
      earnings90: earningsSince(c90),
      count90: countSince(c90),
      earnings180: earningsSince(c180),
      count180: countSince(c180),
    })
    .from(purchases)
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(courseScope(instructorId, filter))
    .get();

  return {
    allTime: {
      earnings: row?.allEarnings ?? 0,
      paidPurchases: row?.allCount ?? 0,
    },
    last30Days: { earnings: row?.earnings30 ?? 0, paidPurchases: row?.count30 ?? 0 },
    last90Days: { earnings: row?.earnings90 ?? 0, paidPurchases: row?.count90 ?? 0 },
    last180Days: {
      earnings: row?.earnings180 ?? 0,
      paidPurchases: row?.count180 ?? 0,
    },
  };
}

/**
 * Total reach and recent growth of an instructor's student base. `totalStudents`
 * is the distinct count of enrolled users across all the instructor's courses
 * (paid or not — free / coupon / seeded enrollments still represent reach, so
 * there's no purchase filter). The three windows count *new enrollments* (rows,
 * not distinct users) whose `enrolledAt` falls on or after the 30 / 90 / 180-day
 * cutoff, so one student enrolling in two courses this month shows as two new
 * enrollments. Cutoffs compare the stored ISO timestamp against a computed ISO
 * cutoff (ISO 8601 sorts lexicographically). `now` is injectable so window
 * boundaries are deterministic in tests. One SQL aggregate with conditional sums
 * — no per-student loops. Returns zeros when the instructor has no enrollments.
 */
export function getInstructorStudents(
  instructorId: number,
  filter: DashboardFilter = ALL_COURSES_FILTER,
  now: Date = new Date()
): InstructorStudents {
  const newSince = (since: string) =>
    sql<number>`coalesce(sum(case when ${enrollments.enrolledAt} >= ${since} then 1 else 0 end), 0)`;

  const row = db
    .select({
      totalStudents: sql<number>`count(distinct ${enrollments.userId})`,
      new30: newSince(isoCutoff(now, 30)),
      new90: newSince(isoCutoff(now, 90)),
      new180: newSince(isoCutoff(now, 180)),
    })
    .from(enrollments)
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .where(courseScope(instructorId, filter))
    .get();

  return {
    totalStudents: row?.totalStudents ?? 0,
    newLast30Days: row?.new30 ?? 0,
    newLast90Days: row?.new90 ?? 0,
    newLast180Days: row?.new180 ?? 0,
  };
}

/**
 * Course-completion counts across all of an instructor's courses, reported two
 * ways so the gap between them is visible:
 *  - `officialCompletions`: enrollments with a `completedAt` timestamp set — the
 *    student was formally marked complete.
 *  - `reached100`: enrollments whose count of completed lessons equals the
 *    course's total lesson count — the student finished every lesson, whether or
 *    not the enrollment was ever officially marked complete.
 * Both are current-state (not windowed) and computed independently in one SQL
 * pass. `reached100` uses correlated COUNT subqueries per enrollment row, never
 * the per-student progress calc, to avoid N+1. Courses with zero lessons are
 * excluded from `reached100` (0 completed == 0 total is not a real completion).
 * Returns zeros when the instructor has no enrollments.
 */
export function getInstructorCompletion(
  instructorId: number,
  filter: DashboardFilter = ALL_COURSES_FILTER
): InstructorCompletion {
  const totalLessons = sql<number>`(
    select count(*) from ${lessons}
    inner join ${modules} on ${lessons.moduleId} = ${modules.id}
    where ${modules.courseId} = ${enrollments.courseId}
  )`;
  const completedLessons = sql<number>`(
    select count(*) from ${lessonProgress}
    inner join ${lessons} on ${lessonProgress.lessonId} = ${lessons.id}
    inner join ${modules} on ${lessons.moduleId} = ${modules.id}
    where ${modules.courseId} = ${enrollments.courseId}
      and ${lessonProgress.userId} = ${enrollments.userId}
      and ${lessonProgress.status} = ${LessonProgressStatus.Completed}
  )`;

  const row = db
    .select({
      officialCompletions: sql<number>`coalesce(sum(case when ${enrollments.completedAt} is not null then 1 else 0 end), 0)`,
      reached100: sql<number>`coalesce(sum(case when ${totalLessons} > 0 and ${completedLessons} = ${totalLessons} then 1 else 0 end), 0)`,
    })
    .from(enrollments)
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .where(courseScope(instructorId, filter))
    .get();

  return {
    officialCompletions: row?.officialCompletions ?? 0,
    reached100: row?.reached100 ?? 0,
  };
}

/**
 * A single mastery number: the average quiz score (0–100) across every attempt
 * on every quiz in the instructor's courses, joining attempts → quizzes →
 * lessons → modules → courses. Scores are stored 0–1 and scaled to 0–100 here.
 * Current-state, not windowed; weighted by attempt (a student with more attempts
 * counts more), matching the per-quiz averages elsewhere. One SQL `avg`, no
 * per-student loops. Returns `null` when the instructor has no quiz attempts, so
 * the card can show `—` rather than a misleading 0.
 */
export function getInstructorAverageQuizScore(
  instructorId: number,
  filter: DashboardFilter = ALL_COURSES_FILTER
): number | null {
  const row = db
    .select({ average: sql<number | null>`avg(${quizAttempts.score})` })
    .from(quizAttempts)
    .innerJoin(quizzes, eq(quizAttempts.quizId, quizzes.id))
    .innerJoin(lessons, eq(quizzes.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(courseScope(instructorId, filter))
    .get();

  return row?.average != null ? row.average * 100 : null;
}
