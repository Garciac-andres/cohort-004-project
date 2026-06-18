import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { toast } from "sonner";
import { MessageSquare, Pencil, Reply, Trash2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { UserAvatar } from "~/components/user-avatar";
// Type-only import: erased at build time, so the db-backed service never leaks
// into the client bundle.
import type { CommentNode } from "~/services/commentService";

type ActionData = { ok?: boolean; errors?: Record<string, string> };

function formatWhen(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function LessonComments({
  comments,
  currentUserId,
  instructorId,
  canComment,
}: {
  comments: CommentNode[];
  currentUserId: number | null;
  instructorId: number;
  canComment: boolean;
}) {
  const isInstructorViewer = currentUserId === instructorId;

  return (
    <section className="mt-8 border-t pt-6">
      <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold">
        <MessageSquare className="size-5" />
        Discussion
        {comments.length > 0 && (
          <span className="text-sm font-normal text-muted-foreground">
            ({comments.length})
          </span>
        )}
      </h2>

      {canComment && <NewCommentForm />}

      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No comments yet. {canComment ? "Start the discussion!" : ""}
        </p>
      ) : (
        <ul className="space-y-6">
          {comments.map((comment) => (
            <li key={comment.id}>
              <CommentItem
                comment={comment}
                currentUserId={currentUserId}
                instructorId={instructorId}
                isInstructorViewer={isInstructorViewer}
                canComment={canComment}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Top-level "add a comment" box. */
function NewCommentForm() {
  const fetcher = useFetcher<ActionData>();
  const formRef = useRef<HTMLFormElement>(null);
  const submitting = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      formRef.current?.reset();
      toast.success("Comment posted.");
    }
    if (fetcher.state === "idle" && fetcher.data?.errors) {
      toast.error("Couldn't post your comment. Please try again.");
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <fetcher.Form ref={formRef} method="post" className="mb-6">
      <input type="hidden" name="intent" value="create-comment" />
      <Textarea
        name="body"
        required
        maxLength={5000}
        placeholder="Add a comment…"
        className="mb-2"
        disabled={submitting}
      />
      <Button type="submit" size="sm" disabled={submitting}>
        {submitting ? "Posting…" : "Post Comment"}
      </Button>
    </fetcher.Form>
  );
}

function CommentItem({
  comment,
  currentUserId,
  instructorId,
  isInstructorViewer,
  canComment,
  isReply = false,
}: {
  comment: CommentNode;
  currentUserId: number | null;
  instructorId: number;
  isInstructorViewer: boolean;
  canComment: boolean;
  isReply?: boolean;
}) {
  const deleted = comment.deletedAt !== null;
  const isAuthor =
    comment.author !== null && comment.author.id === currentUserId;
  const isInstructorComment =
    comment.author !== null && comment.author.id === instructorId;

  const [editing, setEditing] = useState(false);
  const [replying, setReplying] = useState(false);

  const editFetcher = useFetcher<ActionData>();
  const deleteFetcher = useFetcher<ActionData>();

  const deleting = deleteFetcher.state !== "idle";

  // Leave edit mode once the edit succeeds.
  useEffect(() => {
    if (editFetcher.state === "idle" && editFetcher.data?.ok) {
      setEditing(false);
      toast.success("Comment updated.");
    }
    if (editFetcher.state === "idle" && editFetcher.data?.errors) {
      toast.error("Couldn't update your comment.");
    }
  }, [editFetcher.state, editFetcher.data]);

  function handleDelete() {
    if (!window.confirm("Delete this comment?")) return;
    deleteFetcher.submit(
      { intent: "delete-comment", commentId: String(comment.id) },
      { method: "post" }
    );
  }

  return (
    <div className={deleting ? "opacity-50" : undefined}>
      <div className="flex gap-3">
        <UserAvatar
          name={comment.author?.name ?? "Deleted"}
          avatarUrl={comment.author?.avatarUrl ?? null}
          className="size-8 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">
              {deleted ? "[deleted]" : comment.author?.name}
            </span>
            {isInstructorComment && !deleted && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                Instructor
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {formatWhen(comment.createdAt)}
            </span>
            {comment.edited && (
              <span className="text-xs text-muted-foreground">(edited)</span>
            )}
          </div>

          {deleted ? (
            <p className="text-sm italic text-muted-foreground">
              This comment was deleted.
            </p>
          ) : editing ? (
            <editFetcher.Form
              method="post"
              onSubmit={() => undefined}
              className="mt-1"
            >
              <input type="hidden" name="intent" value="edit-comment" />
              <input type="hidden" name="commentId" value={comment.id} />
              <Textarea
                name="body"
                required
                maxLength={5000}
                defaultValue={comment.body ?? ""}
                className="mb-2"
                disabled={editFetcher.state !== "idle"}
              />
              <div className="flex gap-2">
                <Button
                  type="submit"
                  size="sm"
                  disabled={editFetcher.state !== "idle"}
                >
                  Save
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </Button>
              </div>
            </editFetcher.Form>
          ) : (
            <p className="whitespace-pre-wrap text-sm">{comment.body}</p>
          )}

          {/* Action row */}
          {!deleted && !editing && (
            <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
              {canComment && !isReply && (
                <button
                  type="button"
                  onClick={() => setReplying((v) => !v)}
                  className="flex items-center gap-1 hover:text-foreground"
                >
                  <Reply className="size-3.5" />
                  Reply
                </button>
              )}
              {isAuthor && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="flex items-center gap-1 hover:text-foreground"
                >
                  <Pencil className="size-3.5" />
                  Edit
                </button>
              )}
              {(isAuthor || isInstructorViewer) && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex items-center gap-1 hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                  Delete
                </button>
              )}
            </div>
          )}

          {/* Inline reply box */}
          {replying && (
            <ReplyForm
              parentId={comment.id}
              onDone={() => setReplying(false)}
            />
          )}

          {/* Replies (one level deep) */}
          {comment.replies.length > 0 && (
            <ul className="mt-4 space-y-4 border-l pl-4">
              {comment.replies.map((reply) => (
                <li key={reply.id}>
                  <CommentItem
                    comment={reply}
                    currentUserId={currentUserId}
                    instructorId={instructorId}
                    isInstructorViewer={isInstructorViewer}
                    canComment={canComment}
                    isReply
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function ReplyForm({
  parentId,
  onDone,
}: {
  parentId: number;
  onDone: () => void;
}) {
  const fetcher = useFetcher<ActionData>();
  const submitting = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      toast.success("Reply posted.");
      onDone();
    }
    if (fetcher.state === "idle" && fetcher.data?.errors) {
      toast.error("Couldn't post your reply.");
    }
  }, [fetcher.state, fetcher.data, onDone]);

  return (
    <fetcher.Form method="post" className="mt-2">
      <input type="hidden" name="intent" value="create-reply" />
      <input type="hidden" name="parentId" value={parentId} />
      <Textarea
        name="body"
        required
        maxLength={5000}
        placeholder="Write a reply…"
        className="mb-2"
        disabled={submitting}
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? "Posting…" : "Reply"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </fetcher.Form>
  );
}
