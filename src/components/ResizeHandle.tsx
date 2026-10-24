import { useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

type Orientation = "vertical" | "horizontal";

interface ResizeHandleProps {
  label: string;
  /** Current size in px, for assistive tech. Omit when the column is still flexible. */
  value?: number;
  min: number;
  max: number;
  /** Size to start the drag from, measured live so it matches what is on screen. */
  measure: () => number;
  onResize: (size: number) => void;
  onReset?: () => void;
  orientation?: Orientation;
  /** "splitter" spans a panel edge, "column" sits in a table header cell. */
  variant?: "splitter" | "column";
  className?: string;
}

const VERTICAL_SPLITTER = [
  "w-[11px] -translate-x-1/2",
  "after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-rule after:transition-all",
  "hover:after:w-0.5 hover:after:bg-primary focus-visible:after:w-0.5 focus-visible:after:bg-primary",
  "data-[dragging=true]:after:w-0.5 data-[dragging=true]:after:bg-primary",
  "before:pointer-events-none before:absolute before:left-1/2 before:top-1/2 before:h-[26px] before:w-[7px] before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full before:bg-primary before:opacity-0 before:transition-opacity",
  "hover:before:opacity-[0.9] focus-visible:before:opacity-[0.9] data-[dragging=true]:before:opacity-[0.9]",
].join(" ");

const HORIZONTAL_SPLITTER = [
  "h-[11px] -translate-y-1/2",
  "after:absolute after:inset-x-0 after:top-1/2 after:h-px after:-translate-y-1/2 after:bg-rule after:transition-all",
  "hover:after:h-0.5 hover:after:bg-primary focus-visible:after:h-0.5 focus-visible:after:bg-primary",
  "data-[dragging=true]:after:h-0.5 data-[dragging=true]:after:bg-primary",
  "before:pointer-events-none before:absolute before:left-1/2 before:top-1/2 before:h-[7px] before:w-[26px] before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full before:bg-primary before:opacity-0 before:transition-opacity",
  "hover:before:opacity-[0.9] focus-visible:before:opacity-[0.9] data-[dragging=true]:before:opacity-[0.9]",
].join(" ");

const COLUMN_VISUALS = [
  "w-[9px] right-[-4px]",
  "after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-transparent after:transition-all",
  "hover:after:bg-primary focus-visible:after:bg-primary data-[dragging=true]:after:bg-primary",
].join(" ");

/** Draggable divider for the graph gutter, table columns, panel splits and the details height. */
export function ResizeHandle({
  label,
  value,
  min,
  max,
  measure,
  onResize,
  onReset,
  orientation = "vertical",
  variant = "splitter",
  className = "",
}: ResizeHandleProps) {
  const [dragging, setDragging] = useState(false);
  const origin = useRef<{ pointer: number; startSize: number } | null>(null);
  const isVertical = orientation === "vertical";

  function clamp(size: number): number {
    return Math.max(min, Math.min(max, size));
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    origin.current = {
      pointer: isVertical ? event.clientX : event.clientY,
      startSize: measure(),
    };
    setDragging(true);
    document.body.classList.add("is-resizing");
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!origin.current) return;
    const pointer = isVertical ? event.clientX : event.clientY;
    const delta = pointer - origin.current.pointer;
    onResize(clamp(origin.current.startSize + (isVertical ? delta : -delta)));
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!origin.current) return;
    origin.current = null;
    setDragging(false);
    document.body.classList.remove("is-resizing");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const grow = isVertical ? "ArrowRight" : "ArrowUp";
    const shrink = isVertical ? "ArrowLeft" : "ArrowDown";

    if (event.key === grow || event.key === shrink) {
      event.preventDefault();
      onResize(clamp(measure() + (event.key === grow ? 12 : -12)));
    } else if (event.key === "Home" && onReset) {
      event.preventDefault();
      onReset();
    }
  }

  const visuals =
    variant === "column" ? COLUMN_VISUALS : isVertical ? VERTICAL_SPLITTER : HORIZONTAL_SPLITTER;

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value === undefined ? undefined : Math.round(value)}
      tabIndex={0}
      title="Drag to resize, double-click to reset"
      data-dragging={dragging}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={onReset}
      onKeyDown={handleKeyDown}
      className={`group absolute z-20 touch-none outline-none ${
        isVertical ? "inset-y-0 cursor-col-resize" : "inset-x-0 cursor-row-resize"
      } ${visuals} ${className}`}
    />
  );
}
