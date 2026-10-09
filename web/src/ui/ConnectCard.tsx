import { useEffect, useState } from "react";
import { canConnect, pickCard, reconnect, stillWritable } from "../card/connect";

type Props = {
  remembered?: FileSystemDirectoryHandle;
  onConnect: (handle: FileSystemDirectoryHandle) => void;
};

export function ConnectCard({ remembered, onConnect }: Props) {
  const [error, setError] = useState<string>();
  const [writable, setWritable] = useState(false);

  useEffect(() => {
    if (remembered) stillWritable(remembered).then(setWritable, () => {});
  }, [remembered]);

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
      {remembered && writable ? (
        <p className="warning">
          Your browser still lets Webluge change {remembered.name}. Webluge is beta software, so back up your SD card
          before reopening it, to avoid any risk of losing or corrupting your data.
        </p>
      ) : (
        <p className="warning">
          Webluge only reads your card until you ask it to change something, when your browser will ask for permission.
          Webluge is beta software, so back up your SD card before letting it make changes.
        </p>
      )}
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
