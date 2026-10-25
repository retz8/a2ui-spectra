import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {readRecording} from '../testing/recordings.ts';
import {isTurnEvent, type Turn, unixMillis} from './record.ts';
import {deliveryLabel, isThrough, replyThrough, type TimelineRow, timelineOf} from './steps.ts';

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
