/**
 * The stub agent: a small A2A agent on the A2A JavaScript SDK, serving A2A
 * 1.0 and, through the SDK's compatibility layer, A2A 0.3 on one JSON-RPC
 * endpoint. A message opens a task that sends a working status and stays
 * open until the host cancels it, then delivers a canceled status on the
 * open stream and closes it.
 *
 * Run from conformance/ after `yarn build`: `node dist/stub_agent/stub_agent.js
 * --port 10013`.
 */

import express from 'express';
import {A2A_PROTOCOL_VERSION, AGENT_CARD_PATH, type AgentCard, Role, TaskState} from '@a2a-js/sdk';
import {duplicateInterfacesForLegacy} from '@a2a-js/sdk/compat/v0_3';
import {
  AgentEvent,
  type AgentExecutor,
  DefaultRequestHandler,
  type ExecutionEventBus,
  InMemoryTaskStore,
  type RequestContext,
} from '@a2a-js/sdk/server';
import {agentCardHandler, jsonRpcHandler, UserBuilder} from '@a2a-js/sdk/server/express';

/** How long a task stays open without a cancel before it completes. */
const OPEN_FOR_MS = 60_000;

const JSON_RPC_PATH = '/a2a/jsonrpc';

function portFromArgs(args: string[]): number {
  const index = args.indexOf('--port');
  const port = Number(index === -1 ? (process.env.PORT ?? 10013) : args[index + 1]);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('--port takes a port number.');
  }
  return port;
}

function agentCard(port: number): AgentCard {
  return {
    name: 'Spectra stub agent',
    description:
      'Opens a task for each message and keeps its stream open until the host cancels it.',
    supportedInterfaces: duplicateInterfacesForLegacy(
      [
        {
          url: `http://127.0.0.1:${port}${JSON_RPC_PATH}`,
          protocolBinding: 'JSONRPC',
          tenant: '',
          protocolVersion: A2A_PROTOCOL_VERSION,
        },
      ],
      ['JSONRPC'],
    ),
    provider: undefined,
    version: '0.0.1',
    capabilities: {
      streaming: true,
      pushNotifications: false,
      extensions: [],
      extendedAgentCard: false,
    },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: [
      {
        id: 'wait_for_cancel',
        name: 'Wait for a cancel',
        description: 'Keeps the task working until the host cancels it.',
        tags: ['cancellation'],
        examples: ['start'],
        inputModes: ['text'],
        outputModes: ['text'],
        securityRequirements: [],
      },
    ],
    documentationUrl: '',
    signatures: [],
  };
}

function agentText(taskId: string, contextId: string, text: string) {
  return {
    role: Role.ROLE_AGENT,
    messageId: crypto.randomUUID(),
    parts: [
      {
        content: {$case: 'text' as const, value: text},
        metadata: undefined,
        filename: '',
        mediaType: 'text/plain',
      },
    ],
    taskId,
    contextId,
    extensions: [],
    metadata: {},
    referenceTaskIds: [],
  };
}

class WaitForCancelExecutor implements AgentExecutor {
  readonly #cancels = new Map<string, () => void>();

  cancelTask = async (taskId: string, _eventBus: ExecutionEventBus): Promise<void> => {
    this.#cancels.get(taskId)?.();
  };

  async execute(context: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const {taskId, contextId, userMessage} = context;
    eventBus.publish(
      AgentEvent.task(
        context.task ?? {
          id: taskId,
          contextId,
          status: {
            state: TaskState.TASK_STATE_SUBMITTED,
            timestamp: new Date().toISOString(),
            message: undefined,
          },
          artifacts: [],
          history: [userMessage],
          metadata: {},
        },
      ),
    );
    eventBus.publish(
      AgentEvent.statusUpdate({
        taskId,
        contextId,
        status: {
          state: TaskState.TASK_STATE_WORKING,
          timestamp: new Date().toISOString(),
          message: agentText(taskId, contextId, 'Working until you cancel.'),
        },
        metadata: {},
      }),
    );

    const cancelled = await new Promise<boolean>(resolve => {
      const timer = setTimeout(() => resolve(false), OPEN_FOR_MS);
      this.#cancels.set(taskId, () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    this.#cancels.delete(taskId);

    eventBus.publish(
      AgentEvent.statusUpdate({
        taskId,
        contextId,
        status: {
          state: cancelled ? TaskState.TASK_STATE_CANCELED : TaskState.TASK_STATE_COMPLETED,
          timestamp: new Date().toISOString(),
          message: agentText(
            taskId,
            contextId,
            cancelled ? 'Cancelled.' : 'Nobody cancelled, so the task completed.',
          ),
        },
        metadata: {},
      }),
    );
  }
}

const port = portFromArgs(process.argv.slice(2));
const requestHandler = new DefaultRequestHandler(
  agentCard(port),
  new InMemoryTaskStore(),
  new WaitForCancelExecutor(),
);
const app = express();
app.use(
  `/${AGENT_CARD_PATH}`,
  agentCardHandler({agentCardProvider: requestHandler, legacyCompat: {enabled: true}}),
);
app.use(
  JSON_RPC_PATH,
  jsonRpcHandler({
    requestHandler,
    userBuilder: UserBuilder.noAuthentication,
    legacyCompat: {enabled: true},
  }),
);
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Spectra stub agent at http://127.0.0.1:${port}`);
});
server.on('error', error => {
  console.error(error);
  process.exit(1);
});
