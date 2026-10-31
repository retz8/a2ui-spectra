/**
 * Reading MCP's JSON-RPC messages into the pinned MCP conventions' names:
 * which message is a request, a notification or a response, the attributes
 * a message carries, the event's name, and what a reply says of the call.
 */

/** One JSON-RPC 2.0 message. */
export type JsonRpcMessage = Record<string, unknown> & {jsonrpc: '2.0'};

/** A body or chunk that is one JSON object with `"jsonrpc": "2.0"`; a batch array is not. */
export function asJsonRpc(value: unknown): JsonRpcMessage | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>).jsonrpc === '2.0'
    ? (value as JsonRpcMessage)
    : undefined;
}

/** A JSON-RPC id, a string or a number, as the key the proxy matches requests and responses on. */
export function idKey(id: unknown): string | undefined {
  return typeof id === 'string' || typeof id === 'number' ? String(id) : undefined;
}

/** A message that asks: it names a method and carries an id. */
export function isRequest(message: JsonRpcMessage): boolean {
  return typeof message.method === 'string' && idKey(message.id) !== undefined;
}

/** A message that names a method with no id. */
export function isNotification(message: JsonRpcMessage): boolean {
  return typeof message.method === 'string' && !('id' in message);
}

/** A message that answers: no method, an id, and a result or an error. */
export function isResponse(message: JsonRpcMessage): boolean {
  return (
    typeof message.method !== 'string' &&
    idKey(message.id) !== undefined &&
    ('result' in message || 'error' in message)
  );
}

function paramsOf(message: JsonRpcMessage): Record<string, unknown> {
  const params = message.params;
  return typeof params === 'object' && params !== null && !Array.isArray(params)
    ? (params as Record<string, unknown>)
    : {};
}

function metaOf(message: JsonRpcMessage): Record<string, unknown> {
  const meta = paramsOf(message)._meta;
  return typeof meta === 'object' && meta !== null && !Array.isArray(meta)
    ? (meta as Record<string, unknown>)
    : {};
}

/** The trace context a message carries in `params._meta`, the carrier the pinned MCP conventions define. */
export function traceparentOf(message: JsonRpcMessage): string | undefined {
  const value = metaOf(message).traceparent;
  return typeof value === 'string' ? value : undefined;
}

/** The progress token a request asks its progress under, in `params._meta.progressToken`. */
export function progressTokenOf(message: JsonRpcMessage): string | undefined {
  return idKey(metaOf(message).progressToken);
}

/** The progress token a `notifications/progress` reports under. */
export function reportedProgressToken(message: JsonRpcMessage): string | undefined {
  return idKey(paramsOf(message).progressToken);
}

/** The id `notifications/cancelled` names, `params.requestId`. */
export function cancelledRequestId(message: JsonRpcMessage): string | undefined {
  return idKey(paramsOf(message).requestId);
}

/** The protocol version an `initialize` result negotiated. */
export function negotiatedVersion(reply: JsonRpcMessage): string | undefined {
  const result = reply.result;
  if (typeof result !== 'object' || result === null) return undefined;
  const version = (result as Record<string, unknown>).protocolVersion;
  return typeof version === 'string' ? version : undefined;
}

/**
 * The attributes a request or notification carries: its method, its id on a
 * request, and per method the tool, its arguments, the resource or the prompt.
 */
export function messageAttributes(message: JsonRpcMessage): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};
  const method = message.method;
  if (typeof method === 'string') {
    attributes['mcp.method.name'] = method;
  }
  const id = idKey(message.id);
  if (id !== undefined) {
    attributes['jsonrpc.request.id'] = id;
  }
  const params = paramsOf(message);
  if (method === 'tools/call') {
    attributes['gen_ai.operation.name'] = 'execute_tool';
    if (typeof params.name === 'string') {
      attributes['gen_ai.tool.name'] = params.name;
    }
    const args = params.arguments;
    if (typeof args === 'object' && args !== null && !Array.isArray(args)) {
      attributes['gen_ai.tool.call.arguments'] = args;
    }
  } else if (method === 'resources/read' && typeof params.uri === 'string') {
    attributes['mcp.resource.uri'] = params.uri;
  } else if (method === 'prompts/get' && typeof params.name === 'string') {
    attributes['gen_ai.prompt.name'] = params.name;
  }
  return attributes;
}

/**
 * The event's name: `{mcp.method.name} {target}`, the target the tool name,
 * the prompt name or the resource URI, else the method alone.
 */
export function eventName(attributes: Record<string, unknown>): string {
  const method = String(attributes['mcp.method.name']);
  const target =
    attributes['gen_ai.tool.name'] ??
    attributes['gen_ai.prompt.name'] ??
    attributes['mcp.resource.uri'];
  return typeof target === 'string' ? `${method} ${target}` : method;
}

/** What a reply says of the call: the attributes it adds, and the failure when it reports one. */
export interface ReplyReading {
  attributes: Record<string, unknown>;
  /** A JSON-RPC error: the status is an error, with this message. */
  error?: {type: string; message?: string};
}

/**
 * Reads a JSON-RPC response to a request of `method`: a JSON-RPC error is a
 * failed call, its code as `error.type` and `rpc.response.status_code`; a
 * `tools/call` result with `isError` is `error.type` `tool_error` with the
 * status kept; any other `tools/call` result is `gen_ai.tool.call.result`.
 */
export function readReply(method: string | undefined, reply: JsonRpcMessage): ReplyReading {
  const error = reply.error;
  if (typeof error === 'object' && error !== null) {
    const {code, message} = error as {code?: unknown; message?: unknown};
    const type = typeof code === 'number' || typeof code === 'string' ? String(code) : 'error';
    return {
      attributes: {'error.type': type, 'rpc.response.status_code': type},
      error: {type, ...(typeof message === 'string' && {message})},
    };
  }
  const result = reply.result;
  if (method === 'tools/call' && typeof result === 'object' && result !== null) {
    if ((result as Record<string, unknown>).isError === true) {
      return {attributes: {'error.type': 'tool_error'}};
    }
    if (!Array.isArray(result)) {
      return {attributes: {'gen_ai.tool.call.result': result}};
    }
  }
  return {attributes: {}};
}
