/**
 * A small fake A2A agent for the command-line test. It answers its card at
 * both well-known paths, a canned A2A 0.3 send and stream at any path, and
 * the request headers it received at /headers, and the JSON-RPC requests
 * this process received at /requests. Run as a script, it is the agent's
 * command under `run`; `startFakeAgent` runs it inside a test.
 *
 * Script options:
 *   --port <n>                   The port to listen on, on 127.0.0.1.
 *   --transports <list>          The transports the card lists, in preference
 *                                order, comma-separated. Default: JSONRPC.
 *   --card-file <path>           A JSON file read at start whose `name`,
 *                                `transports` and `streaming` replace the
 *                                card's, so a test changes the card between
 *                                two starts of the command.
 *   --streaming                  The card declares streaming, so the message
 *                                box sends a stream.
 *   --hold-card-until-file <path>
 *                                Leave each card request unanswered until the
 *                                file exists, as an agent that listens before
 *                                it can answer.
 *   --hold-stream-while-file <path>
 *                                While the file exists, a stream sends its
 *                                first event and stays open.
 *   --exit-after-card <code>     Exit with <code> soon after answering the card.
 *   --ignore-sigterm             Ignore the stop signal.
 *   --wait-for-open-requests     On the stop signal, stop listening and exit
 *                                once the open requests have ended, however
 *                                long that takes, as uvicorn does.
 *   --stop-delay <ms>            On the stop signal, exit after <ms>.
 *   --pid-file <path>            Append this process's id and a newline at
 *                                start.
 *   --grandchild-pid-file <path> Start a long-running child and write its pid.
 *   --model-call                 Call the model at ANTHROPIC_BASE_URL during
 *                                each turn, before answering, as a redirected
 *                                agent does.
 *   --tool-call                  Call a tool over MCP at FAKE_TOOL_URL during
 *                                each turn, before answering, with a bearer
 *                                token, as an agent reading its tool server's
 *                                URL from a variable does.
 *   --otel-export                Export OTLP/JSON to OTEL_EXPORTER_OTLP_ENDPOINT
 *                                for each turn: before answering, a span
 *                                carrying the request's trace context and a
 *                                log record on it, with the OpenTelemetry
 *                                variables it was given as attributes; and a
 *                                second span half a second after answering.
 */
import {spawn} from 'node:child_process';
import {appendFileSync, existsSync, readFileSync, writeFileSync} from 'node:fs';
import {createServer, request as httpRequest, type Server} from 'node:http';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';

import {FAKE_PROVIDER_KEY} from './fake_provider.js';

export const FAKE_AGENT_NAME = 'Fake agent';

/** The bearer token the fake agent sends its tool server, which no record may hold. */
export const FAKE_TOOL_TOKEN = 'fake-tool-token-0f3c9a';

const surface = {
  version: 'v0.9',
  createSurface: {
    surfaceId: 'default',
    catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
  },
};

/** The reply to a send, byte for byte, spaced unusually so a re-encoding shows. */
export const SEND_REPLY = `{"jsonrpc": "2.0", "id": 1,
  "result": {"kind": "message", "messageId": "r-1", "role": "agent", "contextId": "ctx-1",
    "parts": [{"kind": "text", "text": "Hello"}]}}`;

/** The reply to a stream, byte for byte: two events, a comment and a CRLF between. */
export const STREAM_REPLY =
  `data: ${JSON.stringify({jsonrpc: '2.0', id: 1, result: {kind: 'status-update', taskId: 't-1', contextId: 'ctx-1', status: {state: 'working', message: {kind: 'message', messageId: 'r-1', role: 'agent', parts: [{kind: 'data', data: surface, metadata: {mimeType: 'application/json+a2ui'}}]}}, final: false}})}\r\n\r\n` +
  ': keep-alive\n\n' +
  `data: ${JSON.stringify({jsonrpc: '2.0', id: 1, result: {kind: 'status-update', taskId: 't-1', contextId: 'ctx-1', status: {state: 'input-required'}, final: false}})}\n\n`;

export interface FakeAgentOptions {
  onCardAnswered?: () => void;
  /**
   * The transports the card lists, in preference order; none is a card that
   * lists no interface. Default: JSON-RPC only.
   */
  transports?: string[];
  /** Whether each turn calls the model at ANTHROPIC_BASE_URL before answering. */
  modelCall?: boolean;
  /** Whether each turn calls a tool over MCP at FAKE_TOOL_URL before answering. */
  toolCall?: boolean;
  /** Whether each turn exports to OTEL_EXPORTER_OTLP_ENDPOINT, before answering and after. */
  otelExport?: boolean;
  /** The card's name. Default: the fake agent's. */
  name?: string;
  /** Whether the card declares streaming. */
  streaming?: boolean;
  /** While it says so, a card request is left unanswered. */
  holdCard?: () => boolean;
  /** While it says so, a stream sends its first event and stays open. */
  holdStream?: () => boolean;
}

/** One MCP tools/call at FAKE_TOOL_URL, with the fake token, resolving when it has been answered. */
function callTool(): Promise<void> {
  const url = process.env.FAKE_TOOL_URL;
  if (url === undefined) return Promise.resolve();
  return new Promise(resolve => {
    const request = httpRequest(
      url,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${FAKE_TOOL_TOKEN}`,
          'mcp-protocol-version': '2025-06-18',
        },
      },
      response => {
        response.resume();
        response.once('end', () => resolve());
        response.once('error', () => resolve());
      },
    );
    request.once('error', () => resolve());
    request.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {name: 'lookup', arguments: {q: 'floor plan'}},
      }),
    );
  });
}

/** The span names of the fake agent's export, and its scope. */
export const FAKE_SPAN_SCOPE = 'fake-agent';

/** Posts one OTLP/JSON export to the receiver at OTEL_EXPORTER_OTLP_ENDPOINT, resolving when it has been answered. */
function exportOtlp(signal: 'traces' | 'logs', body: unknown): Promise<void> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (endpoint === undefined) return Promise.resolve();
  return new Promise(resolve => {
    const request = httpRequest(
      `${endpoint}/v1/${signal}`,
      {method: 'POST', headers: {'content-type': 'application/json'}},
      response => {
        response.resume();
        response.once('end', () => resolve());
      },
    );
    request.once('error', () => resolve());
    request.end(JSON.stringify(body));
  });
}

function nowUnixNano(): string {
  return (BigInt(Date.now()) * 1_000_000n).toString();
}

/** One span of the fake agent's export, in OTLP/JSON. */
function otlpSpan(traceId: string, spanId: string, parentSpanId: string, name: string): unknown {
  const start = nowUnixNano();
  const string = (value: string | undefined) => ({stringValue: value ?? ''});
  return {
    resourceSpans: [
      {
        scopeSpans: [
          {
            scope: {name: FAKE_SPAN_SCOPE, version: '1.0'},
            spans: [
              {
                traceId,
                spanId,
                parentSpanId,
                name,
                kind: 2,
                startTimeUnixNano: start,
                endTimeUnixNano: start,
                attributes: [
                  {key: 'otlp.protocol', value: string(process.env.OTEL_EXPORTER_OTLP_PROTOCOL)},
                  {
                    key: 'otlp.capture',
                    value: string(process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT),
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

/** A turn's export: its span and a log record on it now, and a later span once the turn has closed. */
function exportTurn(traceparent: string | undefined): Promise<void> {
  const [, traceId, parentId] = traceparent?.split('-') ?? [];
  if (traceId === undefined || parentId === undefined) return Promise.resolve();
  const spanId = '5eed0000000000a1';
  setTimeout(() => {
    void exportOtlp('traces', otlpSpan(traceId, '5eed0000000000a2', spanId, 'after the reply'));
  }, 500);
  return exportOtlp('logs', {
    resourceLogs: [
      {
        scopeLogs: [
          {
            scope: {name: FAKE_SPAN_SCOPE},
            logRecords: [
              {
                timeUnixNano: nowUnixNano(),
                severityText: 'INFO',
                body: {stringValue: 'answering'},
                traceId,
                spanId,
              },
            ],
          },
        ],
      },
    ],
  }).then(() => exportOtlp('traces', otlpSpan(traceId, spanId, parentId, 'POST /')));
}

/** One call to Anthropic's Messages API at ANTHROPIC_BASE_URL, with the fake key, resolving when it has been answered. */
function callModel(): Promise<void> {
  const base = process.env.ANTHROPIC_BASE_URL;
  if (base === undefined) return Promise.resolve();
  return new Promise(resolve => {
    const request = httpRequest(
      `${base}/v1/messages`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': FAKE_PROVIDER_KEY,
          'anthropic-version': '2023-06-01',
        },
      },
      response => {
        response.resume();
        response.once('end', () => resolve());
        response.once('error', () => resolve());
      },
    );
    request.once('error', () => resolve());
    request.end(
      JSON.stringify({
        model: 'claude-fake-1',
        max_tokens: 64,
        system: 'You are a fake agent.',
        messages: [{role: 'user', content: 'Hi'}],
      }),
    );
  });
}

/** Starts the fake agent on 127.0.0.1. */
export function startFakeAgent(
  port: number,
  {
    onCardAnswered,
    transports = ['JSONRPC'],
    modelCall = false,
    toolCall = false,
    otelExport = false,
    name = FAKE_AGENT_NAME,
    streaming = false,
    holdCard,
    holdStream,
  }: FakeAgentOptions = {},
): Promise<Server> {
  const url = `http://localhost:${port}/`;
  const capabilities = streaming ? {capabilities: {streaming: true}} : {};
  // No transports is a card that lists no interface at all, as an empty A2A 1.0 list.
  const card =
    transports.length === 0
      ? {name, ...capabilities, supportedInterfaces: []}
      : {
          name,
          ...capabilities,
          url,
          preferredTransport: transports[0],
          ...(transports.length > 1 && {
            additionalInterfaces: transports.slice(1).map(transport => ({url, transport})),
          }),
        };
  /** The JSON-RPC requests this process received, in order. */
  const requests: unknown[] = [];
  const server = createServer((request, response) => {
    if (
      request.method === 'GET' &&
      (request.url === '/.well-known/agent-card.json' || request.url === '/.well-known/agent.json')
    ) {
      const answerCard = () => {
        if (holdCard?.() === true) {
          if (!response.destroyed) setTimeout(answerCard, 25);
          return;
        }
        response.writeHead(200, {'content-type': 'application/json'});
        response.end(JSON.stringify(card));
        onCardAnswered?.();
      };
      answerCard();
      return;
    }
    if (request.method === 'GET' && request.url === '/requests') {
      response.writeHead(200, {'content-type': 'application/json'});
      response.end(JSON.stringify(requests));
      return;
    }
    if (request.method === 'GET' && request.url === '/headers') {
      response.writeHead(200, {'content-type': 'application/json'});
      response.end(JSON.stringify(request.headers));
      return;
    }
    if (request.method !== 'POST') {
      response.writeHead(404);
      response.end();
      return;
    }
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => (body += chunk));
    request.on('end', () => {
      let method: unknown;
      try {
        const parsed = JSON.parse(body) as {method?: unknown};
        requests.push(parsed);
        method = parsed.method;
      } catch {
        method = undefined;
      }
      const answer = () => {
        if (method === 'message/send') {
          response.writeHead(200, {'content-type': 'application/json'});
          response.end(SEND_REPLY);
        } else if (method === 'message/stream') {
          response.writeHead(200, {'content-type': 'text/event-stream'});
          if (holdStream?.() === true) {
            response.write(STREAM_REPLY.slice(0, STREAM_REPLY.indexOf('\r\n\r\n') + 4));
          } else {
            response.end(STREAM_REPLY);
          }
        } else {
          response.writeHead(200, {'content-type': 'application/json'});
          response.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              error: {code: -32601, message: 'Method not found'},
            }),
          );
        }
      };
      const traceparent = request.headers.traceparent;
      if (
        (modelCall || toolCall || otelExport) &&
        (method === 'message/send' || method === 'message/stream')
      ) {
        void (modelCall ? callModel() : Promise.resolve())
          .then(() => (toolCall ? callTool() : undefined))
          .then(() =>
            otelExport
              ? exportTurn(Array.isArray(traceparent) ? traceparent[0] : traceparent)
              : undefined,
          )
          .then(answer);
      } else {
        answer();
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function runAsScript(): Promise<void> {
  const {values} = parseArgs({
    options: {
      port: {type: 'string'},
      transports: {type: 'string'},
      'card-file': {type: 'string'},
      streaming: {type: 'boolean'},
      'hold-card-until-file': {type: 'string'},
      'hold-stream-while-file': {type: 'string'},
      'exit-after-card': {type: 'string'},
      'ignore-sigterm': {type: 'boolean'},
      'wait-for-open-requests': {type: 'boolean'},
      'stop-delay': {type: 'string'},
      'pid-file': {type: 'string'},
      'grandchild-pid-file': {type: 'string'},
      'model-call': {type: 'boolean'},
      'tool-call': {type: 'boolean'},
      'otel-export': {type: 'boolean'},
    },
  });
  if (values['pid-file'] !== undefined) {
    appendFileSync(values['pid-file'], `${process.pid}\n`);
  }
  if (values['ignore-sigterm']) {
    process.on('SIGTERM', () => {});
  }
  const stopDelay = values['stop-delay'];
  if (stopDelay !== undefined) {
    process.on('SIGTERM', () => setTimeout(() => process.exit(0), Number(stopDelay)));
  }
  const cardFile = values['card-file'];
  const fromFile =
    cardFile !== undefined && existsSync(cardFile)
      ? (JSON.parse(readFileSync(cardFile, 'utf8')) as {
          name?: string;
          transports?: string[];
          streaming?: boolean;
        })
      : {};
  const holdCardFile = values['hold-card-until-file'];
  const holdStreamFile = values['hold-stream-while-file'];
  if (values['grandchild-pid-file'] !== undefined) {
    const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    writeFileSync(values['grandchild-pid-file'], String(grandchild.pid));
  }
  const exitCode = values['exit-after-card'];
  const server = await startFakeAgent(Number(values.port), {
    transports: fromFile.transports ?? values.transports?.split(','),
    ...(fromFile.name !== undefined && {name: fromFile.name}),
    streaming: fromFile.streaming ?? values.streaming === true,
    ...(holdCardFile !== undefined && {holdCard: () => !existsSync(holdCardFile)}),
    ...(holdStreamFile !== undefined && {holdStream: () => existsSync(holdStreamFile)}),
    modelCall: values['model-call'] === true,
    toolCall: values['tool-call'] === true,
    otelExport: values['otel-export'] === true,
    onCardAnswered: () => {
      if (exitCode !== undefined) {
        setTimeout(() => process.exit(Number(exitCode)), 200);
      }
    },
  });
  if (values['wait-for-open-requests']) {
    process.on('SIGTERM', () => server.close(() => process.exit(0)));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await runAsScript();
}
