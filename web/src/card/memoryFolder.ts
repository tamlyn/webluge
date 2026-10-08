// An in-memory stand-in for the File System Access API's handles, so tests can run Card, the planner and the runner
// without a browser. It is case-sensitive, stricter than a card, so tests catch code that relies on case.

type FileNode = { kind: "file"; name: string; parent?: FolderNode; data: Uint8Array; lastModified: number };
type FolderNode = { kind: "directory"; name: string; parent?: FolderNode; entries: Map<string, Node> };
type Node = FileNode | FolderNode;

// Changes in the same millisecond still get new modification times.
let clock = 0;

function notFound(name: string): DOMException {
  return new DOMException(`${name} not found`, "NotFoundError");
}

function attached(node: Node): boolean {
  for (let child = node; child.parent; child = child.parent) {
    if (child.parent.entries.get(child.name) !== child) return false;
  }
  return true;
}

class MemoryFileHandle {
  readonly kind = "file";
  constructor(readonly node: FileNode) {}

  get name() {
    return this.node.name;
  }

  async getFile(): Promise<File> {
    if (!attached(this.node)) throw notFound(this.name);
    return new File([this.node.data.slice()], this.name, { lastModified: this.node.lastModified });
  }

  async createWritable() {
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    return {
      write: async (data: Uint8Array<ArrayBuffer>) => void chunks.push(data),
      close: async () => {
        if (!attached(this.node)) throw notFound(this.name);
        this.node.data = new Uint8Array(await new Blob(chunks).arrayBuffer());
        this.node.lastModified = ++clock;
      },
    };
  }

  // Like Chrome's, it replaces a file already at the destination: the runner must check first.
  async move(destination: MemoryFolderHandle, name: string) {
    if (!attached(this.node) || !attached(destination.node)) throw notFound(this.name);
    const existing = destination.node.entries.get(name);
    if (existing?.kind === "directory") throw new DOMException(name, "InvalidModificationError");
    this.node.parent!.entries.delete(this.node.name);
    this.node.name = name;
    this.node.parent = destination.node;
    destination.node.entries.set(name, this.node);
  }
}

export class MemoryFolderHandle {
  readonly kind = "directory";
  constructor(readonly node: FolderNode = { kind: "directory", name: "card", entries: new Map() }) {}

  get name() {
    return this.node.name;
  }

  async *values(): AsyncGenerator<MemoryFileHandle | MemoryFolderHandle> {
    if (!attached(this.node)) throw notFound(this.name);
    for (const node of [...this.node.entries.values()]) yield handleOf(node);
  }

  async getFileHandle(name: string, { create = false } = {}): Promise<MemoryFileHandle> {
    return handleOf(this.child(name, "file", create)) as MemoryFileHandle;
  }

  async getDirectoryHandle(name: string, { create = false } = {}): Promise<MemoryFolderHandle> {
    return handleOf(this.child(name, "directory", create)) as MemoryFolderHandle;
  }

  async removeEntry(name: string, { recursive = false } = {}) {
    const node = this.node.entries.get(name);
    if (!node) throw notFound(name);
    if (node.kind === "directory" && node.entries.size && !recursive) {
      throw new DOMException(`${name} isn't empty`, "InvalidModificationError");
    }
    this.node.entries.delete(name);
  }

  async queryPermission() {
    return "granted";
  }

  async requestPermission() {
    return "granted";
  }

  private child(name: string, kind: Node["kind"], create: boolean): Node {
    if (!attached(this.node)) throw notFound(this.name);
    const existing = this.node.entries.get(name);
    if (existing) {
      if (existing.kind !== kind) throw new DOMException(name, "TypeMismatchError");
      return existing;
    }
    if (!create) throw notFound(name);
    const node: Node =
      kind === "file"
        ? { kind, name, parent: this.node, data: new Uint8Array(), lastModified: ++clock }
        : { kind, name, parent: this.node, entries: new Map() };
    this.node.entries.set(name, node);
    return node;
  }
}

function handleOf(node: Node): MemoryFileHandle | MemoryFolderHandle {
  return node.kind === "file" ? new MemoryFileHandle(node) : new MemoryFolderHandle(node);
}

export type MemoryFiles = Record<string, string | Uint8Array>;

// A folder holding the files given, by path. Text is stored as Latin-1, which matches code page 437 for ASCII.
export function memoryFolder(files: MemoryFiles): MemoryFolderHandle {
  const root = new MemoryFolderHandle();
  for (const [path, content] of Object.entries(files)) {
    const parts = path.split("/");
    let folder = root.node;
    for (const part of parts.slice(0, -1)) {
      let next = folder.entries.get(part);
      if (!next) {
        next = { kind: "directory", name: part, parent: folder, entries: new Map() };
        folder.entries.set(part, next);
      }
      if (next.kind !== "directory") throw new Error(`${part} is a file`);
      folder = next;
    }
    const name = parts.at(-1)!;
    const data = typeof content === "string" ? Uint8Array.from(Buffer.from(content, "latin1")) : content;
    folder.entries.set(name, { kind: "file", name, parent: folder, data, lastModified: ++clock });
  }
  return root;
}

// Every file and empty folder in the folder, by path, for comparing whole cards. Empty folders end in "/".
export function snapshot(root: MemoryFolderHandle): Record<string, string> {
  const files: Record<string, string> = {};
  const visit = (folder: FolderNode, prefix: string) => {
    if (prefix && !folder.entries.size) files[prefix] = "";
    for (const node of folder.entries.values()) {
      if (node.kind === "directory") visit(node, `${prefix}${node.name}/`);
      else files[`${prefix}${node.name}`] = Buffer.from(node.data).toString("latin1");
    }
  };
  visit(root.node, "");
  return files;
}

// The file at a path, found ignoring case as on a card. It keeps its identity as it moves.
export function fileAt(root: MemoryFolderHandle, path: string): object | undefined {
  let node: Node | undefined = root.node;
  for (const part of path.toLowerCase().split("/")) {
    node = node?.kind === "directory" ? [...node.entries.values()].find((n) => n.name.toLowerCase() === part) : undefined;
  }
  return node?.kind === "file" ? node : undefined;
}
