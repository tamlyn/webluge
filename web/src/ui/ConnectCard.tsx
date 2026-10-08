import { useState } from "react";
import { canConnect, pickCard, reconnect } from "../card/connect";

type Props = {
  remembered?: FileSystemDirectoryHandle;
  onConnect: (handle: FileSystemDirectoryHandle) => void;
};

export function ConnectCard({ remembered, onConnect }: Props) {
  const [error, setError] = useState<string>();

  async function connect(getHandle: () => Promise<FileSystemDirectoryHandle | undefined>) {
    setError(undefined);
    try {
      const handle = await getHandle();
      if (handle) onConnect(handle);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(String(e));
    }
  }

  if (!canConnect) {
    return (
      <main className="connect">
        <h1>Webluge</h1>
        <p>This browser can't open folders. Try Chrome or Edge.</p>
      </main>
    );
  }
  return (
    <main className="connect">
      <h1>Webluge</h1>
      <p>Open your Deluge's SD card, or a copy of it, to browse and play its songs and samples.</p>
      <p className="warning">
        Webluge is beta software. Back up your SD card before opening it here, to avoid any risk of losing or
        corrupting your data.
      </p>
      <div className="connect-actions">
        {remembered && (
          <button
            className="key primary"
            onClick={() => connect(async () => ((await reconnect(remembered)) ? remembered : undefined))}
          >
            Reopen {remembered.name}
          </button>
        )}
        <button className={`key ${remembered ? "" : "primary"}`} onClick={() => connect(pickCard)}>
          Open SD card…
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </main>
  );
}
