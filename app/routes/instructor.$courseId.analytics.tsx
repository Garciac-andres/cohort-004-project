import { Link, data, isRouteErrorResponse } from "react-router";
import type { Route } from "./+types/instructor.$courseId.analytics";
import {
  AlertTriangle,
  DollarSign,
  Receipt,
  ShoppingCart,
} from "lucide-react";
import { getCurrentUserId } from "~/lib/session";
import { getUserById } from "~/services/userService";
import { getCourseById } from "~/services/courseService";
import {
  getCourseRevenueSummary,
  getLessonDropoffData,
  getQuizPerformanceData,
  type LessonDropoff,
} from "~/services/analyticsService";
import { UserRole } from "~/db/schema";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { LessonDropoffChart } from "~/components/lesson-dropoff-chart";

export function meta() {
  return [
    { title: "Course Analytics — Cadence" },
    { name: "description", content: "Per-course analytics deep dive" },
  ];
}

// ─── Time-range filter ───
// Same `?range` preset behaviour as the global overview page: it persists in the
// URL (shareable/bookmarkable) and maps to an absolute `since` ISO cutoff (or
// null = all time). It filters the revenue figures only; lesson drop-off and
// quiz performance are cumulative and intentionally not time-filtered.

const RANGES = ["7d", "30d", "12m", "all"] as const;
type Range = (typeof RANGES)[number];

const RANGE_LABELS: Record<Range, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "12m": "Last 12 months",
  all: "All time",
};

function parseRange(value: string | null): Range {
  return RANGES.includes(value as Range) ? (value as Range) : "all";
}

function sinceFor(range: Range): string | null {
  const cutoff = new Date();
  switch (range) {
    case "7d":
      cutoff.setUTCDate(cutoff.getUTCDate() - 7);
      return cutoff.toISOString();
    case "30d":
      cutoff.setUTCDate(cutoff.getUTCDate() - 30);
      return cutoff.toISOString();
    case "12m":
      cutoff.setUTCMonth(cutoff.getUTCMonth() - 12);
      return cutoff.toISOString();
    case "all":
      return null;
  }
}

function formatDollars(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", {
    maximumFractionDigits: 0,
  })}`;
}

function formatPercent(value: number) {
  return `${value.toFixed(0)}%`;
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to view your analytics.", {
      status: 401,
    });
  }

  const user = getUserById(currentUserId);

  if (
    !user ||
    (user.role !== UserRole.Instructor && user.role !== UserRole.Admin)
  ) {
    throw data("Only instructors can access this page.", { status: 403 });
  }

  const courseId = parseInt(params.courseId, 10);
  if (isNaN(courseId)) {
    throw data("Invalid course ID.", { status: 400 });
  }

  const course = getCourseById(courseId);
  if (!course) {
    throw data("Course not found.", { status: 404 });
  }

  if (course.instructorId !== currentUserId && user.role !== UserRole.Admin) {
    throw data("You can only view analytics for your own courses.", {
      status: 403,
    });
  }

  const range = parseRange(new URL(request.url).searchParams.get("range"));
  const since = sinceFor(range);

  const revenue = getCourseRevenueSummary(courseId, since);
  const dropoff = getLessonDropoffData(courseId);
  const quizzes = getQuizPerformanceData(courseId);

  return {
    courseId,
    courseTitle: course.title,
    revenue,
    dropoff,
    quizzes,
    range,
  };
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="mt-2 h-5 w-48" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Skeleton className="mt-8 h-80 w-full" />
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof DollarSign;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
        <Icon className="size-4 shrink-0 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="truncate text-2xl font-bold" title={value}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

// A lesson is flagged for attention when it has below-50% completion *and*
// more comments than the course-wide average — a signal that learners are
// getting stuck and talking about it, rather than quietly moving on.
function flagDropoff(lessons: LessonDropoff[]) {
  if (lessons.length === 0) return () => false;
  const avgComments =
    lessons.reduce((sum, l) => sum + l.commentCount, 0) / lessons.length;
  return (lesson: LessonDropoff) =>
    lesson.completionPct < 50 &&
    lesson.commentCount > 0 &&
    lesson.commentCount > avgComments;
}

export default function CourseAnalytics({
  loaderData,
}: Route.ComponentProps) {
  const { courseId, courseTitle, revenue, dropoff, quizzes, range } =
    loaderData;

  const isFlagged = flagDropoff(dropoff);

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/instructor" className="hover:text-foreground">
          My Courses
        </Link>
        <span className="mx-2">/</span>
        <Link to={`/instructor/${courseId}`} className="hover:text-foreground">
          {courseTitle}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Analytics</span>
      </nav>

      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Course Analytics</h1>
          <p className="mt-1 text-muted-foreground">{courseTitle}</p>
        </div>
        {/* Time-range pills — each is a Link that re-runs the loader with ?range */}
        <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
          {RANGES.map((r) => (
            <Link
              key={r}
              to={`?range=${r}`}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                r === range
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {RANGE_LABELS[r]}
            </Link>
          ))}
        </div>
      </div>

      {/* Revenue — filtered by the selected range */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Revenue"
          value={formatDollars(revenue.totalRevenue)}
          icon={DollarSign}
        />
        <StatCard
          label="Sales Count"
          value={revenue.salesCount.toLocaleString("en-US")}
          icon={ShoppingCart}
        />
        <StatCard
          label="Average Sale Price"
          value={formatDollars(revenue.averageSalePrice)}
          icon={Receipt}
        />
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Revenue by Country
            </CardTitle>
          </CardHeader>
          <CardContent>
            {revenue.revenueByCountry.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sales yet.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {revenue.revenueByCountry.map((row) => (
                  <li
                    key={row.country}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="truncate">{row.country}</span>
                    <span className="font-medium tabular-nums">
                      {formatDollars(row.revenue)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Lesson drop-off — cumulative, not time-filtered */}
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Lesson Drop-off</CardTitle>
        </CardHeader>
        <CardContent>
          {dropoff.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This course has no lessons yet.
            </p>
          ) : (
            <>
              <LessonDropoffChart data={dropoff} />
              <div className="mt-6 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">Lesson</th>
                      <th className="py-2 pr-4 text-right font-medium">
                        Completion
                      </th>
                      <th className="py-2 text-right font-medium">Comments</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dropoff.map((lesson) => {
                      const flagged = isFlagged(lesson);
                      return (
                        <tr
                          key={lesson.lessonId}
                          className={`border-b last:border-0 ${
                            flagged
                              ? "bg-amber-50 dark:bg-amber-950/30"
                              : ""
                          }`}
                        >
                          <td className="py-2 pr-4">
                            <span className="flex items-center gap-2">
                              {flagged && (
                                <AlertTriangle
                                  className="size-4 shrink-0 text-amber-600 dark:text-amber-500"
                                  aria-label="High discussion, low completion"
                                />
                              )}
                              <span>{lesson.title}</span>
                            </span>
                          </td>
                          <td className="py-2 pr-4 text-right tabular-nums">
                            {formatPercent(lesson.completionPct)}
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {lesson.commentCount.toLocaleString("en-US")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Quiz performance — cumulative; hidden entirely when there are no quizzes */}
      {quizzes.length > 0 && (
        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Quiz Performance</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Quiz</th>
                  <th className="py-2 pr-4 text-right font-medium">Pass Rate</th>
                  <th className="py-2 text-right font-medium">Avg Score</th>
                </tr>
              </thead>
              <tbody>
                {quizzes.map((quiz) => (
                  <tr key={quiz.quizId} className="border-b last:border-0">
                    <td className="py-2 pr-4">{quiz.title}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {formatPercent(quiz.passRate)}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatPercent(quiz.averageScore)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading course analytics.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Access denied";
      message =
        typeof error.data === "string"
          ? error.data
          : "You don't have permission to access this page.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <Link
          to="/instructor"
          className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Back to My Courses
        </Link>
      </div>
    </div>
  );
}
