import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, AlertCircle, Info } from "lucide-react";
import { cn } from "./cn";

export type ToastTone = "success" | "error" | "info";

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  /** Set while the exit animation plays, just before removal. */
  leaving?: boolean;
}

const EXIT_MS = 120; // keep in sync with --duration-fast / .animate-toast-out

interface ToastContextValue {
  push: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_CLASS: Record<ToastTone, string> = {
  success:
    "border-(--color-border-subtle) bg-(--color-surface-raised) text-(--color-text-primary)",
  error:
    "border-(--color-danger) bg-(--color-danger) text-(--color-text-inverse)",
  info:
    "border-(--color-border-subtle) bg-(--color-surface-raised) text-(--color-text-primary)",
};

const TONE_ICON: Record<ToastTone, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  // Trigger the exit animation, then remove the toast once it finishes.
  const dismiss = useCallback((id: number) => {
    const handle = timers.current.get(id);
    if (handle) {
      clearTimeout(handle);
      timers.current.delete(id);
    }
    setToasts((t) => t.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    const removeHandle = setTimeout(() => {
      timers.current.delete(id);
      setToasts((t) => t.filter((x) => x.id !== id));
    }, EXIT_MS);
    timers.current.set(id, removeHandle);
  }, []);

  const push = useCallback(
    (message: string, tone: ToastTone = "success") => {
      const id = ++seq.current;
      setToasts((t) => [...t, { id, message, tone }]);
      const handle = setTimeout(() => dismiss(id), 4000);
      timers.current.set(id, handle);
    },
    [dismiss],
  );

  // Clear any pending dismissal timers when the provider unmounts.
  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const handle of map.values()) clearTimeout(handle);
      map.clear();
    };
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="region"
        aria-label="Notifications"
        className="pointer-events-none fixed bottom-6 right-6 z-(--z-toast) flex flex-col gap-2"
      >
        {toasts.map((t) => {
          const Icon = TONE_ICON[t.tone];
          return (
            <button
              key={t.id}
              type="button"
              role={t.tone === "error" ? "alert" : "status"}
              aria-live={t.tone === "error" ? "assertive" : "polite"}
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className={cn(
                "pointer-events-auto flex items-start gap-2 rounded-(--radius-card) border px-4 py-2 text-left text-sm shadow-(--shadow-modal) transition-opacity hover:opacity-90",
                t.leaving
                  ? "motion-safe:animate-toast-out"
                  : "motion-safe:animate-toast-in",
                TONE_CLASS[t.tone],
              )}
            >
              <Icon size={16} aria-hidden className="mt-0.5 shrink-0" />
              <span>{t.message}</span>
            </button>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
