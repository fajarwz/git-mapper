import type { ChangedFile, FileStatus } from "../types";
import { statusLetter } from "../lib/format";

interface FileListProps {
  files: ChangedFile[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

const STATUS_TONES: Record<FileStatus, string> = {
  added: "text-success-ink",
  modified: "text-warning-ink",
  deleted: "text-danger-ink",
  renamed: "text-secondary",
};

function splitPath(path: string): { dir: string; base: string } {
  const cut = path.lastIndexOf("/");
  if (cut === -1) return { dir: "", base: path };
  return { dir: path.slice(0, cut + 1), base: path.slice(cut + 1) };
}

export function FileList({ files, selectedPath, onSelect }: FileListProps) {
  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-rule px-3.5 py-2 text-[11px] font-semibold text-ink-dim">
        <span>
          {files.length} file{files.length === 1 ? "" : "s"} changed
        </span>
        <span className="flex gap-2 font-mono text-[11px] tracking-normal">
          <span className="text-success-ink">+{additions}</span>
          <span className="text-danger-ink">−{deletions}</span>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {files.length === 0 && (
          <p className="m-0 px-3.5 py-3 text-[12px] text-ink-dim">No file changes in this commit.</p>
        )}

        {files.map((file) => {
          const { dir, base } = splitPath(file.path);

          return (
            <button
              key={file.path}
              type="button"
              data-file-item
              className="grid h-9 w-full cursor-default grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-2 border-0 bg-transparent px-3.5 text-left transition-colors hover:bg-hover-glass focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60 data-[selected=true]:bg-selected-glass data-[selected=true]:shadow-[inset_3px_0_0_var(--color-primary)] data-[selected=true]:hover:bg-selected-glass"
              data-selected={file.path === selectedPath}
              onClick={() => onSelect(file.path)}
            >
              <span
                className={`text-center font-mono text-[11px] font-bold ${STATUS_TONES[file.status]}`}
                aria-label={file.status}
              >
                {statusLetter(file.status)}
              </span>
              <span className="truncate text-[12.5px]" title={file.path}>
                <span className="text-ink-dim">{dir}</span>
                <span className="text-ink">{base}</span>
              </span>
              <span className="flex gap-1.5 font-mono text-[10.5px]">
                <span className="text-success-ink">+{file.additions}</span>
                <span className="text-danger-ink">−{file.deletions}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
