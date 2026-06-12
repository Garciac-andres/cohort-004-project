import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import {
  awardXp,
  getTotalXp,
  getModuleXpTotal,
  isLastLessonInModule,
} from "./xpService";

function createModuleWithLessons(
  courseId: number,
  moduleTitle: string,
  position: number,
  lessonCount: number
) {
  const mod = testDb
    .insert(schema.modules)
    .values({ courseId, title: moduleTitle, position })
    .returning()
    .get();

  const lessons = [];
  for (let i = 0; i < lessonCount; i++) {
    const lesson = testDb
      .insert(schema.lessons)
      .values({
        moduleId: mod.id,
        title: `Lesson ${i + 1}`,
        position: i + 1,
      })
      .returning()
      .get();
    lessons.push(lesson);
  }

  return { module: mod, lessons };
}

describe("xpService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("awardXp", () => {
    it("awards XP and returns true on first call", () => {
      const { lessons } = createModuleWithLessons(base.course.id, "M1", 1, 1);
      const result = awardXp({
        userId: base.user.id,
        amount: 10,
        sourceType: schema.XpSourceType.LessonCompletion,
        sourceId: lessons[0].id,
      });
      expect(result).toBe(true);
      expect(getTotalXp(base.user.id)).toBe(10);
    });

    it("is idempotent — second award for same source returns false", () => {
      const { lessons } = createModuleWithLessons(base.course.id, "M1", 1, 1);
      awardXp({
        userId: base.user.id,
        amount: 10,
        sourceType: schema.XpSourceType.LessonCompletion,
        sourceId: lessons[0].id,
      });
      const result = awardXp({
        userId: base.user.id,
        amount: 10,
        sourceType: schema.XpSourceType.LessonCompletion,
        sourceId: lessons[0].id,
      });
      expect(result).toBe(false);
      expect(getTotalXp(base.user.id)).toBe(10);
    });

    it("allows different source types for the same sourceId", () => {
      const { lessons } = createModuleWithLessons(base.course.id, "M1", 1, 1);
      awardXp({
        userId: base.user.id,
        amount: 10,
        sourceType: schema.XpSourceType.LessonCompletion,
        sourceId: lessons[0].id,
      });
      const result = awardXp({
        userId: base.user.id,
        amount: 5,
        sourceType: schema.XpSourceType.QuizPass,
        sourceId: lessons[0].id,
      });
      expect(result).toBe(true);
      expect(getTotalXp(base.user.id)).toBe(15);
    });

    it("allows same source type for different users", () => {
      const { lessons } = createModuleWithLessons(base.course.id, "M1", 1, 1);
      awardXp({
        userId: base.user.id,
        amount: 10,
        sourceType: schema.XpSourceType.LessonCompletion,
        sourceId: lessons[0].id,
      });
      const result = awardXp({
        userId: base.instructor.id,
        amount: 10,
        sourceType: schema.XpSourceType.LessonCompletion,
        sourceId: lessons[0].id,
      });
      expect(result).toBe(true);
      expect(getTotalXp(base.user.id)).toBe(10);
      expect(getTotalXp(base.instructor.id)).toBe(10);
    });
  });

  describe("getTotalXp", () => {
    it("returns 0 for a user with no XP", () => {
      expect(getTotalXp(base.user.id)).toBe(0);
    });

    it("accumulates XP across multiple awards", () => {
      const { lessons } = createModuleWithLessons(base.course.id, "M1", 1, 3);

      for (const lesson of lessons) {
        awardXp({
          userId: base.user.id,
          amount: 10,
          sourceType: schema.XpSourceType.LessonCompletion,
          sourceId: lesson.id,
        });
      }

      expect(getTotalXp(base.user.id)).toBe(30);
    });

    it("accumulates globally across different courses", () => {
      const course2 = testDb
        .insert(schema.courses)
        .values({
          title: "Course 2",
          slug: "course-2",
          description: "Second course",
          instructorId: base.instructor.id,
          categoryId: base.category.id,
          status: schema.CourseStatus.Published,
        })
        .returning()
        .get();

      const { lessons: lessons1 } = createModuleWithLessons(
        base.course.id,
        "M1",
        1,
        2
      );
      const { lessons: lessons2 } = createModuleWithLessons(
        course2.id,
        "M2",
        1,
        2
      );

      for (const lesson of [...lessons1, ...lessons2]) {
        awardXp({
          userId: base.user.id,
          amount: 10,
          sourceType: schema.XpSourceType.LessonCompletion,
          sourceId: lesson.id,
        });
      }

      expect(getTotalXp(base.user.id)).toBe(40);
    });
  });

  describe("isLastLessonInModule", () => {
    it("returns true for the only lesson in a module", () => {
      const { lessons } = createModuleWithLessons(base.course.id, "M1", 1, 1);
      const result = isLastLessonInModule(lessons[0].id);
      expect(result.isLast).toBe(true);
      expect(result.moduleId).toBe(lessons[0].moduleId);
    });

    it("returns false for a non-last lesson", () => {
      const { lessons } = createModuleWithLessons(base.course.id, "M1", 1, 3);
      expect(isLastLessonInModule(lessons[0].id).isLast).toBe(false);
      expect(isLastLessonInModule(lessons[1].id).isLast).toBe(false);
    });

    it("returns true for the last lesson by position", () => {
      const { lessons } = createModuleWithLessons(base.course.id, "M1", 1, 3);
      expect(isLastLessonInModule(lessons[2].id).isLast).toBe(true);
    });

    it("returns false for a non-existent lesson", () => {
      const result = isLastLessonInModule(9999);
      expect(result.isLast).toBe(false);
      expect(result.moduleId).toBeNull();
    });
  });

  describe("getModuleXpTotal", () => {
    it("returns 0 when no XP awarded in module", () => {
      const { module: mod } = createModuleWithLessons(
        base.course.id,
        "M1",
        1,
        3
      );
      expect(getModuleXpTotal({ userId: base.user.id, moduleId: mod.id })).toBe(
        0
      );
    });

    it("sums lesson completion XP for a module", () => {
      const { module: mod, lessons } = createModuleWithLessons(
        base.course.id,
        "M1",
        1,
        4
      );

      for (const lesson of lessons) {
        awardXp({
          userId: base.user.id,
          amount: 10,
          sourceType: schema.XpSourceType.LessonCompletion,
          sourceId: lesson.id,
        });
      }

      expect(getModuleXpTotal({ userId: base.user.id, moduleId: mod.id })).toBe(
        40
      );
    });

    it("does not include XP from other modules", () => {
      const { module: mod1, lessons: lessons1 } = createModuleWithLessons(
        base.course.id,
        "M1",
        1,
        2
      );
      const { lessons: lessons2 } = createModuleWithLessons(
        base.course.id,
        "M2",
        2,
        2
      );

      for (const lesson of [...lessons1, ...lessons2]) {
        awardXp({
          userId: base.user.id,
          amount: 10,
          sourceType: schema.XpSourceType.LessonCompletion,
          sourceId: lesson.id,
        });
      }

      expect(
        getModuleXpTotal({ userId: base.user.id, moduleId: mod1.id })
      ).toBe(20);
    });
  });
});
