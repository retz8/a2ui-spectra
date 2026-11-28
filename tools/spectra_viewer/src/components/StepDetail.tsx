import {type ReactNode, useEffect, useState} from 'react';

import {cn} from '@/lib/utils';
import type {Prices} from '@/model/cost.ts';
import {legacyLinesOf, type StepLegacy} from '@/model/legacy_form.ts';
import type {KnownCatalog} from '@/model/catalogs.ts';
import {markedPath} from '@/model/json_lines.ts';
import type {PrefixBreak} from '@/model/prefix.ts';
import type {Problem} from '@/model/problems.ts';
import type {CallReplay, RecordedCall} from '@/model/provenance.ts';
import {isWireInput, type TurnRecordEvent, unixMillis, type WireEvent} from '@/model/record.ts';
import {deliveryLabel, plural, type Step, type TimelineRow} from '@/model/steps.ts';
import {factsOf, titleOf, usageOf} from '@/model/step_head.ts';
import {useBlockFold} from '@/state/block_folds.ts';
import {clearDetailTabRequest, detailTabRequest, requestDetailTab} from '@/state/detail_tab.ts';

import {Connections, DetailLink, Pairs, TextBlock} from './CallParts.tsx';
import {brandIconOf, formatOffset, toneOf} from './format.ts';
import {Icon, LegacyMark} from './icons.tsx';
import {BlockLabel, JsonBlock, type Reveal} from './JsonBlock.tsx';
import {modelCallDetailOf, type StepOnCall, type TabbedDetail} from './ModelCallDetail.tsx';
import {GenerationBlocks, parseDetailOf} from './ParseDetail.tsx';
import type {RangeReveal} from './RawText.tsx';
import {toolCallDetailOf} from './ToolCallDetail.tsx';

/** No paths, kept the same from render to render. */
const NO_PATHS: readonly string[] = [];

/**
 * The selected step's detail. Its head stays in view: the title line, its
 * facts line, and a model call's usage. Under it, the problems, the
 * rejections folded under them as quiet lines, the legacy form's two lines
 * when its message carried components in it, and how the step connects to
 * others. A model call, a tool call and a parse split what they hold into
 * tabs, one per kind of material, the tab row sticking under the head; a
 * selection opens Reply, Result or Raw text. Every other step holds one
 * column, ending with the delivery it arrived in, folded. A problem that
 * marks a line is pressed to bring the line into view, in the tab that holds
 * it. Docked below the result, it collapses to its head; docked beside it,
 * it holds the column's full height and does not collapse. Maximize gives
 * the detail the result's place.
 */
export function StepDetail({
  row,
  events,
  startMs,
  problems,
  folded,
  legacy,
  collapsed,
  onToggle,
  dock,
  onDock,
  maximized,
  onMaximize,
  prices,
  prefix,
  onEarlier,
  catalogs,
  onStep,
  stepOnCall,
  callReplay,
  onRecorded,
}: {
  row: TimelineRow;
  events: readonly TurnRecordEvent[];
  startMs: number;
  problems: readonly Problem[];
  /** The quiet lines folded under this step's problems: web core's rejections and the preview page's reports. */
  folded: readonly string[];
  /** The legacy form in the step's message, when it carried components in it. */
  legacy?: StepLegacy;
  collapsed: boolean;
  onToggle: () => void;
  /** Where the detail sits: under the result, or on its right. */
  dock: 'below' | 'beside';
  /** Docks the detail on the other side; the tab open stays open. */
  onDock: () => void;
  /** Whether the detail takes the result's place. */
  maximized: boolean;
  onMaximize: () => void;
  prices: Prices | undefined;
  /** A model call's prefix break, when the step is a call read in full. */
  prefix: PrefixBreak | undefined;
  onEarlier: (found: Exclude<PrefixBreak, {form: 'first'}>) => void;
  /** The catalog definitions the viewer holds, for a parse's component ranges. */
  catalogs: readonly KnownCatalog[] | undefined;
  /** Selects another step of the turn, by its id or a span id it holds. */
  onStep: (stepId: string) => void;
  /** What the A2UI step adds to a model call's detail. */
  stepOnCall: StepOnCall | undefined;
  /** What the call was, in a replayed turn. */
  callReplay: CallReplay | undefined;
  /** Selects a recorded call in its source. */
  onRecorded: (recorded: RecordedCall) => void;
}) {
  const call = row.row === 'step' ? row.call : undefined;
  const title = titleOf(row, startMs);
  const facts = factsOf(row, events, startMs);
  const usage = usageOf(row, prices);
  const [reveal, setReveal] = useState<Reveal>();
  const [rangeReveal, setRangeReveal] = useState<RangeReveal>();
  // The detail is drawn anew for each step: a selection opens its first tab, or the one a link asked for.
  const [picked, setPicked] = useState<string | undefined>(detailTabRequest);
  useEffect(clearDetailTabRequest, []);
  const message = row.row === 'step' && row.kind === 'message' ? row.message : undefined;
  const markOf = (problem: Problem) =>
    message === undefined || problem.inner === undefined
      ? undefined
      : markedPath(message, problem.inner);
  const marks = problems.flatMap(problem => markOf(problem) ?? []);
  const tabbed: TabbedDetail | undefined =
    row.row !== 'step'
      ? undefined
      : row.parse !== undefined
        ? parseDetailOf({
            step: row,
            parse: row.parse,
            events,
            startMs,
            catalogs,
            onStep,
            reveal: rangeReveal,
          })
        : row.generation !== undefined
          ? undefined
          : call?.kind === 'model' && stepOnCall !== undefined
            ? modelCallDetailOf({
                row: call,
                events,
                startMs,
                prefix,
                onEarlier,
                step: stepOnCall,
                replay: callReplay,
                onRecorded,
              })
            : call?.kind === 'tool'
              ? toolCallDetailOf({
                  row: call,
                  events,
                  startMs,
                  ...(callReplay !== undefined && {replay: callReplay}),
                  onRecorded,
                })
              : undefined;
  const names = tabbed?.tabs.map(tab => tab.name) ?? [];
  const openName =
    picked !== undefined && names.includes(picked)
      ? picked
      : names.includes(tabbed?.first ?? '')
        ? tabbed!.first
        : names[0];
  const open = tabbed?.tabs.find(tab => tab.name === openName);
  return (
    <section
      aria-label="The step's detail"
      // Beside the result, the turn's header line is the detail's top edge.
      className={cn('flex h-full min-h-0 flex-col', dock === 'below' && 'border-t')}
    >
      <div className="flex shrink-0 flex-col pr-2.5 pl-4">
        <div className="flex h-10 items-center gap-2">
          {row.row === 'delivery' ? (
            <>
              <Icon kind="delivery" size={14} className="shrink-0 tone-muted" />
              <span className="type-pane-title shrink-0">Delivery</span>
              <span className="type-meta min-w-0 truncate">
                {deliveryLabel(row).replace(/^Delivery · /, '')}
              </span>
            </>
          ) : (
            <>
              {row.brand !== undefined ? (
                <Icon kind={row.icon} size={14} {...brandIconOf(row.brand)} />
              ) : (
                <Icon kind={row.icon} size={14} className={cn('shrink-0', toneOf(row.icon))} />
              )}
              <span className="type-pane-title shrink-0">{row.label}</span>
              {/* A failed turn's reason is its problem block's sentence. */}
              {!(row.kind === 'outcome' && row.outcome === 'failed') && (
                <span className="type-meta min-w-0 truncate">{title?.target ?? row.target}</span>
              )}
            </>
          )}
          <div className="flex-1" />
          <button
            type="button"
            aria-label={
              dock === 'beside'
                ? 'Dock the step’s detail below the result'
                : 'Dock the step’s detail beside the result'
            }
            title={
              dock === 'beside'
                ? 'Dock the step’s detail below the result'
                : 'Dock the step’s detail beside the result'
            }
            onClick={() => {
              // Docking draws the detail again; the tab open is asked for so it stays open.
              if (openName !== undefined) requestDetailTab(openName);
              onDock();
            }}
            className="ease-quick flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md tone-muted hover:bg-tint hover:tone-foreground"
          >
            <Icon kind={dock === 'beside' ? 'dockBelow' : 'dockBeside'} size={14} />
          </button>
          <button
            type="button"
            aria-label={maximized ? 'Restore the split' : 'Maximize the step’s detail'}
            aria-pressed={maximized}
            title={maximized ? 'Restore the split · m' : 'Maximize the step’s detail · m'}
            onClick={onMaximize}
            className={cn(
              'ease-quick flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md',
              maximized
                ? 'bg-tint tone-foreground'
                : 'tone-muted hover:bg-tint hover:tone-foreground',
            )}
          >
            <Icon kind={maximized ? 'restore' : 'maximize'} size={14} />
          </button>
          {dock === 'below' && (
            <button
              type="button"
              aria-label={collapsed ? 'Expand the step’s detail' : 'Collapse the step’s detail'}
              aria-expanded={!collapsed}
              onClick={onToggle}
              className="ease-quick flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md tone-muted hover:bg-tint hover:tone-foreground"
            >
              <Icon kind={collapsed ? 'chevronRight' : 'chevronDown'} size={14} />
            </button>
          )}
        </div>
        {facts !== undefined && (
          <div className="type-meta -mt-1 truncate pb-2.5 pl-5.5" title={facts}>
            {facts}
          </div>
        )}
        {usage !== undefined && (
          <div className="type-meta -mt-2 truncate pb-2.5 pl-5.5" title={usage}>
            {usage}
          </div>
        )}
      </div>
      {!collapsed && (
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto px-4 pb-3.5">
          {problems.map((problem, index) => {
            const mark = markOf(problem);
            if (problem.range !== undefined) {
              const {range} = problem;
              return (
                <ProblemBlock
                  key={index}
                  problem={problem}
                  jump="Show text"
                  onJump={() => {
                    setPicked('Raw text');
                    setRangeReveal({...range});
                  }}
                />
              );
            }
            return mark === undefined ? (
              <ProblemBlock key={index} problem={problem} onStep={onStep} />
            ) : (
              <ProblemBlock
                key={index}
                problem={problem}
                jump="Show line"
                onJump={() => setReveal({path: mark})}
              />
            );
          })}
          {problems.flatMap((problem, index) =>
            problem.recorded === undefined
              ? []
              : [
                  <JsonBlock
                    key={index}
                    label="Recorded message"
                    meta={problem.recorded.meta}
                    value={problem.recorded.value}
                    startsFolded
                  />,
                ],
          )}
          {folded.map((line, index) => (
            <p key={index} className="type-quiet">
              {line}
            </p>
          ))}
          {legacy !== undefined && <LegacyLines legacy={legacy} />}
          <Connections rows={tabbed?.connections ?? []} />
          {tabbed !== undefined && open !== undefined ? (
            <>
              <div
                role="tablist"
                aria-label="The step’s content"
                className="sticky top-0 z-10 -mx-4 flex h-9 shrink-0 gap-4 bg-panel px-4 shadow-[inset_0_-1px_0_var(--border)]"
              >
                {tabbed.tabs.map(tab => (
                  <button
                    key={tab.name}
                    type="button"
                    role="tab"
                    aria-selected={tab.name === openName}
                    onClick={() => setPicked(tab.name)}
                    className={cn(
                      'ease-quick type-tab h-full cursor-pointer px-0.5 whitespace-nowrap',
                      tab.name === openName && 'shadow-mark-bottom',
                    )}
                  >
                    {tab.name}
                  </button>
                ))}
              </div>
              <div role="tabpanel" aria-label={openName} className="flex min-w-0 flex-col gap-2.5">
                {open.facts !== undefined && open.facts !== '' && (
                  <p className="type-meta leading-5 wrap-anywhere">{open.facts}</p>
                )}
                {tabbed.lead}
                {open.content}
              </div>
            </>
          ) : tabbed !== undefined ? (
            tabbed.lead
          ) : row.row === 'delivery' ? (
            <DeliveryBlocks event={events[row.eventIndex] as WireEvent} />
          ) : row.generation !== undefined ? (
            <GenerationBlocks generation={row.generation} events={events} startMs={startMs} />
          ) : (
            <StepBlocks
              step={row}
              events={events}
              startMs={startMs}
              marks={marks}
              legacy={legacy?.paths ?? NO_PATHS}
              reveal={reveal}
            />
          )}
        </div>
      )}
    </section>
  );
}

/**
 * A problem as a block: its sentence, the words that select a step a link,
 * then its code and its note; a problem that marks a line is pressed to show
 * it, the link at its right saying so.
 */
function ProblemBlock({
  problem,
  onStep,
  jump,
  onJump,
}: {
  problem: Problem;
  onStep?: (stepId: string) => void;
  /** "Show line" or "Show text", for a problem that marks one. */
  jump?: string;
  onJump?: () => void;
}) {
  const {link} = problem;
  const text = (
    <>
      <Icon kind="failed" size={14} className="mt-0.5 shrink-0 tone-problem" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="type-body">
          {link === undefined || onStep === undefined ? (
            problem.sentence
          ) : (
            <>
              {link.before}
              <DetailLink onClick={() => onStep(link.stepId)}>{link.text}</DetailLink>
              {link.after}
            </>
          )}
        </span>
        <span className="type-meta">{problem.code}</span>
        {problem.note !== undefined && <span className="type-meta">{problem.note}</span>}
      </span>
    </>
  );
  if (jump === undefined || onJump === undefined) {
    return (
      <div className="flex shrink-0 items-start gap-2.5 rounded-lg bg-problem-soft px-3 py-2.5">
        {text}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onJump}
      className="group ease-quick flex w-full shrink-0 cursor-pointer items-start gap-2.5 rounded-lg bg-problem-soft px-3 py-2.5 text-left hover:inset-ring hover:inset-ring-problem"
    >
      {text}
      <span className="type-link mt-px inline-flex shrink-0 items-center gap-1 text-xs group-hover:underline">
        <Icon kind="jump" size={14} />
        {jump}
      </span>
    </button>
  );
}

/**
 * The legacy form's two lines, with no box, the hourglass before them: the
 * number of components and their bare keys, then the v1.0 form, quieter.
 */
function LegacyLines({legacy}: {legacy: StepLegacy}) {
  const {first, second} = legacyLinesOf(legacy.count, legacy.keys);
  return (
    <div className="flex shrink-0 items-start gap-2.5 px-3">
      <LegacyMark size={14} className="mt-0.75" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="type-quiet">
          {first.lead}
          <Keys keys={first.keys} />
        </span>
        <span className="type-meta">
          {second.lead}
          <Keys keys={second.keys} />
          {second.after}
        </span>
      </div>
    </div>
  );
}

/** Keys in monospace at 12px, separated by commas, in their sentence's colour. */
function Keys({keys}: {keys: readonly string[]}) {
  return keys.map((key, index) => (
    <span key={key}>
      {index > 0 && ', '}
      <code className="type-code-inline text-xs">{key}</code>
    </span>
  ));
}

function StepBlocks({
  step,
  events,
  startMs,
  marks,
  legacy,
  reveal,
}: {
  step: Step;
  events: readonly TurnRecordEvent[];
  startMs: number;
  /** The paths its message's problems mark. */
  marks: readonly string[];
  /** The paths of its message's bare envelope keys in the legacy form. */
  legacy: readonly string[];
  reveal: Reveal | undefined;
}) {
  const event =
    step.position === undefined ? undefined : (events[step.position.eventIndex] as WireEvent);
  if (step.kind === 'input' && event !== undefined && isWireInput(event)) {
    const {attributes} = event;
    return (
      <>
        <JsonBlock label="Message" value={attributes['a2ui.wire.message']} />
        <OptionalJson
          label="The host’s capabilities"
          value={attributes['a2ui.wire.capabilities']}
        />
        <OptionalJson label="The host’s data model" value={attributes['a2ui.wire.data_model']} />
        {attributes['a2ui.wire.metadata'] !== undefined && (
          <JsonBlock label="Metadata" value={attributes['a2ui.wire.metadata']} />
        )}
      </>
    );
  }
  if (step.kind === 'outcome') {
    return step.outcome === 'failed' ? null : (
      <p className="type-quiet">
        {step.outcome === 'waiting_for_input'
          ? 'The turn ended with the agent waiting for input.'
          : step.outcome === 'cancelled'
            ? 'The turn was cancelled.'
            : 'The turn completed.'}
      </p>
    );
  }
  const metadata = (step.part as {metadata?: unknown} | undefined)?.metadata;
  return (
    <>
      {step.kind === 'message' && (
        <JsonBlock
          label="Message"
          value={step.message}
          marks={marks}
          legacy={legacy}
          reveal={reveal}
        />
      )}
      {step.kind === 'data' && <JsonBlock label="Data" value={step.part?.content} />}
      {step.kind === 'text' && <TextBlock label="Text" text={String(step.part?.content ?? '')} />}
      {step.kind === 'file' && step.part !== undefined && <FileFacts part={step.part} />}
      {step.kind === 'status' && <p className="type-quiet">A status update with no parts.</p>}
      {metadata !== undefined && <JsonBlock label="Metadata" value={metadata} />}
      {event !== undefined && (
        <FoldedDelivery event={event} offset={unixMillis(event.startTimeUnixNano) - startMs} />
      )}
    </>
  );
}

/** A file part's name, MIME type, and size or URI, as a pairs grid. */
function FileFacts({part}: {part: {[field: string]: unknown}}) {
  const facts: Array<{key: string; value: ReactNode}> = [];
  if (typeof part.name === 'string') facts.push({key: 'Name', value: part.name});
  if (typeof part.mime_type === 'string') facts.push({key: 'MIME type', value: part.mime_type});
  if (typeof part.content === 'string')
    facts.push({key: 'Size', value: `${Math.floor((part.content.length * 3) / 4)} bytes`});
  if (typeof part.uri === 'string') facts.push({key: 'URI', value: part.uri});
  if (typeof part.file_id === 'string') facts.push({key: 'File id', value: part.file_id});
  return <Pairs label="File" pairs={facts} keys="short" />;
}

/** A value the host may not have sent: its JSON, or a line saying it sent none. */
function OptionalJson({label, value}: {label: string; value: unknown}) {
  const fold = useBlockFold(label);
  if (value !== undefined) return <JsonBlock label={label} value={value} />;
  return (
    <section className="flex flex-col gap-1.5">
      <BlockLabel label={label} fold={fold} />
      {fold.open && <p className="type-quiet">The host sent none.</p>}
    </section>
  );
}

/** The delivery as the turn record holds it: its parts in order, each with its metadata, and its own metadata. */
function DeliveryBlocks({event}: {event: WireEvent}) {
  const metadata = event.attributes['a2ui.wire.metadata'];
  return (
    <>
      <JsonBlock label="Message" value={event.attributes['a2ui.wire.message']} />
      {metadata !== undefined && <JsonBlock label="Metadata" value={metadata} />}
    </>
  );
}

/** The delivery a step arrived in, folded under its section's line until opened. */
function FoldedDelivery({event, offset}: {event: WireEvent; offset: number}) {
  const [open, setOpen] = useState(false);
  const parts = event.attributes['a2ui.wire.message'].parts.length;
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="ease-quick flex h-9 shrink-0 cursor-pointer items-center gap-2 border-t px-0.5 text-left tone-muted"
      >
        <span className="flex size-4 shrink-0 items-center justify-center">
          <Icon kind={open ? 'chevronDown' : 'chevronRight'} size={12} />
        </span>
        <Icon kind="delivery" size={14} className="shrink-0" />
        <span className="type-section-label">Delivery</span>
        <span className="type-meta">
          {formatOffset(offset)} · {plural(parts, 'part')}
        </span>
      </button>
      {open && <DeliveryBlocks event={event} />}
    </>
  );
}
