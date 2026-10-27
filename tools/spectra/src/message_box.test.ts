import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {capabilitiesFor} from './a2a/client.js';
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
  async close(traceId: string, conversationId?: string): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 10));
    this.turns.onRecorded(turnOf(traceId, conversationId));
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

function turnOf(traceId: string, conversationId?: string): Turn {
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
          ...(conversationId !== undefined && {'gen_ai.conversation.id': conversationId}),
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

/** A 1.0 stream reply that names its task and conversation, then breaks off. */
function brokenReply() {
  return async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          const task = {id: 't-1', contextId: 'ctx-1', status: {state: 'TASK_STATE_SUBMITTED'}};
          const event = {jsonrpc: '2.0', id: 1, result: {task}};
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
          controller.error(new Error('The agent hung up.'));
        },
      }),
      {headers: {'content-type': 'text/event-stream'}},
    );
}

/** A JSON-RPC error, which names no conversation. */
function errorReply() {
  return async () =>
    Response.json({jsonrpc: '2.0', id: 1, error: {code: -32603, message: 'Internal error'}});
}

function boxOn(
  proxy: FakeProxy,
  card: Record<string, unknown> = CARD_1_0,
  options: {
    headers?: Record<string, string>;
    unsetVariables?: string[];
    offer?: {'v0.9': string[]; 'v0.9.1': string[]; 'v1.0': string[]};
  } = {},
): MessageBox {
  let ids = 0;
  return new MessageBox({
    card,
    turns: proxy.turns,
    fetch: proxy.fetch,
    newMessageId: () => `m-${++ids}`,
    ...options,
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
    assert.deepEqual(box.state(), {
      conversations: [{turns: [sent.traceId], openTurn: sent.traceId}],
    });
    await proxy.close(sent.traceId);
    assert.deepEqual(box.state(), {
      conversations: [{conversationId: 'ctx-1', turns: [sent.traceId]}],
    });
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
    const second = await box.send('Ada', 'ctx-1');
    assert.equal(second.conversationId, 'ctx-1');
    await proxy.close(second.traceId);
    await proxy.close((await box.send('Again', 'ctx-1')).traceId);

    assert.equal(proxy.sent[0].message.contextId, undefined);
    assert.equal(proxy.sent[0].message.taskId, undefined);
    assert.equal(proxy.sent[1].message.contextId, 'ctx-1');
    assert.equal(proxy.sent[1].message.taskId, 't-1');
    assert.equal(proxy.sent[2].message.contextId, 'ctx-1');
    assert.equal(proxy.sent[2].message.taskId, undefined, 'A completed task is not sent back.');
    assert.equal(box.state().conversations.length, 1);
    box.close();
  });

  it('carries on the conversation its turn was recorded in when the reply broke off', async () => {
    const proxy = new FakeProxy();
    const box = boxOn(proxy);
    proxy.replies.push(brokenReply(), streamReply('TASK_STATE_COMPLETED'));
    const first = await box.send('Hi');
    await proxy.close(first.traceId, 'ctx-1');
    assert.deepEqual(box.state(), {
      conversations: [{conversationId: 'ctx-1', turns: [first.traceId]}],
    });
    await proxy.close((await box.send('Again', 'ctx-1')).traceId);
    assert.equal(proxy.sent[1].message.contextId, 'ctx-1');
    box.close();
  });

  it('holds each conversation apart, each with its own task, and continues an older one after a newer was sent in', async () => {
    const proxy = new FakeProxy();
    const box = boxOn(proxy);
    proxy.replies.push(
      streamReply('TASK_STATE_INPUT_REQUIRED'),
      streamReply('TASK_STATE_INPUT_REQUIRED', 't-2', 'ctx-2'),
      streamReply('TASK_STATE_COMPLETED'),
      streamReply('TASK_STATE_COMPLETED', 't-2', 'ctx-2'),
    );
    const first = await box.send('Top 3 Chinese restaurants');
    const second = await box.send('Top 3 Italian restaurants');
    assert.deepEqual(box.state(), {
      conversations: [
        {turns: [first.traceId], openTurn: first.traceId},
        {turns: [second.traceId], openTurn: second.traceId},
      ],
    });
    await proxy.close(first.traceId);
    await proxy.close(second.traceId);

    const third = await box.send('Book the first one', 'ctx-1');
    const fourth = await box.send('Book the second one', 'ctx-2');
    assert.deepEqual(
      proxy.sent.map(({message}) => [message.contextId, message.taskId]),
      [
        [undefined, undefined],
        [undefined, undefined],
        ['ctx-1', 't-1'],
        ['ctx-2', 't-2'],
      ],
    );
    await proxy.close(third.traceId);
    await proxy.close(fourth.traceId);
    assert.deepEqual(box.state(), {
      conversations: [
        {conversationId: 'ctx-1', turns: [first.traceId, third.traceId]},
        {conversationId: 'ctx-2', turns: [second.traceId, fourth.traceId]},
      ],
    });
    box.close();
  });

  it('starts a new conversation after a turn whose agent named none', async () => {
    const proxy = new FakeProxy();
    const box = boxOn(proxy);
    proxy.replies.push(errorReply(), streamReply('TASK_STATE_COMPLETED'));
    const first = await box.send('Hi');
    await proxy.close(first.traceId);
    assert.deepEqual(box.state(), {conversations: [{turns: [first.traceId]}]});
    const second = await box.send('Again');
    await proxy.close(second.traceId);
    assert.deepEqual(box.state(), {
      conversations: [{turns: [first.traceId]}, {conversationId: 'ctx-1', turns: [second.traceId]}],
    });
    box.close();
  });

  it("refuses a send while the conversation's turn is open, and only in that conversation", async () => {
    const proxy = new FakeProxy();
    const box = boxOn(proxy);
    proxy.replies.push(
      streamReply('TASK_STATE_COMPLETED'),
      streamReply('TASK_STATE_COMPLETED'),
      streamReply('TASK_STATE_COMPLETED', 't-2', 'ctx-2'),
      streamReply('TASK_STATE_COMPLETED'),
    );
    await proxy.close((await box.send('Hi')).traceId);
    const second = await box.send('Again', 'ctx-1');
    await assert.rejects(box.send('And again', 'ctx-1'), (error: unknown) => {
      assert.ok(error instanceof MessageBoxError);
      assert.equal(error.status, 409);
      assert.match(error.message, /A turn is still open in this conversation/);
      return true;
    });
    const other = await box.send('Hello');
    assert.deepEqual(
      box.state().conversations.map(conversation => conversation.openTurn),
      [second.traceId, other.traceId],
    );
    await proxy.close(second.traceId);
    await box.send('And again', 'ctx-1');
    assert.equal(proxy.sent.length, 4);
    box.close();
  });

  it('refuses to continue a conversation it did not start', async () => {
    const proxy = new FakeProxy();
    const box = boxOn(proxy);
    await assert.rejects(box.send('Hi', 'ctx-9'), {
      status: 404,
      message:
        'The message box did not start this conversation while Spectra runs. Send without a conversation to start a new one.',
    });
    assert.equal(proxy.sent.length, 0);
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
    assert.deepEqual(box.state(), {conversations: [], unavailable});
    await assert.rejects(box.send('Hi'), {status: 422, message: unavailable});
    assert.equal(proxy.sent.length, 0);
    box.close();
  });

  it('adds the configured headers to each request, its own transport headers winning', async () => {
    const proxy = new FakeProxy();
    const box = boxOn(proxy, CARD_1_0, {
      headers: {Authorization: 'Bearer t0k3n', 'Content-Type': 'text/plain'},
    });
    proxy.replies.push(streamReply('TASK_STATE_COMPLETED'));
    await proxy.close((await box.send('Hi')).traceId);
    assert.equal(proxy.sent[0].headers.authorization, 'Bearer t0k3n');
    assert.equal(proxy.sent[0].headers['content-type'], 'application/json');
    box.close();
  });

  it('advertises the catalogs it is given, under each version', async () => {
    const proxy = new FakeProxy();
    const offer = {'v0.9': ['a'], 'v0.9.1': ['a', 'b'], 'v1.0': ['c']};
    const box = boxOn(proxy, CARD_1_0, {offer});
    proxy.replies.push(streamReply('TASK_STATE_COMPLETED'));
    await proxy.close((await box.send('Hi')).traceId);
    assert.deepEqual(proxy.sent[0].message.metadata, capabilitiesFor(offer));
    box.close();
  });

  it("refuses every send while a header's variable is not set, naming it", async () => {
    const proxy = new FakeProxy();
    const box = boxOn(proxy, CARD_1_0, {
      headers: {},
      unsetVariables: ['SPECTRA_AGENT_TOKEN'],
    });
    const unavailable = "Can't send · SPECTRA_AGENT_TOKEN is not set in Spectra's environment";
    assert.equal(box.unavailable, unavailable);
    assert.deepEqual(box.state(), {
      conversations: [],
      unavailable,
      unsetVariables: ['SPECTRA_AGENT_TOKEN'],
    });
    await assert.rejects(box.send('Hi'), {status: 422, message: unavailable});
    assert.equal(proxy.sent.length, 0);
    const two = boxOn(proxy, CARD_1_0, {unsetVariables: ['TOKEN', 'TENANT']});
    assert.equal(
      two.unavailable,
      "Can't send · TOKEN and TENANT are not set in Spectra's environment",
    );
    box.close();
    two.close();
  });

  it('reports a wire proxy it cannot reach, keeping no conversation, and stays free to send', async () => {
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
    assert.deepEqual(box.state(), {conversations: []});
    box.close();
  });
});
