import type {ReactNode} from 'react';

import {messageKey} from '@/model/messages.ts';
import {
  isWireInput,
  messagesOfPart,
  unixMillis,
  type WireEvent,
  type WirePart,
} from '@/model/record.ts';

import {CopyButton} from './CopyButton.tsx';
import {formatOffset} from './format.ts';
import {JsonView} from './JsonView.tsx';
import {type GoTo, type MessageMarks, targetIds} from './links.ts';

/** The wire events of one tab, in order, each with its index among the turn's events. */
export function WireEvents({
  events,
  startTime,
  marks,
  goTo,
  empty,
}: {
  events: ReadonlyArray<{event: WireEvent; index: number}>;
  /** The turn's start, in milliseconds since the Unix epoch. */
  startTime: number;
  marks?: ReadonlyMap<string, MessageMarks>;
  goTo: GoTo;
  empty: string;
}) {
  if (events.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="flex flex-col gap-3">
      {events.map(({event, index}) => (
        <WireEventCard
          key={event.spanId + index}
          event={event}
          eventIndex={index}
          offset={unixMillis(event.startTimeUnixNano) - startTime}
          marks={marks}
          goTo={goTo}
        />
      ))}
    </div>
  );
}

function WireEventCard({
  event,
  eventIndex,
  offset,
  marks,
  goTo,
}: {
  event: WireEvent;
  eventIndex: number;
  offset: number;
  marks?: ReadonlyMap<string, MessageMarks>;
  goTo: GoTo;
}) {
  const {attributes} = event;
  const {parts} = attributes['a2ui.wire.message'];
  const extras: Array<[string, unknown]> = [['Metadata', attributes['a2ui.wire.metadata']]];
  if (isWireInput(event)) {
    extras.push(
      ['Capabilities', event.attributes['a2ui.wire.capabilities']],
      ['Data model', event.attributes['a2ui.wire.data_model']],
    );
  }
  return (
    <section className="rounded-lg border bg-card">
      <header className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
        <span className="tabular-nums">{formatOffset(offset)}</span>
        <span>
          {parts.length} {parts.length === 1 ? 'part' : 'parts'}
        </span>
      </header>
      <div className="flex flex-col gap-3 p-3">
        {parts.length === 0 && <p className="text-sm text-muted-foreground">No parts.</p>}
        {parts.map((part, partIndex) => (
          <Part
            key={partIndex}
            part={part}
            eventIndex={eventIndex}
            partIndex={partIndex}
            marks={marks}
            goTo={goTo}
          />
        ))}
        {extras
          .filter(([, value]) => value !== undefined)
          .map(([label, value]) => (
            <Labelled key={label} label={label}>
              <JsonView value={value} />
            </Labelled>
          ))}
      </div>
    </section>
  );
}

function Part({
  part,
  eventIndex,
  partIndex,
  marks,
  goTo,
}: {
  part: WirePart;
  eventIndex: number;
  partIndex: number;
  marks?: ReadonlyMap<string, MessageMarks>;
  goTo: GoTo;
}) {
  if (part.type === 'text' && typeof part.content === 'string') {
    return (
      <Labelled label="Text">
        <p className="text-sm whitespace-pre-wrap">{part.content}</p>
      </Labelled>
    );
  }
  if (part.type === 'a2ui') {
    const messages = messagesOfPart(part);
    const isArray = Array.isArray(part.content);
    return (
      <div className="flex flex-col gap-2">
        {messages.map((message, index) => {
          const key = messageKey(eventIndex, partIndex, isArray ? index : undefined);
          return (
            <A2uiMessage
              key={key}
              id={targetIds.message(key)}
              label={isArray ? `A2UI message [${index}]` : 'A2UI message'}
              message={message}
              marks={marks?.get(key)}
              goTo={goTo}
            />
          );
        })}
      </div>
    );
  }
  return (
    <Labelled label={`${part.type} part`}>
      <JsonView value={part} />
    </Labelled>
  );
}

function A2uiMessage({
  id,
  label,
  message,
  marks,
  goTo,
}: {
  id: string;
  label: string;
  message: unknown;
  marks?: MessageMarks;
  goTo: GoTo;
}) {
  const findings = marks?.findings ?? [];
  return (
    <div id={id} className="scroll-mt-4 rounded-md border bg-background p-2">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium">{label}</span>
        <CopyButton text={JSON.stringify(message, null, 2)} label="Copy the message" />
        {findings.length > 0 && (
          <button
            type="button"
            className="text-destructive underline-offset-2 hover:underline"
            onClick={() => goTo('checks', findings[0])}
          >
            {findings.length} {findings.length === 1 ? 'finding' : 'findings'}
          </button>
        )}
        {marks?.rejection !== undefined && (
          <button
            type="button"
            className="text-amber-700 underline-offset-2 hover:underline dark:text-amber-400"
            onClick={() => goTo('surfaces', marks.rejection!)}
          >
            rejected by the processor
          </button>
        )}
      </div>
      <JsonView value={message} depth={2} />
    </div>
  );
}

export function Labelled({label, children}: {label: string; children: ReactNode}) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}
