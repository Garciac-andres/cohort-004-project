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

// Import after mock so the module picks up our test db
import {
  toggleBookmark,
  isLessonBookmarked,
  getBookmarkedLessonIds,
} from "./bookmarkService";

/** Creates an extra student and returns it. */
function makeStudent(email: string) {
  return testDb
    .insert(schema.users)
    .values({ name: email, email, role: schema.UserRole.Student })
    .returning()
    .get();
}

/** Creates a module + lesson under the base course and returns the lesson. */
function makeLesson(title: string) {
  const mod = testDb
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: `${title} module`, position: 0 })
    .returning()
    .get();

  return testDb
    .insert(schema.lessons)
    .values({ moduleId: mod.id, title, position: 0 })
    .returning()
    .get();
}

/** Creates an extra published course and returns it. */
function makeCourse(slug: string) {
  return testDb
    .insert(schema.courses)
    .values({
      title: slug,
      slug,
      description: "Another course",
      instructorId: base.instructor.id,
      categoryId: base.category.id,
      status: schema.CourseStatus.Published,
    })
    .returning()
    .get();
}

/** Creates a module + lesson under a given course and returns the lesson. */
function makeLessonInCourse(courseId: number, title: string) {
  const mod = testDb
    .insert(schema.modules)
    .values({ courseId, title: `${title} module`, position: 0 })
    .returning()
    .get();

  return testDb
    .insert(schema.lessons)
    .values({ moduleId: mod.id, title, position: 0 })
    .returning()
    .get();
}

describe("bookmarkService", () => {
  let lessonId: number;

  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
    lessonId = makeLesson("Intro").id;
  });

  describe("toggleBookmark", () => {
    it("creates a bookmark when none exists", () => {
      const result = toggleBookmark({ userId: base.user.id, lessonId });

      expect(result).toEqual({ bookmarked: true });
      expect(isLessonBookmarked({ userId: base.user.id, lessonId })).toBe(true);
    });

    it("removes the bookmark when one already exists", () => {
      toggleBookmark({ userId: base.user.id, lessonId });
      const result = toggleBookmark({ userId: base.user.id, lessonId });

      expect(result).toEqual({ bookmarked: false });
      expect(isLessonBookmarked({ userId: base.user.id, lessonId })).toBe(
        false
      );
    });

    it("keeps each student's bookmarks separate", () => {
      const student2 = makeStudent("s2@example.com");

      toggleBookmark({ userId: base.user.id, lessonId });

      expect(isLessonBookmarked({ userId: base.user.id, lessonId })).toBe(true);
      expect(isLessonBookmarked({ userId: student2.id, lessonId })).toBe(false);
    });
  });

  describe("isLessonBookmarked", () => {
    it("returns false when the lesson is not bookmarked", () => {
      expect(isLessonBookmarked({ userId: base.user.id, lessonId })).toBe(
        false
      );
    });

    it("returns true after bookmarking", () => {
      toggleBookmark({ userId: base.user.id, lessonId });
      expect(isLessonBookmarked({ userId: base.user.id, lessonId })).toBe(true);
    });
  });

  describe("getBookmarkedLessonIds", () => {
    it("returns all bookmarked lesson IDs within a course", () => {
      const lesson2 = makeLesson("Second");
      const lesson3 = makeLesson("Third");

      toggleBookmark({ userId: base.user.id, lessonId });
      toggleBookmark({ userId: base.user.id, lessonId: lesson3.id });

      const ids = getBookmarkedLessonIds({
        userId: base.user.id,
        courseId: base.course.id,
      });

      expect(ids).toHaveLength(2);
      expect(ids).toEqual(expect.arrayContaining([lessonId, lesson3.id]));
      expect(ids).not.toContain(lesson2.id);
    });

    it("only includes bookmarks for the given course", () => {
      const course2 = makeCourse("course-two");
      const otherLesson = makeLessonInCourse(course2.id, "Elsewhere");

      toggleBookmark({ userId: base.user.id, lessonId });
      toggleBookmark({ userId: base.user.id, lessonId: otherLesson.id });

      const ids = getBookmarkedLessonIds({
        userId: base.user.id,
        courseId: base.course.id,
      });

      expect(ids).toEqual([lessonId]);
    });

    it("only includes the given student's bookmarks", () => {
      const student2 = makeStudent("s2@example.com");

      toggleBookmark({ userId: base.user.id, lessonId });
      toggleBookmark({ userId: student2.id, lessonId });

      const ids = getBookmarkedLessonIds({
        userId: student2.id,
        courseId: base.course.id,
      });

      expect(ids).toEqual([lessonId]);
    });

    it("returns an empty array when nothing is bookmarked", () => {
      expect(
        getBookmarkedLessonIds({
          userId: base.user.id,
          courseId: base.course.id,
        })
      ).toEqual([]);
    });
  });
});
