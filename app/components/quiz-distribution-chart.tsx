import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { QuizScoreBucket } from "~/services/analyticsService";

// Grouped bar chart of a single course's quiz-score distribution: three series
// (first / last / best attempt) across the five score buckets. Like the other
// dashboard charts, Recharts measures the DOM to size itself, so it can't render
// during SSR — we hold back until after hydration and show a same-height
// placeholder in the meantime to avoid a layout shift (and any hydration
// mismatch).

const CHART_HEIGHT = 280;

const SERIES = [
  { key: "first", label: "First attempt", color: "var(--color-chart-1)" },
  { key: "last", label: "Last attempt", color: "var(--color-chart-2)" },
  { key: "best", label: "Best attempt", color: "var(--color-chart-3)" },
] as const;

export function QuizDistributionChart({
  buckets,
}: {
  buckets: QuizScoreBucket[];
}) {
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
      <BarChart data={buckets} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis
          dataKey="range"
          tick={{ fontSize: 12 }}
          stroke="currentColor"
          className="text-muted-foreground"
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 12 }}
          width={40}
          stroke="currentColor"
          className="text-muted-foreground"
        />
        <Tooltip
          formatter={(value, name) => [
            `${Number(value)} ${Number(value) === 1 ? "response" : "responses"}`,
            name,
          ]}
          labelFormatter={(label) => `Score ${label}`}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {SERIES.map((series) => (
          <Bar
            key={series.key}
            dataKey={series.key}
            name={series.label}
            fill={series.color}
            radius={[4, 4, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
