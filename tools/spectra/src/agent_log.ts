/**
 * The agent's output under `run`, as the viewer gets it: each stream split
 * into lines, and the lines kept with the dividers of each start and stop of
 * the process in one ordered buffer, capped by its count of lines. Nothing of
 * it goes into a turn record.
 */

/** Where one line's length ends, in bytes: where Docker's log copier splits a line. */
export const LINE_LIMIT = 16 * 1024;

/** How many output lines the buffer keeps: the scrollback of VS Code's integrated terminal. */
export const LOG_CAP = 1000;

const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;

/**
 * Splits one stream into lines. A line ends at a newline, a carriage return
 * just before it dropped, and everything else stays as written. An unfinished
 * line is held until its newline or the stream's end. A line that reaches the
 * limit is given as it stands, what follows continuing as the next line, the
 * split never falling inside a character.
 */
export class LineSplitter {
  #held: Buffer = Buffer.alloc(0);
  readonly #decoder = new TextDecoder('utf-8');

  /** Takes a chunk as the stream gave it, and gives the lines it completed. */
  push(chunk: Buffer): string[] {
    let rest = this.#held.length === 0 ? chunk : Buffer.concat([this.#held, chunk]);
    const lines: string[] = [];
    for (;;) {
      const newline = rest.indexOf(NEWLINE);
      if (newline !== -1 && newline <= LINE_LIMIT) {
        const end = newline > 0 && rest[newline - 1] === CARRIAGE_RETURN ? newline - 1 : newline;
        lines.push(this.#decoder.decode(rest.subarray(0, end)));
        rest = rest.subarray(newline + 1);
      } else if (rest.length > LINE_LIMIT) {
        let cut = LINE_LIMIT;
        // A UTF-8 continuation byte belongs to the character before it.
        while (cut > 0 && (rest[cut] & 0xc0) === 0x80) cut--;
        if (cut === 0) cut = LINE_LIMIT;
        lines.push(this.#decoder.decode(rest.subarray(0, cut)));
        rest = rest.subarray(cut);
      } else {
        break;
      }
    }
    // A copy, so the chunk the stream gave is not kept alive by what is held of it.
    this.#held = Buffer.from(rest);
    return lines;
  }

  /** The stream ended: what was held is its last line. */
  end(): string[] {
    if (this.#held.length === 0) return [];
    const held = this.#held;
    this.#held = Buffer.alloc(0);
    const end = held[held.length - 1] === CARRIAGE_RETURN ? held.length - 1 : held.length;
    return [this.#decoder.decode(held.subarray(0, end))];
  }
}

/** What caused a restart: a press of Restart in the viewer, or a save of a watched file. */
export type RestartCause =
  | {kind: 'press'}
  | {
      kind: 'save';
      /** The changed file, relative to the working directory when under it, else absolute. */
      file: string;
    };

/** An entry before the buffer has numbered and timed it. */
export type NewLogEntry =
  /** One line of the agent's output, with the stream it was written to and its text as written. */
  | {type: 'line'; stream: 'stdout' | 'stderr'; text: string}
  /** A process ended: its exit line in the terminal's words, and the cause when a restart stopped it. */
  | {type: 'stopped'; exit: string; cause?: RestartCause}
  /** The command started, as launched. */
  | {type: 'started'; command: string};

/** An entry of the buffer: its number in the buffer's order, and the moment it entered. */
export type LogEntry = NewLogEntry & {
  n: number;
  /** As an ISO 8601 UTC time to the millisecond. */
  time: string;
};

/** What the stream sends as entries enter the buffer. */
export interface LogAdded {
  entries: LogEntry[];
  /** The number of the oldest entry still held; a reader drops everything below it. */
  oldest: number;
}

/** What `GET /api/agent/logs` gives. */
export interface LogSnapshot {
  /** The entries held, oldest first. */
  entries: LogEntry[];
  /** How many of them are output lines. */
  lines: number;
  cap: number;
}

export interface LogBufferOptions {
  cap?: number;
  now?: () => Date;
}

/**
 * The buffer: output lines and dividers in one order, each numbered from 1
 * for the session. Its cap counts output lines alone, and a divider leaves
 * when the lines before it have left. Its times never go backwards.
 */
export class LogBuffer {
  readonly #cap: number;
  readonly #now: () => Date;
  #entries: LogEntry[] = [];
  #lines = 0;
  #next = 1;
  #lastTime = '';

  constructor({cap = LOG_CAP, now = () => new Date()}: LogBufferOptions = {}) {
    this.#cap = cap;
    this.#now = now;
  }

  /** Enters the entries, in order, at this moment. */
  add(entries: readonly NewLogEntry[]): LogAdded {
    const now = this.#now().toISOString();
    const time = now < this.#lastTime ? this.#lastTime : now;
    this.#lastTime = time;
    const added = entries.map((entry): LogEntry => ({n: this.#next++, time, ...entry}));
    this.#entries.push(...added);
    this.#lines += added.filter(entry => entry.type === 'line').length;
    let dropped = false;
    while (this.#lines > this.#cap) {
      if (this.#entries.shift()?.type === 'line') this.#lines--;
      dropped = true;
    }
    while (dropped && this.#entries.length > 0 && this.#entries[0].type !== 'line') {
      this.#entries.shift();
    }
    return {entries: added, oldest: this.#entries[0]?.n ?? this.#next};
  }

  snapshot(): LogSnapshot {
    return {entries: [...this.#entries], lines: this.#lines, cap: this.#cap};
  }
}
