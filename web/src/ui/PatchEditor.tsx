import { type CSSProperties, type KeyboardEvent, type PointerEvent, useMemo, useState } from "react";
import { baseName, type Card } from "../card/card";
import { readDocument } from "../card/usageIndex";
import { cableEdit, context, type Edits, newSynth, readPatch, same, type Values, withEdits } from "../patch/patch";
import {
  type CableKey,
  cableKey,
  type Choice,
  destinationName,
  scales,
  sections,
  type Setting,
  settings,
  sourceNames,
} from "../patch/settings";
import { useRememberedFlag } from "./Deck";
import { ComparePickerDialog } from "./Dialogs";
import { useAsync } from "./useAsync";
import { plural } from "./words";

type Props = {
  card: Card;
  xml: string;
  edits: Edits;
  onEdit: (edits: Edits) => void;
};

// A synth's settings, showing first how it differs from a new synth, or from another synth, and letting each
// difference be switched off to hear what it brings. Edits only change what's heard: they're never saved.
export function PatchEditor({ card, xml, edits, onEdit }: Props) {
  const saved = useMemo(() => readPatch(xml), [xml]);
  const now = useMemo(() => withEdits(saved, edits), [saved, edits]);
  const [showAll, toggleShowAll] = useRememberedFlag("webluge.showAllSettings", false);
  const { base, name: baseLabel, picker } = useBase(card);

  const rows = settings.map((setting) => settingRow(setting, saved, now, base));
  const changed = rows.filter((row) => row.changedInPatch);
  const numSilent = changed.filter((row) => row.silent).length;
  const cablesChanged = cableKeys(saved, base).filter((key) => !same("cable", saved.cables[key], base.cables[key]));
  const untouched = sections.filter(
    (section) => section !== "Modulation" && !rows.some((row) => row.setting.section === section && row.changedInPatch),
  );

  function set(key: string, value: number | string | null, patchValue: number | string | null | undefined) {
    const next = { ...edits };
    if (value === patchValue || (patchValue === undefined && value === null)) delete next[key];
    else next[key] = value;
    onEdit(next);
  }

  const numChanges = changed.length + cablesChanged.length;
  return (
    <div className="patch">
      <div className="section-head">
        <h3 className="label">
          Differences {numChanges - numSilent}
          {numSilent > 0 && <span className="patch-silent-count"> + {numSilent} unheard</span>}
        </h3>
        <span className="octaves">
          {Object.keys(edits).length > 0 && (
            <button className="text-button" onClick={() => onEdit({})}>
              Revert edits
            </button>
          )}
          <button className="text-button" aria-pressed={showAll} onClick={toggleShowAll}>
            {showAll ? "Only differences" : "All settings"}
          </button>
        </span>
      </div>
      <div className="patch-intro">
        {picker}
        <p className="notice muted">
          {numChanges > numSilent
            ? `Switch a difference off to hear ${baseLabel}'s setting instead. Edits aren't saved.`
            : numChanges
              ? `Sounds like ${baseLabel}: none of its differences can be heard.`
              : `The same as ${baseLabel}.`}
        </p>
      </div>

      {sections.map((section) => {
        if (section === "Modulation") {
          return <Modulation key={section} saved={saved} now={now} base={base} showAll={showAll} onSet={set} />;
        }
        const shown = rows.filter(
          (row) => row.setting.section === section && (showAll || row.changedInPatch || row.edited),
        );
        if (!shown.length) return null;
        const numChanged = shown.filter((row) => row.changedInPatch).length;
        return (
          <section key={section} className="patch-section">
            <div className="patch-section-head">
              <h4 className="label">{section}</h4>
              <span className="hint">{numChanged ? `${numChanged} different` : "The same"}</span>
            </div>
            {section === "Envelopes" && <Envelopes now={now} base={base} />}
            {shown.map((row) => (
              <SettingRow
                key={row.setting.id}
                row={row}
                now={now}
                baseLabel={baseLabel}
                onSet={(value) => set(row.setting.id, value, saved.settings[row.setting.id])}
              />
            ))}
          </section>
        );
      })}

      {!showAll && untouched.length > 0 && (
        <p className="notice muted patch-untouched">
          The same as {baseLabel}: {untouched.join(", ")}
        </p>
      )}
    </div>
  );
}

const newSynthName = "New synth";

// What to compare with: a new synth, or a synth on the card. Remembered while browsing, to compare others with it.
function useBase(card: Card) {
  const [path, setPath] = useState(() => {
    try {
      return localStorage.getItem("webluge.patchBase") ?? "";
    } catch {
      return "";
    }
  });
  const [picking, setPicking] = useState(false);
  const xml = useAsync(() => (path ? readDocument(card, path) : Promise.resolve(undefined)), [card, path]);
  const base = useMemo(() => {
    try {
      return xml ? readPatch(xml) : newSynth;
    } catch {
      return newSynth;
    }
  }, [xml]);

  function choose(next: string) {
    setPicking(false);
    setPath(next);
    try {
      localStorage.setItem("webluge.patchBase", next);
    } catch {
      // Not remembered, then.
    }
  }

  // Until it's read, or if it's gone from the card.
  const name = path && xml ? withoutExtension(path) : newSynthName;
  const picker = (
    <span className="patch-base">
      <span className="label">Compared with</span>
      <button className="patch-base-button" title={path || newSynthName} onClick={() => setPicking(true)}>
        {name}
      </button>
      {picking && (
        <ComparePickerDialog
          card={card}
          current={xml ? path : ""}
          onPick={choose}
          onCancel={() => setPicking(false)}
        />
      )}
    </span>
  );
  return { base, name, picker };
}

function withoutExtension(path: string): string {
  return baseName(path).replace(/\.[^.]*$/, "");
}

type Value = number | string;

type Row = {
  setting: Setting;
  saved: Value;
  now: Value;
  base: Value;
  // As saved, compared with the base.
  changedInPatch: boolean;
  // As heard, compared with the base.
  changed: boolean;
  edited: boolean;
  silent?: string;
};

function settingRow(setting: Setting, saved: Values, now: Values, base: Values): Row {
  const { id } = setting;
  return {
    setting,
    saved: saved.settings[id],
    now: now.settings[id],
    base: base.settings[id],
    changedInPatch: !same(setting, saved.settings[id], base.settings[id]),
    changed: !same(setting, now.settings[id], base.settings[id]),
    edited: !same(setting, now.settings[id], saved.settings[id]),
    silent: setting.silentBecause?.(context(now)),
  };
}

function format(setting: Setting, value: Value): string {
  if (setting.kind === "knob") return setting.scale.format(setting.scale.toUser(value as number));
  if (setting.kind === "count") return setting.format(value as number);
  return setting.format(value as string);
}

type RowProps = { row: Row; now: Values; baseLabel: string; onSet: (value: Value) => void };

function SettingRow({ row, now, baseLabel, onSet }: RowProps) {
  const { setting } = row;
  const [dragging, setDragging] = useState<number>();
  // The value worth comparing with: the patch's own once edited, otherwise the base's.
  const reference = row.edited
    ? `saved ${format(setting, row.saved)}`
    : row.changed
      ? `vs ${format(setting, row.base)}`
      : "";
  const cables = setting.kind === "knob" && setting.destination ? cablesTo(now, setting.destination) : [];
  return (
    <div className={`patch-row ${row.changed ? "changed" : ""} ${row.silent ? "silent" : ""}`}>
      <ChangeSwitch
        changed={row.changed}
        changedInPatch={row.changedInPatch}
        label={`${setting.label} as in ${row.changed ? baseLabel : "this patch"}`}
        onToggle={() => onSet(row.changed ? row.base : row.saved)}
      />
      <span className="patch-label">{setting.label}</span>
      {setting.kind === "choice" ? (
        <Options choice={setting} value={row.now as string} base={row.base as string} onSet={onSet} />
      ) : (
        <SettingBar
          row={row}
          cables={cables}
          dragging={dragging}
          onDrag={setDragging}
          onCommit={(value) => {
            setDragging(undefined);
            onSet(value);
          }}
        />
      )}
      <span className="patch-value">
        {setting.kind !== "choice" && format(setting, dragging ?? row.now)}
        <span className="patch-reference">{reference}</span>
      </span>
      {(row.silent || cables.length > 0) && (
        <span className="patch-note">
          {row.silent ?? `← ${cables.map((c) => `${sourceNames[c.source]} ${formatCable(c.amount)}`).join(" · ")}`}
        </span>
      )}
    </div>
  );
}

// Lit while a difference is heard; switching it off takes the base's setting until it's switched on again.
function ChangeSwitch(props: { changed: boolean; changedInPatch: boolean; label: string; onToggle: () => void }) {
  const { changed, changedInPatch, label, onToggle } = props;
  if (!changed && !changedInPatch) return <span className="change-switch same" />;
  return (
    <button
      className={`change-switch ${changed ? "on" : "off"}`}
      aria-pressed={changed}
      title={`Hear ${label}`}
      onClick={onToggle}
    />
  );
}

// Every option at once, which the device shows one at a time, with the base's marked.
function Options(props: { choice: Choice; value: string; base: string; onSet: (value: string) => void }) {
  const { choice, value, base, onSet } = props;
  // A patch can hold one the editor doesn't offer, such as a sample oscillator.
  const options = [...new Set([...choice.options, value, base])];
  return (
    <div className="patch-options" role="radiogroup" aria-label={choice.label}>
      {options.map((option) => (
        <button
          key={option}
          role="radio"
          aria-checked={option === value}
          className={`${option === value ? "selected" : ""} ${option === base ? "base" : ""}`}
          onClick={() => onSet(option)}
        >
          {choice.format(option)}
        </button>
      ))}
    </div>
  );
}

type Cable = { source: string; amount: number };

const formatCable = (amount: number | undefined) =>
  amount === undefined ? "none" : scales.cable.format(scales.cable.toUser(amount));

function cablesTo(values: Values, destination: string): Cable[] {
  return Object.entries(values.cables)
    .filter(([key]) => key.endsWith(`>${destination}`))
    .map(([key, amount]) => ({ source: key.split(">")[0], amount }));
}

// Sources that only push a setting one way from where it's set.
const unipolarSources = new Set(["envelope1", "envelope2", "aftertouch", "compressor"]);

// A knob or a count as a bar in the device's own numbers. A knob also shows how far its patch cables can move it,
// though only as a sketch of their reach: the firmware's patching isn't linear.
function SettingBar(props: {
  row: Row;
  cables: Cable[];
  dragging?: number;
  onDrag: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  const { row, cables, dragging, onDrag, onCommit } = props;
  const setting = row.setting as Exclude<Setting, Choice>;
  const toUser = (v: number) => (setting.kind === "knob" ? setting.scale.toUser(v) : v);
  const fromUser = (u: number) => (setting.kind === "knob" ? setting.scale.fromUser(u) : u);
  const [low, high] =
    setting.kind === "knob" ? [setting.scale.min, setting.scale.max].map(toUser) : [setting.min, setting.max];
  const value = dragging ?? (row.now as number);
  const reach = (direction: 1 | -1) =>
    cables.reduce((sum, { source, amount }) => {
      const push = amount * 2;
      if (!unipolarSources.has(source)) return sum + direction * Math.abs(push);
      return direction * push > 0 ? sum + push : sum;
    }, 0);
  const position = (u: number) => Math.max(0, Math.min(1, (u - low) / (high - low)));
  const at = position(toUser(value));
  const origin = position(low < 0 && high > 0 ? 0 : low);
  const clampUser = (u: number) => Math.max(low, Math.min(high, u));

  function valueAt(event: PointerEvent<HTMLDivElement>): number {
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    return fromUser(Math.round(low + fraction * (high - low)));
  }

  function step(event: KeyboardEvent) {
    const by = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[event.key];
    if (!by) return;
    event.preventDefault();
    onCommit(fromUser(clampUser(toUser(value) + by)));
  }

  return (
    <div
      className="patch-bar"
      role="slider"
      tabIndex={0}
      aria-label={setting.label}
      aria-valuetext={format(setting, value)}
      style={
        {
          "--fill-from": Math.min(origin, at),
          "--fill-to": Math.max(origin, at),
          "--base": position(toUser(row.base as number)),
          "--low": position(toUser(value + reach(-1))),
          "--high": position(toUser(value + reach(1))),
        } as CSSProperties
      }
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        onDrag(valueAt(event));
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) onDrag(valueAt(event));
      }}
      onPointerUp={(event) => onCommit(valueAt(event))}
      onKeyDown={step}
    >
      {cables.length > 0 && <span className="patch-bar-reach" />}
      <span className="patch-bar-fill" />
      <span className="patch-bar-base" />
    </div>
  );
}

function cableKeys(...values: Values[]): CableKey[] {
  return [...new Set(values.flatMap((v) => Object.keys(v.cables) as CableKey[]))];
}

// Every patch cable at once, sources across and destinations down: on the device, each is found by holding a source's
// pad and turning the select knob through the destinations.
function Modulation(props: {
  saved: Values;
  now: Values;
  base: Values;
  showAll: boolean;
  onSet: (key: string, value: number | null, patchValue: number | undefined) => void;
}) {
  const { saved, now, base, showAll, onSet } = props;
  const keys = cableKeys(saved, now, base);
  const sources = Object.keys(sourceNames).filter((source) => showAll || keys.some((k) => k.startsWith(`${source}>`)));
  const destinations = [...new Set(keys.map((key) => key.split(">")[1]))];
  const numChanged = cableKeys(saved, base).filter((k) => !same("cable", saved.cables[k], base.cables[k])).length;
  const name = (destination: string) => {
    if (destination !== "range") return destinationName(destination);
    const [source, target] = (now.adjustable ?? ">").split(">");
    return now.adjustable ? `${sourceNames[source]} → ${destinationName(target)} depth` : "Cable depth";
  };
  return (
    <section className="patch-section">
      <div className="patch-section-head">
        <h4 className="label">Modulation</h4>
        <span className="hint">{numChanged ? `${plural(numChanged, "cable")} different` : "The same"}</span>
      </div>
      <div className="patch-matrix" style={{ "--sources": sources.length } as CSSProperties}>
        <span />
        {sources.map((source) => (
          <span key={source} className="label patch-matrix-source">
            {sourceNames[source]}
          </span>
        ))}
        {destinations.map((destination) => (
          <MatrixRow
            key={destination}
            name={name(destination)}
            cells={sources.map((source) => cableKey(source, destination))}
            saved={saved}
            now={now}
            base={base}
            onSet={(key, value) => onSet(cableEdit(key), value, saved.cables[key])}
          />
        ))}
      </div>
    </section>
  );
}

function MatrixRow(props: {
  name: string;
  cells: CableKey[];
  saved: Values;
  now: Values;
  base: Values;
  onSet: (key: CableKey, value: number | null) => void;
}) {
  const { name, cells, saved, now, base, onSet } = props;
  return (
    <>
      <span className="patch-matrix-destination">{name}</span>
      {cells.map((key) => (
        <CableCell
          key={key}
          label={`${sourceNames[key.split(">")[0]]} to ${name}`}
          amount={now.cables[key]}
          saved={saved.cables[key]}
          baseAmount={base.cables[key]}
          onSet={(value) => onSet(key, value)}
        />
      ))}
    </>
  );
}

// Click to switch a different cable to the base's and back; drag sideways, or use the arrow keys, to change it.
function CableCell(props: {
  label: string;
  amount?: number;
  saved?: number;
  baseAmount?: number;
  onSet: (value: number | null) => void;
}) {
  const { label, amount, saved, baseAmount, onSet } = props;
  const [drag, setDrag] = useState<{ x: number; from: number; to: number; moved: boolean }>();
  const shown = drag ? drag.to : amount;
  const user = shown === undefined ? undefined : scales.cable.toUser(shown);
  const changed = !same("cable", amount, baseAmount);
  const changedInPatch = !same("cable", saved, baseAmount);
  const edited = !same("cable", amount, saved);

  const valueFrom = (from: number, steps: number) =>
    scales.cable.fromUser(Math.max(-50, Math.min(50, scales.cable.toUser(from) + steps)));
  const commit = (value: number) => onSet(scales.cable.toUser(value) === 0 && baseAmount === undefined ? null : value);

  function toggle() {
    if (changed) onSet(baseAmount ?? null);
    else if (changedInPatch) onSet(saved ?? null);
  }

  function step(event: KeyboardEvent) {
    const by = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[event.key];
    if (!by) return;
    event.preventDefault();
    commit(valueFrom(amount ?? 0, by));
  }

  const state = changed ? "changed" : changedInPatch ? "off" : amount !== undefined ? "same" : "empty";
  return (
    <button
      className={`patch-cell ${state} ${edited ? "edited" : ""}`}
      aria-label={`${label}: ${user === undefined ? "none" : scales.cable.format(user)}`}
      title={changedInPatch ? `${label}: compared with ${formatCable(baseAmount)}` : label}
      style={{ "--amount": (user ?? 0) / 50 } as CSSProperties}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        setDrag({ x: event.clientX, from: amount ?? 0, to: amount ?? 0, moved: false });
      }}
      onPointerMove={(event) => {
        if (!drag) return;
        const steps = Math.round((event.clientX - drag.x) / 3);
        if (steps || drag.moved) setDrag({ ...drag, to: valueFrom(drag.from, steps), moved: true });
      }}
      onPointerUp={() => {
        if (drag?.moved) commit(drag.to);
        else toggle();
        setDrag(undefined);
      }}
      onPointerCancel={() => setDrag(undefined)}
      onKeyDown={step}
    >
      {user !== undefined && (
        <>
          <span className="patch-cell-bar" />
          <span className="patch-cell-value">{scales.cable.format(user)}</span>
        </>
      )}
      {user === undefined && changedInPatch && <span className="patch-cell-value">×</span>}
    </button>
  );
}

const stages = ["attack", "decay", "sustain", "release"] as const;

// Each envelope's shape, over the base's.
function Envelopes({ now, base }: { now: Values; base: Values }) {
  return (
    <div className="patch-envelopes">
      {([1, 2] as const).map((n) => {
        const ids = stages.map((stage) => `env${n}.${stage}`);
        const shape = (values: Values) => ids.map((id) => scales.unipolar.toUser(values.settings[id] as number));
        const changed = ids.some((id) => {
          const setting = settings.find((s) => s.id === id)!;
          return !same(setting, now.settings[id], base.settings[id]);
        });
        return (
          <figure key={n} className="patch-envelope">
            <svg viewBox="0 0 200 60" preserveAspectRatio="none" aria-hidden>
              <path className="patch-envelope-base" d={envelopePath(shape(base))} />
              <path className={`patch-envelope-now ${changed ? "changed" : ""}`} d={envelopePath(shape(now))} />
            </svg>
            <figcaption className="label">Env {n}</figcaption>
          </figure>
        );
      })}
    </div>
  );
}

function envelopePath([attack, decay, sustain, release]: number[]): string {
  // Each timed stage gets up to a quarter of the width, with the sustain held for what's left.
  const width = 200 / 4;
  const top = 2;
  const bottom = 58;
  const a = (attack / 50) * width;
  const d = a + (decay / 50) * width;
  const level = bottom - (sustain / 50) * (bottom - top);
  const r = 200 - (release / 50) * width;
  return `M0 ${bottom} L${a} ${top} L${d} ${level} L${r} ${level} L200 ${bottom}`;
}
