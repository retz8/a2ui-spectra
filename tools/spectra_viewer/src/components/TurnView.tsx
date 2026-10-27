import {type ReactNode, useEffect, useMemo, useRef, useState} from 'react';
import {type PanelImperativeHandle, usePanelRef} from 'react-resizable-panels';

import {ResizableHandle, ResizablePanel, ResizablePanelGroup} from '@/components/ui/resizable.tsx';
import {checkLinesOf, checkStateOf} from '@/model/check_state.ts';
import {keptPick, nextProblem, pickForKey, stepInView} from '@/model/follow.ts';
import {inputBriefOfTurn} from '@/model/input_brief.ts';
import {pageKeyOf} from '@/model/keys.ts';
import {catalogsOf} from '@/model/catalogs.ts';
import {agentMessages} from '@/model/messages.ts';
import {onlyProblems, turnProblemsOf} from '@/model/problems.ts';
import {type Turn, type TurnRecordEvent, unixMillis} from '@/model/record.ts';
import {replay} from '@/model/replay.ts';
import {type Position, replyThrough, type TimelineRow, timelineOf} from '@/model/steps.ts';
import {openFieldsOf, summaryOf} from '@/model/summary.ts';
import {briefText} from '@/model/turn_groups.ts';
import {detailOpenHeight, rememberedSize, rememberSize} from '@/state/layout.ts';
import {type TurnView as TurnViewState, turnViewOf, useNeededRecords} from '@/state/selectors.ts';
import {useSpectra} from '@/state/spectra.ts';
import {useSmallWindow} from '@/state/window.ts';

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

/** The timeline's width until its divider is dragged, in pixels: on a wide window and below 1,280px. */
const TIMELINE_WIDE = 340;
const TIMELINE_SMALL = 300;

/** The turn view: the selected turn, or the first screen with no turns, with the composer docked under it. */
export function TurnView({
  traceId,
  stepId,
  selection,
  onSelect,
  onStep,
}: {
  traceId: string | undefined;
  /** The step the page address holds. */
  stepId: string | undefined;
  /** Counts the turn list's selections, so selecting the same turn again counts too. */
  selection: number;
  onSelect: (traceId: string) => void;
  /** Selects a step of the turn, or none, putting it in the page address. */
  onStep: (traceId: string, stepId: string | undefined) => void;
}) {
  const state = useSpectra();
  const needs: string[] = [];
  const view: TurnViewState =
    traceId === undefined ? {status: 'none'} : turnViewOf(state, traceId, needs);
  useNeededRecords(needs);
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  // A new conversation asked for holds until a turn is selected.
  const selected = `${selection}:${traceId ?? ''}`;
  const [newAt, setNewAt] = useState<string | undefined>();

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
    body = (
      <TurnBody
        key={traceId}
        traceId={traceId}
        view={view}
        stepId={stepId}
        onStep={next => onStep(traceId, next)}
      />
    );
  }
  return (
    <main className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl bg-panel shadow-panel">
      {body}
      <Composer
        text={draft}
        onText={setDraft}
        inputRef={input}
        onSent={onSelect}
        traceId={traceId}
        startsNew={newAt === selected}
        onStartNew={() => {
          setNewAt(selected);
          input.current?.focus();
        }}
      />
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
  stepId: picked,
  onStep: setPicked,
}: {
  traceId: string;
  view: Extract<TurnViewState, {status: 'open' | 'closed'}>;
  /** The step picked, as the page address holds it. */
  stepId: string | undefined;
  onStep: (stepId: string | undefined) => void;
}) {
  const state = useSpectra();
  const small = useSmallWindow();
  const open = view.status === 'open';
  const events: readonly TurnRecordEvent[] = open ? view.live.events : view.turn.events;
  const turn: Turn | undefined = open ? undefined : view.turn;
  const summary = useMemo(() => (turn === undefined ? undefined : summaryOf(turn)), [turn]);
  const startMs = open ? Date.parse(view.live.startTime) : (summary?.startTime ?? 0);
  // The earlier turns and the events keep their identity until they change, so each replay runs once per change.
  const earlier = 'turns' in view.earlier ? view.earlier.turns : undefined;

  const timeline = useMemo(() => timelineOf(events, startMs), [events, startMs]);
  const catalogs = useMemo(() => catalogsOf(state.catalogs), [state.catalogs]);
  const whole = useMemo(
    () => (earlier === undefined ? undefined : replay(earlier, events, undefined, catalogs)),
    [earlier, events, catalogs],
  );
  const {problems, folded} = useMemo(
    () => turnProblemsOf(events, timeline, whole?.rejections ?? []),
    [events, timeline, whole],
  );
  const byStep = useMemo(() => countBy(problems, problem => problem.stepId), [problems]);
  const bySurface = useMemo(() => countBy(problems, problem => problem.surfaceId), [problems]);

  // The filter belongs to this turn: each turn opens with all its steps.
  const [filtered, setFiltered] = useState(false);
  const kept = useMemo(() => onlyProblems(timeline, byStep), [timeline, byStep]);
  const shown = filtered ? kept : timeline;
  const toggleFilter = () => {
    // A pick the filter hides gives way to the first problem.
    if (!filtered) setPicked(keptPick(picked, kept));
    setFiltered(!filtered);
  };
  const inView = stepInView(shown, {open, picked, problems: byStep});
  const selected = inView.row;
  const position = useMemo(() => positionOf(selected), [selected]);
  const pane = useMemo(
    () =>
      earlier === undefined
        ? undefined
        : position === undefined
          ? whole
          : replay(earlier, events, position, catalogs),
    [earlier, events, whole, position, catalogs],
  );
  const reply = useMemo(() => replyThrough(events, position), [events, position]);
  const sentA2ui = useMemo(() => agentMessages(events).length > 0, [events]);

  // The page address holds the step selected, picked or landed on; a pick not in a closed turn gives way.
  const shownId = inView.selected ? selected?.id : undefined;
  const arriving = open && picked !== undefined && !timeline.some(row => row.id === picked);
  useEffect(() => {
    if (shownId !== picked && !arriving) setPicked(shownId);
  }, [shownId, picked, arriving, setPicked]);

  const detail = usePanelRef();
  const timelinePanel = usePanelRef();
  const [collapsed, setCollapsed] = useState(!inView.selected);
  // The detail is collapsed to its title line until a step is selected.
  useEffect(() => {
    if (inView.selected) openDetail(detail.current);
    else detail.current?.collapse();
  }, [inView.selected, detail]);
  // A detail open as the turn opens takes its remembered height, at most half the pane.
  useEffect(() => {
    const panel = detail.current;
    if (panel === null || panel.isCollapsed()) return;
    const height = rememberedHeight(panel);
    if (height !== undefined && height < panel.getSize().inPixels) panel.resize(height);
  }, [detail]);

  // `n` and Shift+`n` go to the next and previous problem, opening the detail on it; `l` jumps to the latest step.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = pageKeyOf(event);
      if (key === 'n' || key === 'N') {
        const next = nextProblem(shown, byStep, selected?.id, {backwards: key === 'N'});
        if (next === undefined) return;
        setPicked(next);
        openDetail(detail.current);
      } else if (key === 'l') {
        const move = pickForKey(shown, selected?.id, 'End', {open, following: inView.following});
        if (move !== undefined) setPicked(move.pick);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [shown, byStep, selected, open, inView.following, setPicked, detail]);

  const row = state.turns.find(listed => listed.traceId === traceId);
  const input = turn === undefined ? undefined : inputBriefOfTurn(turn);
  const title = briefText(input ?? row?.input) || 'A turn';
  const agent = summary?.agentName ?? row?.agentName ?? state.context?.agentName;
  // An open turn's duration runs to its newest step, and its version is its first message's.
  const sofar = open ? openFieldsOf(events, startMs) : undefined;
  const durationMs = summary?.durationMs ?? sofar?.durationMs;
  const protocolVersion = summary?.protocolVersion ?? sofar?.protocolVersion;
  const meta = [
    formatStart(startMs),
    ...(durationMs === undefined ? [] : [formatDuration(durationMs)]),
    ...(protocolVersion === undefined ? [] : [`A2UI ${protocolVersion}`]),
    ...(agent === undefined ? [] : [agent]),
  ];

  return (
    <>
      <TurnHeader
        title={title}
        status={summary?.outcome ?? 'open'}
        check={turn === undefined ? undefined : checkStateOf(turn, problems.length)}
        checks={turn === undefined ? [] : checkLinesOf(turn)}
        filtered={filtered}
        onFilter={toggleFilter}
        meta={meta}
        traceId={traceId}
        conversationId={summary?.conversationId ?? (open ? view.live.conversationId : undefined)}
      />
      <ResizablePanelGroup
        orientation="horizontal"
        className="min-h-0 flex-1"
        onLayoutChanged={(_, {isUserInteraction}) => {
          const panel = timelinePanel.current;
          if (isUserInteraction && panel !== null)
            rememberSize('timeline', panel.getSize().inPixels);
        }}
      >
        <ResizablePanel
          panelRef={timelinePanel}
          defaultSize={rememberedSize('timeline') ?? (small ? TIMELINE_SMALL : TIMELINE_WIDE)}
          minSize={240}
          groupResizeBehavior="preserve-pixel-size"
        >
          <Timeline
            rows={shown}
            selected={selected?.id ?? ''}
            problems={byStep}
            live={open}
            following={inView.following}
            {...(filtered && {
              filter: {
                steps: timeline.filter(row => row.row === 'step').length,
                onShowAll: toggleFilter,
              },
            })}
            onSelect={setPicked}
            onJump={() => setPicked(undefined)}
            onKey={key => {
              const move = pickForKey(shown, selected?.id, key, {
                open,
                following: inView.following,
              });
              if (move !== undefined) setPicked(move.pick);
            }}
          />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel minSize={360}>
          <ResizablePanelGroup
            orientation="vertical"
            onLayoutChanged={(_, {isUserInteraction}) => {
              // Read once the change is complete: during it, the panel's sizes can disagree.
              const panel = detail.current;
              if (panel === null) return;
              setCollapsed(panel.isCollapsed());
              if (isUserInteraction && !panel.isCollapsed()) {
                rememberSize('detail', panel.getSize().inPixels);
              }
            }}
          >
            <ResizablePanel minSize={160}>
              <ResultPane
                reply={reply}
                asOf={inView.following ? 'Live' : asOfLabel(selected, events, startMs)}
                replay={pane}
                problemsBySurface={bySurface}
                open={open}
                sentA2ui={sentA2ui}
                failed={summary?.outcome === 'failed'}
              />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel
              panelRef={detail}
              defaultSize={
                inView.selected ? (rememberedSize('detail') ?? DETAIL_OPEN) : DETAIL_TITLE
              }
              minSize={120}
              collapsible
              groupResizeBehavior="preserve-pixel-size"
              collapsedSize={DETAIL_TITLE}
            >
              {selected !== undefined && (
                <StepDetail
                  key={selected.id}
                  row={selected}
                  events={events}
                  startMs={startMs}
                  problems={problems.filter(problem => problem.stepId === selected.id)}
                  folded={folded
                    .filter(rejection => rejection.stepId === selected.id)
                    .map(rejection => rejection.sentence)}
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

/**
 * Opens the collapsed detail to the height it was last dragged to, at most
 * half the pane, or, with none, to its last size or its default.
 */
function openDetail(panel: PanelImperativeHandle | null): void {
  if (panel === null || !panel.isCollapsed()) return;
  // Measured before expanding: until the page lays the panel out again, its size in pixels is the old one.
  const height = rememberedHeight(panel);
  panel.expand();
  if (height !== undefined) panel.resize(height);
  else if (panel.getSize().inPixels <= DETAIL_TITLE + 1) panel.resize(DETAIL_OPEN);
}

/** The detail's remembered height in the pane it shares with the result, if one is remembered. */
function rememberedHeight(panel: PanelImperativeHandle): number | undefined {
  const remembered = rememberedSize('detail');
  if (remembered === undefined) return undefined;
  const {inPixels, asPercentage} = panel.getSize();
  return asPercentage > 0
    ? detailOpenHeight(remembered, (inPixels * 100) / asPercentage)
    : remembered;
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
