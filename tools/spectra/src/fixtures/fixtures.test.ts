import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {after, describe, it} from 'node:test';

import type {TurnRecord} from '../record/turn_record.js';
import {testTurn} from '../testing/turns.js';
import {
  FixtureClashError,
  FixtureNameError,
  FixtureNotFoundError,
  FixtureReadError,
  FixturesFolder,
  isFixtureName,
  slugOf,
} from './fixtures.js';

const dirs: string[] = [];
after(() => {
  for (const dir of dirs) rmSync(dir, {recursive: true, force: true});
});

function freshDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'spectra-fixtures-'));
  dirs.push(dir);
  return dir;
}

const record: TurnRecord = {version: 'v0.1', turns: [testTurn({version: 'v0.9'})]};

function folderIn(cwd: string, name = 'a2ui-spectra-fixtures'): FixturesFolder {
  return new FixturesFolder(path.join(cwd, name), cwd);
}

describe('the fixture name', () => {
  it("allows ASCII letters, digits, '-', '_' and '.', not starting with a dot, as the store's folder rule does", () => {
    for (const name of ['find-italian-restaurants', 'book_a_table.2', 'A1', '-x', '_']) {
      assert.equal(isFixtureName(name), true, name);
    }
    for (const name of ['', '.hidden', 'a b', 'a/b', '한글', 'name.json?', 'é']) {
      assert.equal(isFixtureName(name), false, name);
    }
  });

  it("slugs the turn's input in brief: lowercase ASCII letters and digits joined by '-', cut at a '-' near forty characters", () => {
    assert.equal(slugOf({text: 'Book a table for 2!'}), 'book-a-table-for-2');
    assert.equal(
      slugOf({text: '  Find   the top-10 Chinese restaurants in the US, please. '}),
      'find-the-top-10-chinese-restaurants-in',
    );
    assert.equal(slugOf({text: 'x'.repeat(60)}), 'x'.repeat(40));
    assert.equal(slugOf({action: 'submit_booking'}), 'submit-booking');
  });

  it("falls back to 'turn' when nothing survives: a Korean text, a part type, no input", () => {
    assert.equal(slugOf({text: '이탈리아 식당 찾아줘'}), 'turn');
    assert.equal(slugOf({partType: 'blob'}), 'turn');
    assert.equal(slugOf(undefined), 'turn');
  });
});

describe('the fixtures folder', () => {
  it('shows its path relative to the working directory when under it, else absolute', () => {
    const cwd = freshDir();
    assert.equal(folderIn(cwd).display, 'a2ui-spectra-fixtures');
    assert.equal(folderIn(cwd, path.join('nested', 'fx')).display, path.join('nested', 'fx'));
    const elsewhere = freshDir();
    assert.equal(new FixturesFolder(elsewhere, cwd).display, elsewhere);
  });

  it('saves a record whole under <name>.json, creating the folder, and answers the name and the path written', async () => {
    const cwd = freshDir();
    const folder = folderIn(cwd);
    assert.deepEqual(await folder.save(record, 'find-italian-restaurants'), {
      name: 'find-italian-restaurants',
      path: path.join('a2ui-spectra-fixtures', 'find-italian-restaurants.json'),
    });
    const file = path.join(cwd, 'a2ui-spectra-fixtures', 'find-italian-restaurants.json');
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), record);
    assert.ok(readFileSync(file, 'utf8').endsWith('\n'));
  });

  it('refuses a name outside the rule, and a clash, offering the first free numbered name', async () => {
    const cwd = freshDir();
    const folder = folderIn(cwd);
    await assert.rejects(folder.save(record, 'a b'), (error: unknown) => {
      assert.ok(error instanceof FixtureNameError);
      assert.equal(
        error.message,
        "A fixture's name uses letters, digits, '-', '_' and '.', and does not start with a dot.",
      );
      return true;
    });
    await folder.save(record, 'book-a-table-for-2');
    await assert.rejects(folder.save(record, 'book-a-table-for-2'), (error: unknown) => {
      assert.ok(error instanceof FixtureClashError);
      assert.equal(error.message, 'a2ui-spectra-fixtures/book-a-table-for-2.json exists already.');
      assert.equal(error.suggested, 'book-a-table-for-2-2');
      return true;
    });
    await folder.save(record, 'book-a-table-for-2-2');
    assert.equal(await folder.suggestedName('book-a-table-for-2'), 'book-a-table-for-2-3');
    assert.equal(await folder.suggestedName('fresh'), 'fresh');
  });

  it('lists every .json under the folder recursively in path order, each by its relative path without .json, with its modification time and its record', async () => {
    const cwd = freshDir();
    const folder = folderIn(cwd);
    assert.deepEqual(await folder.list(), {folder: 'a2ui-spectra-fixtures', fixtures: []});
    await folder.save(record, 'zebra');
    mkdirSync(path.join(folder.dir, 'booking'));
    const nested = path.join(folder.dir, 'booking', 'table-for-2.json');
    writeFileSync(nested, JSON.stringify(record));
    writeFileSync(path.join(folder.dir, 'notes.txt'), 'not a fixture');
    writeFileSync(path.join(folder.dir, 'broken.json'), '{not json');
    writeFileSync(
      path.join(folder.dir, 'other.json'),
      JSON.stringify({version: 'v0.2', turns: []}),
    );
    const saved = new Date('2026-11-05T14:02:00.000Z');
    utimesSync(nested, saved, saved);

    const listing = await folder.list();
    assert.equal(listing.folder, 'a2ui-spectra-fixtures');
    assert.deepEqual(
      listing.fixtures.map(fixture => [fixture.name, fixture.path]),
      [
        ['booking/table-for-2', path.join('a2ui-spectra-fixtures', 'booking', 'table-for-2.json')],
        ['broken', path.join('a2ui-spectra-fixtures', 'broken.json')],
        ['other', path.join('a2ui-spectra-fixtures', 'other.json')],
        ['zebra', path.join('a2ui-spectra-fixtures', 'zebra.json')],
      ],
    );
    const [table, broken, other, zebra] = listing.fixtures;
    assert.equal(table.savedAt, '2026-11-05T14:02:00.000Z');
    assert.deepEqual(table.record, record);
    assert.equal(table.error, undefined);
    assert.deepEqual(zebra.record, record);
    assert.equal(broken.record, undefined);
    assert.match(broken.error ?? '', /^The file is not JSON: /);
    assert.equal(other.record, undefined);
    assert.equal(other.error, 'The file is not a turn record v0.1: its version is v0.2.');
  });

  it('reads a fixture by its name, and says when there is none or it does not read as a record', async () => {
    const cwd = freshDir();
    const folder = folderIn(cwd);
    await folder.save(record, 'hello');
    assert.deepEqual(await folder.read('hello'), {
      record,
      path: path.join('a2ui-spectra-fixtures', 'hello.json'),
    });
    await assert.rejects(folder.read('missing'), (error: unknown) => {
      assert.ok(error instanceof FixtureNotFoundError);
      assert.equal(error.message, 'No fixture is named missing.');
      return true;
    });
    writeFileSync(path.join(folder.dir, 'bad.json'), '[]');
    await assert.rejects(folder.read('bad'), (error: unknown) => {
      assert.ok(error instanceof FixtureReadError);
      assert.equal(error.message, 'The file is not a turn record v0.1: it is not an object.');
      return true;
    });
    writeFileSync(path.join(folder.dir, 'my notes.json'), JSON.stringify(record));
    assert.equal((await folder.read('my notes')).record.version, 'v0.1');
    await assert.rejects(folder.read('../hello'), FixtureNameError);
    await assert.rejects(folder.read('..'), FixtureNameError);
  });

  it('watches the folder, once it exists, and says when files join or leave it', async () => {
    const cwd = freshDir();
    const folder = folderIn(cwd);
    let changes = 0;
    const watching = folder.watch(() => changes++, 50);
    try {
      await watching.ready;
      // The folder appears with its first file.
      await told(
        () => changes,
        async () => {
          rmSync(folder.dir, {recursive: true, force: true});
          await folder.save(record, 'first');
        },
      );
      // Files join it, nested and at the top.
      const nested = path.join(folder.dir, 'nested', 'second.json');
      await told(
        () => changes,
        () => {
          mkdirSync(path.dirname(nested), {recursive: true});
          writeFileSync(nested, JSON.stringify(record));
          writeFileSync(path.join(folder.dir, 'third.json'), JSON.stringify(record));
        },
      );
      // A file leaves it.
      await told(
        () => changes,
        () => {
          writeFileSync(path.join(folder.dir, 'third.json'), JSON.stringify(record));
          rmSync(path.join(folder.dir, 'third.json'));
        },
      );
    } finally {
      watching.stop();
    }
    const after = changes;
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(changes, after, 'Nothing is said once the watch has stopped.');
  });
});

/**
 * Resolves once a change is told. On macOS a watch reports nothing for a
 * moment after it is set up, with no sign of when it begins (nodejs/node
 * issue 52601), so the change is made again until it is told: no wait here
 * rests on how fast the machine is.
 */
async function told(
  count: () => number,
  change: () => void | Promise<void>,
  timeoutMs = 20_000,
): Promise<void> {
  const before = count();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await change();
    const again = Date.now() + 500;
    while (Date.now() < again) {
      if (count() > before) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(Date.now() < deadline, 'The change was told.');
  }
}
