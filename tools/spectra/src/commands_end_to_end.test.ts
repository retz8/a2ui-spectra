/**
 * The commands end-to-end test: `a2ui-spectra replay` and `a2ui-spectra test`
 * on the stub agent's canned conversation, saved as a fixture through a
 * viewer session's API, then replayed headless with the agent already
 * running and with the agent launched; a record with nothing to serve
 * refused with everything recorded; the fixtures folder tested. It runs
 * under Node by default, and against the binary when SPECTRA_BINARY names
 * one.
 */
import assert from 'node:assert/strict';
import {mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

import {
  type CallEvent,
  isEventOfKind,
  type ModelCallEvent,
  type Turn,
  type TurnEvent,
  type TurnRecord,
} from './record/turn_record.js';
import {boxSettled, getJson, LiveStream, postJson, sendMessage} from './testing/live_api.js';
import {binary, finished, SpectraProcess, workingDir} from './testing/spectra_process.js';
import {startStandIn} from './testing/stand_in_provider.js';
import {startStub, stubScript} from './testing/stub_agent.js';
import {startToolServer} from './testing/tool_server.js';
import {freePort} from './testing/free_port.js';

const restaurantFinderHar = fileURLToPath(
  new URL(
    '../../../conformance/test_data/model_capture/v0_1/gemini/restaurant_finder_google_genai.har',
    import.meta.url,
  ),
);
const TIMEOUT = 180_000;

/** The variable the stub reads its tool server's URL from, in its model-calling mode. */
const TOOL_SERVER_VARIABLE = 'SPECTRA_STUB_TOOL_SERVER_URL';
const GEMINI_PATH = '/v1beta/models/gemini-3.6-flash:streamGenerateContent';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const NOTHING_TO_SERVE =
  'The record holds no model call and no tool call, so there is nothing to serve with everything recorded.';

function turnEventOf(turn: TurnRecord['turns'][number]): TurnEvent {
  const turnEvent = turn.events.find((event): event is TurnEvent => isEventOfKind(event, 'turn'));
  assert.ok(turnEvent);
  return turnEvent;
}

/** Records a two-turn conversation with the canned stub through a viewer session, saved as the fixture `greet-ada`. */
async function recordFixture(cwd: string): Promise<{first: string; second: string}> {
  const [port, proxyPort, modelProxyPort, receiverPort] = await Promise.all([
    freePort(),
    freePort(),
    freePort(),
    freePort(),
  ]);
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
    live = new LiveStream(`${base}/api/stream`);
    await live.ready;
    const first = await sendMessage(base, 'Hi');
    await live.closed(first.traceId);
    const {conversationId} = (await boxSettled(base)).conversations[0];
    assert.ok(conversationId);
    const second = await sendMessage(base, 'Ada', conversationId);
    await live.closed(second.traceId);
    await boxSettled(base);
    const saved = await postJson<{name: string; path: string}>(`${base}/api/fixtures`, {
      traceId: second.traceId,
      name: 'greet-ada',
    });
    assert.equal(saved.status, 201, JSON.stringify(saved.body));
    return {first: first.traceId, second: second.traceId};
  } finally {
    live?.close();
    spectra.signal('SIGTERM');
    await spectra.exited;
  }
}

/** The port options a headless command takes, on free ports. */
async function portOptions(): Promise<string[]> {
  const [proxyPort, modelProxyPort, receiverPort] = await Promise.all([
    freePort(),
    freePort(),
    freePort(),
  ]);
  return [
    '--proxy-port',
    String(proxyPort),
    '--model-proxy-port',
    String(modelProxyPort),
    '--receiver-port',
    String(receiverPort),
  ];
}

function callsOf(turn: Turn): CallEvent[] {
  return turn.events.filter(
    (event): event is CallEvent =>
      isEventOfKind(event, 'model_call') || isEventOfKind(event, 'tool_call'),
  );
}

function modelCallsOf(turn: Turn): ModelCallEvent[] {
  return turn.events.filter((event): event is ModelCallEvent => isEventOfKind(event, 'model_call'));
}

/** The system instruction text a Gemini request carries, read from the exchange's body. */
function systemInstructionOf(call: ModelCallEvent): string | undefined {
  const body = call.attributes['a2ui.http.request.body'] as
    {systemInstruction?: {parts?: Array<{text?: string}>}} | undefined;
  return body?.systemInstruction?.parts?.[0]?.text;
}

/** The records in a conversation folder of the store, oldest first. */
function recordsIn(cwd: string, folder: string): TurnRecord[] {
  const dir = path.join(cwd, folder);
  return readdirSync(dir)
    .sort()
    .map(name => JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as TurnRecord);
}

describe(`replay and test from the terminal, ${binary ? 'the binary' : 'under Node'}`, () => {
  it(
    'replays a fixture with the model live against the running agent and the launched agent, and refuses everything recorded with nothing to serve',
    {timeout: TIMEOUT},
    async () => {
      const agentPort = await freePort();
      const stub = await startStub(agentPort, []);
      const cwd = workingDir();
      writeFileSync(
        path.join(cwd, 'a2ui-spectra.json'),
        JSON.stringify({agent: {url: `http://127.0.0.1:${agentPort}`}, fixtures: './fixtures'}),
      );
      try {
        const recorded = await recordFixture(cwd);
        const fixture = path.join('fixtures', 'greet-ada.json');

        // The agent already running: the record passes, the result lines alone on stdout.
        const live = await finished(
          ['replay', fixture, '--model-live', ...(await portOptions())],
          cwd,
        );
        assert.equal(live.code, 0, live.output);
        const closing = live.stdout.match(
          /^turn 1 of 2: passed\nturn 2 of 2: passed\nfixtures\/greet-ada\.json: passed; the replayed turns are in (\.a2ui-spectra\/turns\/\S+)\n$/,
        );
        assert.ok(closing, `stdout was:\n${live.stdout}`);
        assert.match(
          live.stderr,
          /a2ui-spectra: Replay of fixtures\/greet-ada\.json, turn 2 of 2: passed\./,
        );
        assert.match(live.stderr, /a2ui-spectra: Turns are saved in /);
        assert.doesNotMatch(live.output, /The viewer is at/);
        assert.doesNotMatch(live.output, /export GOOGLE_GEMINI_BASE_URL/);
        const records = recordsIn(cwd, closing[1]);
        assert.equal(records.length, 2);
        for (const [index, record] of records.entries()) {
          const attributes = turnEventOf(record.turns.at(-1)!).attributes;
          assert.equal(attributes['a2ui.replay.source'], 'fixtures/greet-ada.json');
          assert.equal(attributes['a2ui.replay.turn'], [recorded.first, recorded.second][index]);
          assert.equal(attributes['a2ui.replay.mode'], 'model_live');
          assert.equal(attributes['a2ui.replay.verdict'], 'passed');
        }

        // Live: each turn's outcome where a verdict sits, every turn sent, and no verdict written.
        const outcomes = (
          JSON.parse(readFileSync(path.join(cwd, fixture), 'utf8')) as TurnRecord
        ).turns.map(turn =>
          String(turnEventOf(turn).attributes['a2ui.turn.outcome']).replaceAll('_', ' '),
        );
        const allLive = await finished(
          ['replay', fixture, '--live', ...(await portOptions())],
          cwd,
        );
        assert.equal(allLive.code, 0, allLive.output);
        const liveClosing = allLive.stdout.match(
          new RegExp(
            `^turn 1 of 2: ${outcomes[0]}\\nturn 2 of 2: ${outcomes[1]}\\n` +
              'fixtures/greet-ada\\.json: 2 of 2 turns sent; the replayed turns are in (\\.a2ui-spectra/turns/\\S+)\\n$',
          ),
        );
        assert.ok(liveClosing, `stdout was:\n${allLive.stdout}`);
        const liveRecords = recordsIn(cwd, liveClosing[1]);
        assert.equal(liveRecords.length, 2);
        for (const record of liveRecords) {
          const attributes = turnEventOf(record.turns.at(-1)!).attributes;
          assert.equal(attributes['a2ui.replay.source'], 'fixtures/greet-ada.json');
          assert.equal(attributes['a2ui.replay.mode'], 'live');
          assert.equal(attributes['a2ui.replay.verdict'], undefined);
        }

        // --live beside --model-live: a usage error, before the agent is reached.
        const both = await finished(
          ['replay', fixture, '--live', '--model-live', ...(await portOptions())],
          cwd,
        );
        assert.equal(both.code, 2, both.output);
        assert.equal(both.stdout, '');
        assert.match(both.stderr, /--live and --model-live cannot be given together/);

        // Everything recorded on a record with nothing to serve: refused before the agent is reached.
        const nothing = await finished(['replay', fixture, ...(await portOptions())], cwd);
        assert.equal(nothing.code, 1, nothing.output);
        assert.equal(
          nothing.stdout,
          `fixtures/greet-ada.json: failed (${NOTHING_TO_SERVE} Replay it with --model-live.)\n`,
        );
        assert.doesNotMatch(nothing.stderr, /Turns are saved in|Waiting for the agent's card/);

        // The fixtures folder tested: the one fixture fails for the same reason.
        const tested = await finished(['test', ...(await portOptions())], cwd);
        assert.equal(tested.code, 1, tested.output);
        assert.equal(
          tested.stdout,
          `greet-ada: failed (${NOTHING_TO_SERVE})\n1 fixture: 0 passed, 1 failed\n`,
        );
        assert.match(tested.stderr, /a2ui-spectra: Turns are saved in /);

        // The agent launched: its own output goes to stderr with the status lines.
        const launchedPort = await freePort();
        const launched = await finished(
          [
            'replay',
            fixture,
            '--model-live',
            '--agent-url',
            `http://127.0.0.1:${launchedPort}`,
            ...(await portOptions()),
            '--',
            process.execPath,
            stubScript,
            '--canned-a2ui',
            '--port',
            String(launchedPort),
          ],
          cwd,
        );
        assert.equal(launched.code, 0, launched.output);
        assert.match(
          launched.stdout,
          /^turn 1 of 2: passed\nturn 2 of 2: passed\nfixtures\/greet-ada\.json: passed; the replayed turns are in \.a2ui-spectra\/turns\/\S+\n$/,
        );
        assert.match(
          launched.stderr,
          new RegExp(`Spectra stub agent at http://127\\.0\\.0\\.1:${launchedPort}`),
        );

        // The box cannot send: a configured header's variable is not set.
        writeFileSync(
          path.join(cwd, 'a2ui-spectra.json'),
          JSON.stringify({
            agent: {
              url: `http://127.0.0.1:${agentPort}`,
              headers: {Authorization: 'Bearer ${SPECTRA_TEST_TOKEN}'},
            },
            fixtures: './fixtures',
          }),
        );
        const unset = await finished(
          ['replay', fixture, '--model-live', ...(await portOptions())],
          cwd,
        );
        assert.equal(unset.code, 1, unset.output);
        assert.equal(unset.stdout, '');
        assert.match(unset.stderr, /SPECTRA_TEST_TOKEN is not set/);
        assert.doesNotMatch(unset.stderr, /Replay of /);
      } finally {
        stub.kill();
      }
    },
  );

  it(
    'records a model-calling conversation against the stand-in, replays it for free with the stand-in stopped, sees the miss after a prompt change, and tests the folder in both agent forms',
    {timeout: TIMEOUT},
    async () => {
      const [standInPort, toolServerPort] = await Promise.all([freePort(), freePort()]);
      const standIn = await startStandIn(standInPort, [restaurantFinderHar]);
      const toolServer = await startToolServer(toolServerPort);
      const cwd = workingDir();
      const env = {
        GOOGLE_GEMINI_BASE_URL: standIn.origin,
        SPECTRA_PROVIDER_STAND_IN: standIn.origin,
      };
      const writeConfig = (agentPort: number) =>
        writeFileSync(
          path.join(cwd, 'a2ui-spectra.json'),
          JSON.stringify({
            agent: {url: `http://127.0.0.1:${agentPort}`},
            fixtures: './fixtures',
            tools: [{variable: TOOL_SERVER_VARIABLE, url: `${toolServer.origin}/mcp`}],
          }),
        );
      const launch = (agentPort: number, flags: string[] = []) => [
        '--',
        process.execPath,
        stubScript,
        '--model-calling',
        '--port',
        String(agentPort),
        ...flags,
      ];
      /** The port options a headless command takes, with the tool proxy's, on free ports. */
      const ports = async () => [
        ...(await portOptions()),
        '--tool-proxy-port',
        String(await freePort()),
      ];
      const stubs: Array<{kill(): void}> = [];
      try {
        // Recorded under run, through the viewer's API: two turns, the first calling the tool.
        const firstStubPort = await freePort();
        writeConfig(firstStubPort);
        const [port, proxyPort, modelProxyPort, receiverPort, toolProxyPort] = await Promise.all([
          freePort(),
          freePort(),
          freePort(),
          freePort(),
          freePort(),
        ]);
        const spectra = new SpectraProcess(
          [
            'run',
            '--port',
            String(port),
            '--proxy-port',
            String(proxyPort),
            '--model-proxy-port',
            String(modelProxyPort),
            '--receiver-port',
            String(receiverPort),
            '--tool-proxy-port',
            String(toolProxyPort),
            '--no-open',
            ...launch(firstStubPort),
          ],
          cwd,
          env,
        );
        const base = `http://127.0.0.1:${port}`;
        let live: LiveStream | undefined;
        let recorded: TurnRecord;
        let recordedTurns: string[];
        try {
          await spectra.waitFor(/The viewer is at /);
          // Under run the viewer serves before the card answers, and the box sends once it has.
          await spectra.waitFor(/The agent's card answered/);
          live = new LiveStream(`${base}/api/stream`);
          await live.ready;
          const first = await sendMessage(base, 'Top 2 Chinese restaurants in New York');
          const firstTurn = await live.closed(first.traceId);
          assert.equal(turnEventOf(firstTurn).attributes['a2ui.turn.outcome'], 'completed');
          assert.equal(modelCallsOf(firstTurn).length, 2, 'The function call, then the answer.');
          assert.ok(
            firstTurn.events.some(
              event =>
                isEventOfKind(event, 'tool_call') &&
                event.attributes['mcp.method.name'] === 'tools/call',
            ),
            'The function call answered over MCP.',
          );
          const {conversationId} = (await boxSettled(base)).conversations[0];
          assert.ok(conversationId);
          const second = await sendMessage(
            base,
            'Book a table for 2 at the first one tomorrow at 7pm',
            conversationId,
          );
          const secondTurn = await live.closed(second.traceId);
          assert.equal(turnEventOf(secondTurn).attributes['a2ui.turn.outcome'], 'completed');
          assert.equal(modelCallsOf(secondTurn).length, 1);
          await boxSettled(base);
          const saved = await postJson<{name: string; path: string}>(`${base}/api/fixtures`, {
            traceId: second.traceId,
            name: 'restaurants',
          });
          assert.equal(saved.status, 201, JSON.stringify(saved.body));
          recorded = (await getJson<TurnRecord>(`${base}/api/turns/${second.traceId}`)).body;
          recordedTurns = [first.traceId, second.traceId];
        } finally {
          live?.close();
          spectra.signal('SIGTERM');
          await spectra.exited;
        }
        assert.deepEqual(
          readFileSync(path.join(cwd, 'fixtures', 'restaurants.json'), 'utf8').length > 0,
          true,
        );

        // The stand-in stopped: with everything recorded, the launched agent replays for free and passes.
        standIn.process.kill('SIGKILL');
        const fixture = path.join('fixtures', 'restaurants.json');
        const replayPort = await freePort();
        const free = await finished(
          [
            'replay',
            fixture,
            '--agent-url',
            `http://127.0.0.1:${replayPort}`,
            ...(await ports()),
            ...launch(replayPort),
          ],
          cwd,
          env,
        );
        assert.equal(free.code, 0, free.output);
        const closing = free.stdout.match(
          /^turn 1 of 2: passed\nturn 2 of 2: passed\nfixtures\/restaurants\.json: passed; the replayed turns are in (\.a2ui-spectra\/turns\/\S+)\n$/,
        );
        assert.ok(closing, `stdout was:\n${free.stdout}`);
        assert.doesNotMatch(
          free.stderr,
          /matched nothing in the record|No model call and no tool call reached/,
        );
        const replayed = recordsIn(cwd, closing[1]);
        assert.equal(replayed.length, 2);
        for (const [index, record] of replayed.entries()) {
          const turn = record.turns.at(-1)!;
          const attributes = turnEventOf(turn).attributes;
          assert.equal(attributes['a2ui.replay.mode'], 'recorded');
          assert.equal(attributes['a2ui.replay.turn'], recordedTurns[index]);
          assert.equal(attributes['a2ui.replay.verdict'], 'passed');
          const calls = callsOf(turn);
          assert.ok(calls.length > 0);
          for (const call of calls) {
            if (call.attributes['mcp.method.name'] === 'notifications/initialized') continue;
            if (call.attributes['mcp.method.name'] === undefined && call.name === 'DELETE')
              continue;
            assert.equal(
              typeof call.attributes['a2ui.replay.served_from'],
              'string',
              `${call.name} was served from the record.`,
            );
          }
        }

        // The prompt changed: the first model request misses, the turn fails, and the record holds what the prefix break reads.
        const changedPort = await freePort();
        const changed = await finished(
          [
            'replay',
            fixture,
            '--agent-url',
            `http://127.0.0.1:${changedPort}`,
            ...(await ports()),
            ...launch(changedPort, ['--prompt', 'Answer in French.']),
          ],
          cwd,
          env,
        );
        assert.equal(changed.code, 1, changed.output);
        const failedLines = changed.stdout.split('\n');
        assert.match(
          failedLines[0],
          new RegExp(
            `^turn 1 of 2: failed \\(A model call matched nothing in the record: POST ${GEMINI_PATH.replaceAll('.', '\\.')}\\. `,
          ),
        );
        assert.match(failedLines[0], /The turn ended failed; the record ended completed\./);
        assert.match(failedLines[0], /of the recorded calls were not asked for$/);
        assert.match(failedLines[1], /^turn 2 of 2: failed /);
        assert.match(
          failedLines[2],
          /^fixtures\/restaurants\.json: failed; the replayed turns are in (\.a2ui-spectra\/turns\/\S+)$/,
        );
        assert.match(
          changed.stderr,
          /model proxy is replaying, and POST .* matched nothing in the record/,
        );
        const failedFolder = failedLines[2].match(/in (\S+)$/)![1];
        const failedFirst = recordsIn(cwd, failedFolder)[0].turns.at(-1)!;
        const reasons = turnEventOf(failedFirst).attributes['a2ui.replay.reasons'] ?? [];
        assert.deepEqual(reasons.map(reason => reason.code).sort(), [
          'A2UI_DIFFERS',
          'OUTCOME_DIFFERS',
          'REPLAY_MISS',
        ]);
        const miss = modelCallsOf(failedFirst)[0];
        assert.equal(miss.attributes['error.type'], 'replay_miss');
        assert.equal(miss.attributes['a2ui.replay.served_from'], undefined);
        assert.equal(systemInstructionOf(miss), 'Answer in French.');
        const recordedFirstCall = modelCallsOf(recorded.turns[0])[0];
        assert.notEqual(systemInstructionOf(recordedFirstCall), 'Answer in French.');
        assert.ok(systemInstructionOf(recordedFirstCall));

        // The folder tested, the agent launched: the fixture passes.
        const testPort = await freePort();
        const tested = await finished(
          [
            'test',
            '--agent-url',
            `http://127.0.0.1:${testPort}`,
            ...(await ports()),
            ...launch(testPort),
          ],
          cwd,
          env,
        );
        assert.equal(tested.code, 0, tested.output);
        assert.equal(tested.stdout, 'restaurants: passed\n1 fixture: 1 passed\n');

        // The folder tested, the agent already running with the variables set in its shell.
        const [
          runningPort,
          runningProxyPort,
          runningModelProxyPort,
          runningReceiverPort,
          runningToolProxyPort,
        ] = await Promise.all([freePort(), freePort(), freePort(), freePort(), freePort()]);
        const running = await startStub(runningPort, [], '--model-calling', {
          GOOGLE_GEMINI_BASE_URL: `http://127.0.0.1:${runningModelProxyPort}/GOOGLE_GEMINI_BASE_URL`,
          [TOOL_SERVER_VARIABLE]: `http://127.0.0.1:${runningToolProxyPort}/mcp`,
        });
        stubs.push(running);
        mkdirSync(path.join(cwd, 'fixtures', 'nested'));
        writeFileSync(path.join(cwd, 'fixtures', 'notes.json'), 'not json');
        const noCalls = structuredClone(recorded);
        for (const turn of noCalls.turns) {
          turn.events = turn.events.filter(
            event => !isEventOfKind(event, 'model_call') && !isEventOfKind(event, 'tool_call'),
          );
        }
        writeFileSync(
          path.join(cwd, 'fixtures', 'nested', 'no-calls.json'),
          JSON.stringify(noCalls),
        );
        const testedRunning = await finished(
          [
            'test',
            '--agent-url',
            `http://127.0.0.1:${runningPort}`,
            '--proxy-port',
            String(runningProxyPort),
            '--model-proxy-port',
            String(runningModelProxyPort),
            '--receiver-port',
            String(runningReceiverPort),
            '--tool-proxy-port',
            String(runningToolProxyPort),
          ],
          cwd,
          env,
        );
        assert.equal(testedRunning.code, 1, testedRunning.output);
        // The JSON error's wording is the engine's, V8's under Node and JavaScriptCore's in the binary.
        assert.match(
          testedRunning.stdout,
          new RegExp(
            `^nested/no-calls: failed \\(${escapeRegExp(NOTHING_TO_SERVE)}\\)\n` +
              'notes: failed \\(The file is not JSON: .+\\)\n' +
              'restaurants: passed\n' +
              '3 fixtures: 1 passed, 2 failed\n$',
          ),
        );

        // The agent already running without the variables: nothing reaches the proxies, and the terminal says so.
        const [deafPort, deafProxyPort, deafModelProxyPort, deafReceiverPort, deafToolProxyPort] =
          await Promise.all([freePort(), freePort(), freePort(), freePort(), freePort()]);
        const deaf = await startStub(deafPort, [], '--model-calling', {
          GOOGLE_GEMINI_BASE_URL: standIn.origin,
          [TOOL_SERVER_VARIABLE]: `${toolServer.origin}/mcp`,
        });
        stubs.push(deaf);
        const unreached = await finished(
          [
            'replay',
            fixture,
            '--agent-url',
            `http://127.0.0.1:${deafPort}`,
            '--proxy-port',
            String(deafProxyPort),
            '--model-proxy-port',
            String(deafModelProxyPort),
            '--receiver-port',
            String(deafReceiverPort),
            '--tool-proxy-port',
            String(deafToolProxyPort),
          ],
          cwd,
          env,
        );
        assert.equal(unreached.code, 1, unreached.output);
        assert.match(
          unreached.stdout,
          /^turn 1 of 2: failed \(The turn ended failed; the record ended completed\./,
        );
        assert.match(
          unreached.stderr,
          /No model call and no tool call reached the proxies while fixtures\/restaurants\.json replayed, and none of its recorded calls was asked for\./,
        );
      } finally {
        for (const stub of stubs) stub.kill();
        standIn.process.kill('SIGKILL');
        toolServer.process.kill('SIGKILL');
      }
    },
  );
});
