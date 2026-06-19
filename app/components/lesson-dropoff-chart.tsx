import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { LessonDropoff } from "~/services/analyticsService";

// Per-lesson completion chart for the per-course analytics tab. Like
// RevenueChart, Recharts measures the DOM to size itself, so it can't render
// during SSR — we hold back until after hydration and show a same-height
// placeholder in the meantime to avoid a layout shift (and any hydration
// mismatch). Lessons are passed in module/position order; X is the (truncated)
// lesson title, Y is completion 0–100%.

const CHART_HEIGHT = 320;

function truncateTitle(title: string) {
  return title.length > 18 ? `${title.slice(0, 17)}…` : title;
}

export function LessonDropoffChart({ data }: { data: LessonDropoff[] }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div
        className="w-full animate-pulse rounded-md bg-muted/50"
        style={{ height: CHART_HEIGHT }}
      />
    );
  }

  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis
          dataKey="title"
          tickFormatter={truncateTitle}
          tick={{ fontSize: 12 }}
          interval={0}
          angle={-30}
          textAnchor="end"
          height={64}
          stroke="currentColor"
          className="text-muted-foreground"
        />
        <YAxis
          domain={[0, 100]}
          tickFormatter={(value) => `${value}%`}
          tick={{ fontSize: 12 }}
          width={48}
          stroke="currentColor"
          className="text-muted-foreground"
        />
        <Tooltip
          formatter={(value) => [`${Number(value).toFixed(0)}%`, "Completion"]}
        />
        <Bar
          dataKey="completionPct"
          fill="var(--color-primary)"
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
