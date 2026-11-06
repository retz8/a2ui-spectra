/**
 * The verdict on a replayed turn against the recorded one it stands for: it
 * passes when no call missed, its outcome is the recorded one and the A2UI
 * messages the agent sent equal the recorded ones by JSON value, in order.
 * The A2UI is compared as the flattened sequence, an array part contributing
 * its elements, so the wire form the agent chose does not count. A call
 * served from the record, an answer the protocol fixed and a live call are
 * all equal before the verdict; only a miss fails it.
 */
import {isDeepStrictEqual} from 'node:util';

import {agentMessages} from '../check/schema_check.js';
import {
  type CallEvent,
  isEventOfKind,
  type ReplayReason,
  type ReplayVerdict,
  type Turn,
  type TurnOutcome,
} from '../record/turn_record.js';

export interface Verdict {
  verdict: ReplayVerdict;
  /** Empty when the turn passed. */
  reasons: ReplayReason[];
}

/** The verdict on the replayed turn, against the recorded turn it stands for. */
export function verdictOf(recorded: Turn, replayed: Turn): Verdict {
  const reasons: ReplayReason[] = [
    ...misses(replayed),
    ...outcomeReason(recorded, replayed),
    ...a2uiReason(recorded, replayed),
  ];
  return {verdict: reasons.length === 0 ? 'passed' : 'failed', reasons};
}

function misses(turn: Turn): ReplayReason[] {
  return turn.events
    .filter(
      (event): event is CallEvent =>
        (isEventOfKind(event, 'model_call') || isEventOfKind(event, 'tool_call')) &&
        event.attributes['error.type'] === 'replay_miss',
    )
    .map(call => ({
      code: 'REPLAY_MISS' as const,
      message: `A ${isEventOfKind(call, 'model_call') ? 'model' : 'tool'} call matched nothing in the record: ${requestOf(call)}.`,
    }));
}

/** The call's method and target path, the query and its credentials left off. */
function requestOf(call: CallEvent): string {
  const method = call.attributes['http.request.method'];
  const url = call.attributes['url.full'];
  let pathname: string | undefined;
  if (typeof url === 'string') {
    try {
      pathname = new URL(url).pathname;
    } catch {
      pathname = url;
    }
  }
  return [method, pathname].filter(part => typeof part === 'string').join(' ');
}

function outcomeOf(turn: Turn): TurnOutcome | undefined {
  return turn.events.find(event => isEventOfKind(event, 'turn'))?.attributes['a2ui.turn.outcome'];
}

function outcomeReason(recorded: Turn, replayed: Turn): ReplayReason[] {
  const expected = outcomeOf(recorded);
  const actual = outcomeOf(replayed);
  if (expected === actual) return [];
  return [
    {
      code: 'OUTCOME_DIFFERS',
      message: `The turn ended ${inWords(actual)}; the record ended ${inWords(expected)}.`,
    },
  ];
}

function inWords(outcome: TurnOutcome | undefined): string {
  return outcome === undefined ? 'with no outcome' : outcome.replaceAll('_', ' ');
}

function a2uiReason(recorded: Turn, replayed: Turn): ReplayReason[] {
  const expected = agentMessages(recorded);
  const actual = agentMessages(replayed);
  const shared = Math.min(expected.length, actual.length);
  for (let index = 0; index < shared; index++) {
    if (!isDeepStrictEqual(expected[index].message, actual[index].message)) {
      return [
        {
          code: 'A2UI_DIFFERS',
          message: `The A2UI differs from the record: message ${index + 1} of ${actual.length} is not the recorded one.`,
          path: actual[index].path,
        },
      ];
    }
  }
  if (expected.length === actual.length) return [];
  const beyond = actual[expected.length];
  return [
    {
      code: 'A2UI_DIFFERS',
      message:
        `The A2UI differs from the record: this turn sent ${count(actual.length)}, ` +
        `the record sent ${expected.length}.`,
      ...(beyond !== undefined && {path: beyond.path}),
    },
  ];
}

function count(messages: number): string {
  return `${messages} message${messages === 1 ? '' : 's'}`;
}
