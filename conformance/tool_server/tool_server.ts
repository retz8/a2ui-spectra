/**
 * Spectra's own tool server: MCP over streamable HTTP and over HTTP+SSE, and
 * a few plain HTTP routes, on one port, so that the tool proxy's reading of
 * each request by its content is exercised on a mixed server. Built on the
 * TypeScript MCP SDK's low-level server, so an unknown tool gets a JSON-RPC
 * error.
 *
 * Its MCP side, the same over every transport:
 *   tools      echo       answers with its arguments as JSON text
 *              fail       answers with isError
 *              progress   sends notifications/progress, when the request asks
 *                         for progress, and notifications/message while it runs
 *              ask        asks the client through sampling/createMessage and
 *                         answers with the client's text
 *              any other  a JSON-RPC error, -32602
 *   resources  spectra://tool-server/readme, text/plain
 *   prompts    greet, with the argument name
 *
 * Its routes:
 *   POST /mcp, GET /mcp, DELETE /mcp   MCP over streamable HTTP, each reply a stream
 *   POST /mcp/json, GET, DELETE        MCP over streamable HTTP, each reply JSON
 *   GET /sse, POST /messages           MCP over HTTP+SSE, the endpoint relative
 *   GET /api/json, POST /api/json      a JSON route, echoing the query and the body
 *   GET /api/events                    a server-sent-event route, three events
 *   anything else                      404
 *
 * Options:
 *   --port <n>   The port to listen on, on 127.0.0.1. Default: $PORT, or 9831.
 *
 * Run from conformance/ after `yarn build`: `node dist/tool_server/tool_server.js --port 9831`.
 */
import {randomUUID} from 'node:crypto';
import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {parseArgs} from 'node:util';

import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {SSEServerTransport} from '@modelcontextprotocol/sdk/server/sse.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  CreateMessageResultSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const README_URI = 'spectra://tool-server/readme';
const README_TEXT = "Spectra's own tool server, for the tool proxy's tests.";

const TOOLS = [
  {
    name: 'echo',
    description: 'Answers with its arguments.',
    inputSchema: {type: 'object' as const, properties: {text: {type: 'string'}}},
  },
  {
    name: 'fail',
    description: 'Answers with a tool error.',
    inputSchema: {type: 'object' as const, properties: {}},
  },
  {
    name: 'progress',
    description: 'Reports its progress and a log message while it runs.',
    inputSchema: {type: 'object' as const, properties: {}},
  },
  {
    name: 'ask',
    description: 'Asks the client for a sample, and answers with its text.',
    inputSchema: {type: 'object' as const, properties: {question: {type: 'string'}}},
  },
];

/** One MCP server, for one session. */
function mcpServer(): Server {
  const server = new Server(
    {name: 'spectra-tool-server', version: '0.0.1'},
    {capabilities: {tools: {}, resources: {}, prompts: {}, logging: {}}},
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({tools: TOOLS}));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const args = request.params.arguments ?? {};
    switch (request.params.name) {
      case 'echo':
        return {content: [{type: 'text', text: JSON.stringify(args)}]};
      case 'fail':
        return {content: [{type: 'text', text: 'The tool failed, as asked.'}], isError: true};
      case 'progress': {
        const token = request.params._meta?.progressToken;
        if (token !== undefined) {
          await extra.sendNotification({
            method: 'notifications/progress',
            params: {progressToken: token, progress: 1, total: 2},
          });
        }
        await extra.sendNotification({
          method: 'notifications/message',
          params: {level: 'info', logger: 'progress', data: 'Halfway there.'},
        });
        if (token !== undefined) {
          await extra.sendNotification({
            method: 'notifications/progress',
            params: {progressToken: token, progress: 2, total: 2},
          });
        }
        return {content: [{type: 'text', text: 'Done.'}]};
      }
      case 'ask': {
        const sampled = await extra.sendRequest(
          {
            method: 'sampling/createMessage',
            params: {
              messages: [
                {
                  role: 'user',
                  content: {type: 'text', text: String(args.question ?? 'Say yes.')},
                },
              ],
              maxTokens: 16,
            },
          },
          CreateMessageResultSchema,
        );
        const content = sampled.content as {type: string; text?: string};
        return {content: [{type: 'text', text: content.text ?? ''}]};
      }
      default:
        throw new McpError(ErrorCode.InvalidParams, `Tool ${request.params.name} not found`);
    }
  });
  server.setRequestHandler(ListResourcesRequestSchema, () => ({
    resources: [{uri: README_URI, name: 'readme', mimeType: 'text/plain'}],
  }));
  server.setRequestHandler(ReadResourceRequestSchema, request => {
    if (request.params.uri !== README_URI) {
      throw new McpError(ErrorCode.InvalidParams, `Resource ${request.params.uri} not found`);
    }
    return {contents: [{uri: README_URI, mimeType: 'text/plain', text: README_TEXT}]};
  });
  server.setRequestHandler(ListPromptsRequestSchema, () => ({
    prompts: [{name: 'greet', arguments: [{name: 'name', required: true}]}],
  }));
  server.setRequestHandler(GetPromptRequestSchema, request => {
    if (request.params.name !== 'greet') {
      throw new McpError(ErrorCode.InvalidParams, `Prompt ${request.params.name} not found`);
    }
    return {
      messages: [
        {
          role: 'user',
          content: {type: 'text', text: `Greet ${request.params.arguments?.name ?? 'someone'}.`},
        },
      ],
    };
  });
  return server;
}

/** The streamable HTTP sessions, by endpoint and session id. */
const streamable = new Map<string, StreamableHTTPServerTransport>();
/** The HTTP+SSE sessions, by session id. */
const sse = new Map<string, SSEServerTransport>();

async function handleStreamable(
  request: IncomingMessage,
  response: ServerResponse,
  json: boolean,
): Promise<void> {
  const header = request.headers['mcp-session-id'];
  const id = Array.isArray(header) ? header[0] : header;
  const key = `${json ? 'json' : 'stream'}:${id}`;
  const existing = id === undefined ? undefined : streamable.get(key);
  if (existing !== undefined) {
    await existing.handleRequest(request, response);
    return;
  }
  if (id !== undefined || request.method !== 'POST') {
    response.writeHead(404, {'content-type': 'application/json'});
    response.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: {code: -32001, message: 'Session not found'},
      }),
    );
    return;
  }
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: json,
    onsessioninitialized: sessionId => {
      streamable.set(`${json ? 'json' : 'stream'}:${sessionId}`, transport);
    },
    onsessionclosed: sessionId => {
      streamable.delete(`${json ? 'json' : 'stream'}:${sessionId}`);
    },
  });
  await mcpServer().connect(transport);
  await transport.handleRequest(request, response);
}

async function handleSse(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (request.method === 'GET' && url.pathname === '/sse') {
    const transport = new SSEServerTransport('/messages', response);
    sse.set(transport.sessionId, transport);
    transport.onclose = () => sse.delete(transport.sessionId);
    await mcpServer().connect(transport);
    return;
  }
  const transport = sse.get(url.searchParams.get('sessionId') ?? '');
  if (transport === undefined) {
    response.writeHead(404, {'content-type': 'text/plain'});
    response.end('Session not found');
    return;
  }
  await transport.handlePostMessage(request, response);
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => (body += chunk));
    request.once('end', () => resolve(body));
    request.once('error', reject);
  });
}

async function handleApi(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname === '/api/json' && (request.method === 'GET' || request.method === 'POST')) {
    const body = request.method === 'POST' ? await readBody(request) : '';
    response.writeHead(200, {'content-type': 'application/json'});
    response.end(
      JSON.stringify({
        method: request.method,
        query: Object.fromEntries(url.searchParams),
        ...(body !== '' && {body: JSON.parse(body) as unknown}),
      }),
    );
    return;
  }
  if (url.pathname === '/api/events' && request.method === 'GET') {
    response.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-cache'});
    response.write('event: tick\nid: 1\ndata: {"n": 1}\n\n');
    response.write('event: tick\nid: 2\ndata: {"n": 2}\n\n');
    response.end('data: done\n\n');
    return;
  }
  response.writeHead(404, {'content-type': 'text/plain'});
  response.end('Not found');
}

function main(): void {
  const {values} = parseArgs({options: {port: {type: 'string'}}});
  const port = Number(values.port ?? process.env.PORT ?? 9831);
  const http = createServer((request, response) => {
    const {pathname} = new URL(request.url ?? '/', 'http://localhost');
    const handled =
      pathname === '/mcp'
        ? handleStreamable(request, response, false)
        : pathname === '/mcp/json'
          ? handleStreamable(request, response, true)
          : pathname === '/sse' || pathname === '/messages'
            ? handleSse(request, response)
            : handleApi(request, response);
    handled.catch((error: unknown) => {
      console.error(error);
      if (!response.headersSent) {
        response.writeHead(500, {'content-type': 'text/plain'});
      }
      response.end();
    });
  });
  http.listen(port, '127.0.0.1', () => {
    console.log(`Spectra tool server at http://127.0.0.1:${port}`);
  });
}

main();
