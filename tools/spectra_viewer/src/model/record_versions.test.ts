import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describe, it} from 'node:test';

import {
  isNewerRecordVersion,
  newerStepVersionOf,
  READ_RECORD_VERSIONS,
  readRecordVersionsText,
  type TurnRecordEvent,
} from './record.ts';
import {rowTextOf} from './turn_groups.ts';

/** A framework span the receiver kept for a span of the A2UI step, with its attributes as received. */
function kept(received: Record<string, unknown>): TurnRecordEvent {
  return {
    traceId: 'a'.repeat(32),
    spanId: '1'.repeat(16),
    name: String(received['a2ui.event.kind']),
    kind: 1,
    startTimeUnixNano: '1000',
    endTimeUnixNano: '2000',
    attributes: {
      'a2ui.event.kind': 'framework_span',
      'otel.scope.name': 'a2ui-spectra-instrumentation',
      'a2ui.received.attributes': received,
    },
  } as TurnRecordEvent;
}

describe('the turn record versions this Spectra reads', () => {
  it("are the tool's own", () => {
    const tool = readFileSync(
      new URL('../../../spectra/src/record/versions.ts', import.meta.url),
      'utf8',
    );
    const listed = /READ_VERSIONS: readonly string\[\] = \[([^\]]*)\]/.exec(tool)?.[1];
    assert.ok(listed !== undefined, "the tool's list is found");
    assert.deepEqual(
      [...listed.matchAll(/'([^']+)'/g)].map(match => match[1]),
      [...READ_RECORD_VERSIONS],
    );
    assert.equal(readRecordVersionsText(), 'v0.1');
  });

  it('are older than a newer version, one that differs in its third part alone included', () => {
    assert.equal(isNewerRecordVersion('v0.2'), true);
    assert.equal(isNewerRecordVersion('v0.1.1'), true);
    assert.equal(isNewerRecordVersion('v1.0'), true);
    for (const value of ['v0.1', 'v0.1.0', 'v0.0', '0.2', 'latest', 2, undefined]) {
      assert.equal(isNewerRecordVersion(value), false, String(value));
    }
  });
});

describe("a turn's A2UI step reported under a newer turn record", () => {
  it('is the newest newer version a kept span of the step states', () => {
    const events = [
      kept({'a2ui.event.kind': 'parse', 'a2ui.record.version': 'v0.2'}),
      kept({'a2ui.event.kind': 'prompt_generation', 'a2ui.record.version': 'v0.3'}),
      kept({'a2ui.event.kind': 'parse', 'a2ui.record.version': 'v0.1.1'}),
    ];
    assert.equal(newerStepVersionOf(events), 'v0.3');
  });

  it('is none for a half-formed span, one of another kind, or one of a version this Spectra reads', () => {
    assert.equal(
      newerStepVersionOf([
        kept({'a2ui.event.kind': 'parse'}),
        kept({'a2ui.event.kind': 'parse', 'a2ui.record.version': 'v0.1'}),
        kept({'a2ui.event.kind': 'parse', 'a2ui.record.version': 'v0.0'}),
        kept({'a2ui.event.kind': 'invoke_agent', 'a2ui.record.version': 'v0.2'}),
      ]),
      undefined,
    );
  });
});

describe('a stored turn of a newer turn record in the list', () => {
  it('reads the newer line in place of its input', () => {
    assert.equal(
      rowTextOf({traceId: 'b'.repeat(32), startTime: '2026-11-21T09:00:00.000Z', newer: 'v0.2'}),
      'Turn record v0.2 · newer than this Spectra reads',
    );
    assert.equal(
      rowTextOf({traceId: 'b'.repeat(32), startTime: '2026-11-21T09:00:00.000Z'}),
      'Waiting for its input',
    );
  });
});
