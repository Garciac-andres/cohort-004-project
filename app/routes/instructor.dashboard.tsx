import { Link, data, isRouteErrorResponse } from "react-router";
import type { Route } from "./+types/instructor.dashboard";
import {
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  GraduationCap,
  Receipt,
  Users,
} from "lucide-react";
import { getCurrentUserId } from "~/lib/session";
import { getUserById } from "~/services/userService";
import { getCoursesByInstructor } from "~/services/courseService";
import {
  getInstructorEarnings,
  getInstructorStudents,
  getInstructorCompletion,
  getInstructorAverageQuizScore,
  getCourseQuizDistributions,
  type DashboardFilter,
} from "~/services/analyticsService";
import { CourseStatus, UserRole } from "~/db/schema";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { DashboardFilterBar } from "~/components/dashboard-filter-bar";
import { QuizDistributionChart } from "~/components/quiz-distribution-chart";

export function meta() {
  return [
    { title: "Executive Dashboard — Cadence" },
    {
      name: "description",
      content: "At-a-glance performance across all your courses",
    },
  ];
}

function formatDollars(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", {
    maximumFractionDigits: 0,
  })}`;
}

function formatCount(n: number) {
  return n.toLocaleString("en-US");
}

const VALID_STATUSES = Object.values(CourseStatus);

// Read the global filter from the URL query string. `status` is a comma list of
// course statuses (absent = all); `course` is a single course id (absent or
// "all" = all courses). Unknown values are ignored so a hand-edited URL can't
// throw. An empty `statuses` array means "all" (no narrowing) downstream.
function parseFilter(url: URL): DashboardFilter {
  const statusParam = url.searchParams.get("status");
  const statuses = statusParam
    ? statusParam
        .split(",")
        .filter((s): s is CourseStatus =>
          VALID_STATUSES.includes(s as CourseStatus)
        )
    : [];

  const courseParam = url.searchParams.get("course");
  const courseId =
    courseParam && courseParam !== "all" ? Number(courseParam) : null;

  return {
    statuses,
    courseId: courseId != null && Number.isInteger(courseId) ? courseId : null,
  };
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to view your dashboard.", {
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

  const filter = parseFilter(new URL(request.url));

  // All of the instructor's courses (every status) populate the course selector,
  // independent of the active filter.
  const courses = getCoursesByInstructor(currentUserId).map((course) => ({
    id: course.id,
    title: course.title,
  }));

  const earnings = getInstructorEarnings(currentUserId, filter);
  const students = getInstructorStudents(currentUserId, filter);
  const completion = getInstructorCompletion(currentUserId, filter);
  const averageQuizScore = getInstructorAverageQuizScore(currentUserId, filter);
  const quizDistributions = getCourseQuizDistributions(currentUserId, filter);

  return {
    earnings,
    students,
    completion,
    averageQuizScore,
    quizDistributions,
    courses,
    filter,
  };
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <Skeleton className="h-9 w-56" />
      <Skeleton className="mt-2 h-5 w-72" />
      <Skeleton className="mt-8 h-48 w-full max-w-md" />
    </div>
  );
}

// A single flow window (e.g. "Last 30 days") inside the Earnings card.
function EarningsWindowStat({
  label,
  earnings,
  paidPurchases,
}: {
  label: string;
  earnings: number;
  paidPurchases: number;
}) {
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{formatDollars(earnings)}</div>
      <div className="text-xs text-muted-foreground">
        {formatCount(paidPurchases)}{" "}
        {paidPurchases === 1 ? "purchase" : "purchases"}
      </div>
    </div>
  );
}

// A single growth window (e.g. "Last 30 days") inside the Students card.
function StudentGrowthStat({
  label,
  newEnrollments,
}: {
  label: string;
  newEnrollments: number;
}) {
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">
        +{formatCount(newEnrollments)}
      </div>
      <div className="text-xs text-muted-foreground">
        {newEnrollments === 1 ? "enrollment" : "enrollments"}
      </div>
    </div>
  );
}

export default function InstructorDashboard({
  loaderData,
}: Route.ComponentProps) {
  const {
    earnings,
    students,
    completion,
    averageQuizScore,
    quizDistributions,
    courses,
    filter,
  } = loaderData;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/instructor" className="hover:text-foreground">
          My Courses
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Executive Dashboard</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Executive Dashboard</h1>
        <p className="mt-1 text-muted-foreground">
          Performance across all your courses
        </p>
      </div>

      <DashboardFilterBar
        courses={courses}
        statuses={filter.statuses}
        courseId={filter.courseId}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="sm:col-span-2 lg:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Earnings
            </CardTitle>
            <DollarSign className="size-4 shrink-0 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {formatDollars(earnings.allTime.earnings)}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <Receipt className="size-3.5" />
              {formatCount(earnings.allTime.paidPurchases)} paid{" "}
              {earnings.allTime.paidPurchases === 1 ? "purchase" : "purchases"}{" "}
              all-time
            </div>

            <div className="mt-6 grid grid-cols-3 gap-4 border-t pt-4">
              <EarningsWindowStat
                label="Last 30 days"
                earnings={earnings.last30Days.earnings}
                paidPurchases={earnings.last30Days.paidPurchases}
              />
              <EarningsWindowStat
                label="Last 90 days"
                earnings={earnings.last90Days.earnings}
                paidPurchases={earnings.last90Days.paidPurchases}
              />
              <EarningsWindowStat
                label="Last 180 days"
                earnings={earnings.last180Days.earnings}
                paidPurchases={earnings.last180Days.paidPurchases}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Students
            </CardTitle>
            <Users className="size-4 shrink-0 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {formatCount(students.totalStudents)}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              enrolled {students.totalStudents === 1 ? "student" : "students"},
              all-time
            </div>

            <div className="mt-6 grid grid-cols-3 gap-4 border-t pt-4">
              <StudentGrowthStat
                label="Last 30 days"
                newEnrollments={students.newLast30Days}
              />
              <StudentGrowthStat
                label="Last 90 days"
                newEnrollments={students.newLast90Days}
              />
              <StudentGrowthStat
                label="Last 180 days"
                newEnrollments={students.newLast180Days}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Completion
            </CardTitle>
            <CheckCircle2 className="size-4 shrink-0 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {formatCount(completion.officialCompletions)}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              officially completed
            </div>

            <div className="mt-6 border-t pt-4">
              <div className="text-xs font-medium text-muted-foreground">
                Reached 100% of lessons
              </div>
              <div className="mt-1 text-lg font-semibold">
                {formatCount(completion.reached100)}
              </div>
              <div className="text-xs text-muted-foreground">
                {completion.reached100 === 1 ? "enrollment" : "enrollments"}{" "}
                finished every lesson
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Average quiz score
            </CardTitle>
            <GraduationCap className="size-4 shrink-0 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {averageQuizScore === null
                ? "—"
                : `${Math.round(averageQuizScore)}%`}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {averageQuizScore === null
                ? "no quiz attempts yet"
                : "across all quiz attempts"}
            </div>
          </CardContent>
        </Card>
      </div>

      <section className="mt-10">
        <h2 className="text-xl font-semibold">Quiz score distributions</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          First, last, and best attempt per student per quiz — to spot quizzes
          that are too hard or too easy.
        </p>

        {quizDistributions.length === 0 ? (
          <Card className="mt-4">
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              No quiz data for the selected courses yet.
            </CardContent>
          </Card>
        ) : (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {quizDistributions.map((dist) => (
              <Card key={dist.courseId}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{dist.courseTitle}</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {formatCount(dist.responseCount)} quiz{" "}
                    {dist.responseCount === 1 ? "response" : "responses"}
                  </p>
                </CardHeader>
                <CardContent>
                  <QuizDistributionChart buckets={dist.buckets} />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading your dashboard.";

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
