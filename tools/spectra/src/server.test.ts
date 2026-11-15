import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {listenError, PortTakenError} from './server.js';

describe("a listener's error", () => {
  const errorWith = (code: string): NodeJS.ErrnoException =>
    Object.assign(new Error(`listen ${code}`), {code});

  it('is a port that is taken when another process holds it', () => {
    const error = listenError(errorWith('EADDRINUSE'), 9821);
    assert.ok(error instanceof PortTakenError);
    assert.equal(error.port, 9821);
    assert.equal(error.refused, false);
    assert.equal(error.message, 'Port 9821 is taken.');
  });

  it('is a port the system would not give when it answers with an access error, as Windows does', () => {
    const error = listenError(errorWith('EACCES'), 9821);
    assert.ok(error instanceof PortTakenError);
    assert.equal(error.refused, true);
    assert.equal(error.message, 'The system would not give port 9821.');
  });

  it('is the error itself otherwise', () => {
    const other = errorWith('EADDRNOTAVAIL');
    assert.equal(listenError(other, 9821), other);
  });
});
