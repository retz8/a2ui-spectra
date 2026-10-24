import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {MessageBox, MessageBoxError} from './message_box.js';
import type {Turn} from './record/turn_record.js';
import {TurnHub} from './turn_hub.js';

const URL_1_0 = 'http://127.0.0.1:10999/a2a';
const CARD_1_0 = {
  capabilities: {streaming: true},
  supportedInterfaces: [{url: URL_1_0, protocolBinding: 'JSONRPC', protocolVersion: '1.0'}],
};

interface Sent {
  url: string;
  headers: Record<string, string>;
  message: Record<string, unknown>;
  traceId: string;
}

/**
 * The wire proxy as the box meets it: each request opens a turn on the hub,
 * named by the request's message id, and is answered with the next reply.
 */
class FakeProxy {
  readonly sent: Sent[] = [];
  readonly replies: Array<() => Promise<Response>> = [];
  readonly turns = new TurnHub();
  #traces = 0;

  readonly fetch: typeof fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body)) as {params: {message: Record<string, unknown>}};
    const traceId = String(++this.#traces).padStart(32, '0');
    this.sent.push({
      url: String(input),
      headers: init?.headers as Record<string, string>,
      message: body.params.message,
      traceId,
    });
    this.turns.onTurn({
      type: 'turn_opened',
      traceId,
      startTimeUnixNano: '1792576800000000000',
      messageId: String(body.params.message.messageId),
    });
    const reply = this.replies.shift();
    assert.ok(reply, 'A reply is queued for each request.');
    return reply();
  };

  /** Closes a turn as the recorder does, once the reply has been read. */
  async close(traceId: string): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 10));
    this.turns.onRecorded(turnOf(traceId));
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

function turnOf(traceId: string): Turn {
  return {
    events: [
      {
        traceId,
        spanId: '0000000000000000',
        name: 'invoke_agent',
        kind: 3,
        startTimeUnixNano: '1792576800000000000',
        endTimeUnixNano: '1792576801000000000',
        attributes: {
          'a2ui.event.kind': 'turn',
          'gen_ai.operation.name': 'invoke_agent',
          'a2ui.turn.outcome': 'completed',
          'a2ui.turn.capture_paths': ['wire'],
          'a2ui.turn.writer.name': 'a2ui-spectra',
          'a2ui.turn.writer.version': '0.0.1',
        },
        status: {code: 1},
      },
    ],
  };
}

/** A 1.0 stream reply that ends in the state given. */
function streamReply(state: string, taskId = 't-1', contextId = 'ctx-1') {
  return async () =>
    new Response(
      `data: ${JSON.stringify({jsonrpc: '2.0', id: 1, result: {statusUpdate: {taskId, contextId, status: {state}}}})}\n\n`,
      {headers: {'content-type': 'text/event-stream'}},
    );
}

function boxOn(proxy: FakeProxy, card: Record<string, unknown> = CARD_1_0): MessageBox {
  let ids = 0;
  return new MessageBox({
    card,
    turns: proxy.turns,
    fetch: proxy.fetch,
    newMessageId: () => `m-${++ids}`,
  });
}

describe('the message box', () => {
  it('answers with the trace id of the turn the proxy opened for its message', async () => {
    const proxy = new FakeProxy();
    const box = boxOn(proxy);
    proxy.replies.push(streamReply('TASK_STATE_COMPLETED'));
    const sent = await box.send('Hi');
    assert.deepEqual(sent, {traceId: proxy.sent[0].traceId});
    assert.equal(proxy.sent[0].url, URL_1_0);
    assert.deepEqual(box.state(), {openTurn: sent.traceId});
    await proxy.close(sent.traceId);
    assert.deepEqual(box.state(), {conversationId: 'ctx-1'});
    box.close();
  });

  it('carries the conversation, and the task after a turn that ended waiting for input', async () => {
    const proxy = new FakeProxy();
    const box = boxOn(proxy);
    proxy.replies.push(
      streamReply('TASK_STATE_INPUT_REQUIRED'),
      streamReply('TASK_STATE_COMPLETED'),
      streamReply('TASK_STATE_COMPLETED', 't-2'),
    );
    await proxy.close((await box.send('Hi')).traceId);
    const second = await box.send('Ada');
    assert.equal(second.conversationId, 'ctx-1');
    await proxy.close(second.traceId);
    await proxy.close((await box.send('Again')).traceId);

    assert.equal(proxy.sent[0].message.contextId, undefined);
    assert.equal(proxy.sent[0].message.taskId, undefined);
    assert.equal(proxy.sent[1].message.contextId, 'ctx-1');
    assert.equal(proxy.sent[1].message.taskId, 't-1');
    assert.equal(proxy.sent[2].message.contextId, 'ctx-1');
    assert.equal(proxy.sent[2].message.taskId, undefined, 'A completed task is not sent back.');
    box.close();
  });

  it('refuses a send while the last turn is open, until that turn closes', async () => {
    const proxy = new FakeProxy();
    const box = boxOn(proxy);
    proxy.replies.push(streamReply('TASK_STATE_COMPLETED'), streamReply('TASK_STATE_COMPLETED'));
    const first = await box.send('Hi');
    await assert.rejects(box.send('Again'), (error: unknown) => {
      assert.ok(error instanceof MessageBoxError);
      assert.equal(error.status, 409);
      assert.match(error.message, /A turn is still open in this conversation/);
      return true;
    });
    await proxy.close(first.traceId);
    await box.send('Again');
    assert.equal(proxy.sent.length, 2);
    box.close();
  });

  it('starts a new conversation at any time, which an earlier reply does not change', async () => {
    const proxy = new FakeProxy();
    const box = boxOn(proxy);
    proxy.replies.push(
      streamReply('TASK_STATE_INPUT_REQUIRED'),
      streamReply('TASK_STATE_INPUT_REQUIRED', 't-2', 'ctx-2'),
    );
    const first = await box.send('Hi');
    assert.deepEqual(box.newConversation(), {});
    const second = await box.send('Hello again');
    await proxy.close(first.traceId);
    assert.deepEqual(box.state(), {openTurn: second.traceId});
    await proxy.close(second.traceId);
    assert.deepEqual(box.state(), {conversationId: 'ctx-2'});
    assert.equal(proxy.sent[1].message.contextId, undefined);
    box.close();
  });

  it('refuses every send when the card lists no JSON-RPC interface it speaks', async () => {
    const proxy = new FakeProxy();
    const box = boxOn(proxy, {
      supportedInterfaces: [{url: URL_1_0, protocolBinding: 'JSONRPC', protocolVersion: '2.0'}],
    });
    const unavailable =
      'The message box cannot send to this agent: its card lists A2A JSON-RPC only at version 2.0, ' +
      'and the box speaks A2A 0.3 and 1.0. Hosts pointed at the wire proxy are not affected.';
    assert.equal(box.unavailable, unavailable);
    assert.deepEqual(box.state(), {unavailable});
    await assert.rejects(box.send('Hi'), {status: 422, message: unavailable});
    assert.equal(proxy.sent.length, 0);
    box.close();
  });

  it('reports a wire proxy it cannot reach, and stays free to send', async () => {
    const turns = new TurnHub();
    let calls = 0;
    const box = new MessageBox({
      card: CARD_1_0,
      turns,
      fetch: () => {
        calls++;
        return Promise.reject(new Error('connect ECONNREFUSED'));
      },
    });
    await assert.rejects(box.send('Hi'), {
      status: 502,
      message: 'The message box could not reach the wire proxy: connect ECONNREFUSED',
    });
    await assert.rejects(box.send('Hi'), {status: 502});
    assert.equal(calls, 2);
    box.close();
  });
});
