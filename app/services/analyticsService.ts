import { eq, and, desc, gte, sql } from "drizzle-orm";
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
