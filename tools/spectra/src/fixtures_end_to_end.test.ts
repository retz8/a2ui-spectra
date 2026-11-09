/**
 * The fixtures and replay end-to-end test: Spectra attached to the stub
 * agent's canned conversation, two turns sent through the message box, the
 * second saved as a fixture through the API, replayed with the model live and
 * passing, the fixture's recorded A2UI edited and replayed again, failing on
 * the message that differs, and the folder watched. It runs under Node by
 * default, and against the binary when SPECTRA_BINARY names one.
 */
import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {describe, it} from 'node:test';

import type {FixturesListing, SessionContext} from './api.js';
import type {ReplayStarted} from './message_box.js';
import {
  type A2uiPart,
  isEventOfKind,
  type Turn,
  type TurnEvent,
  type TurnRecord,
  type WireOutputEvent,
} from './record/turn_record.js';
import {boxSettled, getJson, LiveStream, postJson, sendMessage} from './testing/live_api.js';
import {binary, freePort, SpectraProcess, workingDir} from './testing/spectra_process.js';
import {startStub} from './testing/stub_agent.js';
import {turnRecordErrors} from './testing/turn_record_schema.js';

const TIMEOUT = 90_000;

function turnEventOf(turn: Turn): TurnEvent {
  const turnEvent = turn.events.find((event): event is TurnEvent => isEventOfKind(event, 'turn'));
  assert.ok(turnEvent);
  return turnEvent;
}

/** The record of a closed turn, read again until the replay's verdict has been written on it. */
async function recordWithVerdict(base: string, traceId: string): Promise<TurnRecord> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const {status, body} = await getJson<TurnRecord>(`${base}/api/turns/${traceId}`);
    if (status === 200) {
      const turn = body.turns.at(-1)!;
      if (turnEventOf(turn).attributes['a2ui.replay.verdict'] !== undefined) return body;
    }
    assert.ok(Date.now() < deadline, `The verdict was written on ${traceId}.`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

describe(`fixtures and replay against the stub agent, ${binary ? 'the binary' : 'under Node'}`, () => {
  it(
    'saves a turn as a fixture through the API, replays it with the model live and passes, then fails on edited A2UI naming the message',
    {timeout: TIMEOUT},
    async () => {
      const [agentPort, port, proxyPort, modelProxyPort, receiverPort] = await Promise.all([
        freePort(),
        freePort(),
        freePort(),
        freePort(),
        freePort(),
      ]);
      const stub = await startStub(agentPort, []);
      const cwd = workingDir();
      writeFileSync(
        path.join(cwd, 'a2ui-spectra.json'),
        JSON.stringify({agent: {url: `http://127.0.0.1:${agentPort}`}, fixtures: './fixtures'}),
      );
      const spectra = new SpectraProcess(
        [
          'attach',
          '--port',
          String(port),
          '--proxy-port',
          String(proxyPort),
          '--model-proxy-port',
          String(modelProxyPort),
          '--receiver-port',
          String(receiverPort),
          '--no-open',
        ],
        cwd,
      );
      const base = `http://127.0.0.1:${port}`;
      let live: LiveStream | undefined;
      try {
        await spectra.waitFor(/The viewer is at /);
        await spectra.waitFor(/Fixtures are saved in \S+\/fixtures\n/);
        const {body: context} = await getJson<SessionContext>(`${base}/api/context`);
        assert.equal(context.fixturesFolder, 'fixtures');
        live = new LiveStream(`${base}/api/stream`);
        await live.ready;

        // Two turns: the stub asks for a name and waits, then greets it and completes.
        const first = await sendMessage(base, 'Hi');
        await live.closed(first.traceId);
        const {conversationId} = (await boxSettled(base)).conversations[0];
        assert.ok(conversationId);
        const second = await sendMessage(base, 'Ada', conversationId);
        await live.closed(second.traceId);
        await boxSettled(base);

        // Saved as a fixture, whole, the earlier turn embedded; the folder appears and the stream says so.
        const saved = await postJson<{name: string; path: string}>(`${base}/api/fixtures`, {
          traceId: second.traceId,
          name: 'greet-ada',
        });
        assert.equal(saved.status, 201, JSON.stringify(saved.body));
        assert.deepEqual(saved.body, {
          name: 'greet-ada',
          path: path.join('fixtures', 'greet-ada.json'),
        });
        const file = path.join(cwd, 'fixtures', 'greet-ada.json');
        const fixture = JSON.parse(readFileSync(file, 'utf8')) as TurnRecord;
        assert.deepEqual(
          fixture,
          (await getJson<TurnRecord>(`${base}/api/turns/${second.traceId}`)).body,
        );
        assert.deepEqual(
          fixture.turns.map(turn => turnEventOf(turn).traceId),
          [first.traceId, second.traceId],
        );
        await live.until(event => event.event === 'fixtures_changed');
        const {body: listing} = await getJson<FixturesListing>(`${base}/api/fixtures`);
        assert.equal(listing.folder, 'fixtures');
        assert.deepEqual(
          listing.fixtures.map(entry => [entry.name, entry.turns?.map(turn => turn.input)]),
          [['greet-ada', [{text: 'Hi'}, {text: 'Ada'}]]],
        );

        // Everything recorded has nothing to serve; the model live replays, and passes.
        const nothing = await postJson<{error: string}>(`${base}/api/replays`, {
          source: {fixture: 'greet-ada'},
          mode: 'recorded',
        });
        assert.equal(nothing.status, 422);
        assert.match(nothing.body.error, /nothing to serve/);
        const started = await postJson<ReplayStarted>(`${base}/api/replays`, {
          source: {fixture: 'greet-ada'},
          mode: 'model_live',
        });
        assert.equal(started.status, 202, JSON.stringify(started.body));
        assert.equal(started.body.turns, 2);
        const end = await live.until(event => event.event === 'replay_ended');
        const replayEvents = live.events.filter(event => event.event.startsWith('replay_'));
        assert.deepEqual(
          replayEvents.map(event => event.event),
          ['replay_started', 'replay_turn', 'replay_turn', 'replay_ended'],
        );
        assert.deepEqual(replayEvents[0].data, {
          source: path.join('fixtures', 'greet-ada.json'),
          mode: 'model_live',
          turns: 2,
        });
        assert.deepEqual(replayEvents[1].data, {
          traceId: started.body.traceId,
          recordedTurn: first.traceId,
          turn: 1,
          turns: 2,
        });
        assert.equal(end.data.verdict, 'passed');
        const replayed = end.data.turns as Array<{
          traceId: string;
          recordedTurn: string;
          verdict: string;
        }>;
        assert.deepEqual(
          replayed.map(turn => [turn.recordedTurn, turn.verdict]),
          [
            [first.traceId, 'passed'],
            [second.traceId, 'passed'],
          ],
        );
        // The stream's event can arrive before Spectra's terminal line is read: wait for the line.
        await spectra.waitFor(/Replay of fixtures\/greet-ada\.json, turn 2 of 2: passed\./);

        // Each replayed turn's record carries the provenance and the verdict, and validates.
        for (const [index, turn] of replayed.entries()) {
          const record = await recordWithVerdict(base, turn.traceId);
          assert.deepEqual(turnRecordErrors(record), []);
          const attributes = turnEventOf(record.turns.at(-1)!).attributes;
          assert.equal(attributes['a2ui.replay.source'], path.join('fixtures', 'greet-ada.json'));
          assert.equal(attributes['a2ui.replay.turn'], [first.traceId, second.traceId][index]);
          assert.equal(attributes['a2ui.replay.mode'], 'model_live');
          assert.equal(attributes['a2ui.replay.verdict'], 'passed');
          assert.equal(attributes['a2ui.replay.reasons'], undefined);
          assert.notEqual(
            attributes['gen_ai.conversation.id'],
            conversationId,
            'A new conversation.',
          );
        }
        // The second replayed turn completed only because the stub got its own task's id back.
        const secondReplayed = await getJson<TurnRecord>(
          `${base}/api/turns/${replayed[1].traceId}`,
        );
        assert.equal(
          turnEventOf(secondReplayed.body.turns.at(-1)!).attributes['a2ui.turn.outcome'],
          'completed',
        );
        assert.equal(secondReplayed.body.turns.length, 2);
        const settled = await boxSettled(base);
        assert.equal(settled.conversations.length, 2);
        assert.deepEqual(
          settled.conversations[1].turns,
          replayed.map(turn => turn.traceId),
        );

        // The fixture's recorded A2UI edited by hand: the replay fails, naming the message.
        const edited = structuredClone(fixture);
        const part = edited.turns[1].events
          .filter((event): event is WireOutputEvent => isEventOfKind(event, 'wire_output'))
          .flatMap(event => event.attributes['a2ui.wire.message'].parts)
          .find((candidate): candidate is A2uiPart => candidate.type === 'a2ui');
        assert.ok(part, 'The second turn carries A2UI.');
        const messages = Array.isArray(part.content) ? (part.content as unknown[]) : [part.content];
        (messages[0] as {updateDataModel: {value: string}}).updateDataModel.value = 'Hello, Grace!';
        part.content = Array.isArray(part.content) ? messages : messages[0];
        writeFileSync(file, JSON.stringify(edited));
        const again = await postJson<ReplayStarted>(`${base}/api/replays`, {
          source: {fixture: 'greet-ada'},
          mode: 'model_live',
        });
        assert.equal(again.status, 202, JSON.stringify(again.body));
        const failed = await live.until(event => event.event === 'replay_ended' && event !== end);
        assert.equal(failed.data.verdict, 'failed');
        const failedTurns = failed.data.turns as Array<{traceId: string; verdict: string}>;
        assert.deepEqual(
          failedTurns.map(turn => turn.verdict),
          ['passed', 'failed'],
        );
        const failedRecord = await recordWithVerdict(base, failedTurns[1].traceId);
        const reasons = turnEventOf(failedRecord.turns.at(-1)!).attributes['a2ui.replay.reasons'];
        assert.equal(reasons?.length, 1);
        assert.equal(reasons?.[0].code, 'A2UI_DIFFERS');
        assert.equal(
          reasons?.[0].message,
          'The A2UI differs from the record: message 1 of 1 is not the recorded one.',
        );
        assert.match(
          reasons?.[0].path ?? '',
          /^\/events\/\d+\/attributes\/a2ui\.wire\.message\/parts\/\d+\/content(\/0)?$/,
        );
        assert.deepEqual(turnRecordErrors(failedRecord), []);
        await spectra.waitFor(/turn 2 of 2: failed \(The A2UI differs from the record/);

        // A file dropped into a nested folder shows at once.
        mkdirSync(path.join(cwd, 'fixtures', 'nested'));
        const seen = live.events.filter(event => event.event === 'fixtures_changed').length;
        writeFileSync(path.join(cwd, 'fixtures', 'nested', 'copy.json'), JSON.stringify(fixture));
        await live.until(
          () => live!.events.filter(event => event.event === 'fixtures_changed').length > seen,
        );
        const {body: nested} = await getJson<FixturesListing>(`${base}/api/fixtures`);
        assert.deepEqual(
          nested.fixtures.map(entry => entry.name),
          ['greet-ada', 'nested/copy'],
        );
      } finally {
        live?.close();
        spectra.signal('SIGTERM');
        await spectra.exited;
        stub.kill();
      }
    },
  );
});
