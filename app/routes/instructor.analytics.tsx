import { Link, data, isRouteErrorResponse } from "react-router";
import type { Route } from "./+types/instructor.analytics";
import {
  AlertTriangle,
  DollarSign,
  GraduationCap,
  Plus,
  ShoppingCart,
  Star,
  Trophy,
  Users,
} from "lucide-react";
import { getCurrentUserId } from "~/lib/session";
import { getUserById } from "~/services/userService";
import { getCoursesByInstructor } from "~/services/courseService";
import {
  getInstructorOverview,
  getRevenueTimeSeries,
} from "~/services/analyticsService";
import { UserRole } from "~/db/schema";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { RevenueChart } from "~/components/revenue-chart";

export function meta() {
  return [
    { title: "Analytics — Cadence" },
    { name: "description", content: "Cross-course analytics overview" },
  ];
}

// ─── Time-range filter ───
// `?range` is one of these presets and persists in the URL so a filtered view is
// shareable/bookmarkable. It maps to an absolute `since` ISO cutoff (or null =
// all time) that analyticsService compares against ISO text columns.

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

export async function loader({ request }: Route.LoaderArgs) {
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

  const range = parseRange(new URL(request.url).searchParams.get("range"));
  const since = sinceFor(range);

  const overview = getInstructorOverview(currentUserId, since);
  const timeSeries = getRevenueTimeSeries(currentUserId, since);
  const hasCourses = getCoursesByInstructor(currentUserId).length > 0;

  return { overview, timeSeries, range, hasCourses };
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <Skeleton className="h-9 w-48" />
      <Skeleton className="mt-2 h-5 w-72" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
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
  wrap = false,
}: {
  label: string;
  value: string;
  icon: typeof DollarSign;
  // Allow long values (e.g. a course title) to wrap onto multiple lines and
  // break mid-word so they always fit, instead of being truncated to one line.
  wrap?: boolean;
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
        <div
          className={
            wrap
              ? "text-lg font-bold leading-snug break-words"
              : "truncate text-2xl font-bold"
          }
          title={value}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

export default function InstructorAnalytics({
  loaderData,
}: Route.ComponentProps) {
  const { overview, timeSeries, range, hasCourses } = loaderData;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/instructor" className="hover:text-foreground">
          My Courses
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Analytics</span>
      </nav>

      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Analytics Overview</h1>
          <p className="mt-1 text-muted-foreground">
            Performance across all your courses
          </p>
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

      {!hasCourses ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <GraduationCap className="mb-4 size-12 text-muted-foreground/50" />
          <h2 className="text-lg font-medium">No analytics yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Create your first course to start tracking performance.
          </p>
          <Link
            to="/instructor/new"
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="size-4" />
            Create Course
          </Link>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard
              label="Total Revenue"
              value={formatDollars(overview.totalRevenue)}
              icon={DollarSign}
            />
            <StatCard
              label="Total Sales"
              value={overview.totalSales.toLocaleString("en-US")}
              icon={ShoppingCart}
            />
            <StatCard
              label="Total Students"
              value={overview.totalStudents.toLocaleString("en-US")}
              icon={Users}
            />
            <StatCard
              label="Best-Selling Course"
              value={overview.bestSellingCourse ?? "—"}
              icon={Trophy}
              wrap
            />
            <StatCard
              label="Average Rating"
              value={
                overview.averageRating != null
                  ? overview.averageRating.toFixed(1)
                  : "—"
              }
              icon={Star}
            />
          </div>

          <Card className="mt-8">
            <CardHeader>
              <CardTitle>Revenue Trend</CardTitle>
            </CardHeader>
            <CardContent>
              {timeSeries.length === 0 ? (
                <div className="flex h-80 flex-col items-center justify-center text-center text-muted-foreground">
                  <DollarSign className="mb-2 size-8 opacity-50" />
                  <p className="text-sm">
                    No revenue in this period. Try a wider time range.
                  </p>
                </div>
              ) : (
                <RevenueChart data={timeSeries} />
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading your analytics.";

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
