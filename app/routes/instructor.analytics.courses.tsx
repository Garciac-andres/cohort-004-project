import { Link, data, isRouteErrorResponse } from "react-router";
import type { Route } from "./+types/instructor.analytics.courses";
import {
  AlertTriangle,
  BarChart3,
  DollarSign,
  GraduationCap,
  Plus,
  ShoppingCart,
  Users,
} from "lucide-react";
import { getCurrentUserId } from "~/lib/session";
import { getUserById } from "~/services/userService";
import { getCoursesByInstructor } from "~/services/courseService";
import { getEnrollmentCountForCourse } from "~/services/enrollmentService";
import { getCourseRevenueSummary } from "~/services/analyticsService";
import { CourseStatus, UserRole } from "~/db/schema";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";

export function meta() {
  return [
    { title: "Course Dashboards — Cadence" },
    { name: "description", content: "Pick a course to view its analytics" },
  ];
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

  // All-time headline figures per course so the picker doubles as a quick
  // cross-course snapshot. The deep dive (range filter, drop-off, quizzes)
  // lives on each course's own dashboard.
  const courses = getCoursesByInstructor(currentUserId).map((course) => {
    const revenue = getCourseRevenueSummary(course.id, null);
    return {
      id: course.id,
      title: course.title,
      status: course.status,
      totalRevenue: revenue.totalRevenue,
      salesCount: revenue.salesCount,
      studentCount: getEnrollmentCountForCourse(course.id),
    };
  });

  return { courses };
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case CourseStatus.Published:
      return (
        <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
          Published
        </span>
      );
    case CourseStatus.Draft:
      return (
        <span className="inline-flex items-center rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
          Draft
        </span>
      );
    case CourseStatus.Archived:
      return (
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-800 dark:bg-gray-900/30 dark:text-gray-400">
          Archived
        </span>
      );
    default:
      return null;
  }
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <Skeleton className="h-9 w-56" />
      <Skeleton className="mt-2 h-5 w-80" />
      <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="flex flex-col">
            <CardHeader>
              <Skeleton className="h-5 w-3/4" />
            </CardHeader>
            <CardContent className="flex-1">
              <Skeleton className="h-4 w-full" />
            </CardContent>
            <CardFooter>
              <Skeleton className="h-10 w-full" />
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function CourseDashboards({
  loaderData,
}: Route.ComponentProps) {
  const { courses } = loaderData;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/instructor" className="hover:text-foreground">
          My Courses
        </Link>
        <span className="mx-2">/</span>
        <Link to="/instructor/analytics" className="hover:text-foreground">
          Analytics
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">By Course</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Course Dashboards</h1>
        <p className="mt-1 text-muted-foreground">
          Pick a course to see its detailed analytics.
        </p>
      </div>

      {courses.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <GraduationCap className="mb-4 size-12 text-muted-foreground/50" />
          <h2 className="text-lg font-medium">No courses yet</h2>
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
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((course) => (
            <Card key={course.id} className="flex flex-col">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-lg leading-tight">
                    {course.title}
                  </CardTitle>
                  <StatusBadge status={course.status} />
                </div>
              </CardHeader>
              <CardContent className="flex-1">
                <dl className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="flex items-center gap-1 text-muted-foreground">
                      <DollarSign className="size-3.5" />
                      Revenue
                    </dt>
                    <dd className="mt-0.5 font-semibold">
                      {formatDollars(course.totalRevenue)}
                    </dd>
                  </div>
                  <div>
                    <dt className="flex items-center gap-1 text-muted-foreground">
                      <ShoppingCart className="size-3.5" />
                      Sales
                    </dt>
                    <dd className="mt-0.5 font-semibold">
                      {course.salesCount.toLocaleString("en-US")}
                    </dd>
                  </div>
                  <div>
                    <dt className="flex items-center gap-1 text-muted-foreground">
                      <Users className="size-3.5" />
                      Students
                    </dt>
                    <dd className="mt-0.5 font-semibold">
                      {course.studentCount.toLocaleString("en-US")}
                    </dd>
                  </div>
                </dl>
              </CardContent>
              <CardFooter>
                <Link to={`/instructor/${course.id}/analytics`} className="w-full">
                  <Button className="w-full" variant="outline">
                    <BarChart3 className="mr-2 size-4" />
                    View Dashboard
                  </Button>
                </Link>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading your dashboards.";

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
