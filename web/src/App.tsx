import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Card, parentPath } from "./card/card";
import { rememberedCard } from "./card/connect";
import { followMove, inTrash, planRelinks } from "./card/plan";
import { refreshIndex, type UsageIndex } from "./card/usageIndex";
import { sampleRate } from "./preview/firmware";
import { Browser, type Selection } from "./ui/Browser";
import { ConnectCard } from "./ui/ConnectCard";
import { Details } from "./ui/Details";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { MissingSamples } from "./ui/MissingSamples";
import { type Drop, useDropTarget } from "./ui/drag";
import { samePath } from "./ui/files";
import { routeOf, useRoute } from "./ui/route";
import { useOperations } from "./ui/useOperations";
import { useOrganize } from "./ui/useOrganize";

const root: Selection = { path: "", folder: true };

export function App() {
  const [remembered, setRemembered] = useState<FileSystemDirectoryHandle>();
  const [card, setCard] = useState<Card>();

  useEffect(() => {
    rememberedCard().then(setRemembered, () => {});
  }, []);

  if (!card) {
    return <ConnectCard remembered={remembered} onConnect={(handle) => setCard(new Card(handle))} />;
  }
  return <CardView card={card} onClose={() => setCard(undefined)} />;
}

function CardView({ card, onClose }: { card: Card; onClose: () => void }) {
  const [index, setIndex] = useState<UsageIndex>();
  const [indexProgress, setIndexProgress] = useState<string>();
  const [route, navigate] = useRoute();
  // Entries chosen alongside the selection, in its folder, and the one a Shift-click extends from.
  const [choice, setChoice] = useState<{ paths: string[]; anchor: string }>();
  // Counts changes to the card, so the browser lists folders again.
  const [version, setVersion] = useState(0);
  const context = useRef<AudioContext>(undefined);
  // The same function every render, as previews decode and play again when it changes.
  const audioContext = useCallback(() => (context.current ??= new AudioContext({ sampleRate })), []);
  // The latest index, for refreshing from, however recently it was set.
  const latest = useRef<UsageIndex>(undefined);

  const selection = "view" in route ? root : route;
  // Whatever moved in a run, the selection and choice go with it.
  const current = useRef(selection);
  current.current = selection;

  async function refresh(rewritten?: string[]): Promise<UsageIndex> {
    try {
      const refreshed = await refreshIndex(
        card,
        latest.current,
        (done, total) => {
          if (total) setIndexProgress(`Indexing ${done} of ${total}`);
        },
        rewritten,
      );
      latest.current = refreshed;
      setIndex(refreshed);
      setIndexProgress(undefined);
      return refreshed;
    } catch (error) {
      setIndexProgress(`Indexing failed: ${error}`);
      throw error;
    }
  }
  const operations = useOperations(card, refresh, (done) => {
    setVersion((version) => version + 1);
    setChoice(
      (choice) =>
        choice && { paths: choice.paths.map((path) => followMove(done, path)), anchor: followMove(done, choice.anchor) },
    );
    const { path, folder } = current.current;
    const moved = followMove(done, path);
    if ("view" in routeOf(location.hash) || moved === path) return;
    // What's deleted isn't followed into the trash: the folder it was in stays showing.
    if (inTrash(moved) && !inTrash(path)) navigate({ path: parentPath(path), folder: true }, { replace: true });
    else navigate({ path: moved, folder }, { replace: true });
  });

  useEffect(() => {
    refresh().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chosen =
    choice && choice.paths.some((path) => samePath(path, selection.path))
      ? choice.paths
      : selection.path
        ? [selection.path]
        : [];
  const anchor = chosen === choice?.paths ? choice.anchor : selection.path;
  const organize = useOrganize({
    card,
    operations,
    selection: "view" in route ? undefined : selection,
    chosen,
    navigate,
  });

  const parts = selection.path ? selection.path.split("/") : [];
  const status = operations.status;
  return (
    <div className="app">
      <header className="top">
        <h1>Webluge</h1>
        <nav className="path" aria-label="Path">
          <button onClick={() => navigate(root)} title={card.name}>
            {card.name}
          </button>
          {"view" in route && (
            <>
              <span aria-hidden="true">/</span>
              <button onClick={() => navigate({ view: "missing" })}>Missing samples</button>
            </>
          )}
          {parts.map((part, i) => {
            const path = parts.slice(0, i + 1).join("/");
            const folder = i < parts.length - 1 || selection.folder;
            return (
              <Fragment key={i}>
                <span aria-hidden="true">/</span>
                <Crumb
                  name={part}
                  folder={folder ? path : undefined}
                  onClick={() => navigate({ path, folder })}
                  onDrop={organize.onDrop}
                />
              </Fragment>
            );
          })}
        </nav>
        <div className="card-name">
          {indexProgress && <span>{indexProgress}</span>}
          {status && (
            <span
              className={`status ${status.state === "failed" ? "error" : ""} ${status.fades ? "fades" : ""}`}
              role="status"
              title={status.message}
            >
              {status.message}
            </span>
          )}
          {operations.canUndo && (
            <button className="text-button" onClick={operations.undo}>
              Undo
            </button>
          )}
          <button
            className="key"
            disabled={operations.busy}
            onClick={() => {
              onClose();
              navigate(root);
            }}
          >
            Close card
          </button>
        </div>
      </header>
      <div className="body">
        <Browser
          card={card}
          selection={selection}
          chosen={chosen}
          anchor={anchor}
          index={index}
          version={version}
          tools={organize.tools}
          onSelect={navigate}
          onChoose={(paths, focus, { replace, anchor } = {}) => {
            setChoice({ paths, anchor: anchor ?? focus.path });
            navigate({ path: focus.path, folder: focus.kind === "folder" }, { replace });
          }}
          onDrop={organize.onDrop}
        />
        <ErrorBoundary
          key={"view" in route ? route.view : selection.path}
          fallback={(error) => (
            <section className="details empty error">Couldn't show this: {String(error)}</section>
          )}
        >
          {"view" in route ? (
            <MissingSamples
              card={card}
              index={index}
              busy={operations.busy}
              onRelink={(message, relinks) => operations.perform(message, (context) => planRelinks(context, relinks))}
              onGoTo={(path) => navigate({ path, folder: false })}
            />
          ) : operations.running ? (
            // Songs only ever load from a settled card.
            <section className="details empty">Changing the card…</section>
          ) : chosen.length > 1 ? (
            <section className="details empty">
              {chosen.length} chosen. Drag them onto a folder, or use Move to…
            </section>
          ) : selection.folder ? (
            <section className="details empty">Pick a song or sample. The arrow keys move through the columns.</section>
          ) : (
            <Details
              card={card}
              path={selection.path}
              index={index}
              audioContext={audioContext}
              onGoTo={(path) => navigate({ path, folder: false })}
            />
          )}
        </ErrorBoundary>
      </div>
      {organize.dialog}
    </div>
  );
}

// A folder in the path, which entries can be dragged onto.
function Crumb({
  name,
  folder,
  onClick,
  onDrop,
}: {
  name: string;
  folder?: string;
  onClick: () => void;
  onDrop: Drop;
}) {
  const drop = useDropTarget(folder, onDrop);
  return (
    <button title={name} className={drop.over ? "drop-target" : ""} onClick={onClick} {...drop.handlers}>
      {name}
    </button>
  );
}
