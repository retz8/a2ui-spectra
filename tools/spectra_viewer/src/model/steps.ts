/**
 * The turn's timeline: a step for each A2UI message, text part, data part,
 * file part and status update, and a row for each model call and tool call,
 * by start time, with the input first and the outcome last. The steps of one
 * delivery that carries several are grouped under a row for the delivery.
 * An MCP request other than a tool called, a resource read or a prompt got
 * is a housekeeping row, drawn as small as a delivery's. A parse of the A2UI
 * step is a row; the toolset's tool call joins its parse's row; a prompt
 * generation has a row only when it failed.
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
import {agentMessages, isThrough, messageKey, type Position} from './messages.ts';
import {parseOfMessage} from './a2ui_step.ts';

export {isThrough, type Position};
import {type Brand, brandOf, modelOf, providerOf, rowTextOf} from './model_calls.ts';
import {isFullToolRow, toolRowTextOf} from './tool_calls.ts';
import {formatNameOf} from './ranges.ts';
import {
  isParse,
  isPromptGeneration,
  isTurnEvent,
  isWireInput,
  isWireOutput,
  type ModelCallEvent,
  type ParseEvent,
  type PromptGenerationEvent,
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
  | 'parse'
  | 'prompt'
  | OutcomeIcon;

export type OutcomeIcon = 'completed' | 'waiting' | 'failed' | 'cancelled';

export interface Step {
  row: 'step';
  /**
   * Names the step within its turn, by its event's span id, so it is the same
   * while the turn is open, when only its wire events have come, and once it
   * has closed.
   */
  id: string;
  kind:
    | 'input'
    | 'status'
    | 'text'
    | 'data'
    | 'file'
    | 'message'
    | 'call'
    | 'parse'
    | 'prompt'
    | 'outcome';
  icon: StepIcon;
  /** A model call's provider, whose colour its icon takes. */
  brand?: Brand;
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
  /**
   * The call, for a call's row: its proxy's event and the received spans of
   * its chain. A parse made by the toolset's tool call carries the tool
   * call's row too.
   */
  call?: CallRow;
  /** The parse, for a parse's row. */
  parse?: ParseEvent;
  /** The prompt generation, for a failed prompt generation's row. */
  generation?: PromptGenerationEvent;
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
  const callUnits = new Map<string, {start: bigint; index: number; rows: TimelineRow[]}>();
  const callRows = callRowsOf(events);
  for (const call of callRows) {
    const timed = timedEventOf(call);
    callUnits.set(call.id, {
      start: BigInt(timed.startTimeUnixNano),
      index: indexOf.get(timed) ?? events.length,
      rows: [callStep(call, events, startMs)],
    });
  }
  for (const parse of events.filter(isParse)) {
    const tool = toolRowOf(parse, callRows);
    const step = parseStep(parse, events, startMs, tool);
    if (tool !== undefined && callUnits.has(tool.id)) {
      const unit = callUnits.get(tool.id)!;
      callUnits.set(tool.id, {...unit, rows: [step]});
      continue;
    }
    units.push({
      start: BigInt(parse.startTimeUnixNano),
      index: indexOf.get(parse) ?? events.length,
      rows: [step],
    });
  }
  for (const generation of events.filter(isPromptGeneration)) {
    if (generation.status?.code !== 2) continue;
    units.push({
      start: BigInt(generation.startTimeUnixNano),
      index: indexOf.get(generation) ?? events.length,
      rows: [generationStep(generation, events, startMs)],
    });
  }
  units.push(...callUnits.values());
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
  const through =
    timed.endTimeUnixNano === undefined
      ? undefined
      : lastWireEventBy(events, BigInt(timed.endTimeUnixNano));
  const housekeeping = call.kind === 'tool' && !isFullToolRow(call);
  const brand = call.kind === 'model' ? brandOf(modelReadingOf(call).event) : undefined;
  return {
    row: 'step',
    id: call.id,
    kind: 'call',
    icon: call.kind === 'model' ? 'model' : 'tool',
    ...(brand !== undefined && {brand}),
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

/** The index of the last wire event that started by a time. */
function lastWireEventBy(events: readonly TurnRecordEvent[], end: bigint): number | undefined {
  let through: number | undefined;
  events.forEach((event, index) => {
    if ((isWireInput(event) || isWireOutput(event)) && BigInt(event.startTimeUnixNano) <= end) {
      through = index;
    }
  });
  return through;
}

/**
 * The tool call rows the toolset's parses joined, by row id: each is shown
 * as its parse, and the header does not count it among the tool calls.
 */
export function toolRowsOfParses(
  events: readonly TurnRecordEvent[],
  rows: readonly CallRow[],
): Set<string> {
  const ids = new Set<string>();
  for (const parse of events.filter(isParse)) {
    const row = toolRowOf(parse, rows);
    if (row !== undefined) ids.add(row.id);
  }
  return ids;
}

/**
 * The tool call's row a toolset parse belongs to: the row holding the span
 * the parse sits under, else the row of the same `gen_ai.tool.call.id`.
 */
function toolRowOf(parse: ParseEvent, rows: readonly CallRow[]): CallRow | undefined {
  if (parse.attributes['gen_ai.tool.name'] === undefined) return undefined;
  const tools = rows.filter(row => row.kind === 'tool');
  const parent = parse.parentSpanId;
  const under = parent === undefined ? undefined : tools.find(row => idsOf(row).includes(parent));
  if (under !== undefined) return under;
  const callId = parse.attributes['gen_ai.tool.call.id'];
  if (typeof callId !== 'string') return undefined;
  return tools.find(row =>
    [...(row.proxy === undefined ? [] : [row.proxy]), ...row.spans].some(
      event => event.attributes['gen_ai.tool.call.id'] === callId,
    ),
  );
}

/**
 * A parse's row, named by its span id, or by its proxy's when it joins a
 * tool call's row: "Parse", its format and "streamed" for a stream, the
 * tool's name first when it is the toolset's call. Its position is the last
 * wire message traced to it; else the last wire event started by the
 * parse's end.
 */
function parseStep(
  parse: ParseEvent,
  events: readonly TurnRecordEvent[],
  startMs: number,
  tool: CallRow | undefined,
): Step {
  const {attributes} = parse;
  const format = formatNameOf(attributes['a2ui.parse.inference_format']);
  const target = [
    ...(typeof attributes['gen_ai.tool.name'] === 'string' ? [attributes['gen_ai.tool.name']] : []),
    ...(format !== undefined ? [format] : []),
    ...(attributes['a2ui.parse.streamed'] === true ? ['streamed'] : []),
  ].join(' · ');
  let through: number | undefined;
  for (const message of agentMessages(events)) {
    if (parseOfMessage(events, message.key)?.spanId === parse.spanId) through = message.eventIndex;
  }
  if (through === undefined && parse.endTimeUnixNano !== undefined) {
    through = lastWireEventBy(events, BigInt(parse.endTimeUnixNano));
  }
  const timed = tool === undefined ? parse : timedEventOf(tool);
  return {
    row: 'step',
    id: tool?.proxy?.spanId ?? parse.spanId,
    kind: 'parse',
    icon: 'parse',
    label: 'Parse',
    target,
    offsetMs: unixMillis(timed.startTimeUnixNano) - startMs,
    grouped: false,
    ...(through !== undefined && {position: {eventIndex: through}}),
    ...(tool !== undefined && {call: tool}),
    parse,
    aliases: [...(tool === undefined ? [] : idsOf(tool)), parse.spanId],
  };
}

/** A failed prompt generation's row: "Prompt generation" and its format. */
function generationStep(
  generation: PromptGenerationEvent,
  events: readonly TurnRecordEvent[],
  startMs: number,
): Step {
  const through =
    generation.endTimeUnixNano === undefined
      ? undefined
      : lastWireEventBy(events, BigInt(generation.endTimeUnixNano));
  return {
    row: 'step',
    id: generation.spanId,
    kind: 'prompt',
    icon: 'prompt',
    label: 'Prompt generation',
    target: formatNameOf(generation.attributes['a2ui.prompt.inference_format']) ?? '',
    offsetMs: unixMillis(generation.startTimeUnixNano) - startMs,
    grouped: false,
    ...(through !== undefined && {position: {eventIndex: through}}),
    generation,
    aliases: [generation.spanId],
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
