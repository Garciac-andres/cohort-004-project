import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { NotificationType } from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

// Import after mock so the module picks up our test db
import {
  createNotification,
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
} from "./notificationService";

function makeNotification(recipientUserId: number, title = "New Enrollment") {
  return createNotification({
    recipientUserId,
    type: NotificationType.Enrollment,
    title,
    message: "Someone enrolled in your course",
    linkUrl: "/instructor/1/students",
  });
}

describe("notificationService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("createNotification", () => {
    it("creates a notification with all fields and defaults isRead to false", () => {
      const notification = createNotification({
        recipientUserId: base.instructor.id,
        type: NotificationType.Enrollment,
        title: "New Enrollment",
        message: "Test User enrolled in Test Course",
        linkUrl: `/instructor/${base.course.id}/students`,
      });

      expect(notification).toBeDefined();
      expect(notification.recipientUserId).toBe(base.instructor.id);
      expect(notification.type).toBe(NotificationType.Enrollment);
      expect(notification.title).toBe("New Enrollment");
      expect(notification.message).toBe("Test User enrolled in Test Course");
      expect(notification.linkUrl).toBe(`/instructor/${base.course.id}/students`);
      expect(notification.isRead).toBe(false);
      expect(notification.createdAt).toBeDefined();
    });
  });

  describe("getNotifications", () => {
    it("returns notifications for a user, newest first", () => {
      const first = makeNotification(base.instructor.id, "First");
      const second = makeNotification(base.instructor.id, "Second");

      const list = getNotifications({
        userId: base.instructor.id,
        limit: 10,
        offset: 0,
      });

      expect(list).toHaveLength(2);
      // Newest first: the most recently inserted id comes first.
      expect(list[0].id).toBe(second.id);
      expect(list[1].id).toBe(first.id);
    });

    it("respects limit and offset", () => {
      makeNotification(base.instructor.id, "A");
      makeNotification(base.instructor.id, "B");
      makeNotification(base.instructor.id, "C");

      const firstPage = getNotifications({
        userId: base.instructor.id,
        limit: 2,
        offset: 0,
      });
      expect(firstPage).toHaveLength(2);

      const secondPage = getNotifications({
        userId: base.instructor.id,
        limit: 2,
        offset: 2,
      });
      expect(secondPage).toHaveLength(1);
    });

    it("only returns the requesting user's notifications", () => {
      makeNotification(base.instructor.id);
      makeNotification(base.user.id);

      const list = getNotifications({
        userId: base.instructor.id,
        limit: 10,
        offset: 0,
      });

      expect(list).toHaveLength(1);
      expect(list[0].recipientUserId).toBe(base.instructor.id);
    });

    it("returns an empty array when the user has no notifications", () => {
      expect(
        getNotifications({ userId: base.instructor.id, limit: 10, offset: 0 })
      ).toHaveLength(0);
    });
  });

  describe("getUnreadCount", () => {
    it("counts only unread notifications for the user", () => {
      const a = makeNotification(base.instructor.id);
      makeNotification(base.instructor.id);
      // A notification for someone else must not be counted.
      makeNotification(base.user.id);

      expect(getUnreadCount(base.instructor.id)).toBe(2);

      markAsRead({ notificationId: a.id, userId: base.instructor.id });
      expect(getUnreadCount(base.instructor.id)).toBe(1);
    });

    it("returns 0 when there are no notifications", () => {
      expect(getUnreadCount(base.instructor.id)).toBe(0);
    });
  });

  describe("markAsRead", () => {
    it("marks a single notification as read", () => {
      const notification = makeNotification(base.instructor.id);

      const updated = markAsRead({
        notificationId: notification.id,
        userId: base.instructor.id,
      });

      expect(updated).toBeDefined();
      expect(updated!.isRead).toBe(true);
      expect(getUnreadCount(base.instructor.id)).toBe(0);
    });

    it("will not mark a notification belonging to another user", () => {
      const notification = makeNotification(base.instructor.id);

      // base.user tries to mark the instructor's notification.
      const updated = markAsRead({
        notificationId: notification.id,
        userId: base.user.id,
      });

      expect(updated).toBeUndefined();
      expect(getUnreadCount(base.instructor.id)).toBe(1);
    });
  });

  describe("markAllAsRead", () => {
    it("marks all of the user's notifications as read", () => {
      makeNotification(base.instructor.id);
      makeNotification(base.instructor.id);
      // Another user's unread notification is left untouched.
      makeNotification(base.user.id);

      markAllAsRead(base.instructor.id);

      expect(getUnreadCount(base.instructor.id)).toBe(0);
      expect(getUnreadCount(base.user.id)).toBe(1);
    });
  });
});
