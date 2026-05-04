export type ClassValue =
  | string
  | number
  | null
  | undefined
  | false
  | ClassValue[]
  | { [key: string]: boolean | null | undefined };

export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];
  const walk = (v: ClassValue) => {
    if (!v) return;
    if (typeof v === "string" || typeof v === "number") {
      out.push(String(v));
      return;
    }
    if (Array.isArray(v)) {
      for (const i of v) walk(i);
      return;
    }
    if (typeof v === "object") {
      for (const k in v) {
        if (v[k]) out.push(k);
      }
    }
  };
  for (const i of inputs) walk(i);
  return out.join(" ");
}
