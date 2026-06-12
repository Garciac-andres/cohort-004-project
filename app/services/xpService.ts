import { eq, and, sql } from "drizzle-orm";
import { db } from "~/db";
import { xpEvents, XpSourceType, lessons, modules } from "~/db/schema";

export function awardXp(opts: {
  userId: number;
  amount: number;
  sourceType: XpSourceType;
  sourceId: number;
}): boolean {
  const existing = db
    .select()
    .from(xpEvents)
    .where(
      and(
        eq(xpEvents.userId, opts.userId),
        eq(xpEvents.sourceType, opts.sourceType),
        eq(xpEvents.sourceId, opts.sourceId)
      )
    )
    .get();

  if (existing) return false;

  db.insert(xpEvents)
    .values({
      userId: opts.userId,
      amount: opts.amount,
      sourceType: opts.sourceType,
      sourceId: opts.sourceId,
    })
    .run();

  return true;
}

export function getTotalXp(userId: number): number {
  const result = db
    .select({ total: sql<number>`coalesce(sum(${xpEvents.amount}), 0)` })
    .from(xpEvents)
    .where(eq(xpEvents.userId, userId))
    .get();

  return result?.total ?? 0;
}

export function getModuleXpTotal(opts: {
  userId: number;
  moduleId: number;
}): number {
  const moduleLessons = db
    .select({ id: lessons.id })
    .from(lessons)
    .where(eq(lessons.moduleId, opts.moduleId))
    .all();

  if (moduleLessons.length === 0) return 0;

  const result = db
    .select({ total: sql<number>`coalesce(sum(${xpEvents.amount}), 0)` })
    .from(xpEvents)
    .where(
      and(
        eq(xpEvents.userId, opts.userId),
        eq(xpEvents.sourceType, XpSourceType.LessonCompletion),
        sql`${xpEvents.sourceId} in (${sql.join(
          moduleLessons.map((l) => sql`${l.id}`),
          sql`, `
        )})`
      )
    )
    .get();

  return result?.total ?? 0;
}

export function isLastLessonInModule(lessonId: number): {
  isLast: boolean;
  moduleId: number | null;
} {
  const lesson = db
    .select({ moduleId: lessons.moduleId })
    .from(lessons)
    .where(eq(lessons.id, lessonId))
    .get();

  if (!lesson) return { isLast: false, moduleId: null };

  const moduleLessons = db
    .select({ id: lessons.id })
    .from(lessons)
    .where(eq(lessons.moduleId, lesson.moduleId))
    .all();

  const lastLesson = db
    .select({ id: lessons.id })
    .from(lessons)
    .where(eq(lessons.moduleId, lesson.moduleId))
    .orderBy(sql`${lessons.position} desc`)
    .limit(1)
    .get();

  return {
    isLast: lastLesson?.id === lessonId,
    moduleId: lesson.moduleId,
  };
}
