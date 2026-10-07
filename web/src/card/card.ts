// A Deluge SD card, or a copy of one, opened through the File System Access API. Paths are relative to the card's
// root, separated by "/", as the firmware writes them in song files.

export type Entry = { name: string; path: string; kind: "file" | "folder" };

export function joinPath(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name;
}

export function parentPath(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf("/")));
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function isHidden(name: string): boolean {
  // Host metadata (.DS_Store, sync state), which the Deluge never sees as content.
  return name.startsWith(".");
}

export class Card {
  private folders = new Map<string, FileSystemDirectoryHandle>();

  constructor(readonly root: FileSystemDirectoryHandle) {}

  get name(): string {
    return this.root.name;
  }

  async list(path: string): Promise<Entry[]> {
    const folder = await this.folder(path);
    if (!folder) return [];
    const entries: Entry[] = [];
    for await (const handle of folder.values()) {
      if (isHidden(handle.name)) continue;
      entries.push({
        name: handle.name,
        path: joinPath(path, handle.name),
        kind: handle.kind === "directory" ? "folder" : "file",
      });
    }
    return entries.sort(
      (a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.kind === "folder" ? -1 : 1),
    );
  }

  // Every file under a folder, depth first.
  async *walk(path: string): AsyncGenerator<string> {
    for (const entry of await this.list(path)) {
      if (entry.kind === "folder") yield* this.walk(entry.path);
      else yield entry.path;
    }
  }

  async file(path: string): Promise<File | undefined> {
    const folder = await this.folder(parentPath(path));
    const handle = folder && (await child(folder, baseName(path), "file"));
    return handle?.getFile();
  }

  async exists(path: string): Promise<boolean> {
    return (await this.file(path)) !== undefined;
  }

  // Looked up without regard to case, as on the card itself: the host's filesystem may not be.
  private async folder(path: string): Promise<FileSystemDirectoryHandle | undefined> {
    if (!path) return this.root;
    const key = path.toLowerCase();
    let folder = this.folders.get(key);
    if (!folder) {
      const parent = await this.folder(parentPath(path));
      folder = parent && (await child(parent, baseName(path), "directory"));
      if (folder) this.folders.set(key, folder);
    }
    return folder;
  }
}

async function child(folder: FileSystemDirectoryHandle, name: string, kind: "file"): Promise<FileSystemFileHandle | undefined>;
async function child(folder: FileSystemDirectoryHandle, name: string, kind: "directory"): Promise<FileSystemDirectoryHandle | undefined>;
async function child(folder: FileSystemDirectoryHandle, name: string, kind: FileSystemHandleKind) {
  try {
    return kind === "file" ? await folder.getFileHandle(name) : await folder.getDirectoryHandle(name);
  } catch (error) {
    if (!(error instanceof DOMException) || (error.name !== "NotFoundError" && error.name !== "TypeMismatchError")) {
      throw error;
    }
  }
  const lowerName = name.toLowerCase();
  for await (const handle of folder.values()) {
    if (handle.kind === kind && handle.name.toLowerCase() === lowerName) return handle;
  }
  return undefined;
}
