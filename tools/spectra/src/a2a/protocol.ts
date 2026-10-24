/**
 * A2A 0.3 and A2A 1.0, read into one shape. The two versions differ in their
 * method names, in how a reply names its kind, in their part shapes and in
 * the spelling of roles and task states; the rest of the adapter sees only
 * what is here.
 */

/** The A2A protocol versions the adapter reads. */
export type A2aVersion = '0.3' | '1.0';

/** Whether a turn's request asks for one reply or a stream. */
export type TurnMethod = 'send' | 'stream';

/** The JSON-RPC methods that open a turn, with the version each belongs to. */
const TURN_METHODS: Readonly<Record<string, {version: A2aVersion; method: TurnMethod}>> = {
  'message/send': {version: '0.3', method: 'send'},
  'message/stream': {version: '0.3', method: 'stream'},
  SendMessage: {version: '1.0', method: 'send'},
  SendStreamingMessage: {version: '1.0', method: 'stream'},
};

/** A2A's task states, in A2A 0.3's spelling. */
export type TaskState =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'completed'
  | 'canceled'
  | 'failed'
  | 'rejected'
  | 'auth-required'
  | 'unknown';

const V03_STATES = new Set<string>([
  'submitted',
  'working',
  'input-required',
  'completed',
  'canceled',
  'failed',
  'rejected',
  'auth-required',
  'unknown',
]);

const V10_STATES: Readonly<Record<string, TaskState>> = {
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

/** An A2A message. Its parts stay in their version's shape. */
export interface A2aMessage {
  messageId?: string;
  role?: 'user' | 'agent';
  parts: unknown[];
  contextId?: string;
  taskId?: string;
  metadata?: Record<string, unknown>;
}

export interface A2aArtifact {
  parts: unknown[];
  metadata?: Record<string, unknown>;
}

/** A request that opens a turn. */
export interface TurnRequest {
  version: A2aVersion;
  method: TurnMethod;
  message: A2aMessage;
}

/** One object an agent replies with: a send's result, or one stream event's. */
export type Reply =
  | {kind: 'message'; message: A2aMessage}
  | {
      kind: 'task';
      taskId?: string;
      contextId?: string;
      state?: TaskState;
      statusMessage?: A2aMessage;
      history: A2aMessage[];
      artifacts: A2aArtifact[];
      metadata?: Record<string, unknown>;
    }
  | {
      kind: 'status-update';
      taskId?: string;
      contextId?: string;
      state?: TaskState;
      message?: A2aMessage;
    }
  | {kind: 'artifact-update'; taskId?: string; contextId?: string; artifact: A2aArtifact};

/** Whether a value is a JSON object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads a request body that opens a turn: a single JSON-RPC 2.0 request
 * naming one of the send or stream methods of A2A 0.3 or 1.0. Anything else
 * reads as nothing.
 */
export function readTurnRequest(body: unknown): TurnRequest | undefined {
  if (!isRecord(body) || body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    return undefined;
  }
  const turnMethod = Object.hasOwn(TURN_METHODS, body.method)
    ? TURN_METHODS[body.method]
    : undefined;
  if (turnMethod === undefined) {
    return undefined;
  }
  const params = isRecord(body.params) ? body.params : {};
  return {...turnMethod, message: readMessage(params.message) ?? {parts: []}};
}

/** Reads one reply object, in its version's shape. */
export function readReply(result: unknown, version: A2aVersion): Reply | undefined {
  if (!isRecord(result)) {
    return undefined;
  }
  if (version === '0.3') {
    switch (result.kind) {
      case 'message':
        return messageReply(result);
      case 'task':
        return taskReply(result, version);
      case 'status-update':
        return statusUpdateReply(result, version);
      case 'artifact-update':
        return artifactUpdateReply(result);
      default:
        return undefined;
    }
  }
  if (isRecord(result.message)) {
    return messageReply(result.message);
  }
  if (isRecord(result.task)) {
    return taskReply(result.task, version);
  }
  if (isRecord(result.statusUpdate)) {
    return statusUpdateReply(result.statusUpdate, version);
  }
  if (isRecord(result.artifactUpdate)) {
    return artifactUpdateReply(result.artifactUpdate);
  }
  return undefined;
}

function messageReply(value: Record<string, unknown>): Reply {
  return {kind: 'message', message: readMessage(value) ?? {parts: []}};
}

function taskReply(task: Record<string, unknown>, version: A2aVersion): Reply {
  const status = isRecord(task.status) ? task.status : {};
  return {
    kind: 'task',
    ...optional('taskId', stringOrUndefined(task.id)),
    ...optional('contextId', stringOrUndefined(task.contextId)),
    ...optional('state', readState(status.state, version)),
    ...optional('statusMessage', readMessage(status.message)),
    history: Array.isArray(task.history)
      ? task.history.flatMap(entry => readMessage(entry) ?? [])
      : [],
    artifacts: Array.isArray(task.artifacts)
      ? task.artifacts.flatMap(entry => readArtifact(entry) ?? [])
      : [],
    ...optional('metadata', isRecord(task.metadata) ? task.metadata : undefined),
  };
}

function statusUpdateReply(event: Record<string, unknown>, version: A2aVersion): Reply {
  const status = isRecord(event.status) ? event.status : {};
  return {
    kind: 'status-update',
    ...optional('taskId', stringOrUndefined(event.taskId)),
    ...optional('contextId', stringOrUndefined(event.contextId)),
    ...optional('state', readState(status.state, version)),
    ...optional('message', readMessage(status.message)),
  };
}

function artifactUpdateReply(event: Record<string, unknown>): Reply {
  return {
    kind: 'artifact-update',
    ...optional('taskId', stringOrUndefined(event.taskId)),
    ...optional('contextId', stringOrUndefined(event.contextId)),
    artifact: readArtifact(event.artifact) ?? {parts: []},
  };
}

function readMessage(value: unknown): A2aMessage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return {
    ...optional('messageId', stringOrUndefined(value.messageId)),
    ...optional('role', readRole(value.role)),
    parts: Array.isArray(value.parts) ? value.parts : [],
    ...optional('contextId', stringOrUndefined(value.contextId)),
    ...optional('taskId', stringOrUndefined(value.taskId)),
    ...optional('metadata', isRecord(value.metadata) ? value.metadata : undefined),
  };
}

function readArtifact(value: unknown): A2aArtifact | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return {
    parts: Array.isArray(value.parts) ? value.parts : [],
    ...optional('metadata', isRecord(value.metadata) ? value.metadata : undefined),
  };
}

function readRole(value: unknown): 'user' | 'agent' | undefined {
  switch (value) {
    case 'user':
    case 'ROLE_USER':
      return 'user';
    case 'agent':
    case 'ROLE_AGENT':
      return 'agent';
    default:
      return undefined;
  }
}

function readState(value: unknown, version: A2aVersion): TaskState | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  if (version === '0.3') {
    return V03_STATES.has(value) ? (value as TaskState) : undefined;
  }
  return Object.hasOwn(V10_STATES, value) ? V10_STATES[value] : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** A one-key object when the value is defined, so absent fields stay absent. */
function optional<Key extends string, Value>(
  key: Key,
  value: Value | undefined,
): {[K in Key]?: Value} {
  return (value === undefined ? {} : {[key]: value}) as {[K in Key]?: Value};
}
