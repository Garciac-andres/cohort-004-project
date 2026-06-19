import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { RevenuePoint } from "~/services/analyticsService";

// Revenue trend chart for the instructor analytics overview. Recharts measures
// the DOM to size itself, so it cannot render during SSR — we hold back until
// after hydration and show a same-height placeholder in the meantime to avoid a
// layout shift (and any hydration mismatch).

const CHART_HEIGHT = 320;

// `revenue` is integer cents; format axis/tooltip as whole dollars.
function formatDollars(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", {
    maximumFractionDigits: 0,
  })}`;
}

function formatDate(iso: string) {
  // Points are `date(createdAt)` → "YYYY-MM-DD"; show a compact "Mon D".
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function RevenueChart({ data }: { data: RevenuePoint[] }) {
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
      <LineChart
        data={data}
        margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
      >
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis
          dataKey="date"
          tickFormatter={formatDate}
          tick={{ fontSize: 12 }}
          stroke="currentColor"
          className="text-muted-foreground"
        />
        <YAxis
          tickFormatter={formatDollars}
          tick={{ fontSize: 12 }}
          width={72}
          stroke="currentColor"
          className="text-muted-foreground"
        />
        <Tooltip
          formatter={(value) => [formatDollars(Number(value)), "Revenue"]}
          labelFormatter={(label) => formatDate(String(label))}
        />
        <Line
          type="monotone"
          dataKey="revenue"
          stroke="var(--color-primary)"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
