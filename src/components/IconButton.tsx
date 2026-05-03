import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

type Size = "sm" | "md";

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: ReactNode;
  tooltip?: string;
  size?: Size;
  variant?: "ghost" | "primary" | "danger";
}

const sizeClass: Record<Size, string> = {
  sm: "h-7 w-7",
  md: "h-9 w-9",
};

const variantClass = {
  ghost:
    "bg-transparent text-(--color-text-secondary) hover:bg-(--color-surface-raised) hover:text-(--color-text-primary)",
  primary:
    "bg-(--color-accent) text-(--color-text-inverse) hover:bg-(--color-accent-hover)",
  danger:
    "bg-(--color-danger-soft) text-(--color-danger) hover:bg-(--color-danger) hover:text-(--color-text-inverse)",
};

export default function IconButton({
  icon,
  tooltip,
  size = "md",
  variant = "ghost",
  className,
  type = "button",
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      title={tooltip}
      aria-label={tooltip ?? rest["aria-label"]}
      className={cn(
        "inline-flex items-center justify-center rounded-(--radius-control)",
        "transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent)",
        sizeClass[size],
        variantClass[variant],
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
}
