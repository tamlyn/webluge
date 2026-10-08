// A Deluge SD card, or a copy of one, opened through the File System Access API. Paths are relative to the card's
// root, separated by "/", as the firmware writes them in song files.

declare global {
  interface FileSystemFileHandle {
    // Chrome moves local files in place (Chrome 111), but not folders.
    move(destination: FileSystemDirectoryHandle, name: string): Promise<void>;
  }
}

export type Kind = "file" | "folder";
export type Entry = { name: string; path: string; kind: Kind };

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

  // Hidden files are left out unless asked for: moving a folder has to take them too.
  async list(path: string, { hidden = false } = {}): Promise<Entry[]> {
    const folder = await this.folder(path);
    if (!folder) return [];
    const entries: Entry[] = [];
    for await (const handle of folder.values()) {
      if (!hidden && isHidden(handle.name)) continue;
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

  async kind(path: string): Promise<Kind | undefined> {
    if (await this.folder(path)) return "folder";
    return (await this.exists(path)) ? "file" : undefined;
  }

  // Changing the card needs permission to write, which a reload drops. Needs a user gesture unless already granted.
  async writable(): Promise<boolean> {
    const mode = "readwrite";
    if ((await this.root.queryPermission({ mode })) === "granted") return true;
    return (await this.root.requestPermission({ mode })) === "granted";
  }

  // The changes below don't check anything first: the runner does, so that it can stop before changing anything.

  async makeFolder(path: string): Promise<void> {
    const parent = await this.required(parentPath(path));
    await parent.getDirectoryHandle(baseName(path), { create: true });
  }

  async moveFile(from: string, to: string): Promise<void> {
    const handle = await child(await this.required(parentPath(from)), baseName(from), "file");
    if (!handle) throw new Error(`${from} isn't on the card`);
    await handle.move(await this.required(parentPath(to)), baseName(to));
    this.folders.clear();
  }

  // Only if it's empty, hidden files included.
  async removeFolder(path: string): Promise<void> {
    const folder = await this.required(path);
    await (await this.required(parentPath(path))).removeEntry(folder.name);
    this.folders.clear();
  }

  async writeFile(path: string, data: Uint8Array<ArrayBuffer>): Promise<void> {
    const handle = await child(await this.required(parentPath(path)), baseName(path), "file");
    if (!handle) throw new Error(`${path} isn't on the card`);
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
  }

  private async required(path: string): Promise<FileSystemDirectoryHandle> {
    const folder = await this.folder(path);
    if (!folder) throw new Error(`${path} isn't on the card`);
    return folder;
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
