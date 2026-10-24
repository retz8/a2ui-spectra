import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

import {
  type CheckEvent,
  isEventOfKind,
  type Turn,
  type TurnEvent,
  type TurnRecord,
  type WirePart,
} from '../record/turn_record.js';
import {turnRecordErrors} from '../testing/turn_record_schema.js';
import {checkSchema, schemaCheckEvent} from './schema_check.js';

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

function readRecord(file: string): TurnRecord {
  return JSON.parse(fs.readFileSync(path.join(CONFORMANCE_DIR, file), 'utf8')) as TurnRecord;
}

function jsonFiles(dir: string): string[] {
  return fs
    .readdirSync(path.join(CONFORMANCE_DIR, dir), {recursive: true, encoding: 'utf8'})
    .filter(file => file.endsWith('.json'))
    .map(file => path.join(dir, file))
    .sort();
}

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
const TURN_SPAN = 'b7ad6b7169203331';

/** A turn: the turn event, the host's wire input, then one wire output per list of parts. */
function turnOf(
  outputs: WirePart[][],
  {version, input = []}: {version?: string; input?: WirePart[]} = {},
): Turn {
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
      'a2ui.turn.outcome': 'completed',
      ...(version !== undefined && {'a2ui.turn.protocol_version': version}),
      'a2ui.turn.capture_paths': ['wire'],
      'a2ui.turn.writer.name': 'a2ui-spectra',
      'a2ui.turn.writer.version': '0.0.1',
    },
    status: {code: 1},
  };
  const point = (index: number) => ({
    traceId: TRACE_ID,
    spanId: (index + 1).toString(16).padStart(16, '0'),
    parentSpanId: TURN_SPAN,
    kind: 1 as const,
    startTimeUnixNano: String(1792576860000000000n + BigInt(index + 1) * 1000000n),
  });
  return {
    events: [
      turnEvent,
      {
        ...point(0),
        name: 'wire_input',
        attributes: {
          'a2ui.event.kind': 'wire_input',
          'a2ui.wire.message': {role: 'user' as const, parts: input},
        },
      },
      ...outputs.map((parts, index) => ({
        ...point(index + 1),
        name: 'wire_output',
        attributes: {
          'a2ui.event.kind': 'wire_output' as const,
          'a2ui.wire.message': {role: 'assistant' as const, parts},
        },
      })),
    ],
  };
}

const a2ui = (content: unknown): WirePart => ({type: 'a2ui', content});

const createSurface = (version: string, surfaceId = 's1') => ({
  version,
  createSurface: {
    surfaceId,
    catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
  },
});

/** The JSON Pointer from the turn to the content of output `output`, part `part`. */
const contentPath = (output: number, part = 0) =>
  `/events/${output + 2}/attributes/a2ui.wire.message/parts/${part}/content`;

describe('the schema check on recorded turns', () => {
  it("reproduces the schema checks Phase 1's full records carry", () => {
    for (const file of jsonFiles('test_data/turn_record/v0_1').filter(f =>
      path.basename(f).startsWith('full_record_'),
    )) {
      for (const [index, turn] of readRecord(file).turns.entries()) {
        const recorded = turn.events.find(
          (event): event is CheckEvent =>
            isEventOfKind(event, 'check') && event.attributes['a2ui.check.name'] === 'schema',
        );
        assert.ok(recorded, `${file}, turn ${index}: no recorded schema check`);
        const unchecked = {events: turn.events.filter(event => !isEventOfKind(event, 'check'))};
        assert.deepEqual(
          checkSchema(unchecked),
          {
            protocolVersion: recorded.attributes['a2ui.check.protocol_version'],
            passed: recorded.attributes['a2ui.check.passed'],
            findings: recorded.attributes['a2ui.check.findings'],
          },
          `${file}, turn ${index}`,
        );
      }
    }
  });

  it("passes every agent's messages in sub-task 2.3's recordings but AG2's function call", () => {
    const failed: string[] = [];
    let checked = 0;
    for (const file of jsonFiles('test_data/a2a_capture/v0_1')) {
      for (const [index, turn] of readRecord(file).turns.entries()) {
        const result = checkSchema(turn);
        if (result === undefined) continue;
        checked += 1;
        if (!result.passed)
          failed.push(`${path.relative('test_data/a2a_capture/v0_1', file)}#${index}`);
      }
    }
    assert.ok(checked >= 20, `only ${checked} turns checked`);
    assert.deepEqual(failed, ['ag2/stream_v1_0_function_call.json#0']);

    const [turn] = readRecord(
      'test_data/a2a_capture/v0_1/ag2/stream_v1_0_function_call.json',
    ).turns;
    const result = checkSchema(turn);
    assert.equal(result?.protocolVersion, 'v1.0');
    assert.equal(result?.findings.length, 1);
    const [finding] = result.findings;
    assert.equal(finding.code, 'VALIDATION_FAILED');
    assert.match(finding.message, /names none of v1\.0's message types: .*callRendererFunction/);
    assert.equal(finding.surfaceId, undefined);
    const pointer = (finding.path ?? '').split('/').slice(1);
    let value: unknown = turn;
    for (const key of pointer) value = (value as Record<string, unknown>)[key];
    assert.equal((value as {functionCallId?: string}).functionCallId, 'open-docs');
  });
});

describe('the schema check', () => {
  it('passes valid messages of each version, one message or an array per part', () => {
    const result = checkSchema(
      turnOf([[a2ui(createSurface('v0.9'))], [a2ui([createSurface('v0.9', 's2')])]]),
    );
    assert.deepEqual(result, {protocolVersion: 'v0.9', passed: true, findings: []});
    assert.equal(checkSchema(turnOf([[a2ui(createSurface('v0.9.1'))]]))?.passed, true);
    assert.equal(checkSchema(turnOf([[a2ui(createSurface('v1.0'))]]))?.passed, true);
  });

  it("accepts any catalog's components, functions and theme", () => {
    const v0_9 = {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 's1',
        components: [{id: 'root', component: 'Gizmo', anything: [1, 2], action: {call: 'spin'}}],
      },
    };
    const theme = {
      ...createSurface('v0.9'),
      createSurface: {...createSurface('v0.9').createSurface, theme: {glow: 3}},
    };
    const v1_0 = {
      version: 'v1.0',
      updateComponents: {
        surfaceId: 's1',
        components: [{id: 'root', component: 'Gizmo', child: 'x', text: 'Hello'}],
      },
    };
    const result = checkSchema(turnOf([[a2ui(v0_9), a2ui(theme)]]));
    assert.deepEqual(result?.findings, []);
    assert.deepEqual(checkSchema(turnOf([[a2ui(v1_0)]]))?.findings, []);
  });

  it("keeps the protocol's own rules on a v1.0 component", () => {
    const result = checkSchema(
      turnOf([
        [
          a2ui({
            version: 'v1.0',
            updateComponents: {
              surfaceId: 's1',
              components: [{component: 'Text'}, {id: 'x', component: 'Surface'}],
            },
          }),
        ],
      ]),
    );
    assert.equal(result?.passed, false);
    const paths = result?.findings.map(finding => finding.path);
    assert.ok(paths?.includes(`${contentPath(0)}/updateComponents/components/0`), String(paths));
    assert.ok(
      paths?.some(p => p?.startsWith(`${contentPath(0)}/updateComponents/components/1`)),
      String(paths),
    );
    assert.ok(
      result?.findings.every(
        finding => finding.code === 'VALIDATION_FAILED' && finding.surfaceId === 's1',
      ),
    );
  });

  it('reports the errors of the message type the message names, with a path from the turn', () => {
    const result = checkSchema(
      turnOf([
        [a2ui({text: 'x'})],
        [a2ui([createSurface('v0.9'), {version: 'v0.9', createSurface: {surfaceId: 's2'}}])],
      ]),
    );
    assert.equal(result?.passed, false);
    assert.deepEqual(result?.findings, [
      {
        code: 'SCHEMA_VERSION_MISSING',
        path: contentPath(0),
        message: 'The message declares no version.',
      },
      {
        code: 'VALIDATION_FAILED',
        surfaceId: 's2',
        path: `${contentPath(1)}/1/createSurface`,
        message: "must have required property 'catalogId'",
      },
    ]);
  });

  it('names an additional property, in the message and in the path', () => {
    const message = {...createSurface('v0.9'), extra: true};
    const result = checkSchema(turnOf([[a2ui(message)]]));
    assert.deepEqual(result?.findings, [
      {
        code: 'VALIDATION_FAILED',
        surfaceId: 's1',
        path: `${contentPath(0)}/extra`,
        message: 'must NOT have additional properties: extra',
      },
    ]);
  });

  it('gives one finding for a message that names no message type, or several', () => {
    const none = checkSchema(turnOf([[a2ui({version: 'v0.9', paintSurface: {surfaceId: 's1'}})]]));
    assert.deepEqual(none?.findings, [
      {
        code: 'VALIDATION_FAILED',
        surfaceId: 's1',
        path: contentPath(0),
        message:
          "The message names none of v0.9's message types: createSurface, updateComponents, updateDataModel, deleteSurface.",
      },
    ]);
    const several = checkSchema(
      turnOf([[a2ui({...createSurface('v0.9'), deleteSurface: {surfaceId: 's1'}})]]),
    );
    assert.deepEqual(several?.findings, [
      {
        code: 'VALIDATION_FAILED',
        surfaceId: 's1',
        path: contentPath(0),
        message: 'The message names more than one message type: createSurface, deleteSurface.',
      },
    ]);
  });

  it('fails a message of a version it does not check, and content that is not an object', () => {
    const result = checkSchema(
      turnOf([
        [a2ui({version: 'v0.8', surfaceUpdate: {surfaceId: 's1', components: []}})],
        [a2ui(['text', null]), a2ui(42)],
      ]),
    );
    assert.deepEqual(result?.protocolVersion, 'v0.8');
    assert.deepEqual(result?.findings, [
      {
        code: 'SCHEMA_VERSION_UNSUPPORTED',
        surfaceId: 's1',
        path: `${contentPath(0)}/version`,
        message: 'The message declares v0.8; Spectra checks v0.9, v0.9.1, v1.0.',
      },
      {
        code: 'SCHEMA_NOT_AN_OBJECT',
        path: `${contentPath(1)}/0`,
        message: 'The A2UI content is not a JSON object.',
      },
      {
        code: 'SCHEMA_NOT_AN_OBJECT',
        path: `${contentPath(1)}/1`,
        message: 'The A2UI content is not a JSON object.',
      },
      {
        code: 'SCHEMA_NOT_AN_OBJECT',
        path: contentPath(1, 1),
        message: 'The A2UI content is not a JSON object.',
      },
    ]);
  });

  it("finds mixed versions among the agent's messages, each checked against its own", () => {
    const result = checkSchema(
      turnOf([[a2ui(createSurface('v0.9'))], [a2ui(createSurface('v1.0', 's2'))]], {
        version: 'v0.9',
      }),
    );
    assert.deepEqual(result, {
      protocolVersion: 'v0.9',
      passed: false,
      findings: [
        {
          code: 'SCHEMA_VERSIONS_MIXED',
          message: "The agent's messages in this turn declare more than one version: v0.9, v1.0.",
        },
      ],
    });
  });

  it("takes the agent's first declared version, not the host's", () => {
    const action = a2ui({version: 'v0.9', action: {name: 'go', surfaceId: 's1'}});
    const result = checkSchema(
      turnOf([[a2ui({text: 'no version'})], [a2ui(createSurface('v1.0'))]], {
        version: 'v0.9',
        input: [action],
      }),
    );
    assert.equal(result?.protocolVersion, 'v1.0');
    assert.deepEqual(
      result?.findings.map(finding => finding.code),
      ['SCHEMA_VERSION_MISSING'],
    );
  });

  it("falls back to the turn's version, and records nothing without one", () => {
    assert.deepEqual(
      checkSchema(turnOf([[{type: 'text', content: 'Hello'}]], {version: 'v0.9.1'})),
      {
        protocolVersion: 'v0.9.1',
        passed: true,
        findings: [],
      },
    );
    assert.equal(
      checkSchema(turnOf([[a2ui({text: 'x'})]], {version: 'v1.0'}))?.protocolVersion,
      'v1.0',
    );
    assert.equal(checkSchema(turnOf([[{type: 'text', content: 'Hello'}]])), undefined);
    assert.equal(checkSchema(turnOf([[a2ui({surfaceUpdate: {}})]])), undefined);
  });

  it('writes a check event the turn record schema accepts', () => {
    const turn = turnOf([[a2ui({...createSurface('v0.9'), extra: 1})]]);
    const result = checkSchema(turn);
    assert.ok(result);
    const event = schemaCheckEvent(turn.events[0] as TurnEvent, result, {
      spanId: 'aaaaaaaaaaaaaaaa',
      timeUnixNano: 1792576862000000000n,
    });
    assert.equal(event.parentSpanId, TURN_SPAN);
    assert.equal(event.traceId, TRACE_ID);
    const record: TurnRecord = {version: 'v0.1', turns: [{events: [...turn.events, event]}]};
    assert.deepEqual(turnRecordErrors(record), []);
  });
});
