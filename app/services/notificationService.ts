import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "~/db";
import { notifications, type NotificationType } from "~/db/schema";

// ─── Notification Service ───
// Generic in-app notifications. Functions with multiple same-typed parameters
// take an object param (project coding standard); single-arg helpers stay
// positional. Direct Drizzle queries, matching the other services.

export function createNotification(opts: {
  recipientUserId: number;
  type: NotificationType;
  title: string;
  message: string;
  linkUrl: string;
}) {
  return db
    .insert(notifications)
    .values({
      recipientUserId: opts.recipientUserId,
      type: opts.type,
      title: opts.title,
      message: opts.message,
      linkUrl: opts.linkUrl,
    })
    .returning()
    .get();
}

export function getNotifications(opts: {
  userId: number;
  limit: number;
  offset: number;
}) {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.recipientUserId, opts.userId))
    // Newest first; id breaks ties for rows created in the same millisecond.
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(opts.limit)
    .offset(opts.offset)
    .all();
}

export function getUnreadCount(userId: number) {
  const result = db
    .select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(
      and(
        eq(notifications.recipientUserId, userId),
        eq(notifications.isRead, false)
      )
    )
    .get();

  return result?.count ?? 0;
}

// Scoped to the recipient: a user can only mark their own notification read.
// Returns the updated row, or undefined if it doesn't exist / isn't theirs.
export function markAsRead(opts: { notificationId: number; userId: number }) {
  return db
    .update(notifications)
    .set({ isRead: true })
    .where(
      and(
        eq(notifications.id, opts.notificationId),
        eq(notifications.recipientUserId, opts.userId)
      )
    )
    .returning()
    .get();
}

export function markAllAsRead(userId: number) {
  return db
    .update(notifications)
    .set({ isRead: true })
    .where(
      and(
        eq(notifications.recipientUserId, userId),
        eq(notifications.isRead, false)
      )
    )
    .returning()
    .all();
}
