import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {parse, promptGeneration} from '../testing/a2ui_step.ts';
import {a2uiDelivery, at, byStart, receivedSpan} from '../testing/model_calls.ts';
import {readRecording} from '../testing/recordings.ts';
import {isTurnEvent, type Turn, unixMillis} from './record.ts';
import {
  deliveryLabel,
  isThrough,
  replyThrough,
  type Step,
  type TimelineRow,
  timelineOf,
} from './steps.ts';

function lastTurn(name: string): Turn {
  const {turns} = readRecording(name);
  return turns[turns.length - 1];
}

function timeline(turn: Turn): TimelineRow[] {
  const event = turn.events.find(isTurnEvent);
  assert.ok(event);
  return timelineOf(turn.events, unixMillis(event.startTimeUnixNano));
}

/** The rows as lines: a delivery's label, or a step's label and target, its delivery's steps indented. */
function outline(rows: readonly TimelineRow[]): string[] {
  return rows.map(row =>
    row.row === 'delivery'
      ? `${deliveryLabel(row)} +${row.offsetMs}`
      : `${row.grouped ? '  ' : ''}${row.label} | ${row.target}${row.offsetMs === undefined ? '' : ` +${row.offsetMs}`}`,
  );
}

describe('timelineOf', () => {
  it('groups the steps of a delivery with several under it, a data part among them', () => {
    const rows = timeline(lastTurn('file_upload_summarizer/artifact_stream_and_send'));
    assert.deepEqual(outline(rows).slice(0, 4), [
      'Input | Show me the file uploader again +1',
      'Delivery · 6 parts +2',
      outline(rows)[2],
      '  Data | id, args, name',
    ]);
    assert.match(outline(rows)[2], /^ {2}Text \| “Okay, here's my interpretation/);
    assert.deepEqual(outline(rows).slice(4), [
      '  createSurface | file_upload_surface_b88930f6',
      '  updateComponents | file_upload_surface_b88930f6 · 4 components',
      '  createSurface | file_upload_surface_b88930f6',
      '  updateComponents | file_upload_surface_b88930f6 · 4 components',
      'Completed | the turn ended +3',
    ]);
  });

  it("names an action's input and counts the messages of a part that holds an array", () => {
    assert.deepEqual(outline(timeline(lastTurn('strathweb_booking_wizard/send_then_stream'))), [
      'Input | Action “next” · table_booking +1',
      'Text | “” +2',
      'Delivery · 1 part, 3 messages +3',
      '  updateComponents | table_booking · 9 components',
      '  updateDataModel | table_booking · /step',
      '  updateDataModel | table_booking · /stepLabel',
      'Completed | the turn ended +4',
    ]);
  });

  it('shows a delivery with no parts as a status update, and a cancelled turn', () => {
    assert.deepEqual(outline(timeline(lastTurn('stub_agent/cancel_a2a_1_0'))), [
      'Input | start +1',
      'Status update |  +2',
      'Text | “Working until you cancel.” +3',
      'Text | “Cancelled.” +4',
      'Cancelled | the turn ended +5',
    ]);
  });

  it('ends a failed turn with its reason, and keys each message by where it sits', () => {
    const rows = timeline(lastTurn('ag2/stream_v1_0_failed'));
    assert.equal(outline(rows)[rows.length - 1], 'Turn failed | The scripted model failed. +6');
    const call = timeline(lastTurn('ag2/stream_v1_0_function_call')).find(
      row => row.row === 'step' && row.label === 'callFunction',
    );
    assert.equal(call?.row === 'step' && call.messageKey, '4.1.2');
    assert.deepEqual(call?.row === 'step' && call.position, {
      eventIndex: 4,
      partIndex: 1,
      index: 2,
    });
  });

  it('shows a file part as a File step with its name and MIME type', () => {
    const turn: Turn = {
      events: [
        {
          traceId: '0'.repeat(32),
          spanId: '1'.repeat(16),
          name: 'wire_output',
          kind: 1,
          startTimeUnixNano: '1792800000002000000',
          attributes: {
            'a2ui.event.kind': 'wire_output',
            'a2ui.wire.message': {
              role: 'assistant',
              parts: [
                {
                  type: 'uri',
                  modality: 'document',
                  mime_type: 'application/pdf',
                  uri: 'https://x/a.pdf',
                  name: 'a.pdf',
                },
              ],
            },
          },
        },
      ],
    };
    assert.deepEqual(outline(timelineOf(turn.events, 1792800000000)), [
      'File | a.pdf · application/pdf +2',
    ]);
  });
});

describe('isThrough', () => {
  it('orders positions by event, then part, then index', () => {
    assert.ok(isThrough({eventIndex: 1, partIndex: 3}, {eventIndex: 2, partIndex: 0}));
    assert.ok(
      isThrough({eventIndex: 2, partIndex: 0, index: 1}, {eventIndex: 2, partIndex: 0, index: 1}),
    );
    assert.ok(
      !isThrough({eventIndex: 2, partIndex: 0, index: 2}, {eventIndex: 2, partIndex: 0, index: 1}),
    );
    assert.ok(isThrough({eventIndex: 2, partIndex: 5}, {eventIndex: 2}));
    assert.ok(!isThrough({eventIndex: 3}, {eventIndex: 2}));
  });
});

describe('replyThrough', () => {
  it("joins the agent's text parts up to a position", () => {
    const turn = lastTurn('stub_agent/cancel_a2a_1_0');
    assert.equal(
      replyThrough(turn.events, {eventIndex: 3, partIndex: 0}),
      'Working until you cancel.',
    );
    assert.equal(replyThrough(turn.events), 'Working until you cancel.Cancelled.');
    assert.equal(replyThrough(turn.events, {eventIndex: 1}), '');
  });
});

describe("the A2UI step's rows", () => {
  const GOOD = '<a2ui>\nroot = Text("hi")\n</a2ui>';

  it('rows a parse by its format, streamed when it was, and nothing for a parse that names no format', () => {
    const events = byStart(
      a2uiDelivery('delivery', 2000),
      parse({
        spanId: 'p1',
        start: 1010,
        end: 1020,
        input: GOOD,
        format: 'express',
        chunks: [{ms: 1012, end: 30}],
      }),
      parse({spanId: 'p2', start: 1500, end: 1510, input: GOOD, format: 'direct_json'}),
    );
    const bare = parse({spanId: 'p3', start: 1600, end: 1610, input: GOOD});
    delete bare.attributes['a2ui.parse.inference_format'];
    const rows = timelineOf([...events, bare], unixMillis(at(0)));
    assert.deepEqual(outline(rows).slice(0, 3), [
      'Parse | Express · streamed +1010',
      'Parse | Direct JSON +1500',
      'Parse |  +1600',
    ]);
    const [first] = rows as Step[];
    assert.equal(first.kind, 'parse');
    assert.equal(first.icon, 'parse');
    assert.equal(first.id, 'p1');
    assert.equal(first.parse?.spanId, 'p1');
  });

  it("rows the toolset's tool call as its parse, joined to the tool span it sits under, or that shares its call id", () => {
    const span = receivedSpan({
      spanId: 'tool-span',
      name: 'execute_tool send_a2ui_json_to_client',
      kind: 'tool_call',
      start: 100,
      end: 300,
      names: {'gen_ai.tool.name': 'send_a2ui_json_to_client', 'gen_ai.tool.call.id': 'c1'},
    });
    const underIt = parse({
      spanId: 'p1',
      start: 150,
      end: 250,
      input: GOOD,
      entryPoint: 'tool_call',
      tool: {name: 'send_a2ui_json_to_client'},
      parentSpanId: 'tool-span',
    });
    const rows = timelineOf(byStart(span, underIt), unixMillis(at(0)));
    assert.deepEqual(outline(rows), ['Parse | send_a2ui_json_to_client · Direct JSON +100']);
    const [row] = rows as Step[];
    assert.equal(row.id, 'p1');
    assert.deepEqual(row.aliases, ['tool-span', 'p1']);
    assert.equal(row.call?.spans[0].spanId, 'tool-span');
    assert.equal(row.parse?.spanId, 'p1');

    const byCallId = parse({
      spanId: 'p2',
      start: 150,
      end: 250,
      input: GOOD,
      entryPoint: 'tool_call',
      tool: {name: 'send_a2ui_json_to_client', callId: 'c1'},
    });
    assert.deepEqual(outline(timelineOf(byStart(span, byCallId), unixMillis(at(0)))), [
      'Parse | send_a2ui_json_to_client · Direct JSON +100',
    ]);

    const alone = parse({
      spanId: 'p3',
      start: 150,
      end: 250,
      input: GOOD,
      entryPoint: 'tool_call',
      tool: {name: 'send_a2ui_json_to_client', callId: 'other'},
    });
    assert.deepEqual(outline(timelineOf(byStart(span, alone), unixMillis(at(0)))), [
      'send_a2ui_json_to_client | in the agent +100',
      'Parse | send_a2ui_json_to_client · Direct JSON +150',
    ]);
  });

  it('rows a failed prompt generation, and no prompt generation that succeeded', () => {
    const events = byStart(
      promptGeneration({spanId: 'g1', start: 10, format: 'express'}),
      promptGeneration({
        spanId: 'g2',
        start: 20,
        failure: {
          type: 'A2uiCatalogError',
          message: 'Catalog example.com:contacts declares no components.',
        },
      }),
    );
    const rows = timelineOf(events, unixMillis(at(0)));
    assert.deepEqual(outline(rows), ['Prompt generation | Direct JSON +20']);
    const [row] = rows as Step[];
    assert.equal(row.kind, 'prompt');
    assert.equal(row.icon, 'prompt');
    assert.equal(row.generation?.spanId, 'g2');
  });

  it('places a parse at the last wire message traced to it, else at the last delivery started by its end', () => {
    const first = {version: 'v0.9', createSurface: {surfaceId: 'a', catalogId: 'x'}};
    const second = {version: 'v0.9', createSurface: {surfaceId: 'b', catalogId: 'x'}};
    const events = byStart(
      parse({spanId: 'p1', start: 10, end: 20, input: GOOD, messages: [first]}),
      a2uiDelivery('d1', 100, first),
      parse({spanId: 'p2', start: 110, end: 120, input: GOOD, messages: [second]}),
      a2uiDelivery('d2', 200, second),
      parse({spanId: 'p3', start: 210, end: 220, input: GOOD}),
    );
    const steps = timelineOf(events, unixMillis(at(0))).filter(
      (row): row is Step => row.row === 'step' && row.kind === 'parse',
    );
    // d1 traces to p1 and d2 to p2; p3 traces to no delivery and sits after d2.
    assert.deepEqual(
      steps.map(step => step.position),
      [{eventIndex: 1}, {eventIndex: 3}, {eventIndex: 3}],
    );
  });
});
