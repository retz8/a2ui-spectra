/**
 * The turn's timeline: a step for each A2UI message, text part, data part,
 * file part and status update, in the order they came, with the input first
 * and the outcome last. The steps of one delivery that carries several are
 * grouped under a row for the delivery.
 */
import {inputBrief} from './input_brief.ts';
import {messageKey} from './messages.ts';
import {
  isTurnEvent,
  isWireInput,
  isWireOutput,
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
  /** Names the step within its turn. */
  id: string;
  kind: 'input' | 'status' | 'text' | 'data' | 'file' | 'message' | 'outcome';
  icon: StepIcon;
  label: string;
  /** What the step is about, in brief. */
  target: string;
  /** Milliseconds since the turn's start; none for a step its delivery's row times. */
  offsetMs?: number;
  /** Under its delivery's row. */
  grouped: boolean;
  /** Where it sits; none for the outcome, which follows every event. */
  position?: Position;
  /** An A2UI message's key, as `messageKey` names it. */
  messageKey?: string;
  /** The A2UI message, for a message step. */
  message?: unknown;
  /** The part, for a text, data or file step. */
  part?: WirePart;
  /** The outcome, for the outcome step. */
  outcome?: TurnOutcome;
}

/** A delivery that carries several steps. */
export interface DeliveryRow {
  row: 'delivery';
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
  const rows: TimelineRow[] = [];
  events.forEach((event, eventIndex) => {
    if (!isWireInput(event) && !isWireOutput(event)) return;
    const offsetMs = unixMillis(event.startTimeUnixNano) - startMs;
    const steps = stepsOfEvent(event, eventIndex);
    if (steps.length === 1) {
      rows.push({...steps[0], offsetMs});
      return;
    }
    const {parts} = event.attributes['a2ui.wire.message'];
    rows.push({
      row: 'delivery',
      id: `delivery-${eventIndex}`,
      eventIndex,
      offsetMs,
      parts: parts.length,
      messages: steps.filter(step => step.kind === 'message').length,
    });
    rows.push(...steps.map(step => ({...step, grouped: true})));
  });
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
        id: `input-${eventIndex}`,
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
        id: `status-${eventIndex}`,
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
          id: `message-${key}`,
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
    const id = `part-${eventIndex}.${partIndex}`;
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
