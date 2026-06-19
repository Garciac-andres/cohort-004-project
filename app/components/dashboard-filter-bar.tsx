import { useSearchParams } from "react-router";
import { CourseStatus } from "~/db/schema";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

// The global dashboard filter bar (GitHub #6). Purely URL-driven: it never holds
// its own state — every control reads the active selection from props (derived
// from the loader, which reads the URL) and writes back to the query string, so
// the loader re-runs and re-scopes every KPI together. A bookmarked/shared URL
// reproduces the same scoped view on load.
//
// This is a client component: it must not import the analytics service (which
// touches the DB). The course list arrives via props from loader data.

const STATUS_LABELS: Record<CourseStatus, string> = {
  [CourseStatus.Draft]: "Draft",
  [CourseStatus.Published]: "Published",
  [CourseStatus.Archived]: "Archived",
};

const ALL_STATUSES = Object.values(CourseStatus);

export type DashboardFilterBarProps = {
  courses: { id: number; title: string }[];
  // The active selection. An empty `statuses` array means "all statuses".
  statuses: CourseStatus[];
  courseId: number | null;
};

export function DashboardFilterBar({
  courses,
  statuses,
  courseId,
}: DashboardFilterBarProps) {
  const [, setSearchParams] = useSearchParams();

  // Empty selection means "all", so every box shows checked by default.
  const isChecked = (status: CourseStatus) =>
    statuses.length === 0 || statuses.includes(status);

  function toggleStatus(status: CourseStatus, checked: boolean) {
    const current = statuses.length === 0 ? [...ALL_STATUSES] : statuses;
    const next = checked
      ? [...new Set([...current, status])]
      : current.filter((s) => s !== status);

    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        // All (or none) selected collapses to the default "all" view — drop the
        // param so the URL stays clean and shareable.
        if (next.length === 0 || next.length === ALL_STATUSES.length) {
          params.delete("status");
        } else {
          params.set("status", next.join(","));
        }
        return params;
      },
      { replace: true }
    );
  }

  function selectCourse(value: string) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (value === "all") {
          params.delete("course");
        } else {
          params.set("course", value);
        }
        return params;
      },
      { replace: true }
    );
  }

  return (
    <div className="mb-6 flex flex-col gap-4 rounded-lg border bg-card p-4 sm:flex-row sm:items-end sm:justify-between">
      <fieldset className="min-w-0">
        <legend className="mb-2 text-xs font-medium text-muted-foreground">
          Course status
        </legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {ALL_STATUSES.map((status) => (
            <label
              key={status}
              className="flex cursor-pointer items-center gap-2 text-sm"
            >
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={isChecked(status)}
                onChange={(event) => toggleStatus(status, event.target.checked)}
              />
              {STATUS_LABELS[status]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <Label htmlFor="course-filter" className="text-xs text-muted-foreground">
          Course
        </Label>
        <Select
          value={courseId == null ? "all" : String(courseId)}
          onValueChange={selectCourse}
        >
          <SelectTrigger id="course-filter" className="w-full sm:w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All courses</SelectItem>
            {courses.map((course) => (
              <SelectItem key={course.id} value={String(course.id)}>
                {course.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
