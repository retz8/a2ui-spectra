import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  A2UI_CAPABILITIES,
  A2UI_EXTENSION_URIS,
  boxRequest,
  chooseInterface,
  readReplySummary,
} from './client.js';

const PROXY = 'http://127.0.0.1:10999';

describe('chooseInterface', () => {
  it('takes the first JSON-RPC entry of supportedInterfaces at A2A 0.3 or 1.0', () => {
    assert.deepEqual(
      chooseInterface({
        url: `${PROXY}/legacy`,
        protocolVersion: '0.3',
        capabilities: {streaming: true},
        supportedInterfaces: [
          {url: `${PROXY}/grpc`, protocolBinding: 'GRPC', protocolVersion: '1.0'},
          {url: `${PROXY}/v2`, protocolBinding: 'JSONRPC', protocolVersion: '2.0'},
          {url: `${PROXY}/a2a`, protocolBinding: 'JSONRPC', protocolVersion: '1.0', tenant: ''},
          {url: `${PROXY}/a2a`, protocolBinding: 'JSONRPC', protocolVersion: '0.3'},
        ],
      }),
      {kind: 'found', version: '1.0', url: `${PROXY}/a2a`, streaming: true},
    );
  });

  it('follows the card when it lists A2A 0.3 first', () => {
    const choice = chooseInterface({
      supportedInterfaces: [
        {url: `${PROXY}/a2a`, protocolBinding: 'JSONRPC', protocolVersion: '0.3'},
        {url: `${PROXY}/a2a`, protocolBinding: 'JSONRPC', protocolVersion: '1.0'},
      ],
    });
    assert.equal(choice.kind === 'found' && choice.version, '0.3');
  });

  it('compares versions on major.minor, and keeps a tenant', () => {
    assert.deepEqual(
      chooseInterface({
        supportedInterfaces: [
          {url: `${PROXY}/t`, protocolBinding: 'JSONRPC', protocolVersion: '1.0.1', tenant: 'acme'},
        ],
      }),
      {kind: 'found', version: '1.0', url: `${PROXY}/t`, tenant: 'acme', streaming: false},
    );
  });

  it('speaks A2A 0.3 to a card without supportedInterfaces, at its JSON-RPC interface', () => {
    assert.deepEqual(chooseInterface({url: `${PROXY}/`, capabilities: {streaming: true}}), {
      kind: 'found',
      version: '0.3',
      url: `${PROXY}/`,
      streaming: true,
    });
    assert.deepEqual(
      chooseInterface({
        url: `${PROXY}/grpc`,
        preferredTransport: 'GRPC',
        additionalInterfaces: [
          {url: `${PROXY}/rest`, transport: 'HTTP+JSON'},
          {url: `${PROXY}/rpc`, transport: 'JSONRPC'},
        ],
      }),
      {kind: 'found', version: '0.3', url: `${PROXY}/rpc`, streaming: false},
    );
  });

  it('names the versions when no JSON-RPC interface is at a version the box speaks', () => {
    assert.deepEqual(
      chooseInterface({
        supportedInterfaces: [
          {url: `${PROXY}/a`, protocolBinding: 'JSONRPC', protocolVersion: '1.1'},
          {url: `${PROXY}/b`, protocolBinding: 'JSONRPC', protocolVersion: '2.0'},
          {url: `${PROXY}/c`, protocolBinding: 'GRPC', protocolVersion: '1.0'},
        ],
      }),
      {kind: 'none', versions: ['1.1', '2.0']},
    );
  });
});

describe('boxRequest', () => {
  const message = {text: 'Hi', messageId: 'm-1'};

  it('sends A2A 0.3 with message/stream and X-A2A-Extensions', () => {
    const request = boxRequest({version: '0.3', url: PROXY, streaming: true}, message, 7);
    assert.deepEqual(request.headers, {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      'x-a2a-extensions': A2UI_EXTENSION_URIS.join(', '),
    });
    assert.deepEqual(JSON.parse(request.body), {
      jsonrpc: '2.0',
      id: 7,
      method: 'message/stream',
      params: {
        message: {
          kind: 'message',
          messageId: 'm-1',
          role: 'user',
          parts: [{kind: 'text', text: 'Hi'}],
          metadata: A2UI_CAPABILITIES,
        },
      },
    });
  });

  it('sends A2A 1.0 with SendStreamingMessage, A2A-Extensions, A2A-Version and the tenant', () => {
    const request = boxRequest(
      {version: '1.0', url: PROXY, tenant: 'acme', streaming: true},
      {...message, contextId: 'ctx-1', taskId: 't-1'},
      1,
    );
    assert.deepEqual(request.headers, {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      'a2a-version': '1.0',
      'a2a-extensions': A2UI_EXTENSION_URIS.join(', '),
    });
    assert.deepEqual(JSON.parse(request.body), {
      jsonrpc: '2.0',
      id: 1,
      method: 'SendStreamingMessage',
      params: {
        tenant: 'acme',
        message: {
          messageId: 'm-1',
          role: 'ROLE_USER',
          parts: [{text: 'Hi'}],
          contextId: 'ctx-1',
          taskId: 't-1',
          metadata: A2UI_CAPABILITIES,
        },
      },
    });
  });

  it("uses the version's send method when the card does not declare streaming", () => {
    for (const [version, method] of [
      ['0.3', 'message/send'],
      ['1.0', 'SendMessage'],
    ] as const) {
      const request = boxRequest({version, url: PROXY, streaming: false}, message, 1);
      assert.equal((JSON.parse(request.body) as {method: string}).method, method);
      assert.equal(request.headers.accept, 'application/json');
    }
  });

  it('offers v0.9, v0.9.1 and v1.0, each naming its basic catalog', () => {
    assert.deepEqual(A2UI_EXTENSION_URIS, [
      'https://a2ui.org/a2a-extension/a2ui/v0.9',
      'https://a2ui.org/a2a-extension/a2ui/v0.9.1',
      'https://a2ui.org/a2a-extension/a2ui/v1.0',
    ]);
    const v09 = {
      supportedCatalogIds: ['https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json'],
    };
    assert.deepEqual(A2UI_CAPABILITIES, {
      a2uiClientCapabilities: {'v0.9': v09, 'v0.9.1': v09},
      a2uiRendererCapabilities: {
        'v1.0': {
          supportedCatalogIds: ['https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json'],
        },
      },
    });
  });
});

describe('readReplySummary', () => {
  it('reads a stream for its conversation, its task and its last state', async () => {
    const events = [
      {task: {id: 't-1', contextId: 'ctx-1', status: {state: 'TASK_STATE_SUBMITTED'}}},
      {statusUpdate: {taskId: 't-1', contextId: 'ctx-1', status: {state: 'TASK_STATE_WORKING'}}},
      {
        statusUpdate: {
          taskId: 't-1',
          contextId: 'ctx-1',
          status: {state: 'TASK_STATE_INPUT_REQUIRED'},
        },
      },
    ];
    const body = events
      .map(result => `data: ${JSON.stringify({jsonrpc: '2.0', id: 1, result})}\r\n\r\n`)
      .join(': keep-alive\n\n');
    const response = new Response(body, {headers: {'content-type': 'text/event-stream'}});
    assert.deepEqual(await readReplySummary(response, '1.0'), {
      contextId: 'ctx-1',
      taskId: 't-1',
      state: 'input-required',
    });
  });

  it('reads a send, and a message with no task', async () => {
    const response = new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: {kind: 'message', messageId: 'r-1', role: 'agent', contextId: 'ctx-2', parts: []},
      }),
      {headers: {'content-type': 'application/json'}},
    );
    assert.deepEqual(await readReplySummary(response, '0.3'), {contextId: 'ctx-2'});
  });

  it('reads nothing from a JSON-RPC error', async () => {
    const response = new Response(
      JSON.stringify({jsonrpc: '2.0', id: 1, error: {code: -32600, message: 'No'}}),
      {headers: {'content-type': 'application/json'}},
    );
    assert.deepEqual(await readReplySummary(response, '0.3'), {});
  });
});
