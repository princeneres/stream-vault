import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { leadingIcon, trailingIcon, className, ...rest },
  ref,
) {
  return (
    <div
      className={cn(
        "flex h-9 items-center gap-2 rounded-(--radius-control) bg-(--color-surface-raised) px-3",
        "border border-(--color-border-subtle) focus-within:border-(--color-accent) focus-within:ring-2 focus-within:ring-(--color-accent-soft)",
        "transition-colors",
        className,
      )}
    >
      {leadingIcon ? (
        <span className="flex shrink-0 text-(--color-text-muted)">{leadingIcon}</span>
      ) : null}
      <input
        ref={ref}
        className={cn(
          "min-w-0 flex-1 bg-transparent text-sm text-(--color-text-primary) outline-none",
          "placeholder:text-(--color-text-muted)",
        )}
        {...rest}
      />
      {trailingIcon ? (
        <span className="flex shrink-0 text-(--color-text-muted)">{trailingIcon}</span>
      ) : null}
    </div>
  );
});

export default Input;
