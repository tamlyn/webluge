import { useEffect, useState } from "react";
import { type Card, baseName, parentPath } from "../card/card";
import { findMissing, type Missing, type MissingSample } from "../card/missing";
import type { Move } from "../card/plan";
import { pathKey } from "../card/references";
import type { UsageIndex } from "../card/usageIndex";
import { Oled } from "./Oled";
import { documentsSummary, plural } from "./words";

type Props = {
  card: Card;
  index?: UsageIndex;
  busy: boolean;
  onRelink: (message: string, relinks: Move[]) => void;
  onGoTo: (path: string) => void;
};

// Every sample on the card that songs, kits and synths can't find, by folder, with the files that might be them.
export function MissingSamples({ card, index, busy, onRelink, onGoTo }: Props) {
  // The previous list stays up while the card is looked through again after a change.
  const [missing, setMissing] = useState<Missing>();
  useEffect(() => {
    if (!index) return;
    let current = true;
    findMissing(card, index).then((found) => current && setMissing(found));
    return () => {
      current = false;
    };
  }, [card, index]);

  const users = missing && [...new Set(missing.samples.flatMap((sample) => sample.users))];
  const subtitle = !index
    ? "Indexing…"
    : !missing || !users
      ? "Looking through the card…"
      : missing.samples.length
        ? `${plural(missing.samples.length, "sample")} · ${documentsSummary(users)}`
        : "None";
  return (
    <section className="details">
      <Oled title="Missing samples" subtitle={subtitle} />
      {missing && missing.folders.length > 0 && (
        <>
          <div className="section-head">
            <h3 className="label">Found in other folders {missing.folders.length}</h3>
            <span className="hint">Same names, same folders below</span>
          </div>
          <ul className="links">
            {missing.folders.map(({ from, to, relinks }) => (
              <li key={`${from}\n${to}`}>
                <div className="link">
                  <span className="link-name" title={`${from} → ${to}`}>
                    {shortPath(from)} → {shortPath(to)}
                  </span>
                  <span className="link-detail">{plural(relinks.length, "sample")}</span>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => onRelink(`Relinked ${plural(relinks.length, "sample")} to ${baseName(to)}`, relinks)}
                  >
                    Relink
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {missing && missing.samples.length > 0 && (
        <>
          <div className="section-head">
            <h3 className="label">By folder</h3>
          </div>
          <ul className="links">
            {byFolder(missing.samples).map(([folder, samples]) => (
              <MissingFolder key={folder} folder={folder} samples={samples} busy={busy} onRelink={onRelink} onGoTo={onGoTo} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function byFolder(samples: MissingSample[]): [string, MissingSample[]][] {
  const folders = new Map<string, [string, MissingSample[]]>();
  for (const sample of samples) {
    const folder = parentPath(sample.path);
    const entry = folders.get(pathKey(folder));
    if (entry) entry[1].push(sample);
    else folders.set(pathKey(folder), [folder, [sample]]);
  }
  return [...folders.values()];
}

function shortPath(path: string): string {
  return path.replace(/^SAMPLES\//i, "");
}

function MissingFolder({
  folder,
  samples,
  busy,
  onRelink,
  onGoTo,
}: Omit<Props, "card" | "index"> & { folder: string; samples: MissingSample[] }) {
  const [open, setOpen] = useState(false);
  const users = [...new Set(samples.flatMap((sample) => sample.users))];
  return (
    <li>
      <button className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="link-name" title={folder}>
          {shortPath(folder) || folder}
        </span>
        <span className="link-detail">
          {plural(samples.length, "sample")} · {documentsSummary(users)}
        </span>
      </button>
      {open && (
        <ul className="missing-samples">
          {samples.map((sample) => (
            <li key={sample.path}>
              <div className="missing-name">{baseName(sample.path)}</div>
              <div className="missing-line">
                <span className="label">Used by</span>
                {sample.users.map((user) => (
                  <button key={user} className="text-button" title={user} onClick={() => onGoTo(user)}>
                    {baseName(user).replace(/\.xml$/i, "")}
                  </button>
                ))}
              </div>
              {sample.candidates.length ? (
                sample.candidates.map((candidate) => (
                  <div key={candidate} className="missing-line">
                    <span className="label">Found</span>
                    <span className="candidate" title={candidate}>
                      {shortPath(parentPath(candidate))}
                    </span>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => onRelink(`Relinked ${baseName(sample.path)}`, [{ from: sample.path, to: candidate }])}
                    >
                      Relink
                    </button>
                  </div>
                ))
              ) : (
                <div className="missing-line">
                  <span className="label missing">Not on the card</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
