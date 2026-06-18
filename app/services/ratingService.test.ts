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
  setRating,
  getUserRatingForCourse,
  getCourseRatingSummary,
  getRatingSummariesForCourses,
} from "./ratingService";

/** Creates an extra student and returns its id. */
function makeStudent(email: string) {
  return testDb
    .insert(schema.users)
    .values({ name: email, email, role: schema.UserRole.Student })
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

describe("ratingService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("setRating", () => {
    it("creates a new rating", () => {
      const rating = setRating(base.user.id, base.course.id, 4);

      expect(rating).toBeDefined();
      expect(rating.userId).toBe(base.user.id);
      expect(rating.courseId).toBe(base.course.id);
      expect(rating.rating).toBe(4);
      expect(rating.createdAt).toBeDefined();
    });

    it("updates the existing rating in place (upsert)", () => {
      setRating(base.user.id, base.course.id, 2);
      const updated = setRating(base.user.id, base.course.id, 5);

      expect(updated.rating).toBe(5);

      // Still only one rating for this user/course — count stays 1.
      const summary = getCourseRatingSummary(base.course.id);
      expect(summary.count).toBe(1);
      expect(summary.average).toBe(5);
    });

    it("rejects ratings below 1", () => {
      expect(() => setRating(base.user.id, base.course.id, 0)).toThrowError(
        /between 1 and 5/
      );
    });

    it("rejects ratings above 5", () => {
      expect(() => setRating(base.user.id, base.course.id, 6)).toThrowError(
        /between 1 and 5/
      );
    });

    it("rejects non-integer ratings", () => {
      expect(() => setRating(base.user.id, base.course.id, 3.5)).toThrowError(
        /between 1 and 5/
      );
    });
  });

  describe("getUserRatingForCourse", () => {
    it("returns the user's rating when it exists", () => {
      setRating(base.user.id, base.course.id, 3);

      const found = getUserRatingForCourse(base.user.id, base.course.id);
      expect(found).toBeDefined();
      expect(found!.rating).toBe(3);
    });

    it("returns undefined when the user has not rated", () => {
      expect(
        getUserRatingForCourse(base.user.id, base.course.id)
      ).toBeUndefined();
    });
  });

  describe("getCourseRatingSummary", () => {
    it("averages all ratings and counts them", () => {
      const student2 = makeStudent("s2@example.com");
      const student3 = makeStudent("s3@example.com");

      setRating(base.user.id, base.course.id, 5);
      setRating(student2.id, base.course.id, 4);
      setRating(student3.id, base.course.id, 3);

      const summary = getCourseRatingSummary(base.course.id);
      expect(summary.count).toBe(3);
      expect(summary.average).toBeCloseTo(4);
    });

    it("returns null average and 0 count when there are no ratings", () => {
      const summary = getCourseRatingSummary(base.course.id);
      expect(summary.average).toBeNull();
      expect(summary.count).toBe(0);
    });

    it("only counts ratings for the given course", () => {
      const course2 = makeCourse("course-two");

      setRating(base.user.id, base.course.id, 5);
      setRating(base.user.id, course2.id, 1);

      expect(getCourseRatingSummary(base.course.id).average).toBe(5);
      expect(getCourseRatingSummary(course2.id).average).toBe(1);
    });
  });

  describe("getRatingSummariesForCourses", () => {
    it("returns a map of summaries keyed by courseId", () => {
      const course2 = makeCourse("course-two");
      const student2 = makeStudent("s2@example.com");

      setRating(base.user.id, base.course.id, 4);
      setRating(student2.id, base.course.id, 2);
      setRating(base.user.id, course2.id, 5);

      const summaries = getRatingSummariesForCourses([
        base.course.id,
        course2.id,
      ]);

      expect(summaries.get(base.course.id)).toEqual({ average: 3, count: 2 });
      expect(summaries.get(course2.id)).toEqual({ average: 5, count: 1 });
    });

    it("omits courses that have no ratings", () => {
      const course2 = makeCourse("course-two");
      setRating(base.user.id, base.course.id, 4);

      const summaries = getRatingSummariesForCourses([
        base.course.id,
        course2.id,
      ]);

      expect(summaries.has(base.course.id)).toBe(true);
      expect(summaries.has(course2.id)).toBe(false);
    });

    it("returns an empty map for an empty input", () => {
      expect(getRatingSummariesForCourses([]).size).toBe(0);
    });
  });
});
