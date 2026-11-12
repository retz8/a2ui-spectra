import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type {ListedTurn} from '@/api.ts';
import {type DrawerRow, drawerRowsOf, lineCountOf, logTimeOf} from '@/model/logs.ts';
import type {AgentLogs} from '@/state/agent.ts';
import {rememberedSize, rememberSize} from '@/state/layout.ts';

import {formatDuration} from './format.ts';
import {Icon} from './icons.tsx';

/** The drawer's element id, which Logs in the bar and the links that open it name. */
export const LOGS_DRAWER_ID = 'logs-drawer';

/** The least the drawer's height can be dragged to, in pixels: its header and a few lines. */
const MIN_HEIGHT = 120;

/** How far an arrow key moves the drawer's top edge, in pixels. */
const KEY_STEP = 24;

/** How close to its end the log counts as at its end, in pixels. */
const AT_END = 4;

/**
 * The logs drawer, under `run`: the agent's output as the buffer holds it,
 * rising from the bottom of the page over the panels and the composer, a
 * third of the window tall until its top edge is dragged, which the browser
 * remembers. Each line reads its time to the millisecond, the stream it was
 * written to and its text; the stops and starts of the process are dividers,
 * and each listed turn is marked where it opened and where it closed, its
 * name a link that selects it. It follows its end until the reader scrolls
 * up, and Jump to latest resumes.
 */
export function LogsDrawer({
  command,
  logs,
  turns,
  onTurn,
  onClose,
}: {
  /** The agent's command as launched. */
  command: string;
  logs: AgentLogs | undefined;
  /** Every listed turn, whatever agent the turn list is showing. */
  turns: readonly ListedTurn[];
  /** Selects a turn in Turns. */
  onTurn: (traceId: string) => void;
  onClose: () => void;
}) {
  const rows = useMemo(() => drawerRowsOf(logs?.entries ?? [], turns), [logs, turns]);
  const section = useRef<HTMLElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(
    () => rememberedSize('logs') ?? Math.round(window.innerHeight / 3),
  );
  const [following, setFollowing] = useState(true);

  // It follows its end as rows come, until the reader scrolls up.
  useLayoutEffect(() => {
    const element = log.current;
    if (following && element !== null) element.scrollTop = element.scrollHeight;
  }, [rows, following, height]);

  /** The most the drawer's height can be: the room under the context bar. */
  const roomOf = () => section.current?.parentElement?.clientHeight ?? window.innerHeight;
  const resizeTo = (next: number, remember: boolean) => {
    const clamped = Math.round(Math.max(MIN_HEIGHT, Math.min(roomOf() - 8, next)));
    setHeight(clamped);
    if (remember) rememberSize('logs', clamped);
  };
  // A window made shorter keeps the drawer under the context bar.
  useEffect(() => {
    const onResize = () => setHeight(now => Math.max(MIN_HEIGHT, Math.min(roomOf() - 8, now)));
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const drag = useRef<{y: number; height: number} | undefined>(undefined);
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = {y: event.clientY, height};
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current === undefined) return;
    resizeTo(drag.current.height + drag.current.y - event.clientY, false);
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current === undefined) return;
    resizeTo(drag.current.height + drag.current.y - event.clientY, true);
    drag.current = undefined;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    resizeTo(height + (event.key === 'ArrowUp' ? KEY_STEP : -KEY_STEP), true);
  };

  return (
    <section
      ref={section}
      id={LOGS_DRAWER_ID}
      aria-label="Logs"
      style={{height}}
      className="fade-in-quick absolute right-2 bottom-2 left-0 z-20 flex flex-col overflow-hidden rounded-xl bg-panel shadow-float"
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the logs"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        className="flex h-2.5 shrink-0 cursor-row-resize touch-none items-center justify-center outline-none focus-visible:[&>span]:bg-brand"
      >
        <span className="h-1 w-9 rounded-full bg-border" />
      </div>
      <div className="flex h-7.5 shrink-0 items-center gap-2.5 pr-2.5 pb-0.5 pl-4">
        <h2 className="section-label shrink-0">Logs</h2>
        <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{command}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {lineCountOf(logs?.lines ?? 0, logs?.cap ?? 1000)}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          aria-label="Close the logs"
          title="Close the logs"
          onClick={onClose}
          className="ease-quick flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-tint hover:text-foreground"
        >
          <Icon kind="close" size={14} />
        </button>
      </div>
      <div
        ref={log}
        role="log"
        aria-label="The agent’s output"
        tabIndex={0}
        onScroll={event => {
          const element = event.currentTarget;
          const atEnd = element.scrollHeight - element.scrollTop - element.clientHeight <= AT_END;
          if (atEnd !== following) setFollowing(atEnd);
        }}
        className="min-h-0 flex-1 overflow-auto pb-2.5 font-mono text-xs leading-4.5 outline-none"
      >
        {rows.map(row => (
          <Row key={row.key} row={row} onTurn={onTurn} />
        ))}
        {(logs?.lines ?? 0) === 0 && (
          <p className="mx-4 my-1 font-sans text-sm text-muted-foreground">No output yet.</p>
        )}
      </div>
      {!following && (
        <div className="fade-in-quick pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <button
            type="button"
            onClick={() => setFollowing(true)}
            className="ease-quick pointer-events-auto inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-foreground pr-3 pl-2.5 text-xs font-semibold text-panel shadow-float"
          >
            <Icon kind="jump" size={14} />
            Jump to latest
          </button>
        </div>
      )}
    </section>
  );
}

/** One row: an output line, a stop or a start of the process, or a turn's marker. */
function Row({row, onTurn}: {row: DrawerRow; onTurn: (traceId: string) => void}) {
  if (row.kind === 'line') {
    return (
      <div className="flex gap-3 px-4 whitespace-pre">
        <span className="shrink-0 text-muted-foreground">{logTimeOf(row.time)}</span>
        <span className="w-6 shrink-0 text-muted-foreground">{row.stream}</span>
        <span>{row.text}</span>
      </div>
    );
  }
  // A divider and a marker keep the drawer's width, and stay in view while a long line is scrolled to.
  if (row.kind === 'divider') {
    return (
      <div
        role="separator"
        aria-label={row.text}
        className="sticky left-0 flex h-7 items-center gap-2.5 px-4 font-sans text-xs font-medium whitespace-nowrap text-muted-strong"
      >
        <span className="h-px min-w-4 flex-1 bg-border" />
        <span title={row.text} className="min-w-0 truncate">
          {row.text}
        </span>
        <span className="h-px min-w-4 flex-1 bg-border" />
      </div>
    );
  }
  return (
    <div className="sticky left-0 flex h-6.5 items-center gap-2 px-4 font-sans text-xs whitespace-nowrap text-muted-foreground">
      <span className="w-5 shrink-0 border-t border-dashed" />
      <span className="min-w-0 truncate">
        {row.kind === 'opened' ? (
          <>
            Turn opened ·{' '}
            <button
              type="button"
              onClick={() => onTurn(row.traceId)}
              className="cursor-pointer font-medium text-brand hover:underline"
            >
              {row.name}
            </button>
          </>
        ) : (
          `Turn closed · ${row.outcome} · ${formatDuration(row.durationMs)}`
        )}
      </span>
      <span className="flex-1 border-t border-dashed" />
    </div>
  );
}
