import { eq, and } from "drizzle-orm";
import { db } from "~/db";
import { lessonBookmarks, lessons, modules } from "~/db/schema";

// ─── Bookmark Service ───
// Handles private per-student lesson bookmarks. A bookmark is a single row keyed
// by (userId, lessonId); toggling on inserts it, toggling off deletes it.
// Bookmarks persist until manually removed (even after lesson completion).
// Eligibility (enrollment) is enforced at the route layer.

/** Whether this student has bookmarked the given lesson. */
export function isLessonBookmarked(opts: {
  userId: number;
  lessonId: number;
}): boolean {
  const row = db
    .select({ id: lessonBookmarks.id })
    .from(lessonBookmarks)
    .where(
      and(
        eq(lessonBookmarks.userId, opts.userId),
        eq(lessonBookmarks.lessonId, opts.lessonId)
      )
    )
    .get();

  return row !== undefined;
}

/**
 * Toggles a bookmark: removes it if present, otherwise creates it.
 * Returns the resulting state so callers can reflect it in the UI.
 */
export function toggleBookmark(opts: {
  userId: number;
  lessonId: number;
}): { bookmarked: boolean } {
  const existing = db
    .select({ id: lessonBookmarks.id })
    .from(lessonBookmarks)
    .where(
      and(
        eq(lessonBookmarks.userId, opts.userId),
        eq(lessonBookmarks.lessonId, opts.lessonId)
      )
    )
    .get();

  if (existing) {
    db.delete(lessonBookmarks)
      .where(eq(lessonBookmarks.id, existing.id))
      .run();
    return { bookmarked: false };
  }

  db.insert(lessonBookmarks)
    .values({ userId: opts.userId, lessonId: opts.lessonId })
    .run();
  return { bookmarked: true };
}

/**
 * All lesson IDs this student has bookmarked within a single course. Joins
 * lessonBookmarks → lessons → modules to scope by course, so list pages can
 * batch-load every indicator in one query (avoids N+1).
 */
export function getBookmarkedLessonIds(opts: {
  userId: number;
  courseId: number;
}): number[] {
  const rows = db
    .select({ lessonId: lessonBookmarks.lessonId })
    .from(lessonBookmarks)
    .innerJoin(lessons, eq(lessonBookmarks.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(
      and(
        eq(lessonBookmarks.userId, opts.userId),
        eq(modules.courseId, opts.courseId)
      )
    )
    .all();

  return rows.map((r) => r.lessonId);
}
