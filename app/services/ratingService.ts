import { eq, and, inArray, sql } from "drizzle-orm";
import { db } from "~/db";
import { courseRatings } from "~/db/schema";

// ─── Rating Service ───
// Handles course star ratings (1–5, no written reviews). One rating per
// student per course; re-rating updates the existing row (upsert).
// Eligibility (enrollment + progress) is enforced at the route layer.
// Uses positional parameters (project convention).

export type RatingSummary = {
  average: number | null;
  count: number;
};

const MIN_RATING = 1;
const MAX_RATING = 5;

/**
 * Minimum course progress (percent) a student must reach before they may
 * rate the course. Enforced at the route layer alongside the enrollment check.
 */
export const MIN_PROGRESS_TO_RATE = 25;

export function getUserRatingForCourse(userId: number, courseId: number) {
  return db
    .select()
    .from(courseRatings)
    .where(
      and(
        eq(courseRatings.userId, userId),
        eq(courseRatings.courseId, courseId)
      )
    )
    .get();
}

export function setRating(userId: number, courseId: number, rating: number) {
  if (
    !Number.isInteger(rating) ||
    rating < MIN_RATING ||
    rating > MAX_RATING
  ) {
    throw new Error(`Rating must be an integer between ${MIN_RATING} and ${MAX_RATING}`);
  }

  // Insert, or update the existing rating if this user has already rated.
  return db
    .insert(courseRatings)
    .values({ userId, courseId, rating })
    .onConflictDoUpdate({
      target: [courseRatings.userId, courseRatings.courseId],
      set: { rating, updatedAt: new Date().toISOString() },
    })
    .returning()
    .get();
}

export function getCourseRatingSummary(courseId: number): RatingSummary {
  const result = db
    .select({
      average: sql<number | null>`avg(${courseRatings.rating})`,
      count: sql<number>`count(*)`,
    })
    .from(courseRatings)
    .where(eq(courseRatings.courseId, courseId))
    .get();

  return {
    average: result?.average ?? null,
    count: result?.count ?? 0,
  };
}

/**
 * Batched rating summaries for many courses at once (avoids N+1 on list pages).
 * Returns a Map keyed by courseId; courses with no ratings are omitted, so
 * callers should fall back to { average: null, count: 0 }.
 */
export function getRatingSummariesForCourses(
  courseIds: number[]
): Map<number, RatingSummary> {
  const summaries = new Map<number, RatingSummary>();
  if (courseIds.length === 0) return summaries;

  const rows = db
    .select({
      courseId: courseRatings.courseId,
      average: sql<number | null>`avg(${courseRatings.rating})`,
      count: sql<number>`count(*)`,
    })
    .from(courseRatings)
    .where(inArray(courseRatings.courseId, courseIds))
    .groupBy(courseRatings.courseId)
    .all();

  for (const row of rows) {
    summaries.set(row.courseId, {
      average: row.average ?? null,
      count: row.count,
    });
  }

  return summaries;
}
