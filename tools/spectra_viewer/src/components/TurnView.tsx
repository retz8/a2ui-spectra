import {type ReactNode, useEffect, useMemo, useRef, useState} from 'react';
import {type PanelImperativeHandle, usePanelRef} from 'react-resizable-panels';

import {ResizableHandle, ResizablePanel, ResizablePanelGroup} from '@/components/ui/resizable.tsx';
import {checkLinesOf, checkStateOf} from '@/model/check_state.ts';
import {keptPick, nextProblem, pickedRowId, pickForKey, stepInView} from '@/model/follow.ts';
import {inputBriefOfTurn} from '@/model/input_brief.ts';
import {pageKeyOf} from '@/model/keys.ts';
import {catalogsOf} from '@/model/catalogs.ts';
import {dataModelMapOf, dataModelVersionOf} from '@/model/host_message.ts';
import {agentMessages} from '@/model/messages.ts';
import {previewProblemsOf, routeOf, surfaceFeedOf, targetOf} from '@/model/preview.ts';
import {timedEventOf} from '@/model/call_rows.ts';
import {isProxyModelCall, isReadInFull} from '@/model/model_calls.ts';
import {candidatesFor, type PrefixBreak, prefixBreakOf} from '@/model/prefix.ts';
import {type Problem, onlyProblems, turnProblemsOf} from '@/model/problems.ts';
import {
  isTurnEvent,
  isWireInput,
  isWireOutput,
  type ModelCallEvent,
  type Turn,
  type TurnRecordEvent,
  unixMillis,
} from '@/model/record.ts';
import {replay} from '@/model/replay.ts';
import {type Position, replyThrough, type TimelineRow, timelineOf} from '@/model/steps.ts';
import {openFieldsOf, summaryOf} from '@/model/summary.ts';
import {insideLineOf} from '@/model/turn_calls.ts';
import {briefText} from '@/model/turn_groups.ts';
import {detailOpenHeight, rememberedSize, rememberSize} from '@/state/layout.ts';
import {previewHost, renderKeyOf, usePreviewPages} from '@/state/preview_host.ts';
import {
  keepsPending,
  pendingOf,
  setDataModelInView,
  setPendingAction,
  useDataModelInView,
  usePendingAction,
} from '@/state/press.ts';
import {setRenderErrorsInView} from '@/state/render_errors.ts';
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

/** No reports: what a render the page has not answered for holds. */
const NO_REPORTS: [] = [];

/** No surfaces, kept the same from render to render. */
const NO_SURFACES: [] = [];

/** The detail's height when collapsed to its title line, in pixels. */
const DETAIL_TITLE = 41;

/** The result pane's height when folded to its header line, while the detail is maximized, in pixels. */
const RESULT_TITLE = 45;

/** The detail's height when open with no size of its own yet, as a percentage of the pane. */
const DETAIL_OPEN = '38';

/** The timeline's width until its divider is dragged, in pixels: on a wide window and below 1,280px. */
const TIMELINE_WIDE = 380;
const TIMELINE_SMALL = 340;

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
  /** Selects a turn, and a step of it when one is named. */
  onSelect: (traceId: string, stepId?: string) => void;
  /** Selects a step of the turn, or none, putting it in the page address. */
  onStep: (traceId: string, stepId: string | undefined) => void;
}) {
  const state = useSpectra();
  // Maximize holds from turn to turn until the page is reloaded.
  const [maximized, setMaximized] = useState(false);
  const needs: string[] = [];
  const view: TurnViewState =
    traceId === undefined ? {status: 'none'} : turnViewOf(state, traceId, needs);
  useNeededRecords(needs);
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  // A new conversation asked for holds until a turn is selected.
  const selected = `${selection}:${traceId ?? ''}`;
  const [newAt, setNewAt] = useState<string | undefined>();

  const startsNew = newAt === selected;
  // A press in the preview lands in the composer, which goes back to the turn's conversation.
  const pending = usePendingAction();
  useEffect(() => {
    const stop = previewHost.onPress(press => {
      setNewAt(undefined);
      setPendingAction(pendingOf(press));
    });
    return () => {
      stop();
    };
  }, []);
  // It stays only while its conversation is in view.
  useEffect(() => {
    if (pending !== undefined && !keepsPending(state, pending, {traceId, startsNew})) {
      setPendingAction(undefined);
    }
  }, [pending, state, traceId, startsNew]);
  const inView = useDataModelInView();

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
        onOther={onSelect}
        maximized={maximized}
        onMaximized={setMaximized}
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
        startsNew={startsNew}
        onStartNew={() => {
          setNewAt(selected);
          input.current?.focus();
        }}
        pending={pending}
        onDiscard={() => setPendingAction(undefined)}
        dataModel={
          inView !== undefined && inView.traceId === traceId ? inView.dataModel : undefined
        }
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
  onOther,
  maximized,
  onMaximized,
}: {
  traceId: string;
  view: Extract<TurnViewState, {status: 'open' | 'closed'}>;
  /** The step picked, as the page address holds it. */
  stepId: string | undefined;
  onStep: (stepId: string | undefined) => void;
  /** Selects a step of another turn, such as the earlier call a prefix break names. */
  onOther: (traceId: string, stepId: string) => void;
  /** Whether the step's detail takes the result pane's height. */
  maximized: boolean;
  onMaximized: (maximized: boolean) => void;
}) {
  const state = useSpectra();
  const small = useSmallWindow();
  const open = view.status === 'open';
  const events: readonly TurnRecordEvent[] = open ? view.live.events : view.turn.events;
  const turn: Turn | undefined = open ? undefined : view.turn;
  const summary = useMemo(() => (turn === undefined ? undefined : summaryOf(turn)), [turn]);
  const startMs = open ? Date.parse(view.live.startTime) : (summary?.startTime ?? 0);
  // A closed turn's lanes run to its end and every row's; a live turn's to the present.
  const turnEndMs =
    open || summary === undefined ? undefined : summary.startTime + summary.durationMs;
  // The earlier turns and the events keep their identity until they change, so each replay runs once per change.
  const earlier = 'turns' in view.earlier ? view.earlier.turns : undefined;

  const timeline = useMemo(() => timelineOf(events, startMs), [events, startMs]);
  // The surfaces are rebuilt only when the wire changes, not as a call's chunks arrive.
  const wireEvents = useWireEvents(events);
  const catalogs = useMemo(() => catalogsOf(state.catalogs), [state.catalogs]);
  const whole = useMemo(
    () => (earlier === undefined ? undefined : replay(earlier, wireEvents, undefined, catalogs)),
    [earlier, wireEvents, catalogs],
  );
  // The record's problems: the checks' findings, web core's rejections and a failed outcome.
  const recorded = useMemo(
    () => turnProblemsOf(events, timeline, whole?.rejections ?? []),
    [events, timeline, whole],
  );
  const recordedByStep = useMemo(
    () => countBy(recorded.problems, problem => problem.stepId),
    [recorded],
  );

  // The filter belongs to this turn: each turn opens with all its steps.
  // It keeps the record's problems and every step a render error has been on while the turn is in
  // view; a turn lands on the record's problems only, since the preview's depend on the step in view.
  const [filtered, setFiltered] = useState(false);
  const [renderErrorSteps, setRenderErrorSteps] = useState<ReadonlySet<string>>(() => new Set());
  const filterByStep = useMemo(() => {
    const counts = new Map(recordedByStep);
    for (const stepId of renderErrorSteps) counts.set(stepId, (counts.get(stepId) ?? 0) + 1);
    return counts;
  }, [recordedByStep, renderErrorSteps]);
  const kept = useMemo(() => onlyProblems(timeline, filterByStep), [timeline, filterByStep]);
  // A row picked by an id it no longer goes by, such as a span-only row merged into its proxy's row
  // as its link arrived, is the row that holds that id now.
  const pickedId = useMemo(() => pickedRowId(picked, timeline), [picked, timeline]);
  const shown = filtered ? kept : timeline;
  const toggleFilter = () => {
    // A pick the filter hides gives way to the first problem.
    if (!filtered) setPicked(keptPick(pickedId, kept));
    setFiltered(!filtered);
  };
  const inView = stepInView(shown, {open, picked: pickedId, problems: recordedByStep});
  const selected = inView.row;
  const position = useMemo(() => positionOf(selected), [selected]);
  const pane = useMemo(
    () =>
      earlier === undefined
        ? undefined
        : position === undefined
          ? whole
          : replay(earlier, wireEvents, position, catalogs),
    [earlier, wireEvents, whole, position, catalogs],
  );
  const reply = useMemo(() => replyThrough(wireEvents, position), [wireEvents, position]);

  // The surface in view, and its preview: its list goes to the page it is routed to.
  const [pickedSurface, setPickedSurface] = useState<string | undefined>();
  const surfaces = pane?.surfaces ?? NO_SURFACES;
  const surface = surfaces.find(view => view.surfaceId === pickedSurface) ?? surfaces[0];
  const surfaceId = surface?.surfaceId;
  const feed = useMemo(
    () =>
      earlier === undefined || surfaceId === undefined
        ? undefined
        : surfaceFeedOf(earlier, wireEvents, position, surfaceId),
    [earlier, wireEvents, position, surfaceId],
  );
  const feedMessages = useMemo(() => feed?.map(({message}) => message), [feed]);
  const feedKey = useMemo(
    () =>
      surfaceId === undefined || feedMessages === undefined
        ? undefined
        : renderKeyOf(surfaceId, feedMessages),
    [surfaceId, feedMessages],
  );
  const pages = usePreviewPages();
  const route = useMemo(
    () => (feed === undefined ? undefined : routeOf(pages, targetOf(feed))),
    [feed, pages],
  );
  const routed = route?.kind === 'page' ? route.page : undefined;
  const routedId = routed?.id;
  const version = useMemo(
    () => (feed === undefined ? undefined : targetOf(feed).protocolVersion),
    [feed],
  );
  const stepId = selected?.id;
  // Each render keeps the turn and step it is for, with the surfaces there, for a press made in it.
  useEffect(() => {
    if (routedId !== undefined && surfaceId !== undefined && feedMessages !== undefined) {
      previewHost.render(routedId, surfaceId, feedMessages, {
        traceId,
        ...(stepId !== undefined && {stepId}),
        surfaces,
        ...(version !== undefined && {version}),
      });
    }
  }, [routedId, surfaceId, feedMessages, traceId, stepId, surfaces, version]);
  // A page's reports and its data model hold for the render of this very list.
  const current = routed !== undefined && routed.sentKey === feedKey;
  const reports = current ? routed.reports : NO_REPORTS;
  const shownModel =
    current && routed.dataModel?.surfaceId === surfaceId ? routed.dataModel : undefined;
  // What a text sent now carries: the shown surface's data model from its page, the others' at the step.
  const textModel = useMemo(() => {
    const modelVersion = dataModelVersionOf(surfaces);
    return modelVersion === undefined
      ? undefined
      : dataModelMapOf(surfaces, modelVersion, shownModel);
  }, [surfaces, shownModel]);
  useEffect(() => {
    setDataModelInView({traceId, ...(textModel !== undefined && {dataModel: textModel})});
  }, [traceId, textModel]);
  const fromPreview = useMemo(
    () =>
      feed === undefined || surfaceId === undefined
        ? undefined
        : previewProblemsOf(reports, feed, surfaceId, timeline, recorded.problems),
    [reports, feed, surfaceId, timeline, recorded],
  );
  const problems: Problem[] = useMemo(
    () => [...recorded.problems, ...(fromPreview?.problems ?? [])],
    [recorded, fromPreview],
  );
  const folded = useMemo(
    () => [...recorded.folded, ...(fromPreview?.folded ?? [])],
    [recorded, fromPreview],
  );
  const byStep = useMemo(() => countBy(problems, problem => problem.stepId), [problems]);
  const bySurface = useMemo(() => countBy(problems, problem => problem.surfaceId), [problems]);
  const renderErrors = fromPreview?.problems.length ?? 0;
  useEffect(() => {
    setRenderErrorsInView({traceId, count: renderErrors});
  }, [traceId, renderErrors]);
  // The steps a render error has been on grow as the page reports, for the filter.
  const errorSteps = (fromPreview?.problems ?? []).map(problem => problem.stepId);
  if (errorSteps.some(stepId => !renderErrorSteps.has(stepId))) {
    setRenderErrorSteps(new Set([...renderErrorSteps, ...errorSteps]));
  }
  useEffect(() => {
    return () => {
      setRenderErrorsInView(undefined);
      setDataModelInView(undefined);
    };
  }, []);
  const sentA2ui = useMemo(() => agentMessages(wireEvents).length > 0, [wireEvents]);

  // The model calls: the header's second line, and the selected call's prefix break against the
  // conversation's earlier calls, this turn's and the earlier turns'.
  const inside = useMemo(
    () => insideLineOf(events, startMs, state.prices),
    [events, startMs, state.prices],
  );
  // Only a call the model proxy read in full is compared for the prefix break.
  const selectedRow = selected?.row === 'step' ? selected.call : undefined;
  const selectedCall =
    selectedRow?.kind === 'model' &&
    selectedRow.proxy !== undefined &&
    isReadInFull(selectedRow.proxy as ModelCallEvent)
      ? (selectedRow.proxy as ModelCallEvent)
      : undefined;
  const prefix = useMemo(() => {
    if (selectedCall === undefined || earlier === undefined) return undefined;
    const turns = [
      ...earlier.map(turn => ({
        traceId: turn.events.find(isTurnEvent)?.traceId ?? '',
        calls: turn.events.filter(isProxyModelCall),
      })),
      {traceId, calls: events.filter(isProxyModelCall)},
    ];
    return prefixBreakOf(selectedCall, candidatesFor(selectedCall, turns));
  }, [selectedCall, earlier, events, traceId]);
  const onEarlier = (found: Exclude<PrefixBreak, {form: 'first'}>) => {
    const {traceId: turnOf, call} = found.earlier;
    if (turnOf === traceId) setPicked(call.spanId);
    else onOther(turnOf, call.spanId);
  };

  // The page address holds the step selected, picked or landed on; a pick not in a closed turn gives way.
  const shownId = inView.selected ? selected?.id : undefined;
  const arriving = open && pickedId !== undefined && !timeline.some(row => row.id === pickedId);
  useEffect(() => {
    if (shownId !== picked && !arriving) setPicked(shownId);
  }, [shownId, picked, arriving, setPicked]);

  const detail = usePanelRef();
  const result = usePanelRef();
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

  // Maximized, the selected step's detail takes the result pane's height and the pane folds to its
  // header line. While a live turn is followed with no step selected, the split stays.
  const folding = maximized && inView.selected;
  useEffect(() => {
    const pane = result.current;
    if (pane === null) return;
    if (folding) {
      openDetail(detail.current);
      pane.collapse();
    } else if (pane.isCollapsed()) {
      pane.expand();
    }
  }, [folding, result, detail, selected?.id]);
  const toggleMaximized = () => {
    if (folding) {
      onMaximized(false);
      return;
    }
    // Maximizing the step the view follows selects it.
    if (!inView.selected && selected !== undefined) setPicked(selected.id);
    onMaximized(true);
  };

  // `n` and Shift+`n` go to the next and previous problem, opening the detail on it; `l` jumps to
  // the latest step; `m` maximizes the step's detail or restores the split.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = pageKeyOf(event);
      if (key === 'm') {
        if (selected !== undefined) toggleMaximized();
      } else if (key === 'n' || key === 'N') {
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
  });

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
        {...(inside !== undefined && {inside})}
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
            allRows={timeline}
            startMs={startMs}
            endMs={turnEndMs}
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
              // Dragging the divider, or collapsing the detail, brings the split back.
              const pane = result.current;
              if (isUserInteraction && folding && pane !== null && !pane.isCollapsed()) {
                onMaximized(false);
              }
              if (isUserInteraction && !panel.isCollapsed()) {
                rememberSize('detail', panel.getSize().inPixels);
              }
            }}
          >
            <ResizablePanel
              panelRef={result}
              minSize={160}
              collapsible
              collapsedSize={RESULT_TITLE}
            >
              <ResultPane
                reply={reply}
                asOf={inView.following ? 'Live' : asOfLabel(selected, events, startMs)}
                replay={pane}
                surface={surface}
                onPick={setPickedSurface}
                preview={route === undefined ? undefined : {route, lines: fromPreview?.lines ?? []}}
                problemsBySurface={bySurface}
                open={open}
                sentA2ui={sentA2ui}
                failed={summary?.outcome === 'failed'}
                later={position !== undefined && (whole?.surfaces.length ?? 0) > 0}
                folded={folding}
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
                    .map(
                      rejection =>
                        `${rejection.lead ?? 'A2UI web core also rejected this message'} · ${rejection.sentence}`,
                    )}
                  collapsed={collapsed}
                  onToggle={() => {
                    if (collapsed) openDetail(detail.current);
                    else {
                      if (folding) onMaximized(false);
                      detail.current?.collapse();
                    }
                  }}
                  maximized={folding}
                  onMaximize={toggleMaximized}
                  prices={state.prices}
                  prefix={prefix}
                  onEarlier={onEarlier}
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
  if (row.call !== undefined) {
    const end = timedEventOf(row.call).endTimeUnixNano;
    return end === undefined
      ? 'Live · the call is in flight'
      : `At the end of the call, ${formatOffset(unixMillis(end) - startMs)}`;
  }
  const offset =
    row.offsetMs ??
    (row.position === undefined
      ? undefined
      : unixMillis(events[row.position.eventIndex].startTimeUnixNano) - startMs);
  return offset === undefined ? '' : `After the step at ${formatOffset(offset)}`;
}

/**
 * The events as the surfaces read them: the same array until a wire event
 * comes or an event is added, so a call's chunks and progress, which change
 * only its own event, do not rebuild the surfaces.
 */
function useWireEvents(events: readonly TurnRecordEvent[]): readonly TurnRecordEvent[] {
  const [kept, setKept] = useState(events);
  if (kept !== events && !sameWire(kept, events)) {
    setKept(events);
    return events;
  }
  return kept;
}

/** Whether two versions of a turn's events hold the same events in order and the same wire events. */
function sameWire(before: readonly TurnRecordEvent[], events: readonly TurnRecordEvent[]): boolean {
  return (
    before.length === events.length &&
    events.every(
      (event, index) =>
        event.spanId === before[index].spanId &&
        (!(isWireInput(event) || isWireOutput(event)) || event === before[index]),
    )
  );
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
