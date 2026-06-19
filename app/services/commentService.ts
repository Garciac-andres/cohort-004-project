import { eq } from "drizzle-orm";
import { db } from "~/db";
import { lessonComments, users } from "~/db/schema";

// ─── Comment Service ───
// Handles lesson comments with one level of threading (top-level comments and
// flat replies). One DB write path lives here, so a few invariants are enforced
// in code rather than the schema:
//   • Replies are capped at depth one (a reply cannot itself be replied to).
//   • A reply's lessonId always matches its parent's.
//   • updatedAt moves only on a body edit; soft delete touches deletedAt alone.
// Authorization (who may edit/delete, enrollment) is enforced at the route
// layer. Uses positional parameters (project convention).

const MIN_BODY = 1;
const MAX_BODY = 5000;

export type CommentAuthor = {
  id: number;
  name: string;
  avatarUrl: string | null;
};

/**
 * A comment ready for rendering. When the comment is soft-deleted (a tombstone),
 * `body` and `author` are scrubbed to null so the original text/identity never
 * reaches the client — only enough remains to anchor surviving replies.
 */
export type CommentNode = {
  id: number;
  parentId: number | null;
  body: string | null;
  author: CommentAuthor | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  edited: boolean;
  replies: CommentNode[];
};

/** Validates and normalises a comment body, throwing on anything out of range. */
function normaliseBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length < MIN_BODY || trimmed.length > MAX_BODY) {
    throw new Error(
      `Comment must be between ${MIN_BODY} and ${MAX_BODY} characters`
    );
  }
  return trimmed;
}

export function getCommentById(commentId: number) {
  return db
    .select()
    .from(lessonComments)
    .where(eq(lessonComments.id, commentId))
    .get();
}

type CommentRow = {
  id: number;
  parentId: number | null;
  body: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  authorId: number;
  authorName: string;
  authorAvatarUrl: string | null;
};

/** Builds a render-ready node from a row, scrubbing tombstoned content. */
function toNode(row: CommentRow, replies: CommentNode[]): CommentNode {
  const deleted = row.deletedAt !== null;
  return {
    id: row.id,
    parentId: row.parentId,
    body: deleted ? null : row.body,
    author: deleted
      ? null
      : {
          id: row.authorId,
          name: row.authorName,
          avatarUrl: row.authorAvatarUrl,
        },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    // Un-edited comments have updatedAt === createdAt (both set by the same
    // $defaultFn on insert); soft delete never bumps updatedAt.
    edited: !deleted && row.updatedAt > row.createdAt,
    replies,
  };
}

/**
 * Loads the whole comment thread for a lesson in a single query, grouped into
 * top-level comments (newest first) each carrying its replies (oldest first).
 *
 * Deleted replies are omitted entirely. A deleted top-level comment is kept as
 * a tombstone only if it still has surviving replies to anchor; otherwise it is
 * omitted too.
 */
export function getCommentsForLesson(lessonId: number): CommentNode[] {
  const rows = db
    .select({
      id: lessonComments.id,
      parentId: lessonComments.parentId,
      body: lessonComments.body,
      deletedAt: lessonComments.deletedAt,
      createdAt: lessonComments.createdAt,
      updatedAt: lessonComments.updatedAt,
      authorId: users.id,
      authorName: users.name,
      authorAvatarUrl: users.avatarUrl,
    })
    .from(lessonComments)
    .innerJoin(users, eq(lessonComments.userId, users.id))
    .where(eq(lessonComments.lessonId, lessonId))
    .all();

  // Group replies under their parent id.
  const repliesByParent = new Map<number, CommentRow[]>();
  const topLevel: CommentRow[] = [];
  for (const row of rows) {
    if (row.parentId === null) {
      topLevel.push(row);
    } else {
      const list = repliesByParent.get(row.parentId) ?? [];
      list.push(row);
      repliesByParent.set(row.parentId, list);
    }
  }

  // Top-level newest first.
  topLevel.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const result: CommentNode[] = [];
  for (const parent of topLevel) {
    const replyRows = (repliesByParent.get(parent.id) ?? [])
      // Deleted replies have nothing to anchor — drop them.
      .filter((r) => r.deletedAt === null)
      // Replies oldest first.
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const replies = replyRows.map((r) => toNode(r, []));

    // A deleted top-level comment is only worth keeping as a tombstone if it
    // still has surviving replies underneath it.
    if (parent.deletedAt !== null && replies.length === 0) {
      continue;
    }

    result.push(toNode(parent, replies));
  }

  return result;
}

export function createComment(userId: number, lessonId: number, body: string) {
  return db
    .insert(lessonComments)
    .values({ userId, lessonId, body: normaliseBody(body) })
    .returning()
    .get();
}

export function createReply(
  userId: number,
  lessonId: number,
  parentId: number,
  body: string
) {
  const parent = getCommentById(parentId);
  if (!parent || parent.deletedAt !== null) {
    throw new Error("Parent comment not found");
  }
  if (parent.lessonId !== lessonId) {
    throw new Error("Parent comment belongs to a different lesson");
  }
  // Depth guard: replies may only hang off a top-level comment.
  if (parent.parentId !== null) {
    throw new Error("Cannot reply to a reply");
  }

  return db
    .insert(lessonComments)
    .values({ userId, lessonId, parentId, body: normaliseBody(body) })
    .returning()
    .get();
}

export function updateComment(commentId: number, body: string) {
  return db
    .update(lessonComments)
    .set({ body: normaliseBody(body), updatedAt: new Date().toISOString() })
    .where(eq(lessonComments.id, commentId))
    .returning()
    .get();
}

/** Soft delete: sets deletedAt only. Must not touch updatedAt (see toNode). */
export function softDeleteComment(commentId: number) {
  return db
    .update(lessonComments)
    .set({ deletedAt: new Date().toISOString() })
    .where(eq(lessonComments.id, commentId))
    .returning()
    .get();
}
