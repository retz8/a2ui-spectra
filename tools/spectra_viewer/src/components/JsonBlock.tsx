import {type ReactNode, useEffect, useMemo, useRef, useState} from 'react';

import {cn} from '@/lib/utils';
import {type JsonLine, jsonLines, markedLine, unfoldedTo} from '@/model/json_lines.ts';

import {CopyButton} from './CopyButton.tsx';
import {Icon} from './icons.tsx';

/** A marked path to bring into view: a new one each time it is asked for. */
export interface Reveal {
  path: string;
}

/**
 * A labelled block of JSON on one tinted block, with a copy button and each
 * object and array foldable. The lines of the marked paths are tinted, a
 * folded line for one it hides, and a path revealed is unfolded and scrolled to.
 */
export function JsonBlock({
  label,
  value,
  meta,
  marks = [],
  reveal,
  folded: foldedAtFirst = [],
}: {
  label: string;
  value: unknown;
  meta?: ReactNode;
  /** The paths of the values problems mark, as `markedPath` gives them. */
  marks?: readonly string[];
  reveal?: Reveal;
  /** The objects and arrays folded at first, by their JSON Pointers. */
  folded?: readonly string[];
}) {
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set(foldedAtFirst));
  // A reveal unfolds what hides its line before the block is drawn again.
  const [revealed, setRevealed] = useState(reveal);
  if (reveal !== revealed) {
    setRevealed(reveal);
    if (reveal !== undefined) setFolded(unfoldedTo(folded, reveal.path));
  }
  const lines = useMemo(() => jsonLines(value, folded), [value, folded]);
  const marked = useMemo(() => new Set(marks.map(path => markedLine(lines, path))), [lines, marks]);
  const block = useRef<HTMLDivElement>(null);
  // Only a new reveal scrolls; folding afterwards leaves the scroll as it is.
  const scrolled = useRef<Reveal | undefined>(undefined);
  useEffect(() => {
    if (reveal === undefined || scrolled.current === reveal) return;
    scrolled.current = reveal;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    block.current?.children[markedLine(lines, reveal.path)]?.scrollIntoView({
      block: 'center',
      inline: 'nearest',
      behavior: reduce ? 'auto' : 'smooth',
    });
  }, [reveal, lines]);
  const toggle = (path: string) => setFolded(toggled(folded, path));
  return (
    <section className="flex min-w-0 flex-col gap-1.5">
      <BlockLabel label={label} meta={meta}>
        <CopyButton
          text={JSON.stringify(value, null, 2)}
          label={`Copy the ${label.toLowerCase()}`}
          className="h-[22px] px-1.5 text-xs"
        >
          Copy
        </CopyButton>
      </BlockLabel>
      <div
        ref={block}
        className="overflow-x-auto rounded-lg bg-tint py-2 font-mono text-xs leading-[1.6]"
      >
        {lines.map((line, index) => (
          <LineRow key={index} line={line} marked={marked.has(index)} onToggle={toggle} />
        ))}
      </div>
    </section>
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
      className={cn(
        'overflow-auto rounded-lg bg-tint py-1.5 font-mono text-xs leading-[1.6]',
        className,
      )}
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

/** One line of JSON, with its fold button when it opens an object or an array. */
function LineRow({
  line,
  marked = false,
  onToggle,
}: {
  line: JsonLine;
  marked?: boolean;
  onToggle: (path: string) => void;
}) {
  return (
    <div
      className={cn('flex w-max min-w-full pr-3 pl-1 whitespace-pre', marked && 'bg-problem-soft')}
    >
      <span className="flex w-[18px] shrink-0 items-center justify-center">
        {line.fold !== undefined && (
          <button
            type="button"
            aria-label={line.folded ? 'Unfold' : 'Fold'}
            aria-expanded={!line.folded}
            onClick={() => onToggle(line.fold!)}
            className="flex size-4 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-border hover:text-foreground"
          >
            <Icon kind={line.folded ? 'chevronRight' : 'chevronDown'} size={11} />
          </button>
        )}
      </span>
      <span>{line.text}</span>
    </div>
  );
}

/** A block's label in small capitals, with what sits on its right. */
export function BlockLabel({
  label,
  meta,
  children,
}: {
  label: string;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-[22px] items-center gap-2">
      <span className="section-label">{label}</span>
      {meta !== undefined && <span className="text-xs text-muted-foreground">{meta}</span>}
      <div className="flex-1" />
      {children}
    </div>
  );
}
