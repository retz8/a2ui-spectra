/**
 * A parse's raw text with its component ranges: plain at rest, each
 * rejected block in red-soft; hovering outlines the innermost component
 * under the pointer, clicking selects it, and the selected component's
 * whole range takes the teal-soft tint. Text outside any component stays
 * plain and links to nothing. A grey sentence above says when the ranges
 * are not all worked out.
 */
import {type MouseEvent, type ReactNode, useEffect, useRef, useState} from 'react';

import {cn} from '@/lib/utils';
import type {NodeRef} from '@/model/address.ts';
import type {ComponentRange} from '@/model/record.ts';
import {toggleBlockFold, useBlockFold} from '@/state/block_folds.ts';

import {CopyButton} from './CopyButton.tsx';
import {BlockLabel} from './JsonBlock.tsx';

/** A rejected block's range to bring into view: a new one each time it is asked for. */
export interface RangeReveal {
  start: number;
  end: number;
}

type Mark =
  | {kind: 'block'; start: number; end: number}
  | {kind: 'component'; start: number; end: number; range: ComponentRange};

interface MarkNode {
  mark: Mark;
  children: MarkNode[];
}

/** The marks as a tree by containment, outer first; a mark that overlaps its parent's end is clipped to it. */
function treeOf(marks: readonly Mark[]): MarkNode[] {
  const sorted = [...marks].sort((a, b) => a.start - b.start || b.end - a.end);
  const roots: MarkNode[] = [];
  const stack: MarkNode[] = [];
  for (const mark of sorted) {
    while (stack.length > 0 && stack[stack.length - 1].mark.end <= mark.start) stack.pop();
    const parent = stack[stack.length - 1];
    const clipped =
      parent !== undefined && mark.end > parent.mark.end ? {...mark, end: parent.mark.end} : mark;
    const node: MarkNode = {mark: clipped, children: []};
    (parent === undefined ? roots : parent.children).push(node);
    stack.push(node);
  }
  return roots;
}

function keyOf(range: NodeRef): string {
  return `${range.surfaceId}\u0000${range.componentId}`;
}

export function RawText({
  text,
  ranges,
  blocks,
  selected,
  onSelect,
  reveal,
  sentence,
}: {
  text: string;
  ranges: readonly ComponentRange[];
  /** The rejected blocks, each tinted red-soft. */
  blocks: ReadonlyArray<{start: number; end: number}>;
  /** The selected component, whose range takes the selection tint. */
  selected: NodeRef | undefined;
  onSelect: (node: NodeRef) => void;
  reveal: RangeReveal | undefined;
  /** Why the ranges are not all worked out, when they are not. */
  sentence: string | undefined;
}) {
  const label = 'Raw text';
  const fold = useBlockFold(label);
  const [hovered, setHovered] = useState<string | undefined>();
  const block = useRef<HTMLDivElement>(null);
  const selectedKey = selected === undefined ? undefined : keyOf(selected);
  // The selected range is scrolled into view as it changes; a revealed block likewise.
  useEffect(() => {
    if (selectedKey === undefined) return;
    // Matched by value: CSS.escape writes the key's U+0000 as U+FFFD, so no selector finds it.
    const reveal = () =>
      scrollTo(
        [...(block.current?.querySelectorAll('[data-component]') ?? [])].find(
          element => element.getAttribute('data-component') === selectedKey,
        ),
      );
    reveal();
    return keepInView(block.current, reveal);
  }, [selectedKey]);
  const revealed = useRef<RangeReveal | undefined>(undefined);
  useEffect(() => {
    if (reveal === undefined || revealed.current === reveal) return;
    if (!fold.open) {
      toggleBlockFold(label);
      return;
    }
    revealed.current = reveal;
    scrollTo(block.current?.querySelector(`[data-block="${reveal.start}-${reveal.end}"]`));
  }, [reveal, fold.open]);

  const marks: Mark[] = [
    ...blocks.map(({start, end}) => ({kind: 'block' as const, start, end})),
    ...ranges.map(range => ({
      kind: 'component' as const,
      start: range.start,
      end: range.end,
      range,
    })),
  ];
  const tree = treeOf(marks.filter(mark => mark.start < mark.end && mark.end <= text.length));

  const componentAt = (event: MouseEvent<HTMLElement>): HTMLElement | null =>
    (event.target as HTMLElement).closest('[data-component]');
  const render = (nodes: readonly MarkNode[], from: number, to: number): ReactNode[] => {
    const out: ReactNode[] = [];
    let at = from;
    nodes.forEach((node, index) => {
      const {mark} = node;
      if (mark.start > at) out.push(text.slice(at, mark.start));
      const inner = render(node.children, mark.start, mark.end);
      if (mark.kind === 'block') {
        out.push(
          <span
            key={index}
            data-block={`${mark.start}-${mark.end}`}
            className="rounded-sm bg-problem-soft"
          >
            {inner}
          </span>,
        );
      } else {
        const key = keyOf(mark.range);
        out.push(
          <span
            key={index}
            data-component={key}
            className={cn(
              'rounded-sm',
              key === selectedKey && 'bg-brand-soft',
              key === hovered && 'outline-1 outline-brand',
            )}
          >
            {inner}
          </span>,
        );
      }
      at = mark.end;
    });
    if (to > at) out.push(text.slice(at, to));
    return out;
  };
  return (
    <section className="flex min-w-0 flex-col gap-1.5">
      {sentence !== undefined && <p className="text-xs text-muted-foreground">{sentence}</p>}
      <BlockLabel label={label} fold={fold}>
        <CopyButton iconFirst text={text} label="Copy the raw text" className="h-6 px-1.5 text-xs">
          Copy
        </CopyButton>
      </BlockLabel>
      {fold.open && (
        <div
          ref={block}
          onMouseOver={event => setHovered(componentAt(event)?.dataset.component)}
          onMouseLeave={() => setHovered(undefined)}
          onClick={event => {
            const key = componentAt(event)?.dataset.component;
            if (key === undefined) return;
            const [surfaceId, componentId] = key.split('\u0000');
            onSelect({surfaceId, componentId});
          }}
          className="rounded-lg bg-tint px-3 py-2.5 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap"
        >
          {render(tree, 0, text.length)}
        </div>
      )}
    </section>
  );
}

/**
 * Reveals the range again each time the pane scrolling it changes height,
 * as the split settles after a reload, until the reader scrolls the pane.
 */
function keepInView(element: HTMLElement | null, reveal: () => void): (() => void) | undefined {
  let pane = element?.parentElement ?? null;
  while (pane !== null && !/(auto|scroll)/.test(getComputedStyle(pane).overflowY)) {
    pane = pane.parentElement;
  }
  if (pane === null) return undefined;
  let height = pane.clientHeight;
  const observer = new ResizeObserver(() => {
    if (pane.clientHeight === height) return;
    height = pane.clientHeight;
    reveal();
  });
  observer.observe(pane);
  const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
  const stop = () => {
    observer.disconnect();
    for (const name of events) pane.removeEventListener(name, stop);
  };
  for (const name of events) pane.addEventListener(name, stop, {passive: true});
  return stop;
}

/**
 * Scrolls a range into view: centred, or, when it is taller than the pane
 * scrolling it, from its start, as a rejected block of a whole reply is.
 */
function scrollTo(element: Element | null | undefined): void {
  if (element === null || element === undefined) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let pane = element.parentElement;
  while (pane !== null && !/(auto|scroll)/.test(getComputedStyle(pane).overflowY)) {
    pane = pane.parentElement;
  }
  const tall = pane !== null && element.getBoundingClientRect().height > pane.clientHeight;
  element.scrollIntoView({block: tall ? 'start' : 'center', behavior: reduce ? 'auto' : 'smooth'});
}
