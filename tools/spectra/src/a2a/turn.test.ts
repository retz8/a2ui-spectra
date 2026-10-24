import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import type {Turn, TurnEvent, WireInputEvent, WireOutputEvent} from '../record/turn_record.js';
import {turnRecordErrors} from '../testing/turn_record_schema.js';
import {readTurnRequest} from './protocol.js';
import {TurnCapture, type TurnNotification} from './turn.js';

// Hand-written A2A traffic, shaped as upstream's samples and the A2A 1.0
// agents of the coverage survey send it.

const surface09 = {
  version: 'v0.9',
  createSurface: {
    surfaceId: 'default',
    catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
  },
};
const components09 = {
  version: 'v0.9',
  updateComponents: {
    surfaceId: 'default',
    components: [{id: 'root', component: 'Text', text: 'Hi'}],
  },
};
const surface10 = {
  version: 'v1.0',
  createSurface: {
    surfaceId: 's',
    catalogId: 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
  },
};

function request(method: string, message: Record<string, unknown>) {
  const parsed = readTurnRequest({jsonrpc: '2.0', id: 1, method, params: {message}});
  assert.ok(parsed);
  return parsed;
}

const userMessage03 = {
  kind: 'message',
  messageId: 'm-user',
  role: 'user',
  parts: [{kind: 'text', text: 'Top 2 Chinese restaurants'}],
};

function result(value: unknown) {
  return {jsonrpc: '2.0', id: 1, result: value};
}

interface Captured {
  notifications: TurnNotification[];
  turn: Turn;
  turnEvent: TurnEvent;
  input: WireInputEvent;
  outputs: WireOutputEvent[];
}

/**
 * Runs one turn through a capture with a fixed clock and fixed ids, and
 * checks the turn validates as a one-turn record.
 */
function capture(
  turnRequest: ReturnType<typeof request>,
  deliveries: unknown[],
  {failure, extensionsHeader}: {failure?: string; extensionsHeader?: string} = {},
): Captured {
  const notifications: TurnNotification[] = [];
  let tick = 1_792_576_800_000_000_000n;
  let span = 0;
  const turnCapture = TurnCapture.open(turnRequest, {
    agentName: 'Restaurant Agent',
    writer: {name: 'a2ui-spectra', version: '0.0.1'},
    listener: notification => notifications.push(notification),
    now: () => (tick += 1_000_000n),
    newTraceId: () => 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    newSpanId: () => (++span).toString(16).padStart(16, '0'),
  });
  turnCapture.replyExtensions(extensionsHeader);
  for (const delivery of deliveries) {
    turnCapture.delivery(delivery);
  }
  if (failure !== undefined) {
    turnCapture.fail(failure);
  }
  turnCapture.close();

  const closed = notifications.at(-1);
  assert.equal(closed?.type, 'turn_closed');
  const turn = closed.turn;
  assert.deepEqual(turnRecordErrors({version: 'v0.1', turns: [turn]}), []);
  const [turnEvent, input, ...outputs] = turn.events as [
    TurnEvent,
    WireInputEvent,
    ...WireOutputEvent[],
  ];
  return {notifications, turn, turnEvent, input, outputs};
}

function outputParts(captured: Captured) {
  return captured.outputs.map(output => output.attributes['a2ui.wire.message'].parts);
}

describe('TurnCapture', () => {
  it('writes the turn event and the wire events under it, and notifies as it goes', () => {
    const captured = capture(request('message/stream', {...userMessage03, contextId: 'ctx-1'}), [
      result({
        kind: 'status-update',
        contextId: 'ctx-1',
        status: {
          state: 'completed',
          message: {
            kind: 'message',
            messageId: 'r-1',
            role: 'agent',
            parts: [{kind: 'text', text: 'Here you go'}],
          },
        },
        final: true,
      }),
    ]);
    assert.deepEqual(captured.turnEvent, {
      traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      spanId: '0000000000000001',
      name: 'invoke_agent Restaurant Agent',
      kind: 3,
      startTimeUnixNano: '1792576800001000000',
      endTimeUnixNano: '1792576800004000000',
      attributes: {
        'a2ui.event.kind': 'turn',
        'gen_ai.operation.name': 'invoke_agent',
        'gen_ai.agent.name': 'Restaurant Agent',
        'gen_ai.conversation.id': 'ctx-1',
        'a2ui.turn.outcome': 'completed',
        'a2ui.turn.capture_paths': ['wire'],
        'a2ui.turn.writer.name': 'a2ui-spectra',
        'a2ui.turn.writer.version': '0.0.1',
      },
      status: {code: 1},
    });
    assert.deepEqual(captured.input, {
      traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      spanId: '0000000000000002',
      parentSpanId: '0000000000000001',
      name: 'wire_input',
      kind: 1,
      startTimeUnixNano: '1792576800002000000',
      attributes: {
        'a2ui.event.kind': 'wire_input',
        'a2ui.wire.message': {
          role: 'user',
          parts: [{type: 'text', content: 'Top 2 Chinese restaurants'}],
        },
      },
    });
    assert.deepEqual(captured.outputs, [
      {
        traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        spanId: '0000000000000003',
        parentSpanId: '0000000000000001',
        name: 'wire_output',
        kind: 1,
        startTimeUnixNano: '1792576800003000000',
        attributes: {
          'a2ui.event.kind': 'wire_output',
          'a2ui.wire.message': {
            role: 'assistant',
            parts: [{type: 'text', content: 'Here you go'}],
          },
        },
      },
    ]);
    assert.deepEqual(
      captured.notifications.map(n => n.type),
      ['turn_opened', 'wire_event', 'wire_event', 'turn_closed'],
    );
    assert.deepEqual(captured.notifications[0], {
      type: 'turn_opened',
      traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      conversationId: 'ctx-1',
      startTimeUnixNano: '1792576800001000000',
      messageId: 'm-user',
    });
    assert.equal(
      captured.notifications[1].type === 'wire_event' && captured.notifications[1].event,
      captured.input,
    );
  });

  it('names the turn invoke_agent alone when the agent has no name', () => {
    const notifications: TurnNotification[] = [];
    const turnCapture = TurnCapture.open(request('message/send', userMessage03), {
      writer: {name: 'a2ui-spectra', version: '0.0.1'},
      listener: n => notifications.push(n),
    });
    turnCapture.delivery(result({kind: 'message', messageId: 'r', role: 'agent', parts: []}));
    turnCapture.close();
    const closed = notifications.at(-1);
    assert.equal(closed?.type === 'turn_closed' && closed.turn.events[0].name, 'invoke_agent');
  });

  describe('wire outputs', () => {
    it('writes one per stream event, empty when the event carries no agent parts', () => {
      const captured = capture(request('message/stream', userMessage03), [
        result({
          kind: 'task',
          id: 't-1',
          contextId: 'ctx-new',
          status: {state: 'submitted'},
          history: [{...userMessage03, contextId: 'ctx-new', taskId: 't-1'}],
        }),
        result({
          kind: 'status-update',
          taskId: 't-1',
          contextId: 'ctx-new',
          status: {state: 'working'},
          final: false,
        }),
        result({
          kind: 'status-update',
          taskId: 't-1',
          contextId: 'ctx-new',
          status: {
            state: 'working',
            message: {
              kind: 'message',
              messageId: 'r-1',
              role: 'agent',
              parts: [
                {kind: 'data', data: surface09, metadata: {mimeType: 'application/json+a2ui'}},
              ],
              metadata: {adk_app_name: 'restaurant_agent'},
            },
          },
          final: false,
        }),
        result({
          kind: 'status-update',
          taskId: 't-1',
          contextId: 'ctx-new',
          status: {
            state: 'input-required',
            message: {kind: 'message', messageId: 'r-2', role: 'agent', parts: []},
          },
          final: false,
        }),
      ]);
      assert.deepEqual(outputParts(captured), [[], [], [{type: 'a2ui', content: surface09}], []]);
      assert.deepEqual(captured.outputs[2].attributes['a2ui.wire.metadata'], {
        adk_app_name: 'restaurant_agent',
      });
      assert.equal(captured.outputs[0].attributes['a2ui.wire.metadata'], undefined);
    });

    it("takes a send's Task apart: the agent's history after the request, the status message once, then the artifacts", () => {
      const agentA = {
        kind: 'message',
        messageId: 'r-a',
        role: 'agent',
        parts: [{kind: 'text', text: 'Finding restaurants'}],
      };
      const agentB = {
        kind: 'message',
        messageId: 'r-b',
        role: 'agent',
        parts: [{kind: 'data', data: components09, metadata: {mimeType: 'application/a2ui+json'}}],
      };
      const earlier = {
        kind: 'message',
        messageId: 'r-old',
        role: 'agent',
        parts: [{kind: 'text', text: 'Earlier turn'}],
      };
      const earlierUser = {
        kind: 'message',
        messageId: 'm-old',
        role: 'user',
        parts: [{kind: 'text', text: 'Before'}],
      };
      const captured = capture(request('message/send', userMessage03), [
        result({
          kind: 'task',
          id: 't-1',
          contextId: 'ctx-1',
          status: {state: 'completed', message: agentB},
          history: [earlierUser, earlier, userMessage03, agentA, agentB],
          artifacts: [{artifactId: 'a-1', parts: [{kind: 'text', text: 'Booked'}]}],
          metadata: {source: 'task'},
        }),
      ]);
      assert.deepEqual(outputParts(captured), [
        [
          {type: 'text', content: 'Finding restaurants'},
          {type: 'a2ui', content: components09},
          {type: 'text', content: 'Booked'},
        ],
      ]);
      assert.deepEqual(captured.outputs[0].attributes['a2ui.wire.metadata'], {source: 'task'});
      assert.equal(captured.turnEvent.attributes['a2ui.turn.outcome'], 'completed');
    });

    it("takes a Task's status message when the history leaves it out", () => {
      const captured = capture(request('message/send', userMessage03), [
        result({
          kind: 'task',
          id: 't-1',
          status: {
            state: 'completed',
            message: {
              kind: 'message',
              messageId: 'r-1',
              role: 'agent',
              parts: [{kind: 'text', text: 'Done'}],
            },
          },
          history: [userMessage03],
        }),
      ]);
      assert.deepEqual(outputParts(captured), [[{type: 'text', content: 'Done'}]]);
    });

    it("takes an artifact update's parts, with the artifact's metadata", () => {
      const captured = capture(request('message/stream', userMessage03), [
        result({
          kind: 'artifact-update',
          taskId: 't-1',
          contextId: 'ctx-1',
          artifact: {
            artifactId: 'a-1',
            parts: [{kind: 'data', data: surface09, metadata: {mimeType: 'application/json+a2ui'}}],
            metadata: {adk_type: 'final'},
          },
          lastChunk: true,
        }),
        result({
          kind: 'status-update',
          taskId: 't-1',
          contextId: 'ctx-1',
          status: {state: 'completed'},
          final: true,
        }),
      ]);
      assert.deepEqual(outputParts(captured), [[{type: 'a2ui', content: surface09}], []]);
      assert.deepEqual(captured.outputs[0].attributes['a2ui.wire.metadata'], {adk_type: 'final'});
    });

    it('writes an empty wire output for a JSON-RPC error and for an unreadable event', () => {
      const captured = capture(request('message/stream', userMessage03), [
        'not json-rpc',
        {jsonrpc: '2.0', id: 1, error: {code: -32603, message: 'Internal error'}},
      ]);
      assert.deepEqual(outputParts(captured), [[], []]);
    });
  });

  describe('the outcome', () => {
    function outcomeOf(deliveries: unknown[], options?: {failure?: string}) {
      const {turnEvent} = capture(request('message/stream', userMessage03), deliveries, options);
      return {outcome: turnEvent.attributes['a2ui.turn.outcome'], status: turnEvent.status};
    }

    function lastState(state: string, final = true) {
      return [result({kind: 'status-update', taskId: 't', contextId: 'c', status: {state}, final})];
    }

    it('is the last task state the turn saw, whatever the final flag says', () => {
      const cases: Array<[string, string, 1 | 2]> = [
        ['completed', 'completed', 1],
        ['input-required', 'waiting_for_input', 1],
        ['auth-required', 'waiting_for_input', 1],
        ['canceled', 'cancelled', 1],
        ['failed', 'failed', 2],
        ['rejected', 'failed', 2],
        ['submitted', 'failed', 2],
        ['working', 'failed', 2],
        ['unknown', 'failed', 2],
      ];
      for (const [state, outcome, code] of cases) {
        for (const final of [true, false]) {
          assert.deepEqual(
            outcomeOf(lastState(state, final)),
            {outcome, status: {code}},
            `${state}, final ${final}`,
          );
        }
      }
    });

    it('follows the latest state, not the first', () => {
      assert.equal(
        outcomeOf([...lastState('working', false), ...lastState('input-required', false)]).outcome,
        'waiting_for_input',
      );
    });

    it('is completed for a Message reply with no task', () => {
      assert.deepEqual(
        outcomeOf([
          result({
            kind: 'message',
            messageId: 'r',
            role: 'agent',
            parts: [{kind: 'text', text: 'Hi'}],
          }),
        ]),
        {outcome: 'completed', status: {code: 1}},
      );
    });

    it('is failed when no state arrived', () => {
      assert.deepEqual(outcomeOf([]), {outcome: 'failed', status: {code: 2}});
    });

    it("is failed with the error's message for a JSON-RPC error", () => {
      assert.deepEqual(
        outcomeOf([
          ...lastState('working', false),
          {jsonrpc: '2.0', id: 1, error: {code: -32001, message: 'Task not found'}},
        ]),
        {outcome: 'failed', status: {code: 2, message: 'Task not found'}},
      );
    });

    it('is failed with the message given for a failed response or a broken connection', () => {
      assert.deepEqual(outcomeOf(lastState('completed'), {failure: 'socket hang up'}), {
        outcome: 'failed',
        status: {code: 2, message: 'socket hang up'},
      });
    });
  });

  describe('the conversation', () => {
    it("takes the conversation from the agent's reply when the request has none", () => {
      const captured = capture(request('message/stream', userMessage03), [
        result({
          kind: 'task',
          id: 't-1',
          contextId: 'ctx-new',
          status: {state: 'submitted'},
          history: [userMessage03],
        }),
        result({
          kind: 'status-update',
          taskId: 't-1',
          contextId: 'ctx-new',
          status: {state: 'completed'},
          final: true,
        }),
      ]);
      assert.equal(captured.turnEvent.attributes['gen_ai.conversation.id'], 'ctx-new');
      assert.deepEqual(captured.notifications[0], {
        type: 'turn_opened',
        traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        startTimeUnixNano: '1792576800001000000',
        messageId: 'm-user',
      });
    });
  });

  describe('the wire input', () => {
    it('merges both capabilities keys by version, and keeps the rest of the metadata', () => {
      const captured = capture(
        request('message/stream', {
          ...userMessage03,
          metadata: {
            a2uiClientCapabilities: {'v0.9': {supportedCatalogIds: ['basic-0.9']}},
            a2uiRendererCapabilities: {'v1.0': {supportedCatalogIds: ['basic-1.0']}},
            locale: 'en-US',
          },
        }),
        [],
      );
      assert.deepEqual(captured.input.attributes, {
        'a2ui.event.kind': 'wire_input',
        'a2ui.wire.message': {
          role: 'user',
          parts: [{type: 'text', content: 'Top 2 Chinese restaurants'}],
        },
        'a2ui.wire.capabilities': {
          'v0.9': {supportedCatalogIds: ['basic-0.9']},
          'v1.0': {supportedCatalogIds: ['basic-1.0']},
        },
        'a2ui.wire.metadata': {locale: 'en-US'},
      });
    });

    it('takes the data model, and the one matching the A2UI version when both are sent', () => {
      const action10 = {
        version: 'v1.0',
        action: {name: 'book', surfaceId: 's', sourceComponentId: 'b', timestamp: 't', context: {}},
      };
      const model09 = {version: 'v0.9', surfaces: {s: {a: 1}}};
      const model10 = {version: 'v1.0', surfaces: {s: {a: 2}}};
      const one = capture(
        request('message/stream', {...userMessage03, metadata: {a2uiClientDataModel: model09}}),
        [],
      );
      assert.deepEqual(one.input.attributes['a2ui.wire.data_model'], model09);
      assert.equal(one.input.attributes['a2ui.wire.metadata'], undefined);

      const both = capture(
        request('message/stream', {
          ...userMessage03,
          parts: [{kind: 'data', data: action10, metadata: {mimeType: 'application/a2ui+json'}}],
          metadata: {a2uiClientDataModel: model09, a2uiRendererDataModel: model10},
        }),
        [],
      );
      assert.deepEqual(both.input.attributes['a2ui.wire.data_model'], model10);
      assert.deepEqual(both.input.attributes['a2ui.wire.metadata'], {a2uiClientDataModel: model09});
    });
  });

  describe('the protocol version', () => {
    function versionOf(
      metadata: Record<string, unknown> | undefined,
      deliveries: unknown[],
      extensionsHeader?: string,
    ) {
      const {turnEvent} = capture(
        request('message/stream', {...userMessage03, ...(metadata && {metadata})}),
        deliveries,
        {extensionsHeader},
      );
      return turnEvent.attributes['a2ui.turn.protocol_version'];
    }

    const withA2ui = [
      result({
        kind: 'status-update',
        taskId: 't',
        contextId: 'c',
        status: {
          state: 'completed',
          message: {
            kind: 'message',
            messageId: 'r',
            role: 'agent',
            parts: [
              {kind: 'data', data: [surface10], metadata: {mimeType: 'application/a2ui+json'}},
            ],
          },
        },
        final: true,
      }),
    ];
    const noA2ui = [
      result({
        kind: 'status-update',
        taskId: 't',
        contextId: 'c',
        status: {state: 'completed'},
        final: true,
      }),
    ];
    const offerBoth = {
      a2uiClientCapabilities: {'v0.9': {supportedCatalogIds: []}},
      a2uiRendererCapabilities: {'v1.0': {supportedCatalogIds: []}},
    };

    it("is the version of the turn's A2UI messages, over the header and the offer", () => {
      assert.equal(
        versionOf(offerBoth, withA2ui, 'https://a2ui.org/a2a-extension/a2ui/v0.9'),
        'v1.0',
      );
    });

    it("falls back to the one A2UI version the reply's extensions header names", () => {
      assert.equal(
        versionOf(
          offerBoth,
          noA2ui,
          'https://example.com/ext/other, https://a2ui.org/a2a-extension/a2ui/v0.9.1',
        ),
        'v0.9.1',
      );
    });

    it('falls back to the offer when it names one version, else records none', () => {
      assert.equal(
        versionOf({a2uiClientCapabilities: {'v0.9': {supportedCatalogIds: []}}}, noA2ui),
        'v0.9',
      );
      assert.equal(versionOf(offerBoth, noA2ui), undefined);
      assert.equal(versionOf(undefined, noA2ui), undefined);
    });
  });

  describe('A2A 1.0', () => {
    it('reads a stream of Message replies, as strathweb-a2ui sends them', () => {
      const captured = capture(
        request('SendStreamingMessage', {
          messageId: 'm-1',
          role: 'ROLE_USER',
          parts: [{text: 'A flat white'}],
        }),
        [
          result({
            message: {
              messageId: 'r-1',
              contextId: 'ctx-10',
              role: 'ROLE_AGENT',
              parts: [{data: [surface10], metadata: {mimeType: 'application/a2ui+json'}}],
            },
          }),
        ],
        {extensionsHeader: 'https://a2ui.org/a2a-extension/a2ui/v0.9.1'},
      );
      assert.deepEqual(outputParts(captured), [[{type: 'a2ui', content: [surface10]}]]);
      assert.equal(captured.turnEvent.attributes['a2ui.turn.outcome'], 'completed');
      assert.equal(captured.turnEvent.attributes['gen_ai.conversation.id'], 'ctx-10');
      assert.equal(captured.turnEvent.attributes['a2ui.turn.protocol_version'], 'v1.0');
    });

    it('reads 1.0 task states and wrappers', () => {
      const captured = capture(
        request('SendStreamingMessage', {
          messageId: 'm-1',
          role: 'ROLE_USER',
          parts: [{text: 'Hi'}],
        }),
        [
          result({task: {id: 't', contextId: 'c', status: {state: 'TASK_STATE_SUBMITTED'}}}),
          result({
            statusUpdate: {
              taskId: 't',
              contextId: 'c',
              status: {state: 'TASK_STATE_INPUT_REQUIRED'},
            },
          }),
        ],
      );
      assert.equal(captured.turnEvent.attributes['a2ui.turn.outcome'], 'waiting_for_input');
      assert.equal(captured.outputs.length, 2);
    });
  });
});
