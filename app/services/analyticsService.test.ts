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
  getInstructorStudents,
  getInstructorCompletion,
  getInstructorAverageQuizScore,
  getCourseQuizDistributions,
  getQuizTimingHeatmap,
  ANALYTICS_TIMEZONE,
  ALL_COURSES_FILTER,
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
  completedAt?: string;
}) {
  return testDb
    .insert(schema.enrollments)
    .values({
      userId: opts.userId,
      courseId: opts.courseId,
      ...(opts.enrolledAt ? { enrolledAt: opts.enrolledAt } : {}),
      ...(opts.completedAt ? { completedAt: opts.completedAt } : {}),
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
  attemptedAt?: string;
}) {
  return testDb
    .insert(schema.quizAttempts)
    .values({
      userId: opts.userId,
      quizId: opts.quizId,
      score: opts.score,
      passed: opts.passed,
      ...(opts.attemptedAt ? { attemptedAt: opts.attemptedAt } : {}),
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
      expect(getInstructorEarnings(base.instructor.id, ALL_COURSES_FILTER, now)).toEqual({
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

      expect(getInstructorEarnings(base.instructor.id, ALL_COURSES_FILTER, now)).toEqual({
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

      const earnings = getInstructorEarnings(base.instructor.id, ALL_COURSES_FILTER, now);
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

      const earnings = getInstructorEarnings(base.instructor.id, ALL_COURSES_FILTER, now);
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

      const earnings = getInstructorEarnings(base.instructor.id, ALL_COURSES_FILTER, now);
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

      expect(getInstructorEarnings(base.instructor.id, ALL_COURSES_FILTER, now).allTime).toEqual({
        earnings: 3000,
        paidPurchases: 1,
      });
    });
  });

  describe("getInstructorStudents", () => {
    // Fixed reference point so the 30/90/180-day cutoffs are deterministic.
    const now = new Date("2026-06-19T00:00:00.000Z");

    it("returns zeros when the instructor has no enrollments", () => {
      expect(getInstructorStudents(base.instructor.id, ALL_COURSES_FILTER, now)).toEqual({
        totalStudents: 0,
        newLast30Days: 0,
        newLast90Days: 0,
        newLast180Days: 0,
      });
    });

    it("counts all enrollments regardless of a purchase", () => {
      const buyer = makeStudent("buyer@example.com");
      const freeloader = makeStudent("free@example.com");
      makePurchase({
        userId: buyer.id,
        courseId: base.course.id,
        pricePaid: 2500,
      });
      makeEnrollment({ userId: buyer.id, courseId: base.course.id });
      // Coupon/free/seeded enrollment: enrolled, but no purchase row.
      makeEnrollment({ userId: freeloader.id, courseId: base.course.id });

      expect(getInstructorStudents(base.instructor.id, ALL_COURSES_FILTER, now).totalStudents).toBe(2);
    });

    it("counts each student once across multiple courses", () => {
      const course2 = makeCourse({ slug: "course-two" });
      const s1 = makeStudent("s1@example.com");
      const s2 = makeStudent("s2@example.com");

      // s1 is enrolled in both courses but must count once toward total reach.
      makeEnrollment({ userId: s1.id, courseId: base.course.id });
      makeEnrollment({ userId: s1.id, courseId: course2.id });
      makeEnrollment({ userId: s2.id, courseId: base.course.id });

      expect(getInstructorStudents(base.instructor.id, ALL_COURSES_FILTER, now).totalStudents).toBe(2);
    });

    it("buckets new enrollments into the three nested windows", () => {
      const s = ["a", "b", "c", "d"].map((n) => makeStudent(`${n}@example.com`));
      // 9 days ago → counts in 30/90/180.
      makeEnrollment({
        userId: s[0].id,
        courseId: base.course.id,
        enrolledAt: "2026-06-10T00:00:00.000Z",
      });
      // ~65 days ago → counts in 90/180, not 30.
      makeEnrollment({
        userId: s[1].id,
        courseId: base.course.id,
        enrolledAt: "2026-04-15T00:00:00.000Z",
      });
      // ~155 days ago → counts in 180, not 30/90.
      makeEnrollment({
        userId: s[2].id,
        courseId: base.course.id,
        enrolledAt: "2026-01-15T00:00:00.000Z",
      });
      // Over a year ago → counts only toward the total.
      makeEnrollment({
        userId: s[3].id,
        courseId: base.course.id,
        enrolledAt: "2025-06-01T00:00:00.000Z",
      });

      expect(getInstructorStudents(base.instructor.id, ALL_COURSES_FILTER, now)).toEqual({
        totalStudents: 4,
        newLast30Days: 1,
        newLast90Days: 2,
        newLast180Days: 3,
      });
    });

    it("treats the window cutoff as inclusive at the boundary", () => {
      const onTime = makeStudent("ontime@example.com");
      const justBeforeUser = makeStudent("before@example.com");
      const cutoff30 = new Date(now);
      cutoff30.setUTCDate(cutoff30.getUTCDate() - 30);
      const onBoundary = cutoff30.toISOString();
      const justBefore = new Date(cutoff30.getTime() - 1).toISOString();

      makeEnrollment({
        userId: onTime.id,
        courseId: base.course.id,
        enrolledAt: onBoundary,
      });
      makeEnrollment({
        userId: justBeforeUser.id,
        courseId: base.course.id,
        enrolledAt: justBefore,
      });

      const students = getInstructorStudents(base.instructor.id, ALL_COURSES_FILTER, now);
      // The boundary enrollment counts in the 30-day window; the one a millisecond
      // earlier falls just outside it but still inside 90/180.
      expect(students.newLast30Days).toBe(1);
      expect(students.newLast90Days).toBe(2);
    });

    it("counts each enrollment, so one student enrolling twice counts twice", () => {
      const course2 = makeCourse({ slug: "course-two" });
      const s1 = makeStudent("s1@example.com");

      makeEnrollment({
        userId: s1.id,
        courseId: base.course.id,
        enrolledAt: "2026-06-10T00:00:00.000Z",
      });
      makeEnrollment({
        userId: s1.id,
        courseId: course2.id,
        enrolledAt: "2026-06-12T00:00:00.000Z",
      });

      const students = getInstructorStudents(base.instructor.id, ALL_COURSES_FILTER, now);
      // One distinct student, but two new enrollments this month.
      expect(students.totalStudents).toBe(1);
      expect(students.newLast30Days).toBe(2);
    });

    it("scopes counts to the instructor's own courses", () => {
      const other = makeInstructor("other@example.com");
      const otherCourse = makeCourse({
        slug: "other-course",
        instructorId: other.id,
      });
      const mine = makeStudent("mine@example.com");
      const theirs = makeStudent("theirs@example.com");

      makeEnrollment({
        userId: mine.id,
        courseId: base.course.id,
        enrolledAt: "2026-06-10T00:00:00.000Z",
      });
      makeEnrollment({
        userId: theirs.id,
        courseId: otherCourse.id,
        enrolledAt: "2026-06-10T00:00:00.000Z",
      });

      expect(getInstructorStudents(base.instructor.id, ALL_COURSES_FILTER, now)).toEqual({
        totalStudents: 1,
        newLast30Days: 1,
        newLast90Days: 1,
        newLast180Days: 1,
      });
    });
  });

  describe("getInstructorCompletion", () => {
    it("returns zeros when the instructor has no enrollments", () => {
      expect(getInstructorCompletion(base.instructor.id)).toEqual({
        officialCompletions: 0,
        reached100: 0,
      });
    });

    it("counts enrollments with a completion timestamp as official completions", () => {
      const s1 = makeStudent("s1@example.com");
      const s2 = makeStudent("s2@example.com");
      makeEnrollment({
        userId: s1.id,
        courseId: base.course.id,
        completedAt: "2026-06-01T00:00:00.000Z",
      });
      // Enrolled but never officially completed.
      makeEnrollment({ userId: s2.id, courseId: base.course.id });

      expect(getInstructorCompletion(base.instructor.id).officialCompletions).toBe(1);
    });

    it("counts an enrollment as reached-100% when completed lessons equal total lessons", () => {
      const m1 = makeModule({ courseId: base.course.id, position: 1 });
      const l1 = makeLesson({ moduleId: m1.id, position: 1 });
      const l2 = makeLesson({ moduleId: m1.id, position: 2 });
      const finisher = makeStudent("finisher@example.com");
      const partial = makeStudent("partial@example.com");

      makeEnrollment({ userId: finisher.id, courseId: base.course.id });
      makeEnrollment({ userId: partial.id, courseId: base.course.id });

      // finisher completed both lessons; partial completed only one.
      completeLesson({ userId: finisher.id, lessonId: l1.id });
      completeLesson({ userId: finisher.id, lessonId: l2.id });
      completeLesson({ userId: partial.id, lessonId: l1.id });

      expect(getInstructorCompletion(base.instructor.id).reached100).toBe(1);
    });

    it("computes official and reached-100% independently when the two disagree", () => {
      const m1 = makeModule({ courseId: base.course.id, position: 1 });
      const l1 = makeLesson({ moduleId: m1.id, position: 1 });
      const l2 = makeLesson({ moduleId: m1.id, position: 2 });

      // Marked complete but only finished one of two lessons (official, not 100%).
      const marked = makeStudent("marked@example.com");
      makeEnrollment({
        userId: marked.id,
        courseId: base.course.id,
        completedAt: "2026-06-01T00:00:00.000Z",
      });
      completeLesson({ userId: marked.id, lessonId: l1.id });

      // Finished every lesson but was never officially marked (100%, not official).
      const finisher = makeStudent("finisher@example.com");
      makeEnrollment({ userId: finisher.id, courseId: base.course.id });
      completeLesson({ userId: finisher.id, lessonId: l1.id });
      completeLesson({ userId: finisher.id, lessonId: l2.id });

      expect(getInstructorCompletion(base.instructor.id)).toEqual({
        officialCompletions: 1,
        reached100: 1,
      });
    });

    it("excludes courses with no lessons from reached-100%", () => {
      // base.course has no lessons; a completed-lesson count of 0 must not be
      // treated as having reached 100%.
      const s1 = makeStudent("s1@example.com");
      makeEnrollment({ userId: s1.id, courseId: base.course.id });

      expect(getInstructorCompletion(base.instructor.id).reached100).toBe(0);
    });

    it("scopes counts to the instructor's own courses", () => {
      const other = makeInstructor("other@example.com");
      const otherCourse = makeCourse({
        slug: "other-course",
        instructorId: other.id,
      });
      const theirs = makeStudent("theirs@example.com");
      makeEnrollment({
        userId: theirs.id,
        courseId: otherCourse.id,
        completedAt: "2026-06-01T00:00:00.000Z",
      });

      expect(getInstructorCompletion(base.instructor.id)).toEqual({
        officialCompletions: 0,
        reached100: 0,
      });
    });
  });

  describe("getInstructorAverageQuizScore", () => {
    it("returns null when the instructor has no quiz attempts", () => {
      expect(getInstructorAverageQuizScore(base.instructor.id)).toBeNull();
    });

    it("averages every attempt across the instructor's quizzes (0–100)", () => {
      const m1 = makeModule({ courseId: base.course.id, position: 1 });
      const l1 = makeLesson({ moduleId: m1.id, position: 1 });
      const l2 = makeLesson({ moduleId: m1.id, position: 2 });
      const quizA = makeQuiz({ lessonId: l1.id, title: "Quiz A" });
      const quizB = makeQuiz({ lessonId: l2.id, title: "Quiz B" });
      const s1 = makeStudent("s1@example.com");
      const s2 = makeStudent("s2@example.com");

      // Scores 0.8, 0.6, 1.0, 0.4 across two quizzes and two students → avg 0.7.
      makeAttempt({ userId: s1.id, quizId: quizA.id, score: 0.8, passed: true });
      makeAttempt({ userId: s2.id, quizId: quizA.id, score: 0.6, passed: false });
      makeAttempt({ userId: s1.id, quizId: quizB.id, score: 1.0, passed: true });
      makeAttempt({ userId: s2.id, quizId: quizB.id, score: 0.4, passed: false });

      expect(getInstructorAverageQuizScore(base.instructor.id)).toBeCloseTo(70);
    });

    it("excludes attempts on other instructors' courses", () => {
      const other = makeInstructor("other@example.com");
      const otherCourse = makeCourse({
        slug: "other-course",
        instructorId: other.id,
      });
      const otherModule = makeModule({ courseId: otherCourse.id, position: 1 });
      const otherLesson = makeLesson({ moduleId: otherModule.id, position: 1 });
      const otherQuiz = makeQuiz({ lessonId: otherLesson.id, title: "Other Quiz" });

      const mine = makeModule({ courseId: base.course.id, position: 1 });
      const myLesson = makeLesson({ moduleId: mine.id, position: 1 });
      const myQuiz = makeQuiz({ lessonId: myLesson.id, title: "My Quiz" });

      const student = makeStudent("student@example.com");
      makeAttempt({ userId: student.id, quizId: myQuiz.id, score: 0.5, passed: false });
      // A perfect score on another instructor's quiz must not skew my average.
      makeAttempt({ userId: student.id, quizId: otherQuiz.id, score: 1.0, passed: true });

      expect(getInstructorAverageQuizScore(base.instructor.id)).toBeCloseTo(50);
    });
  });

  describe("dashboard filter scoping", () => {
    // Fixed reference point for the windowed (earnings/students) aggregates.
    const now = new Date("2026-06-19T00:00:00.000Z");
    const recent = "2026-06-10T00:00:00.000Z";

    it("earnings narrow to the selected course statuses", () => {
      // base.course is Published; add a Draft course, each with one purchase.
      const draft = makeCourse({
        slug: "draft-course",
        status: schema.CourseStatus.Draft,
      });
      const buyer = makeStudent("buyer@example.com");
      makePurchase({
        userId: buyer.id,
        courseId: base.course.id,
        pricePaid: 1000,
        createdAt: recent,
      });
      makePurchase({
        userId: buyer.id,
        courseId: draft.id,
        pricePaid: 5000,
        createdAt: recent,
      });

      const publishedOnly = getInstructorEarnings(
        base.instructor.id,
        { statuses: [schema.CourseStatus.Published], courseId: null },
        now
      );
      expect(publishedOnly.allTime).toEqual({ earnings: 1000, paidPurchases: 1 });

      // No status narrowing → both courses count.
      expect(
        getInstructorEarnings(base.instructor.id, ALL_COURSES_FILTER, now).allTime
      ).toEqual({ earnings: 6000, paidPurchases: 2 });
    });

    it("earnings narrow to a single selected course", () => {
      const course2 = makeCourse({ slug: "course-two" });
      const buyer = makeStudent("buyer@example.com");
      makePurchase({
        userId: buyer.id,
        courseId: base.course.id,
        pricePaid: 1000,
        createdAt: recent,
      });
      makePurchase({
        userId: buyer.id,
        courseId: course2.id,
        pricePaid: 4000,
        createdAt: recent,
      });

      const onlyCourse2 = getInstructorEarnings(
        base.instructor.id,
        { statuses: [], courseId: course2.id },
        now
      );
      expect(onlyCourse2.allTime).toEqual({ earnings: 4000, paidPurchases: 1 });
    });

    it("students narrow to the selected course statuses", () => {
      const draft = makeCourse({
        slug: "draft-course",
        status: schema.CourseStatus.Draft,
      });
      const s1 = makeStudent("s1@example.com");
      const s2 = makeStudent("s2@example.com");
      makeEnrollment({ userId: s1.id, courseId: base.course.id, enrolledAt: recent });
      makeEnrollment({ userId: s2.id, courseId: draft.id, enrolledAt: recent });

      const publishedOnly = getInstructorStudents(
        base.instructor.id,
        { statuses: [schema.CourseStatus.Published], courseId: null },
        now
      );
      expect(publishedOnly.totalStudents).toBe(1);
      expect(publishedOnly.newLast30Days).toBe(1);
    });

    it("completion narrows to a single selected course", () => {
      const course2 = makeCourse({ slug: "course-two" });
      const s1 = makeStudent("s1@example.com");
      const s2 = makeStudent("s2@example.com");
      makeEnrollment({
        userId: s1.id,
        courseId: base.course.id,
        completedAt: "2026-06-01T00:00:00.000Z",
      });
      makeEnrollment({
        userId: s2.id,
        courseId: course2.id,
        completedAt: "2026-06-01T00:00:00.000Z",
      });

      const onlyBase = getInstructorCompletion(base.instructor.id, {
        statuses: [],
        courseId: base.course.id,
      });
      expect(onlyBase.officialCompletions).toBe(1);
    });

    it("average quiz score narrows to the selected course statuses", () => {
      const draft = makeCourse({
        slug: "draft-course",
        status: schema.CourseStatus.Draft,
      });
      const pubModule = makeModule({ courseId: base.course.id, position: 1 });
      const pubLesson = makeLesson({ moduleId: pubModule.id, position: 1 });
      const pubQuiz = makeQuiz({ lessonId: pubLesson.id, title: "Published Quiz" });
      const draftModule = makeModule({ courseId: draft.id, position: 1 });
      const draftLesson = makeLesson({ moduleId: draftModule.id, position: 1 });
      const draftQuiz = makeQuiz({ lessonId: draftLesson.id, title: "Draft Quiz" });
      const student = makeStudent("student@example.com");

      makeAttempt({ userId: student.id, quizId: pubQuiz.id, score: 0.5, passed: false });
      // A perfect score on the draft course must not skew the published-only view.
      makeAttempt({ userId: student.id, quizId: draftQuiz.id, score: 1.0, passed: true });

      const publishedOnly = getInstructorAverageQuizScore(base.instructor.id, {
        statuses: [schema.CourseStatus.Published],
        courseId: null,
      });
      expect(publishedOnly).toBeCloseTo(50);
    });
  });

  describe("getCourseQuizDistributions", () => {
    it("returns an empty array when there is no quiz data in scope", () => {
      expect(getCourseQuizDistributions(base.instructor.id)).toEqual([]);
    });

    it("reduces to first/last/best per student per quiz and buckets them", () => {
      const m1 = makeModule({ courseId: base.course.id, position: 1 });
      const lesson = makeLesson({ moduleId: m1.id, position: 1 });
      const quiz = makeQuiz({ lessonId: lesson.id, title: "Quiz A" });
      const a = makeStudent("a@example.com");
      const b = makeStudent("b@example.com");

      // Student A: first 0.5 (→50, bucket 0), best 0.9 (→90, bucket 4),
      // last 0.7 (→70, bucket 2).
      makeAttempt({ userId: a.id, quizId: quiz.id, score: 0.5, passed: false, attemptedAt: "2026-01-01T00:00:00.000Z" });
      makeAttempt({ userId: a.id, quizId: quiz.id, score: 0.9, passed: true, attemptedAt: "2026-01-02T00:00:00.000Z" });
      makeAttempt({ userId: a.id, quizId: quiz.id, score: 0.7, passed: true, attemptedAt: "2026-01-03T00:00:00.000Z" });
      // Student B: first 0.65 (→65, bucket 1), last 0.6 (→60, bucket 1),
      // best 0.65 (bucket 1).
      makeAttempt({ userId: b.id, quizId: quiz.id, score: 0.65, passed: false, attemptedAt: "2026-01-01T00:00:00.000Z" });
      makeAttempt({ userId: b.id, quizId: quiz.id, score: 0.6, passed: false, attemptedAt: "2026-01-02T00:00:00.000Z" });

      const [dist] = getCourseQuizDistributions(base.instructor.id);
      expect(dist.courseId).toBe(base.course.id);
      expect(dist.responseCount).toBe(2);
      expect(dist.buckets.map((b) => b.range)).toEqual([
        "0–59",
        "60–69",
        "70–79",
        "80–89",
        "90–100",
      ]);
      expect(dist.buckets.map((b) => b.first)).toEqual([1, 1, 0, 0, 0]);
      expect(dist.buckets.map((b) => b.last)).toEqual([0, 1, 1, 0, 0]);
      expect(dist.buckets.map((b) => b.best)).toEqual([0, 1, 0, 0, 1]);
    });

    it("places boundary scores in the expected buckets", () => {
      const m1 = makeModule({ courseId: base.course.id, position: 1 });
      const student = makeStudent("s@example.com");
      // One single-attempt quiz per boundary score, so first = last = best.
      const scores = [0.0, 0.59, 0.6, 0.7, 0.8, 0.9, 1.0];
      scores.forEach((score, i) => {
        const lesson = makeLesson({ moduleId: m1.id, position: i + 1 });
        const quiz = makeQuiz({ lessonId: lesson.id, title: `Quiz ${i}` });
        makeAttempt({ userId: student.id, quizId: quiz.id, score, passed: score >= 0.7 });
      });

      const [dist] = getCourseQuizDistributions(base.instructor.id);
      // 0.0 and 0.59 → 0–59; 0.6 → 60–69; 0.7 → 70–79; 0.8 → 80–89;
      // 0.9 and 1.0 → 90–100.
      expect(dist.buckets.map((b) => b.best)).toEqual([2, 1, 1, 1, 2]);
      expect(dist.responseCount).toBe(7);
    });

    it("scopes to a single selected course", () => {
      const course2 = makeCourse({ slug: "course-two" });
      const student = makeStudent("s@example.com");
      for (const course of [base.course, course2]) {
        const m = makeModule({ courseId: course.id, position: 1 });
        const lesson = makeLesson({ moduleId: m.id, position: 1 });
        const quiz = makeQuiz({ lessonId: lesson.id });
        makeAttempt({ userId: student.id, quizId: quiz.id, score: 0.8, passed: true });
      }

      const onlyCourse2 = getCourseQuizDistributions(base.instructor.id, {
        statuses: [],
        courseId: course2.id,
      });
      expect(onlyCourse2).toHaveLength(1);
      expect(onlyCourse2[0].courseId).toBe(course2.id);
    });

    it("returns one entry per in-scope course with quiz data", () => {
      const course2 = makeCourse({ slug: "course-two" });
      const empty = makeCourse({ slug: "empty-course" });
      const student = makeStudent("s@example.com");
      for (const course of [base.course, course2]) {
        const m = makeModule({ courseId: course.id, position: 1 });
        const lesson = makeLesson({ moduleId: m.id, position: 1 });
        const quiz = makeQuiz({ lessonId: lesson.id });
        makeAttempt({ userId: student.id, quizId: quiz.id, score: 0.75, passed: true });
      }

      const dists = getCourseQuizDistributions(base.instructor.id);
      // `empty` has no quizzes/attempts, so it is omitted.
      expect(dists.map((d) => d.courseId)).toEqual([base.course.id, course2.id]);
      expect(dists.every((d) => d.courseId !== empty.id)).toBe(true);
    });
  });

  describe("getQuizTimingHeatmap", () => {
    // Set up one quiz on base.course and return its id, for attaching attempts.
    function seedQuiz(courseId: number) {
      const m = makeModule({ courseId, position: 1 });
      const lesson = makeLesson({ moduleId: m.id, position: 1 });
      return makeQuiz({ lessonId: lesson.id }).id;
    }

    it("uses America/New_York as the single analytics timezone", () => {
      expect(ANALYTICS_TIMEZONE).toBe("America/New_York");
    });

    it("returns an all-zero 7x24 grid when there are no in-scope attempts", () => {
      const heatmap = getQuizTimingHeatmap(base.instructor.id);
      expect(heatmap.totalAttempts).toBe(0);
      expect(heatmap.grid).toHaveLength(7);
      expect(heatmap.grid.every((row) => row.length === 24)).toBe(true);
      expect(heatmap.grid.flat().every((count) => count === 0)).toBe(true);
    });

    it("buckets timestamps by day/hour in the fixed timezone, DST-aware and across the date boundary", () => {
      const quizId = seedQuiz(base.course.id);
      const student = makeStudent("s@example.com");

      // 2026-06-15 02:00 UTC → in EDT (UTC-4, summer) this is 2026-06-14 22:00,
      // i.e. the *previous* calendar day: Sunday (day 0), hour 22.
      makeAttempt({
        userId: student.id,
        quizId,
        score: 0.8,
        passed: true,
        attemptedAt: "2026-06-15T02:00:00.000Z",
      });
      // 2026-07-01 12:00 UTC → inside DST (EDT, UTC-4) → 08:00 Wednesday (day 3).
      makeAttempt({
        userId: student.id,
        quizId,
        score: 0.8,
        passed: true,
        attemptedAt: "2026-07-01T12:00:00.000Z",
      });
      // 2026-01-15 12:00 UTC → outside DST (EST, UTC-5) → 07:00 Thursday (day 4).
      makeAttempt({
        userId: student.id,
        quizId,
        score: 0.8,
        passed: true,
        attemptedAt: "2026-01-15T12:00:00.000Z",
      });

      const { grid, totalAttempts } = getQuizTimingHeatmap(base.instructor.id);
      expect(totalAttempts).toBe(3);
      expect(grid[0][22]).toBe(1); // Sunday 22:00 (date-boundary crossing)
      expect(grid[3][8]).toBe(1); // Wednesday 08:00 (EDT, DST)
      expect(grid[4][7]).toBe(1); // Thursday 07:00 (EST, no DST)
      // Every other cell is empty.
      expect(grid.flat().reduce((sum, n) => sum + n, 0)).toBe(3);
    });

    it("aggregates across the instructor's courses but re-scopes to one course via the filter", () => {
      const course2 = makeCourse({ slug: "course-two" });
      const quiz1 = seedQuiz(base.course.id);
      const quiz2 = seedQuiz(course2.id);
      const student = makeStudent("s@example.com");

      // Both attempts land on the same cell so scoping is the only difference:
      // 2026-07-01 12:00 UTC → Wednesday (day 3) 08:00 EDT.
      makeAttempt({
        userId: student.id,
        quizId: quiz1,
        score: 0.8,
        passed: true,
        attemptedAt: "2026-07-01T12:00:00.000Z",
      });
      makeAttempt({
        userId: student.id,
        quizId: quiz2,
        score: 0.8,
        passed: true,
        attemptedAt: "2026-07-01T12:00:00.000Z",
      });

      // Default: aggregate across both courses.
      const all = getQuizTimingHeatmap(base.instructor.id);
      expect(all.totalAttempts).toBe(2);
      expect(all.grid[3][8]).toBe(2);

      // Filtered to a single course: only that course's attempt counts.
      const onlyCourse2 = getQuizTimingHeatmap(base.instructor.id, {
        statuses: [],
        courseId: course2.id,
      });
      expect(onlyCourse2.totalAttempts).toBe(1);
      expect(onlyCourse2.grid[3][8]).toBe(1);
    });

    it("excludes attempts on other instructors' courses", () => {
      const other = makeInstructor("other@example.com");
      const otherCourse = makeCourse({
        slug: "other-course",
        instructorId: other.id,
      });
      const otherQuiz = seedQuiz(otherCourse.id);
      const student = makeStudent("s@example.com");
      makeAttempt({
        userId: student.id,
        quizId: otherQuiz,
        score: 0.8,
        passed: true,
        attemptedAt: "2026-07-01T12:00:00.000Z",
      });

      expect(getQuizTimingHeatmap(base.instructor.id).totalAttempts).toBe(0);
    });
  });
});
