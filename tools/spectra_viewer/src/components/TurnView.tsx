import {type ReactNode, useEffect, useMemo, useRef, useState} from 'react';
import {type PanelImperativeHandle, usePanelRef} from 'react-resizable-panels';

import {ResizableHandle, ResizablePanel, ResizablePanelGroup} from '@/components/ui/resizable.tsx';
import {checkLinesOf, checkStateOf} from '@/model/check_state.ts';
import {stepInView} from '@/model/follow.ts';
import {inputBriefOfTurn} from '@/model/input_brief.ts';
import {problemsOf} from '@/model/problems.ts';
import {type Turn, type TurnRecordEvent, unixMillis} from '@/model/record.ts';
import {replay} from '@/model/replay.ts';
import {type Position, replyThrough, type TimelineRow, timelineOf} from '@/model/steps.ts';
import {summaryOf} from '@/model/summary.ts';
import {briefText} from '@/model/turn_groups.ts';
import {type TurnView as TurnViewState, turnViewOf, useNeededRecords} from '@/state/selectors.ts';
import {useSpectra} from '@/state/spectra.ts';

import {Composer} from './Composer.tsx';
import {FirstScreen} from './FirstScreen.tsx';
import {formatDuration, formatOffset, formatStart} from './format.ts';
import {ResultPane} from './ResultPane.tsx';
import {StepDetail} from './StepDetail.tsx';
import {Timeline} from './Timeline.tsx';
import {TurnHeader} from './TurnHeader.tsx';

/** The detail's height when collapsed to its title line, in pixels. */
const DETAIL_TITLE = 41;

/** The detail's height when open with no size of its own yet, as a percentage of the pane. */
const DETAIL_OPEN = '38';

/** The turn view: the selected turn, or the first screen with no turns, with the composer docked under it. */
export function TurnView({
  traceId,
  onSelect,
}: {
  traceId: string | undefined;
  onSelect: (traceId: string) => void;
}) {
  const state = useSpectra();
  const needs: string[] = [];
  const view: TurnViewState =
    traceId === undefined ? {status: 'none'} : turnViewOf(state, traceId, needs);
  useNeededRecords(needs);
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const first = traceId === undefined && state.loaded && state.turns.length === 0;
  useEffect(() => {
    if (first) input.current?.focus();
  }, [first]);

  let body: ReactNode;
  if (first) {
    body = (
      <FirstScreen
        context={state.context}
        connected={state.connected}
        canSend={state.box.unavailable === undefined}
        onExample={example => {
          setDraft(example);
          input.current?.focus();
        }}
      />
    );
  } else if (traceId === undefined) {
    body = <Empty>No turn selected.</Empty>;
  } else if (view.status === 'loading') {
    body = <Empty>Reading the turn…</Empty>;
  } else if (view.status === 'error') {
    body = <Empty>{view.message}</Empty>;
  } else if (view.status === 'none') {
    body = <Empty>No turn has this trace id.</Empty>;
  } else {
    body = <TurnBody key={traceId} traceId={traceId} view={view} />;
  }
  return (
    <main className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl bg-panel shadow-panel">
      {body}
      <Composer text={draft} onText={setDraft} inputRef={input} onSent={onSelect} />
    </main>
  );
}

function Empty({children}: {children: string}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center text-muted-foreground">
      {children}
    </div>
  );
}

function TurnBody({
  traceId,
  view,
}: {
  traceId: string;
  view: Extract<TurnViewState, {status: 'open' | 'closed'}>;
}) {
  const state = useSpectra();
  const open = view.status === 'open';
  const events: readonly TurnRecordEvent[] = open ? view.live.events : view.turn.events;
  const turn: Turn | undefined = open ? undefined : view.turn;
  const summary = useMemo(() => (turn === undefined ? undefined : summaryOf(turn)), [turn]);
  const startMs = open ? Date.parse(view.live.startTime) : (summary?.startTime ?? 0);
  // The earlier turns and the events keep their identity until they change, so each replay runs once per change.
  const earlier = 'turns' in view.earlier ? view.earlier.turns : undefined;

  const timeline = useMemo(() => timelineOf(events, startMs), [events, startMs]);
  const whole = useMemo(
    () => (earlier === undefined ? undefined : replay(earlier, events)),
    [earlier, events],
  );
  const problems = useMemo(
    () => problemsOf(events, timeline, whole?.rejections ?? []),
    [events, timeline, whole],
  );
  const byStep = useMemo(() => countBy(problems, problem => problem.stepId), [problems]);
  const bySurface = useMemo(() => countBy(problems, problem => problem.surfaceId), [problems]);

  const [picked, setPicked] = useState<string | undefined>();
  // Whether the view watched the turn while it was open, to land on its first problem as it closes.
  const [followed] = useState(open);
  const inView = stepInView(timeline, {open, picked, followed, problems: byStep});
  const selected = inView.row;
  const position = useMemo(() => positionOf(selected), [selected]);
  const pane = useMemo(
    () =>
      earlier === undefined
        ? undefined
        : position === undefined
          ? whole
          : replay(earlier, events, position),
    [earlier, events, whole, position],
  );
  const reply = useMemo(() => replyThrough(events, position), [events, position]);

  const detail = usePanelRef();
  const [collapsed, setCollapsed] = useState(!inView.selected);
  // The detail is collapsed to its title line until a step is selected.
  useEffect(() => {
    if (inView.selected) openDetail(detail.current);
    else detail.current?.collapse();
  }, [inView.selected, detail]);

  const row = state.turns.find(listed => listed.traceId === traceId);
  const input = turn === undefined ? undefined : inputBriefOfTurn(turn);
  const title = briefText(input ?? row?.input) || 'A turn';
  const agent = summary?.agentName ?? row?.agentName ?? state.context?.agentName;
  const meta = [
    formatStart(startMs),
    ...(summary === undefined ? [] : [formatDuration(summary.durationMs)]),
    ...(summary?.protocolVersion === undefined ? [] : [`A2UI ${summary.protocolVersion}`]),
    ...(agent === undefined ? [] : [agent]),
  ];

  return (
    <>
      <TurnHeader
        title={title}
        status={summary?.outcome ?? 'open'}
        check={turn === undefined ? undefined : checkStateOf(turn, problems.length)}
        checks={turn === undefined ? [] : checkLinesOf(turn)}
        meta={meta}
        traceId={traceId}
        conversationId={summary?.conversationId ?? (open ? view.live.conversationId : undefined)}
      />
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={340} minSize={240}>
          <Timeline
            rows={timeline}
            selected={selected?.id ?? ''}
            problems={byStep}
            live={open}
            following={inView.following}
            onSelect={setPicked}
            onJump={() => setPicked(undefined)}
          />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel minSize={360}>
          <ResizablePanelGroup orientation="vertical">
            <ResizablePanel minSize={160}>
              <ResultPane
                reply={reply}
                asOf={inView.following ? 'Live' : asOfLabel(selected, events, startMs)}
                replay={pane}
                problemsBySurface={bySurface}
                open={open}
              />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel
              panelRef={detail}
              defaultSize={inView.selected ? DETAIL_OPEN : DETAIL_TITLE}
              minSize={120}
              collapsible
              collapsedSize={DETAIL_TITLE}
              onResize={size => setCollapsed(size.inPixels <= DETAIL_TITLE + 1)}
            >
              {selected !== undefined && (
                <StepDetail
                  key={selected.id}
                  row={selected}
                  events={events}
                  startMs={startMs}
                  problems={problems.filter(problem => problem.stepId === selected.id)}
                  collapsed={collapsed}
                  onToggle={() => {
                    if (collapsed) openDetail(detail.current);
                    else detail.current?.collapse();
                  }}
                />
              )}
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
      </ResizablePanelGroup>
    </>
  );
}

/** Opens the collapsed detail to its last size, or, when it started collapsed and has none, to its default. */
function openDetail(panel: PanelImperativeHandle | null): void {
  if (panel === null || !panel.isCollapsed()) return;
  panel.expand();
  if (panel.getSize().inPixels <= DETAIL_TITLE + 1) panel.resize(DETAIL_OPEN);
}

/** Where the surfaces stand for a row: after its step, or after its whole delivery; the outcome follows everything. */
function positionOf(row: TimelineRow | undefined): Position | undefined {
  if (row === undefined) return undefined;
  return row.row === 'delivery' ? {eventIndex: row.eventIndex} : row.position;
}

function asOfLabel(
  row: TimelineRow | undefined,
  events: readonly TurnRecordEvent[],
  startMs: number,
): string {
  if (row === undefined) return '';
  if (row.row === 'delivery') return `After the delivery at ${formatOffset(row.offsetMs)}`;
  if (row.kind === 'outcome') return 'As the turn ended';
  const offset =
    row.offsetMs ??
    (row.position === undefined
      ? undefined
      : unixMillis(events[row.position.eventIndex].startTimeUnixNano) - startMs);
  return offset === undefined ? '' : `After the step at ${formatOffset(offset)}`;
}

function countBy<T>(
  items: readonly T[],
  keyOf: (item: T) => string | undefined,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    if (key !== undefined) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
