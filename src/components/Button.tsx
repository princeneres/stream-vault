import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  fullWidth?: boolean;
}

const variantClass: Record<Variant, string> = {
  primary:
    "glow-accent bg-(--color-accent) text-(--color-text-inverse) hover:bg-(--color-accent-hover) active:bg-(--color-accent-active)",
  secondary:
    "bg-(--color-surface-raised) text-(--color-text-primary) hover:bg-(--color-surface-hover) border border-(--color-border-subtle)",
  ghost:
    "bg-transparent text-(--color-text-primary) hover:bg-(--color-surface-raised)",
  danger:
    "bg-(--color-danger) text-(--color-text-inverse) hover:bg-(--color-danger-hover)",
};

const sizeClass: Record<Size, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
  lg: "h-11 px-5 text-base gap-2.5",
};

export default function Button({
  variant = "primary",
  size = "md",
  leadingIcon,
  trailingIcon,
  fullWidth,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center rounded-(--radius-control) font-medium",
        "transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--color-bg)",
        variantClass[variant],
        sizeClass[size],
        fullWidth && "w-full",
        className,
      )}
      {...rest}
    >
      {leadingIcon ? <span className="flex shrink-0">{leadingIcon}</span> : null}
      {children ? <span>{children}</span> : null}
      {trailingIcon ? <span className="flex shrink-0">{trailingIcon}</span> : null}
    </button>
  );
}
