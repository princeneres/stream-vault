import { forwardRef, type SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "./cn";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> {
  options: SelectOption[];
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, className, ...rest },
  ref,
) {
  return (
    <div className="relative inline-flex">
      <select
        ref={ref}
        className={cn(
          "h-9 appearance-none rounded-(--radius-control) bg-(--color-surface-raised) pl-3 pr-9 text-sm",
          "border border-(--color-border-subtle) text-(--color-text-primary)",
          "focus-visible:outline-none focus-visible:border-(--color-accent) focus-visible:ring-2 focus-visible:ring-(--color-accent-soft)",
          "transition-colors",
          className,
        )}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-(--color-surface)">
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-(--color-text-muted)"
      />
    </div>
  );
});

export default Select;
