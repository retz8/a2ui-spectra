/**
 * The tool capture suite (`conformance/tool_capture/`): each named client
 * scenario run with the MCP SDK's own client, or plain HTTP requests, through
 * the tool proxy to the conformance workspace's tool server, over each
 * transport its case names. The `tool_call` events the proxy writes into the
 * turn must match the transport's expected record once times, span ids,
 * session ids, request ids, the server's port and its origin in `url.full` and
 * `a2ui.mcp.stream.url` are normalised.
 *
 * With `SPECTRA_WRITE_TOOL_CAPTURE=1` the harness writes each expected record
 * from what it captures instead of comparing, for a case being added; the
 * record written is then checked by hand.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {before, describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

import * as yaml from 'js-yaml';

import {CallPlacer} from '../placement.js';
import type {ToolCallEvent, Turn, TurnEvent, TurnRecord} from '../record/turn_record.js';
import {
  comparable,
  freePort,
  PATHS,
  SCENARIOS,
  toolCalls,
  type Transport,
} from '../testing/tool_scenarios.js';
import {startToolServer} from '../testing/tool_server.js';
import {turnRecordErrors} from '../testing/turn_record_schema.js';
import {startToolProxy} from './proxy.js';
import type {ToolServer} from './servers.js';

interface CaptureToolCase {
  name: string;
  description: string;
  action: 'capture_tool';
  scenario: string;
  expect: Partial<Record<Transport, string>>;
}

/** Walks up from this file until it finds the shared conformance directory. */
function findConformanceDir(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (dir !== path.parse(dir).root) {
    const candidate = path.join(dir, 'conformance', 'conformance_schema.json');
    if (fs.existsSync(candidate)) {
      return path.dirname(candidate);
    }
    dir = path.dirname(dir);
  }
  throw new Error('Could not find conformance/conformance_schema.json');
}

const CONFORMANCE_DIR = findConformanceDir();
const SUITE = path.join(CONFORMANCE_DIR, 'tool_capture/capture_v0_1.yaml');
const WRITE = process.env.SPECTRA_WRITE_TOOL_CAPTURE === '1';

const TRACE_ID = 'c'.repeat(32);
const TURN_SPAN_ID = 'd'.repeat(16);

function turnEvent(): TurnEvent {
  return {
    traceId: TRACE_ID,
    spanId: TURN_SPAN_ID,
    name: 'invoke_agent',
    kind: 3,
    startTimeUnixNano: '1792577000000000000',
    endTimeUnixNano: '1792577001000000000',
    attributes: {
      'a2ui.event.kind': 'turn',
      'gen_ai.operation.name': 'invoke_agent',
      'a2ui.turn.outcome': 'completed',
      'a2ui.turn.capture_paths': ['wire', 'tool_proxy'],
      'a2ui.turn.writer.name': 'a2ui-spectra',
      'a2ui.turn.writer.version': '0.0.0',
    },
    status: {code: 1},
  };
}

/** The expected record a capture gives: the stand-in turn event and the normalised calls, with schema-valid stand-ins for what Spectra generates. */
function expectedRecord(events: ToolCallEvent[]): TurnRecord {
  const calls = comparable(events) as Array<Omit<ToolCallEvent, 'traceId' | 'spanId'>>;
  return {
    version: 'v0.1',
    turns: [
      {
        events: [
          turnEvent(),
          ...calls.map((call, index) => {
            const start = 1792577000100000000n + BigInt(index) * 10_000_000n;
            // A notification the server sent starts and ends at its arrival.
            const instant = call.kind === 4 && call.attributes['jsonrpc.request.id'] === undefined;
            return {
              traceId: TRACE_ID,
              spanId: (index + 1).toString(16).padStart(16, '0'),
              parentSpanId: TURN_SPAN_ID,
              ...call,
              startTimeUnixNano: start.toString(),
              endTimeUnixNano: (instant ? start : start + 5_000_000n).toString(),
              ...(call.events && {
                events: call.events.map(chunk => ({...chunk, timeUnixNano: start.toString()})),
              }),
            } as ToolCallEvent;
          }),
        ],
      },
    ],
  };
}

let toolServerOrigin = '';
before(async () => {
  toolServerOrigin = (await startToolServer(await freePort())).origin;
});

async function runCase(
  c: CaptureToolCase,
  transport: Transport,
  expectFile: string,
): Promise<void> {
  const handedOn: Turn[] = [];
  const unplaced: string[] = [];
  const placer = new CallPlacer({
    onTurn: notification => {
      if (notification.type === 'turn_closed') handedOn.push(notification.turn);
    },
    log: line => unplaced.push(line),
  });
  placer.onTurn({
    type: 'turn_opened',
    traceId: TRACE_ID,
    spanId: TURN_SPAN_ID,
    startTimeUnixNano: String(BigInt(Date.now()) * 1_000_000n),
  });
  const port = await freePort();
  const proxyOrigin = `http://127.0.0.1:${port}`;
  const original = new URL(`${toolServerOrigin}${PATHS[transport]}`);
  const server: ToolServer = {
    variable: 'TOOL_SERVER_URL',
    port,
    proxyOrigin,
    value: `${proxyOrigin}${original.pathname}`,
    original,
  };
  const lines: string[] = [];
  const proxy = await startToolProxy({
    servers: [server],
    place: call => placer.tryPlace(call),
    log: line => lines.push(line),
  });
  try {
    const scenario = SCENARIOS[c.scenario];
    assert.ok(scenario !== undefined, `the scenario ${c.scenario} exists`);
    await scenario(new URL(server.value), transport);
    placer.onTurn({type: 'turn_closed', traceId: TRACE_ID, turn: {events: [turnEvent()]}});
    const deadline = Date.now() + 5000;
    while (handedOn.length === 0) {
      assert.ok(
        Date.now() < deadline,
        `The turn was not handed on; the proxy said:\n${lines.join('\n')}`,
      );
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  } finally {
    await proxy.close();
  }
  assert.deepEqual(unplaced, [], 'every call was placed');
  assert.deepEqual(lines, [], 'the proxy had nothing to say');
  const [turn] = handedOn;
  const record: TurnRecord = {version: 'v0.1', turns: [turn]};
  assert.deepEqual(turnRecordErrors(record), [], 'the captured record validates');
  const captured = toolCalls(turn);
  for (const [index, event] of captured.entries()) {
    assert.equal(event.traceId, TRACE_ID, `call ${index + 1}: the turn's trace id`);
    assert.equal(event.parentSpanId, TURN_SPAN_ID, `call ${index + 1}: under the turn event`);
    assert.match(event.spanId, /^[0-9a-f]{16}$/);
    assert.ok(
      BigInt(event.endTimeUnixNano ?? '0') >= BigInt(event.startTimeUnixNano),
      `call ${index + 1}: ends after it starts`,
    );
    assert.equal(
      event.attributes['server.port'],
      Number(original.port),
      `call ${index + 1}: the server's port`,
    );
  }
  const file = path.join(CONFORMANCE_DIR, expectFile);
  if (WRITE) {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, `${JSON.stringify(expectedRecord(captured), null, 2)}\n`);
    return;
  }
  const expected = JSON.parse(fs.readFileSync(file, 'utf8')) as TurnRecord;
  assert.deepEqual(turnRecordErrors(expected), [], 'the expected record validates');
  assert.deepEqual(
    comparable(captured),
    comparable(toolCalls(expected.turns[expected.turns.length - 1])),
    'the calls match the expected record',
  );
}

const cases = yaml.load(fs.readFileSync(SUITE, 'utf8')) as CaptureToolCase[];

describe('tool capture v0.1', () => {
  for (const c of cases) {
    for (const [transport, expectFile] of Object.entries(c.expect) as Array<[Transport, string]>) {
      it(`${c.name} over ${transport}`, () => runCase(c, transport, expectFile));
    }
  }
});
