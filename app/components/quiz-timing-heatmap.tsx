import type { QuizTimingHeatmap } from "~/services/analyticsService";
import { ANALYTICS_TIMEZONE } from "~/services/analyticsService";

// A hand-rolled CSS-grid heatmap of when students attempt quizzes: 7 rows
// (days, Sun→Sat) × 24 columns (hours, 0→23), each cell shaded by how many
// attempts fell in that day/hour bucket. This is deliberately *not* a Recharts
// chart type — it is a plain grid of shaded `<td>`-like cells, so it renders the
// same on the server and the client (no post-hydration mounting needed). Times
// are pre-bucketed in `ANALYTICS_TIMEZONE` by the analytics service; this
// component only paints the grid it is given.

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Show an hour tick every three hours to keep the axis legible.
const HOUR_TICKS = [0, 3, 6, 9, 12, 15, 18, 21];

function hourLabel(hour: number): string {
  if (hour === 0) return "12a";
  if (hour === 12) return "12p";
  return hour < 12 ? `${hour}a` : `${hour - 12}p`;
}

// Map a cell's count to a background. 0 stays as the muted track so empty cells
// read as "nothing here"; non-zero counts ramp opacity by share of the busiest
// cell so the hottest hour is fully saturated and the rest scale beneath it.
function cellStyle(count: number, max: number): React.CSSProperties {
  if (count === 0) return {};
  const intensity = 0.15 + 0.85 * (count / max);
  return { backgroundColor: `color-mix(in oklab, var(--color-primary) ${Math.round(intensity * 100)}%, transparent)` };
}

export function QuizTimingHeatmap({ heatmap }: { heatmap: QuizTimingHeatmap }) {
  const { grid, totalAttempts } = heatmap;

  if (totalAttempts === 0) {
    return (
      <div className="flex h-48 flex-col items-center justify-center text-center text-sm text-muted-foreground">
        <p>No quiz attempts for the selected courses yet.</p>
        <p className="mt-1 text-xs">
          Times are shown in {ANALYTICS_TIMEZONE.replace("_", " ")}.
        </p>
      </div>
    );
  }

  const max = Math.max(...grid.flat());

  return (
    <div className="overflow-x-auto">
      {/* Grid: a leading label column + 24 equal hour columns. */}
      <div
        className="grid min-w-[640px] gap-1"
        style={{ gridTemplateColumns: "auto repeat(24, minmax(0, 1fr))" }}
      >
        {/* Top-left spacer, then the hour-axis ticks. */}
        <div />
        {Array.from({ length: 24 }, (_, hour) => (
          <div
            key={hour}
            className="text-center text-[10px] leading-none text-muted-foreground"
          >
            {HOUR_TICKS.includes(hour) ? hourLabel(hour) : ""}
          </div>
        ))}

        {DAY_LABELS.map((label, day) => (
          <Row key={label} label={label} counts={grid[day]} max={max} />
        ))}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Based on {totalAttempts.toLocaleString("en-US")} quiz{" "}
        {totalAttempts === 1 ? "attempt" : "attempts"}, bucketed by hour in{" "}
        {ANALYTICS_TIMEZONE.replace("_", " ")}.
      </p>
    </div>
  );
}

function Row({
  label,
  counts,
  max,
}: {
  label: string;
  counts: number[];
  max: number;
}) {
  return (
    <>
      <div className="flex items-center pr-2 text-xs font-medium text-muted-foreground">
        {label}
      </div>
      {counts.map((count, hour) => (
        <div
          key={hour}
          className="aspect-square rounded-sm bg-muted/50"
          style={cellStyle(count, max)}
          title={`${label} ${hourLabel(hour)} — ${count} ${
            count === 1 ? "attempt" : "attempts"
          }`}
        />
      ))}
    </>
  );
}
