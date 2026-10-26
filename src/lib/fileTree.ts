import type { ChangedFile } from "../types";

/**
 * One folder in the changed-file tree. The root has an empty name and never renders as a row;
 * every visible folder holds only the changed paths beneath it, so an untouched folder in the
 * middle of a path simply does not exist here.
 */
export interface FileTreeNode {
  /** Folder segment, e.g. "components". The root is "". */
  name: string;
  /** Full prefix ending in "/", e.g. "src/components/". The root is "". */
  path: string;
  dirs: FileTreeNode[];
  files: ChangedFile[];
}

/**
 * Folds a flat changed-file list into GitHub's file-tree shape: folders before files, both
 * alphabetical. Paths sharing a prefix merge into one folder node (src/a + src/b → src/).
 */
export function buildFileTree(files: ChangedFile[]): FileTreeNode {
  const root: FileTreeNode = { name: "", path: "", dirs: [], files: [] };
  for (const file of files) {
    const segments = file.path.split("/").filter((segment) => segment !== "");
    let node = root;
    // Every segment but the last is a folder; the last is the file itself.
    for (let depth = 0; depth < segments.length - 1; depth += 1) {
      const name = segments[depth];
      let next = node.dirs.find((dir) => dir.name === name);
      if (!next) {
        next = { name, path: `${node.path}${name}/`, dirs: [], files: [] };
        node.dirs.push(next);
      }
      node = next;
    }
    node.files.push(file);
  }
  const sortNode = (node: FileTreeNode) => {
    node.dirs.sort((a, b) => a.name.localeCompare(b.name));
    node.files.sort((a, b) => a.path.localeCompare(b.path));
    for (const dir of node.dirs) sortNode(dir);
  };
  sortNode(root);
  return root;
}
