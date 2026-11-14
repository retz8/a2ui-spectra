/**
 * The wrapper capture suite (`conformance/wrapper_capture/`): each case's
 * job run by the driver of each language it names, with the A2UI wrapper
 * switched on, inside one turn the harness opens. The receiver's listener
 * takes what the driver exports; the turn is placed by its time window,
 * open while the driver runs, or opened after the driver has run for a job
 * that runs before the turn, with the expected record's proxy calls placed
 * in it. The turn as written must match the expected record of its
 * language, apart from what the run generates, and the receiver must print
 * no line.
 *
 * A language whose driver project is not under `conformance/wrapper_driver/`
 * has its cases skipped, by name.
 *
 * With `SPECTRA_WRITE_WRAPPER_CAPTURE=1` the harness writes each expected
 * record from what it captures instead of comparing.
 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import * as fs from 'node:fs';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import * as path from 'node:path';
import {describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

import * as yaml from 'js-yaml';

import {CallPlacer} from '../placement.js';
import {
  type CallEvent,
  isEventOfKind,
  type SpanEvent,
  type Turn,
  type TurnEvent,
  type TurnRecord,
  type TurnRecordEvent,
} from '../record/turn_record.js';
import {TurnStore} from '../store/store.js';
import {turnRecordErrors} from '../testing/turn_record_schema.js';
import {isReceived} from './assemble.js';
import {startReceiverListener} from './listener.js';
import {SpanReceiver} from './receiver.js';
import {freePort} from '../testing/free_port.js';

type Language = 'python' | 'typescript';

interface CaptureWrapperCase {
  name: string;
  description: string;
  action: 'capture_wrapper';
  job: string;
  expect: string | Partial<Record<Language, string>>;
  expected_to_fail?: Partial<Record<Language, string>>;
}

/** What the harness reads of a driver's job. */
interface Job {
  languages: Language[];
  beforeTurn?: boolean;
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
const SUITE = path.join(CONFORMANCE_DIR, 'wrapper_capture/capture_v0_1.yaml');
const WRITE = process.env.SPECTRA_WRITE_WRAPPER_CAPTURE === '1';
const DRIVER_DIR = path.join(CONFORMANCE_DIR, 'wrapper_driver');

/** Each language's driver: the file that marks its project, and how it is run on a job. */
const DRIVERS: Readonly<
  Record<Language, {project: string; marker: string; run: (job: string) => [string, string[]]}>
> = {
  python: {
    project: path.join(DRIVER_DIR, 'python'),
    marker: 'pyproject.toml',
    run: job => [
      'uv',
      [
        'run',
        '--project',
        path.join(DRIVER_DIR, 'python'),
        'python',
        path.join(DRIVER_DIR, 'python', 'driver.py'),
        job,
      ],
    ],
  },
  typescript: {
    project: path.join(DRIVER_DIR, 'typescript'),
    marker: 'package.json',
    run: job => ['node', [path.join(DRIVER_DIR, 'typescript', 'dist', 'driver.js'), job]],
  },
};

/** The agent SDK's package each language's wrapper names. */
const SDK_NAMES: Readonly<Record<Language, string>> = {
  python: 'a2ui-agent-sdk',
  typescript: '@a2ui/agent',
};

function hasDriver(language: Language): boolean {
  const driver = DRIVERS[language];
  return fs.existsSync(path.join(driver.project, driver.marker));
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(CONFORMANCE_DIR, file), 'utf8')) as T;
}

function expectedPath(c: CaptureWrapperCase, language: Language): string {
  const file = typeof c.expect === 'string' ? c.expect : c.expect[language];
  assert.ok(file, `${c.name} names an expected record for ${language}`);
  return file;
}

function nowUnixNano(): bigint {
  return BigInt(Math.round((performance.timeOrigin + performance.now()) * 1000)) * 1000n;
}

function hex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

/** Runs a driver on a job, with the two variables `run` sets and no trace context. */
function runDriver(language: Language, job: string, endpoint: string): Promise<void> {
  const [command, args] = DRIVERS[language].run(job);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: CONFORMANCE_DIR,
      env: {
        ...process.env,
        OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
        OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('exit', code =>
      code === 0
        ? resolve()
        : reject(new Error(`The ${language} driver exited with ${code}:\n${stderr}`)),
    );
  });
}

async function capture(
  c: CaptureWrapperCase,
  language: Language,
  expected: Turn,
): Promise<{
  turn: Turn;
  lines: string[];
}> {
  const job = readJson<Job>(c.job);
  const dir = await mkdtemp(path.join(tmpdir(), 'spectra-wrapper-capture-'));
  const lines: string[] = [];
  const writes: Array<Promise<unknown>> = [];
  try {
    const store = await TurnStore.open(dir);
    const placer: CallPlacer = new CallPlacer({
      onTurn: notification => {
        if (notification.type === 'turn_closed') writes.push(store.write(notification.turn));
      },
      log: line => lines.push(line),
      assemble: (turn: Turn): Turn => spans.assemble(turn),
      onCallEnded: (traceId, call) => spans.takeCall(traceId, call),
    });
    const spans: SpanReceiver = new SpanReceiver({
      turns: placer,
      store,
      log: line => lines.push(line),
    });
    const listener = await startReceiverListener({
      port: await freePort(),
      onSpans: received => spans.takeSpans(received),
      onLogs: received => spans.takeLogs(received),
    });
    const expectedTurn = expected.events.find((event): event is TurnEvent =>
      isEventOfKind(event, 'turn'),
    );
    assert.ok(expectedTurn, 'the expected record has its turn event');
    const calls = expected.events.filter(event => !isReceived(event) && event !== expectedTurn);
    const traceId = hex(16);
    const spanId = hex(8);
    let start = 0n;
    const open = () => {
      start = nowUnixNano();
      placer.onTurn({
        type: 'turn_opened',
        traceId,
        spanId,
        startTimeUnixNano: start.toString(),
      });
      for (const call of calls) {
        const at = nowUnixNano();
        const placed = placer.tryPlace({
          what: call.name,
          startTimeUnixNano: at.toString(),
          traceparent: `00-${traceId}-${spanId}-01`,
        });
        assert.ok(!('line' in placed), `the call ${call.name} is placed`);
        placed.ended({
          ...call,
          traceId,
          spanId: hex(8),
          parentSpanId: spanId,
          startTimeUnixNano: at.toString(),
          endTimeUnixNano: nowUnixNano().toString(),
        } as CallEvent);
      }
    };
    const endpoint = listener.origin;
    const jobPath = path.join(CONFORMANCE_DIR, c.job);
    try {
      if (job.beforeTurn === true) {
        await runDriver(language, jobPath, endpoint);
        open();
      } else {
        open();
        await runDriver(language, jobPath, endpoint);
      }
      const turnEvent: TurnEvent = {
        ...expectedTurn,
        traceId,
        spanId,
        startTimeUnixNano: start.toString(),
        endTimeUnixNano: nowUnixNano().toString(),
        attributes: {...expectedTurn.attributes, 'a2ui.turn.capture_paths': []},
      };
      placer.onTurn({type: 'turn_closed', traceId, turn: {events: [turnEvent]}});
      await Promise.all(writes);
      await spans.idle();
    } finally {
      await listener.close();
    }
    const file = (await store.list()).find(turn => turn.traceId === traceId)?.file;
    assert.ok(file, 'the turn is written');
    const record = await store.read(file);
    return {turn: record.turns[record.turns.length - 1], lines};
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
}

const TRACE_ID = /^[0-9a-f]{32}$/;
const SPAN_ID = /^[0-9a-f]{16}$/;
const UNIX_NANO = /^[0-9]+$/;

/** A received attribute's value, a JSON array or object compared by what it parses to. */
function parsedWire(value: unknown): unknown {
  if (typeof value !== 'string' || !/^\s*[[{]/.test(value)) return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/**
 * Checks what the run generates and takes it out of an event: its ids and
 * times, which must be well-formed with their order kept; the writer's and
 * the scope's version; a stack trace, present where the record has one; and
 * the SDK's name and version, which must name the language's package. The
 * expected record's own event is taken out the same way, with no language
 * to check its SDK against.
 */
function comparable(
  event: TurnRecordEvent,
  expected: TurnRecordEvent,
  language: Language | undefined,
  where: string,
): unknown {
  assert.match(event.traceId, TRACE_ID, `${where}: its trace id`);
  assert.match(event.spanId, SPAN_ID, `${where}: its span id`);
  assert.equal(
    event.parentSpanId !== undefined,
    expected.parentSpanId !== undefined,
    `${where}: a parent where the record has one`,
  );
  if (event.parentSpanId !== undefined) assert.match(event.parentSpanId, SPAN_ID);
  assert.match(event.startTimeUnixNano, UNIX_NANO, `${where}: its start`);
  const start = BigInt(event.startTimeUnixNano);
  const end = event.endTimeUnixNano === undefined ? undefined : BigInt(event.endTimeUnixNano);
  if (end !== undefined) assert.ok(start <= end, `${where}: starts before it ends`);
  let previous = start;
  for (const spanEvent of event.events ?? []) {
    const time = BigInt(spanEvent.timeUnixNano);
    assert.ok(time >= previous, `${where}: its span events in time order, within it`);
    previous = time;
  }
  if (end !== undefined) assert.ok(previous <= end, `${where}: its span events within it`);
  const attributes = {...(event.attributes as Record<string, unknown>)};
  const expectedAttributes = expected.attributes as Record<string, unknown>;
  delete attributes['a2ui.turn.writer.version'];
  if ('otel.scope.version' in expectedAttributes) {
    assert.equal(typeof attributes['otel.scope.version'], 'string', `${where}: its scope version`);
  }
  delete attributes['otel.scope.version'];
  const withoutSdk = (names: Record<string, unknown>) => {
    const rest = {...names};
    if (language !== undefined && 'a2ui.sdk.name' in expectedAttributes) {
      assert.equal(rest['a2ui.sdk.name'], SDK_NAMES[language], `${where}: the SDK's name`);
      assert.ok(
        typeof rest['a2ui.sdk.version'] === 'string' && rest['a2ui.sdk.version'] !== '',
        `${where}: the SDK's version`,
      );
    }
    delete rest['a2ui.sdk.name'];
    delete rest['a2ui.sdk.version'];
    return rest;
  };
  const received = attributes['a2ui.received.attributes'];
  const comparedAttributes = withoutSdk(attributes);
  if (received !== undefined && typeof received === 'object' && received !== null) {
    comparedAttributes['a2ui.received.attributes'] = Object.fromEntries(
      Object.entries(withoutSdk(received as Record<string, unknown>)).map(([name, value]) => [
        name,
        parsedWire(value),
      ]),
    );
  }
  const expectedEvents = expected.events ?? [];
  const spanEvents = (event.events ?? []).map((spanEvent: SpanEvent, index) => {
    const rest: Record<string, unknown> = {...(spanEvent.attributes ?? {})};
    const wanted = expectedEvents[index]?.attributes ?? {};
    if ('exception.stacktrace' in wanted) {
      assert.ok(
        typeof rest['exception.stacktrace'] === 'string' && rest['exception.stacktrace'] !== '',
        `${where}: span event ${index}'s stack trace`,
      );
    }
    delete rest['exception.stacktrace'];
    return {name: spanEvent.name, attributes: rest};
  });
  for (const link of event.links ?? []) {
    assert.match(link.traceId, TRACE_ID, `${where}: a link's trace id`);
    assert.match(link.spanId, SPAN_ID, `${where}: a link's span id`);
  }
  return {
    name: event.name,
    kind: event.kind,
    attributes: comparedAttributes,
    events: spanEvents,
    links: (event.links ?? []).map(link => link.attributes ?? {}),
    status: event.status,
  };
}

async function runCase(c: CaptureWrapperCase, language: Language): Promise<void> {
  const file = expectedPath(c, language);
  const expected = readJson<TurnRecord>(file);
  const expectedTurn = expected.turns[expected.turns.length - 1];
  const {turn, lines} = await capture(c, language, expectedTurn);
  const record = {version: 'v0.1', turns: [turn]} as TurnRecord;
  assert.deepEqual(turnRecordErrors(record), [], 'the captured record validates');
  if (WRITE) {
    fs.writeFileSync(path.join(CONFORMANCE_DIR, file), `${JSON.stringify(record, null, 2)}\n`);
    return;
  }
  assert.deepEqual(turnRecordErrors(expected), [], 'the expected record validates');
  assert.equal(turn.events.length, expectedTurn.events.length, 'as many events as the record');
  for (const [index, event] of turn.events.entries()) {
    const wanted = expectedTurn.events[index];
    const where = `event ${index}, ${event.name}`;
    assert.deepEqual(
      comparable(event, wanted, language, where),
      comparable(wanted, wanted, undefined, where),
      `${where} matches the expected record`,
    );
  }
  assert.deepEqual(lines, [], "the receiver's lines");
}

const cases = yaml.load(fs.readFileSync(SUITE, 'utf8')) as CaptureWrapperCase[];

describe('wrapper capture v0.1', () => {
  for (const c of cases) {
    const job = readJson<Job>(c.job);
    for (const language of job.languages) {
      const skip = hasDriver(language)
        ? false
        : `no ${language} driver under conformance/wrapper_driver/${language}/`;
      const todo = c.expected_to_fail?.[language] ?? false;
      it(`${c.name} (${language})`, {skip, todo}, () => runCase(c, language));
    }
  }
});
