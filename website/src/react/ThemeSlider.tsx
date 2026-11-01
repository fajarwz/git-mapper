import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  lightSrc: string;
  darkSrc: string;
  altLight: string;
  altDark: string;
};

const MIN = 2;
const MAX = 98;

/**
 * The on-image dragger between the app's light and dark theme screenshots.
 * The whole frame is the grab target (CSS `touch-none` keeps the drag from
 * becoming a page scroll), the divider is keyboard-operable as a real slider,
 * and a one-shot sweep from the right teaches the interaction on load —
 * suppressed entirely for reduced-motion users, who get the neutral 50%.
 */
export default function ThemeSlider({ lightSrc, darkSrc, altLight, altDark }: Props) {
  const [pos, setPos] = useState(50);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const interactedRef = useRef(false);
  const rafRef = useRef(0);

  const clampPos = useCallback(
    (pct: number) => Math.min(MAX, Math.max(MIN, pct)),
    []
  );

  const setFromClientX = useCallback(
    (clientX: number) => {
      const el = frameRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setPos(clampPos(((clientX - rect.left) / rect.width) * 100));
    },
    [clampPos]
  );

  const stopPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.hasPointerCapture?.(e.pointerId)) {
      el.releasePointerCapture(e.pointerId);
    }
    draggingRef.current = false;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    interactedRef.current = true;
    cancelAnimationFrame(rafRef.current);
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    setFromClientX(e.clientX);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingRef.current) {
      setFromClientX(e.clientX);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const big = e.shiftKey;
    const step = big ? 10 : 3;
    if (e.key === "ArrowLeft") {
      interactedRef.current = true;
      setPos((p) => clampPos(p - step));
      e.preventDefault();
    } else if (e.key === "ArrowRight") {
      interactedRef.current = true;
      setPos((p) => clampPos(p + step));
      e.preventDefault();
    } else if (e.key === "Home") {
      setPos(MIN);
      e.preventDefault();
    } else if (e.key === "End") {
      setPos(MAX);
      e.preventDefault();
    }
  };

  useEffect(() => {
    // Test/automation runners get the calm 50% state, never the teach-sweep —
    // a capture with the divider mid-flight verifies nothing.
    if (typeof navigator !== "undefined" && navigator.webdriver) {
      return;
    }
    if (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    // Teach the slider: the divider sweeps in from the right, then settles at
    // the middle. Any pointer or key interaction cancels it instantly.
    const start = performance.now();
    const DURATION = 1100;
    const tick = (t: number) => {
      if (interactedRef.current) return;
      const x = Math.min(1, (t - start) / DURATION);
      const ease = 1 - Math.pow(1 - x, 3);
      setPos(MAX - (MAX - 50) * ease);
      if (x < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <div
      ref={frameRef}
      role="slider"
      tabIndex={0}
      aria-label="Theme comparison: drag or use arrow keys to reveal more of the dark theme"
      aria-valuemin={MIN}
      aria-valuemax={MAX}
      aria-valuenow={Math.round(pos)}
      aria-valuetext={`${Math.round(pos)} percent dark theme revealed`}
      className="relative w-full cursor-ew-resize touch-none select-none overflow-hidden rounded-2xl border border-hairline panel-shadow"
      style={{ aspectRatio: "2800 / 1800" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stopPointer}
      onPointerCancel={stopPointer}
      onKeyDown={onKeyDown}
    >
      <img
        src={lightSrc}
        alt={altLight}
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover object-top"
      />
      <img
        src={darkSrc}
        alt={altDark}
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover object-top"
        style={{ clipPath: `inset(0 0 0 ${pos}%)` }}
      />

      {/* Divider */}
      <div
        className="pointer-events-none absolute inset-y-0 w-[2px] bg-surface/95 [box-shadow:0_0_0_1px_rgb(23_21_31/0.18),0_0_16px_rgb(23_21_31/0.28)]"
        style={{ left: `${pos}%` }}
      />
      {/* Handle */}
      <div
        className="pointer-events-none absolute top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-hairline bg-surface/90 backdrop-blur-md soft-shadow"
        style={{ left: `${pos}%` }}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 text-ink-soft" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 7l-4 5 4 5" />
          <path d="M15 7l4 5-4 5" />
        </svg>
      </div>

      {/* Labels, visible at rest for both extremes of the drag */}
      <span className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full border border-hairline bg-surface/85 px-2.5 py-1 text-[11px] font-semibold text-ink backdrop-blur-md">
        <svg viewBox="0 0 24 24" className="h-3 w-3 text-warning" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="12" r="4.5" />
          <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M18.7 5.3l-1.5 1.5M6.8 17.2l-1.5 1.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        Light
      </span>
      <span className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full border border-hairline bg-surface/85 px-2.5 py-1 text-[11px] font-semibold text-ink backdrop-blur-md">
        <svg viewBox="0 0 24 24" className="h-3 w-3 text-primary" fill="currentColor" aria-hidden="true">
          <path d="M20.8 13.9A8.3 8.3 0 0 1 10.1 3.2a8.5 8.5 0 1 0 10.7 10.7Z" />
        </svg>
        Dark
      </span>
    </div>
  );
}
