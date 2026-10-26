import { useEffect, useRef, useState } from "react";
import type { SyntheticEvent } from "react";
import type { ChangedFile } from "../types";
import { loadImageVersions, type ImageVersion, type ImageVersions } from "../data/gitLoader";
import { formatBytes } from "../lib/imageDiff";
import { STORAGE_KEYS, usePersistedState } from "../lib/persisted";

/**
 * The picture diff, shaped like GitHub's: the previous and current blobs side by side, with
 * pixel dimensions and byte sizes, plus GitHub's swipe and onion-peel overlays when both copies
 * exist. Blobs arrive as data URLs from `read_image_versions` (git blob → base64), so the
 * images are exactly what the commits store — the working copy is read from disk for "wip".
 */
export type ImageDiffMode = "2up" | "swipe" | "onion";

const MODES: { value: ImageDiffMode; label: string; title: string }[] = [
  { value: "2up", label: "2-up", title: "Show the images side by side" },
  { value: "swipe", label: "Swipe", title: "Drag the divider to wipe between them" },
  { value: "onion", label: "Onion peel", title: "Fade the current image over the previous one" },
];

interface ImageDiffProps {
  file: ChangedFile;
  /** Where the blobs come from; both must be set for the picture to load. */
  repoPath?: string;
  commitHash?: string;
}

/** One rendered copy: image on a checkerboard, captioned with dimensions and size. */
function ImageSide({
  side,
  version,
  label,
  onDims,
  dims,
}: {
  side: "previous" | "current";
  version: ImageVersion;
  label: string;
  dims?: string;
  onDims: (event: SyntheticEvent<HTMLImageElement>) => void;
}) {
  return (
    <figure
      data-image-side={side}
      className="m-0 flex min-w-0 flex-col gap-1.5 p-2"
    >
      <div className="image-checker overflow-hidden rounded-md border border-rule">
        {version.url ? (
          <img
            src={version.url}
            alt={`${label} version of the image`}
            data-image-src={side}
            onLoad={onDims}
            loading="lazy"
            decoding="async"
            className="block max-h-72 w-full object-contain"
          />
        ) : (
          <div
            data-image-too-large={side}
            className="grid h-40 place-items-center px-3 text-center font-sans text-[12px] text-ink-dim"
          >
            Image too large to preview ({formatBytes(version.bytes)})
          </div>
        )}
      </div>
      <figcaption className="flex flex-wrap items-baseline gap-x-2 font-sans text-[11px] text-ink-dim">
        <span className="font-semibold text-ink-soft">{label}</span>
        <span className="font-mono">{dims ?? ""}</span>
        <span className="font-mono">{formatBytes(version.bytes)}</span>
      </figcaption>
    </figure>
  );
}

export function ImageDiff({ file, repoPath, commitHash }: ImageDiffProps) {
  const [versions, setVersions] = useState<ImageVersions | null>(null);
  const [failed, setFailed] = useState(false);
  const [mode, setMode] = usePersistedState<ImageDiffMode>(STORAGE_KEYS.imageDiffMode, "2up");
  const [fraction, setFraction] = useState(50);
  const [dims, setDims] = useState<{ previous?: string; current?: string }>({});
  const stripRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  // Blobs are heavy (base64 through IPC plus a decode per copy), and the "all files" scope
  // stacks every image section at once — so a read only starts once the section is near the
  // viewport. Without IntersectionObserver (jsdom, odd webviews) the image loads right away:
  // a missing observer must never block the selected file's picture.
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "240px" }, // Start loading slightly before the section scrolls in.
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    setVersions(null);
    setFailed(false);
    setDims({});
    if (!repoPath || !commitHash) {
      setFailed(true);
      return;
    }
    let cancelled = false;
    loadImageVersions(repoPath, commitHash, file.path)
      .then((loaded) => {
        if (cancelled) return;
        setVersions(loaded);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, repoPath, commitHash, file.path]);

  const rememberDims = (side: "previous" | "current") => (event: SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    if (img.naturalWidth > 0) {
      setDims((prev) => ({ ...prev, [side]: `${img.naturalWidth} × ${img.naturalHeight}` }));
    }
  };

  if (!visible) {
    return (
      <div ref={rootRef} data-image-deferred={file.path} className="p-2 font-sans">
        <div className="image-checker h-40 rounded-md border border-rule" />
      </div>
    );
  }

  if (failed || !versions) {
    return (
      <div ref={rootRef}>
        <p
          data-image-diff-state={failed ? "error" : "loading"}
          className="m-0 p-4 text-[12px] text-ink-dim"
        >
          {failed ? "Could not read the image versions." : "Reading image versions…"}
        </p>
      </div>
    );
  }

  const { previous, current } = versions;
  if (!previous && !current) {
    return (
      <div ref={rootRef}>
        <p className="m-0 p-4 text-[12px] text-ink-dim">
          Neither side of this image could be read.
        </p>
      </div>
    );
  }

  const both = previous !== null && current !== null;
  const toggle = both && (
    <div className="flex justify-end px-3 pt-2">
      <div
        role="group"
        aria-label="Image diff mode"
        className="flex items-center gap-0.5 rounded-full border border-hairline bg-glass-soft p-0.5 backdrop-blur-md"
      >
        {MODES.map((entry) => (
          <button
            key={entry.value}
            type="button"
            data-image-mode={entry.value}
            aria-pressed={mode === entry.value}
            title={entry.title}
            onClick={() => setMode(entry.value)}
            className={`h-5.5 cursor-default rounded-full px-2.5 text-[11px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-primary/60 ${
              mode === entry.value
                ? "bg-primary text-white"
                : "text-ink-dim hover:bg-hover-glass hover:text-ink"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>
    </div>
  );

  const labelFor = (side: "previous" | "current") => {
    if (!both) return file.status === "deleted" ? "Removed" : "Added";
    return side === "previous" ? "Previous" : "Current";
  };

  if (!both || mode === "2up") {
    return (
      <div ref={rootRef} data-image-diff="2up" className="font-sans">
        {toggle}
        <div className={`grid ${both ? "grid-cols-2" : "grid-cols-1"} divide-x divide-rule`}>
          {previous && (
            <ImageSide
              side="previous"
              version={previous}
              label={labelFor("previous")}
              dims={dims.previous}
              onDims={rememberDims("previous")}
            />
          )}
          {current && (
            <ImageSide
              side="current"
              version={current}
              label={labelFor("current")}
              dims={dims.current}
              onDims={rememberDims("current")}
            />
          )}
        </div>
      </div>
    );
  }

  // Swipe and onion peel only make sense with two copies, which `both` guarantees here.
  const caption = (
    <div className="flex flex-wrap items-baseline gap-x-2 px-3 text-[11px] text-ink-dim">
      <span className="font-mono">
        {dims.previous ?? ""}
        {dims.previous && dims.current ? " → " : ""}
        {dims.current ?? ""}
      </span>
      <span className="font-mono">
        {formatBytes(previous.bytes)} → {formatBytes(current.bytes)}
      </span>
    </div>
  );
  const strip = (
    <div
      ref={stripRef}
      data-image-diff={mode}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        dragging.current = true;
        moveFraction(event.clientX);
      }}
      onPointerMove={(event) => {
        if (dragging.current) moveFraction(event.clientX);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
      className="image-checker relative mx-3 h-72 cursor-ew-resize touch-none select-none overflow-hidden rounded-md border border-rule"
    >
      <img
        src={previous.url}
        alt="Previous version"
        data-image-src="previous"
        loading="lazy"
        decoding="async"
        className="absolute inset-0 size-full object-contain"
      />
      <img
        src={current.url}
        alt="Current version"
        data-image-src="current"
        loading="lazy"
        decoding="async"
        style={mode === "swipe" ? { clipPath: `inset(0 ${100 - fraction}% 0 0)` } : { opacity: fraction / 100 }}
        className="absolute inset-0 size-full object-contain"
      />
      <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-sheet-strong px-2 py-0.5 font-sans text-[10.5px] font-semibold text-ink-soft backdrop-blur-md">
        Previous
      </span>
      <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-sheet-strong px-2 py-0.5 font-sans text-[10.5px] font-semibold text-ink-soft backdrop-blur-md">
        Current
      </span>
      {mode === "swipe" && (
        <span
          data-image-divider
          className="pointer-events-none absolute inset-y-0 w-px bg-primary"
          style={{ left: `${fraction}%` }}
        />
      )}
    </div>
  );

  return (
    <div ref={rootRef} className="flex flex-col gap-2 font-sans">
      {toggle}
      {strip}
      {caption}
      {mode === "swipe" ? (
        <div className="px-3">
          <button
            type="button"
            role="slider"
            aria-label="Swipe position"
            data-image-slider
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(fraction)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") setFraction((value) => Math.max(0, value - 5));
              if (event.key === "ArrowRight") setFraction((value) => Math.min(100, value + 5));
            }}
            onClick={() => setFraction(50)}
            title="Drag on the image; arrow keys also move the divider"
            className="h-6 cursor-default rounded-full border border-hairline bg-glass-soft px-2.5 text-[11px] font-semibold text-ink-dim backdrop-blur-md hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            {Math.round(fraction)}%
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 pb-2">
          <label htmlFor="image-onion" className="text-[11px] font-semibold text-ink-dim">
            Onion peel
          </label>
          <input
            id="image-onion"
            type="range"
            min={0}
            max={100}
            value={Math.round(fraction)}
            data-image-onion
            aria-label="Onion peel amount"
            onChange={(event) => setFraction(Number(event.target.value))}
            className="w-44 accent-primary"
          />
        </div>
      )}
    </div>
  );

  // Shared helpers for the swipe strip: a function declaration hoists, so the strip's pointer
  // handlers above can call it even though it is declared after the JSX.
  function moveFraction(clientX: number) {
    const rect = stripRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setFraction(Math.min(100, Math.max(0, pct)));
  }
}
