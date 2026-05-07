import { cn } from "./cn";

export interface ProgressBarProps {
  value: number;
  size?: "sm" | "md";
  tone?: "accent" | "success" | "muted";
  className?: string;
}

export default function ProgressBar({
  value,
  size = "md",
  tone = "accent",
  className,
}: ProgressBarProps) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const heightClass = size === "sm" ? "h-1" : "h-1.5";
  const nearComplete = tone === "accent" && pct >= 90;
  const toneClass =
    tone === "success" || nearComplete
      ? "bg-(--color-success)"
      : tone === "muted"
        ? "bg-(--color-text-muted)"
        : "bg-(--color-accent)";
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className={cn(
        "w-full overflow-hidden rounded-(--radius-pill) bg-(--color-border-subtle)",
        heightClass,
        className,
      )}
    >
      <div
        className={cn(
          "h-full rounded-(--radius-pill) motion-safe:transition-[width,background-color] motion-safe:duration-300",
          toneClass,
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
