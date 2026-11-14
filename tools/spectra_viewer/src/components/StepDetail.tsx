import {useState} from 'react';

import {cn} from '@/lib/utils';
import {parseTitleOf, sourceLineOfStep} from '@/model/a2ui_step.ts';
import type {NodeRef} from '@/model/address.ts';
import type {Prices} from '@/model/cost.ts';
import {legacyLinesOf, type StepLegacy} from '@/model/legacy_form.ts';
import type {KnownCatalog} from '@/model/catalogs.ts';
import {markedPath} from '@/model/json_lines.ts';
import type {PrefixBreak} from '@/model/prefix.ts';
import type {Problem} from '@/model/problems.ts';
import type {CallReplay, RecordedCall} from '@/model/provenance.ts';
import {useBlockFold} from '@/state/block_folds.ts';
import {isWireInput, type TurnRecordEvent, unixMillis, type WireEvent} from '@/model/record.ts';
import {deliveryLabel, plural, type Step, type TimelineRow} from '@/model/steps.ts';

import {DetailLink} from './CallParts.tsx';
import {brandIconOf, formatOffset, toneOf} from './format.ts';
import {Icon, LegacyMark} from './icons.tsx';
import {BlockLabel, JsonBlock, type Reveal} from './JsonBlock.tsx';
import {callTitleOf, ModelCallBlocks, type StepOnCall} from './ModelCallDetail.tsx';
import {GenerationBlocks, ParseBlocks} from './ParseDetail.tsx';
import type {RangeReveal} from './RawText.tsx';
import {ToolCallBlocks} from './ToolCallDetail.tsx';

/** No paths, kept the same from render to render. */
const NO_PATHS: readonly string[] = [];

/**
 * The selected step's detail: its problems, the rejections folded under
 * them as quiet lines, the legacy form's two lines when its message carried
 * components in it, then what it holds, then the delivery it arrived in,
 * folded. A problem that marks a line in the step's
 * message is pressed to bring the line into view. A model call's detail
 * holds its usage, its prefix break, its request, its response and its
 * exchange; a tool call's its arguments, its result and its exchange; and
 * either the agent's spans linked to it. Maximize gives the detail the
 * result pane's height.
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
  maximized,
  onMaximize,
  prices,
  prefix,
  onEarlier,
  catalogs,
  selectedNode,
  onSelectNode,
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
  /** Whether the detail takes the result pane's height. */
  maximized: boolean;
  onMaximize: () => void;
  prices: Prices | undefined;
  /** A model call's prefix break, when the step is a call read in full. */
  prefix: PrefixBreak | undefined;
  onEarlier: (found: Exclude<PrefixBreak, {form: 'first'}>) => void;
  /** The catalog definitions the viewer holds, for a parse's component ranges. */
  catalogs: readonly KnownCatalog[] | undefined;
  /** The tree node selected, whose range a parse's raw text tints. */
  selectedNode: NodeRef | undefined;
  /** Selects a component by its range in a parse's raw text. */
  onSelectNode: (node: NodeRef) => void;
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
  const title =
    row.row !== 'step'
      ? undefined
      : row.parse !== undefined
        ? parseTitleOf(row, startMs)
        : row.generation !== undefined
          ? {
              target: `${row.target} · ${sourceLineOfStep(row.generation)}`,
              times: formatOffset(row.offsetMs ?? 0),
            }
          : call === undefined
            ? undefined
            : callTitleOf(call, row.target, startMs);
  const offset = offsetOf(row, events, startMs);
  const [reveal, setReveal] = useState<Reveal>();
  const [rangeReveal, setRangeReveal] = useState<RangeReveal>();
  const message = row.row === 'step' && row.kind === 'message' ? row.message : undefined;
  const markOf = (problem: Problem) =>
    message === undefined || problem.inner === undefined
      ? undefined
      : markedPath(message, problem.inner);
  const marks = problems.flatMap(problem => markOf(problem) ?? []);
  return (
    <section aria-label="The step's detail" className="flex h-full min-h-0 flex-col border-t">
      <div className="flex h-10 shrink-0 items-center gap-2 pr-2.5 pl-4">
        {row.row === 'delivery' ? (
          <>
            <Icon kind="delivery" size={14} className="text-muted-foreground" />
            <span className="shrink-0 font-semibold">Delivery</span>
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {deliveryLabel(row).replace(/^Delivery · /, '')}
            </span>
          </>
        ) : (
          <>
            {row.brand !== undefined ? (
              <Icon kind={row.icon} size={14} {...brandIconOf(row.brand)} />
            ) : (
              <Icon kind={row.icon} size={14} className={toneOf(row.icon)} />
            )}
            <span className="shrink-0 font-semibold">{row.label}</span>
            {/* A failed turn's reason is its problem block's sentence. */}
            {!(row.kind === 'outcome' && row.outcome === 'failed') && (
              <span className="min-w-0 shrink-100 truncate text-xs text-muted-foreground">
                {title?.target ?? row.target}
              </span>
            )}
          </>
        )}
        <div className="flex-1" />
        {title !== undefined ? (
          // On a narrow detail, the times give way after the target, so the buttons stay in view.
          <span className="min-w-0 truncate text-xs text-muted-foreground" title={title.times}>
            {title.times}
          </span>
        ) : (
          offset !== undefined && (
            <span className="shrink-0 text-xs text-muted-foreground">{formatOffset(offset)}</span>
          )
        )}
        <button
          type="button"
          aria-label={maximized ? 'Restore the split' : 'Maximize the step’s detail'}
          aria-pressed={maximized}
          title={maximized ? 'Restore the split · m' : 'Maximize the step’s detail · m'}
          onClick={onMaximize}
          className={cn(
            'ease-quick flex size-6 cursor-pointer items-center justify-center rounded-md',
            maximized
              ? 'bg-tint text-foreground'
              : 'text-muted-foreground hover:bg-tint hover:text-foreground',
          )}
        >
          <Icon kind={maximized ? 'restore' : 'maximize'} size={14} />
        </button>
        <button
          type="button"
          aria-label={collapsed ? 'Expand the step’s detail' : 'Collapse the step’s detail'}
          aria-expanded={!collapsed}
          onClick={onToggle}
          className="ease-quick flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-tint hover:text-foreground"
        >
          <Icon kind={collapsed ? 'chevronRight' : 'chevronDown'} size={14} />
        </button>
      </div>
      {!collapsed && (
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto px-4 pb-3.5">
          {problems.map((problem, index) => {
            const mark = markOf(problem);
            if (problem.range !== undefined) {
              const {range} = problem;
              return (
                <button
                  key={index}
                  type="button"
                  onClick={() => setRangeReveal({...range})}
                  className="group ease-quick flex shrink-0 cursor-pointer items-start gap-2.5 rounded-lg bg-problem-soft px-3 py-2.5 text-left hover:inset-ring hover:inset-ring-problem"
                >
                  <ProblemText problem={problem} />
                  <span className="ease-quick mt-px ml-auto inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-muted-foreground group-hover:text-brand">
                    <Icon kind="jump" size={14} />
                    Show text
                  </span>
                </button>
              );
            }
            return mark === undefined ? (
              <div
                key={index}
                className="flex items-start gap-2.5 rounded-lg bg-problem-soft px-3 py-2.5"
              >
                <ProblemText problem={problem} onStep={onStep} />
              </div>
            ) : (
              <button
                key={index}
                type="button"
                onClick={() => setReveal({path: mark})}
                className="group ease-quick flex shrink-0 cursor-pointer items-start gap-2.5 rounded-lg bg-problem-soft px-3 py-2.5 text-left hover:inset-ring hover:inset-ring-problem"
              >
                <ProblemText problem={problem} />
                <span className="ease-quick mt-px ml-auto inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-muted-foreground group-hover:text-brand">
                  <Icon kind="jump" size={14} />
                  Show line
                </span>
              </button>
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
            <p key={index} className="text-xs leading-relaxed text-muted-foreground">
              {line}
            </p>
          ))}
          {legacy !== undefined && <LegacyLines legacy={legacy} />}
          {row.row === 'delivery' ? (
            <DeliveryBlocks event={events[row.eventIndex] as WireEvent} />
          ) : row.parse !== undefined ? (
            <ParseBlocks
              step={row}
              events={events}
              startMs={startMs}
              catalogs={catalogs}
              selectedNode={selectedNode}
              onSelectNode={onSelectNode}
              onStep={onStep}
              reveal={rangeReveal}
            />
          ) : row.generation !== undefined ? (
            <GenerationBlocks step={row} events={events} startMs={startMs} />
          ) : call?.kind === 'model' && stepOnCall !== undefined ? (
            <ModelCallBlocks
              row={call}
              events={events}
              startMs={startMs}
              prices={prices}
              prefix={prefix}
              onEarlier={onEarlier}
              step={stepOnCall}
              replay={callReplay}
              onRecorded={onRecorded}
            />
          ) : call?.kind === 'tool' ? (
            <ToolCallBlocks
              row={call}
              events={events}
              startMs={startMs}
              {...(callReplay !== undefined && {replay: callReplay})}
              onRecorded={onRecorded}
            />
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
 * The legacy form's two lines, with no box, the hourglass before them: the
 * number of components and their bare keys, then the v1.0 form, quieter.
 */
function LegacyLines({legacy}: {legacy: StepLegacy}) {
  const {first, second} = legacyLinesOf(legacy.count, legacy.keys);
  return (
    <div className="flex shrink-0 items-start gap-2.5 px-3">
      <LegacyMark size={14} className="mt-0.75" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-muted-strong">
          {first.lead}
          <Keys keys={first.keys} />
        </span>
        <span className="text-xs text-muted-foreground">
          {second.lead}
          <Keys keys={second.keys} />
          {second.after}
        </span>
      </div>
    </div>
  );
}

/** Keys in monospace, separated by commas. */
function Keys({keys}: {keys: readonly string[]}) {
  return keys.map((key, index) => (
    <span key={key}>
      {index > 0 && ', '}
      <code className="font-mono text-xs">{key}</code>
    </span>
  ));
}

/** A problem's plain sentence, the words that select a step a link, then its code. */
function ProblemText({problem, onStep}: {problem: Problem; onStep?: (stepId: string) => void}) {
  const {link} = problem;
  return (
    <>
      <Icon kind="failed" size={14} className="mt-0.5 text-problem" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium">
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
        <span className="text-xs text-muted-strong">{problem.code}</span>
        {problem.note !== undefined && (
          <span className="text-xs text-muted-foreground">{problem.note}</span>
        )}
      </span>
    </>
  );
}

function offsetOf(
  row: TimelineRow,
  events: readonly TurnRecordEvent[],
  startMs: number,
): number | undefined {
  if (row.offsetMs !== undefined) return row.offsetMs;
  const event =
    row.row === 'step' && row.position !== undefined ? events[row.position.eventIndex] : undefined;
  return event === undefined ? undefined : unixMillis(event.startTimeUnixNano) - startMs;
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
      <p className="text-muted-foreground">
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
      {step.kind === 'text' && <TextPart text={String(step.part?.content ?? '')} />}
      {step.kind === 'file' && step.part !== undefined && <FileFacts part={step.part} />}
      {step.kind === 'status' && (
        <p className="text-muted-foreground">A status update with no parts.</p>
      )}
      {metadata !== undefined && <JsonBlock label="Metadata" value={metadata} />}
      {event !== undefined && (
        <FoldedDelivery event={event} offset={unixMillis(event.startTimeUnixNano) - startMs} />
      )}
    </>
  );
}

/** A text part as text. */
function TextPart({text}: {text: string}) {
  const fold = useBlockFold('Text');
  return (
    <section className="flex flex-col gap-1.5">
      <BlockLabel label="Text" fold={fold} />
      {fold.open && <p className="rounded-lg bg-tint px-3 py-2.5 whitespace-pre-wrap">{text}</p>}
    </section>
  );
}

/** A file part's name, MIME type, and size or URI. */
function FileFacts({part}: {part: {[field: string]: unknown}}) {
  const fold = useBlockFold('File');
  const facts: Array<[string, string]> = [];
  if (typeof part.name === 'string') facts.push(['Name', part.name]);
  if (typeof part.mime_type === 'string') facts.push(['MIME type', part.mime_type]);
  if (typeof part.content === 'string')
    facts.push(['Size', `${Math.floor((part.content.length * 3) / 4)} bytes`]);
  if (typeof part.uri === 'string') facts.push(['URI', part.uri]);
  if (typeof part.file_id === 'string') facts.push(['File id', part.file_id]);
  return (
    <section className="flex flex-col gap-1.5">
      <BlockLabel label="File" fold={fold} />
      {fold.open && (
        <dl className="flex flex-col gap-0.5 rounded-lg bg-tint px-3 py-2.5">
          {facts.map(([name, value]) => (
            <div key={name} className="flex gap-3">
              <dt className="w-20 shrink-0 text-muted-foreground">{name}</dt>
              <dd className="min-w-0 break-all">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

/** A value the host may not have sent: its JSON, or a line saying it sent none. */
function OptionalJson({label, value}: {label: string; value: unknown}) {
  const fold = useBlockFold(label);
  if (value !== undefined) return <JsonBlock label={label} value={value} />;
  return (
    <section className="flex flex-col gap-1.5">
      <BlockLabel label={label} fold={fold} />
      {fold.open && <p className="text-muted-foreground">The host sent none.</p>}
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

/** The delivery a step arrived in, folded under a line until opened. */
function FoldedDelivery({event, offset}: {event: WireEvent; offset: number}) {
  const [open, setOpen] = useState(false);
  const parts = event.attributes['a2ui.wire.message'].parts.length;
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="ease-quick flex h-9 shrink-0 cursor-pointer items-center gap-2 border-t px-0.5 text-left text-xs text-muted-foreground hover:text-foreground"
      >
        <span className="flex size-4 shrink-0 items-center justify-center">
          <Icon kind={open ? 'chevronDown' : 'chevronRight'} size={12} />
        </span>
        <Icon kind="delivery" size={14} />
        <span className="font-semibold tracking-wider uppercase">Delivery</span>
        <span>
          {formatOffset(offset)} · {plural(parts, 'part')}
        </span>
      </button>
      {open && <DeliveryBlocks event={event} />}
    </>
  );
}
