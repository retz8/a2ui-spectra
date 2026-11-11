import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {after, describe, it} from 'node:test';

import {
  changedFile,
  isRootEcho,
  shownPath,
  startSaveWatcher,
  WatchRules,
  watchTargets,
} from './save_watcher.js';

const cwd = path.resolve('/work/agent');
const at = (...segments: string[]) => path.join(cwd, ...segments);

function rules(
  paths: string[] = [cwd],
  excluded: string[] = [],
  extra: {ignoredPaths?: string[]; configFile?: string} = {},
): WatchRules {
  return new WatchRules({watch: {paths, excluded}, ignoredPaths: [], ...extra});
}

describe('what a save in a watched folder does', () => {
  it('restarts for a file written, created or removed, at any depth', () => {
    const watch = rules();
    assert.equal(watch.decide(at('agent.py'), 'file'), 'restart');
    assert.equal(watch.decide(at('prompts', 'booking', 'form.md'), 'file'), 'restart');
    assert.equal(watch.decide(at('tools.py'), 'missing'), 'restart');
  });

  it('never restarts for a folder, or for a path outside every watched folder', () => {
    const watch = rules();
    assert.equal(watch.decide(at('prompts'), 'folder'), 'ignored');
    assert.equal(watch.decide(cwd, 'folder'), 'ignored');
    assert.equal(watch.decide(path.resolve('/work/other/agent.py'), 'file'), 'ignored');
  });

  it('ignores every folder whose name starts with a dot, and watches hidden files', () => {
    const watch = rules();
    for (const folder of ['.git', '.venv', '.wireit', '.mypy_cache', '.a2ui-spectra', '.idea']) {
      assert.equal(watch.decide(at(folder, 'x', 'file.py'), 'file'), 'ignored', folder);
      assert.equal(watch.decide(at('src', folder, 'file.py'), 'file'), 'ignored', folder);
      assert.equal(watch.decide(at(folder), 'folder'), 'ignored', folder);
      assert.equal(watch.decide(at(folder), 'missing'), 'ignored', `${folder}, removed`);
    }
    assert.equal(watch.decide(at('.env'), 'file'), 'restart');
    assert.equal(watch.decide(at('src', '.env.local'), 'file'), 'restart');
  });

  it("ignores the named folders, and not a file that carries a folder's name", () => {
    const watch = rules();
    for (const folder of ['node_modules', 'dist', 'build', '__pycache__', 'venv']) {
      assert.equal(watch.decide(at(folder, 'index.js'), 'file'), 'ignored', folder);
      assert.equal(watch.decide(at('packages', 'a', folder, 'b.js'), 'file'), 'ignored', folder);
      assert.equal(watch.decide(at(folder), 'missing'), 'ignored', `${folder}, removed`);
    }
    assert.equal(watch.decide(at('build'), 'file'), 'restart');
    assert.equal(watch.decide(at('distribution', 'a.py'), 'file'), 'restart');
  });

  it("ignores compiled Python files and editors' own files", () => {
    const watch = rules();
    for (const name of [
      'agent.pyc',
      'agent.pyo',
      'agent.pyd',
      '.agent.py.swp',
      'agent.py.swx',
      'agent.py~',
      'agent.py.___jb_tmp___',
      'agent.py.___jb_old___',
      'agent.py.___jb_bak___',
      '.#agent.py',
      '#agent.py#',
      '.DS_Store',
      'flycheck_agent.py',
    ]) {
      assert.equal(watch.decide(at('src', name), 'file'), 'ignored', name);
      assert.equal(watch.decide(at('src', name), 'missing'), 'ignored', `${name}, removed`);
    }
    assert.equal(watch.decide(at('src', 'swap.py'), 'file'), 'restart');
    assert.equal(watch.decide(at('src', 'DS_Store'), 'file'), 'restart');
  });

  it("ignores Spectra's store and its fixtures folder by their paths", () => {
    const fixtures = at('a2ui-spectra-fixtures');
    const watch = rules([cwd], [], {ignoredPaths: [at('.a2ui-spectra'), fixtures]});
    assert.equal(watch.decide(path.join(fixtures, 'greet.json'), 'file'), 'ignored');
    assert.equal(watch.decide(path.join(fixtures, 'nested', 'x.json'), 'missing'), 'ignored');
    assert.equal(watch.decide(at('fixtures.json'), 'file'), 'restart');
  });

  it('watches a listed folder and a listed file, and nothing beside them', () => {
    const watch = rules([at('src'), at('prompt.md'), path.resolve('/work/shared')]);
    assert.equal(watch.decide(at('src', 'agent.py'), 'file'), 'restart');
    assert.equal(watch.decide(at('prompt.md'), 'file'), 'restart');
    assert.equal(watch.decide(path.resolve('/work/shared/lib.py'), 'file'), 'restart');
    assert.equal(watch.decide(at('README.md'), 'file'), 'ignored');
    assert.equal(watch.decide(at('src', 'node_modules', 'x.js'), 'file'), 'ignored');
  });

  it('watches an entry that itself names an ignored folder, the ignore list applying below it', () => {
    const watch = rules([cwd, at('dist'), at('.venv', 'lib', 'sdk')]);
    assert.equal(watch.decide(at('dist', 'agent.js'), 'file'), 'restart');
    assert.equal(watch.decide(at('dist', 'node_modules', 'x.js'), 'file'), 'ignored');
    assert.equal(watch.decide(at('.venv', 'lib', 'sdk', 'core.py'), 'file'), 'restart');
    assert.equal(watch.decide(at('.venv', 'lib', 'other', 'core.py'), 'file'), 'ignored');
  });

  it('leaves out an excluded file or folder, the deepest entry covering a path deciding', () => {
    const watch = rules([cwd, at('data', 'prompts')], [at('sessions.db'), at('data')]);
    assert.equal(watch.decide(at('sessions.db'), 'file'), 'ignored');
    assert.equal(watch.decide(at('data', 'uploads', 'a.png'), 'file'), 'ignored');
    assert.equal(watch.decide(at('data', 'prompts', 'booking.md'), 'file'), 'restart');
    assert.equal(watch.decide(at('agent.py'), 'file'), 'restart');
  });

  it('names the config file apart, when it lies in a watched folder', () => {
    const configFile = at('a2ui-spectra.json');
    assert.equal(rules([cwd], [], {configFile}).decide(configFile, 'file'), 'config');
    assert.equal(rules([at('src')], [], {configFile}).decide(configFile, 'file'), 'ignored');
    assert.equal(rules([cwd], [configFile], {configFile}).decide(configFile, 'file'), 'ignored');
  });

  it('says without a look at the disk when a folder on the way to a path is ignored', () => {
    const watch = rules();
    assert.equal(watch.ignoredOnTheWay(at('node_modules', 'a', 'index.js')), true);
    assert.equal(watch.ignoredOnTheWay(at('.git', 'index')), true);
    assert.equal(watch.ignoredOnTheWay(path.resolve('/elsewhere/x.py')), true);
    assert.equal(watch.ignoredOnTheWay(at('node_modules')), false, 'Its own name needs the look.');
    assert.equal(watch.ignoredOnTheWay(at('src', 'agent.py')), false);
  });
});

describe('the file a restart names', () => {
  it('is the first changed path that still exists when the window closes, else the first', () => {
    assert.equal(
      changedFile([
        {path: at('agent.py.tmp123'), exists: false},
        {path: at('agent.py'), exists: true},
        {path: at('tools.py'), exists: true},
      ]),
      at('agent.py'),
    );
    assert.equal(
      changedFile([
        {path: at('old.py'), exists: false},
        {path: at('older.py'), exists: false},
      ]),
      at('old.py'),
    );
  });

  it('is shown relative to the working directory when under it, else absolute', () => {
    assert.equal(shownPath(at('prompt_builder.py'), cwd), 'prompt_builder.py');
    assert.equal(shownPath(at('src', 'agent.py'), cwd), path.join('src', 'agent.py'));
    assert.equal(
      shownPath(path.resolve('/work/shared/lib.py'), cwd),
      path.resolve('/work/shared/lib.py'),
    );
  });
});

describe("a watched folder's own name among its events", () => {
  it('is told from a file inside it: macOS reports the folder itself by its name', () => {
    assert.equal(isRootEcho(cwd, at('agent')), true);
    assert.equal(isRootEcho(cwd, at('agent.py')), false);
    assert.equal(isRootEcho(cwd, at('src', 'agent')), false);
  });
});

describe('what the system is asked to watch', () => {
  it('is each listed folder that no other listed folder holds, and the folder of a listed file that none holds', () => {
    assert.deepEqual(
      watchTargets([
        {path: cwd, kind: 'folder'},
        {path: at('dist'), kind: 'folder'},
        {path: at('prompt.md'), kind: 'file'},
        {path: path.resolve('/work/shared'), kind: 'folder'},
        {path: path.resolve('/work/notes/prompt.md'), kind: 'file'},
        {path: path.resolve('/work/notes/extra.md'), kind: 'file'},
      ]),
      {
        folders: [cwd, path.resolve('/work/shared')],
        fileFolders: [path.resolve('/work/notes')],
      },
    );
  });
});

describe('the watch, its events handed in', () => {
  const dirs: string[] = [];
  after(() => {
    for (const dir of dirs) rmSync(dir, {recursive: true, force: true});
  });
  function freshDir(): string {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'spectra-watch-')));
    dirs.push(dir);
    return dir;
  }

  /** The system's watch, stood in for: each folder asked for, with a way to hand it an event or a failure. */
  function fakeSystem(refuse?: Error) {
    const opened = new Map<
      string,
      {recursive: boolean; emit(name: string | null): void; fail(error: Error): void}
    >();
    const open = (
      folder: string,
      options: {recursive: boolean},
      listener: (event: string, name: string | null) => void,
    ) => {
      if (refuse !== undefined) throw refuse;
      const watcher = Object.assign(new EventEmitter(), {close: () => {}, unref: () => {}});
      opened.set(folder, {
        recursive: options.recursive,
        emit: name => listener('rename', name),
        fail: error => void watcher.emit('error', error),
      });
      return watcher;
    };
    return {opened, open};
  }

  async function watching(
    dir: string,
    system: ReturnType<typeof fakeSystem>,
    extra: {configFile?: string; fixtures?: string} = {},
  ) {
    const saves: string[] = [];
    const lines: string[] = [];
    let fixturesChanges = 0;
    const watcher = await startSaveWatcher({
      watch: {paths: [dir], excluded: []},
      ignoredPaths: extra.fixtures === undefined ? [] : [extra.fixtures],
      ...(extra.configFile !== undefined && {configFile: extra.configFile}),
      workingDir: dir,
      onSave: file => saves.push(file),
      log: line => lines.push(line),
      ...(extra.fixtures !== undefined && {
        observed: [{path: extra.fixtures, onChange: () => fixturesChanges++}],
      }),
      quietSpellMs: 10,
      open: system.open,
    });
    return {saves, lines, watcher, fixturesChanges: () => fixturesChanges};
  }

  /** Resolves once the check holds; the events were handed in, so nothing here waits on the system. */
  async function eventually(check: () => boolean, what: string): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (!check()) {
      assert.ok(Date.now() < deadline, what);
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }
  /** Long enough for a quiet spell to have ended and its paths to have been looked at. */
  const settled = () => new Promise(resolve => setTimeout(resolve, 150));

  it('asks for one recursive watch of the folder, and tells a save once, naming the first changed path that still exists', async () => {
    const dir = freshDir();
    const system = fakeSystem();
    const {saves, lines, watcher} = await watching(dir, system);
    assert.deepEqual(
      [...system.opened].map(([folder, {recursive}]) => [folder, recursive]),
      [[dir, true]],
    );
    mkdirSync(path.join(dir, 'src'));
    writeFileSync(path.join(dir, 'src', 'agent.py'), 'saved');
    writeFileSync(path.join(dir, 'tools.py'), 'saved');
    const root = system.opened.get(dir);
    assert.ok(root);
    root.emit(path.join('src', 'agent.py.tmp4913'));
    root.emit('src');
    root.emit(path.join('src', 'agent.py'));
    root.emit('tools.py');
    root.emit(null);
    await eventually(() => saves.length > 0, 'The save was told.');
    await settled();
    assert.deepEqual(saves, [path.join('src', 'agent.py')]);
    assert.deepEqual(lines, []);
    watcher.stop();
  });

  it("tells nothing for the folder's own name, an ignored path or a folder, and nothing once stopped", async () => {
    const dir = freshDir();
    const system = fakeSystem();
    const {saves, watcher} = await watching(dir, system);
    mkdirSync(path.join(dir, 'node_modules'));
    writeFileSync(path.join(dir, 'node_modules', 'index.js'), 'ignored');
    mkdirSync(path.join(dir, 'prompts'));
    const root = system.opened.get(dir);
    assert.ok(root);
    root.emit(path.basename(dir));
    root.emit(path.join('node_modules', 'index.js'));
    root.emit('node_modules');
    root.emit('prompts');
    await settled();
    assert.deepEqual(saves, []);
    watcher.stop();
    writeFileSync(path.join(dir, 'agent.py'), 'saved');
    root.emit('agent.py');
    await settled();
    assert.deepEqual(saves, []);
  });

  it('restarts nothing on a save of the config file, and says to stop and start Spectra', async () => {
    const dir = freshDir();
    const configFile = path.join(dir, 'a2ui-spectra.json');
    writeFileSync(configFile, '{}');
    const system = fakeSystem();
    const {saves, lines, watcher} = await watching(dir, system, {configFile});
    system.opened.get(dir)?.emit('a2ui-spectra.json');
    await eventually(() => lines.length > 0, 'The line was said.');
    assert.deepEqual(lines, [
      'a2ui-spectra.json changed. Spectra reads it at start, so stop Spectra and start it again to apply it.',
    ]);
    assert.deepEqual(saves, []);
    watcher.stop();
  });

  it("tells an observed folder's changes apart from saves, when a watched folder holds it", async () => {
    const dir = freshDir();
    const fixtures = path.join(dir, 'a2ui-spectra-fixtures');
    const system = fakeSystem();
    const {saves, watcher, fixturesChanges} = await watching(dir, system, {fixtures});
    assert.deepEqual(watcher.observing, [fixtures]);
    mkdirSync(fixtures);
    writeFileSync(path.join(fixtures, 'greet.json'), '{}');
    const root = system.opened.get(dir);
    root?.emit('a2ui-spectra-fixtures');
    root?.emit(path.join('a2ui-spectra-fixtures', 'greet.json'));
    await eventually(() => fixturesChanges() > 0, "The folder's change was told.");
    await settled();
    assert.equal(fixturesChanges(), 1);
    assert.deepEqual(saves, []);
    watcher.stop();

    // A folder no watched folder holds is not observed, and keeps its own watch.
    const elsewhere = await watching(dir, fakeSystem(), {fixtures: path.join(freshDir(), 'fx')});
    assert.deepEqual(elsewhere.watcher.observing, []);
    elsewhere.watcher.stop();
  });

  it("tells an observed file's changes when a watched folder holds it, under an ignored folder too, beside the save", async () => {
    const dir = freshDir();
    const inSource = path.join(dir, 'catalog.json');
    const inDist = path.join(dir, 'dist', 'catalog.json');
    const outside = path.join(freshDir(), 'catalog.json');
    const system = fakeSystem();
    const saves: string[] = [];
    const told: string[] = [];
    const watcher = await startSaveWatcher({
      watch: {paths: [dir], excluded: []},
      ignoredPaths: [],
      workingDir: dir,
      onSave: file => saves.push(file),
      log: () => {},
      observed: [inSource, inDist, outside].map(file => ({
        path: file,
        onChange: () => told.push(file),
      })),
      quietSpellMs: 10,
      open: system.open,
    });
    assert.deepEqual(watcher.observing, [inSource, inDist]);
    mkdirSync(path.join(dir, 'dist'));
    writeFileSync(inDist, '{}');
    writeFileSync(inSource, '{}');
    const root = system.opened.get(dir);
    assert.ok(root);
    // Under an ignored folder the save restarts nothing, and the file's change is still told.
    root.emit(path.join('dist', 'catalog.json'));
    await eventually(() => told.length > 0, "The ignored folder's file was told.");
    await settled();
    assert.deepEqual(told, [inDist]);
    assert.deepEqual(saves, []);
    root.emit('catalog.json');
    await eventually(() => saves.length > 0 && told.length > 1, 'The save and the file were told.');
    await settled();
    assert.deepEqual(told, [inDist, inSource]);
    assert.deepEqual(saves, ['catalog.json']);
    watcher.stop();
  });

  it('says so and carries on when a watch cannot be set up, or fails while it runs', async () => {
    const dir = freshDir();
    const limit = new Error('ENOSPC: System limit for number of file watchers reached.');
    const refused = await watching(dir, fakeSystem(limit), {
      fixtures: path.join(dir, 'a2ui-spectra-fixtures'),
    });
    const line =
      `Restart on save is off for ${dir}: ENOSPC: System limit for number of file watchers reached. ` +
      "Narrow watch in the config file to the folders that hold the agent's source.";
    assert.deepEqual(refused.lines, [line]);
    assert.deepEqual(refused.watcher.observing, [], 'A watch that is not there tells nothing.');
    refused.watcher.stop();

    const system = fakeSystem();
    const {saves, lines, watcher} = await watching(dir, system);
    const root = system.opened.get(dir);
    assert.ok(root);
    root.fail(limit);
    assert.deepEqual(lines, [line]);
    writeFileSync(path.join(dir, 'agent.py'), 'saved');
    root.emit('agent.py');
    await settled();
    assert.deepEqual(saves, [], 'A failed watch restarts nothing.');
    watcher.stop();
  });

  it('watches a removed folder no longer, and says to stop and start Spectra', async () => {
    const dir = freshDir();
    const src = path.join(dir, 'src');
    mkdirSync(src);
    writeFileSync(path.join(src, 'agent.py'), 'saved');
    const system = fakeSystem();
    const saves: string[] = [];
    const lines: string[] = [];
    const watcher = await startSaveWatcher({
      watch: {paths: [src], excluded: []},
      ignoredPaths: [],
      workingDir: dir,
      onSave: file => saves.push(file),
      log: line => lines.push(line),
      quietSpellMs: 10,
      open: system.open,
    });
    rmSync(src, {recursive: true});
    const root = system.opened.get(src);
    assert.ok(root);
    root.emit('agent.py');
    await eventually(() => lines.length > 0, 'The line was said.');
    assert.deepEqual(lines, [
      `${src} is gone, so it is no longer watched. Stop Spectra and start it again to watch it.`,
    ]);
    mkdirSync(src);
    writeFileSync(path.join(src, 'agent.py'), 'saved again');
    root.emit('agent.py');
    await settled();
    // The file's removal was a save; nothing after the folder went is one.
    assert.deepEqual(saves, [path.join('src', 'agent.py')]);
    watcher.stop();
  });
});
