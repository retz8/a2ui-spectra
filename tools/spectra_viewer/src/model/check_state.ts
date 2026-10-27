/**
 * What the turn's header says of its checks: the problem count when there
 * are problems; otherwise that there are none, that there are none but a
 * check skipped a surface, or that the turn was not checked and why. Each
 * check is listed in the checks' order with its protocol version and its
 * result, and the surfaces it skipped with the reason, as the design canvas
 * draws the rows.
 */
import {agentMessages} from './messages.ts';
import {
  type CheckEvent,
  type CheckName,
  isCheck,
  type SkippedSurface,
  type Turn,
} from './record.ts';
import {plural} from './steps.ts';
import {schemaCheckOf} from './summary.ts';

export type CheckState =
  | {state: 'problems'; count: number}
  | {state: 'clean'}
  /** No problems, but a check skipped a surface it could not judge. */
  | {state: 'partial'}
  | {state: 'unchecked'; reason: string};

/** A run of a check line's result, in monospace when it is an id. */
export interface TextRun {
  text: string;
  mono?: boolean;
}

/** One check, as the header's tooltip lists it. */
export interface CheckLine {
  name: string;
  version: string;
  result: TextRun[];
  /** Monospace lines under the row: the catalog ids with no definition. */
  notes: string[];
}

const ORDER: readonly CheckName[] = ['schema', 'catalog', 'structural', 'binding'];

export function checkStateOf(turn: Turn, problems: number): CheckState {
  if (problems > 0) return {state: 'problems', count: problems};
  const schema = schemaCheckOf(turn);
  if (schema.state === 'no_a2ui') return {state: 'unchecked', reason: 'no A2UI in this turn'};
  if (schema.state === 'none') return {state: 'unchecked', reason: 'no schema check'};
  const skipped = turn.events.some(
    event => isCheck(event) && (event.attributes['a2ui.check.skipped']?.length ?? 0) > 0,
  );
  return skipped ? {state: 'partial'} : {state: 'clean'};
}

export function checkLinesOf(turn: Turn): CheckLine[] {
  const checks = turn.events
    .filter(isCheck)
    .sort(
      (a, b) =>
        ORDER.indexOf(a.attributes['a2ui.check.name']) -
        ORDER.indexOf(b.attributes['a2ui.check.name']),
    );
  if (checks.length === 0) {
    return [
      {
        name: 'Schema check',
        version: '',
        result: [{text: 'Not run: the turn names no A2UI version'}],
        notes: [],
      },
    ];
  }
  const messages = agentMessages(turn.events);
  const touched = new Set(messages.flatMap(({message}) => surfaceIdsOf(message)));
  return checks.map(check => lineOf(check, messages.length === 0, touched));
}

function lineOf(check: CheckEvent, noA2ui: boolean, touched: ReadonlySet<string>): CheckLine {
  const {attributes} = check;
  const findings = attributes['a2ui.check.findings'].length;
  const skipped = attributes['a2ui.check.skipped'] ?? [];
  const allSkipped =
    skipped.length > 0 && [...touched].every(id => skipped.some(entry => entry.surfaceId === id));
  const result: TextRun[] = [];
  if (!allSkipped) {
    result.push({
      text:
        findings > 0
          ? plural(findings, 'finding')
          : noA2ui
            ? 'Passed, with no A2UI from the agent'
            : 'Passed',
    });
  }
  const notes: string[] = [];
  for (const [reason, entries] of groupedByReason(skipped)) {
    if (result.length > 0) result.push({text: ' · '});
    if (allSkipped) {
      result.push({text: 'Not checked'});
    } else {
      result.push({text: 'not checked for '});
      entries.forEach((entry, index) => {
        if (index > 0) result.push({text: ', '});
        result.push({text: entry.surfaceId, mono: true});
      });
    }
    result.push({text: ` · ${reason}`});
    for (const entry of entries) {
      if (
        entry.reason === 'no_definition' &&
        entry.catalogId !== undefined &&
        !notes.includes(entry.catalogId)
      ) {
        notes.push(entry.catalogId);
      }
    }
  }
  return {
    name: `${capitalized(attributes['a2ui.check.name'])} check`,
    version: allSkipped ? '' : `A2UI ${attributes['a2ui.check.protocol_version']}`,
    result,
    notes,
  };
}

/** The skipped entries grouped by their reason's wording, in order of first appearance. */
function groupedByReason(skipped: readonly SkippedSurface[]): Array<[string, SkippedSurface[]]> {
  const groups = new Map<string, SkippedSurface[]>();
  for (const entry of skipped) {
    const reason = reasonOf(entry);
    const group = groups.get(reason);
    if (group === undefined) groups.set(reason, [entry]);
    else group.push(entry);
  }
  return [...groups];
}

function reasonOf(entry: SkippedSurface): string {
  if (entry.reason === 'not_created') return 'surface never created';
  return entry.catalogId === undefined ? 'no catalog named' : 'no definition for catalog';
}

/** The surface ids an A2UI message names. */
function surfaceIdsOf(message: unknown): string[] {
  if (typeof message !== 'object' || message === null) return [];
  const ids: string[] = [];
  for (const [key, value] of Object.entries(message as Record<string, unknown>)) {
    if (key === 'version' || typeof value !== 'object' || value === null) continue;
    const surfaceId = (value as {surfaceId?: unknown}).surfaceId;
    if (typeof surfaceId === 'string') ids.push(surfaceId);
  }
  return ids;
}

function capitalized(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
