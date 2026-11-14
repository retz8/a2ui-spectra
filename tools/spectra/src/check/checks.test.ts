import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

import {CatalogRegistry} from '../catalog/registry.js';
import {
  type CheckEvent,
  isEventOfKind,
  type TurnEvent,
  type TurnRecord,
} from '../record/turn_record.js';
import {turnRecordErrors} from '../testing/turn_record_schema.js';
import {
  BASIC_V1_0,
  createSurface,
  testTurn,
  updateComponents,
  updateDataModel,
} from '../testing/turns.js';
import type {CheckResult} from './check_event.js';
import {checkEvents, checkTurn, type TurnChecks} from './checks.js';

function findConformanceDir(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (dir !== path.parse(dir).root) {
    if (fs.existsSync(path.join(dir, 'conformance', 'conformance_schema.json'))) {
      return path.join(dir, 'conformance');
    }
    dir = path.dirname(dir);
  }
  throw new Error('Could not find conformance/conformance_schema.json');
}

const CONFORMANCE_DIR = findConformanceDir();
const RECORDINGS = path.join(CONFORMANCE_DIR, 'test_data/a2a_capture/v0_1');
const CIRCLECI = path.join(CONFORMANCE_DIR, 'test_data/catalogs/a2uiverse_circleci_v0_9_1.json');

function readRecord(file: string): TurnRecord {
  return JSON.parse(fs.readFileSync(path.join(CONFORMANCE_DIR, file), 'utf8')) as TurnRecord;
}

const NAMES = ['schema', 'catalog', 'structural', 'binding'] as const;

/** Each check's codes and skips, as a table row; nothing for a check that found and skipped nothing. */
function summary(checks: TurnChecks | undefined): Record<string, unknown> | null {
  if (checks === undefined) return null;
  const row: Record<string, unknown> = {};
  for (const name of NAMES) {
    const codes = checks[name].findings.map(finding => finding.code);
    const skipped = (checks[name].skipped ?? []).map(entry => `${entry.surfaceId}:${entry.reason}`);
    if (codes.length > 0 || skipped.length > 0) row[name] = {codes, skipped};
  }
  return row;
}

describe('the four checks on recorded turns', () => {
  it("reproduce the check events Phase 1's full records carry", () => {
    for (const file of ['full_record_restaurant_finder', 'full_record_custom_components']) {
      const {turns} = readRecord(`test_data/turn_record/v0_1/${file}.json`);
      turns.forEach((turn, index) => {
        const checks = checkTurn(turn, turns.slice(0, index));
        assert.ok(checks, `${file} turn ${index} has a protocol version`);
        const recorded = turn.events.filter((event): event is CheckEvent =>
          isEventOfKind(event, 'check'),
        );
        assert.equal(recorded.length, 4, `${file} turn ${index} carries four check events`);
        for (const event of recorded) {
          const name = event.attributes['a2ui.check.name'];
          const result: CheckResult = checks[name];
          assert.deepEqual(
            {
              passed: result.findings.length === 0,
              findings: result.findings,
              ...(name !== 'schema' && {skipped: result.skipped}),
              ...(name === 'catalog' && {legacyForm: result.legacyForm}),
            },
            {
              passed: event.attributes['a2ui.check.passed'],
              findings: event.attributes['a2ui.check.findings'],
              ...(name !== 'schema' && {skipped: event.attributes['a2ui.check.skipped']}),
              ...(name === 'catalog' && {legacyForm: event.attributes['a2ui.check.legacy_form']}),
            },
            `${file} turn ${index}, the ${name} check`,
          );
        }
      });
    }
  });

  it("judge the coverage roster's recordings: the restaurant finders clean, the flawed booking on its known mistakes", async () => {
    const registry = await CatalogRegistry.load([CIRCLECI]);
    const files = fs
      .readdirSync(RECORDINGS, {recursive: true, encoding: 'utf8'})
      .filter(file => file.endsWith('.json'))
      .sort();
    const table = Object.fromEntries(
      files.map(file => {
        const {turns} = readRecord(`test_data/a2a_capture/v0_1/${file}`);
        return [
          file,
          turns.map((turn, index) =>
            summary(
              checkTurn(
                turn,
                turns.slice(0, index),
                file.startsWith('a2uiverse') ? registry : undefined,
              ),
            ),
          ),
        ];
      }),
    );
    const noDefinition = (surfaceId: string) => ({
      catalog: {codes: [], skipped: [`${surfaceId}:no_definition`]},
      structural: {codes: [], skipped: [`${surfaceId}:no_definition`]},
      binding: {codes: [], skipped: [`${surfaceId}:no_definition`]},
    });
    assert.deepEqual(table, {
      // The Go agent updates a surface it never created.
      'a2term_examplesvc/send_multipart_and_tagged_text.json': [
        {
          catalog: {codes: [], skipped: ['multipart-surface:not_created']},
          structural: {codes: ['SURFACE_NOT_CREATED'], skipped: []},
          binding: {codes: [], skipped: ['multipart-surface:not_created']},
        },
        null,
      ],
      // The CircleCI catalog's component definitions leave out ComponentCommon, so by the v0.9 schema
      // each component's id is an unevaluated property, which web core's own validator strips first.
      'a2uiverse_circleci/runs_then_confirm_rerun.json': [
        {catalog: {codes: Array.from({length: 16}, () => 'VALIDATION_FAILED'), skipped: []}},
        {},
      ],
      'ag2/send_v0_9_1_card.json': [{}],
      'ag2/stream_v1_0_failed.json': [{}],
      'ag2/stream_v1_0_function_call.json': [{}],
      'angular_client/python_restaurant_finder_booking.json': [{}, {}, {}],
      // The sample's host put the inline catalog where Spectra does not read capabilities (finding 5).
      'custom_components/action_then_model_turn.json': [noDefinition('action-modal'), null],
      'file_upload_summarizer/artifact_stream_and_send.json': [
        noDefinition('file_upload_surface_0c619c30'),
        noDefinition('file_upload_surface_b88930f6'),
      ],
      'node_restaurant_finder/send_task_history_and_failed.json': [{}, {}],
      'node_restaurant_finder/stream_v1_0_booking.json': [{}, {}],
      'react_client/node_restaurant_finder_text_and_action.json': [{}, {}],
      // The wizard's second step sends `step` and `nav` again with new children and leaves the first
      // step's components behind: an earlier turn's, so the structural check does not report them.
      'strathweb_booking_wizard/send_then_stream.json': [{}, {}],
      'stub_agent/cancel_a2a_0_3.json': [null],
      'stub_agent/cancel_a2a_1_0.json': [null],
      'stub_agent/flawed_booking_a2a_1_0.json': [
        {
          schema: {codes: ['VALIDATION_FAILED'], skipped: []},
          catalog: {codes: ['VALIDATION_FAILED'], skipped: ['confirmation:not_created']},
          structural: {codes: ['ROOT_MISSING', 'SURFACE_NOT_CREATED'], skipped: []},
          binding: {codes: [], skipped: ['confirmation:not_created']},
        },
      ],
    });
  });

  it("find the flawed booking's four distinct defects", () => {
    const {turns} = readRecord('test_data/a2a_capture/v0_1/stub_agent/flawed_booking_a2a_1_0.json');
    const checks = checkTurn(turns[0], []);
    assert.ok(checks);
    const output = '/events/2/attributes/a2ui.wire.message/parts';
    assert.deepEqual(checks.schema.findings, [
      {
        code: 'VALIDATION_FAILED',
        path: `${output}/5/content/updateDataModel`,
        message: "must have required property 'surfaceId'",
      },
    ]);
    assert.deepEqual(checks.catalog, {
      findings: [
        {
          code: 'VALIDATION_FAILED',
          surfaceId: 'booking',
          path: `${output}/2/content/updateComponents/components/3/colour`,
          message: 'must NOT have unevaluated properties: colour',
        },
      ],
      skipped: [{surfaceId: 'confirmation', reason: 'not_created'}],
      legacyForm: [],
    });
    assert.deepEqual(checks.structural, {
      findings: [
        {
          code: 'ROOT_MISSING',
          surfaceId: 'booking',
          message:
            "The surface 'booking' has no component with the id 'root': web core refused the updateComponents that carried one.",
        },
        {
          code: 'SURFACE_NOT_CREATED',
          surfaceId: 'confirmation',
          path: `${output}/4/content/updateComponents`,
          message: "No createSurface in the conversation created the surface 'confirmation'.",
        },
      ],
      skipped: [],
    });
    assert.deepEqual(checks.binding, {
      findings: [],
      skipped: [{surfaceId: 'confirmation', reason: 'not_created'}],
    });
  });
});

describe('the check events', () => {
  it('are four, in order, that the turn record schema accepts, findings ordered with the pathless last', () => {
    // The earlier turn leaves a dangling child and an unfilled binding; this turn adds an unreachable
    // component, so the findings on the earlier turn's components have no path and sort last.
    const earlier = testTurn({
      conversationId: 'c',
      messages: [
        createSurface('s'),
        updateComponents('s', [
          {id: 'root', component: 'Column', children: ['f', 'gone']},
          {id: 'f', component: 'TextField', label: 'Diet', value: {path: '/dietary'}},
        ]),
      ],
    });
    const turn = testTurn({
      conversationId: 'c',
      messages: [
        updateComponents('s', [{id: 'lost', component: 'Text', text: 'Lost'}]),
        updateDataModel('s', {}),
      ],
    });
    const checks = checkTurn(turn, [earlier]);
    assert.ok(checks);
    let n = 0;
    const events = checkEvents(turn.events[0] as TurnEvent, checks, () => ({
      spanId: `cccccccccccccc${String(++n).padStart(2, '0')}`,
      timeUnixNano: 1792576862000000000n + BigInt(n),
    }));
    assert.deepEqual(
      events.map(event => event.attributes['a2ui.check.name']),
      ['schema', 'catalog', 'structural', 'binding'],
    );
    assert.deepEqual(
      events.map(event => event.attributes['a2ui.check.passed']),
      [true, true, false, false],
    );
    assert.equal('a2ui.check.skipped' in events[0].attributes, false);
    assert.deepEqual(events[1].attributes['a2ui.check.skipped'], []);
    assert.deepEqual(
      events.map(event => event.attributes['a2ui.check.legacy_form']),
      [undefined, [], undefined, undefined],
    );
    assert.deepEqual(
      events.map(event => 'a2ui.check.legacy_form' in event.attributes),
      [false, true, false, false],
    );
    assert.deepEqual(
      events[2].attributes['a2ui.check.findings'].map(({code, path: at}) => [
        code,
        at !== undefined,
      ]),
      [
        ['COMPONENT_UNREACHABLE', true],
        ['CHILD_NOT_FOUND', false],
      ],
    );
    assert.deepEqual(
      events[3].attributes['a2ui.check.findings'].map(({code, path: at}) => [code, at]),
      [['BINDING_PATH_UNFILLED', undefined]],
    );
    const record: TurnRecord = {
      version: 'v0.1',
      turns: [earlier, {events: [...turn.events, ...events]}],
    };
    assert.deepEqual(turnRecordErrors(record), []);
  });

  it("judge a turn whose messages declare v1.0, as before the pin's bare 1.0: each message unsupported, no surface created", () => {
    const turn = testTurn({
      messages: [
        {version: 'v1.0', createSurface: {surfaceId: 'card', catalogId: BASIC_V1_0}},
        {
          version: 'v1.0',
          updateComponents: {
            surfaceId: 'card',
            components: [{id: 'root', component: 'Text', text: 'Hello'}],
          },
        },
      ],
    });
    assert.deepEqual(summary(checkTurn(turn, [])), {
      schema: {codes: ['SCHEMA_VERSION_UNSUPPORTED', 'SCHEMA_VERSION_UNSUPPORTED'], skipped: []},
      structural: {codes: [], skipped: ['card:not_created']},
      binding: {codes: [], skipped: ['card:not_created']},
    });
  });

  it('are none for a turn with no protocol version', () => {
    assert.equal(checkTurn(testTurn({messages: []})), undefined);
    assert.ok(checkTurn(testTurn({messages: [], version: 'v0.9'})));
  });
});

describe('the checks after a catalog file was read again', () => {
  it('judge a turn against the definition in force', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-checks-'));
    try {
      const file = path.join(dir, 'notes.json');
      const definition = (components: string[]) =>
        JSON.stringify({
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          catalogId: 'notes',
          components: Object.fromEntries(
            components.map(name => [
              name,
              {type: 'object', properties: {component: {const: name}}, required: ['component']},
            ]),
          ),
          $defs: {anyComponent: {oneOf: components.map(name => ({$ref: `#/components/${name}`}))}},
        });
      fs.writeFileSync(file, definition(['Note']));
      const registry = await CatalogRegistry.load([file]);
      const turn = testTurn({
        version: 'v0.9',
        messages: [
          createSurface('notes', 'notes'),
          updateComponents('notes', [{id: 'root', component: 'Card'}]),
        ],
      });
      const codes = () => checkTurn(turn, [], registry)?.catalog.findings.map(({code}) => code);
      assert.deepEqual(codes(), ['COMPONENT_UNKNOWN']);
      fs.writeFileSync(file, definition(['Note', 'Card']));
      await registry.reread(file);
      assert.deepEqual(codes(), []);
    } finally {
      fs.rmSync(dir, {recursive: true, force: true});
    }
  });
});
