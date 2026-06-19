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

// Import after the mock so the module picks up our test db.
import {
  getInstructorOverview,
  getRevenueTimeSeries,
  getCourseRevenueSummary,
  getLessonDropoffData,
  getQuizPerformanceData,
  getInstructorEarnings,
} from "./analyticsService";

// ─── Seed helpers ───

function makeStudent(email: string) {
  return testDb
    .insert(schema.users)
    .values({ name: email, email, role: schema.UserRole.Student })
    .returning()
    .get();
}

function makeInstructor(email: string) {
  return testDb
    .insert(schema.users)
    .values({ name: email, email, role: schema.UserRole.Instructor })
    .returning()
    .get();
}

function makeCourse(opts: {
  slug: string;
  instructorId?: number;
  status?: schema.CourseStatus;
}) {
  return testDb
    .insert(schema.courses)
    .values({
      title: opts.slug,
      slug: opts.slug,
      description: "A course",
      instructorId: opts.instructorId ?? base.instructor.id,
      categoryId: base.category.id,
      status: opts.status ?? schema.CourseStatus.Published,
    })
    .returning()
    .get();
}

function makePurchase(opts: {
  userId: number;
  courseId: number;
  pricePaid: number;
  country?: string | null;
  createdAt?: string;
}) {
  return testDb
    .insert(schema.purchases)
    .values({
      userId: opts.userId,
      courseId: opts.courseId,
      pricePaid: opts.pricePaid,
      country: opts.country ?? null,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    })
    .returning()
    .get();
}

function makeEnrollment(opts: {
  userId: number;
  courseId: number;
  enrolledAt?: string;
}) {
  return testDb
    .insert(schema.enrollments)
    .values({
      userId: opts.userId,
      courseId: opts.courseId,
      ...(opts.enrolledAt ? { enrolledAt: opts.enrolledAt } : {}),
    })
    .returning()
    .get();
}

function makeModule(opts: { courseId: number; position: number }) {
  return testDb
    .insert(schema.modules)
    .values({
      courseId: opts.courseId,
      title: `Module ${opts.position}`,
      position: opts.position,
    })
    .returning()
    .get();
}

function makeLesson(opts: { moduleId: number; position: number; title?: string }) {
  return testDb
    .insert(schema.lessons)
    .values({
      moduleId: opts.moduleId,
      title: opts.title ?? `Lesson ${opts.position}`,
      position: opts.position,
    })
    .returning()
    .get();
}

function completeLesson(opts: { userId: number; lessonId: number }) {
  return testDb
    .insert(schema.lessonProgress)
    .values({
      userId: opts.userId,
      lessonId: opts.lessonId,
      status: schema.LessonProgressStatus.Completed,
      completedAt: new Date().toISOString(),
    })
    .returning()
    .get();
}

function makeComment(opts: {
  userId: number;
  lessonId: number;
  deleted?: boolean;
}) {
  return testDb
    .insert(schema.lessonComments)
    .values({
      userId: opts.userId,
      lessonId: opts.lessonId,
      body: "A comment",
      ...(opts.deleted ? { deletedAt: new Date().toISOString() } : {}),
    })
    .returning()
    .get();
}

function makeQuiz(opts: { lessonId: number; title?: string }) {
  return testDb
    .insert(schema.quizzes)
    .values({
      lessonId: opts.lessonId,
      title: opts.title ?? "Quiz",
      passingScore: 0.7,
    })
    .returning()
    .get();
}

function makeAttempt(opts: {
  userId: number;
  quizId: number;
  score: number;
  passed: boolean;
}) {
  return testDb
    .insert(schema.quizAttempts)
    .values({
      userId: opts.userId,
      quizId: opts.quizId,
      score: opts.score,
      passed: opts.passed,
    })
    .returning()
    .get();
}

function makeRating(opts: { userId: number; courseId: number; rating: number }) {
  return testDb
    .insert(schema.courseRatings)
    .values({ userId: opts.userId, courseId: opts.courseId, rating: opts.rating })
    .returning()
    .get();
}

describe("analyticsService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("getInstructorOverview", () => {
    it("returns zeros and nulls when the instructor has no data", () => {
      const overview = getInstructorOverview(base.instructor.id, null);
      expect(overview).toEqual({
        totalRevenue: 0,
        totalSales: 0,
        totalStudents: 0,
        bestSellingCourse: null,
        averageRating: null,
      });
    });

    it("sums revenue and sales across multiple courses", () => {
      const course2 = makeCourse({ slug: "course-two" });
      const buyer = makeStudent("buyer@example.com");

      makePurchase({ userId: buyer.id, courseId: base.course.id, pricePaid: 1000 });
      makePurchase({ userId: buyer.id, courseId: course2.id, pricePaid: 2500 });

      const overview = getInstructorOverview(base.instructor.id, null);
      expect(overview.totalRevenue).toBe(3500);
      expect(overview.totalSales).toBe(2);
    });

    it("counts only distinct enrolled students", () => {
      const course2 = makeCourse({ slug: "course-two" });
      const s1 = makeStudent("s1@example.com");
      const s2 = makeStudent("s2@example.com");

      // s1 is enrolled in both courses but must count once.
      makeEnrollment({ userId: s1.id, courseId: base.course.id });
      makeEnrollment({ userId: s1.id, courseId: course2.id });
      makeEnrollment({ userId: s2.id, courseId: base.course.id });

      expect(getInstructorOverview(base.instructor.id, null).totalStudents).toBe(2);
    });

    it("identifies the best-selling course by revenue", () => {
      const course2 = makeCourse({ slug: "course-two" });
      const buyer = makeStudent("buyer@example.com");

      makePurchase({ userId: buyer.id, courseId: base.course.id, pricePaid: 1000 });
      makePurchase({ userId: buyer.id, courseId: course2.id, pricePaid: 9000 });

      expect(getInstructorOverview(base.instructor.id, null).bestSellingCourse).toBe(
        "course-two"
      );
    });

    it("averages ratings across the instructor's courses", () => {
      const s1 = makeStudent("s1@example.com");
      const s2 = makeStudent("s2@example.com");
      makeRating({ userId: s1.id, courseId: base.course.id, rating: 5 });
      makeRating({ userId: s2.id, courseId: base.course.id, rating: 3 });

      expect(getInstructorOverview(base.instructor.id, null).averageRating).toBeCloseTo(4);
    });

    it("excludes other instructors' courses", () => {
      const other = makeInstructor("other@example.com");
      const otherCourse = makeCourse({ slug: "other-course", instructorId: other.id });
      const buyer = makeStudent("buyer@example.com");

      makePurchase({ userId: buyer.id, courseId: base.course.id, pricePaid: 1000 });
      makePurchase({ userId: buyer.id, courseId: otherCourse.id, pricePaid: 5000 });
      makeEnrollment({ userId: buyer.id, courseId: otherCourse.id });

      const overview = getInstructorOverview(base.instructor.id, null);
      expect(overview.totalRevenue).toBe(1000);
      expect(overview.totalSales).toBe(1);
      expect(overview.totalStudents).toBe(0);
    });

    it("respects the since cutoff for revenue and students", () => {
      const buyer = makeStudent("buyer@example.com");
      makePurchase({
        userId: buyer.id,
        courseId: base.course.id,
        pricePaid: 1000,
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      makePurchase({
        userId: buyer.id,
        courseId: base.course.id,
        pricePaid: 4000,
        createdAt: "2026-06-01T00:00:00.000Z",
      });
      makeEnrollment({
        userId: buyer.id,
        courseId: base.course.id,
        enrolledAt: "2026-06-01T00:00:00.000Z",
      });
      const older = makeStudent("older@example.com");
      makeEnrollment({
        userId: older.id,
        courseId: base.course.id,
        enrolledAt: "2026-01-01T00:00:00.000Z",
      });

      const overview = getInstructorOverview(
        base.instructor.id,
        "2026-05-01T00:00:00.000Z"
      );
      expect(overview.totalRevenue).toBe(4000);
      expect(overview.totalSales).toBe(1);
      expect(overview.totalStudents).toBe(1);
    });
  });

  describe("getRevenueTimeSeries", () => {
    it("returns an empty array when there are no purchases", () => {
      expect(getRevenueTimeSeries(base.instructor.id, null)).toEqual([]);
    });

    it("groups same-day purchases into one point and orders ascending", () => {
      const buyer = makeStudent("buyer@example.com");
      makePurchase({
        userId: buyer.id,
        courseId: base.course.id,
        pricePaid: 1000,
        createdAt: "2026-03-10T08:00:00.000Z",
      });
      makePurchase({
        userId: buyer.id,
        courseId: base.course.id,
        pricePaid: 500,
        createdAt: "2026-03-10T20:00:00.000Z",
      });
      makePurchase({
        userId: buyer.id,
        courseId: base.course.id,
        pricePaid: 2000,
        createdAt: "2026-03-05T12:00:00.000Z",
      });

      const series = getRevenueTimeSeries(base.instructor.id, null);
      expect(series).toEqual([
        { date: "2026-03-05", revenue: 2000 },
        { date: "2026-03-10", revenue: 1500 },
      ]);
    });

    it("respects the since cutoff", () => {
      const buyer = makeStudent("buyer@example.com");
      makePurchase({
        userId: buyer.id,
        courseId: base.course.id,
        pricePaid: 1000,
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      makePurchase({
        userId: buyer.id,
        courseId: base.course.id,
        pricePaid: 2000,
        createdAt: "2026-06-10T00:00:00.000Z",
      });

      const series = getRevenueTimeSeries(base.instructor.id, "2026-05-01T00:00:00.000Z");
      expect(series).toEqual([{ date: "2026-06-10", revenue: 2000 }]);
    });
  });

  describe("getCourseRevenueSummary", () => {
    it("returns zeros for a course with no purchases", () => {
      expect(getCourseRevenueSummary(base.course.id, null)).toEqual({
        totalRevenue: 0,
        salesCount: 0,
        averageSalePrice: 0,
        revenueByCountry: [],
      });
    });

    it("computes total, count, and average sale price", () => {
      const b1 = makeStudent("b1@example.com");
      const b2 = makeStudent("b2@example.com");
      makePurchase({ userId: b1.id, courseId: base.course.id, pricePaid: 1000 });
      makePurchase({ userId: b2.id, courseId: base.course.id, pricePaid: 3000 });

      const summary = getCourseRevenueSummary(base.course.id, null);
      expect(summary.totalRevenue).toBe(4000);
      expect(summary.salesCount).toBe(2);
      expect(summary.averageSalePrice).toBe(2000);
    });

    it("ranks top-5 countries by revenue descending and labels null as Unknown", () => {
      const buyers = ["a", "b", "c", "d", "e", "f", "g"].map((n) =>
        makeStudent(`${n}@example.com`)
      );
      // Six countries plus a null; revenues chosen so US > FR > DE > IN > BR > CA,
      // and the null-country purchase is large enough to surface as "Unknown".
      makePurchase({ userId: buyers[0].id, courseId: base.course.id, pricePaid: 100, country: "CA" });
      makePurchase({ userId: buyers[1].id, courseId: base.course.id, pricePaid: 200, country: "BR" });
      makePurchase({ userId: buyers[2].id, courseId: base.course.id, pricePaid: 300, country: "IN" });
      makePurchase({ userId: buyers[3].id, courseId: base.course.id, pricePaid: 400, country: "DE" });
      makePurchase({ userId: buyers[4].id, courseId: base.course.id, pricePaid: 500, country: "FR" });
      makePurchase({ userId: buyers[5].id, courseId: base.course.id, pricePaid: 600, country: "US" });
      makePurchase({ userId: buyers[6].id, courseId: base.course.id, pricePaid: 450, country: null });

      const { revenueByCountry } = getCourseRevenueSummary(base.course.id, null);
      expect(revenueByCountry).toHaveLength(5);
      expect(revenueByCountry).toEqual([
        { country: "US", revenue: 600 },
        { country: "FR", revenue: 500 },
        { country: "Unknown", revenue: 450 },
        { country: "DE", revenue: 400 },
        { country: "IN", revenue: 300 },
      ]);
    });

    it("respects the since cutoff", () => {
      const buyer = makeStudent("buyer@example.com");
      makePurchase({
        userId: buyer.id,
        courseId: base.course.id,
        pricePaid: 1000,
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      makePurchase({
        userId: buyer.id,
        courseId: base.course.id,
        pricePaid: 4000,
        createdAt: "2026-06-01T00:00:00.000Z",
      });

      const summary = getCourseRevenueSummary(base.course.id, "2026-05-01T00:00:00.000Z");
      expect(summary.totalRevenue).toBe(4000);
      expect(summary.salesCount).toBe(1);
    });
  });

  describe("getLessonDropoffData", () => {
    it("returns an empty array for a course with no lessons", () => {
      expect(getLessonDropoffData(base.course.id)).toEqual([]);
    });

    it("orders lessons by module then lesson position", () => {
      const m1 = makeModule({ courseId: base.course.id, position: 1 });
      const m2 = makeModule({ courseId: base.course.id, position: 2 });
      const l1 = makeLesson({ moduleId: m1.id, position: 1, title: "m1-l1" });
      const l2 = makeLesson({ moduleId: m1.id, position: 2, title: "m1-l2" });
      const l3 = makeLesson({ moduleId: m2.id, position: 1, title: "m2-l1" });

      const data = getLessonDropoffData(base.course.id);
      expect(data.map((d) => d.title)).toEqual(["m1-l1", "m1-l2", "m2-l1"]);
      expect(data.map((d) => d.lessonId)).toEqual([l1.id, l2.id, l3.id]);
    });

    it("computes completion percentage against enrolled student count", () => {
      const s1 = makeStudent("s1@example.com");
      const s2 = makeStudent("s2@example.com");
      const s3 = makeStudent("s3@example.com");
      const s4 = makeStudent("s4@example.com");
      [s1, s2, s3, s4].forEach((s) =>
        makeEnrollment({ userId: s.id, courseId: base.course.id })
      );

      const m1 = makeModule({ courseId: base.course.id, position: 1 });
      const lesson = makeLesson({ moduleId: m1.id, position: 1 });
      const empty = makeLesson({ moduleId: m1.id, position: 2 });

      // 3 of 4 enrolled students completed the first lesson → 75%.
      completeLesson({ userId: s1.id, lessonId: lesson.id });
      completeLesson({ userId: s2.id, lessonId: lesson.id });
      completeLesson({ userId: s3.id, lessonId: lesson.id });

      const data = getLessonDropoffData(base.course.id);
      expect(data.find((d) => d.lessonId === lesson.id)?.completionPct).toBe(75);
      expect(data.find((d) => d.lessonId === empty.id)?.completionPct).toBe(0);
    });

    it("counts non-deleted comments per lesson", () => {
      const author = makeStudent("author@example.com");
      const m1 = makeModule({ courseId: base.course.id, position: 1 });
      const lesson = makeLesson({ moduleId: m1.id, position: 1 });

      makeComment({ userId: author.id, lessonId: lesson.id });
      makeComment({ userId: author.id, lessonId: lesson.id });
      makeComment({ userId: author.id, lessonId: lesson.id, deleted: true });

      const data = getLessonDropoffData(base.course.id);
      expect(data[0].commentCount).toBe(2);
    });
  });

  describe("getQuizPerformanceData", () => {
    it("returns an empty array for a course with no quizzes", () => {
      expect(getQuizPerformanceData(base.course.id)).toEqual([]);
    });

    it("computes pass rate and average score across all attempts", () => {
      const m1 = makeModule({ courseId: base.course.id, position: 1 });
      const lesson = makeLesson({ moduleId: m1.id, position: 1 });
      const quiz = makeQuiz({ lessonId: lesson.id, title: "Quiz A" });
      const s1 = makeStudent("s1@example.com");
      const s2 = makeStudent("s2@example.com");

      // Scores 0.8, 0.6, 1.0 → avg 0.8 → 80; 2 of 3 passed → 66.67%.
      makeAttempt({ userId: s1.id, quizId: quiz.id, score: 0.8, passed: true });
      makeAttempt({ userId: s2.id, quizId: quiz.id, score: 0.6, passed: false });
      makeAttempt({ userId: s1.id, quizId: quiz.id, score: 1.0, passed: true });

      const [perf] = getQuizPerformanceData(base.course.id);
      expect(perf.title).toBe("Quiz A");
      expect(perf.averageScore).toBeCloseTo(80);
      expect(perf.passRate).toBeCloseTo((2 / 3) * 100);
    });

    it("returns 0 pass rate and 0 average score for a quiz with no attempts", () => {
      const m1 = makeModule({ courseId: base.course.id, position: 1 });
      const lesson = makeLesson({ moduleId: m1.id, position: 1 });
      makeQuiz({ lessonId: lesson.id, title: "Untouched" });

      const [perf] = getQuizPerformanceData(base.course.id);
      expect(perf.passRate).toBe(0);
      expect(perf.averageScore).toBe(0);
    });
  });

  describe("getInstructorEarnings", () => {
    // Fixed reference point so the 30/90/180-day cutoffs are deterministic.
    const now = new Date("2026-06-19T00:00:00.000Z");

    it("returns zeroed windows when the instructor has no purchases", () => {
      expect(getInstructorEarnings(base.instructor.id, now)).toEqual({
        allTime: { earnings: 0, paidPurchases: 0 },
        last30Days: { earnings: 0, paidPurchases: 0 },
        last90Days: { earnings: 0, paidPurchases: 0 },
        last180Days: { earnings: 0, paidPurchases: 0 },
      });
    });

    it("buckets purchases into the four nested windows", () => {
      const buyer = makeStudent("buyer@example.com");
      // 9 days ago → in all four windows.
      makePurchase({
        userId: buyer.id,
        courseId: base.course.id,
        pricePaid: 1000,
        createdAt: "2026-06-10T00:00:00.000Z",
      });
      // ~65 days ago → in 90/180/all, not 30.
      makePurchase({
        userId: buyer.id,
        courseId: base.course.id,
        pricePaid: 2000,
        createdAt: "2026-04-15T00:00:00.000Z",
      });
      // ~155 days ago → in 180/all, not 30/90.
      makePurchase({
        userId: buyer.id,
        courseId: base.course.id,
        pricePaid: 4000,
        createdAt: "2026-01-15T00:00:00.000Z",
      });
      // Over a year ago → all-time only.
      makePurchase({
        userId: buyer.id,
        courseId: base.course.id,
        pricePaid: 8000,
        createdAt: "2025-06-01T00:00:00.000Z",
      });

      expect(getInstructorEarnings(base.instructor.id, now)).toEqual({
        allTime: { earnings: 15000, paidPurchases: 4 },
        last30Days: { earnings: 1000, paidPurchases: 1 },
        last90Days: { earnings: 3000, paidPurchases: 2 },
        last180Days: { earnings: 7000, paidPurchases: 3 },
      });
    });

    it("treats the window cutoff as inclusive at the boundary", () => {
      const buyer = makeStudent("buyer@example.com");
      const cutoff30 = new Date(now);
      cutoff30.setUTCDate(cutoff30.getUTCDate() - 30);
      const onBoundary = cutoff30.toISOString();
      const justBefore = new Date(cutoff30.getTime() - 1).toISOString();

      makePurchase({
        userId: buyer.id,
        courseId: base.course.id,
        pricePaid: 500,
        createdAt: onBoundary,
      });
      makePurchase({
        userId: buyer.id,
        courseId: base.course.id,
        pricePaid: 700,
        createdAt: justBefore,
      });

      const earnings = getInstructorEarnings(base.instructor.id, now);
      // The boundary purchase counts in the 30-day window; the one a millisecond
      // earlier falls just outside it but still inside 90/180/all.
      expect(earnings.last30Days).toEqual({ earnings: 500, paidPurchases: 1 });
      expect(earnings.last90Days).toEqual({ earnings: 1200, paidPurchases: 2 });
    });

    it("sums only purchases — enrollments without a purchase contribute nothing", () => {
      const buyer = makeStudent("buyer@example.com");
      const freeloader = makeStudent("free@example.com");
      makePurchase({
        userId: buyer.id,
        courseId: base.course.id,
        pricePaid: 2500,
        createdAt: "2026-06-10T00:00:00.000Z",
      });
      // Coupon/free/seeded enrollment: enrolled, but no purchase row.
      makeEnrollment({ userId: freeloader.id, courseId: base.course.id });

      const earnings = getInstructorEarnings(base.instructor.id, now);
      expect(earnings.allTime).toEqual({ earnings: 2500, paidPurchases: 1 });
    });

    it("scopes earnings to the instructor's own courses", () => {
      const other = makeInstructor("other@example.com");
      const otherCourse = makeCourse({
        slug: "other-course",
        instructorId: other.id,
      });
      const buyer = makeStudent("buyer@example.com");
      makePurchase({
        userId: buyer.id,
        courseId: base.course.id,
        pricePaid: 1000,
        createdAt: "2026-06-10T00:00:00.000Z",
      });
      makePurchase({
        userId: buyer.id,
        courseId: otherCourse.id,
        pricePaid: 9999,
        createdAt: "2026-06-10T00:00:00.000Z",
      });

      const earnings = getInstructorEarnings(base.instructor.id, now);
      expect(earnings.allTime).toEqual({ earnings: 1000, paidPurchases: 1 });
    });

    it("counts archived courses that earned money toward lifetime earnings", () => {
      const archived = makeCourse({
        slug: "archived-course",
        status: schema.CourseStatus.Archived,
      });
      const buyer = makeStudent("buyer@example.com");
      makePurchase({
        userId: buyer.id,
        courseId: archived.id,
        pricePaid: 3000,
        createdAt: "2026-06-10T00:00:00.000Z",
      });

      expect(getInstructorEarnings(base.instructor.id, now).allTime).toEqual({
        earnings: 3000,
        paidPurchases: 1,
      });
    });
  });
});
