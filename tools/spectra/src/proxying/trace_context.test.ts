import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {formatTraceparent, parseTraceparent} from './trace_context.js';

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const PARENT = '00f067aa0ba902b7';

describe('traceparent', () => {
  it('reads a version-00 header', () => {
    assert.deepEqual(parseTraceparent(`00-${TRACE}-${PARENT}-01`), {
      traceId: TRACE,
      parentId: PARENT,
      sampled: true,
    });
    assert.deepEqual(parseTraceparent(` 00-${TRACE}-${PARENT}-00 `), {
      traceId: TRACE,
      parentId: PARENT,
      sampled: false,
    });
    assert.equal(parseTraceparent([`00-${TRACE}-${PARENT}-01`, 'x'])?.traceId, TRACE);
  });

  it('reads a later version by its first four fields', () => {
    assert.equal(parseTraceparent(`01-${TRACE}-${PARENT}-01-extra`)?.traceId, TRACE);
    assert.equal(parseTraceparent(`cc-${TRACE}-${PARENT}-01`)?.parentId, PARENT);
  });

  it('counts a header that does not parse as absent', () => {
    for (const bad of [
      undefined,
      '',
      'nonsense',
      `00-${TRACE.toUpperCase()}-${PARENT}-01`,
      `00-${TRACE}-${PARENT}-01-extra`,
      `ff-${TRACE}-${PARENT}-01`,
      `00-${'0'.repeat(32)}-${PARENT}-01`,
      `00-${TRACE}-${'0'.repeat(16)}-01`,
      `00-${TRACE.slice(1)}-${PARENT}-01`,
      `00-${TRACE}-${PARENT}-1`,
    ]) {
      assert.equal(parseTraceparent(bad), undefined, String(bad));
    }
  });

  it('writes a sampled version-00 header', () => {
    assert.equal(formatTraceparent(TRACE, PARENT), `00-${TRACE}-${PARENT}-01`);
  });
});
