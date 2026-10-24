import {useEffect, useMemo, useState, type ReactNode} from 'react';

import {Tabs, TabsContent, TabsList, TabsTrigger} from '@/components/ui/tabs.tsx';
import {locateFinding} from '@/model/messages.ts';
import {
  isCheck,
  isWireInput,
  isWireOutput,
  type CheckEvent,
  type TurnRecordEvent,
  type WireEvent,
} from '@/model/record.ts';
import {replay as replayTurn} from '@/model/replay.ts';
import {schemaCheckOf, summaryOf, type SchemaCheckState} from '@/model/summary.ts';
import {type TurnView as TurnViewState, turnViewOf, useNeededRecords} from '@/state/selectors.ts';
import {useSpectra} from '@/state/spectra.ts';
import {cn} from '@/lib/utils.ts';

import {ChecksTab} from './ChecksTab.tsx';
import {CopyButton} from './CopyButton.tsx';
import {formatDuration, formatStart, OUTCOME_LABELS, OUTCOME_TONES} from './format.ts';
import {type GoTo, type MessageMarks, type TabName, targetIds} from './links.ts';
import {SurfacesTab} from './SurfacesTab.tsx';
import {WireEvents} from './WireEvents.tsx';

/** How long the element a link landed on stays marked. */
const LANDED_MS = 1500;

export function TurnView({traceId}: {traceId: string | undefined}) {
  const state = useSpectra();
  const needs: string[] = [];
  const view: TurnViewState =
    traceId === undefined ? {status: 'none'} : turnViewOf(state, traceId, needs);
  useNeededRecords(needs);

  if (traceId === undefined) {
    return (
      <Empty>
        {state.loaded && state.turns.length === 0 ? 'No turns yet.' : 'No turn selected.'}
      </Empty>
    );
  }
  if (view.status === 'loading') return <Empty>Reading the turn…</Empty>;
  if (view.status === 'error') return <Empty>{view.message}</Empty>;
  if (view.status === 'none') return <Empty>No turn has this trace id.</Empty>;
  return <TurnDetail key={traceId} traceId={traceId} view={view} />;
}

function TurnDetail({
  traceId,
  view,
}: {
  traceId: string;
  view: Extract<TurnViewState, {status: 'open' | 'closed'}>;
}) {
  const open = view.status === 'open';
  const events: readonly TurnRecordEvent[] = open ? view.live.events : view.turn.events;
  const earlier = 'turns' in view.earlier ? view.earlier.turns : undefined;
  // The earlier turns and the events keep their identity until they change, so the replay runs once per change.
  const replay = useMemo(
    () => (earlier === undefined ? undefined : replayTurn(earlier, events)),
    [earlier, events],
  );
  const checks = useMemo(() => events.filter(isCheck), [events]);
  const schemaCheck = useMemo(() => schemaCheckOf({events: [...events]}), [events]);
  const marks = useMemo(
    () => marksOf(events, checks, replay?.rejections ?? []),
    [events, checks, replay],
  );
  const [tab, setTab] = useState<TabName>('surfaces');
  const [landing, setLanding] = useState<string | undefined>();
  const goTo: GoTo = (nextTab, targetId) => {
    setTab(nextTab);
    setLanding(targetId);
  };
  useEffect(() => {
    if (landing === undefined) return;
    const element = document.getElementById(landing);
    if (element === null) return;
    element.scrollIntoView({block: 'center', behavior: 'smooth'});
    element.dataset.landed = 'true';
    const timer = setTimeout(() => {
      delete element.dataset.landed;
      setLanding(undefined);
    }, LANDED_MS);
    return () => clearTimeout(timer);
  }, [landing, tab]);

  const withIndex = (keep: (event: TurnRecordEvent) => event is WireEvent) =>
    events.flatMap((event, index) => (keep(event) ? [{event, index}] : []));
  const startTime = open ? Date.parse(view.live.startTime) : (summaryOf(view.turn)?.startTime ?? 0);

  return (
    <div className="flex h-full flex-col">
      <Header traceId={traceId} view={view} schemaCheck={schemaCheck} />
      <Tabs
        value={tab}
        onValueChange={value => setTab(value as TabName)}
        className="min-h-0 flex-1 gap-0"
      >
        <div className="border-b px-3 py-2">
          <TabsList>
            <TabsTrigger value="input">Input</TabsTrigger>
            <TabsTrigger value="raw">Raw messages</TabsTrigger>
            <TabsTrigger value="surfaces">Surfaces</TabsTrigger>
            <TabsTrigger value="checks">Checks</TabsTrigger>
          </TabsList>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <TabsContent value="input">
            <WireEvents
              events={withIndex(isWireInput)}
              startTime={startTime}
              goTo={goTo}
              empty="The host's message has not arrived yet."
            />
          </TabsContent>
          <TabsContent value="raw">
            <WireEvents
              events={withIndex(isWireOutput)}
              startTime={startTime}
              marks={marks}
              goTo={goTo}
              empty={open ? 'Nothing from the agent yet.' : 'The agent sent nothing back.'}
            />
          </TabsContent>
          <TabsContent value="surfaces">
            <SurfacesTab replay={replay} goTo={goTo} />
          </TabsContent>
          <TabsContent value="checks">
            <ChecksTab
              open={open}
              events={events}
              checks={checks}
              schemaCheck={schemaCheck}
              goTo={goTo}
            />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

function Header({
  traceId,
  view,
  schemaCheck,
}: {
  traceId: string;
  view: Extract<TurnViewState, {status: 'open' | 'closed'}>;
  schemaCheck: SchemaCheckState;
}) {
  const summary = view.status === 'closed' ? summaryOf(view.turn) : undefined;
  const conversationId =
    view.status === 'open' ? view.live.conversationId : summary?.conversationId;
  const startTime = view.status === 'open' ? view.live.startTime : summary?.startTime;
  return (
    <header className="flex shrink-0 flex-col gap-1 border-b px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {summary === undefined ? (
          <span className={cn('text-sm font-semibold', OUTCOME_TONES.open)}>open</span>
        ) : (
          <span className={cn('text-sm font-semibold', OUTCOME_TONES[summary.outcome])}>
            {OUTCOME_LABELS[summary.outcome]}
          </span>
        )}
        {summary?.statusReason !== undefined && (
          <span className="text-sm">{summary.statusReason}</span>
        )}
        {startTime !== undefined && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatStart(startTime)}
            {summary !== undefined && ` · ${formatDuration(summary.durationMs)}`}
          </span>
        )}
        {summary?.protocolVersion !== undefined && (
          <span className="text-xs">A2UI {summary.protocolVersion}</span>
        )}
        {summary !== undefined && <SchemaCheckText state={schemaCheck} />}
        {summary?.agentName !== undefined && (
          <span className="text-xs text-muted-foreground">{summary.agentName}</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 text-xs text-muted-foreground">
        {conversationId !== undefined && <Id label="Conversation" value={conversationId} />}
        <Id label="Trace" value={traceId} />
      </div>
    </header>
  );
}

function SchemaCheckText({state}: {state: SchemaCheckState}) {
  if (state.state === 'passed')
    return (
      <span className="text-xs text-emerald-700 dark:text-emerald-400">schema check passed</span>
    );
  if (state.state === 'findings') {
    return (
      <span className="text-xs text-destructive">
        schema check: {state.count} {state.count === 1 ? 'finding' : 'findings'}
      </span>
    );
  }
  if (state.state === 'no_a2ui')
    return <span className="text-xs text-muted-foreground">no A2UI in this turn</span>;
  return <span className="text-xs text-muted-foreground">no schema check</span>;
}

function Id({label, value}: {label: string; value: string}) {
  return (
    <span className="flex items-center gap-1">
      {label} <span className="font-mono">{value}</span>
      <CopyButton text={value} label={`Copy the ${label.toLowerCase()} id`} />
    </span>
  );
}

function Empty({children}: {children: ReactNode}) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

/** What links to each A2UI message: the findings that point into it and its rejection. */
function marksOf(
  events: readonly TurnRecordEvent[],
  checks: readonly CheckEvent[],
  rejections: ReadonlyArray<{key: string}>,
): Map<string, MessageMarks> {
  const marks = new Map<string, MessageMarks>();
  const markOf = (key: string) => {
    let mark = marks.get(key);
    if (mark === undefined) {
      mark = {findings: []};
      marks.set(key, mark);
    }
    return mark;
  };
  checks.forEach((check, checkIndex) =>
    check.attributes['a2ui.check.findings'].forEach((finding, findingIndex) => {
      const location = locateFinding(events, finding.path);
      if (location !== undefined)
        markOf(location.key).findings.push(targetIds.finding(checkIndex, findingIndex));
    }),
  );
  for (const {key} of rejections) markOf(key).rejection = targetIds.rejection(key);
  return marks;
}
