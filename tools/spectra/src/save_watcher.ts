/**
 * Restart on save, under `run`: the watch of the working directory, or of
 * what the config file's `watch` setting lists, and the rules deciding which
 * change is a save. A save restarts the agent after a quiet spell, naming
 * one changed file.
 */
import {watch} from 'node:fs';
import {stat} from 'node:fs/promises';
import path from 'node:path';

import {type QuietSpell, quietSpell} from './quiet_spell.js';

/** What is watched, as absolute paths: the listed folders and files, and the excluded ones. */
export interface WatchPaths {
  paths: string[];
  excluded: string[];
}

/** What a changed path is on disk when its window closes. */
export type PathKind = 'file' | 'folder' | 'missing';

/** What a changed path does: restarts the agent, nothing, or the config file's line. */
export type SaveDecision = 'restart' | 'ignored' | 'config';

/** The folders ignored by name, beside every folder whose name starts with a dot. */
const IGNORED_FOLDERS = new Set(['node_modules', 'dist', 'build', '__pycache__', 'venv']);

/**
 * The files ignored by name: compiled Python, vim's swap files, backup
 * files, JetBrains' safe-write files, Emacs' lock and autosave files,
 * `.DS_Store` and flycheck's files. From watchfiles' default filter, and
 * watchexec's for Emacs' autosave files.
 */
const IGNORED_FILES = [
  /\.py[cod]$/,
  /\.sw.$/,
  /~$/,
  /\.___jb_...___$/,
  /^\.#/,
  /^#.*#$/,
  /^\.DS_Store$/,
  /^flycheck_/,
];

function isIgnoredFolder(name: string): boolean {
  return (name.startsWith('.') && name !== '.' && name !== '..') || IGNORED_FOLDERS.has(name);
}

function isIgnoredFile(name: string): boolean {
  return IGNORED_FILES.some(pattern => pattern.test(name));
}

/** Whether the entry is the path or a folder on the way to it. */
function covers(entry: string, target: string): boolean {
  return target === entry || target.startsWith(entry.endsWith(path.sep) ? entry : entry + path.sep);
}

export interface WatchRulesOptions {
  watch: WatchPaths;
  /** Spectra's own folders, never watched: its store and its fixtures folder. */
  ignoredPaths: string[];
  /** The config file Spectra read, when it read one. */
  configFile?: string;
}

/**
 * Which change is a save. The deepest entry covering a path decides, a
 * listed one over an excluded one's ancestor and the other way round; below
 * a listed folder the ignore list applies, every folder whose name starts
 * with a dot, the named folders and the named files. Only a file is a save.
 */
export class WatchRules {
  readonly #entries: Array<{path: string; listed: boolean; own: boolean}>;
  readonly #configFile: string | undefined;

  constructor({watch: {paths, excluded}, ignoredPaths, configFile}: WatchRulesOptions) {
    this.#entries = [
      ...paths.map(entry => ({path: entry, listed: true, own: false})),
      ...excluded.map(entry => ({path: entry, listed: false, own: false})),
      ...ignoredPaths.map(entry => ({path: entry, listed: false, own: true})),
    ];
    this.#configFile = configFile;
  }

  /** The listed entry a path falls under, when the deepest entry covering it is a listed one. */
  #listedOver(target: string): string | undefined {
    let deepest: {path: string; listed: boolean; own: boolean} | undefined;
    for (const entry of this.#entries) {
      if (!covers(entry.path, target)) continue;
      if (
        deepest === undefined ||
        entry.path.length > deepest.path.length ||
        // At one depth an exclusion wins over a listing, and either over Spectra's own folders.
        (entry.path.length === deepest.path.length &&
          (deepest.own || (!entry.own && !entry.listed)))
      ) {
        deepest = entry;
      }
    }
    return deepest?.listed === true ? deepest.path : undefined;
  }

  /** The names from the listed entry down to the path, the path's own name last. */
  #namesBelow(listed: string, target: string): string[] {
    const relative = path.relative(listed, target);
    return relative === '' ? [] : relative.split(path.sep);
  }

  /**
   * Whether the path is outside every watched folder, or under a folder the
   * ignore list names, which needs no look at the disk. Its own name is not
   * judged: whether that is a file or a folder is on the disk.
   */
  ignoredOnTheWay(target: string): boolean {
    const listed = this.#listedOver(target);
    if (listed === undefined) return true;
    return this.#namesBelow(listed, target).slice(0, -1).some(isIgnoredFolder);
  }

  decide(target: string, kind: PathKind): SaveDecision {
    const listed = this.#listedOver(target);
    if (listed === undefined || kind === 'folder') return 'ignored';
    const names = this.#namesBelow(listed, target);
    if (names.slice(0, -1).some(isIgnoredFolder)) return 'ignored';
    const name = names.at(-1);
    if (name !== undefined) {
      if (isIgnoredFile(name)) return 'ignored';
      // A path that is gone may have been a folder.
      if (kind === 'missing' && isIgnoredFolder(name)) return 'ignored';
    }
    return target === this.#configFile ? 'config' : 'restart';
  }
}

/** The file a restart names: the first changed path that still exists, else the first. */
export function changedFile(changed: ReadonlyArray<{path: string; exists: boolean}>): string {
  return (changed.find(entry => entry.exists) ?? changed[0]).path;
}

/** A path as shown: relative to the working directory when under it, else absolute. */
export function shownPath(target: string, workingDir: string): string {
  const relative = path.relative(workingDir, target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
    ? relative
    : target;
}

/**
 * What the system is asked to watch: each listed folder that no other listed
 * folder holds, recursively, and the folder of each listed file that none
 * holds. A file is watched through its folder, since a save that replaces
 * the file would end a watch on the file itself.
 */
export function watchTargets(listed: ReadonlyArray<{path: string; kind: 'file' | 'folder'}>): {
  folders: string[];
  fileFolders: string[];
} {
  const all = listed.filter(entry => entry.kind === 'folder').map(entry => entry.path);
  const folders = all.filter(
    (folder, index) =>
      all.indexOf(folder) === index &&
      !all.some(other => other !== folder && covers(other, folder)),
  );
  const fileFolders: string[] = [];
  for (const entry of listed) {
    if (entry.kind !== 'file') continue;
    const folder = path.dirname(entry.path);
    if (folders.some(held => covers(held, entry.path)) || fileFolders.includes(folder)) continue;
    fileFolders.push(folder);
  }
  return {folders, fileFolders};
}

/**
 * Whether a changed path is the watched folder told by its own name: macOS
 * reports a change of the folder itself as one of a file of its name inside
 * it. Such a path that is not on the disk is the folder, and no save.
 */
export function isRootEcho(folder: string, target: string): boolean {
  return target === path.join(folder, path.basename(folder));
}

/** How long the watch waits after the last change before it restarts, as the fixtures folder's does. */
export const QUIET_SPELL_MS = 100;

export interface SaveWatcherOptions {
  watch: WatchPaths;
  ignoredPaths: string[];
  configFile?: string;
  /** The directory Spectra was launched from, which the named file is shown against. */
  workingDir: string;
  /** A save: the file it names, as shown. */
  onSave(file: string): void;
  /** Takes each line for the terminal. */
  log(line: string): void;
  /**
   * Paths whose changes are told beside the saves, each once after its own
   * quiet spell, when a watched folder holds them: Spectra's fixtures folder
   * and the configured catalog files, whatever the ignore list says of where
   * they sit. Their changes then need no watch of their own, and no watcher
   * is opened or closed while Spectra runs: on macOS that drops the events
   * of every other watcher while the system's stream is rebuilt.
   */
  observed?: ReadonlyArray<{path: string; onChange(): void}>;
  quietSpellMs?: number;
  /** Asks the system for a watch of a folder; `fs.watch` by default. */
  open?: OpenWatch;
}

/** A watch of one folder as the system gives it. */
export interface WatchHandle {
  close(): void;
  unref(): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

/** Asks the system for a watch of a folder, each change told with the changed path's name under it. */
export type OpenWatch = (
  folder: string,
  options: {recursive: boolean},
  listener: (event: string, name: string | null) => void,
) => WatchHandle;

/** The watch as started. */
export interface SaveWatcher {
  /** The observed paths a watched folder holds, whose changes this watch tells. */
  observing: string[];
  stop(): void;
}

/** What the terminal says when a path cannot be watched, or its watch fails. */
function failedLine(target: string, reason: string): string {
  return (
    `Restart on save is off for ${target}: ${reason}. ` +
    "Narrow watch in the config file to the folders that hold the agent's source."
  );
}

function reasonOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\.$/, '');
}

async function kindOf(target: string): Promise<PathKind> {
  try {
    return (await stat(target)).isDirectory() ? 'folder' : 'file';
  } catch {
    return 'missing';
  }
}

/**
 * Starts the watch: one recursive watch per listed folder, the rules applied
 * to its events. Changes restart once, a quiet spell after the last. A watch
 * that cannot be set up, or fails, or whose folder is removed, is said in
 * the terminal and Spectra carries on.
 */
export async function startSaveWatcher(options: SaveWatcherOptions): Promise<SaveWatcher> {
  const {watch: paths, workingDir, onSave, log, observed = []} = options;
  const quietSpellMs = options.quietSpellMs ?? QUIET_SPELL_MS;
  const openWatch: OpenWatch =
    options.open ?? ((folder, watchOptions, listener) => watch(folder, watchOptions, listener));
  const rules = new WatchRules(options);
  const watchers = new Map<string, WatchHandle>();
  /** The changed paths of the window that is open, in the order they came. */
  const changed = new Set<string>();
  /** The watched folders told by their own names in the window that is open. */
  const echoes = new Set<string>();
  let stopped = false;
  /** The quiet spell of each observed path. */
  const observedSpells = new Map<string, QuietSpell>(
    observed.map(({path: held, onChange}) => [
      held,
      quietSpell(() => {
        if (!stopped) onChange();
      }, quietSpellMs),
    ]),
  );

  const drop = (folder: string) => {
    watchers.get(folder)?.close();
    watchers.delete(folder);
  };

  const closeWindow = async () => {
    const paths = [...changed];
    const echoed = new Set(echoes);
    changed.clear();
    echoes.clear();
    const decided = await Promise.all(
      paths.map(async target => {
        const kind = await kindOf(target);
        const folderItself = kind === 'missing' && echoed.has(target);
        return {
          path: target,
          exists: kind !== 'missing',
          decision: folderItself ? ('ignored' as const) : rules.decide(target, kind),
        };
      }),
    );
    if (stopped) return;
    // A watched folder that is gone is watched no longer: its watch stays on what was removed.
    for (const folder of [...watchers.keys()]) {
      if ((await kindOf(folder)) === 'missing') {
        drop(folder);
        log(
          `${folder} is gone, so it is no longer watched. Stop Spectra and start it again to watch it.`,
        );
      }
    }
    const configFile = decided.find(entry => entry.decision === 'config');
    if (configFile !== undefined) {
      log(
        `${path.basename(configFile.path)} changed. Spectra reads it at start, ` +
          'so stop Spectra and start it again to apply it.',
      );
    }
    const saves = decided.filter(entry => entry.decision === 'restart');
    if (saves.length > 0) {
      onSave(shownPath(changedFile(saves), workingDir));
    }
  };

  const window = quietSpell(() => void closeWindow(), quietSpellMs);
  const notice = (folder: string, target: string) => {
    if (stopped) return;
    for (const [held, spell] of observedSpells) {
      if (covers(held, target)) spell.notice();
    }
    if (rules.ignoredOnTheWay(target)) return;
    if (isRootEcho(folder, target)) echoes.add(target);
    changed.add(target);
    window.notice();
  };

  const open = (folder: string, recursive: boolean) => {
    try {
      const watcher = openWatch(folder, {recursive}, (_event, name) => {
        // Without a name there is no file to judge or to name; a watch that was dropped tells nothing.
        if (name !== null && watchers.has(folder)) notice(folder, path.resolve(folder, name));
      });
      watcher.unref();
      watcher.on('error', error => {
        if (stopped || !watchers.has(folder)) return;
        drop(folder);
        log(failedLine(folder, reasonOf(error)));
      });
      watchers.set(folder, watcher);
    } catch (error) {
      log(failedLine(folder, reasonOf(error)));
    }
  };

  const listed: Array<{path: string; kind: 'file' | 'folder'}> = [];
  for (const entry of paths.paths) {
    const kind = await kindOf(entry);
    if (kind !== 'missing') listed.push({path: entry, kind});
  }
  const targets = watchTargets(listed);
  for (const folder of targets.folders) open(folder, true);
  for (const folder of targets.fileFolders) open(folder, false);

  return {
    observing: observed
      .map(entry => entry.path)
      .filter(held => targets.folders.some(root => watchers.has(root) && covers(root, held))),
    stop() {
      stopped = true;
      window.cancel();
      for (const spell of observedSpells.values()) spell.cancel();
      for (const folder of [...watchers.keys()]) drop(folder);
    },
  };
}
