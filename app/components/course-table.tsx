import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import type { CourseTableRow } from "~/services/analyticsService";
import { CourseStatus } from "~/db/schema";

// The per-course master table: one sortable row per in-scope course. The rows
// arrive already scoped by the global dashboard filter (via loader data); this
// component only sorts and renders them, so it holds no server data of its own.
// Sorting is client-side and purely presentational — clicking a column header
// re-orders the rows in place without re-running the loader.

const STATUS_LABELS: Record<CourseStatus, string> = {
  [CourseStatus.Draft]: "Draft",
  [CourseStatus.Published]: "Published",
  [CourseStatus.Archived]: "Archived",
};

const STATUS_STYLES: Record<CourseStatus, string> = {
  [CourseStatus.Draft]: "bg-muted text-muted-foreground",
  [CourseStatus.Published]: "bg-primary/10 text-primary",
  [CourseStatus.Archived]: "bg-destructive/10 text-destructive",
};

// Columns the table can sort by, paired with the value each extracts from a row.
// `numeric` controls the default direction (numbers default high→low, text a→z)
// and the cell alignment.
type SortKey =
  | "courseTitle"
  | "status"
  | "students"
  | "earnings"
  | "completionPct"
  | "reached100"
  | "worstDropPct";

const COLUMNS: {
  key: SortKey;
  label: string;
  numeric: boolean;
}[] = [
  { key: "courseTitle", label: "Course", numeric: false },
  { key: "status", label: "Status", numeric: false },
  { key: "students", label: "Students", numeric: true },
  { key: "earnings", label: "Earnings", numeric: true },
  { key: "completionPct", label: "Completed %", numeric: true },
  { key: "reached100", label: "Reached 100%", numeric: true },
  { key: "worstDropPct", label: "Worst drop-off", numeric: true },
];

function sortValue(row: CourseTableRow, key: SortKey): string | number {
  switch (key) {
    case "courseTitle":
      return row.courseTitle.toLowerCase();
    case "status":
      return STATUS_LABELS[row.status];
    case "worstDropPct":
      return row.worstDropPct ?? -1; // courses with no funnel sort below any drop
    default:
      return row[key];
  }
}

function formatDollars(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", {
    maximumFractionDigits: 0,
  })}`;
}

function formatPct(pct: number) {
  return `${Math.round(pct)}%`;
}

export function CourseTable({ rows }: { rows: CourseTableRow[] }) {
  // Default to the metric instructors usually open the table for: earnings, high
  // to low.
  const [sortKey, setSortKey] = useState<SortKey>("earnings");
  const [descending, setDescending] = useState(true);

  function toggleSort(key: SortKey, numeric: boolean) {
    if (key === sortKey) {
      setDescending((prev) => !prev);
    } else {
      setSortKey(key);
      // Numbers feel natural high→low; text a→z.
      setDescending(numeric);
    }
  }

  const sorted = [...rows].sort((a, b) => {
    const av = sortValue(a, sortKey);
    const bv = sortValue(b, sortKey);
    if (av < bv) return descending ? 1 : -1;
    if (av > bv) return descending ? -1 : 1;
    // Stable tiebreaker so ties keep a deterministic order.
    return a.courseId - b.courseId;
  });

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border bg-card py-12 text-center text-sm text-muted-foreground">
        No courses match the selected filter.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-left">
            {COLUMNS.map((column) => (
              <th
                key={column.key}
                className={`px-3 py-2 font-medium ${
                  column.numeric ? "text-right" : "text-left"
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleSort(column.key, column.numeric)}
                  className={`inline-flex items-center gap-1 hover:text-foreground ${
                    column.numeric ? "flex-row-reverse" : ""
                  } ${sortKey === column.key ? "text-foreground" : "text-muted-foreground"}`}
                >
                  {column.label}
                  <SortIcon active={sortKey === column.key} descending={descending} />
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.courseId} className="border-b last:border-0">
              <td className="max-w-[220px] px-3 py-2 font-medium">
                <span className="block truncate" title={row.courseTitle}>
                  {row.courseTitle}
                </span>
              </td>
              <td className="px-3 py-2">
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[row.status]}`}
                >
                  {STATUS_LABELS[row.status]}
                </span>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {row.students.toLocaleString("en-US")}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatDollars(row.earnings)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatPct(row.completionPct)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {row.reached100.toLocaleString("en-US")}
              </td>
              <td className="px-3 py-2 text-right">
                {row.worstDropLessonTitle === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span
                    className="block truncate tabular-nums"
                    title={row.worstDropLessonTitle}
                  >
                    {row.worstDropLessonTitle}
                    <span className="ml-1 text-muted-foreground">
                      (−{formatPct(row.worstDropPct ?? 0)})
                    </span>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SortIcon({
  active,
  descending,
}: {
  active: boolean;
  descending: boolean;
}) {
  if (!active) return <ChevronsUpDown className="size-3.5 opacity-50" />;
  return descending ? (
    <ArrowDown className="size-3.5" />
  ) : (
    <ArrowUp className="size-3.5" />
  );
}
