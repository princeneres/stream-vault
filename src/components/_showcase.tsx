// Reference catalog of every component variant. Not routed in the app —
// the Frontend Engineer can `import Showcase from "@/components/_showcase"`
// to verify what exists and how it looks.

import { Home, Library, Plus, Settings as SettingsIcon } from "lucide-react";
import Button from "./Button";
import EmptyState from "./EmptyState";
import GroupCard from "./GroupCard";
import IconButton from "./IconButton";
import Input from "./Input";
import ItemCard from "./ItemCard";
import KindIcon from "./KindIcon";
import LibrarySection from "./LibrarySection";
import Modal from "./Modal";
import MovieCard from "./MovieCard";
import ProgressBar from "./ProgressBar";
import Select from "./Select";
import Sidebar from "./Sidebar";

export default function Showcase() {
  return (
    <div className="flex h-screen bg-(--color-bg) text-(--color-text-primary)">
      <Sidebar
        items={[
          { id: "home", label: "Home", icon: <Home size={14} /> },
          {
            id: "courses",
            label: "Rust Courses",
            icon: <KindIcon kind="courses" />,
            badge: 12,
          },
          { id: "settings", label: "Settings", icon: <SettingsIcon size={14} /> },
        ]}
        activeId="home"
        onSelect={() => {}}
        onSearch={() => {}}
      />
      <main className="flex-1 overflow-y-auto px-8 py-6 space-y-10">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Buttons</h2>
          <div className="flex flex-wrap gap-3">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="primary" leadingIcon={<Plus size={14} />}>
              Add library
            </Button>
            <Button variant="primary" disabled>
              Disabled
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <IconButton icon={<Plus size={16} />} tooltip="Add" />
            <IconButton icon={<Plus size={16} />} variant="primary" tooltip="Add" />
            <IconButton icon={<Plus size={16} />} variant="danger" tooltip="Delete" />
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Form controls</h2>
          <div className="flex flex-wrap items-center gap-4">
            <Input placeholder="Library name" />
            <Select
              options={[
                { value: "courses", label: "Courses" },
                { value: "series", label: "Series" },
                { value: "movies", label: "Movies" },
                { value: "generic", label: "Generic" },
              ]}
            />
          </div>
          <div className="max-w-xs space-y-2">
            <ProgressBar value={0.45} />
            <ProgressBar value={1} tone="success" size="sm" />
            <ProgressBar value={0.1} tone="muted" />
          </div>
        </section>

        <LibrarySection title="Continue Watching">
          <ItemCard
            title="Rust ownership in 10 minutes"
            subtitle="Rust Course — Module 2"
            progressPercent={42}
            onClick={() => {}}
          />
          <ItemCard
            title="React 19 hooks tour"
            subtitle="Frontend Course — Module 1"
            progressPercent={87}
            onClick={() => {}}
          />
          <ItemCard.Skeleton />
        </LibrarySection>

        <LibrarySection title="Courses">
          <div className="grid w-full grid-cols-3 gap-4">
            <GroupCard
              title="Rust Programming"
              kind="courses"
              completedCount={12}
              totalCount={47}
              onClick={() => {}}
            />
            <GroupCard
              title="Breaking Hexapods"
              kind="series"
              nextEpisode="S02E04"
              onClick={() => {}}
            />
            <GroupCard.Skeleton />
          </div>
        </LibrarySection>

        <LibrarySection title="Movies">
          <div className="grid w-full grid-cols-4 gap-4">
            <MovieCard title="Test Drive" status="unwatched" />
            <MovieCard
              title="Rebuilding Babel"
              status="in-progress"
              progressPercent={30}
              durationLabel="1h 42m"
            />
            <MovieCard title="The Final Commit" status="watched" />
            <MovieCard.Skeleton />
          </div>
        </LibrarySection>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">EmptyState</h2>
          <EmptyState
            icon={<Library size={20} />}
            title="No libraries yet"
            description="Add a folder to start watching."
            action={<Button variant="primary">Add library</Button>}
          />
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Modal</h2>
          <Modal open={false} onClose={() => {}} title="Modal example">
            Body content here.
          </Modal>
          <p className="text-sm text-(--color-text-secondary)">
            (Open=false in the showcase; Frontend Eng triggers it when needed.)
          </p>
        </section>
      </main>
    </div>
  );
}
