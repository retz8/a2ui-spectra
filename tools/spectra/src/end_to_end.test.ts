/**
 * The end-to-end test: Spectra attached to the stub agent holding its canned
 * A2UI conversation, with a two-turn conversation sent through the message
 * box's API, once with the stub's card listing A2A 1.0 first and once A2A 0.3
 * first. It runs under Node by default, and against the binary when
 * SPECTRA_BINARY names one. The stub is built by the conformance workspace.
 */
import assert from 'node:assert/strict';
import {type ChildProcess, spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {after, describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

import {SseParser} from './a2a/sse.js';
import type {ListedTurn} from './api.js';
import type {MessageBoxState, SentMessage} from './message_box.js';
import {
  type A2uiPart,
  type CheckEvent,
  isEventOfKind,
  type Turn,
  type TurnEvent,
  type TurnRecord,
  type WireOutputEvent,
} from './record/turn_record.js';
import {folderOf} from './store/store.js';
import {binary, freePort, SpectraProcess, workingDir} from './testing/spectra_process.js';
import {turnRecordErrors} from './testing/turn_record_schema.js';

const stubScript = fileURLToPath(
  new URL('../../../conformance/dist/stub_agent/stub_agent.js', import.meta.url),
);
const TIMEOUT = 60_000;

const stubs = new Set<ChildProcess>();
after(() => {
  for (const stub of stubs) stub.kill('SIGKILL');
});

/** Starts the stub agent and resolves once it listens. */
function startStub(port: number, flags: string[]): Promise<ChildProcess> {
  const stub = spawn(
    process.execPath,
    [stubScript, '--port', String(port), '--canned-a2ui', ...flags],
    {stdio: ['ignore', 'pipe', 'pipe']},
  );
  stubs.add(stub);
  return new Promise((resolve, reject) => {
    let output = '';
    const onData = (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.includes('Spectra stub agent at')) resolve(stub);
    };
    stub.stdout.on('data', onData);
    stub.stderr.on('data', onData);
    stub.once('exit', code => reject(new Error(`The stub agent exited with ${code}:\n${output}`)));
  });
}

interface LiveEvent {
  event: string;
  data: {traceId: string; turn?: Turn};
}

/** The live stream, read in the background, its events kept in order. */
class LiveStream {
  readonly events: LiveEvent[] = [];
  readonly ready: Promise<void>;
  readonly #stop = new AbortController();
  #waiters: Array<() => void> = [];

  constructor(url: string) {
    this.ready = fetch(url, {signal: this.#stop.signal}).then(response => {
      void this.#read(response);
    });
  }

  /** Resolves with the turn closed for the trace id, once the stream has sent it. */
  async closed(traceId: string, timeoutMs = 20_000): Promise<Turn> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.events.find(e => e.event === 'turn_closed' && e.data.traceId === traceId);
      if (found?.data.turn !== undefined) return found.data.turn;
      if (Date.now() > deadline) {
        throw new Error(`No turn_closed for ${traceId} on the live stream.`);
      }
      await new Promise<void>(resolve => {
        this.#waiters.push(resolve);
        setTimeout(resolve, 200);
      });
    }
  }

  close(): void {
    this.#stop.abort();
  }

  async #read(response: Response): Promise<void> {
    const sse = new SseParser();
    const text = new TextDecoder();
    try {
      for await (const chunk of response.body ?? []) {
        for (const event of sse.push(text.decode(chunk as Uint8Array, {stream: true}))) {
          this.events.push({event: event.event ?? 'message', data: JSON.parse(event.data)});
        }
        const waiters = this.#waiters;
        this.#waiters = [];
        for (const wake of waiters) wake();
      }
    } catch {
      // Closed by the test.
    }
  }
}

async function getJson<T>(url: string): Promise<{status: number; body: T}> {
  const response = await fetch(url);
  return {status: response.status, body: (await response.json()) as T};
}

async function sendMessage(base: string, text: string): Promise<SentMessage> {
  const response = await fetch(`${base}/api/message-box/messages`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({text}),
  });
  const body = (await response.json()) as SentMessage & {error?: string};
  assert.equal(response.status, 200, body.error);
  return body;
}

/** Resolves with the box's state once its conversation has no open turn. */
async function boxSettled(base: string): Promise<MessageBoxState> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const {body} = await getJson<MessageBoxState>(`${base}/api/message-box`);
    if (body.openTurn === undefined) return body;
    assert.ok(Date.now() < deadline, 'The message box kept its turn open.');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

function turnEventOf(turn: Turn): TurnEvent {
  const turnEvent = turn.events.find((event): event is TurnEvent => isEventOfKind(event, 'turn'));
  assert.ok(turnEvent);
  return turnEvent;
}

/** The A2UI parts of the turn's wire outputs. */
function a2uiPartsOf(turn: Turn): A2uiPart[] {
  return turn.events
    .filter((event): event is WireOutputEvent => isEventOfKind(event, 'wire_output'))
    .flatMap(event => event.attributes['a2ui.wire.message'].parts)
    .filter((part): part is A2uiPart => part.type === 'a2ui');
}

/**
 * Checks one turn everywhere it should be: sent on the live stream as turn
 * opened, wire events and turn closed; in the listing, closed; returned by
 * the record route as the record's last turn, validating with a passing
 * schema check; and written to the store as that record.
 */
async function checkTurn(
  base: string,
  cwd: string,
  live: LiveStream,
  traceId: string,
): Promise<{record: TurnRecord; turn: Turn}> {
  const closed = await live.closed(traceId);
  const events = live.events.filter(e => e.data.traceId === traceId).map(e => e.event);
  assert.equal(events[0], 'turn_opened');
  assert.equal(events.at(-1), 'turn_closed');
  assert.ok(events.slice(1, -1).length >= 2);
  assert.ok(events.slice(1, -1).every(event => event === 'wire_event'));

  const listing = await getJson<{turns: ListedTurn[]}>(`${base}/api/turns`);
  const listed = listing.body.turns.find(turn => turn.traceId === traceId);
  assert.ok(listed, 'The listing shows the turn.');
  assert.equal(listed.open, undefined);

  const {status, body: record} = await getJson<TurnRecord>(`${base}/api/turns/${traceId}`);
  assert.equal(status, 200);
  assert.deepEqual(turnRecordErrors(record), []);
  const turn = record.turns.at(-1)!;
  assert.deepEqual(turn, closed);
  assert.equal(turnEventOf(turn).traceId, traceId);
  const check = turn.events.find((event): event is CheckEvent => isEventOfKind(event, 'check'));
  assert.ok(check, 'The turn carries a schema check.');
  assert.equal(check.attributes['a2ui.check.passed'], true);

  const conversation = turnEventOf(turn).attributes['gen_ai.conversation.id'];
  assert.ok(conversation);
  const name = `${listed.startTime.replaceAll(':', '-')}_${traceId}.json`;
  const file = path.join(cwd, '.a2ui-spectra', 'turns', folderOf(conversation), name);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), record);
  return {record, turn};
}

describe(`the message box against the stub agent, ${binary ? 'the binary' : 'under Node'}`, () => {
  for (const [a2a, flags] of [
    ['1.0', []],
    ['0.3', ['--a2a-0.3-first']],
  ] as const) {
    it(
      `holds a two-turn conversation over A2A ${a2a}, each turn recorded, checked and streamed`,
      {timeout: TIMEOUT},
      async () => {
        const [agentPort, port, proxyPort] = await Promise.all([
          freePort(),
          freePort(),
          freePort(),
        ]);
        const stub = await startStub(agentPort, [...flags]);
        const cwd = workingDir();
        const spectra = new SpectraProcess(
          [
            'attach',
            `http://127.0.0.1:${agentPort}`,
            '--port',
            String(port),
            '--proxy-port',
            String(proxyPort),
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
          assert.equal(first.conversationId, undefined);
          const one = await checkTurn(base, cwd, live, first.traceId);
          const afterFirst = await boxSettled(base);
          assert.ok(afterFirst.conversationId);

          const second = await sendMessage(base, 'Ada');
          assert.equal(second.conversationId, afterFirst.conversationId);
          const two = await checkTurn(base, cwd, live, second.traceId);

          assert.equal(turnEventOf(one.turn).attributes['a2ui.turn.outcome'], 'waiting_for_input');
          assert.equal(
            turnEventOf(two.turn).attributes['a2ui.turn.outcome'],
            'completed',
            "The stub completes only a message carrying the waiting task's id.",
          );
          for (const {turn} of [one, two]) {
            assert.equal(
              turnEventOf(turn).attributes['gen_ai.conversation.id'],
              afterFirst.conversationId,
            );
            assert.equal(turnEventOf(turn).attributes['a2ui.turn.protocol_version'], 'v1.0');
          }
          assert.deepEqual(
            two.record.turns.map(turn => turnEventOf(turn).traceId),
            [first.traceId, second.traceId],
          );

          // One part holding an array is A2A 1.0's form; one message per part is A2A 0.3's.
          const parts = a2uiPartsOf(one.turn);
          if (a2a === '1.0') {
            assert.equal(parts.length, 1);
            assert.ok(Array.isArray(parts[0].content));
            assert.equal((parts[0].content as unknown[]).length, 3);
          } else {
            assert.equal(parts.length, 3);
            assert.ok(parts.every(part => !Array.isArray(part.content)));
          }
        } finally {
          live?.close();
          spectra.signal('SIGTERM');
          await spectra.exited;
          stub.kill();
        }
      },
    );
  }
});
