import { useState } from "react";
import { Star } from "lucide-react";
import { cn } from "~/lib/utils";

const STARS = [1, 2, 3, 4, 5];

type StarRatingProps = {
  /** Average rating (may be fractional, e.g. 4.3). */
  value: number;
  /** Number of ratings, rendered as "(N)" when provided. */
  count?: number;
  /** Tailwind size class for each star, e.g. "size-4". */
  sizeClassName?: string;
  /** Show the numeric average alongside the stars. */
  showValue?: boolean;
  className?: string;
};

/**
 * Read-only star display with fractional fill (e.g. 4.3 stars).
 * Renders a muted star row with a clipped golden overlay on top.
 */
export function StarRating({
  value,
  count,
  sizeClassName = "size-4",
  showValue = false,
  className,
}: StarRatingProps) {
  const clamped = Math.max(0, Math.min(5, value));
  const fillPercent = (clamped / 5) * 100;

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className="relative inline-flex" aria-hidden="true">
        {/* Empty (muted) stars */}
        <span className="flex">
          {STARS.map((s) => (
            <Star key={s} className={cn(sizeClassName, "text-muted-foreground/30")} />
          ))}
        </span>
        {/* Filled (golden) overlay, clipped to the average */}
        <span
          className="absolute inset-0 flex overflow-hidden"
          style={{ width: `${fillPercent}%` }}
        >
          {STARS.map((s) => (
            <Star
              key={s}
              className={cn(sizeClassName, "shrink-0 fill-yellow-400 text-yellow-400")}
            />
          ))}
        </span>
      </span>
      {showValue && (
        <span className="text-sm font-medium text-foreground">
          {clamped.toFixed(1)}
        </span>
      )}
      {count !== undefined && (
        <span className="text-xs text-muted-foreground">
          ({count})
        </span>
      )}
    </span>
  );
}

type InteractiveStarRatingProps = {
  /** Currently selected rating (0 = none). */
  value: number;
  onChange: (rating: number) => void;
  disabled?: boolean;
  sizeClassName?: string;
  className?: string;
};

/**
 * Clickable 1–5 star input with hover preview. Calls onChange with the
 * chosen rating; submission is the caller's responsibility.
 */
export function InteractiveStarRating({
  value,
  onChange,
  disabled = false,
  sizeClassName = "size-7",
  className,
}: InteractiveStarRatingProps) {
  const [hovered, setHovered] = useState(0);
  const active = hovered || value;

  return (
    <div
      className={cn("inline-flex items-center gap-1", className)}
      onMouseLeave={() => setHovered(0)}
      role="radiogroup"
      aria-label="Rate this course"
    >
      {STARS.map((s) => (
        <button
          key={s}
          type="button"
          disabled={disabled}
          role="radio"
          aria-checked={value === s}
          aria-label={`${s} star${s === 1 ? "" : "s"}`}
          onMouseEnter={() => !disabled && setHovered(s)}
          onClick={() => !disabled && onChange(s)}
          className={cn(
            "rounded-sm transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            !disabled && "hover:scale-110 cursor-pointer",
            disabled && "cursor-not-allowed opacity-60"
          )}
        >
          <Star
            className={cn(
              sizeClassName,
              s <= active
                ? "fill-yellow-400 text-yellow-400"
                : "text-muted-foreground/40"
            )}
          />
        </button>
      ))}
    </div>
  );
}
