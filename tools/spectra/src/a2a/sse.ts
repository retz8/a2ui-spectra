/** One server-sent event: its data, and its `event` and `id` fields when it set them. */
export interface SseEvent {
  event?: string;
  id?: string;
  data: string;
}

/**
 * Reads a server-sent event stream as the HTML standard's event stream
 * interpretation does, from text pushed in chunks of any size. An event is
 * dispatched at its blank line; one still unfinished when the stream ends is
 * dropped, as the standard has it.
 */
export class SseParser {
  #buffer = '';
  #data: string[] = [];
  #event: string | undefined;
  #id: string | undefined;

  /** Reads the next chunk of text and returns the events it completed. */
  push(text: string): SseEvent[] {
    this.#buffer += text;
    const events: SseEvent[] = [];
    let start = 0;
    for (let i = 0; i < this.#buffer.length; i++) {
      const char = this.#buffer[i];
      if (char !== '\n' && char !== '\r') {
        continue;
      }
      if (char === '\r' && i === this.#buffer.length - 1) {
        // A CR at the end may be the first half of a CRLF still to come.
        break;
      }
      const event = this.#line(this.#buffer.slice(start, i));
      if (event !== undefined) {
        events.push(event);
      }
      if (char === '\r' && this.#buffer[i + 1] === '\n') {
        i++;
      }
      start = i + 1;
    }
    this.#buffer = this.#buffer.slice(start);
    return events;
  }

  #line(line: string): SseEvent | undefined {
    if (line === '') {
      return this.#dispatch();
    }
    if (line.startsWith(':')) {
      return undefined;
    }
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) {
      value = value.slice(1);
    }
    switch (field) {
      case 'data':
        this.#data.push(value);
        break;
      case 'event':
        this.#event = value;
        break;
      case 'id':
        if (!value.includes('\0')) {
          this.#id = value;
        }
        break;
    }
    return undefined;
  }

  #dispatch(): SseEvent | undefined {
    const data = this.#data;
    const event = this.#event;
    const id = this.#id;
    this.#data = [];
    this.#event = undefined;
    this.#id = undefined;
    if (data.length === 0) {
      return undefined;
    }
    return {
      ...(event !== undefined && {event}),
      ...(id !== undefined && {id}),
      data: data.join('\n'),
    };
  }
}
