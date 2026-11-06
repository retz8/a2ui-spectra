/**
 * What a replayed turn says of where it came from: the provenance and the
 * verdict on its turn event, where its source record is now, and what each of
 * its calls was, served from the record, gone to the model, or a miss. Worked
 * out when shown; nothing here is recorded.
 */
import type {ListedFixture, ListedTurn} from '../api.ts';
import type {Address} from './address.ts';
import {type CallRow, isProxyCall} from './call_rows.ts';
import {
  isModelCall,
  isTurnEvent,
  type OtherEvent,
  type Turn,
  type TurnRecordEvent,
  unixMillis,
} from './record.ts';
import type {TimelineRow} from './steps.ts';
import {argumentsOf, methodOf, pathOfEvent} from './tool_calls.ts';
import {briefText} from './turn_groups.ts';

export type ReplayMode = 'recorded' | 'model_live';

/** One reason of a failed verdict, in the check findings' style. */
export interface ReplayReason {
  code: string;
  message: string;
  /** A JSON Pointer from the turn to the message that differs. */
  path?: string;
}

/** What a turn's turn event says of the replay it came from. */
export interface Provenance {
  /** The record file's path, as replayed. */
  source: string;
  /** The trace id of the recorded turn this one stands for. */
  recordedTurn: string;
  mode: ReplayMode;
  /** Set once the turn has closed and been judged. */
  verdict?: 'passed' | 'failed';
  reasons: readonly ReplayReason[];
}

/** The provenance on a closed turn's turn event; nothing for a turn that is no replay. */
export function provenanceOf(events: readonly TurnRecordEvent[]): Provenance | undefined {
  const event = events.find(isTurnEvent);
  if (event === undefined) return undefined;
  const {attributes} = event;
  const source = attributes['a2ui.replay.source'];
  const recordedTurn = attributes['a2ui.replay.turn'];
  const mode = attributes['a2ui.replay.mode'];
  if (typeof source !== 'string' || typeof recordedTurn !== 'string') return undefined;
  const verdict = attributes['a2ui.replay.verdict'];
  const reasons = attributes['a2ui.replay.reasons'];
  return {
    source,
    recordedTurn,
    mode: mode === 'model_live' ? 'model_live' : 'recorded',
    ...((verdict === 'passed' || verdict === 'failed') && {verdict}),
    reasons: Array.isArray(reasons) ? (reasons as ReplayReason[]) : [],
  };
}

/** How many of a closed turn's verdict reasons are problems of the whole turn: a miss is its call's. */
export function differencesOf(events: readonly TurnRecordEvent[]): number {
  return (provenanceOf(events)?.reasons ?? []).filter(reason => reason.code !== 'REPLAY_MISS')
    .length;
}

/** A path's last segment. */
export function baseNameOf(path: string): string {
  const segments = path.split(/[\\/]/);
  return segments[segments.length - 1];
}

/** Where a replayed turn's source is now. */
export type ResolvedSource =
  /** A listed fixture at the recorded path. */
  | {kind: 'fixture'; name: string; path: string; file: string}
  /** A store turn carrying the recorded trace id, named as the turn list names it. */
  | {kind: 'turn'; traceId: string; label: string}
  /** Neither: the recorded path's base name, as plain text. */
  | {kind: 'gone'; file: string};

/** Resolves a source in order: a listed fixture at the recorded path, a store turn with the recorded trace id, gone. */
export function resolveSource(
  source: string,
  recordedTurn: string,
  {fixtures, turns}: {fixtures: readonly ListedFixture[]; turns: readonly ListedTurn[]},
): ResolvedSource {
  const fixture = fixtures.find(listed => listed.path === source);
  if (fixture !== undefined) {
    return {kind: 'fixture', name: fixture.name, path: fixture.path, file: baseNameOf(source)};
  }
  const turn = turns.find(listed => listed.traceId === recordedTurn);
  if (turn !== undefined) {
    return {
      kind: 'turn',
      traceId: turn.traceId,
      label: briefText(turn.input) || 'A turn',
    };
  }
  return {kind: 'gone', file: baseNameOf(source)};
}

/** Where a source's link goes: its fixture's turn in Fixtures, its turn in Turns, nowhere when it is gone. */
export function sourceAddressOf(
  source: ResolvedSource,
  recordedTurn: string | undefined,
  stepId?: string,
): Address | undefined {
  if (source.kind === 'gone') return undefined;
  const step = stepId === undefined ? {} : {stepId};
  if (source.kind === 'turn') return {traceId: recordedTurn ?? source.traceId, ...step};
  return {
    section: 'fixtures',
    fixture: source.name,
    ...(recordedTurn !== undefined && recordedTurn !== '' && {traceId: recordedTurn}),
    ...step,
  };
}

/** How a source reads in a sentence: a fixture by its file, a store turn by its input in brief, gone by its base name. */
export function sourceName(source: ResolvedSource): string {
  return source.kind === 'turn' ? source.label : source.file;
}

/** The trace id in a store file's name, `<time>_<trace id>.json`, for the source record's own turn. */
export function storeTraceOf(path: string): string | undefined {
  return /_([0-9a-f]{32})\.json$/.exec(path)?.[1];
}

/** The trace id of a recorded turn. */
export function traceIdOfTurn(turn: Turn): string | undefined {
  return turn.events.find(isTurnEvent)?.traceId;
}

/** The turn's number and the total, when they are known, from the source's turns. */
export function numberIn(
  turns: ReadonlyArray<{traceId?: string}> | undefined,
  recordedTurn: string,
): {turn: number; turns: number} | undefined {
  if (turns === undefined) return undefined;
  const index = turns.findIndex(turn => turn.traceId === recordedTurn);
  return index === -1 ? undefined : {turn: index + 1, turns: turns.length};
}

/** A mode as the third line and the popover's rows name it. */
export function modeWords(mode: ReplayMode): string {
  return mode === 'recorded' ? 'everything recorded' : 'tools recorded, model live';
}

/** What the third line says after the source: the turn's number, of the total when it is known, and the mode. */
export function replayWhereOf(mode: ReplayMode, number: {turn: number; turns?: number}): string {
  const of = number.turns === undefined ? '' : ` of ${number.turns}`;
  return `turn ${number.turn}${of} · ${modeWords(mode)}`;
}

/** Whether a call was served from the record. */
export function isServedCall(event: TurnRecordEvent): boolean {
  return (
    typeof (event.attributes as Record<string, unknown>)['a2ui.replay.served_from'] === 'string'
  );
}

/** Whether a call matched nothing in the record. */
export function isMissCall(event: TurnRecordEvent): boolean {
  return (event.attributes as Record<string, unknown>)['error.type'] === 'replay_miss';
}

/** Whether a row's call came from the record. */
export function isServedRow(row: CallRow): boolean {
  return row.proxy !== undefined && isServedCall(row.proxy);
}

/** The timeline's grey tags: a retry's, a served call's "Record", and both on a served retry. */
export function rowTagsOf(
  timeline: readonly TimelineRow[],
  retries: ReadonlyMap<string, {attempt: number}>,
): ReadonlyMap<string, string> {
  const tags = new Map<string, string>();
  for (const [id, retry] of retries) tags.set(id, `Retry ${retry.attempt}`);
  for (const row of timeline) {
    if (row.row !== 'step' || row.call === undefined || !isServedRow(row.call)) continue;
    const retry = tags.get(row.id);
    tags.set(row.id, retry === undefined ? 'Record' : `${retry} · Record`);
  }
  return tags;
}

/** A recorded call found in the source's turns, and where it was. */
export interface RecordedCall {
  call: OtherEvent;
  /** The trace id of the recorded turn it is in. */
  traceId: string;
  /** Its start after its turn's start, in milliseconds. */
  offsetMs: number;
  /** Its turn's number in the record, from 1. */
  turn: number;
}

/** Every call the proxies recorded in the source's turns, with where each was. */
export function recordedCallsOf(turns: readonly Turn[]): RecordedCall[] {
  return turns.flatMap((turn, index) => {
    const start = turn.events.find(isTurnEvent);
    if (start === undefined) return [];
    const startMs = unixMillis(start.startTimeUnixNano);
    return turn.events.filter(isProxyCall).map(call => ({
      call,
      traceId: start.traceId,
      offsetMs: unixMillis(call.startTimeUnixNano) - startMs,
      turn: index + 1,
    }));
  });
}

/** A call's detail, for a turn that is a replay: what it was, and what that says. */
export type CallReplay =
  /** Served from the record; `recorded` is the recorded call, when the source still holds it. */
  | {kind: 'served'; name: string; recorded?: RecordedCall}
  /** A live call of a live-mode replay. */
  | {kind: 'live'}
  /** A tool request that matched nothing, with the recorded requests of the same method and tool. */
  | {kind: 'toolMiss'; list: ToolMissList}
  /** A model request that matched nothing; the prefix break says the rest. */
  | {kind: 'modelMiss'};

/** The recorded requests a tool miss is set against. */
export interface ToolMissList {
  /** The method and tool name, or the HTTP method and path, the list holds. */
  of: string;
  rows: ReadonlyArray<{
    /** The arguments in brief. */
    args: string;
    recorded: RecordedCall;
  }>;
}

/** The method and the tool name of a tool call, or the method and the path of an HTTP tool. */
function toolKeyOf(event: OtherEvent): string | undefined {
  const method = methodOf(event);
  if (method !== undefined) {
    const tool = event.attributes['gen_ai.tool.name'];
    return method === 'tools/call' && typeof tool === 'string' ? `${method} ${tool}` : method;
  }
  const verb = event.attributes['http.request.method'];
  const path = pathOfEvent(event);
  return typeof verb === 'string' && path !== undefined ? `${verb} ${path}` : undefined;
}

/** The recorded requests of the same method and, for `tools/call`, the same tool; an HTTP tool's by method and path. */
export function toolMissListOf(call: OtherEvent, turns: readonly Turn[] | undefined): ToolMissList {
  const of = toolKeyOf(call) ?? call.name;
  const rows = (turns === undefined ? [] : recordedCallsOf(turns))
    .filter(recorded => !isModelCall(recorded.call) && toolKeyOf(recorded.call) === of)
    .map(recorded => ({
      args:
        JSON.stringify(argumentsOf({kind: 'tool', id: '', proxy: recorded.call, spans: []})) ?? '',
      recorded,
    }));
  return {of, rows};
}

/** What a selected call was, in a replayed turn; nothing for a turn that is no replay, or a call the proxies did not see. */
export function callReplayOf(
  row: CallRow,
  provenance: Provenance | undefined,
  source: ResolvedSource | undefined,
  sourceTurns: readonly Turn[] | undefined,
): CallReplay | undefined {
  if (provenance === undefined || source === undefined) return undefined;
  const {proxy} = row;
  if (proxy === undefined) return undefined;
  if (isServedCall(proxy)) {
    const recorded = (sourceTurns === undefined ? [] : recordedCallsOf(sourceTurns)).find(
      found => found.call.spanId === proxy.attributes['a2ui.replay.served_from'],
    );
    return {
      kind: 'served',
      name: sourceName(source),
      ...(recorded !== undefined && {recorded}),
    };
  }
  if (isMissCall(proxy)) {
    return row.kind === 'model'
      ? {kind: 'modelMiss'}
      : {kind: 'toolMiss', list: toolMissListOf(proxy, sourceTurns)};
  }
  if (row.kind === 'model' && provenance.mode === 'model_live') return {kind: 'live'};
  return undefined;
}
