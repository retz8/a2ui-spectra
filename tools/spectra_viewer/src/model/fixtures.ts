/**
 * The fixtures as the viewer reads them: the list's groups, the name prefilled
 * at save and the rules a name meets, what the Replay popover offers, the
 * recorded cost and the fixture line. The server is the authority on a
 * refusal; what mirrors its rules here only says it first.
 */
import type {ListedFixture, ListedTurn} from '../api.ts';
import {callRowsOf, modelReadingOf, timedEventOf} from './call_rows.ts';
import {callCostOf, formatCost, type Prices} from './cost.ts';
import type {InputBrief} from './input_brief.ts';
import {listedProblemCount} from './problems.ts';
import {isModelCall, type OtherEvent, type Turn} from './record.ts';
import {plural} from './steps.ts';
import {briefText, type TurnGroup} from './turn_groups.ts';

/** A fixture's typed name: the store's rule for a conversation folder. */
const NAME = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;

/** How long a slug may be before it is cut at a `-`. */
const SLUG_LENGTH = 40;

/**
 * The name prefilled for a turn, by the server's rule: its input in brief
 * lowercased, every run outside ASCII letters and digits one `-`, trimmed, cut
 * at a `-` near forty characters; `turn` when nothing survives.
 */
export function slugOf(input: InputBrief | undefined): string {
  const text =
    input === undefined ? '' : 'text' in input ? input.text : 'action' in input ? input.action : '';
  let slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length > SLUG_LENGTH) {
    const cut = slug.lastIndexOf('-', SLUG_LENGTH);
    slug = (cut > 0 ? slug.slice(0, cut) : slug.slice(0, SLUG_LENGTH)).replace(/-+$/, '');
  }
  return slug === '' ? 'turn' : slug;
}

/** The first free numbered name, as the server's clash suggests it: `<name>-2`, `<name>-3`, … */
export function numberedName(name: string, taken: readonly string[]): string {
  for (let n = 2; ; n++) {
    const candidate = `${name}-${n}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

/** Why a typed name will not do, in the line under the field, with the numbered name a clash offers. */
export function nameProblemOf(
  name: string,
  taken: readonly string[],
): {line: string; offer?: string} | undefined {
  if (name === '') return undefined;
  if (name.startsWith('.')) return {line: 'A name does not start with a dot.'};
  if (!NAME.test(name)) return {line: 'A name holds letters, digits, -, _ and . only.'};
  if (taken.includes(name)) {
    return {line: 'The folder already holds this name.', offer: numberedName(name, taken)};
  }
  return undefined;
}

const COUNTS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/** What a fixture saved from a turn will hold, in the save prompt's quiet line. */
export function savedTurnsLine(turns: number): string {
  if (turns <= 1) return '1 turn';
  const earlier = turns - 1;
  const count = COUNTS[earlier - 1] ?? String(earlier);
  return `${turns} turns, the earlier ${count} embedded`;
}

/** Whether a tool call event is one the pool would answer with, as the server's pool reads it. */
function isServableTool(event: OtherEvent): boolean {
  if (event.attributes['http.request.method'] === undefined) return false;
  if (event.kind === 4) return false;
  if (typeof event.attributes['mcp.method.name'] === 'string') {
    return event.attributes['jsonrpc.request.id'] !== undefined;
  }
  if (event.name === 'response' || event.name === 'DELETE') return false;
  return event.attributes['http.request.method'] !== undefined;
}

/** Whether a record holds nothing the proxies could serve, by the server's rule. */
export function hasNothingToServe(turns: readonly Turn[]): boolean {
  return !turns.some(turn =>
    turn.events.some(event => {
      // A call read from the agent's spans carries no exchange: nothing to serve.
      if (isModelCall(event)) return event.attributes['http.request.method'] !== undefined;
      return (
        event.attributes['a2ui.event.kind'] === 'tool_call' && isServableTool(event as OtherEvent)
      );
    }),
  );
}

/**
 * A record's estimated cost, each ended model call priced as the turn header's
 * second line prices it, the turns together. A call a replay served is priced
 * as well, its recorded tokens being what a request that changed could cost
 * again, so that the ceiling holds for a fixture saved from a replayed turn.
 */
export function recordedCostOf(
  turns: readonly Turn[],
  prices: Prices | undefined,
): number | undefined {
  const costs = turns.flatMap(turn =>
    callRowsOf(turn.events)
      .filter(row => row.kind === 'model' && timedEventOf(row).endTimeUnixNano !== undefined)
      .map(row => callCostOf(modelReadingOf(row).event, prices)),
  );
  const priced = costs.filter(cost => cost.kind === 'priced');
  return priced.length === 0 ? undefined : priced.reduce((sum, cost) => sum + cost.usd, 0);
}

/** A fixture's recorded cost in brief, once its record has been read, as the group's title line says it. */
export function recordedCostText(
  turns: readonly Turn[] | undefined,
  prices: Prices | undefined,
): string | undefined {
  if (turns === undefined) return undefined;
  if (hasNothingToServe(turns)) return 'nothing recorded';
  const cost = recordedCostOf(turns, prices);
  return cost === undefined ? undefined : formatCost(cost);
}

/** A row of the fixtures list: the turn in the listing's form, `traceId` naming the row. */
export interface FixtureRow extends ListedTurn {
  fixture: string;
  /** The turn's trace id in the record. */
  recorded: string;
}

/** A row's id: a fixture's turn, since the same turn can be in several fixtures. */
export function fixtureRowId(fixture: string, traceId: string): string {
  return `${traceId}:${fixture}`;
}

/** A group of the fixtures list. */
export interface FixtureGroup extends TurnGroup<FixtureRow> {
  name: string;
  savedAt: string;
  /** Why the file does not read as a turn record. */
  reason?: string;
  /** Its turn count and, once read, its recorded cost. */
  meta: string;
}

/** The list's groups: one per fixture, in the listing's order, its turns in order, its own turn last. */
export function fixtureGroupsOf(
  fixtures: readonly ListedFixture[],
  costOf: (name: string) => string | undefined,
): FixtureGroup[] {
  return fixtures.map(fixture => {
    const {name, savedAt, error} = fixture;
    if (fixture.turns === undefined) {
      return {
        key: name,
        name,
        savedAt,
        turns: [],
        problems: 0,
        reason: error ?? 'The file does not read as a turn record.',
        meta: 'Not a turn record',
      };
    }
    const turns = fixture.turns.map((turn): FixtureRow => ({
      ...turn,
      traceId: fixtureRowId(name, turn.traceId),
      fixture: name,
      recorded: turn.traceId,
    }));
    const cost = costOf(name);
    return {
      key: name,
      name,
      savedAt,
      turns,
      problems: turns.reduce((sum, turn) => sum + listedProblemCount(turn), 0),
      meta: [plural(turns.length, 'turn'), ...(cost === undefined ? [] : [cost])].join(' · '),
    };
  });
}

/** The search over names and inputs: a name keeps its whole group, an input its own row. */
export function searchFixtureGroups(
  groups: readonly FixtureGroup[],
  query: string,
): FixtureGroup[] {
  const words = query.trim().toLowerCase();
  if (words === '') return [...groups];
  const has = (text: string) => text.toLowerCase().includes(words);
  return groups.flatMap(group => {
    if (has(group.name)) return [group];
    const turns = group.turns.filter(turn => has(briefText(turn.input)));
    return turns.length === 0 ? [] : [{...group, turns}];
  });
}

/** One mode of the Replay popover. */
export interface ReplayRow {
  mode: 'recorded' | 'model_live';
  title: string;
  label: string;
  off: boolean;
  /** Why it is off, under its label: Re-run's note, the first that applies. */
  note?: string;
}

/** The popover's two rows, each with its cost label, disabled as the server would refuse them. */
export function replayRowsOf({
  nothingToServe,
  ceiling,
  note,
}: {
  nothingToServe: boolean;
  /** The record's recorded cost, when it is known. */
  ceiling: number | undefined;
  /** Why a replay would be refused, as Re-run's note says it; nothing when it would not. */
  note: string | undefined;
}): [ReplayRow, ReplayRow] {
  const refused = note === undefined ? {} : {note};
  const off = note !== undefined;
  return [
    {
      mode: 'recorded',
      title: 'Everything recorded',
      label: nothingToServe
        ? 'No model or tool calls were recorded'
        : 'Free · the model and the tools answer from the record',
      off: off || nothingToServe,
      ...refused,
    },
    {
      mode: 'model_live',
      title: 'Tools recorded, model live',
      label: nothingToServe
        ? 'Cost unknown · nothing recorded'
        : ceiling === undefined
          ? 'Cost unknown · a request that changed goes to the model'
          : `Up to ${formatCost(ceiling)} · a request that changed goes to the model`,
      off,
      ...refused,
    },
  ];
}

/** A file's modification time as the fixture line reads it, in the page's time zone. */
export function savedTimeOf(savedAt: string): string {
  const date = new Date(savedAt);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** What the fixture line says after the file: the turn count, the cost and when it was saved. */
export function fixtureLinePartsOf({
  turns,
  prices,
  saved,
}: {
  turns: readonly Turn[];
  prices: Prices | undefined;
  /** "saved 2026-11-05 14:02", or what stands in its place. */
  saved: string;
}): string[] {
  const recorded = recordedCostOf(turns, prices);
  const cost = hasNothingToServe(turns)
    ? 'nothing recorded to serve'
    : prices === undefined
      ? undefined
      : recorded === undefined
        ? 'recorded cost unknown'
        : `recorded ${formatCost(recorded)}`;
  return [plural(turns.length, 'turn'), ...(cost === undefined ? [] : [cost]), saved];
}
