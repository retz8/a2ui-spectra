import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {after, describe, it} from 'node:test';

import {startCatalogWatch} from './watch.js';

const dirs: string[] = [];
after(() => {
  for (const dir of dirs) rmSync(dir, {recursive: true, force: true});
});

function freshDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'spectra-catalog-watch-'));
  dirs.push(dir);
  return dir;
}

/** The system's watch, stood in for: each folder asked for, with a way to hand it an event or a failure. */
function fakeSystem(refuse?: Error) {
  const opened = new Map<
    string,
    {recursive: boolean; closed: boolean; emit(name: string | null): void; fail(error: Error): void}
  >();
  const open = (
    folder: string,
    options: {recursive: boolean},
    listener: (event: string, name: string | null) => void,
  ) => {
    if (refuse !== undefined) throw refuse;
    const entry = {
      recursive: options.recursive,
      closed: false,
      emit: (name: string | null) => listener('change', name),
      fail: (error: Error) => void watcher.emit('error', error),
    };
    const watcher = Object.assign(new EventEmitter(), {
      close: () => {
        entry.closed = true;
      },
      unref: () => {},
    });
    opened.set(folder, entry);
    return watcher;
  };
  return {opened, open};
}

function watching(files: string[], system: ReturnType<typeof fakeSystem>) {
  const changes: string[] = [];
  const lines: string[] = [];
  const watch = startCatalogWatch({
    files,
    onChange: file => changes.push(file),
    log: line => lines.push(line),
    open: system.open,
  });
  return {changes, lines, watch};
}

describe("the catalog files' own watch", () => {
  it('asks for one watch, not recursive, of each folder that holds a catalog file, shared by its files', () => {
    const dir = freshDir();
    mkdirSync(path.join(dir, 'catalogs'));
    const system = fakeSystem();
    const {watch} = watching(
      [path.join(dir, 'a.json'), path.join(dir, 'catalogs', 'b.json'), path.join(dir, 'c.json')],
      system,
    );
    assert.deepEqual(
      [...system.opened].map(([folder, {recursive}]) => [folder, recursive]),
      [
        [dir, false],
        [path.join(dir, 'catalogs'), false],
      ],
    );
    watch.stop();
    assert.ok([...system.opened.values()].every(entry => entry.closed));
  });

  it("tells a catalog file's change once, a quiet spell after its last event, and nothing for another file", ({
    mock,
  }) => {
    mock.timers.enable({apis: ['setTimeout']});
    const dir = freshDir();
    const file = path.join(dir, 'catalog.json');
    const system = fakeSystem();
    const {changes, lines, watch} = watching([file], system);
    const folder = system.opened.get(dir);
    assert.ok(folder);
    folder.emit('catalog.json');
    mock.timers.tick(60);
    folder.emit('catalog.json');
    folder.emit('agent.py');
    mock.timers.tick(99);
    assert.deepEqual(changes, [], 'Each event starts the spell again.');
    mock.timers.tick(1);
    assert.deepEqual(changes, [file]);
    mock.timers.tick(500);
    assert.deepEqual(changes, [file], 'Another file of the folder tells nothing.');
    assert.deepEqual(lines, []);
    watch.stop();
  });

  it('takes an event that names no file as a change of every catalog file of the folder', ({
    mock,
  }) => {
    mock.timers.enable({apis: ['setTimeout']});
    const dir = freshDir();
    const files = [path.join(dir, 'a.json'), path.join(dir, 'b.json')];
    const system = fakeSystem();
    const {changes, watch} = watching(files, system);
    system.opened.get(dir)?.emit(null);
    mock.timers.tick(100);
    assert.deepEqual(changes, files);
    watch.stop();
  });

  it('says so when a watch cannot be set up, and carries on', () => {
    const dir = freshDir();
    const {lines, watch} = watching(
      [path.join(dir, 'catalog.json')],
      fakeSystem(new Error('EMFILE: too many open files, watch.')),
    );
    assert.deepEqual(lines, [
      `Changes to the catalog files in ${dir} are not read: EMFILE: too many open files, watch. ` +
        'Stop Spectra and start it again to read a changed definition.',
    ]);
    watch.stop();
  });

  it('says so once when a watch fails while Spectra runs, and tells nothing after', ({mock}) => {
    mock.timers.enable({apis: ['setTimeout']});
    const dir = freshDir();
    const system = fakeSystem();
    const {changes, lines, watch} = watching([path.join(dir, 'catalog.json')], system);
    const folder = system.opened.get(dir);
    assert.ok(folder);
    folder.fail(new Error('EPERM: operation not permitted'));
    folder.fail(new Error('EPERM: operation not permitted'));
    folder.emit('catalog.json');
    mock.timers.tick(100);
    assert.deepEqual(lines, [
      `Changes to the catalog files in ${dir} are not read: EPERM: operation not permitted. ` +
        'Stop Spectra and start it again to read a changed definition.',
    ]);
    assert.deepEqual(changes, []);
    assert.ok(folder.closed);
    watch.stop();
  });

  it('reads a file of a folder that is gone, says the folder is no longer watched, and watches it no more', ({
    mock,
  }) => {
    mock.timers.enable({apis: ['setTimeout']});
    const dir = freshDir();
    const folder = path.join(dir, 'catalogs');
    mkdirSync(folder);
    const file = path.join(folder, 'catalog.json');
    const system = fakeSystem();
    const {changes, lines, watch} = watching([file], system);
    rmSync(folder, {recursive: true});
    const watched = system.opened.get(folder);
    assert.ok(watched);
    watched.emit('catalog.json');
    mock.timers.tick(100);
    assert.deepEqual(changes, [file], 'The read finds the file gone, and stands failed.');
    assert.deepEqual(lines, [
      `${folder} is gone, so its catalog files are no longer read again. ` +
        'Stop Spectra and start it again to watch it.',
    ]);
    assert.ok(watched.closed);
    watched.emit('catalog.json');
    mock.timers.tick(100);
    assert.deepEqual(changes, [file]);
    watch.stop();
  });

  it('tells nothing once stopped', ({mock}) => {
    mock.timers.enable({apis: ['setTimeout']});
    const dir = freshDir();
    const system = fakeSystem();
    const {changes, watch} = watching([path.join(dir, 'catalog.json')], system);
    system.opened.get(dir)?.emit('catalog.json');
    watch.stop();
    mock.timers.tick(500);
    assert.deepEqual(changes, []);
  });
});
