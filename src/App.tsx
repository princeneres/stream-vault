import { useCallback, useEffect, useState } from "react";
import { Home as HomeIcon, Settings as SettingsIcon } from "lucide-react";
import KindIcon from "@/components/KindIcon";
import Sidebar, { type SidebarItem } from "@/components/Sidebar";
import { listLibraries, onItemProgress } from "@/lib/api";
import type { Library } from "@/lib/types";
import DetailView from "@/views/DetailView";
import Home from "@/views/Home";
import LibraryView from "@/views/LibraryView";
import Settings from "@/views/Settings";

type View =
  | { kind: "home" }
  | { kind: "library"; id: number }
  | { kind: "group"; id: number }
  | { kind: "settings" };

export default function App() {
  const [view, setView] = useState<View>({ kind: "home" });
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [progressTick, setProgressTick] = useState(0);

  const refreshLibraries = useCallback(async () => {
    try {
      const libs = await listLibraries();
      setLibraries(libs);
    } catch (e) {
      console.error("listLibraries failed", e);
    }
  }, []);

  useEffect(() => {
    refreshLibraries();
  }, [refreshLibraries]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    onItemProgress(() => {
      setProgressTick((t) => t + 1);
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((e) => console.error("onItemProgress subscribe failed", e));
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  const sidebarItems: SidebarItem[] = [
    { id: "home", label: "Home", icon: <HomeIcon size={14} /> },
    ...libraries.map((lib) => ({
      id: `library:${lib.id}`,
      label: lib.name,
      icon: <KindIcon kind={lib.kind} size={14} />,
    })),
    { id: "settings", label: "Settings", icon: <SettingsIcon size={14} /> },
  ];

  const activeId =
    view.kind === "home"
      ? "home"
      : view.kind === "settings"
        ? "settings"
        : view.kind === "library"
          ? `library:${view.id}`
          : null;

  const handleSelect = (id: string) => {
    if (id === "home") setView({ kind: "home" });
    else if (id === "settings") setView({ kind: "settings" });
    else if (id.startsWith("library:")) {
      const libId = Number(id.slice("library:".length));
      if (!Number.isNaN(libId)) setView({ kind: "library", id: libId });
    }
  };

  return (
    <div className="flex h-screen bg-(--color-bg) text-(--color-text-primary)">
      <Sidebar
        items={sidebarItems}
        activeId={activeId}
        onSelect={handleSelect}
      />
      <main className="flex-1 overflow-y-auto">
        {view.kind === "home" ? (
          <Home
            libraries={libraries}
            onOpenLibrary={(id) => setView({ kind: "library", id })}
            onOpenGroup={(id) => setView({ kind: "group", id })}
            progressTick={progressTick}
          />
        ) : view.kind === "library" ? (
          <LibraryView
            libraryId={view.id}
            onOpenGroup={(id) => setView({ kind: "group", id })}
            progressTick={progressTick}
          />
        ) : view.kind === "group" ? (
          <DetailView groupId={view.id} progressTick={progressTick} />
        ) : (
          <Settings onLibrariesChanged={refreshLibraries} />
        )}
      </main>
    </div>
  );
}
