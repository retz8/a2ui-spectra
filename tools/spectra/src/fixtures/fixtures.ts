/**
 * The fixtures folder: where Save as fixture writes a turn's record whole,
 * and what `test` and the viewer's Fixtures list read. The `fixtures` setting
 * names it, `a2ui-spectra-fixtures/` by default; it is created on the first
 * save. A fixture is any `.json` under the folder, recursively, named by its
 * path relative to the folder without `.json`; Save writes at the top only.
 */
import {randomBytes} from 'node:crypto';
import {type FSWatcher, watch} from 'node:fs';
import {mkdir, readdir, readFile, rename, rm, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';

import type {InputBrief} from '../listing.js';
import {isEventOfKind, type TurnRecord} from '../record/turn_record.js';

/** A fixture's typed name: ASCII letters, digits, `-`, `_` and `.`, not starting with a dot. */
const NAME = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;

/** How long a slug may be before it is cut at a `-`. */
const SLUG_LENGTH = 40;

export const NAME_RULE =
  "A fixture's name uses letters, digits, '-', '_' and '.', and does not start with a dot.";

/** A name outside the rule. */
export class FixtureNameError extends Error {
  constructor(message = NAME_RULE) {
    super(message);
    this.name = 'FixtureNameError';
  }
}

/** A name the folder already holds, with the first free numbered name. */
export class FixtureClashError extends Error {
  constructor(
    message: string,
    readonly suggested: string,
  ) {
    super(message);
    this.name = 'FixtureClashError';
  }
}

export class FixtureNotFoundError extends Error {
  constructor(name: string) {
    super(`No fixture is named ${name}.`);
    this.name = 'FixtureNotFoundError';
  }
}

/** A file that does not read as a turn record. */
export class FixtureReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FixtureReadError';
  }
}

/** One file of the folder, as the listing gives it. */
export interface FixtureFile {
  /** The path relative to the folder without `.json`, `/` between folders. */
  name: string;
  /** The file's path as shown, under the folder's display path. */
  path: string;
  /** The file's modification time, as an ISO 8601 UTC time. */
  savedAt: string;
  /** The record, when the file reads as one. */
  record?: TurnRecord;
  /** Why the file does not read as a record, when it does not. */
  error?: string;
}

export interface FixtureListing {
  /** The folder's path as shown. */
  folder: string;
  /** Every `.json` under the folder, in path order. */
  fixtures: FixtureFile[];
}

/** Whether a typed name follows the rule. */
export function isFixtureName(name: string): boolean {
  return NAME.test(name);
}

/**
 * The name prefilled for a turn: its input in brief as a slug, lowercase
 * ASCII letters and digits joined by `-`, cut at a `-` near forty characters;
 * `turn` when nothing survives.
 */
export function slugOf(input: InputBrief | undefined): string {
  const text =
    input === undefined ? '' : 'text' in input ? input.text : 'action' in input ? input.action : '';
  let slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length > SLUG_LENGTH) {
    const cut = slug.lastIndexOf('-', SLUG_LENGTH);
    slug = (cut > 0 ? slug.slice(0, cut) : slug.slice(0, SLUG_LENGTH)).replace(/-+$/, '');
  }
  return slug === '' ? 'turn' : slug;
}

/** Reads a file's text as a turn record v0.1, or throws with the reason. */
export function readRecord(text: string): TurnRecord {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new FixtureReadError(
      `The file is not JSON: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }
  const reason = notARecord(json);
  if (reason !== undefined) {
    throw new FixtureReadError(`The file is not a turn record v0.1: ${reason}.`);
  }
  return json as TurnRecord;
}

/** Why a value is not a turn record v0.1, or nothing when it may be one. */
function notARecord(json: unknown): string | undefined {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return 'it is not an object';
  }
  const record = json as Record<string, unknown>;
  if (record.version !== 'v0.1') {
    return `its version is ${typeof record.version === 'string' ? record.version : 'missing'}`;
  }
  if (!Array.isArray(record.turns) || record.turns.length === 0) {
    return 'it has no turns';
  }
  for (const [index, turn] of record.turns.entries()) {
    const events = (turn as {events?: unknown})?.events;
    if (!Array.isArray(events)) return `turn ${index + 1} has no events`;
    if (!events.some(event => isTurnEvent(event))) return `turn ${index + 1} has no turn event`;
  }
  return undefined;
}

function isTurnEvent(event: unknown): boolean {
  return (
    typeof event === 'object' &&
    event !== null &&
    typeof (event as {attributes?: unknown}).attributes === 'object' &&
    isEventOfKind(event as TurnRecord['turns'][number]['events'][number], 'turn')
  );
}

export class FixturesFolder {
  /** The folder's absolute path. */
  readonly dir: string;
  /** The folder's path as shown: relative to the working directory when under it, else absolute. */
  readonly display: string;

  constructor(dir: string, workingDir: string) {
    this.dir = path.resolve(workingDir, dir);
    const relative = path.relative(workingDir, this.dir);
    this.display =
      relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
        ? relative
        : this.dir;
  }

  /** The path of a fixture's file as shown. */
  pathOf(name: string): string {
    return path.join(this.display, ...`${name}.json`.split('/'));
  }

  /** Every `.json` under the folder, recursively, in path order, each read for its record. */
  async list(): Promise<FixtureListing> {
    const files = (await this.#files(this.dir)).sort();
    const fixtures = await Promise.all(
      files.map(async (file): Promise<FixtureFile> => {
        const name = file.slice(0, -'.json'.length);
        const absolute = path.join(this.dir, ...file.split('/'));
        const entry: FixtureFile = {
          name,
          path: this.pathOf(name),
          savedAt: (await stat(absolute)).mtime.toISOString(),
        };
        try {
          entry.record = readRecord(await readFile(absolute, 'utf8'));
        } catch (error) {
          entry.error = error instanceof Error ? error.message : String(error);
        }
        return entry;
      }),
    );
    return {folder: this.display, fixtures};
  }

  /** The `.json` files under a directory, recursively, relative to the folder with `/` between folders. */
  async #files(dir: string): Promise<string[]> {
    let entries;
    try {
      entries = await readdir(dir, {withFileTypes: true});
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const files: string[] = [];
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await this.#files(absolute)));
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        files.push(path.relative(this.dir, absolute).split(path.sep).join('/'));
      }
    }
    return files;
  }

  /** A fixture's record by its name, with its path as shown. */
  async read(name: string): Promise<{record: TurnRecord; path: string}> {
    const segments = name.split('/');
    if (!segments.every(isFixtureName)) throw new FixtureNameError();
    let text: string;
    try {
      text = await readFile(
        path.join(this.dir, ...segments.slice(0, -1), `${segments.at(-1)}.json`),
        'utf8',
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new FixtureNotFoundError(name);
      throw error;
    }
    return {record: readRecord(text), path: this.pathOf(name)};
  }

  /**
   * Writes a record whole as `<name>.json` at the top of the folder, creating
   * the folder when it is missing, atomically. A name outside the rule and a
   * name the folder holds are refused, the clash naming the first free
   * numbered name.
   */
  async save(record: TurnRecord, name: string): Promise<{name: string; path: string}> {
    if (!isFixtureName(name)) throw new FixtureNameError();
    const target = path.join(this.dir, `${name}.json`);
    if (await exists(target)) {
      throw new FixtureClashError(
        `${this.pathOf(name)} exists already.`,
        await this.suggestedName(name),
      );
    }
    await mkdir(this.dir, {recursive: true});
    const temporary = path.join(this.dir, `.${name}.${randomBytes(4).toString('hex')}.tmp`);
    try {
      await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`);
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, {force: true}).catch(() => {});
      throw error;
    }
    return {name, path: this.pathOf(name)};
  }

  /** The name itself when the folder does not hold it, else the first free of `<name>-2`, `<name>-3`, … */
  async suggestedName(name: string): Promise<string> {
    if (!(await exists(path.join(this.dir, `${name}.json`)))) return name;
    for (let n = 2; ; n++) {
      const candidate = `${name}-${n}`;
      if (!(await exists(path.join(this.dir, `${candidate}.json`)))) return candidate;
    }
  }

  /**
   * Calls back once, after a quiet spell, when files join, change in or
   * leave the folder; the folder's parent is watched for the folder itself
   * while it is missing. Returns the call that stops watching.
   */
  watch(onChange: () => void, debounceMs = 100): () => void {
    let watcher: FSWatcher | undefined;
    let timer: NodeJS.Timeout | undefined;
    let stopped = false;
    const notice = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        if (!stopped) onChange();
      }, debounceMs);
      timer.unref();
    };
    const watchFolder = () => {
      watcher?.close();
      watcher = watch(this.dir, {recursive: true}, () => notice());
      watcher.unref();
      watcher.on('error', () => watchParent());
    };
    const watchParent = () => {
      watcher?.close();
      const parent = path.dirname(this.dir);
      try {
        watcher = watch(parent, (_event, name) => {
          if (name === path.basename(this.dir)) {
            // The folder appeared: watch it, and say so.
            void stat(this.dir).then(
              () => {
                watchFolder();
                notice();
              },
              () => {},
            );
          }
        });
        watcher.unref();
        watcher.on('error', () => {});
      } catch {
        watcher = undefined;
      }
    };
    void stat(this.dir).then(
      () => {
        if (!stopped) watchFolder();
      },
      () => {
        if (!stopped) watchParent();
      },
    );
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      watcher?.close();
    };
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}
