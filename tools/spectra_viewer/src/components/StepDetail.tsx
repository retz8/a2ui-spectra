import {useState} from 'react';

import type {Problem} from '@/model/problems.ts';
import {isWireInput, type TurnRecordEvent, unixMillis, type WireEvent} from '@/model/record.ts';
import {deliveryLabel, plural, type Step, type TimelineRow} from '@/model/steps.ts';

import {formatOffset, toneOf} from './format.ts';
import {Icon} from './icons.tsx';
import {BlockLabel, JsonBlock} from './JsonBlock.tsx';

/** The selected step's detail: its problems, then what it holds, then the delivery it arrived in, folded. */
export function StepDetail({
  row,
  events,
  startMs,
  problems,
  collapsed,
  onToggle,
}: {
  row: TimelineRow;
  events: readonly TurnRecordEvent[];
  startMs: number;
  problems: readonly Problem[];
  collapsed: boolean;
  onToggle: () => void;
}) {
  const offset = offsetOf(row, events, startMs);
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
            <Icon kind={row.icon} size={14} className={toneOf(row.icon)} />
            <span className="shrink-0 font-semibold">{row.label}</span>
            <span className="min-w-0 truncate text-xs text-muted-foreground">{row.target}</span>
          </>
        )}
        <div className="flex-1" />
        {offset !== undefined && (
          <span className="shrink-0 text-xs text-muted-foreground">{formatOffset(offset)}</span>
        )}
        <button
          type="button"
          aria-label={collapsed ? 'Expand the step’s detail' : 'Collapse the step’s detail'}
          aria-expanded={!collapsed}
          onClick={onToggle}
          className="ease-quick flex size-[26px] cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-tint hover:text-foreground"
        >
          <Icon kind={collapsed ? 'chevronRight' : 'chevronDown'} size={14} />
        </button>
      </div>
      {!collapsed && (
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto px-4 pb-3.5">
          {problems.map((problem, index) => (
            <div
              key={index}
              className="flex items-start gap-2.5 rounded-[10px] bg-problem-soft px-3 py-2.5"
            >
              <Icon kind="failed" size={14} className="mt-0.5 text-problem" />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium">{problem.sentence}</span>
                <span className="text-xs text-muted-strong">{problem.code}</span>
              </div>
            </div>
          ))}
          {row.row === 'delivery' ? (
            <DeliveryBlocks event={events[row.eventIndex] as WireEvent} />
          ) : (
            <StepBlocks step={row} events={events} startMs={startMs} />
          )}
        </div>
      )}
    </section>
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
}: {
  step: Step;
  events: readonly TurnRecordEvent[];
  startMs: number;
}) {
  const event =
    step.position === undefined ? undefined : (events[step.position.eventIndex] as WireEvent);
  if (step.kind === 'input' && event !== undefined && isWireInput(event)) {
    const {attributes} = event;
    return (
      <>
        <JsonBlock label="Message" value={attributes['a2ui.wire.message']} />
        <OptionalJson label="Capabilities" value={attributes['a2ui.wire.capabilities']} />
        <OptionalJson label="Data model" value={attributes['a2ui.wire.data_model']} />
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
      {step.kind === 'message' && <JsonBlock label="Message" value={step.message} />}
      {step.kind === 'data' && <JsonBlock label="Data" value={step.part?.content} />}
      {step.kind === 'text' && (
        <section className="flex flex-col gap-1.5">
          <BlockLabel label="Text" />
          <p className="rounded-lg bg-tint px-3 py-2.5 whitespace-pre-wrap">
            {String(step.part?.content ?? '')}
          </p>
        </section>
      )}
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

/** A file part's name, MIME type, and size or URI. */
function FileFacts({part}: {part: {[field: string]: unknown}}) {
  const facts: Array<[string, string]> = [];
  if (typeof part.name === 'string') facts.push(['Name', part.name]);
  if (typeof part.mime_type === 'string') facts.push(['MIME type', part.mime_type]);
  if (typeof part.content === 'string')
    facts.push(['Size', `${Math.floor((part.content.length * 3) / 4)} bytes`]);
  if (typeof part.uri === 'string') facts.push(['URI', part.uri]);
  if (typeof part.file_id === 'string') facts.push(['File id', part.file_id]);
  return (
    <section className="flex flex-col gap-1.5">
      <BlockLabel label="File" />
      <dl className="flex flex-col gap-0.5 rounded-lg bg-tint px-3 py-2.5">
        {facts.map(([name, value]) => (
          <div key={name} className="flex gap-3">
            <dt className="w-20 shrink-0 text-muted-foreground">{name}</dt>
            <dd className="min-w-0 break-all">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** A value the host may not have sent: its JSON, or a line saying it sent none. */
function OptionalJson({label, value}: {label: string; value: unknown}) {
  if (value !== undefined) return <JsonBlock label={label} value={value} />;
  return (
    <section className="flex flex-col gap-1.5">
      <BlockLabel label={label} />
      <p className="text-muted-foreground">The host sent none.</p>
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
        className="ease-quick flex h-[34px] shrink-0 cursor-pointer items-center gap-2 border-t px-0.5 text-left text-xs text-muted-foreground hover:text-foreground"
      >
        <Icon kind={open ? 'chevronDown' : 'chevronRight'} size={13} />
        <Icon kind="delivery" size={14} />
        <span className="font-semibold tracking-[0.06em] uppercase">Delivery</span>
        <span>
          {formatOffset(offset)} · {plural(parts, 'part')}
        </span>
      </button>
      {open && <DeliveryBlocks event={event} />}
    </>
  );
}
