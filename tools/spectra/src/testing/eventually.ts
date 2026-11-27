import assert from 'node:assert/strict';

/** Waits until the check holds, and fails with `what` when it does not within five seconds. */
export async function eventually(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!check()) {
    assert.ok(Date.now() < deadline, what);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
