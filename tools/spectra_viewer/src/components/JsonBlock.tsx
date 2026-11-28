import {type ReactNode, useEffect, useMemo, useRef, useState} from 'react';

import {reducedMotion} from '@/lib/scroll.ts';
import {cn} from '@/lib/utils';
import {
  carriesJsonInString,
  type JsonLine,
  jsonLines,
  lineMarksOf,
  markedLine,
  unfoldedTo,
} from '@/model/json_lines.ts';
import {type BlockFold, toggleBlockFold, useBlockFold} from '@/state/block_folds.ts';

import {CopyButton} from './CopyButton.tsx';
import {Icon, LegacyMark} from './icons.tsx';

/** A marked path to bring into view: a new one each time it is asked for. */
export interface Reveal {
  path: string;
}

/** How a value's JSON in a string shows: parsed in place, or as it came. */
const SHOWN = ['Parsed', 'As received'] as const;

/**
 * A labelled block of JSON on one tinted block, with a copy button and each
 * object and array foldable. A string holding JSON shows parsed, noted "JSON
 * in a string", and the switch beside Copy shows it as it came. The lines of
 * the marked paths are tinted, a folded line for one it hides, and a path
 * revealed is unfolded and scrolled to. The line of a bare envelope key in
 * the legacy form, or a folded line that hides one, carries a band in the
 * border grey and the hourglass at its end; a marked line keeps its soft red
 * and carries the hourglass too.
 */
export function JsonBlock({
  label,
  value,
  meta,
  marks = [],
  legacy = [],
  reveal,
  folded: foldedAtFirst = [],
  startsFolded = false,
}: {
  label: string;
  value: unknown;
  meta?: ReactNode;
  /** Folded on its label line until opened, as a parse's messages are. */
  startsFolded?: boolean;
  /** The paths of the values problems mark, as `markedPath` gives them. */
  marks?: readonly string[];
  /** The paths of the bare envelope keys in the legacy form. */
  legacy?: readonly string[];
  reveal?: Reveal;
  /** The objects and arrays folded at first, by their JSON Pointers. */
  folded?: readonly string[];
}) {
  const fold = useBlockFold(label, startsFolded);
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set(foldedAtFirst));
  const carried = useMemo(() => carriesJsonInString(value), [value]);
  const [asReceived, setAsReceived] = useState(false);
  // A reveal unfolds what hides its line before the block is drawn again.
  const [revealed, setRevealed] = useState(reveal);
  if (reveal !== revealed) {
    setRevealed(reveal);
    if (reveal !== undefined) setFolded(unfoldedTo(folded, reveal.path));
  }
  const lines = useMemo(
    () => jsonLines(value, folded, {parseStrings: carried && !asReceived}),
    [value, folded, carried, asReceived],
  );
  const lineMarks = useMemo(() => lineMarksOf(lines, marks, legacy), [lines, marks, legacy]);
  const block = useRef<HTMLDivElement>(null);
  // Only a new reveal scrolls; folding afterwards leaves the scroll as it is.
  const scrolled = useRef<Reveal | undefined>(undefined);
  useEffect(() => {
    if (reveal === undefined || scrolled.current === reveal) return;
    // A revealed line in a block folded on its label unfolds the block first.
    if (!fold.open) {
      toggleBlockFold(label);
      return;
    }
    scrolled.current = reveal;
    const reduce = reducedMotion();
    block.current?.children[markedLine(lines, reveal.path)]?.scrollIntoView({
      block: 'center',
      inline: 'nearest',
      behavior: reduce ? 'auto' : 'smooth',
    });
  }, [reveal, lines, fold.open, label]);
  const toggle = (path: string) => setFolded(toggled(folded, path));
  return (
    <section className="flex min-w-0 flex-col gap-1.5">
      <BlockLabel label={label} meta={meta} fold={fold}>
        {carried && (
          <ShownSwitch
            label="How the value shows"
            on={asReceived ? 1 : 0}
            onChange={index => setAsReceived(index === 1)}
          />
        )}
        <CopyButton text={JSON.stringify(value, null, 2)} label={`Copy the ${label.toLowerCase()}`}>
          Copy
        </CopyButton>
      </BlockLabel>
      {fold.open && (
        <div
          ref={block}
          className="type-code overflow-x-auto rounded-lg bg-tint py-2.5 leading-relaxed"
        >
          {lines.map((line, index) => (
            <LineRow key={index} line={line} {...lineMarks[index]} onToggle={toggle} />
          ))}
        </div>
      )}
    </section>
  );
}

/** Parsed or As received, as a block's JSON in a string or a table's names show. */
export function ShownSwitch({
  label,
  options = SHOWN,
  on,
  onChange,
}: {
  label: string;
  options?: readonly string[];
  on: number;
  onChange: (index: number) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex shrink-0 gap-0.5 rounded-lg bg-tint p-0.5"
    >
      {options.map((option, index) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={index === on}
          onClick={() => onChange(index)}
          className={cn(
            'ease-quick type-segment h-5 cursor-pointer rounded-md px-2 whitespace-nowrap',
            index === on && 'bg-panel shadow-panel',
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

/**
 * JSON as lines on a tinted block, each object and array foldable, the paths
 * given folded at first; for a block with no label of its own.
 */
export function JsonLines({
  value,
  folded: foldedAtFirst = [],
  className,
}: {
  value: unknown;
  folded?: readonly string[];
  className?: string;
}) {
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set(foldedAtFirst));
  const lines = useMemo(() => jsonLines(value, folded), [value, folded]);
  return (
    <div
      className={cn('type-code overflow-auto rounded-lg bg-tint py-2.5 leading-relaxed', className)}
    >
      {lines.map((line, index) => (
        <LineRow key={index} line={line} onToggle={path => setFolded(toggled(folded, path))} />
      ))}
    </div>
  );
}

function toggled(folded: ReadonlySet<string>, path: string): ReadonlySet<string> {
  const next = new Set(folded);
  if (!next.delete(path)) next.add(path);
  return next;
}

/**
 * One line of JSON, with its fold button when it opens an object or an
 * array, its note when its JSON came in a string, and the hourglass at its
 * end when it holds a bare envelope key.
 */
function LineRow({
  line,
  marked = false,
  legacy = false,
  onToggle,
}: {
  line: JsonLine;
  marked?: boolean;
  legacy?: boolean;
  onToggle: (path: string) => void;
}) {
  return (
    <div
      className={cn(
        'flex w-max min-w-full pr-3 pl-1 whitespace-pre',
        marked ? 'bg-problem-soft' : legacy && 'bg-border',
      )}
    >
      <span className="flex w-4 shrink-0 items-center justify-center">
        {line.fold !== undefined && (
          <button
            type="button"
            aria-label={line.folded ? 'Unfold' : 'Fold'}
            aria-expanded={!line.folded}
            onClick={() => onToggle(line.fold!)}
            className="flex size-4 cursor-pointer items-center justify-center rounded-sm tone-muted hover:bg-border hover:tone-foreground"
          >
            <Icon kind={line.folded ? 'chevronRight' : 'chevronDown'} size={12} />
          </button>
        )}
      </span>
      <span>{line.text}</span>
      {line.note !== undefined && (
        <span className="type-meta ml-2 leading-[inherit]">{line.note}</span>
      )}
      {legacy && (
        <>
          <span className="min-w-3 flex-1" />
          <LegacyMark size={12} className="items-center" />
        </>
      )}
    </div>
  );
}

/** The chevron that folds a block or a row. */
export function FoldButton({
  open,
  label,
  onToggle,
  onTint = false,
}: {
  open: boolean;
  /** What it folds, for its accessible name. */
  label: string;
  onToggle: () => void;
  /** Inside a tinted block, where its hover takes the border's fill. */
  onTint?: boolean;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={`${open ? 'Fold' : 'Unfold'} ${label.toLowerCase()}`}
      onClick={onToggle}
      className={cn(
        'flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm tone-muted hover:tone-foreground',
        onTint ? 'hover:bg-border' : 'hover:bg-tint',
      )}
    >
      <Icon kind={open ? 'chevronDown' : 'chevronRight'} size={12} />
    </button>
  );
}

/**
 * A block's label in small capitals, its fold's chevron before it, with what
 * sits on its right. A label that does not fold keeps the chevron's place,
 * so every label lines up.
 */
export function BlockLabel({
  label,
  meta,
  fold,
  children,
}: {
  label: string;
  meta?: ReactNode;
  /** The block's fold, drawn as a chevron before the label. */
  fold?: BlockFold;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-6 items-center gap-2 pl-0.5">
      {fold === undefined ? (
        <span aria-hidden="true" className="size-4 shrink-0" />
      ) : (
        <FoldButton open={fold.open} label={label} onToggle={fold.onToggle} />
      )}
      <span className="type-section-label shrink-0">{label}</span>
      {meta !== undefined && meta !== '' && (
        <span
          className="type-meta min-w-0 truncate"
          title={typeof meta === 'string' ? meta : undefined}
        >
          {meta}
        </span>
      )}
      <div className="flex-1" />
      {children}
    </div>
  );
}
