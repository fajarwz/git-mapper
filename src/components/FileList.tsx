import { Fragment, useMemo, useState } from "react";
import type { ChangedFile } from "../types";
import { buildFileTree, type FileTreeNode } from "../lib/fileTree";
import { STATUS_TONES, statusLetter } from "../lib/format";
import { ChevronDownIcon } from "./icons";

/** How the changed-file list is shaped: a flat path list, or GitHub's folder tree. */
export type FileView = "list" | "tree";

interface FileListProps {
  files: ChangedFile[];
  loading?: boolean;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Flat paths or the folder tree; defaults to the flat list when the owner does not care. */
  view?: FileView;
  onViewChange?: (view: FileView) => void;
}

function splitPath(path: string): { dir: string; base: string } {
  const cut = path.lastIndexOf("/");
  if (cut === -1) return { dir: "", base: path };
  return { dir: path.slice(0, cut + 1), base: path.slice(cut + 1) };
}

const FILE_ROW_CLASS =
  "grid h-7 w-full cursor-default grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-2 border-0 bg-transparent pr-3.5 text-left transition-colors hover:bg-hover-glass focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60 data-[selected=true]:bg-selected-glass data-[selected=true]:shadow-[inset_3px_0_0_var(--color-primary)] data-[selected=true]:hover:bg-selected-glass";

const DIR_ROW_CLASS =
  "grid h-7 w-full cursor-default grid-cols-[14px_minmax(0,1fr)] items-center gap-2 border-0 bg-transparent pr-3.5 text-left transition-colors hover:bg-hover-glass focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60";

/**
 * One changed file: status badge, path, +/- counts. The flat list shows the directory prefix
 * inline; in the tree the folder rows carry it, so only the base name renders there.
 */
function FileRow({
  file,
  selected,
  onSelect,
  depth,
  showDir,
}: {
  file: ChangedFile;
  selected: boolean;
  onSelect: (path: string) => void;
  depth: number;
  showDir: boolean;
}) {
  const { dir, base } = splitPath(file.path);

  return (
    <button
      type="button"
      data-file-item
      className={FILE_ROW_CLASS}
      data-selected={selected}
      onClick={() => onSelect(file.path)}
      style={{ paddingLeft: 14 + depth * 12 }}
    >
      <span
        className={`grid place-items-center size-4.5 rounded-[4px] text-center font-mono text-[10.5px] font-bold ${STATUS_TONES[file.status]}`}
        aria-label={file.status}
      >
        {statusLetter(file.status)}
      </span>
      <span className="truncate text-[12px]" title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}>
        {file.oldPath ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-ink-dim">{file.oldPath}</span>
            <span className="shrink-0 text-ink-dim">→</span>
            <span className="shrink-0 truncate">
              {showDir && <span className="text-ink-dim">{dir}</span>}
              <span className="text-ink">{base}</span>
            </span>
          </span>
        ) : showDir ? (
          <>
            <span className="text-ink-dim">{dir}</span>
            <span className="text-ink">{base}</span>
          </>
        ) : (
          <span className="text-ink">{base}</span>
        )}
      </span>
      <span className="flex gap-1.5 font-mono text-[10.5px]">
        <span className="text-success-ink">+{file.additions}</span>
        <span className="text-danger-ink">−{file.deletions}</span>
      </span>
    </button>
  );
}

/**
 * The tree depth-first: a folder row first, then (while expanded) its children indented one
 * step. Root-level files sit beside the top folder rows, exactly like GitHub's file tree.
 */
function TreeBranch({
  node,
  depth,
  selectedPath,
  onSelect,
  collapsedDirs,
  onToggleDir,
}: {
  node: FileTreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  collapsedDirs: Set<string>;
  onToggleDir: (path: string) => void;
}) {
  return (
    <>
      {node.dirs.map((dir) => {
        const collapsed = collapsedDirs.has(dir.path);
        return (
          <Fragment key={dir.path}>
            <button
              type="button"
              data-file-dir
              className={DIR_ROW_CLASS}
              aria-expanded={!collapsed}
              title={dir.path}
              onClick={() => onToggleDir(dir.path)}
              style={{ paddingLeft: 14 + depth * 12 }}
            >
              <span className="grid place-items-center size-4.5 text-ink-dim">
                <ChevronDownIcon size={11} className={collapsed ? "-rotate-90" : ""} />
              </span>
              <span className="truncate text-[12px] text-ink">{dir.name}</span>
            </button>
            {!collapsed && (
              <TreeBranch
                node={dir}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelect={onSelect}
                collapsedDirs={collapsedDirs}
                onToggleDir={onToggleDir}
              />
            )}
          </Fragment>
        );
      })}
      {node.files.map((file) => (
        <FileRow
          key={file.path}
          file={file}
          selected={file.path === selectedPath}
          onSelect={onSelect}
          depth={depth}
          showDir={false}
        />
      ))}
    </>
  );
}

const VIEW_SEGMENTS: { value: FileView; label: string; title: string }[] = [
  { value: "list", label: "List", title: "Flat list of changed files" },
  { value: "tree", label: "Tree", title: "Group the changed files by folder, GitHub-style" },
];

/** List/tree switch — the same segmented pattern as the diff-scope toggle. */
function ViewToggle({
  view,
  onViewChange,
}: {
  view: FileView;
  onViewChange?: (view: FileView) => void;
}) {
  return (
    <div
      role="group"
      aria-label="File list layout"
      className="flex shrink-0 items-center gap-0.5 rounded-full border border-hairline bg-glass-soft p-0.5 backdrop-blur-md"
    >
      {VIEW_SEGMENTS.map((segment) => (
        <button
          key={segment.value}
          type="button"
          data-file-view={segment.value}
          aria-pressed={view === segment.value}
          title={segment.title}
          onClick={() => onViewChange?.(segment.value)}
          className={`h-5.5 cursor-default rounded-full px-2.5 text-[11px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-primary/60 ${
            view === segment.value
              ? "bg-primary text-white"
              : "text-ink-dim hover:bg-hover-glass hover:text-ink"
          }`}
        >
          {segment.label}
        </button>
      ))}
    </div>
  );
}

export function FileList({
  files,
  loading = false,
  selectedPath,
  onSelect,
  collapsed,
  onToggleCollapse,
  view = "list",
  onViewChange,
}: FileListProps) {
  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);

  // Folders start expanded; a collapse survives while that folder path comes back (a new commit
  // touching the same folder keeps the user's collapse). Stale entries are never matched again,
  // so they cost nothing.
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
  const toggleDir = (path: string) => {
    setCollapsedDirs((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };
  const tree = useMemo(() => buildFileTree(files), [files]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-rule px-3.5 py-2 text-[11px] font-semibold text-ink-dim">
        <span className="flex min-w-0 items-center gap-1">
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand file list" : "Collapse file list"}
            className="grid shrink-0 cursor-default place-items-center rounded-full text-ink-dim hover:bg-hover-glass hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/70 size-5"
          >
            <ChevronDownIcon size={11} className={collapsed ? "-rotate-90" : ""} />
          </button>
          <span className="truncate">
            {files.length} file{files.length === 1 ? "" : "s"} changed
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <ViewToggle view={view} onViewChange={onViewChange} />
          <span className="flex gap-2 font-mono text-[11px] tracking-normal">
            <span className="text-success-ink">+{additions}</span>
            <span className="text-danger-ink">−{deletions}</span>
          </span>
        </span>
      </div>

      {!collapsed && (
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {loading && files.length === 0 && (
          <p className="m-0 px-3.5 py-3 text-[12px] text-ink-dim">Loading files…</p>
        )}
        {!loading && files.length === 0 && (
          <p className="m-0 px-3.5 py-3 text-[12px] text-ink-dim">No file changes in this commit.</p>
        )}

        {view === "tree" ? (
          <TreeBranch
            node={tree}
            depth={0}
            selectedPath={selectedPath}
            onSelect={onSelect}
            collapsedDirs={collapsedDirs}
            onToggleDir={toggleDir}
          />
        ) : (
          files.map((file) => (
            <FileRow
              key={file.path}
              file={file}
              selected={file.path === selectedPath}
              onSelect={onSelect}
              depth={0}
              showDir
            />
          ))
        )}
      </div>
      )}
    </div>
  );
}
