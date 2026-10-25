import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

import type {TurnRecord} from '../record/turn_record.js';
import {rejectionCount} from './rejections.js';

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
  it("counts each turn's messages the processor rejects in sub-task 2.3's recordings", () => {
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
    });
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
