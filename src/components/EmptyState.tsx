import type { ReactNode } from "react";
import { cn } from "./cn";

export interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export default function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-(--radius-card-lg)",
        "border border-dashed border-(--color-border-subtle) bg-(--color-surface)/40 px-8 py-12 text-center",
        className,
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-(--radius-pill) bg-(--color-surface-raised) text-(--color-text-secondary)">
        {icon}
      </div>
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-(--color-text-primary)">{title}</h3>
        {description ? (
          <p className="text-sm text-(--color-text-secondary)">{description}</p>
        ) : null}
      </div>
      {action ? <div>{action}</div> : null}
    </div>
  );
}
