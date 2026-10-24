import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {readReply, readTurnRequest} from './protocol.js';

const v03Message = {
  kind: 'message',
  messageId: 'm-1',
  role: 'user',
  parts: [{kind: 'text', text: 'Hi'}],
  contextId: 'ctx-1',
  metadata: {locale: 'en-US'},
};

const v10Message = {
  messageId: 'm-1',
  role: 'ROLE_USER',
  parts: [{text: 'Hi'}],
  contextId: 'ctx-1',
};

describe('readTurnRequest', () => {
  it('reads the A2A 0.3 send and stream methods', () => {
    for (const [method, kind] of [
      ['message/send', 'send'],
      ['message/stream', 'stream'],
    ] as const) {
      assert.deepEqual(
        readTurnRequest({jsonrpc: '2.0', id: 7, method, params: {message: v03Message}}),
        {
          version: '0.3',
          method: kind,
          message: {
            messageId: 'm-1',
            role: 'user',
            parts: [{kind: 'text', text: 'Hi'}],
            contextId: 'ctx-1',
            metadata: {locale: 'en-US'},
          },
        },
      );
    }
  });

  it('reads the A2A 1.0 send and stream methods, with 1.0 role names', () => {
    for (const [method, kind] of [
      ['SendMessage', 'send'],
      ['SendStreamingMessage', 'stream'],
    ] as const) {
      assert.deepEqual(
        readTurnRequest({jsonrpc: '2.0', id: 'a', method, params: {message: v10Message}}),
        {
          version: '1.0',
          method: kind,
          message: {messageId: 'm-1', role: 'user', parts: [{text: 'Hi'}], contextId: 'ctx-1'},
        },
      );
    }
  });

  it('reads a send without a message as a turn with an empty message', () => {
    assert.deepEqual(readTurnRequest({jsonrpc: '2.0', id: 1, method: 'message/send'}), {
      version: '0.3',
      method: 'send',
      message: {parts: []},
    });
  });

  it('reads nothing from any other body', () => {
    for (const body of [
      {jsonrpc: '2.0', id: 1, method: 'tasks/get', params: {id: 't'}},
      {jsonrpc: '2.0', id: 1, method: 'GetTask', params: {id: 't'}},
      {jsonrpc: '2.0', id: 1, method: 'agent/getAuthenticatedExtendedCard'},
      [{jsonrpc: '2.0', id: 1, method: 'message/send', params: {message: v03Message}}],
      {id: 1, method: 'message/send', params: {message: v03Message}},
      {jsonrpc: '2.0', id: 1, result: {}},
      'message/send',
      null,
    ]) {
      assert.equal(readTurnRequest(body), undefined, JSON.stringify(body));
    }
  });
});

describe('readReply, A2A 0.3', () => {
  it('reads a Message', () => {
    assert.deepEqual(
      readReply(
        {kind: 'message', messageId: 'r-1', role: 'agent', parts: [{kind: 'text', text: 'Hey'}]},
        '0.3',
      ),
      {
        kind: 'message',
        message: {messageId: 'r-1', role: 'agent', parts: [{kind: 'text', text: 'Hey'}]},
      },
    );
  });

  it('reads a Task, with its status, history and artifacts', () => {
    assert.deepEqual(
      readReply(
        {
          kind: 'task',
          id: 't-1',
          contextId: 'ctx-9',
          status: {
            state: 'input-required',
            message: {kind: 'message', messageId: 'r-2', role: 'agent', parts: []},
          },
          history: [v03Message],
          artifacts: [{artifactId: 'a-1', parts: [{kind: 'text', text: 'Done'}], metadata: {n: 1}}],
          metadata: {trace: 'x'},
        },
        '0.3',
      ),
      {
        kind: 'task',
        contextId: 'ctx-9',
        state: 'input-required',
        statusMessage: {messageId: 'r-2', role: 'agent', parts: []},
        history: [
          {
            messageId: 'm-1',
            role: 'user',
            parts: [{kind: 'text', text: 'Hi'}],
            contextId: 'ctx-1',
            metadata: {locale: 'en-US'},
          },
        ],
        artifacts: [{parts: [{kind: 'text', text: 'Done'}], metadata: {n: 1}}],
        metadata: {trace: 'x'},
      },
    );
  });

  it('reads a status update and an artifact update', () => {
    assert.deepEqual(
      readReply(
        {
          kind: 'status-update',
          taskId: 't-1',
          contextId: 'ctx-9',
          status: {state: 'working'},
          final: false,
        },
        '0.3',
      ),
      {kind: 'status-update', contextId: 'ctx-9', state: 'working'},
    );
    assert.deepEqual(
      readReply(
        {
          kind: 'artifact-update',
          taskId: 't-1',
          contextId: 'ctx-9',
          artifact: {artifactId: 'a-1', parts: [{kind: 'text', text: 'x'}]},
          lastChunk: true,
        },
        '0.3',
      ),
      {kind: 'artifact-update', contextId: 'ctx-9', artifact: {parts: [{kind: 'text', text: 'x'}]}},
    );
  });

  it('reads nothing from an object of no known kind', () => {
    assert.equal(readReply({kind: 'other'}, '0.3'), undefined);
    assert.equal(readReply([], '0.3'), undefined);
  });
});

describe('readReply, A2A 1.0', () => {
  it('reads each wrapper of the stream response, with 1.0 state and role names', () => {
    assert.deepEqual(
      readReply({message: {messageId: 'r-1', role: 'ROLE_AGENT', parts: [{text: 'Hey'}]}}, '1.0'),
      {kind: 'message', message: {messageId: 'r-1', role: 'agent', parts: [{text: 'Hey'}]}},
    );
    assert.deepEqual(
      readReply(
        {task: {id: 't-1', contextId: 'ctx-2', status: {state: 'TASK_STATE_SUBMITTED'}}},
        '1.0',
      ),
      {kind: 'task', contextId: 'ctx-2', state: 'submitted', history: [], artifacts: []},
    );
    assert.deepEqual(
      readReply(
        {
          statusUpdate: {
            taskId: 't-1',
            contextId: 'ctx-2',
            status: {
              state: 'TASK_STATE_AUTH_REQUIRED',
              message: {messageId: 'r-3', role: 'ROLE_AGENT', parts: [{text: 'Sign in'}]},
            },
          },
        },
        '1.0',
      ),
      {
        kind: 'status-update',
        contextId: 'ctx-2',
        state: 'auth-required',
        message: {messageId: 'r-3', role: 'agent', parts: [{text: 'Sign in'}]},
      },
    );
    assert.deepEqual(
      readReply(
        {
          artifactUpdate: {
            taskId: 't-1',
            contextId: 'ctx-2',
            artifact: {artifactId: 'a', parts: [{text: 'x'}]},
          },
        },
        '1.0',
      ),
      {kind: 'artifact-update', contextId: 'ctx-2', artifact: {parts: [{text: 'x'}]}},
    );
  });

  it('reads every 1.0 task state', () => {
    const states = {
      TASK_STATE_UNSPECIFIED: 'unknown',
      TASK_STATE_SUBMITTED: 'submitted',
      TASK_STATE_WORKING: 'working',
      TASK_STATE_COMPLETED: 'completed',
      TASK_STATE_FAILED: 'failed',
      TASK_STATE_CANCELED: 'canceled',
      TASK_STATE_INPUT_REQUIRED: 'input-required',
      TASK_STATE_REJECTED: 'rejected',
      TASK_STATE_AUTH_REQUIRED: 'auth-required',
    };
    for (const [name, state] of Object.entries(states)) {
      const reply = readReply({statusUpdate: {status: {state: name}}}, '1.0');
      assert.equal(reply?.kind === 'status-update' && reply.state, state, name);
    }
  });

  it('reads nothing from an object with no known wrapper', () => {
    assert.equal(readReply({kind: 'task', id: 't'}, '1.0'), undefined);
  });
});
