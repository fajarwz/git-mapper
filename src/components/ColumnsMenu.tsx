import { useEffect } from "react";

import { COLUMN_LABELS, type ColumnKey, type ColumnVisibility } from "../lib/tableLayout";

interface ColumnsMenuProps {
  x: number;
  y: number;
  visible: ColumnVisibility;
  onToggle: (column: ColumnKey) => void;
  onClose: () => void;
}

const ITEM =
  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-ink hover:bg-hover-glass";

/** Right-click menu on the commit table header: tick the optional columns. The commit column
 * is always there, so it is listed checked and disabled rather than left out. */
export function ColumnsMenu({ x, y, visible, onToggle, onClose }: ColumnsMenuProps) {
  useEffect(() => {
    const close = () => onClose();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const entries = (Object.keys(COLUMN_LABELS) as ColumnKey[]).map((column) => ({
    column,
    checked: visible[column],
  }));

  return (
    <div
      data-columns-menu
      role="menu"
      aria-label="Columns"
      onPointerDown={(event) => event.stopPropagation()}
      className="fixed z-50 flex w-44 flex-col gap-0.5 rounded-xl border border-hairline bg-glass p-1.5 panel-shadow backdrop-blur-sm"
      style={{ left: Math.max(4, Math.min(x, window.innerWidth - 184)), top: Math.max(4, Math.min(y, window.innerHeight - 160)) }}
    >
      <label className={`${ITEM} opacity-60`}>
        <input type="checkbox" checked disabled className="accent-primary" />
        Commit
      </label>
      {entries.map(({ column, checked }) => (
        <label key={column} className={`${ITEM} cursor-pointer`}>
          <input
            type="checkbox"
            checked={checked}
            onChange={() => onToggle(column)}
            className="accent-primary"
          />
          {COLUMN_LABELS[column]}
        </label>
      ))}
    </div>
  );
}
