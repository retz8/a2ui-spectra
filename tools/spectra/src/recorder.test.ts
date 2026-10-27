import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {after, describe, it} from 'node:test';

import type {Output} from './output.js';
import {
  type CheckEvent,
  isEventOfKind,
  type Turn,
  type TurnEvent,
  type WirePart,
} from './record/turn_record.js';
import {TurnRecorder} from './recorder.js';
import {TurnStore} from './store/store.js';
import {turnRecordErrors} from './testing/turn_record_schema.js';

const dirs: string[] = [];
after(() => {
  for (const dir of dirs) rmSync(dir, {recursive: true, force: true});
});

async function storeIn(): Promise<TurnStore> {
  const dir = mkdtempSync(path.join(tmpdir(), 'spectra-recorder-'));
  dirs.push(dir);
  return TurnStore.open(dir);
}

function collect(): Output & {errors: string[]} {
  const errors: string[] = [];
  return {errors, print: () => {}, info: () => {}, error: line => errors.push(line)};
}

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
const TURN_SPAN = 'b7ad6b7169203331';

/** A closed turn whose one wire output carries the parts. */
function turnOf(parts: WirePart[], version?: string): Turn {
  const turnEvent: TurnEvent = {
    traceId: TRACE_ID,
    spanId: TURN_SPAN,
    name: 'invoke_agent',
    kind: 3,
    startTimeUnixNano: '1792576860000000000',
    endTimeUnixNano: '1792576861000000000',
    attributes: {
      'a2ui.event.kind': 'turn',
      'gen_ai.operation.name': 'invoke_agent',
      'gen_ai.conversation.id': 'ctx-1',
      'a2ui.turn.outcome': 'completed',
      ...(version !== undefined && {'a2ui.turn.protocol_version': version}),
      'a2ui.turn.capture_paths': ['wire'],
      'a2ui.turn.writer.name': 'a2ui-spectra',
      'a2ui.turn.writer.version': '0.0.1',
    },
    status: {code: 1},
  };
  return {
    events: [
      turnEvent,
      {
        traceId: TRACE_ID,
        spanId: '0000000000000001',
        parentSpanId: TURN_SPAN,
        name: 'wire_output',
        kind: 1,
        startTimeUnixNano: '1792576860500000000',
        attributes: {
          'a2ui.event.kind': 'wire_output',
          'a2ui.wire.message': {role: 'assistant', parts},
        },
      },
    ],
  };
}

const SURFACE: WirePart = {
  type: 'a2ui',
  content: {version: 'v0.9', createSurface: {surfaceId: 's1', catalogId: 'basic'}},
};

describe('the turn recorder', () => {
  it('writes each closed turn with its four check events', async () => {
    const store = await storeIn();
    const recorder = new TurnRecorder(store, collect(), {
      now: () => 1792576862000000000n,
      newSpanId: () => 'cccccccccccccccc',
    });
    recorder.onTurn({
      type: 'turn_opened',
      traceId: TRACE_ID,
      conversationId: 'ctx-1',
      startTimeUnixNano: '1792576860000000000',
    });
    recorder.onTurn({type: 'turn_closed', traceId: TRACE_ID, turn: turnOf([SURFACE])});
    await recorder.idle();

    const [stored] = await store.list();
    const record = await store.read(stored.file);
    assert.deepEqual(turnRecordErrors(record), []);
    const checks = record.turns[0].events.filter((event): event is CheckEvent =>
      isEventOfKind(event, 'check'),
    );
    assert.deepEqual(
      checks.map(check => check.attributes['a2ui.check.name']),
      ['schema', 'catalog', 'structural', 'binding'],
    );
    const [check] = checks;
    assert.equal(check.spanId, 'cccccccccccccccc');
    assert.equal(check.parentSpanId, TURN_SPAN);
    assert.equal(check.startTimeUnixNano, '1792576862000000000');
    assert.equal(check.attributes['a2ui.check.passed'], true);
    assert.equal(check.attributes['a2ui.check.protocol_version'], 'v0.9');
  });

  it("checks a turn after the conversation's earlier turns, read from the store", async () => {
    const store = await storeIn();
    const recorder = new TurnRecorder(store, collect());
    const second: Turn = {
      events: turnOf([
        {
          type: 'a2ui',
          content: {
            version: 'v0.9',
            updateComponents: {
              surfaceId: 's1',
              components: [{id: 'root', component: 'Text', text: 'Hi'}],
            },
          },
        },
      ]).events.map(event => ({...event, traceId: '1af7651916cd43dd8448eb211c80319c'})),
    };
    (second.events[0] as TurnEvent).startTimeUnixNano = '1792576870000000000';
    (second.events[0] as TurnEvent).endTimeUnixNano = '1792576871000000000';
    recorder.onTurn({type: 'turn_closed', traceId: TRACE_ID, turn: turnOf([SURFACE])});
    recorder.onTurn({type: 'turn_closed', traceId: second.events[0].traceId, turn: second});
    await recorder.idle();
    const [latest] = await store.list();
    const record = await store.read(latest.file);
    assert.equal(record.turns.length, 2);
    const structural = record.turns[1].events.find(
      (event): event is CheckEvent =>
        isEventOfKind(event, 'check') && event.attributes['a2ui.check.name'] === 'structural',
    );
    // The surface the first turn created is known, so the second turn's update is no surface never
    // created; its catalog id has no definition, so the surface is skipped rather than walked.
    assert.deepEqual(structural?.attributes['a2ui.check.findings'], []);
    assert.deepEqual(structural?.attributes['a2ui.check.skipped'], [
      {surfaceId: 's1', catalogId: 'basic', reason: 'no_definition'},
    ]);
  });

  it('writes a turn with no protocol version without a check event', async () => {
    const store = await storeIn();
    const recorder = new TurnRecorder(store, collect());
    recorder.onTurn({
      type: 'turn_closed',
      traceId: TRACE_ID,
      turn: turnOf([{type: 'text', content: 'Hello'}]),
    });
    await recorder.idle();
    const [stored] = await store.list();
    const record = await store.read(stored.file);
    assert.equal(
      record.turns[0].events.some(event => isEventOfKind(event, 'check')),
      false,
    );
  });

  it('is idle only once every open turn has closed and been written', async () => {
    const store = await storeIn();
    const recorder = new TurnRecorder(store, collect());
    recorder.onTurn({
      type: 'turn_opened',
      traceId: TRACE_ID,
      startTimeUnixNano: '1792576860000000000',
    });
    let idle = false;
    const waiting = recorder.idle().then(() => (idle = true));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(idle, false);

    recorder.onTurn({type: 'turn_closed', traceId: TRACE_ID, turn: turnOf([SURFACE])});
    await waiting;
    assert.equal((await store.list()).length, 1);
  });

  it('reports a failed write, naming the file, and keeps the turn for this run', async () => {
    const store = await storeIn();
    writeFileSync(path.join(store.turnsDir, 'ctx-1'), 'not a folder');
    const out = collect();
    const recorder = new TurnRecorder(store, out);
    recorder.onTurn({type: 'turn_closed', traceId: TRACE_ID, turn: turnOf([SURFACE])});
    await recorder.idle();

    assert.equal(out.errors.length, 1);
    assert.match(out.errors[0], /^Spectra could not write .*ctx-1.*\.json: /);
    assert.match(out.errors[0], /The turn is kept in memory until Spectra stops\.$/);
    assert.equal((await store.list()).length, 1);
  });

  it('hands on each checked turn once its write has finished', async () => {
    const store = await storeIn();
    const recorded: Array<{turn: Turn; files: number}> = [];
    const recorder = new TurnRecorder(store, collect(), {
      onRecorded: turn => {
        void store.list().then(listed => recorded.push({turn, files: listed.length}));
      },
    });
    recorder.onTurn({type: 'turn_closed', traceId: TRACE_ID, turn: turnOf([SURFACE])});
    await recorder.idle();
    await new Promise(resolve => setTimeout(resolve, 20));

    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].files, 1);
    assert.ok(isEventOfKind(recorded[0].turn.events.at(-1)!, 'check'));
    const [stored] = await store.list();
    const record = await store.read(stored.file);
    assert.deepEqual(record.turns.at(-1), recorded[0].turn);
  });

  it('hands on a checked turn whose write failed', async () => {
    const store = await storeIn();
    writeFileSync(path.join(store.turnsDir, 'ctx-1'), 'not a folder');
    const recorded: Turn[] = [];
    const recorder = new TurnRecorder(store, collect(), {onRecorded: turn => recorded.push(turn)});
    recorder.onTurn({type: 'turn_closed', traceId: TRACE_ID, turn: turnOf([SURFACE])});
    await recorder.idle();

    assert.equal(recorded.length, 1);
    assert.ok(isEventOfKind(recorded[0].events.at(-1)!, 'check'));
  });
});
