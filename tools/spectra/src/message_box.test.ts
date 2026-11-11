import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {capabilitiesFor} from './a2a/client.js';
import {MessageBox, MessageBoxError, type ReplayHooks} from './message_box.js';
import type {ModelCallEvent, Turn, TurnOutcome, TurnRecord} from './record/turn_record.js';
import type {ReplayPool} from './replay/pool.js';
import {type HubEvent, TurnHub} from './turn_hub.js';

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
      spanId: '0'.repeat(16),
      startTimeUnixNano: '1792576800000000000',
      messageId: String(body.params.message.messageId),
    });
    const reply = this.replies.shift();
    assert.ok(reply, 'A reply is queued for each request.');
    return reply();
  };

  /** Closes a turn as the recorder does, once the reply has been read. */
  async close(traceId: string, conversationId?: string, outcome?: TurnOutcome): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 10));
    this.turns.onRecorded(turnOf(traceId, conversationId, outcome));
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  /** Closes each turn as it opens, with the next closing given, as the agent's replies would end them. */
  closeAsOpened(closings: Array<{conversationId?: string; outcome?: TurnOutcome}>): void {
    const pending = [...closings];
    this.turns.subscribe(event => {
      if (event.type !== 'turn_opened') return;
      const next = pending.shift();
      if (next !== undefined) void this.close(event.traceId, next.conversationId, next.outcome);
    });
  }
}

function turnOf(
  traceId: string,
  conversationId?: string,
  outcome: TurnOutcome = 'completed',
): Turn {
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
          'a2ui.turn.outcome': outcome,
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
    replay?: ReplayHooks;
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
      a2aVersion: '1.0',
      conversations: [{turns: [sent.traceId], openTurn: sent.traceId}],
    });
    await proxy.close(sent.traceId);
    assert.deepEqual(box.state(), {
      a2aVersion: '1.0',
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
      a2aVersion: '1.0',
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
      a2aVersion: '1.0',
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
      a2aVersion: '1.0',
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
    assert.deepEqual(box.state(), {a2aVersion: '1.0', conversations: [{turns: [first.traceId]}]});
    const second = await box.send('Again');
    await proxy.close(second.traceId);
    assert.deepEqual(box.state(), {
      a2aVersion: '1.0',
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

  it('sends an action with the data model in a conversation it started, and refuses one that would start a conversation', async () => {
    const proxy = new FakeProxy();
    const box = boxOn(proxy);
    proxy.replies.push(
      streamReply('TASK_STATE_INPUT_REQUIRED'),
      streamReply('TASK_STATE_COMPLETED'),
    );
    await proxy.close((await box.send('Book a table')).traceId);
    const action = {
      version: '1.0',
      action: {
        name: 'submit_booking',
        surfaceId: 'booking',
        sourceComponentId: 'submit',
        timestamp: '2026-10-29T10:00:00.000Z',
        context: {partySize: 2},
      },
    };
    const dataModel = {version: '1.0', surfaces: {booking: {partySize: 2}}};
    await assert.rejects(box.send({action}), {status: 400});
    assert.equal(proxy.sent.length, 1);
    const sent = await box.send({action, dataModel}, 'ctx-1');
    await proxy.close(sent.traceId);
    assert.deepEqual(proxy.sent[1].message.parts, [
      {data: [action], mediaType: 'application/a2ui+json'},
    ]);
    assert.equal(proxy.sent[1].message.contextId, 'ctx-1');
    assert.equal(proxy.sent[1].message.taskId, 't-1');
    assert.deepEqual(
      (proxy.sent[1].message.metadata as Record<string, unknown>).a2uiRendererDataModel,
      dataModel,
    );
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
      a2aVersion: '1.0',
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
    assert.deepEqual(box.state(), {a2aVersion: '1.0', conversations: []});
    box.close();
  });
});

/** What the box asks of the session during a replay, each call kept. */
class FakeHooks implements ReplayHooks {
  pools: ReplayPool[] = [];
  disarmed = 0;
  annotated: Array<[string, Record<string, unknown>]> = [];
  amended: Array<[string, Record<string, unknown>]> = [];
  lines: string[] = [];
  arm(pool: ReplayPool): void {
    this.pools.push(pool);
  }
  disarm(): void {
    this.disarmed++;
  }
  annotate(traceId: string, attributes: Record<string, unknown>): void {
    this.annotated.push([traceId, attributes]);
  }
  async amend(traceId: string, attributes: Record<string, unknown>): Promise<void> {
    this.amended.push([traceId, attributes]);
  }
  log(line: string): void {
    this.lines.push(line);
  }
}

const CAPABILITIES = {'v0.9.1': {supportedCatalogIds: ['a']}, '1.0': {supportedCatalogIds: ['b']}};
const RECORDED = ['1'.repeat(32), '2'.repeat(32), '3'.repeat(32)];

/** A recorded turn: its turn event with the outcome, and the host's text with its capabilities and metadata. */
function recordedTurn(
  traceId: string,
  outcome: TurnOutcome,
  input: Record<string, unknown> = {'a2ui.wire.capabilities': CAPABILITIES},
  calls: ModelCallEvent[] = [],
): Turn {
  const turn = turnOf(traceId, 'recorded-ctx', outcome);
  return {
    events: [
      ...turn.events,
      {
        traceId,
        spanId: '0000000000000001',
        parentSpanId: '0000000000000000',
        name: 'wire_input',
        kind: 1,
        startTimeUnixNano: '1792576800100000000',
        attributes: {
          'a2ui.event.kind': 'wire_input',
          'a2ui.wire.message': {role: 'user', parts: [{type: 'text', content: 'Hi'}]},
          ...input,
        },
      },
      ...calls,
    ],
  };
}

function modelCall(traceId: string, spanId: string): ModelCallEvent {
  return {
    traceId,
    spanId,
    parentSpanId: '0000000000000000',
    name: 'chat',
    kind: 3,
    startTimeUnixNano: '1792576800200000000',
    endTimeUnixNano: '1792576800300000000',
    attributes: {
      'a2ui.event.kind': 'model_call',
      'http.request.method': 'POST',
      'url.full': 'https://api.anthropic.com/v1/messages',
      'a2ui.http.request.body': {model: 'claude', messages: [{role: 'user', content: 'Hi'}]},
    },
    status: {code: 1},
  };
}

function recordOf(...turns: Turn[]): TurnRecord {
  return {version: 'v0.1', turns: turns as TurnRecord['turns']};
}

const SOURCE = 'a2ui-spectra-fixtures/hello.json';

function replayEvents(events: HubEvent[]): HubEvent[] {
  return events.filter(event => event.type.startsWith('replay_'));
}

type ReplayEnd = Extract<HubEvent, {type: 'replay_ended'}>;

/** Resolves once the hub has sent the replay's end. */
async function replayEnd(events: HubEvent[]): Promise<ReplayEnd> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const found = events.find(event => event.type === 'replay_ended');
    if (found !== undefined) return found as ReplayEnd;
    assert.ok(Date.now() < deadline, 'The replay ended.');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

/** Resolves once the hub has sent the end of a replay that took verdicts. */
async function ended(events: HubEvent[]): Promise<Exclude<ReplayEnd, {mode: 'live'}>> {
  const end = await replayEnd(events);
  if (end.mode === 'live') assert.fail('The replay took verdicts.');
  return end;
}

describe('the message box replaying a record', () => {
  it('re-sends each recorded turn in order as one new conversation, the first with no contextId, the next with the one the agent named and the task after a turn that ended waiting for input', async () => {
    const proxy = new FakeProxy();
    const hooks = new FakeHooks();
    const box = boxOn(proxy, CARD_1_0, {replay: hooks});
    const events: HubEvent[] = [];
    proxy.turns.subscribe(event => events.push(event));
    proxy.replies.push(
      streamReply('TASK_STATE_INPUT_REQUIRED'),
      streamReply('TASK_STATE_COMPLETED'),
    );
    proxy.closeAsOpened([
      {conversationId: 'ctx-1', outcome: 'waiting_for_input'},
      {conversationId: 'ctx-1', outcome: 'completed'},
    ]);
    const record = recordOf(
      recordedTurn(RECORDED[0], 'waiting_for_input', {
        'a2ui.wire.capabilities': CAPABILITIES,
        'a2ui.wire.metadata': {source: 'planner'},
      }),
      recordedTurn(RECORDED[1], 'completed', {
        'a2ui.wire.message': {
          role: 'user',
          parts: [{type: 'a2ui', content: {version: '1.0', action: {name: 'go'}}}],
        },
        'a2ui.wire.data_model': {version: '1.0', surfaces: {s1: {}}},
      }),
    );

    const started = await box.replay({path: SOURCE, record}, 'model_live');
    assert.deepEqual(started, {traceId: proxy.sent[0].traceId, turns: 2});
    assert.deepEqual(box.state().replay, {source: SOURCE, mode: 'model_live', turn: 1, turns: 2});
    const end = await ended(events);

    assert.equal(proxy.sent.length, 2);
    const [first, second] = proxy.sent;
    assert.deepEqual(first.message, {
      messageId: 'm-1',
      role: 'ROLE_USER',
      parts: [{text: 'Hi'}],
      metadata: {
        source: 'planner',
        a2uiClientCapabilities: {'v0.9.1': CAPABILITIES['v0.9.1']},
        a2uiRendererCapabilities: {'1.0': CAPABILITIES['1.0']},
      },
    });
    assert.equal(
      first.headers['a2a-extensions'],
      'https://a2ui.org/a2a-extension/a2ui/v0.9.1, https://a2ui.org/a2a-extension/a2ui/v1.0',
    );
    assert.deepEqual(second.message, {
      messageId: 'm-2',
      role: 'ROLE_USER',
      parts: [{data: {version: '1.0', action: {name: 'go'}}, mediaType: 'application/a2ui+json'}],
      contextId: 'ctx-1',
      taskId: 't-1',
      metadata: {a2uiRendererDataModel: {version: '1.0', surfaces: {s1: {}}}},
    });
    assert.equal(
      second.headers['a2a-extensions'],
      undefined,
      'The second input offered nothing the record shows.',
    );

    assert.equal(hooks.pools.length, 1, 'Armed once, before the first send.');
    assert.equal(hooks.disarmed, 1);
    assert.deepEqual(hooks.annotated, [
      [
        first.traceId,
        {
          'a2ui.replay.source': SOURCE,
          'a2ui.replay.turn': RECORDED[0],
          'a2ui.replay.mode': 'model_live',
        },
      ],
      [
        second.traceId,
        {
          'a2ui.replay.source': SOURCE,
          'a2ui.replay.turn': RECORDED[1],
          'a2ui.replay.mode': 'model_live',
        },
      ],
    ]);
    assert.deepEqual(hooks.amended, [
      [first.traceId, {'a2ui.replay.verdict': 'passed'}],
      [second.traceId, {'a2ui.replay.verdict': 'passed'}],
    ]);
    assert.deepEqual(replayEvents(events), [
      {type: 'replay_started', source: SOURCE, mode: 'model_live', turns: 2},
      {type: 'replay_turn', traceId: first.traceId, recordedTurn: RECORDED[0], turn: 1, turns: 2},
      {type: 'replay_turn', traceId: second.traceId, recordedTurn: RECORDED[1], turn: 2, turns: 2},
      end,
    ]);
    assert.deepEqual(end, {
      type: 'replay_ended',
      source: SOURCE,
      mode: 'model_live',
      verdict: 'passed',
      turns: [
        {traceId: first.traceId, recordedTurn: RECORDED[0], verdict: 'passed', unconsumed: 0},
        {traceId: second.traceId, recordedTurn: RECORDED[1], verdict: 'passed', unconsumed: 0},
      ],
    });
    assert.equal(box.state().replay, undefined);
    assert.deepEqual(box.state().conversations, [
      {conversationId: 'ctx-1', turns: [first.traceId, second.traceId]},
    ]);

    // The replayed conversation goes on from the composer.
    proxy.replies.push(streamReply('TASK_STATE_COMPLETED'));
    const more = await box.send('More', 'ctx-1');
    assert.equal(proxy.sent[2].message.contextId, 'ctx-1');
    await proxy.close(more.traceId, 'ctx-1');
    box.close();
  });

  it('sends no task id when the live previous turn did not end waiting for input, nor for a request recorded without one', async () => {
    const proxy = new FakeProxy();
    const hooks = new FakeHooks();
    const box = boxOn(proxy, CARD_1_0, {replay: hooks});
    const events: HubEvent[] = [];
    proxy.turns.subscribe(event => events.push(event));
    proxy.replies.push(
      streamReply('TASK_STATE_COMPLETED'),
      streamReply('TASK_STATE_INPUT_REQUIRED'),
      streamReply('TASK_STATE_COMPLETED'),
    );
    proxy.closeAsOpened([
      {conversationId: 'ctx-1', outcome: 'completed'},
      {conversationId: 'ctx-1', outcome: 'waiting_for_input'},
      {conversationId: 'ctx-1', outcome: 'completed'},
    ]);
    // Recorded: waiting, completed, completed. Live: completed, waiting, completed.
    const record = recordOf(
      recordedTurn(RECORDED[0], 'waiting_for_input'),
      recordedTurn(RECORDED[1], 'completed'),
      recordedTurn(RECORDED[2], 'completed'),
    );
    await box.replay({path: SOURCE, record}, 'model_live');
    const end = await ended(events);
    assert.deepEqual(
      proxy.sent.map(({message}) => [message.contextId, message.taskId]),
      [
        [undefined, undefined],
        ['ctx-1', undefined],
        ['ctx-1', undefined],
      ],
    );
    assert.equal(end.verdict, 'failed');
    assert.deepEqual(
      hooks.amended.map(([, attributes]) => attributes),
      [
        {
          'a2ui.replay.verdict': 'failed',
          'a2ui.replay.reasons': [
            {
              code: 'OUTCOME_DIFFERS',
              message: 'The turn ended completed; the record ended waiting for input.',
            },
          ],
        },
        {
          'a2ui.replay.verdict': 'failed',
          'a2ui.replay.reasons': [
            {
              code: 'OUTCOME_DIFFERS',
              message: 'The turn ended waiting for input; the record ended completed.',
            },
          ],
        },
        {'a2ui.replay.verdict': 'passed'},
      ],
    );
    box.close();
  });

  it('counts the recorded calls a turn never asked for, says so on the terminal, and does not fail the verdict for them', async () => {
    const proxy = new FakeProxy();
    const hooks = new FakeHooks();
    const box = boxOn(proxy, CARD_1_0, {replay: hooks});
    const events: HubEvent[] = [];
    proxy.turns.subscribe(event => events.push(event));
    proxy.replies.push(streamReply('TASK_STATE_COMPLETED'));
    proxy.closeAsOpened([{conversationId: 'ctx-1'}]);
    const record = recordOf(
      recordedTurn(RECORDED[0], 'completed', undefined, [
        modelCall(RECORDED[0], 'aaaaaaaaaaaaaaaa'),
        modelCall(RECORDED[0], 'bbbbbbbbbbbbbbbb'),
      ]),
    );
    await box.replay({path: SOURCE, record}, 'recorded');
    const end = await ended(events);
    assert.deepEqual(end.turns, [
      {traceId: proxy.sent[0].traceId, recordedTurn: RECORDED[0], verdict: 'passed', unconsumed: 2},
    ]);
    assert.deepEqual(hooks.lines, [
      `Replay of ${SOURCE}, turn 1 of 1: passed; 2 of the recorded calls were not asked for.`,
    ]);
    box.close();
  });

  it("names on the terminal a host app's turn that opens while the replay runs, its calls meeting the armed pool", async () => {
    const proxy = new FakeProxy();
    const hooks = new FakeHooks();
    const box = boxOn(proxy, CARD_1_0, {replay: hooks});
    const events: HubEvent[] = [];
    proxy.turns.subscribe(event => events.push(event));
    proxy.replies.push(streamReply('TASK_STATE_COMPLETED'));
    const record = recordOf(recordedTurn(RECORDED[0], 'completed'));
    const started = await box.replay({path: SOURCE, record}, 'model_live');
    // Another host's turn, through the wire proxy, while the replayed turn is open.
    const host = 'e'.repeat(32);
    proxy.turns.onTurn({
      type: 'turn_opened',
      traceId: host,
      spanId: '0'.repeat(16),
      startTimeUnixNano: '1792576800000000000',
      messageId: 'host-1',
    });
    proxy.turns.onTurn({
      type: 'wire_event',
      traceId: host,
      event: {
        traceId: host,
        spanId: '1'.repeat(16),
        parentSpanId: '0'.repeat(16),
        name: 'wire_input',
        kind: 1,
        startTimeUnixNano: '1792576800000000000',
        attributes: {
          'a2ui.event.kind': 'wire_input',
          'a2ui.wire.message': {
            role: 'user',
            parts: [{type: 'text', content: 'Who is Alex Jordan?'}],
          },
        },
      },
    });
    await proxy.close(started.traceId, 'ctx-1');
    await ended(events);
    assert.deepEqual(hooks.lines, [
      `A turn from another host opened while ${SOURCE} replays: “Who is Alex Jordan?”, trace ${host}. Its model and tool calls meet the record the proxies are replaying.`,
      `Replay of ${SOURCE}, turn 1 of 1: passed.`,
    ]);
    proxy.turns.onRecorded(turnOf(host));
    box.close();
  });

  it('refuses to start while a turn is open anywhere, while a replay runs, and refuses a send while it runs', async () => {
    const proxy = new FakeProxy();
    const hooks = new FakeHooks();
    const box = boxOn(proxy, CARD_1_0, {replay: hooks});
    const record = recordOf(recordedTurn(RECORDED[0], 'completed'));
    proxy.turns.onTurn({
      type: 'turn_opened',
      traceId: 'f'.repeat(32),
      spanId: '0'.repeat(16),
      startTimeUnixNano: '1792576800000000000',
    });
    await assert.rejects(box.replay({path: SOURCE, record}, 'model_live'), {
      status: 409,
      message: 'A turn is open. Wait for it to close before replaying.',
    });
    proxy.turns.onRecorded(turnOf('f'.repeat(32)));
    assert.equal(hooks.pools.length, 0);

    proxy.replies.push(streamReply('TASK_STATE_COMPLETED'));
    const started = await box.replay({path: SOURCE, record}, 'model_live');
    await assert.rejects(box.replay({path: SOURCE, record}, 'model_live'), {
      status: 409,
      message: 'A replay is running. Wait for it to end.',
    });
    await assert.rejects(box.send('Hi'), {
      status: 409,
      message: 'A replay is running. The message box sends again once it ends.',
    });
    const events: HubEvent[] = [];
    proxy.turns.subscribe(event => events.push(event));
    await proxy.close(started.traceId, 'ctx-1');
    await ended(events);
    proxy.replies.push(streamReply('TASK_STATE_COMPLETED'));
    await box.send('Hi');
    box.close();
  });

  it('refuses everything recorded on a record with nothing to serve, a record it cannot read, and any replay when it cannot send', async () => {
    const proxy = new FakeProxy();
    const hooks = new FakeHooks();
    const box = boxOn(proxy, CARD_1_0, {replay: hooks});
    const empty = recordOf(recordedTurn(RECORDED[0], 'completed'));
    await assert.rejects(box.replay({path: SOURCE, record: empty}, 'recorded'), {
      status: 422,
      message:
        'The record holds no model call and no tool call, so there is nothing to serve with everything recorded. Replay it with the model live.',
    });
    const noInput = recordOf(turnOf(RECORDED[0], 'recorded-ctx'));
    await assert.rejects(box.replay({path: SOURCE, record: noInput}, 'model_live'), {
      status: 422,
      message: 'Turn 1 of the record has no wire input, so there is nothing to send for it.',
    });
    assert.equal(hooks.pools.length, 0);
    const unavailable = boxOn(proxy, CARD_1_0, {replay: hooks, unsetVariables: ['TOKEN']});
    await assert.rejects(unavailable.replay({path: SOURCE, record: empty}, 'model_live'), {
      status: 422,
    });
    const noHooks = boxOn(proxy);
    await assert.rejects(noHooks.replay({path: SOURCE, record: empty}, 'model_live'), {
      status: 422,
      message: 'Replay is not available in this session.',
    });
    box.close();
    unavailable.close();
    noHooks.close();
  });

  it('stops at a turn it cannot send, reporting it and the rest as not sent, the record failed, the proxies disarmed', async () => {
    const proxy = new FakeProxy();
    const hooks = new FakeHooks();
    let sends = 0;
    const turns = proxy.turns;
    const box = new MessageBox({
      card: CARD_1_0,
      turns,
      replay: hooks,
      newMessageId: () => `m-${++sends}`,
      fetch: (input, init) =>
        sends === 1 ? proxy.fetch(input, init) : Promise.reject(new Error('connect ECONNREFUSED')),
    });
    const events: HubEvent[] = [];
    turns.subscribe(event => events.push(event));
    proxy.replies.push(streamReply('TASK_STATE_COMPLETED'));
    proxy.closeAsOpened([{conversationId: 'ctx-1'}]);
    const record = recordOf(
      recordedTurn(RECORDED[0], 'completed'),
      recordedTurn(RECORDED[1], 'completed'),
      recordedTurn(RECORDED[2], 'completed'),
    );
    const started = await box.replay({path: SOURCE, record}, 'model_live');
    const end = await ended(events);
    assert.deepEqual(end.turns, [
      {traceId: started.traceId, recordedTurn: RECORDED[0], verdict: 'passed', unconsumed: 0},
      {
        recordedTurn: RECORDED[1],
        notSent: 'The message box could not reach the wire proxy: connect ECONNREFUSED',
      },
      {
        recordedTurn: RECORDED[2],
        notSent: 'The message box could not reach the wire proxy: connect ECONNREFUSED',
      },
    ]);
    assert.equal(end.verdict, 'failed');
    assert.equal(hooks.disarmed, 1);
    assert.equal(box.state().replay, undefined);
    box.close();
  });

  it('rejects when the first turn cannot be sent, the replay over before it began', async () => {
    const hooks = new FakeHooks();
    const turns = new TurnHub();
    const box = new MessageBox({
      card: CARD_1_0,
      turns,
      replay: hooks,
      fetch: () => Promise.reject(new Error('connect ECONNREFUSED')),
    });
    const events: HubEvent[] = [];
    turns.subscribe(event => events.push(event));
    const record = recordOf(recordedTurn(RECORDED[0], 'completed'));
    await assert.rejects(box.replay({path: SOURCE, record}, 'model_live'), {status: 502});
    assert.equal(hooks.pools.length, 1);
    assert.equal(hooks.disarmed, 1);
    assert.equal(box.state().replay, undefined);
    assert.deepEqual(
      replayEvents(events).map(event => event.type),
      ['replay_started', 'replay_ended'],
    );
    box.close();
  });

  it('replays live with no proxy armed: the provenance as each turn opens, no verdict, the outcome on the terminal and an end with no verdict', async () => {
    const proxy = new FakeProxy();
    const hooks = new FakeHooks();
    const box = boxOn(proxy, CARD_1_0, {replay: hooks});
    const events: HubEvent[] = [];
    proxy.turns.subscribe(event => events.push(event));
    proxy.replies.push(streamReply('TASK_STATE_COMPLETED'), streamReply('TASK_STATE_COMPLETED'));
    proxy.closeAsOpened([
      {conversationId: 'ctx-1', outcome: 'completed'},
      {conversationId: 'ctx-1', outcome: 'waiting_for_input'},
    ]);
    // The record holds a call a pool would serve, and its second turn ended otherwise than this one will.
    const record = recordOf(
      recordedTurn(RECORDED[0], 'completed', undefined, [
        modelCall(RECORDED[0], 'aaaaaaaaaaaaaaaa'),
      ]),
      recordedTurn(RECORDED[1], 'completed'),
    );

    const started = await box.replay({path: SOURCE, record}, 'live');
    assert.deepEqual(started, {traceId: proxy.sent[0].traceId, turns: 2});
    assert.deepEqual(box.state().replay, {source: SOURCE, mode: 'live', turn: 1, turns: 2});
    const end = await replayEnd(events);

    const [first, second] = proxy.sent;
    assert.equal(hooks.pools.length, 0, 'No proxy is armed.');
    assert.equal(hooks.disarmed, 0);
    assert.deepEqual(hooks.annotated, [
      [
        first.traceId,
        {
          'a2ui.replay.source': SOURCE,
          'a2ui.replay.turn': RECORDED[0],
          'a2ui.replay.mode': 'live',
        },
      ],
      [
        second.traceId,
        {
          'a2ui.replay.source': SOURCE,
          'a2ui.replay.turn': RECORDED[1],
          'a2ui.replay.mode': 'live',
        },
      ],
    ]);
    assert.deepEqual(hooks.amended, [], 'No verdict and no reasons are written.');
    assert.deepEqual(hooks.lines, [
      `Re-run of ${SOURCE}, turn 1 of 2: completed.`,
      `Re-run of ${SOURCE}, turn 2 of 2: waiting for input.`,
    ]);
    assert.deepEqual(replayEvents(events), [
      {type: 'replay_started', source: SOURCE, mode: 'live', turns: 2},
      {type: 'replay_turn', traceId: first.traceId, recordedTurn: RECORDED[0], turn: 1, turns: 2},
      {type: 'replay_turn', traceId: second.traceId, recordedTurn: RECORDED[1], turn: 2, turns: 2},
      end,
    ]);
    assert.deepEqual(end, {
      type: 'replay_ended',
      source: SOURCE,
      mode: 'live',
      turns: [
        {traceId: first.traceId, recordedTurn: RECORDED[0]},
        {traceId: second.traceId, recordedTurn: RECORDED[1]},
      ],
    });
    assert.equal(box.state().replay, undefined);
    box.close();
  });

  it("says nothing on the terminal for a host app's turn that opens while a live replay runs", async () => {
    const proxy = new FakeProxy();
    const hooks = new FakeHooks();
    const box = boxOn(proxy, CARD_1_0, {replay: hooks});
    const events: HubEvent[] = [];
    proxy.turns.subscribe(event => events.push(event));
    proxy.replies.push(streamReply('TASK_STATE_COMPLETED'));
    const record = recordOf(recordedTurn(RECORDED[0], 'completed'));
    const started = await box.replay({path: SOURCE, record}, 'live');
    const host = 'e'.repeat(32);
    proxy.turns.onTurn({
      type: 'turn_opened',
      traceId: host,
      spanId: '0'.repeat(16),
      startTimeUnixNano: '1792576800000000000',
      messageId: 'host-1',
    });
    proxy.turns.onTurn({
      type: 'wire_event',
      traceId: host,
      event: {
        traceId: host,
        spanId: '1'.repeat(16),
        parentSpanId: '0'.repeat(16),
        name: 'wire_input',
        kind: 1,
        startTimeUnixNano: '1792576800000000000',
        attributes: {
          'a2ui.event.kind': 'wire_input',
          'a2ui.wire.message': {
            role: 'user',
            parts: [{type: 'text', content: 'Who is Alex Jordan?'}],
          },
        },
      },
    });
    await proxy.close(started.traceId, 'ctx-1');
    await replayEnd(events);
    assert.deepEqual(hooks.lines, [`Re-run of ${SOURCE}, turn 1 of 1: completed.`]);
    proxy.turns.onRecorded(turnOf(host));
    box.close();
  });

  it('refuses a live replay while a turn is open anywhere, while a replay runs and when it cannot send, and starts one on a record with nothing to serve', async () => {
    const proxy = new FakeProxy();
    const hooks = new FakeHooks();
    const box = boxOn(proxy, CARD_1_0, {replay: hooks});
    const nothingToServe = recordOf(recordedTurn(RECORDED[0], 'completed'));
    proxy.turns.onTurn({
      type: 'turn_opened',
      traceId: 'f'.repeat(32),
      spanId: '0'.repeat(16),
      startTimeUnixNano: '1792576800000000000',
    });
    await assert.rejects(box.replay({path: SOURCE, record: nothingToServe}, 'live'), {
      status: 409,
      message: 'A turn is open. Wait for it to close before replaying.',
    });
    proxy.turns.onRecorded(turnOf('f'.repeat(32)));

    proxy.replies.push(streamReply('TASK_STATE_COMPLETED'));
    const started = await box.replay({path: SOURCE, record: nothingToServe}, 'live');
    await assert.rejects(box.replay({path: SOURCE, record: nothingToServe}, 'live'), {
      status: 409,
      message: 'A replay is running. Wait for it to end.',
    });
    await assert.rejects(box.send('Hi'), {
      status: 409,
      message: 'A replay is running. The message box sends again once it ends.',
    });
    const events: HubEvent[] = [];
    proxy.turns.subscribe(event => events.push(event));
    await proxy.close(started.traceId, 'ctx-1');
    await replayEnd(events);

    const unavailable = boxOn(proxy, CARD_1_0, {replay: hooks, unsetVariables: ['TOKEN']});
    await assert.rejects(unavailable.replay({path: SOURCE, record: nothingToServe}, 'live'), {
      status: 422,
      message: "Can't send · TOKEN is not set in Spectra's environment",
    });
    box.close();
    unavailable.close();
  });
});

describe("the message box following the agent's process under run", () => {
  const CARD_0_3 = {url: 'http://127.0.0.1:10999/', protocolVersion: '0.3.0'};

  it('refuses by the state of the process, then by the card, then by an unset variable, the first that applies winning', async () => {
    const proxy = new FakeProxy();
    let ids = 0;
    const box = new MessageBox({
      turns: proxy.turns,
      fetch: proxy.fetch,
      newMessageId: () => `m-${++ids}`,
      unsetVariables: ['TOKEN'],
    });
    const refusal = async (expected: string) => {
      assert.equal(box.unavailable, expected);
      assert.equal(box.state().unavailable, expected);
      await assert.rejects(box.send('Hi'), {status: 422, message: expected});
    };
    box.setAgentState('starting');
    await refusal("Can't send · the agent is starting");
    box.setAgentState('waiting');
    await refusal("Can't send · waiting for the agent's card");
    assert.equal(box.state().a2aVersion, undefined);

    box.setCard({name: 'No interface', supportedInterfaces: []});
    box.setAgentState('running');
    await refusal("Can't send · the agent's card lists no interface to reach it at");
    box.setCard({url: 'http://127.0.0.1:10999/', preferredTransport: 'GRPC'});
    await refusal("Can't send · the agent's card lists no A2A JSON-RPC interface, only GRPC");
    box.setCard({
      url: 'http://127.0.0.1:10999/',
      preferredTransport: 'GRPC',
      additionalInterfaces: [{url: 'http://127.0.0.1:10999/', transport: 'HTTP+JSON'}],
    });
    await refusal(
      "Can't send · the agent's card lists no A2A JSON-RPC interface, only GRPC, HTTP+JSON",
    );
    box.setCard({
      supportedInterfaces: [{url: URL_1_0, protocolBinding: 'JSONRPC', protocolVersion: '2.0'}],
    });
    await refusal(
      'The message box cannot send to this agent: its card lists A2A JSON-RPC only at version 2.0, ' +
        'and the box speaks A2A 0.3 and 1.0. Hosts pointed at the wire proxy are not affected.',
    );
    box.setCard(CARD_1_0);
    await refusal("Can't send · TOKEN is not set in Spectra's environment");

    box.setAgentState('restarting');
    await refusal("Can't send · the agent is restarting");
    box.setAgentState('down');
    await refusal("Can't send · the agent is down");
    assert.equal(proxy.sent.length, 0);
    box.close();
  });

  it('sends to the latest card: its interface, its A2A version and its choice of send or stream', async () => {
    const proxy = new FakeProxy();
    const box = boxOn(proxy, CARD_1_0);
    proxy.replies.push(streamReply('TASK_STATE_COMPLETED'), async () =>
      Response.json({
        jsonrpc: '2.0',
        id: 2,
        result: {kind: 'message', messageId: 'r-1', role: 'agent', contextId: 'ctx-2', parts: []},
      }),
    );
    await proxy.close((await box.send('Hi')).traceId);
    assert.equal(proxy.sent[0].url, URL_1_0);
    assert.equal(proxy.sent[0].headers.accept, 'text/event-stream');
    assert.equal(box.state().a2aVersion, '1.0');

    box.agentEnded('The agent was restarted.');
    box.setCard(CARD_0_3);
    assert.equal(box.state().a2aVersion, '0.3');
    await proxy.close((await box.send('Hi again')).traceId);
    assert.equal(proxy.sent[1].url, 'http://127.0.0.1:10999/');
    assert.equal(proxy.sent[1].headers.accept, 'application/json');
    assert.equal(proxy.sent[1].message.kind, 'message', 'An A2A 0.3 message.');
    box.close();
  });

  it("keeps each conversation's id and drops its task id when the agent's process ends", async () => {
    const proxy = new FakeProxy();
    const box = boxOn(proxy);
    proxy.replies.push(
      streamReply('TASK_STATE_INPUT_REQUIRED'),
      streamReply('TASK_STATE_INPUT_REQUIRED'),
    );
    await proxy.close((await box.send('Hi')).traceId);
    box.agentEnded("The agent's process exited with code 1.");
    const next = await box.send('Ada', 'ctx-1');
    await proxy.close(next.traceId);
    assert.equal(next.conversationId, 'ctx-1');
    assert.equal(proxy.sent[1].message.contextId, 'ctx-1');
    assert.equal(proxy.sent[1].message.taskId, undefined, 'The task lived in the stopped process.');
    assert.deepEqual(
      box.state().conversations.map(conversation => conversation.conversationId),
      ['ctx-1'],
    );
    box.close();
  });

  it('carries no task on from a reply read across the end of the process', async () => {
    const proxy = new FakeProxy();
    const box = boxOn(proxy);
    proxy.replies.push(
      streamReply('TASK_STATE_INPUT_REQUIRED'),
      streamReply('TASK_STATE_COMPLETED'),
    );
    const first = await box.send('Hi');
    box.agentEnded('The agent was restarted.');
    await proxy.close(first.traceId);
    await proxy.close((await box.send('Ada', 'ctx-1')).traceId);
    assert.equal(proxy.sent[1].message.contextId, 'ctx-1');
    assert.equal(proxy.sent[1].message.taskId, undefined);
    box.close();
  });

  it("stops a replay when the agent's process ends, its remaining turns not sent with the reason", async () => {
    const proxy = new FakeProxy();
    const hooks = new FakeHooks();
    const box = boxOn(proxy, CARD_1_0, {replay: hooks});
    const events: HubEvent[] = [];
    proxy.turns.subscribe(event => events.push(event));
    proxy.replies.push(brokenReply());
    const record = recordOf(
      recordedTurn(RECORDED[0], 'completed'),
      recordedTurn(RECORDED[1], 'completed'),
      recordedTurn(RECORDED[2], 'completed'),
    );
    const started = await box.replay({path: SOURCE, record}, 'model_live');
    box.setAgentState('restarting');
    box.agentEnded('The agent was restarted.');
    // The restart's cut fails the open turn.
    await proxy.close(started.traceId, 'ctx-1', 'failed');
    const end = await ended(events);
    assert.deepEqual(end.turns, [
      {traceId: started.traceId, recordedTurn: RECORDED[0], verdict: 'failed', unconsumed: 0},
      {recordedTurn: RECORDED[1], notSent: 'The agent was restarted.'},
      {recordedTurn: RECORDED[2], notSent: 'The agent was restarted.'},
    ]);
    assert.equal(end.verdict, 'failed');
    assert.equal(proxy.sent.length, 1, 'Nothing was sent after the process ended.');
    assert.equal(hooks.disarmed, 1);
    assert.equal(box.state().replay, undefined);

    // The next replay is not stopped by the earlier end.
    box.setAgentState('running');
    events.length = 0;
    proxy.replies.push(streamReply('TASK_STATE_COMPLETED'));
    proxy.closeAsOpened([{conversationId: 'ctx-2'}]);
    await box.replay(
      {path: SOURCE, record: recordOf(recordedTurn(RECORDED[0], 'completed'))},
      'model_live',
    );
    assert.equal((await ended(events)).verdict, 'passed');
    box.close();
  });

  it("stops a live replay when the agent's process ends, its remaining turns not sent with the reason", async () => {
    const proxy = new FakeProxy();
    const hooks = new FakeHooks();
    const box = boxOn(proxy, CARD_1_0, {replay: hooks});
    const events: HubEvent[] = [];
    proxy.turns.subscribe(event => events.push(event));
    proxy.replies.push(brokenReply());
    const record = recordOf(
      recordedTurn(RECORDED[0], 'completed'),
      recordedTurn(RECORDED[1], 'completed'),
      recordedTurn(RECORDED[2], 'completed'),
    );
    const started = await box.replay({path: SOURCE, record}, 'live');
    box.setAgentState('restarting');
    box.agentEnded('The agent was restarted.');
    await proxy.close(started.traceId, 'ctx-1', 'failed');
    assert.deepEqual(await replayEnd(events), {
      type: 'replay_ended',
      source: SOURCE,
      mode: 'live',
      turns: [
        {traceId: started.traceId, recordedTurn: RECORDED[0]},
        {recordedTurn: RECORDED[1], notSent: 'The agent was restarted.'},
        {recordedTurn: RECORDED[2], notSent: 'The agent was restarted.'},
      ],
    });
    assert.equal(proxy.sent.length, 1, 'Nothing was sent after the process ended.');
    assert.deepEqual(hooks.lines, [`Re-run of ${SOURCE}, turn 1 of 3: failed.`]);
    assert.equal(box.state().replay, undefined);
    box.close();
  });
});
