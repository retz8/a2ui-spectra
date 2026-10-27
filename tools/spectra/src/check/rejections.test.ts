import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

import {CatalogRegistry} from '../catalog/registry.js';
import type {Turn, TurnRecord, TurnRecordEvent} from '../record/turn_record.js';
import {rejectionCount} from './rejections.js';

const CIRCLECI = path.join(
  findConformanceDir(),
  'test_data/catalogs/a2uiverse_circleci_v0_9_1.json',
);
const CIRCLECI_ID =
  'https://github.com/retz8/a2uiverse-apps/blob/main/circleci/circleci-catalog/catalogs/v0.9.1/catalog.json';
const BASIC_V0_9_1 = 'https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json';

/** A turn whose host message carries these capabilities and whose one wire output holds these A2UI messages. */
function turnOf(capabilities: Record<string, unknown> | undefined, ...messages: unknown[]): Turn {
  const input: TurnRecordEvent = {
    traceId: '0'.repeat(32),
    spanId: '1'.repeat(16),
    parentSpanId: '2'.repeat(16),
    name: 'wire_input',
    kind: 1,
    startTimeUnixNano: '1792800000000000000',
    attributes: {
      'a2ui.event.kind': 'wire_input',
      'a2ui.wire.message': {role: 'user', parts: [{type: 'text', content: 'Hi'}]},
      ...(capabilities !== undefined && {'a2ui.wire.capabilities': capabilities}),
    },
  };
  const output: TurnRecordEvent = {
    traceId: '0'.repeat(32),
    spanId: '3'.repeat(16),
    parentSpanId: '2'.repeat(16),
    name: 'wire_output',
    kind: 1,
    startTimeUnixNano: '1792800000000000000',
    attributes: {
      'a2ui.event.kind': 'wire_output',
      'a2ui.wire.message': {role: 'assistant', parts: [{type: 'a2ui', content: messages}]},
    },
  };
  return {events: [input, output]};
}

/** A v0.9 surface on a catalog, with one Text whose `colour` no catalog defines. */
function badText(catalogId: string): unknown[] {
  return [
    {version: 'v0.9', createSurface: {surfaceId: 's', catalogId}},
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 's',
        components: [{id: 'root', component: 'Text', text: 'Hi', colour: 'red'}],
      },
    },
  ];
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

const RECORDINGS = path.join(findConformanceDir(), 'test_data/a2a_capture/v0_1');

function readRecording(file: string): TurnRecord {
  return JSON.parse(fs.readFileSync(path.join(RECORDINGS, file), 'utf8')) as TurnRecord;
}

describe('rejectionCount', () => {
  it("counts each turn's messages the processor rejects in the coverage roster's recordings", () => {
    const files = fs
      .readdirSync(RECORDINGS, {recursive: true, encoding: 'utf8'})
      .filter(file => file.endsWith('.json'))
      .sort();
    const counts = Object.fromEntries(
      files.map(file => {
        const {turns} = readRecording(file);
        return [file, turns.map((turn, index) => rejectionCount(turn, turns.slice(0, index)))];
      }),
    );
    assert.deepEqual(counts, {
      'a2term_examplesvc/send_multipart_and_tagged_text.json': [1, 0],
      'a2uiverse_circleci/runs_then_confirm_rerun.json': [0, 0],
      'ag2/send_v0_9_1_card.json': [0],
      'ag2/stream_v1_0_failed.json': [0],
      'ag2/stream_v1_0_function_call.json': [1],
      'angular_client/python_restaurant_finder_booking.json': [1, 1, 1],
      'custom_components/action_then_model_turn.json': [0, 0],
      'file_upload_summarizer/artifact_stream_and_send.json': [1, 1],
      'node_restaurant_finder/send_task_history_and_failed.json': [0, 0],
      'node_restaurant_finder/stream_v1_0_booking.json': [0, 1],
      'react_client/node_restaurant_finder_text_and_action.json': [0, 1],
      'strathweb_booking_wizard/send_then_stream.json': [0, 0],
      'stub_agent/cancel_a2a_0_3.json': [0],
      'stub_agent/cancel_a2a_1_0.json': [0],
      'stub_agent/flawed_booking_a2a_1_0.json': [3],
    });
  });

  it('counts the same with the built-in registry as with none', () => {
    const registry = CatalogRegistry.builtIn();
    const wizard = readRecording('strathweb_booking_wizard/send_then_stream.json').turns;
    assert.equal(rejectionCount(wizard[1], wizard.slice(0, 1), registry), 0);
    const flawed = readRecording('stub_agent/flawed_booking_a2a_1_0.json').turns;
    assert.equal(rejectionCount(flawed[0], [], registry), 3);
  });

  it("rejects a bad property on a configured catalog's component, which a stand-in lets through", async () => {
    const turn = turnOf(undefined, ...badText(CIRCLECI_ID));
    assert.equal(rejectionCount(turn, [], CatalogRegistry.builtIn()), 0);
    assert.equal(rejectionCount(turn, [], await CatalogRegistry.load([CIRCLECI])), 1);
  });

  it('knows the v0.9 basic catalog under its v0.9.1 URL', () => {
    assert.equal(
      rejectionCount(turnOf(undefined, ...badText(BASIC_V0_9_1)), [], CatalogRegistry.builtIn()),
      1,
    );
  });

  it("builds the catalogs the host sent inline, in the turn's message and in earlier turns'", () => {
    const inline = {
      'v0.9': {
        supportedCatalogIds: [],
        inlineCatalogs: [
          {
            catalogId: 'inline/notes',
            components: {
              Text: {
                type: 'object',
                properties: {component: {const: 'Text'}, text: {type: 'string'}},
                additionalProperties: false,
              },
            },
          },
        ],
      },
    };
    const registry = CatalogRegistry.builtIn();
    const own = turnOf(inline, ...badText('inline/notes'));
    assert.equal(rejectionCount(own, [], registry), 1);
    assert.equal(rejectionCount(turnOf(undefined, ...badText('inline/notes')), [], registry), 0);
    const earlier = turnOf(inline, {
      version: 'v0.9',
      createSurface: {surfaceId: 'e', catalogId: 'inline/notes'},
    });
    const later = turnOf(undefined, ...badText('inline/notes'));
    assert.equal(rejectionCount(later, [earlier], registry), 1);
  });

  it("feeds the conversation's earlier turns first", () => {
    // The wizard's second turn updates the surface its first turn created.
    const wizard = readRecording('strathweb_booking_wizard/send_then_stream.json').turns;
    assert.equal(rejectionCount(wizard[1]), 3);
    assert.equal(rejectionCount(wizard[1], wizard.slice(0, 1)), 0);
    // The TypeScript restaurant finder's stub creates stub-notice again in its second turn.
    const booking = readRecording('node_restaurant_finder/stream_v1_0_booking.json').turns;
    assert.equal(rejectionCount(booking[1]), 0);
    assert.equal(rejectionCount(booking[1], booking.slice(0, 1)), 1);
  });
});
