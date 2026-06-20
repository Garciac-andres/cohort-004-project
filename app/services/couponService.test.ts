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
  generateCoupons,
  getCouponByCode,
  getCouponsForTeam,
  redeemCoupon,
} from "./couponService";
import { getNotifications } from "./notificationService";

// Helper: create a team with admin and a purchase for coupon generation
function setupTeamAndPurchase(country: string | null = "US") {
  const team = testDb.insert(schema.teams).values({}).returning().get();

  testDb
    .insert(schema.teamMembers)
    .values({
      teamId: team.id,
      userId: base.user.id,
      role: schema.TeamMemberRole.Admin,
    })
    .run();

  const purchase = testDb
    .insert(schema.purchases)
    .values({
      userId: base.user.id,
      courseId: base.course.id,
      pricePaid: 10000,
      country,
    })
    .returning()
    .get();

  return { team, purchase };
}

// Helper: create a second user (the redeemer)
function createRedeemer() {
  return testDb
    .insert(schema.users)
    .values({
      name: "Redeemer",
      email: "redeemer@example.com",
      role: schema.UserRole.Student,
    })
    .returning()
    .get();
}

describe("couponService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("generateCoupons", () => {
    it("generates the requested number of coupons", () => {
      const { team, purchase } = setupTeamAndPurchase();

      const result = generateCoupons(team.id, base.course.id, purchase.id, 5);

      expect(result).toHaveLength(5);
    });

    it("generates unique codes for each coupon", () => {
      const { team, purchase } = setupTeamAndPurchase();

      const result = generateCoupons(team.id, base.course.id, purchase.id, 10);
      const codes = result.map((c) => c.code);
      const uniqueCodes = new Set(codes);

      expect(uniqueCodes.size).toBe(10);
    });

    it("associates coupons with the correct team, course, and purchase", () => {
      const { team, purchase } = setupTeamAndPurchase();

      const result = generateCoupons(team.id, base.course.id, purchase.id, 1);

      expect(result[0].teamId).toBe(team.id);
      expect(result[0].courseId).toBe(base.course.id);
      expect(result[0].purchaseId).toBe(purchase.id);
      expect(result[0].redeemedByUserId).toBeNull();
      expect(result[0].redeemedAt).toBeNull();
    });
  });

  describe("getCouponByCode", () => {
    it("returns a coupon by its code", () => {
      const { team, purchase } = setupTeamAndPurchase();
      const [coupon] = generateCoupons(team.id, base.course.id, purchase.id, 1);

      const found = getCouponByCode(coupon.code);

      expect(found).toBeDefined();
      expect(found!.id).toBe(coupon.id);
    });

    it("returns undefined for a nonexistent code", () => {
      const found = getCouponByCode("nonexistent-code");

      expect(found).toBeUndefined();
    });
  });

  describe("getCouponsForTeam", () => {
    it("returns all coupons for a team", () => {
      const { team, purchase } = setupTeamAndPurchase();
      generateCoupons(team.id, base.course.id, purchase.id, 3);

      const result = getCouponsForTeam(team.id);

      expect(result).toHaveLength(3);
    });

    it("filters coupons by course when courseId is provided", () => {
      const { team, purchase } = setupTeamAndPurchase();

      // Create a second course
      const course2 = testDb
        .insert(schema.courses)
        .values({
          title: "Second Course",
          slug: "second-course",
          description: "Another course",
          instructorId: base.instructor.id,
          categoryId: base.category.id,
          status: schema.CourseStatus.Published,
        })
        .returning()
        .get();

      const purchase2 = testDb
        .insert(schema.purchases)
        .values({
          userId: base.user.id,
          courseId: course2.id,
          pricePaid: 5000,
          country: "US",
        })
        .returning()
        .get();

      generateCoupons(team.id, base.course.id, purchase.id, 3);
      generateCoupons(team.id, course2.id, purchase2.id, 2);

      const filtered = getCouponsForTeam(team.id, base.course.id);
      expect(filtered).toHaveLength(3);

      const filtered2 = getCouponsForTeam(team.id, course2.id);
      expect(filtered2).toHaveLength(2);

      const all = getCouponsForTeam(team.id);
      expect(all).toHaveLength(5);
    });
  });

  describe("redeemCoupon", () => {
    it("redeems a valid coupon and enrolls the user", () => {
      const { team, purchase } = setupTeamAndPurchase();
      const [coupon] = generateCoupons(team.id, base.course.id, purchase.id, 1);
      const redeemer = createRedeemer();

      const result = redeemCoupon(coupon.code, redeemer.id, "US");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.enrollment.userId).toBe(redeemer.id);
        expect(result.enrollment.courseId).toBe(base.course.id);
      }

      // Verify coupon is marked as redeemed
      const updated = getCouponByCode(coupon.code);
      expect(updated!.redeemedByUserId).toBe(redeemer.id);
      expect(updated!.redeemedAt).toBeDefined();
    });

    it("rejects redemption of a nonexistent code", () => {
      const result = redeemCoupon("nonexistent-code", 999, "US");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("Coupon not found");
      }
    });

    it("rejects redemption of an already-consumed coupon", () => {
      const { team, purchase } = setupTeamAndPurchase();
      const [coupon] = generateCoupons(team.id, base.course.id, purchase.id, 1);
      const redeemer = createRedeemer();

      // First redemption succeeds
      redeemCoupon(coupon.code, redeemer.id, "US");

      // Second redemption (different user) fails
      const anotherUser = testDb
        .insert(schema.users)
        .values({
          name: "Another User",
          email: "another@example.com",
          role: schema.UserRole.Student,
        })
        .returning()
        .get();

      const result = redeemCoupon(coupon.code, anotherUser.id, "US");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("Coupon has already been redeemed");
      }
    });

    it("rejects redemption when user is already enrolled (coupon stays unconsumed)", () => {
      const { team, purchase } = setupTeamAndPurchase();
      const [coupon] = generateCoupons(team.id, base.course.id, purchase.id, 1);
      const redeemer = createRedeemer();

      // Enroll the user first (outside the coupon flow)
      testDb
        .insert(schema.enrollments)
        .values({ userId: redeemer.id, courseId: base.course.id })
        .run();

      const result = redeemCoupon(coupon.code, redeemer.id, "US");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("You are already enrolled in this course");
      }

      // Verify coupon is NOT consumed
      const unchanged = getCouponByCode(coupon.code);
      expect(unchanged!.redeemedByUserId).toBeNull();
    });

    it("rejects redemption from a different country", () => {
      const { team, purchase } = setupTeamAndPurchase("US");
      const [coupon] = generateCoupons(team.id, base.course.id, purchase.id, 1);
      const redeemer = createRedeemer();

      const result = redeemCoupon(coupon.code, redeemer.id, "PL");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(
          "This coupon can only be redeemed from the same country as the purchaser"
        );
      }

      // Verify coupon is NOT consumed
      const unchanged = getCouponByCode(coupon.code);
      expect(unchanged!.redeemedByUserId).toBeNull();
    });

    it("allows redemption when purchase has no country set", () => {
      const { team, purchase } = setupTeamAndPurchase(null);
      const [coupon] = generateCoupons(team.id, base.course.id, purchase.id, 1);
      const redeemer = createRedeemer();

      const result = redeemCoupon(coupon.code, redeemer.id, "PL");

      expect(result.ok).toBe(true);
    });
  });

  describe("coupon redemption notifications", () => {
    it("notifies the team admin with a coupon_redemption notification", () => {
      const { team, purchase } = setupTeamAndPurchase();
      const [coupon] = generateCoupons(team.id, base.course.id, purchase.id, 1);
      const redeemer = createRedeemer();

      redeemCoupon(coupon.code, redeemer.id, "US");

      // base.user is the team admin (see setupTeamAndPurchase).
      const adminNotifications = getNotifications({
        userId: base.user.id,
        limit: 10,
        offset: 0,
      });

      expect(adminNotifications).toHaveLength(1);
      expect(adminNotifications[0].type).toBe(
        schema.NotificationType.CouponRedemption
      );
    });

    it("titles the notification 'Seat Claimed' and links to /team", () => {
      const { team, purchase } = setupTeamAndPurchase();
      const [coupon] = generateCoupons(team.id, base.course.id, purchase.id, 1);
      const redeemer = createRedeemer();

      redeemCoupon(coupon.code, redeemer.id, "US");

      const [notification] = getNotifications({
        userId: base.user.id,
        limit: 10,
        offset: 0,
      });

      expect(notification.title).toBe("Seat Claimed");
      expect(notification.linkUrl).toBe("/team");
    });

    it("messages the redeemer name, course title, and seat counts", () => {
      const { team, purchase } = setupTeamAndPurchase();
      // One coupon total; after redemption, 0 of 1 remain.
      const [coupon] = generateCoupons(team.id, base.course.id, purchase.id, 1);
      const redeemer = createRedeemer();

      redeemCoupon(coupon.code, redeemer.id, "US");

      const [notification] = getNotifications({
        userId: base.user.id,
        limit: 10,
        offset: 0,
      });

      expect(notification.message).toBe(
        "Redeemer redeemed a coupon for Test Course (0 of 1 seats remaining)"
      );
    });

    it("counts remaining seats per course on the team", () => {
      const { team, purchase } = setupTeamAndPurchase();
      // 3 coupons for this course; redeeming one leaves 2 of 3.
      const [coupon] = generateCoupons(team.id, base.course.id, purchase.id, 3);

      // A second course on the same team must not affect the count.
      const course2 = testDb
        .insert(schema.courses)
        .values({
          title: "Second Course",
          slug: "second-course",
          description: "Another course",
          instructorId: base.instructor.id,
          categoryId: base.category.id,
          status: schema.CourseStatus.Published,
        })
        .returning()
        .get();
      const purchase2 = testDb
        .insert(schema.purchases)
        .values({
          userId: base.user.id,
          courseId: course2.id,
          pricePaid: 5000,
          country: "US",
        })
        .returning()
        .get();
      generateCoupons(team.id, course2.id, purchase2.id, 5);

      const redeemer = createRedeemer();
      redeemCoupon(coupon.code, redeemer.id, "US");

      const [notification] = getNotifications({
        userId: base.user.id,
        limit: 10,
        offset: 0,
      });

      expect(notification.message).toContain("(2 of 3 seats remaining)");
    });

    it("notifies every admin of the team", () => {
      const { team, purchase } = setupTeamAndPurchase();
      // Add a second admin to the same team.
      const secondAdmin = testDb
        .insert(schema.users)
        .values({
          name: "Second Admin",
          email: "second-admin@example.com",
          role: schema.UserRole.Student,
        })
        .returning()
        .get();
      testDb
        .insert(schema.teamMembers)
        .values({
          teamId: team.id,
          userId: secondAdmin.id,
          role: schema.TeamMemberRole.Admin,
        })
        .run();

      const [coupon] = generateCoupons(team.id, base.course.id, purchase.id, 1);
      const redeemer = createRedeemer();

      redeemCoupon(coupon.code, redeemer.id, "US");

      expect(
        getNotifications({ userId: base.user.id, limit: 10, offset: 0 })
      ).toHaveLength(1);
      expect(
        getNotifications({ userId: secondAdmin.id, limit: 10, offset: 0 })
      ).toHaveLength(1);
    });

    it("does not notify non-admin team members", () => {
      const { team, purchase } = setupTeamAndPurchase();
      const member = testDb
        .insert(schema.users)
        .values({
          name: "Plain Member",
          email: "member@example.com",
          role: schema.UserRole.Student,
        })
        .returning()
        .get();
      testDb
        .insert(schema.teamMembers)
        .values({
          teamId: team.id,
          userId: member.id,
          role: schema.TeamMemberRole.Member,
        })
        .run();

      const [coupon] = generateCoupons(team.id, base.course.id, purchase.id, 1);
      const redeemer = createRedeemer();

      redeemCoupon(coupon.code, redeemer.id, "US");

      expect(
        getNotifications({ userId: member.id, limit: 10, offset: 0 })
      ).toHaveLength(0);
    });

    it("creates no notification when redemption fails", () => {
      const { team, purchase } = setupTeamAndPurchase("US");
      const [coupon] = generateCoupons(team.id, base.course.id, purchase.id, 1);
      const redeemer = createRedeemer();

      // Country mismatch → redemption rejected.
      const result = redeemCoupon(coupon.code, redeemer.id, "PL");
      expect(result.ok).toBe(false);

      expect(
        getNotifications({ userId: base.user.id, limit: 10, offset: 0 })
      ).toHaveLength(0);
    });
  });
});
