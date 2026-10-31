/**
 * The turn's timeline: a step for each A2UI message, text part, data part,
 * file part and status update, and a row for each model call and tool call,
 * by start time, with the input first and the outcome last. The steps of one
 * delivery that carries several are grouped under a row for the delivery.
 * An MCP request other than a tool called, a resource read or a prompt got
 * is a housekeeping row, drawn as small as a delivery's.
 */
import {
  type CallRow,
  callRowsOf,
  idsOf,
  modelReadingOf,
  sourceOfNames,
  timedEventOf,
} from './call_rows.ts';
import {inputBrief} from './input_brief.ts';
import {messageKey} from './messages.ts';
import {modelOf, providerOf, rowTextOf} from './model_calls.ts';
import {isFullToolRow, toolRowTextOf} from './tool_calls.ts';
import {
  isTurnEvent,
  isWireInput,
  isWireOutput,
  type ModelCallEvent,
  type TurnOutcome,
  type TurnRecordEvent,
  unixMillis,
  type WireEvent,
  type WireInputEvent,
  type WirePart,
} from './record.ts';

/** The step types, each drawn with its own icon. */
export type StepIcon =
  | 'input'
  | 'status'
  | 'text'
  | 'data'
  | 'file'
  | 'createSurface'
  | 'updateComponents'
  | 'updateDataModel'
  | 'deleteSurface'
  | 'message'
  | 'model'
  | 'tool'
  | OutcomeIcon;

export type OutcomeIcon = 'completed' | 'waiting' | 'failed' | 'cancelled';

/** Where a step sits among the turn's events: the event, the part, and the index in an array. */
export interface Position {
  eventIndex: number;
  partIndex?: number;
  index?: number;
}

export interface Step {
  row: 'step';
  /**
   * Names the step within its turn, by its event's span id, so it is the same
   * while the turn is open, when only its wire events have come, and once it
   * has closed.
   */
  id: string;
  kind: 'input' | 'status' | 'text' | 'data' | 'file' | 'message' | 'call' | 'outcome';
  icon: StepIcon;
  label: string;
  /** What the step is about, in brief. */
  target: string;
  /** Milliseconds since the turn's start; none for a step its delivery's row times. */
  offsetMs?: number;
  /** Under its delivery's row. */
  grouped: boolean;
  /**
   * Where it sits; none for the outcome, which follows every event. For a
   * call, where the surfaces stood at its end; none while it is in flight,
   * when the latest state shows.
   */
  position?: Position;
  /** An A2UI message's key, as `messageKey` names it. */
  messageKey?: string;
  /** The A2UI message, for a message step. */
  message?: unknown;
  /** The part, for a text, data or file step. */
  part?: WirePart;
  /** The outcome, for the outcome step. */
  outcome?: TurnOutcome;
  /** The call, for a call's row: its proxy's event and the received spans of its chain. */
  call?: CallRow;
  /** A housekeeping row: an MCP request other than a tool called, a resource read or a prompt got. */
  housekeeping?: boolean;
  /**
   * For a call's row, every span id it holds, its own id among them: a row
   * picked by an id it no longer goes by, such as a span-only row merged
   * into its proxy's row, is found by them.
   */
  aliases?: string[];
}

/** A delivery that carries several steps. */
export interface DeliveryRow {
  row: 'delivery';
  /** Names the delivery within its turn, by its event's span id. */
  id: string;
  eventIndex: number;
  offsetMs: number;
  parts: number;
  /** Its A2UI messages, each element of an array counted. */
  messages: number;
}

export type TimelineRow = Step | DeliveryRow;

const OUTCOME_STEPS: Record<TurnOutcome, {icon: OutcomeIcon; label: string}> = {
  completed: {icon: 'completed', label: 'Completed'},
  waiting_for_input: {icon: 'waiting', label: 'Waiting for input'},
  failed: {icon: 'failed', label: 'Turn failed'},
  cancelled: {icon: 'cancelled', label: 'Cancelled'},
};

const MESSAGE_ICONS = new Set<StepIcon>([
  'createSurface',
  'updateComponents',
  'updateDataModel',
  'deleteSurface',
]);

/** The timeline of a turn's events, timed from its start. */
export function timelineOf(events: readonly TurnRecordEvent[], startMs: number): TimelineRow[] {
  // Each wire event and each call is a unit of rows, placed by its start; a delivery keeps its steps under it.
  const units: Array<{start: bigint; index: number; rows: TimelineRow[]}> = [];
  const indexOf = new Map(events.map((event, index) => [event, index]));
  events.forEach((event, eventIndex) => {
    if (!isWireInput(event) && !isWireOutput(event)) return;
    const start = BigInt(event.startTimeUnixNano);
    const offsetMs = unixMillis(event.startTimeUnixNano) - startMs;
    const steps = stepsOfEvent(event, eventIndex);
    if (steps.length === 1) {
      units.push({start, index: eventIndex, rows: [{...steps[0], offsetMs}]});
      return;
    }
    const {parts} = event.attributes['a2ui.wire.message'];
    const delivery: DeliveryRow = {
      row: 'delivery',
      id: `delivery-${event.spanId}`,
      eventIndex,
      offsetMs,
      parts: parts.length,
      messages: steps.filter(step => step.kind === 'message').length,
    };
    units.push({
      start,
      index: eventIndex,
      rows: [delivery, ...steps.map(step => ({...step, grouped: true}))],
    });
  });
  for (const call of callRowsOf(events)) {
    const timed = timedEventOf(call);
    units.push({
      start: BigInt(timed.startTimeUnixNano),
      index: indexOf.get(timed) ?? events.length,
      rows: [callStep(call, events, startMs)],
    });
  }
  // By start time, the record's order among equals.
  units.sort((a, b) => (a.start === b.start ? a.index - b.index : a.start < b.start ? -1 : 1));
  const rows: TimelineRow[] = units.flatMap(unit => unit.rows);
  const turn = events.find(isTurnEvent);
  if (turn !== undefined) {
    const outcome = turn.attributes['a2ui.turn.outcome'];
    const {icon, label} = OUTCOME_STEPS[outcome];
    const reason = turn.status?.message;
    rows.push({
      row: 'step',
      id: 'outcome',
      kind: 'outcome',
      icon,
      label,
      target:
        outcome === 'failed' && reason !== undefined && reason !== '' ? reason : 'the turn ended',
      offsetMs: unixMillis(turn.endTimeUnixNano) - startMs,
      grouped: false,
      outcome,
    });
  }
  return rows;
}

/**
 * A call's row, named by its proxy's span id, else its innermost span's. A
 * model call says its model id as requested and its provider, or its host
 * and its method and path when recorded raw; one read from spans only adds
 * its source to its provider. A tool call says what `toolRowTextOf` says.
 */
function callStep(call: CallRow, events: readonly TurnRecordEvent[], startMs: number): Step {
  const timed = timedEventOf(call);
  const {label, target} = call.kind === 'model' ? modelRowTextOf(call) : toolRowTextOf(call);
  // The surfaces as they stood at the call's end: after every wire event that started by then.
  let through: number | undefined;
  if (timed.endTimeUnixNano !== undefined) {
    const end = BigInt(timed.endTimeUnixNano);
    events.forEach((event, index) => {
      if ((isWireInput(event) || isWireOutput(event)) && BigInt(event.startTimeUnixNano) <= end) {
        through = index;
      }
    });
  }
  const housekeeping = call.kind === 'tool' && !isFullToolRow(call);
  return {
    row: 'step',
    id: call.id,
    kind: 'call',
    icon: call.kind === 'model' ? 'model' : 'tool',
    label,
    target,
    offsetMs: unixMillis(timed.startTimeUnixNano) - startMs,
    grouped: false,
    ...(through !== undefined && {position: {eventIndex: through}}),
    call,
    ...(housekeeping && {housekeeping}),
    aliases: idsOf(call),
  };
}

/**
 * A model row's text: the proxy's call as `rowTextOf` says it, linked or
 * not; a call read from spans only with its model id as the agent requested
 * it, its provider and its source, or its source alone when its spans name
 * no provider.
 */
function modelRowTextOf(call: CallRow): {label: string; target: string} {
  if (call.proxy !== undefined) return rowTextOf(call.proxy as ModelCallEvent);
  const {event} = modelReadingOf(call);
  const provider = providerOf(event);
  const source = sourceOfNames(call, ['gen_ai.provider.name']) ?? '';
  return {
    label: modelOf(event) ?? event.name,
    target: provider === undefined ? source : `${provider} · ${source}`,
  };
}

/** A delivery row's label: its parts, and its messages when an array holds several. */
export function deliveryLabel(row: DeliveryRow): string {
  const parts = plural(row.parts, 'part');
  return row.messages > row.parts
    ? `Delivery · ${parts}, ${plural(row.messages, 'message')}`
    : `Delivery · ${parts}`;
}

/** The steps an event becomes: the input, a status update, or one for each part and message. */
function stepsOfEvent(event: WireEvent, eventIndex: number): Step[] {
  const {parts} = event.attributes['a2ui.wire.message'];
  const base = {row: 'step' as const, grouped: false};
  if (isWireInput(event)) {
    return [
      {
        ...base,
        id: `input-${event.spanId}`,
        kind: 'input',
        icon: 'input',
        label: 'Input',
        target: inputTarget(event),
        position: {eventIndex},
      },
    ];
  }
  if (parts.length === 0) {
    return [
      {
        ...base,
        id: `status-${event.spanId}`,
        kind: 'status',
        icon: 'status',
        label: 'Status update',
        target: '',
        position: {eventIndex},
      },
    ];
  }
  return parts.flatMap((part, partIndex): Step[] => {
    const position = {eventIndex, partIndex};
    if (part.type === 'a2ui') {
      const array = Array.isArray(part.content);
      const messages: unknown[] = array ? (part.content as unknown[]) : [part.content];
      return messages.map((message, index) => {
        const key = array
          ? messageKey(eventIndex, partIndex, index)
          : messageKey(eventIndex, partIndex);
        const type = messageTypeOf(message);
        return {
          ...base,
          id: array
            ? `message-${event.spanId}.${partIndex}.${index}`
            : `message-${event.spanId}.${partIndex}`,
          kind: 'message',
          icon: MESSAGE_ICONS.has(type as StepIcon) ? (type as StepIcon) : 'message',
          label: type ?? 'A2UI message',
          target: messageTarget(message, type),
          position: array ? {...position, index} : position,
          messageKey: key,
          message,
        };
      });
    }
    const id = `part-${event.spanId}.${partIndex}`;
    if (part.type === 'text') {
      const text = typeof part.content === 'string' ? collapse(part.content) : '';
      return [
        {
          ...base,
          id,
          kind: 'text',
          icon: 'text',
          label: 'Text',
          target: `“${text}”`,
          position,
          part,
        },
      ];
    }
    if (part.type === 'blob' || part.type === 'uri' || part.type === 'file') {
      return [
        {
          ...base,
          id,
          kind: 'file',
          icon: 'file',
          label: 'File',
          target: fileTarget(part),
          position,
          part,
        },
      ];
    }
    return [
      {
        ...base,
        id,
        kind: 'data',
        icon: 'data',
        label: part.type === 'data' ? 'Data' : part.type,
        target: dataTarget(part.content),
        position,
        part,
      },
    ];
  });
}

function inputTarget(event: WireInputEvent): string {
  const brief = inputBrief(event);
  if (brief === undefined) return '';
  if ('text' in brief) return brief.text;
  if ('partType' in brief) return `${brief.partType} part`;
  const surfaceId = actionSurfaceOf(event.attributes['a2ui.wire.message'].parts);
  return surfaceId === undefined
    ? `Action “${brief.action}”`
    : `Action “${brief.action}” · ${surfaceId}`;
}

/** The surface an input's action names, in v0.9 and v1.0's `action` or v0.8's `userAction`. */
function actionSurfaceOf(parts: readonly WirePart[]): string | undefined {
  for (const part of parts) {
    if (part.type !== 'a2ui') continue;
    for (const message of Array.isArray(part.content) ? part.content : [part.content]) {
      if (typeof message !== 'object' || message === null) continue;
      for (const key of ['action', 'userAction']) {
        const surfaceId = ((message as Record<string, unknown>)[key] as {surfaceId?: unknown})
          ?.surfaceId;
        if (typeof surfaceId === 'string') return surfaceId;
      }
    }
  }
  return undefined;
}

/** A message's type: its one key besides `version`. */
export function messageTypeOf(message: unknown): string | undefined {
  if (typeof message !== 'object' || message === null) return undefined;
  return Object.keys(message).find(key => key !== 'version');
}

function messageTarget(message: unknown, type: string | undefined): string {
  if (type === undefined) return '';
  const body = (message as Record<string, unknown>)[type];
  if (typeof body !== 'object' || body === null) return '';
  const {surfaceId, components, path} = body as {
    surfaceId?: unknown;
    components?: unknown;
    path?: unknown;
  };
  const surface = typeof surfaceId === 'string' ? surfaceId : undefined;
  if (type === 'updateComponents' && Array.isArray(components)) {
    return `${surface ?? 'no surface'} · ${plural(components.length, 'component')}`;
  }
  if (type === 'updateDataModel') {
    return `${surface ?? 'no surface'} · ${typeof path === 'string' ? path : '/'}`;
  }
  return surface ?? '';
}

function fileTarget(part: WirePart): string {
  const {
    name,
    uri,
    mime_type: mimeType,
  } = part as {name?: unknown; uri?: unknown; mime_type?: unknown};
  const what = typeof name === 'string' ? name : typeof uri === 'string' ? uri : 'file';
  return typeof mimeType === 'string' ? `${what} · ${mimeType}` : what;
}

function dataTarget(content: unknown): string {
  if (Array.isArray(content)) return plural(content.length, 'item');
  if (typeof content === 'object' && content !== null) return Object.keys(content).join(', ');
  return JSON.stringify(content) ?? '';
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** Whether a position comes at or before another. */
export function isThrough(position: Position, through: Position): boolean {
  if (position.eventIndex !== through.eventIndex) return position.eventIndex < through.eventIndex;
  if (through.partIndex === undefined || position.partIndex === undefined) return true;
  if (position.partIndex !== through.partIndex) return position.partIndex < through.partIndex;
  if (through.index === undefined || position.index === undefined) return true;
  return position.index <= through.index;
}

/** The agent's text parts up to a position, joined: the reply as it stood there. */
export function replyThrough(events: readonly TurnRecordEvent[], through?: Position): string {
  const texts: string[] = [];
  events.forEach((event, eventIndex) => {
    if (!isWireOutput(event)) return;
    event.attributes['a2ui.wire.message'].parts.forEach((part, partIndex) => {
      if (part.type !== 'text' || typeof part.content !== 'string') return;
      if (through !== undefined && !isThrough({eventIndex, partIndex}, through)) return;
      texts.push(part.content);
    });
  });
  return collapse(texts.join(''));
}
