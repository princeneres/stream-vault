import { Film, Folder, GraduationCap, Tv } from "lucide-react";
import type { LibraryKind } from "@/lib/types";

export interface KindIconProps {
  kind: LibraryKind;
  size?: number;
  className?: string;
}

export default function KindIcon({ kind, size = 16, className }: KindIconProps) {
  const Icon =
    kind === "courses"
      ? GraduationCap
      : kind === "series"
        ? Tv
        : kind === "movies"
          ? Film
          : Folder;
  return <Icon size={size} className={className} aria-hidden />;
}
