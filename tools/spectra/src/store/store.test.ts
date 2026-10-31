import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {after, describe, it} from 'node:test';

import type {Turn, TurnEvent, TurnRecord} from '../record/turn_record.js';
import {turnRecordErrors} from '../testing/turn_record_schema.js';
import {folderOf, STORE_DIR, StoreError, StoreWriteError, TurnStore} from './store.js';

const dirs: string[] = [];
after(() => {
  for (const dir of dirs) rmSync(dir, {recursive: true, force: true});
});

function workingDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'spectra-store-'));
  dirs.push(dir);
  return dir;
}

/** A one-event turn: its turn event, started at `startMs` milliseconds since the epoch. */
function turnOf(traceDigit: string, startMs: number, conversationId?: string): Turn {
  const start = BigInt(startMs) * 1_000_000n;
  const turnEvent: TurnEvent = {
    traceId: traceDigit.repeat(32),
    spanId: 'b7ad6b7169203331',
    name: 'invoke_agent',
    kind: 3,
    startTimeUnixNano: start.toString(),
    endTimeUnixNano: (start + 5_000_000n).toString(),
    attributes: {
      'a2ui.event.kind': 'turn',
      'gen_ai.operation.name': 'invoke_agent',
      ...(conversationId !== undefined && {'gen_ai.conversation.id': conversationId}),
      'a2ui.turn.outcome': 'completed',
      'a2ui.turn.capture_paths': ['wire'],
      'a2ui.turn.writer.name': 'a2ui-spectra',
      'a2ui.turn.writer.version': '0.0.1',
    },
    status: {code: 1},
  };
  return {events: [turnEvent]};
}

function traceIds(record: TurnRecord): string[] {
  return record.turns.map(turn => turn.events[0].traceId[0]);
}

// 2026-10-24T15:30:12.123Z and the seconds after it.
const T0 = Date.UTC(2026, 9, 24, 15, 30, 12, 123);

describe('the store', () => {
  it('creates its directory with a git-ignore, and its turns directory', async () => {
    const dir = workingDir();
    const store = await TurnStore.open(dir);
    assert.equal(store.dir, path.join(dir, STORE_DIR));
    assert.equal(store.turnsDir, path.join(dir, STORE_DIR, 'turns'));
    const gitignore = readFileSync(path.join(store.dir, '.gitignore'), 'utf8');
    assert.match(gitignore, /^\*$/m);
    assert.ok(existsSync(store.turnsDir));
  });

  it('leaves the git-ignore alone in a directory it did not create', async () => {
    const dir = workingDir();
    mkdirSync(path.join(dir, STORE_DIR));
    await TurnStore.open(dir);
    assert.equal(existsSync(path.join(dir, STORE_DIR, '.gitignore')), false);

    writeFileSync(path.join(dir, STORE_DIR, '.gitignore'), 'turns/old/\n');
    await TurnStore.open(dir);
    assert.equal(readFileSync(path.join(dir, STORE_DIR, '.gitignore'), 'utf8'), 'turns/old/\n');
  });

  it('fails to open, naming its directory, when the directory cannot be created', async () => {
    const dir = workingDir();
    writeFileSync(path.join(dir, STORE_DIR), 'not a directory');
    await assert.rejects(TurnStore.open(dir), (error: unknown) => {
      assert.ok(error instanceof StoreError);
      assert.equal(error.dir, path.join(dir, STORE_DIR));
      assert.match(error.message, /^Spectra cannot create its store at .*\.a2ui-spectra: /);
      return true;
    });
  });

  it('writes a turn into its conversation, named by its start and trace id', async () => {
    const store = await TurnStore.open(workingDir());
    const {stored, record} = await store.write(turnOf('1', T0, 'ctx-1'));
    assert.deepEqual(stored, {
      traceId: '1'.repeat(32),
      conversationId: 'ctx-1',
      startTime: '2026-10-24T15:30:12.123Z',
      file: `ctx-1/2026-10-24T15-30-12.123Z_${'1'.repeat(32)}.json`,
    });
    const written = JSON.parse(
      readFileSync(path.join(store.turnsDir, 'ctx-1', path.basename(stored.file)), 'utf8'),
    ) as TurnRecord;
    assert.deepEqual(written, record);
    assert.deepEqual(turnRecordErrors(written), []);
    assert.deepEqual(readdirSync(path.join(store.turnsDir, 'ctx-1')), [path.basename(stored.file)]);
  });

  it("embeds the conversation's earlier turns from disk, across a restart", async () => {
    const dir = workingDir();
    const first = await TurnStore.open(dir);
    await first.write(turnOf('1', T0, 'ctx-1'));
    const {record: second} = await first.write(turnOf('2', T0 + 1000, 'ctx-1'));
    assert.deepEqual(traceIds(second), ['1', '2']);

    const restarted = await TurnStore.open(dir);
    const {record: third} = await restarted.write(turnOf('3', T0 + 2000, 'ctx-1'));
    assert.deepEqual(traceIds(third), ['1', '2', '3']);
    const {record: other} = await restarted.write(turnOf('4', T0 + 3000, 'ctx-2'));
    assert.deepEqual(traceIds(other), ['4']);
  });

  it("writes one conversation's files one at a time", async () => {
    const store = await TurnStore.open(workingDir());
    const writes = await Promise.all([
      store.write(turnOf('1', T0, 'ctx-1')),
      store.write(turnOf('2', T0 + 1000, 'ctx-1')),
      store.write(turnOf('3', T0 + 2000, 'ctx-1')),
    ]);
    assert.deepEqual(
      writes.map(({record}) => traceIds(record)),
      [['1'], ['1', '2'], ['1', '2', '3']],
    );
  });

  it('passes over a file that does not read as a record for the one before it', async () => {
    const store = await TurnStore.open(workingDir());
    await store.write(turnOf('1', T0, 'ctx-1'));
    writeFileSync(
      path.join(store.turnsDir, 'ctx-1', `2026-10-24T15-30-13.000Z_${'9'.repeat(32)}.json`),
      '{broken',
    );
    const {record} = await store.write(turnOf('2', T0 + 2000, 'ctx-1'));
    assert.deepEqual(traceIds(record), ['1', '2']);
  });

  it('writes a turn with no conversation on its own, beside the conversations', async () => {
    const store = await TurnStore.open(workingDir());
    await store.write(turnOf('1', T0, 'ctx-1'));
    const {stored, record} = await store.write(turnOf('2', T0 + 1000));
    assert.equal(stored.file, `2026-10-24T15-30-13.123Z_${'2'.repeat(32)}.json`);
    assert.equal(stored.conversationId, undefined);
    assert.deepEqual(traceIds(record), ['2']);
    assert.ok(existsSync(path.join(store.turnsDir, stored.file)));
  });

  it('percent-encodes a conversation id that is not safe as a folder name', async () => {
    assert.equal(
      folderOf('8f14e45f-ceea-467f-a0e7-7d8d3b4a1c2e'),
      '8f14e45f-ceea-467f-a0e7-7d8d3b4a1c2e',
    );
    assert.equal(folderOf('ctx_1.v2'), 'ctx_1.v2');
    assert.equal(folderOf('a/b:c'), 'a%2Fb%3Ac');
    assert.equal(folderOf('.hidden'), '%2Ehidden');
    assert.equal(folderOf('50%'), '50%25');
    assert.equal(folderOf('café'), 'caf%C3%A9');

    const store = await TurnStore.open(workingDir());
    const {stored} = await store.write(turnOf('1', T0, 'a/b:c'));
    assert.equal(path.dirname(stored.file), 'a%2Fb%3Ac');
    const [listed] = await store.list();
    assert.equal(listed.conversationId, 'a/b:c');
  });

  it('lists every turn on disk, newest first, from the file names', async () => {
    const dir = workingDir();
    const earlier = await TurnStore.open(dir);
    await earlier.write(turnOf('1', T0, 'ctx-1'));
    await earlier.write(turnOf('2', T0 + 2000));
    const store = await TurnStore.open(dir);
    await store.write(turnOf('3', T0 + 1000, 'ctx-2'));
    await store.write(turnOf('4', T0 + 3000, 'ctx-1'));
    mkdirSync(path.join(store.turnsDir, 'not%2'));
    writeFileSync(path.join(store.turnsDir, 'ctx-1', 'notes.txt'), '');
    writeFileSync(path.join(store.turnsDir, 'ctx-1', `.x_${'5'.repeat(32)}.json.ab12.tmp`), '');

    const listed = await store.list();
    assert.deepEqual(
      listed.map(turn => [turn.traceId[0], turn.conversationId, turn.startTime]),
      [
        ['4', 'ctx-1', '2026-10-24T15:30:15.123Z'],
        ['2', undefined, '2026-10-24T15:30:14.123Z'],
        ['3', 'ctx-2', '2026-10-24T15:30:13.123Z'],
        ['1', 'ctx-1', '2026-10-24T15:30:12.123Z'],
      ],
    );
    assert.deepEqual(traceIds(await store.read(listed[0].file)), ['1', '4']);
  });

  it('keeps a turn it failed to write for this run, and throws naming the file', async () => {
    const store = await TurnStore.open(workingDir());
    writeFileSync(path.join(store.turnsDir, 'ctx-1'), 'not a folder');
    const turn = turnOf('1', T0, 'ctx-1');
    await assert.rejects(store.write(turn), (error: unknown) => {
      assert.ok(error instanceof StoreWriteError);
      assert.equal(
        error.file,
        path.join(store.turnsDir, 'ctx-1', `2026-10-24T15-30-12.123Z_${'1'.repeat(32)}.json`),
      );
      assert.match(error.message, /^Spectra could not write .*\.json: /);
      return true;
    });
    const listed = await store.list();
    assert.deepEqual(
      listed.map(stored => stored.file),
      [`ctx-1/2026-10-24T15-30-12.123Z_${'1'.repeat(32)}.json`],
    );
    assert.deepEqual(await store.read(listed[0].file), {version: 'v0.1', turns: [turn]});

    await assert.rejects(store.write(turnOf('2', T0 + 1000, 'ctx-1')));
    const [latest] = await store.list();
    assert.deepEqual(traceIds(await store.read(latest.file)), ['1', '2']);
  });

  it('amends a turn this run wrote, in its own file and in each later file of its conversation', async () => {
    const store = await TurnStore.open(workingDir());
    const first = turnOf('1', T0, 'ctx-1');
    await store.write(first);
    await store.write(turnOf('2', T0 + 1000, 'ctx-1'));
    const amended = await store.amend('1'.repeat(32), turn => ({
      events: [...turn.events, {...turn.events[0], spanId: '0000000000000009', name: 'later'}],
    }));
    assert.ok(amended);
    assert.deepEqual(amended.previous, first);
    const [latest, own] = await store.list();
    for (const file of [own.file, latest.file]) {
      const record = await store.read(file);
      assert.deepEqual(
        record.turns[0].events.map(event => event.name),
        ['invoke_agent', 'later'],
      );
    }
    assert.deepEqual(traceIds(await store.read(latest.file)), ['1', '2']);
    assert.equal(await store.amend('9'.repeat(32), turn => turn), undefined);
  });

  it('amends a turn once the writes queued before it have finished', async () => {
    const store = await TurnStore.open(workingDir());
    const writing = store.write(turnOf('1', T0, 'ctx-1'));
    const amending = store.amend('1'.repeat(32), turn => ({
      events: [...turn.events, {...turn.events[0], spanId: '0000000000000009', name: 'later'}],
    }));
    await writing;
    assert.ok(await amending);
    const [stored] = await store.list();
    assert.equal((await store.read(stored.file)).turns[0].events.length, 2);
  });
});
