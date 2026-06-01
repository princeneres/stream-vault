import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Maximize,
  Minimize,
  Pause,
  Play,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import IconButton from "./IconButton";
import { cn } from "./cn";
import {
  convertFileSrc,
  getItem,
  getNextItem,
  getSetting,
  reportProgress,
} from "@/lib/api";
import type { PlayerControls } from "@/lib/player";
import type { ItemWithProgress } from "@/lib/types";

const REPORT_INTERVAL_MS = 3000;
const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

export interface PlayerRequest {
  itemId: number;
  startSeconds?: number;
  /** Bumped on every `play()` call so replaying the same item re-seeks. */
  seq: number;
}

export interface PlayerOverlayProps {
  request: PlayerRequest;
  onClose: () => void;
  /** Registers/clears the imperative handle used by Alt+N note capture. */
  registerControls: (controls: PlayerControls | null) => void;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export default function PlayerOverlay({
  request,
  onClose,
  registerControls,
}: PlayerOverlayProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // The item currently loaded into <video>. Starts at the requested item and
  // changes on auto-advance without touching the parent's request.
  const [current, setCurrent] = useState<{ itemId: number; start?: number }>({
    itemId: request.itemId,
    start: request.startSeconds,
  });
  const [item, setItem] = useState<ItemWithProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const lastReportRef = useRef(0);

  // Reset to the requested item whenever the parent issues a new play().
  useEffect(() => {
    setCurrent({ itemId: request.itemId, start: request.startSeconds });
  }, [request.itemId, request.seq, request.startSeconds]);

  // Resolve the item to play (file path + resume position).
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setItem(null);
    getItem(current.itemId)
      .then((it) => {
        if (!cancelled) setItem(it);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [current.itemId]);

  const resumeSeconds =
    current.start ?? item?.progress?.positionSeconds ?? 0;

  const flushProgress = useCallback(() => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.duration)) return;
    reportProgress(current.itemId, v.currentTime, v.duration).catch((e) =>
      console.error("reportProgress failed", e),
    );
  }, [current.itemId]);

  // Register imperative controls for app-level note capture.
  useEffect(() => {
    registerControls({
      itemId: current.itemId,
      getCurrentTime: () => videoRef.current?.currentTime ?? 0,
      pause: () => videoRef.current?.pause(),
      resume: () => {
        videoRef.current?.play().catch(() => {});
      },
      seek: (seconds: number) => {
        const v = videoRef.current;
        if (!v) return;
        v.currentTime = seconds;
        setPosition(seconds);
      },
    });
    return () => registerControls(null);
  }, [current.itemId, registerControls]);

  // Final save when the overlay unmounts.
  useEffect(() => {
    return () => flushProgress();
  }, [flushProgress]);

  useEffect(() => {
    const onFsChange = () =>
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setDuration(v.duration);
    if (resumeSeconds > 0 && resumeSeconds < v.duration) {
      v.currentTime = resumeSeconds;
    }
    v.playbackRate = rate;
    v.play().catch(() => {});
  }, [resumeSeconds, rate]);

  const handleTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setPosition(v.currentTime);
    const now = performance.now();
    if (now - lastReportRef.current >= REPORT_INTERVAL_MS) {
      lastReportRef.current = now;
      flushProgress();
    }
  }, [flushProgress]);

  const handleEnded = useCallback(async () => {
    flushProgress();
    try {
      const autoAdvance = (await getSetting("auto_advance")) === "true";
      const groupId = item?.groupId;
      if (!autoAdvance || groupId == null) return;
      const next = await getNextItem(groupId);
      if (next && next.id !== current.itemId) {
        setCurrent({ itemId: next.id, start: 0 });
      }
    } catch (e) {
      console.error("auto-advance failed", e);
    }
  }, [flushProgress, item, current.itemId]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  const handleScrub = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (!v) return;
    const t = Number(e.currentTarget.value);
    v.currentTime = t;
    setPosition(t);
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }, []);

  const cycleRate = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const idx = PLAYBACK_RATES.indexOf(rate);
    const next = PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length];
    v.playbackRate = next;
    setRate(next);
  }, [rate]);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen().catch(() => {});
    }
  }, []);

  const handleClose = useCallback(() => {
    flushProgress();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    onClose();
  }, [flushProgress, onClose]);

  // Esc closes the player (capture so it runs before the global handler).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.fullscreenElement) {
        e.preventDefault();
        e.stopPropagation();
        handleClose();
      } else if (e.key === " " || e.key === "k") {
        const target = e.target as HTMLElement | null;
        if (target && target.tagName === "INPUT") return;
        e.preventDefault();
        togglePlay();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [handleClose, togglePlay]);

  const src = item ? convertFileSrc(item.filePath) : undefined;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex flex-col bg-black"
      role="dialog"
      aria-modal="true"
      aria-label={item ? `Playing ${item.title}` : "Player"}
    >
      <div className="relative flex flex-1 items-center justify-center">
        {error ? (
          <div className="max-w-md px-6 text-center text-sm text-(--color-text-secondary)">
            <p className="mb-2 font-medium text-(--color-text-primary)">
              Could not play this item
            </p>
            <p>{error}</p>
          </div>
        ) : src ? (
          <video
            key={current.itemId}
            ref={videoRef}
            src={src}
            className="h-full w-full"
            onLoadedMetadata={handleLoadedMetadata}
            onTimeUpdate={handleTimeUpdate}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={handleEnded}
            onClick={togglePlay}
          />
        ) : (
          <div className="text-sm text-(--color-text-muted)">Loading…</div>
        )}

        <div className="absolute right-3 top-3">
          <IconButton
            icon={<X size={18} />}
            tooltip="Close (Esc)"
            onClick={handleClose}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 bg-(--color-surface)/95 px-4 py-3 backdrop-blur">
        {item ? (
          <p className="truncate text-sm font-medium text-(--color-text-primary)">
            {item.title}
          </p>
        ) : null}
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(position, duration || 0)}
          onChange={handleScrub}
          aria-label="Seek"
          className="w-full accent-(--color-accent)"
        />
        <div className="flex items-center gap-3 text-(--color-text-secondary)">
          <IconButton
            icon={playing ? <Pause size={18} /> : <Play size={18} />}
            tooltip={playing ? "Pause (Space)" : "Play (Space)"}
            onClick={togglePlay}
          />
          <IconButton
            icon={muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            tooltip={muted ? "Unmute" : "Mute"}
            onClick={toggleMute}
          />
          <span className="tabular-nums text-xs text-(--color-text-muted)">
            {formatTime(position)} / {formatTime(duration)}
          </span>
          <div className="ml-auto flex items-center gap-3">
            <button
              type="button"
              onClick={cycleRate}
              className={cn(
                "rounded-(--radius-control) px-2 py-1 text-xs font-medium tabular-nums",
                "text-(--color-text-secondary) hover:bg-(--color-surface-raised) hover:text-(--color-text-primary)",
              )}
              aria-label="Playback speed"
            >
              {rate}×
            </button>
            <IconButton
              icon={isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
              tooltip="Fullscreen"
              onClick={toggleFullscreen}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
