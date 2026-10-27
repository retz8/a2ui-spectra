/**
 * The local store: `.a2ui-spectra/turns/` in the working directory, one turn
 * record file per closed turn, with the earlier turns of its conversation
 * embedded. Files sort by time within their conversation:
 *
 *   turns/<conversation>/<time>_<trace id>.json
 *   turns/<time>_<trace id>.json        a turn with no conversation
 */
import {randomBytes} from 'node:crypto';
import {mkdir, readdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';

import {isEventOfKind, type Turn, type TurnEvent, type TurnRecord} from '../record/turn_record.js';
import {NAME} from '../version.js';

/** The store's directory, in the working directory Spectra was launched from. */
export const STORE_DIR = '.a2ui-spectra';

const GITIGNORE = `# Created by ${NAME}. Everything in this directory is ignored.\n*\n`;

/** `<time>_<trace id>.json`, the time in UTC to the millisecond, without colons. */
const FILE_NAME = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z)_([0-9a-f]{32})\.json$/;

/** A conversation id kept as it is for its folder's name. */
const SAFE_CONVERSATION = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;

/** One turn in the store, read off its file's name. */
export interface StoredTurn {
  /** The turn event's trace id. */
  traceId: string;
  /** The conversation the turn belongs to, when it has one. */
  conversationId?: string;
  /** The turn's start, as an ISO 8601 UTC time to the millisecond. */
  startTime: string;
  /** The record file, relative to the turns directory, with `/` between folders. */
  file: string;
}

/** The store's directory could not be created at start. */
export class StoreError extends Error {
  constructor(
    readonly dir: string,
    readonly reason: string,
  ) {
    super(`Spectra cannot create its store at ${dir}: ${reason}`);
    this.name = 'StoreError';
  }
}

/** One turn's record file failed to write. The record is kept for this run. */
export class StoreWriteError extends Error {
  constructor(
    readonly file: string,
    readonly reason: string,
  ) {
    super(`Spectra could not write ${file}: ${reason}`);
    this.name = 'StoreWriteError';
  }
}

export class TurnStore {
  /** The store's directory, `.a2ui-spectra`. */
  readonly dir: string;
  /** Where the turn record files are. */
  readonly turnsDir: string;
  /** Records whose file failed to write, kept for this run, by file. */
  readonly #unwritten = new Map<string, TurnRecord>();
  /** The last write of each conversation folder, so one folder's files are written one at a time. */
  readonly #writing = new Map<string, Promise<unknown>>();

  private constructor(dir: string) {
    this.dir = dir;
    this.turnsDir = path.join(dir, 'turns');
  }

  /**
   * Opens the store in a working directory, creating its directory and the
   * turns directory when they are missing. The git-ignore file is written only
   * when the store's directory is created.
   */
  static async open(workingDir: string): Promise<TurnStore> {
    const store = new TurnStore(path.resolve(workingDir, STORE_DIR));
    try {
      let created = true;
      try {
        await mkdir(store.dir);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw error;
        }
        created = false;
      }
      if (created) {
        await writeFile(path.join(store.dir, '.gitignore'), GITIGNORE);
      }
      await mkdir(store.turnsDir, {recursive: true});
    } catch (error) {
      throw new StoreError(store.dir, reasonOf(error));
    }
    return store;
  }

  /**
   * Writes a closed turn's record file: the earlier turns of its conversation
   * from the conversation's latest file, then the turn. The file is written
   * once, atomically. When the write fails, the record is kept for this run
   * and the error is thrown.
   *
   * `finish` is given the earlier turns once they are read, after the
   * conversation's previous write, and returns the turn as it is written:
   * the checks run there, so they see every earlier turn.
   */
  write(
    turn: Turn,
    finish: (earlierTurns: readonly Turn[]) => Turn = () => turn,
  ): Promise<{stored: StoredTurn; record: TurnRecord}> {
    const stored = storedTurnOf(turn);
    const folder = path.posix.dirname(stored.file);
    const previous = this.#writing.get(folder) ?? Promise.resolve();
    const written = previous.catch(() => {}).then(() => this.#write(stored, folder, finish));
    this.#writing.set(folder, written);
    void written.then(
      () => this.#forget(folder, written),
      () => this.#forget(folder, written),
    );
    return written;
  }

  /** Every turn in the store, earlier runs included, newest first. */
  async list(): Promise<StoredTurn[]> {
    const turns: StoredTurn[] = [];
    for (const entry of await readdir(this.turnsDir, {withFileTypes: true})) {
      if (entry.isFile()) {
        const turn = fromFileName(entry.name, undefined);
        if (turn !== undefined) turns.push(turn);
      } else if (entry.isDirectory()) {
        const conversationId = conversationOfFolder(entry.name);
        if (conversationId === undefined) continue;
        for (const name of await readdir(path.join(this.turnsDir, entry.name))) {
          const turn = fromFileName(name, conversationId, entry.name);
          if (turn !== undefined) turns.push(turn);
        }
      }
    }
    const listed = new Set(turns.map(turn => turn.file));
    for (const [file, record] of this.#unwritten) {
      if (!listed.has(file)) turns.push(storedTurnOf(record.turns[record.turns.length - 1]));
    }
    return turns.sort(newestFirst);
  }

  /** The record of a stored turn, by its file. */
  async read(file: string): Promise<TurnRecord> {
    const unwritten = this.#unwritten.get(file);
    if (unwritten !== undefined) {
      return unwritten;
    }
    return JSON.parse(await readFile(this.#pathOf(file), 'utf8')) as TurnRecord;
  }

  async #write(
    stored: StoredTurn,
    folder: string,
    finish: (earlierTurns: readonly Turn[]) => Turn,
  ): Promise<{stored: StoredTurn; record: TurnRecord}> {
    const target = this.#pathOf(stored.file);
    const temporary = path.join(
      path.dirname(target),
      `.${path.basename(target)}.${randomBytes(4).toString('hex')}.tmp`,
    );
    const earlier: readonly Turn[] =
      stored.conversationId === undefined ? [] : await this.#latestTurns(folder);
    const turn = finish(earlier);
    const turns: Turn[] = [...earlier, turn];
    const record: TurnRecord = {version: 'v0.1', turns: turns as TurnRecord['turns']};
    try {
      await mkdir(path.dirname(target), {recursive: true});
      await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`);
      await rename(temporary, target);
    } catch (error) {
      this.#unwritten.set(stored.file, record);
      await rm(temporary, {force: true}).catch(() => {});
      throw new StoreWriteError(target, reasonOf(error));
    }
    return {stored, record};
  }

  /**
   * The turns of a conversation's latest record that reads as one, on disk
   * or kept from a failed write; none for a new conversation.
   */
  async #latestTurns(folder: string): Promise<Turn[]> {
    let names: string[] = [];
    try {
      names = await readdir(path.join(this.turnsDir, folder));
    } catch {
      // A new conversation has no folder yet; one that cannot be read fails at its write.
    }
    const files = names
      .filter(name => FILE_NAME.test(name))
      .map(name => `${folder}/${name}`)
      .concat([...this.#unwritten.keys()].filter(file => path.posix.dirname(file) === folder));
    for (const file of [...new Set(files)].sort().reverse()) {
      try {
        const record = await this.read(file);
        if (Array.isArray(record.turns)) {
          return record.turns;
        }
      } catch {
        // A file that does not read as a record is passed over for the one before it.
      }
    }
    return [];
  }

  #pathOf(file: string): string {
    return path.join(this.turnsDir, ...file.split('/'));
  }

  #forget(folder: string, written: Promise<unknown>): void {
    if (this.#writing.get(folder) === written) {
      this.#writing.delete(folder);
    }
  }
}

/** Where a closed turn is stored, from its turn event. */
function storedTurnOf(turn: Turn): StoredTurn {
  const turnEvent = turn.events.find((event): event is TurnEvent => isEventOfKind(event, 'turn'));
  if (turnEvent === undefined) {
    throw new Error('A turn to store has no turn event.');
  }
  const startTime = new Date(
    Number(BigInt(turnEvent.startTimeUnixNano) / 1_000_000n),
  ).toISOString();
  const name = `${startTime.replaceAll(':', '-')}_${turnEvent.traceId}.json`;
  const conversationId = turnEvent.attributes['gen_ai.conversation.id'] || undefined;
  return {
    traceId: turnEvent.traceId,
    ...(conversationId !== undefined && {conversationId}),
    startTime,
    file: conversationId === undefined ? name : `${folderOf(conversationId)}/${name}`,
  };
}

function fromFileName(
  name: string,
  conversationId: string | undefined,
  folder?: string,
): StoredTurn | undefined {
  const match = FILE_NAME.exec(name);
  if (match === null) {
    return undefined;
  }
  const [, time, traceId] = match;
  return {
    traceId,
    ...(conversationId !== undefined && {conversationId}),
    startTime: time.replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3'),
    file: folder === undefined ? name : `${folder}/${name}`,
  };
}

/** A conversation's folder: its id as it is when that is safe as a name, else percent-encoded. */
export function folderOf(conversationId: string): string {
  if (SAFE_CONVERSATION.test(conversationId)) {
    return conversationId;
  }
  return Array.from(new TextEncoder().encode(conversationId), byte => {
    const char = String.fromCharCode(byte);
    return /[A-Za-z0-9_-]/.test(char)
      ? char
      : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }).join('');
}

/** The conversation a folder holds; nothing for a name no conversation is stored under. */
function conversationOfFolder(folder: string): string | undefined {
  try {
    const conversationId = decodeURIComponent(folder);
    return folderOf(conversationId) === folder ? conversationId : undefined;
  } catch {
    return undefined;
  }
}

/** Orders the newest turn first, by start time, then by file. */
function newestFirst(a: StoredTurn, b: StoredTurn): number {
  const [x, y] = a.startTime === b.startTime ? [a.file, b.file] : [a.startTime, b.startTime];
  return x === y ? 0 : x < y ? 1 : -1;
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
