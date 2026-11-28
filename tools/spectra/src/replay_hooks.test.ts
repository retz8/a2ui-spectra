import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import type {TurnEvent, TurnRecord} from './record/turn_record.js';
import {ReplayPool} from './replay/pool.js';
import {replayHooks} from './replay_hooks.js';

const TURN_EVENT = {
  traceId: 'a'.repeat(32),
  spanId: 'b'.repeat(16),
  attributes: {'a2ui.event.kind': 'turn'},
} as TurnEvent;

function pool(): ReplayPool {
  return new ReplayPool(
    {version: 'v0.1', turns: [{events: [TURN_EVENT]}]} as TurnRecord,
    'recorded',
  );
}

/** A proxy that notes what it was told, and the pool it holds. */
function proxy(calls: string[], name: string) {
  const state: {pool: ReplayPool | undefined} = {pool: undefined};
  return {
    state,
    arm: (armed: ReplayPool) => {
      calls.push(`${name} armed`);
      state.pool = armed;
    },
    disarm: () => {
      calls.push(`${name} disarmed`);
      state.pool = undefined;
    },
  };
}

function setUp(keepArmed: boolean) {
  const calls: string[] = [];
  const modelProxy = proxy(calls, 'model');
  const toolProxy = proxy(calls, 'tool');
  const amended: Array<[string, TurnEvent[]]> = [];
  const lines: string[] = [];
  const hooks = replayHooks({
    modelProxy,
    toolProxy,
    keepArmed,
    recorder: {
      annotate: (traceId, attributes) =>
        calls.push(`annotated ${traceId} ${Object.keys(attributes)}`),
      amend: async traceId => (traceId === TURN_EVENT.traceId ? TURN_EVENT : undefined),
    },
    onAmended: (traceId, events) => amended.push([traceId, events as TurnEvent[]]),
    log: line => lines.push(line),
  });
  return {calls, modelProxy, toolProxy, amended, lines, hooks};
}

describe("the session's replay hooks", () => {
  it('arms both proxies with the pool, and disarms both when the replay ends', () => {
    const {calls, modelProxy, toolProxy, hooks} = setUp(false);
    const armed = pool();
    hooks.arm(armed);
    assert.equal(modelProxy.state.pool, armed);
    assert.equal(toolProxy.state.pool, armed);
    hooks.disarm();
    assert.equal(modelProxy.state.pool, undefined);
    assert.equal(toolProxy.state.pool, undefined);
    assert.deepEqual(calls, ['model armed', 'tool armed', 'model disarmed', 'tool disarmed']);
  });

  it("keeps both proxies armed with the ended replay's pool under a headless command, the tool proxy's carriers closed, so a later call is a miss and does not go out", () => {
    const {calls, modelProxy, toolProxy, hooks} = setUp(true);
    const first = pool();
    hooks.arm(first);
    hooks.disarm();
    assert.equal(modelProxy.state.pool, first, 'the model proxy still holds the pool');
    assert.equal(toolProxy.state.pool, first, 'the tool proxy holds the pool again');
    assert.deepEqual(calls, ['model armed', 'tool armed', 'tool disarmed', 'tool armed']);
    const second = pool();
    hooks.arm(second);
    assert.equal(modelProxy.state.pool, second);
    assert.equal(toolProxy.state.pool, second);
  });

  it('disarms nothing that was never armed, and works with no tool proxy', () => {
    const calls: string[] = [];
    const modelProxy = proxy(calls, 'model');
    const hooks = replayHooks({
      modelProxy,
      toolProxy: undefined,
      keepArmed: true,
      recorder: {annotate: () => {}, amend: async () => undefined},
      onAmended: () => {},
      log: () => {},
    });
    hooks.disarm();
    assert.deepEqual(calls, ['model disarmed']);
    const armed = pool();
    hooks.arm(armed);
    hooks.disarm();
    assert.equal(modelProxy.state.pool, armed);
  });

  it("writes a verdict through the recorder and tells the turn's amended event, and nothing for a turn not written", async () => {
    const {amended, hooks, lines, calls} = setUp(false);
    await hooks.amend(TURN_EVENT.traceId, {'a2ui.replay.verdict': 'passed'});
    await hooks.amend('f'.repeat(32), {'a2ui.replay.verdict': 'passed'});
    assert.deepEqual(amended, [[TURN_EVENT.traceId, [TURN_EVENT]]]);
    hooks.annotate(TURN_EVENT.traceId, {'a2ui.replay.mode': 'recorded'});
    hooks.log('a line');
    assert.deepEqual(calls, [`annotated ${TURN_EVENT.traceId} a2ui.replay.mode`]);
    assert.deepEqual(lines, ['a line']);
  });
});
