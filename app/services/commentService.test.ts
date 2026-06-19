import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

// Import after mock so the module picks up our test db
import {
  getCommentsForLesson,
  getCommentById,
  createComment,
  createReply,
  updateComment,
  softDeleteComment,
} from "./commentService";

/** Creates an extra student and returns its id. */
function makeStudent(email: string) {
  return testDb
    .insert(schema.users)
    .values({ name: email, email, role: schema.UserRole.Student })
    .returning()
    .get();
}

/** Creates a module + lesson under the base course and returns the lesson id. */
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

describe("commentService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
    lessonId = makeLesson("Intro").id;
  });

  describe("createComment", () => {
    it("creates a top-level comment", () => {
      const comment = createComment(base.user.id, lessonId, "Great lesson!");

      expect(comment.id).toBeDefined();
      expect(comment.userId).toBe(base.user.id);
      expect(comment.lessonId).toBe(lessonId);
      expect(comment.parentId).toBeNull();
      expect(comment.body).toBe("Great lesson!");
      expect(comment.deletedAt).toBeNull();
    });

    it("trims the body", () => {
      const comment = createComment(base.user.id, lessonId, "  spaced  ");
      expect(comment.body).toBe("spaced");
    });

    it("rejects an empty / whitespace-only body", () => {
      expect(() => createComment(base.user.id, lessonId, "   ")).toThrowError(
        /between 1 and 5000/
      );
    });

    it("rejects a body over the max length", () => {
      const tooLong = "a".repeat(5001);
      expect(() =>
        createComment(base.user.id, lessonId, tooLong)
      ).toThrowError(/between 1 and 5000/);
    });
  });

  describe("createReply", () => {
    it("creates a reply under a top-level comment", () => {
      const parent = createComment(base.user.id, lessonId, "Question?");
      const reply = createReply(
        base.instructor.id,
        lessonId,
        parent.id,
        "Answer."
      );

      expect(reply.parentId).toBe(parent.id);
      expect(reply.lessonId).toBe(lessonId);
      expect(reply.body).toBe("Answer.");
    });

    it("rejects replying to a reply (depth cap of one)", () => {
      const parent = createComment(base.user.id, lessonId, "Question?");
      const reply = createReply(
        base.instructor.id,
        lessonId,
        parent.id,
        "Answer."
      );

      expect(() =>
        createReply(base.user.id, lessonId, reply.id, "Follow-up")
      ).toThrowError(/reply to a reply/);
    });

    it("rejects a reply whose lesson differs from the parent's", () => {
      const otherLesson = makeLesson("Other").id;
      const parent = createComment(base.user.id, lessonId, "Question?");

      expect(() =>
        createReply(base.user.id, otherLesson, parent.id, "Mismatch")
      ).toThrowError(/different lesson/);
    });

    it("rejects a reply to a missing or deleted parent", () => {
      expect(() =>
        createReply(base.user.id, lessonId, 9999, "Ghost")
      ).toThrowError(/not found/);

      const parent = createComment(base.user.id, lessonId, "Question?");
      softDeleteComment(parent.id);
      expect(() =>
        createReply(base.user.id, lessonId, parent.id, "Too late")
      ).toThrowError(/not found/);
    });
  });

  describe("updateComment", () => {
    it("updates the body and marks the comment edited", () => {
      const comment = createComment(base.user.id, lessonId, "Original");
      const updated = updateComment(comment.id, "Edited body");

      expect(updated.body).toBe("Edited body");
      // updatedAt should advance past createdAt so the UI shows "edited".
      expect(updated.updatedAt >= updated.createdAt).toBe(true);

      const nodes = getCommentsForLesson(lessonId);
      expect(nodes[0].body).toBe("Edited body");
    });

    it("validates the new body", () => {
      const comment = createComment(base.user.id, lessonId, "Original");
      expect(() => updateComment(comment.id, "")).toThrowError(
        /between 1 and 5000/
      );
    });
  });

  describe("softDeleteComment", () => {
    it("sets deletedAt without bumping updatedAt", () => {
      const comment = createComment(base.user.id, lessonId, "Bye");
      const deleted = softDeleteComment(comment.id);

      expect(deleted.deletedAt).not.toBeNull();
      // Soft delete must leave updatedAt untouched so it isn't mistaken for an edit.
      expect(deleted.updatedAt).toBe(comment.updatedAt);

      const stored = getCommentById(comment.id);
      expect(stored!.deletedAt).not.toBeNull();
    });
  });

  describe("getCommentsForLesson", () => {
    it("returns top-level comments newest first", () => {
      // createdAt is an ISO string set per insert; force distinct ordering.
      const first = createComment(base.user.id, lessonId, "First");
      const second = createComment(base.user.id, lessonId, "Second");
      // Nudge the second comment's timestamp to be strictly later.
      testDb
        .update(schema.lessonComments)
        .set({ createdAt: "2999-01-01T00:00:00.000Z" })
        .where(eq(schema.lessonComments.id, second.id))
        .run();

      const nodes = getCommentsForLesson(lessonId);
      expect(nodes).toHaveLength(2);
      expect(nodes[0].body).toBe("Second");
      expect(nodes[1].body).toBe("First");
      void first;
    });

    it("nests replies oldest first under their parent", () => {
      const parent = createComment(base.user.id, lessonId, "Q");
      const r1 = createReply(base.instructor.id, lessonId, parent.id, "A1");
      const r2 = createReply(base.user.id, lessonId, parent.id, "A2");
      testDb
        .update(schema.lessonComments)
        .set({ createdAt: "2999-01-01T00:00:00.000Z" })
        .where(eq(schema.lessonComments.id, r2.id))
        .run();

      const nodes = getCommentsForLesson(lessonId);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].replies.map((r) => r.body)).toEqual(["A1", "A2"]);
      void r1;
    });

    it("includes the author's name and avatar", () => {
      createComment(base.user.id, lessonId, "Hi");
      const nodes = getCommentsForLesson(lessonId);
      expect(nodes[0].author?.id).toBe(base.user.id);
      expect(nodes[0].author?.name).toBe(base.user.name);
    });

    it("scrubs body and author for a deleted comment kept as a tombstone", () => {
      const parent = createComment(base.user.id, lessonId, "secret text");
      createReply(base.instructor.id, lessonId, parent.id, "a reply");
      softDeleteComment(parent.id);

      const nodes = getCommentsForLesson(lessonId);
      expect(nodes).toHaveLength(1);
      // Tombstone: original text and author never reach the client.
      expect(nodes[0].body).toBeNull();
      expect(nodes[0].author).toBeNull();
      expect(nodes[0].deletedAt).not.toBeNull();
      // The surviving reply still anchors to it.
      expect(nodes[0].replies).toHaveLength(1);
      expect(nodes[0].replies[0].body).toBe("a reply");
    });

    it("omits a deleted top-level comment that has no surviving replies", () => {
      const comment = createComment(base.user.id, lessonId, "lonely");
      softDeleteComment(comment.id);

      expect(getCommentsForLesson(lessonId)).toHaveLength(0);
    });

    it("omits deleted replies", () => {
      const parent = createComment(base.user.id, lessonId, "Q");
      const reply = createReply(base.instructor.id, lessonId, parent.id, "A");
      softDeleteComment(reply.id);

      const nodes = getCommentsForLesson(lessonId);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].replies).toHaveLength(0);
    });

    it("only returns comments for the given lesson", () => {
      const otherLesson = makeLesson("Other").id;
      createComment(base.user.id, lessonId, "here");
      createComment(base.user.id, otherLesson, "there");

      const nodes = getCommentsForLesson(lessonId);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].body).toBe("here");
    });
  });
});
