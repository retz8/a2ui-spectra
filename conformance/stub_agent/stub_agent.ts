/**
 * The stub agent: a small A2A agent on the A2A JavaScript SDK, serving A2A
 * 1.0 and, through the SDK's compatibility layer, A2A 0.3 on one JSON-RPC
 * endpoint. It runs one of three behaviours:
 *
 * - By default, it waits for a cancel: a message opens a task that sends a
 *   working status and stays open until the host cancels it, then delivers a
 *   canceled status on the open stream and closes it.
 * - With `--canned-a2ui`, it holds a canned A2UI conversation: a message that
 *   opens a task gets a small surface asking for a name and ends waiting for
 *   input, and a message carrying that task's id answers with the name and
 *   completes. The A2UI version is the newest the host's capabilities name,
 *   read as the A2UI extension specs describe, and that version's extension
 *   is echoed in the reply's extensions header.
 * - With `--flawed-booking`, it is the Flawed Booking Agent: a message gets a
 *   completed task whose status message holds a booking form in A2UI v0.9,
 *   each message its own part, with mistakes the checks and web core's
 *   message processor find: a Button with a property its catalog does not
 *   define, an `updateComponents` to a surface never created, and an
 *   `updateDataModel` that names no surface.
 *
 * Options:
 *   --port <n>          The port to listen on, on 127.0.0.1. Default: $PORT, or 10013.
 *   --canned-a2ui       Hold the canned A2UI conversation instead of waiting for a cancel.
 *   --flawed-booking    Be the Flawed Booking Agent instead of waiting for a cancel.
 *   --a2a-0.3-first     List the A2A 0.3 interface before the A2A 1.0 one in the card.
 *
 * Run from conformance/ after `yarn build`: `node dist/stub_agent/stub_agent.js
 * --port 10013`.
 */

import {parseArgs} from 'node:util';

import express, {type NextFunction, type Request, type Response} from 'express';
import {
  A2A_PROTOCOL_VERSION,
  AGENT_CARD_PATH,
  type AgentCard,
  type Message,
  type Part,
  Role,
  type Task,
  TaskState,
} from '@a2a-js/sdk';
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

const A2UI_MIME_TYPE = 'application/a2ui+json';

/**
 * The A2UI versions the stub answers in, newest first, with the metadata key
 * each version's extension spec sends capabilities under, its extension URI
 * and its basic catalog.
 */
const A2UI_VERSIONS = [
  {
    version: 'v1.0',
    capabilitiesKey: 'a2uiRendererCapabilities',
    extension: 'https://a2ui.org/a2a-extension/a2ui/v1.0',
    catalogId: 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
  },
  {
    version: 'v0.9.1',
    capabilitiesKey: 'a2uiClientCapabilities',
    extension: 'https://a2ui.org/a2a-extension/a2ui/v0.9.1',
    catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
  },
  {
    version: 'v0.9',
    capabilitiesKey: 'a2uiClientCapabilities',
    extension: 'https://a2ui.org/a2a-extension/a2ui/v0.9',
    catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
  },
] as const;

type A2uiVersion = (typeof A2UI_VERSIONS)[number];

/** The version the Flawed Booking Agent answers in, whatever the host offers. */
const FLAWED_VERSION = A2UI_VERSIONS[2];

/** The send and stream methods of A2A 0.3 and 1.0. */
const TURN_METHODS = new Set([
  'message/send',
  'message/stream',
  'SendMessage',
  'SendStreamingMessage',
]);

const SURFACE_ID = 'greeting';

type Behaviour = 'wait-for-cancel' | 'canned-a2ui' | 'flawed-booking';

interface Options {
  port: number;
  behaviour: Behaviour;
  a2a03First: boolean;
  /** The bearer token each JSON-RPC request must carry; none when not given. */
  bearerToken?: string;
}

function optionsFromArgs(args: string[]): Options {
  const {values} = parseArgs({
    args,
    options: {
      port: {type: 'string'},
      'canned-a2ui': {type: 'boolean', default: false},
      'flawed-booking': {type: 'boolean', default: false},
      'a2a-0.3-first': {type: 'boolean', default: false},
      'bearer-token': {type: 'string'},
    },
  });
  const port = Number(values.port ?? process.env.PORT ?? 10013);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('--port takes a port number.');
  }
  if (values['canned-a2ui'] && values['flawed-booking']) {
    throw new Error('--canned-a2ui and --flawed-booking are two behaviours; pick one.');
  }
  const behaviour: Behaviour = values['canned-a2ui']
    ? 'canned-a2ui'
    : values['flawed-booking']
      ? 'flawed-booking'
      : 'wait-for-cancel';
  return {
    port,
    behaviour,
    a2a03First: values['a2a-0.3-first'],
    ...(values['bearer-token'] !== undefined && {bearerToken: values['bearer-token']}),
  };
}

/** Answers 401 to a JSON-RPC request that does not carry the bearer token. */
function requireBearerToken(
  token: string,
): (request: Request, response: Response, next: NextFunction) => void {
  return (request, response, next) => {
    if (request.header('authorization') !== `Bearer ${token}`) {
      response.status(401).json({error: 'A bearer token is required.'});
      return;
    }
    next();
  };
}

const SKILLS: Record<Behaviour, AgentCard['skills'][number]> = {
  'wait-for-cancel': {
    id: 'wait_for_cancel',
    name: 'Wait for a cancel',
    description: 'Keeps the task working until the host cancels it.',
    tags: ['cancellation'],
    examples: ['start'],
    inputModes: ['text'],
    outputModes: ['text'],
    securityRequirements: [],
  },
  'canned-a2ui': {
    id: 'canned_a2ui',
    name: 'Canned A2UI',
    description: 'Asks for a name on an A2UI surface, then greets the name it is sent.',
    tags: ['a2ui'],
    examples: ['Hello', 'Ada'],
    inputModes: ['text'],
    outputModes: ['text', A2UI_MIME_TYPE],
    securityRequirements: [],
  },
  'flawed-booking': {
    id: 'flawed_booking',
    name: 'Flawed booking',
    description: 'Answers with a booking form whose A2UI has mistakes in it.',
    tags: ['a2ui'],
    examples: ['Book a table for two at Han Il Kwan tonight'],
    inputModes: ['text'],
    outputModes: ['text', A2UI_MIME_TYPE],
    securityRequirements: [],
  },
};

const DESCRIPTIONS: Record<Behaviour, string> = {
  'wait-for-cancel':
    'Opens a task for each message and keeps its stream open until the host cancels it.',
  'canned-a2ui': 'Asks for a name in A2UI, then greets it.',
  'flawed-booking': 'Answers a booking request with a booking form whose A2UI has mistakes.',
};

function agentCard({port, behaviour, a2a03First}: Options): AgentCard {
  const interfaces = duplicateInterfacesForLegacy(
    [
      {
        url: `http://127.0.0.1:${port}${JSON_RPC_PATH}`,
        protocolBinding: 'JSONRPC',
        tenant: '',
        protocolVersion: A2A_PROTOCOL_VERSION,
      },
    ],
    ['JSONRPC'],
  );
  return {
    name: behaviour === 'flawed-booking' ? 'Flawed Booking Agent' : 'Spectra stub agent',
    description: DESCRIPTIONS[behaviour],
    supportedInterfaces: a2a03First ? interfaces.reverse() : interfaces,
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
    skills: [SKILLS[behaviour]],
    documentationUrl: '',
    signatures: [],
  };
}

function textPart(text: string): Part {
  return {
    content: {$case: 'text' as const, value: text},
    metadata: undefined,
    filename: '',
    mediaType: 'text/plain',
  };
}

function agentMessage(taskId: string, contextId: string, parts: Part[]): Message {
  return {
    role: Role.ROLE_AGENT,
    messageId: crypto.randomUUID(),
    parts,
    taskId,
    contextId,
    extensions: [],
    metadata: {},
    referenceTaskIds: [],
  };
}

function newTask(context: RequestContext): Task {
  return {
    id: context.taskId,
    contextId: context.contextId,
    status: {
      state: TaskState.TASK_STATE_SUBMITTED,
      timestamp: new Date().toISOString(),
      message: undefined,
    },
    artifacts: [],
    history: [context.userMessage],
    metadata: {},
  };
}

function publishStatus(
  eventBus: ExecutionEventBus,
  context: RequestContext,
  state: TaskState,
  parts: Part[],
): void {
  eventBus.publish(
    AgentEvent.statusUpdate({
      taskId: context.taskId,
      contextId: context.contextId,
      status: {
        state,
        timestamp: new Date().toISOString(),
        message: agentMessage(context.taskId, context.contextId, parts),
      },
      metadata: {},
    }),
  );
}

class WaitForCancelExecutor implements AgentExecutor {
  readonly #cancels = new Map<string, () => void>();

  cancelTask = async (taskId: string, _eventBus: ExecutionEventBus): Promise<void> => {
    this.#cancels.get(taskId)?.();
  };

  async execute(context: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    eventBus.publish(AgentEvent.task(context.task ?? newTask(context)));
    publishStatus(eventBus, context, TaskState.TASK_STATE_WORKING, [
      textPart('Working until you cancel.'),
    ]);

    const cancelled = await new Promise<boolean>(resolve => {
      const timer = setTimeout(() => resolve(false), OPEN_FOR_MS);
      this.#cancels.set(context.taskId, () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    this.#cancels.delete(context.taskId);

    publishStatus(
      eventBus,
      context,
      cancelled ? TaskState.TASK_STATE_CANCELED : TaskState.TASK_STATE_COMPLETED,
      [textPart(cancelled ? 'Cancelled.' : 'Nobody cancelled, so the task completed.')],
    );
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The newest A2UI version the capabilities in a message's metadata name, under its own key. */
function offeredVersion(metadata: unknown): A2uiVersion | undefined {
  if (!isObject(metadata)) {
    return undefined;
  }
  return A2UI_VERSIONS.find(entry => {
    const capabilities = metadata[entry.capabilitiesKey];
    return isObject(capabilities) && isObject(capabilities[entry.version]);
  });
}

/** Whether a request is A2A 0.3, as the SDK reads it: no `A2A-Version`, or 0.3. */
function isA2a03(requestedVersion: string | undefined): boolean {
  return requestedVersion === undefined || requestedVersion === '' || requestedVersion === '0.3';
}

/** A2UI as a data part, the MIME type in the part's metadata. */
function a2uiPart(data: unknown): Part {
  return {
    content: {$case: 'data' as const, value: data},
    metadata: {mimeType: A2UI_MIME_TYPE},
    filename: '',
    mediaType: '',
  };
}

/**
 * A2UI messages as data parts: one part holding the array in A2A 1.0, and
 * one part per message in A2A 0.3, whose data part holds an object.
 */
function a2uiParts(messages: Array<Record<string, unknown>>, a2a03: boolean): Part[] {
  return a2a03 ? messages.map(a2uiPart) : [a2uiPart(messages)];
}

function askForName({version, catalogId}: A2uiVersion): Array<Record<string, unknown>> {
  return [
    {version, createSurface: {surfaceId: SURFACE_ID, catalogId}},
    {
      version,
      updateComponents: {
        surfaceId: SURFACE_ID,
        components: [
          {id: 'root', component: 'Column', children: ['question', 'greeting']},
          {id: 'question', component: 'Text', text: "What's your name?"},
          {id: 'greeting', component: 'Text', text: {path: '/greeting'}},
        ],
      },
    },
    {version, updateDataModel: {surfaceId: SURFACE_ID, path: '/greeting', value: 'Hello!'}},
  ];
}

function greet({version}: A2uiVersion, name: string): Array<Record<string, unknown>> {
  return [
    {
      version,
      updateDataModel: {surfaceId: SURFACE_ID, path: '/greeting', value: `Hello, ${name}!`},
    },
  ];
}

class CannedA2uiExecutor implements AgentExecutor {
  cancelTask = async (_taskId: string, _eventBus: ExecutionEventBus): Promise<void> => {};

  async execute(context: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    // A task the message continues is sent as working, without the last turn's status message and its A2UI.
    eventBus.publish(
      AgentEvent.task(
        context.task === undefined
          ? newTask(context)
          : {
              ...context.task,
              status: {
                state: TaskState.TASK_STATE_WORKING,
                timestamp: new Date().toISOString(),
                message: undefined,
              },
            },
      ),
    );
    const version = offeredVersion(context.userMessage.metadata);
    if (version === undefined) {
      publishStatus(eventBus, context, TaskState.TASK_STATE_COMPLETED, [
        textPart('Offer A2UI capabilities in the message metadata to get an answer in A2UI.'),
      ]);
      return;
    }
    const a2a03 = isA2a03(context.context.requestedVersion);
    if (context.task?.status?.state !== TaskState.TASK_STATE_INPUT_REQUIRED) {
      publishStatus(eventBus, context, TaskState.TASK_STATE_INPUT_REQUIRED, [
        textPart("What's your name?"),
        ...a2uiParts(askForName(version), a2a03),
      ]);
      return;
    }
    const text = context.userMessage.parts.find(part => part.content?.$case === 'text')?.content;
    const name = text?.$case === 'text' && text.value.trim() !== '' ? text.value.trim() : 'there';
    publishStatus(eventBus, context, TaskState.TASK_STATE_COMPLETED, [
      textPart(`Hello, ${name}!`),
      ...a2uiParts(greet(version, name), a2a03),
    ]);
  }
}

const BOOKING_SURFACE_ID = 'booking';

/**
 * The Flawed Booking Agent's A2UI: a booking form whose Button has a
 * property the basic catalog does not define, then an `updateComponents` to
 * a surface never created and an `updateDataModel` that names no surface.
 */
function flawedBooking({version, catalogId}: A2uiVersion): Array<Record<string, unknown>> {
  return [
    {version, createSurface: {surfaceId: BOOKING_SURFACE_ID, catalogId}},
    {
      version,
      updateComponents: {
        surfaceId: BOOKING_SURFACE_ID,
        components: [
          {id: 'root', component: 'Column', children: ['title', 'party', 'time', 'submit']},
          {id: 'title', component: 'Text', text: 'Book a table at Han Il Kwan', variant: 'h2'},
          {
            id: 'party',
            component: 'TextField',
            label: 'Party size',
            value: {path: '/booking/party'},
          },
          {
            id: 'submit',
            component: 'Button',
            child: 'submit_label',
            action: {event: {name: 'book'}},
            colour: 'primary',
          },
          {id: 'submit_label', component: 'Text', text: 'Book'},
        ],
      },
    },
    {
      version,
      updateDataModel: {surfaceId: BOOKING_SURFACE_ID, path: '/booking', value: {party: '2'}},
    },
    {
      version,
      updateComponents: {
        surfaceId: 'confirmation',
        components: [{id: 'root', component: 'Text', text: 'Your table is booked.'}],
      },
    },
    {version, updateDataModel: {path: '/booking/time'}},
  ];
}

class FlawedBookingExecutor implements AgentExecutor {
  cancelTask = async (_taskId: string, _eventBus: ExecutionEventBus): Promise<void> => {};

  async execute(context: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const parts = [
      textPart('Here is the booking form for Han Il Kwan.'),
      ...flawedBooking(FLAWED_VERSION).map(a2uiPart),
    ];
    eventBus.publish(
      AgentEvent.task({
        ...newTask(context),
        status: {
          state: TaskState.TASK_STATE_COMPLETED,
          timestamp: new Date().toISOString(),
          message: agentMessage(context.taskId, context.contextId, parts),
        },
      }),
    );
  }
}

/**
 * Echoes the A2UI extension the stub answers with in the reply's extensions
 * header, named as the request's A2A version names it: the version the
 * message's capabilities offer, or the Flawed Booking Agent's own. Done ahead
 * of the SDK, which sets the header before a stream's events are produced.
 */
function echoA2uiExtension(
  answers: (metadata: unknown) => A2uiVersion | undefined,
): (request: Request, response: Response, next: NextFunction) => void {
  return (request, response, next) => {
    const body: unknown = request.body;
    if (isObject(body) && typeof body.method === 'string' && TURN_METHODS.has(body.method)) {
      const params = isObject(body.params) ? body.params : {};
      const message = isObject(params.message) ? params.message : {};
      const version = answers(message.metadata);
      if (version !== undefined) {
        response.setHeader(
          isA2a03(request.header('A2A-Version')) ? 'X-A2A-Extensions' : 'A2A-Extensions',
          version.extension,
        );
      }
    }
    next();
  };
}

const EXECUTORS: Record<Behaviour, () => AgentExecutor> = {
  'wait-for-cancel': () => new WaitForCancelExecutor(),
  'canned-a2ui': () => new CannedA2uiExecutor(),
  'flawed-booking': () => new FlawedBookingExecutor(),
};

const options = optionsFromArgs(process.argv.slice(2));
const requestHandler = new DefaultRequestHandler(
  agentCard(options),
  new InMemoryTaskStore(),
  EXECUTORS[options.behaviour](),
);
const app = express();
app.use(
  `/${AGENT_CARD_PATH}`,
  agentCardHandler({agentCardProvider: requestHandler, legacyCompat: {enabled: true}}),
);
if (options.bearerToken !== undefined) {
  app.use(JSON_RPC_PATH, requireBearerToken(options.bearerToken));
}
if (options.behaviour === 'canned-a2ui') {
  app.use(JSON_RPC_PATH, express.json(), echoA2uiExtension(offeredVersion));
} else if (options.behaviour === 'flawed-booking') {
  app.use(
    JSON_RPC_PATH,
    express.json(),
    echoA2uiExtension(() => FLAWED_VERSION),
  );
}
app.use(
  JSON_RPC_PATH,
  jsonRpcHandler({
    requestHandler,
    userBuilder: UserBuilder.noAuthentication,
    legacyCompat: {enabled: true},
  }),
);
const server = app.listen(options.port, '127.0.0.1', () => {
  console.log(`Spectra stub agent at http://127.0.0.1:${options.port}`);
});
server.on('error', error => {
  console.error(error);
  process.exit(1);
});
