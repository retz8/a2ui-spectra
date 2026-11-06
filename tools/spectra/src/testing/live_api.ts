/**
 * The viewer's API as the end-to-end tests drive it: the live stream read in
 * the background, JSON reads and posts, and the message box's state once it
 * has settled.
 */
import assert from 'node:assert/strict';

import {SseParser} from '../a2a/sse.js';
import type {MessageBoxState, SentMessage} from '../message_box.js';
import type {Turn} from '../record/turn_record.js';

export interface LiveEvent {
  event: string;
  data: {traceId?: string; turn?: Turn; [field: string]: unknown};
}

/** The live stream, read in the background, its events kept in order. */
export class LiveStream {
  readonly events: LiveEvent[] = [];
  readonly ready: Promise<void>;
  readonly #stop = new AbortController();
  #waiters: Array<() => void> = [];

  constructor(url: string) {
    this.ready = fetch(url, {signal: this.#stop.signal}).then(response => {
      void this.#read(response);
    });
  }

  /** Resolves with the turn closed for the trace id, once the stream has sent it. */
  async closed(traceId: string, timeoutMs = 20_000): Promise<Turn> {
    const found = await this.until(
      e => e.event === 'turn_closed' && e.data.traceId === traceId,
      timeoutMs,
      `No turn_closed for ${traceId} on the live stream.`,
    );
    return found.data.turn as Turn;
  }

  /** Resolves with the first event that matches, once the stream has sent it. */
  async until(
    matches: (event: LiveEvent) => boolean,
    timeoutMs = 20_000,
    message = 'The event came on the live stream.',
  ): Promise<LiveEvent> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.events.find(matches);
      if (found !== undefined) return found;
      if (Date.now() > deadline) {
        throw new Error(message);
      }
      await new Promise<void>(resolve => {
        this.#waiters.push(resolve);
        setTimeout(resolve, 200);
      });
    }
  }

  close(): void {
    this.#stop.abort();
  }

  async #read(response: Response): Promise<void> {
    const sse = new SseParser();
    const text = new TextDecoder();
    try {
      for await (const chunk of response.body ?? []) {
        for (const event of sse.push(text.decode(chunk as Uint8Array, {stream: true}))) {
          this.events.push({event: event.event ?? 'message', data: JSON.parse(event.data)});
        }
        const waiters = this.#waiters;
        this.#waiters = [];
        for (const wake of waiters) wake();
      }
    } catch {
      // Closed by the test.
    }
  }
}

export async function getJson<T>(url: string): Promise<{status: number; body: T}> {
  const response = await fetch(url);
  return {status: response.status, body: (await response.json()) as T};
}

export async function postJson<T>(url: string, body: unknown): Promise<{status: number; body: T}> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(body),
  });
  return {status: response.status, body: (await response.json()) as T};
}

/** Sends a text or an action through the message box's route, which must answer 200. */
export async function sendMessage(
  base: string,
  input: string | {action: Record<string, unknown>},
  conversationId?: string,
  dataModel?: Record<string, unknown>,
): Promise<SentMessage> {
  const {status, body} = await postJson<SentMessage & {error?: string}>(
    `${base}/api/message-box/messages`,
    {...(typeof input === 'string' ? {text: input} : input), conversationId, dataModel},
  );
  assert.equal(status, 200, body.error);
  return body;
}

/** Resolves with the box's state once none of its conversations has an open turn and no replay runs. */
export async function boxSettled(base: string): Promise<MessageBoxState> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const {body} = await getJson<MessageBoxState>(`${base}/api/message-box`);
    if (
      body.replay === undefined &&
      body.conversations.every(conversation => conversation.openTurn === undefined)
    ) {
      return body;
    }
    assert.ok(Date.now() < deadline, 'The message box kept its turn open.');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}
