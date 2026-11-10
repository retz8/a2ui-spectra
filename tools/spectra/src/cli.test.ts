/**
 * The command-line test: starts Spectra as a separate process and checks it
 * from outside. It runs under Node by default. When SPECTRA_BINARY names a
 * compiled binary, the same cases run against the binary instead.
 */
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {createServer, request as httpRequest, type Server} from 'node:http';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

import type {LogEntry, LogSnapshot} from './agent_log.js';
import type {AgentSnapshot} from './agent_supervisor.js';
import type {ListedTurn, SessionContext} from './api.js';
import type {MessageBoxState, ReplayStarted} from './message_box.js';
import {VARIABLES} from './model_proxy/redirection.js';
import {
  type CheckEvent,
  isEventOfKind,
  type ModelCallEvent,
  type ToolCallEvent,
  type TurnRecord,
} from './record/turn_record.js';
import {FAKE_TOOL_TOKEN, SEND_REPLY, startFakeAgent, STREAM_REPLY} from './testing/fake_agent.js';
import {FAKE_PROVIDER_KEY, startFakeProvider} from './testing/fake_provider.js';
import {boxSettled, getJson, LiveStream, postJson, sendMessage} from './testing/live_api.js';
import {binary, finished, freePort, SpectraProcess, workingDir} from './testing/spectra_process.js';
import {turnRecordErrors} from './testing/turn_record_schema.js';
import {VERSION} from './version.js';

const fakeAgentScript = fileURLToPath(new URL('./testing/fake_agent.js', import.meta.url));
const posix = process.platform !== 'win32';
const TIMEOUT = 30_000;

interface Answer {
  status: number;
  type: string | undefined;
  body: string;
}

/** One request to the viewer's server, with any headers, Host included. */
function send(
  port: number,
  {
    method = 'GET',
    path: urlPath = '/',
    headers = {},
    body,
  }: {
    method?: string;
    path?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method,
        path: urlPath,
        headers: {host: `localhost:${port}`, ...headers},
      },
      response => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (text += chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            type: response.headers['content-type'],
            body: text,
          }),
        );
      },
    );
    request.once('error', reject);
    request.end(body);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise(resolve => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function eventually(check: () => boolean, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) return false;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return true;
}

const viewerUrl = /The viewer is at http:\/\/localhost:(\d+)\//;
const cardAnswered = /The agent's card answered: Fake agent\./;
const proxyAddress = /Point a host at the wire proxy: http:\/\/127\.0\.0\.1:(\d+)\//;

function jsonRpc(method: string): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method,
    params: {
      message: {
        kind: 'message',
        messageId: 'm-1',
        role: 'user',
        parts: [{kind: 'text', text: 'Hi'}],
      },
    },
  });
}

describe(`a2ui-spectra as a process, ${binary ? 'the binary' : 'under Node'}`, () => {
  it('prints its version', {timeout: TIMEOUT}, async () => {
    const result = await finished(['--version']);
    assert.equal(result.code, 0);
    assert.equal(result.output, `${VERSION}\n`);
  });

  it('prints its help', {timeout: TIMEOUT}, async () => {
    const tool = await finished(['--help']);
    assert.equal(tool.code, 0);
    assert.match(tool.output, /attach \[<agent-url>\]/);
    assert.match(tool.output, /run \[--agent-url <url>\] \[options\] -- <command>/);
    assert.match(tool.output, /--config <path>/);
    const run = await finished(['run', '--help']);
    assert.equal(run.code, 0);
    assert.match(run.output, /--agent-url <url>/);
  });

  it("rejects run without the agent's command", {timeout: TIMEOUT}, async () => {
    const result = await finished(['run', '--agent-url', 'http://localhost:1']);
    assert.equal(result.code, 2);
    assert.match(result.output, /after '--'/);
  });

  it(
    "stops without the agent's URL on the command line or in the config file",
    {timeout: TIMEOUT},
    async () => {
      const result = await finished(['attach']);
      assert.equal(result.code, 2);
      assert.match(
        result.output,
        /attach needs the agent's URL: its <agent-url> argument, or agent\.url in a2ui-spectra\.json/,
      );
      const cwd = workingDir();
      writeFileSync(path.join(cwd, 'a2ui-spectra.json'), '{"agent": {"url": "localhost:1"}}');
      const bad = await finished(['attach'], cwd);
      assert.equal(bad.code, 1);
      assert.match(bad.output, /a2ui-spectra\.json: agent\.url must start with http/);
      const missing = await finished(['attach', '--config', 'nowhere.json'], cwd);
      assert.equal(missing.code, 1);
      assert.match(missing.output, /nowhere\.json does not exist/);
    },
  );

  it('attach waits for the card, then serves the viewer', {timeout: TIMEOUT}, async () => {
    const [agentPort, port, proxyPort, modelProxyPort] = await Promise.all([
      freePort(),
      freePort(),
      freePort(),
      freePort(),
    ]);
    const spectra = new SpectraProcess([
      'attach',
      `http://localhost:${agentPort}`,
      '--port',
      String(port),
      '--proxy-port',
      String(proxyPort),
      '--model-proxy-port',
      String(modelProxyPort),
      '--receiver-port',
      String(await freePort()),
      '--no-open',
      '--allow-host',
      'viewer.example',
    ]);
    await spectra.waitFor(
      new RegExp(
        `Waiting for the agent's card at http://localhost:${agentPort}/\\.well-known/agent-card\\.json: ` +
          "connection refused\\. The agent's URL is attach's <agent-url> argument, or agent\\.url in the config file\\.",
      ),
    );
    const agent = await startFakeAgent(agentPort);
    try {
      const [, shownPort] = await spectra.waitFor(viewerUrl);
      assert.equal(Number(shownPort), port);

      const index = await send(port);
      assert.equal(index.status, 200);
      assert.match(index.type ?? '', /^text\/html/);
      assert.match(index.body, /<div id="root"><\/div>/);

      const script = index.body.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
      assert.ok(script, "The viewer's page names its script.");
      const asset = await send(port, {path: script});
      assert.equal(asset.status, 200);
      assert.match(asset.type ?? '', /^text\/javascript/);

      const route = await send(port, {path: '/turns/some-turn'});
      assert.equal(route.status, 200);
      assert.equal(route.body, index.body);

      const foreign = await send(port, {headers: {host: 'evil.example'}});
      assert.equal(foreign.status, 403);
      const allowed = await send(port, {
        headers: {host: 'viewer.example:443'},
      });
      assert.equal(allowed.status, 200);

      const text = await send(port, {
        method: 'POST',
        headers: {'content-type': 'text/plain'},
        body: 'hello',
      });
      assert.equal(text.status, 415);
      const json = await send(port, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: '{}',
      });
      assert.equal(json.status, 404);

      // Spectra did not start this agent: it reports no process, and refuses Restart.
      const process = await send(port, {path: '/api/agent'});
      assert.equal(process.status, 404);
      assert.match(process.body, /Spectra did not start this agent/);
      const restart = await send(port, {
        method: 'POST',
        path: '/api/agent/restart',
        headers: {'content-type': 'application/json'},
        body: '{}',
      });
      assert.equal(restart.status, 404);
      assert.match(restart.body, /Spectra did not start this agent/);
      const logs = await send(port, {path: '/api/agent/logs'});
      assert.equal(logs.status, 404);
      assert.match(logs.body, /Spectra did not start this agent/);
      assert.doesNotMatch(spectra.output, /Starting the agent|The agent's card answered/);
      assert.doesNotMatch(spectra.output, /restarts the agent|Restart on save/);

      spectra.signal('SIGTERM');
      const exit = await spectra.exited;
      assert.equal(exit.code, 128 + 15);
    } finally {
      await closeServer(agent);
    }
  });

  it(
    'attach starts the wire proxy, which rewrites the card and relays the agent as it answers',
    {timeout: TIMEOUT},
    async () => {
      const [agentPort, port, proxyPort, modelProxyPort] = await Promise.all([
        freePort(),
        freePort(),
        freePort(),
        freePort(),
      ]);
      const agent = await startFakeAgent(agentPort);
      const spectra = new SpectraProcess([
        'attach',
        `http://localhost:${agentPort}`,
        '--port',
        String(port),
        '--proxy-port',
        String(proxyPort),
        '--model-proxy-port',
        String(modelProxyPort),
        '--receiver-port',
        String(await freePort()),
        '--no-open',
      ]);
      try {
        const [, shownPort] = await spectra.waitFor(proxyAddress);
        assert.equal(Number(shownPort), proxyPort);
        await spectra.waitFor(viewerUrl);

        const card = await send(proxyPort, {path: '/.well-known/agent-card.json'});
        assert.equal(card.status, 200);
        assert.equal(
          (JSON.parse(card.body) as {url: string}).url,
          `http://127.0.0.1:${proxyPort}/`,
        );

        const sent = await send(proxyPort, {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: jsonRpc('message/send'),
        });
        assert.equal(sent.body, SEND_REPLY);

        const streamed = await send(proxyPort, {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: jsonRpc('message/stream'),
        });
        assert.match(streamed.type ?? '', /^text\/event-stream/);
        assert.equal(streamed.body, STREAM_REPLY);

        const seen = await send(proxyPort, {
          path: '/headers',
          headers: {'x-a2a-extensions': 'https://a2ui.org/a2a-extension/a2ui/v0.9'},
        });
        const headers = JSON.parse(seen.body) as Record<string, string>;
        assert.equal(headers.host, `localhost:${agentPort}`);
        assert.equal(headers['x-a2a-extensions'], 'https://a2ui.org/a2a-extension/a2ui/v0.9');

        spectra.signal('SIGTERM');
        assert.equal((await spectra.exited).code, 128 + 15);
      } finally {
        await closeServer(agent);
      }
    },
  );

  it(
    'attach writes each turn through the proxy to the store, with its schema check',
    {timeout: TIMEOUT},
    async () => {
      const [agentPort, port, proxyPort, modelProxyPort] = await Promise.all([
        freePort(),
        freePort(),
        freePort(),
        freePort(),
      ]);
      const agent = await startFakeAgent(agentPort);
      const cwd = workingDir();
      const spectra = new SpectraProcess(
        [
          'attach',
          `http://localhost:${agentPort}`,
          '--port',
          String(port),
          '--proxy-port',
          String(proxyPort),
          '--model-proxy-port',
          String(modelProxyPort),
          '--receiver-port',
          String(await freePort()),
          '--no-open',
        ],
        cwd,
      );
      try {
        const [, turnsDir] = await spectra.waitFor(/Turns are saved in (.+)\n/);
        const store = path.join(realpathSync(cwd), '.a2ui-spectra');
        assert.equal(turnsDir, path.join(store, 'turns'));
        await spectra.waitFor(viewerUrl);

        for (const method of ['message/send', 'message/stream']) {
          const answer = await send(proxyPort, {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: jsonRpc(method),
          });
          assert.equal(answer.status, 200);
        }
        spectra.signal('SIGTERM');
        assert.equal((await spectra.exited).code, 128 + 15, spectra.output);

        assert.match(readFileSync(path.join(store, '.gitignore'), 'utf8'), /^\*$/m);
        const conversation = path.join(store, 'turns', 'ctx-1');
        const files = readdirSync(conversation).sort();
        assert.equal(files.length, 2, files.join(', '));
        for (const file of files) {
          assert.match(file, /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z_[0-9a-f]{32}\.json$/);
        }
        const [sent, streamed] = files.map(
          file => JSON.parse(readFileSync(path.join(conversation, file), 'utf8')) as TurnRecord,
        );
        assert.deepEqual(turnRecordErrors(sent), []);
        assert.deepEqual(turnRecordErrors(streamed), []);
        assert.equal(sent.turns.length, 1);
        assert.equal(streamed.turns.length, 2);
        assert.deepEqual(streamed.turns[0], sent.turns[0]);

        const checks = (record: TurnRecord) =>
          record.turns
            .at(-1)
            ?.events.filter((event): event is CheckEvent => isEventOfKind(event, 'check'));
        // The send's reply is text, and nothing in its turn names a protocol version.
        assert.deepEqual(checks(sent), []);
        const [check] = checks(streamed) ?? [];
        assert.equal(check?.attributes['a2ui.check.name'], 'schema');
        assert.equal(check.attributes['a2ui.check.passed'], true);
        assert.equal(check.attributes['a2ui.check.protocol_version'], 'v0.9');
      } finally {
        await closeServer(agent);
      }
    },
  );

  it(
    "attach prints the variables to set in the agent's shell, and serves them in the context",
    {timeout: TIMEOUT},
    async () => {
      const [agentPort, port, proxyPort, modelProxyPort] = await Promise.all([
        freePort(),
        freePort(),
        freePort(),
        freePort(),
      ]);
      const agent = await startFakeAgent(agentPort);
      const toolProxyPort = await freePort();
      const receiverPort = await freePort();
      const cwd = workingDir();
      writeFileSync(
        path.join(cwd, 'a2ui-spectra.json'),
        JSON.stringify({
          tools: [{variable: 'FLOOR_PLAN_SERVER_URL', url: 'http://127.0.0.1:8000/sse'}],
        }),
      );
      const spectra = new SpectraProcess(
        [
          'attach',
          `http://localhost:${agentPort}`,
          '--port',
          String(port),
          '--proxy-port',
          String(proxyPort),
          '--model-proxy-port',
          String(modelProxyPort),
          '--receiver-port',
          String(receiverPort),
          '--tool-proxy-port',
          String(toolProxyPort),
          '--no-open',
        ],
        cwd,
        {GEMINI_API_BASE: 'https://litellm.example/v1beta?key=secret'},
      );
      try {
        await spectra.waitFor(viewerUrl);
        await spectra.waitFor(
          /To see model and tool calls, set these in the agent's shell and restart it/,
        );
        await spectra.waitFor(/already sets one of the model or tool variables to another address/);
        assert.match(
          spectra.output,
          new RegExp(
            `^export GEMINI_API_BASE=.*\\n^export FLOOR_PLAN_SERVER_URL=http://127\\.0\\.0\\.1:${toolProxyPort}/sse  # forwards to http://127\\.0\\.0\\.1:8000/sse\\n` +
              `^export OTEL_EXPORTER_OTLP_ENDPOINT=http://127\\.0\\.0\\.1:${receiverPort}  # for Spectra's OpenTelemetry receiver\\n` +
              "^export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf  # for Spectra's OpenTelemetry receiver\\n" +
              "^export OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true  # for Spectra's OpenTelemetry receiver$",
            'm',
          ),
        );
        for (const name of VARIABLES) {
          assert.match(
            spectra.output,
            new RegExp(
              `^export ${name}=http://127\\.0\\.0\\.1:${modelProxyPort}/${name}  # forwards to `,
              'm',
            ),
          );
        }
        assert.match(
          spectra.output,
          /^export GEMINI_API_BASE=.*# forwards to https:\/\/litellm\.example\/v1beta\?key=REMOVED$/m,
        );
        assert.equal(spectra.output.includes('secret'), false);
        const context = JSON.parse((await send(port, {path: '/api/context'})).body) as {
          mode: string;
          variables?: unknown;
        };
        assert.equal(context.mode, 'attach');
        assert.deepEqual(context.variables, [
          ...VARIABLES.map(name => ({name, value: `http://127.0.0.1:${modelProxyPort}/${name}`})),
          {name: 'FLOOR_PLAN_SERVER_URL', value: `http://127.0.0.1:${toolProxyPort}/sse`},
          {name: 'OTEL_EXPORTER_OTLP_ENDPOINT', value: `http://127.0.0.1:${receiverPort}`},
          {name: 'OTEL_EXPORTER_OTLP_PROTOCOL', value: 'http/protobuf'},
          {name: 'OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT', value: 'true'},
        ]);
        spectra.signal('SIGTERM');
        assert.equal((await spectra.exited).code, 128 + 15);
      } finally {
        await closeServer(agent);
      }
    },
  );

  it(
    'reports a taken model proxy port and the option that changes it',
    {timeout: TIMEOUT},
    async () => {
      const [agentPort, port, proxyPort, modelProxyPort] = await Promise.all([
        freePort(),
        freePort(),
        freePort(),
        freePort(),
      ]);
      const agent = await startFakeAgent(agentPort);
      const holder = createServer();
      await new Promise<void>(resolve =>
        holder.listen(modelProxyPort, '127.0.0.1', () => resolve()),
      );
      try {
        const result = await finished([
          'attach',
          `http://localhost:${agentPort}`,
          '--port',
          String(port),
          '--proxy-port',
          String(proxyPort),
          '--model-proxy-port',
          String(modelProxyPort),
          '--receiver-port',
          String(await freePort()),
          '--no-open',
        ]);
        assert.equal(result.code, 1);
        assert.match(result.output, new RegExp(`Port ${modelProxyPort} is taken`));
        assert.match(result.output, /--model-proxy-port/);
      } finally {
        await closeServer(holder);
        await closeServer(agent);
      }
    },
  );

  it(
    'reports a taken receiver port and the option that changes it',
    {timeout: TIMEOUT},
    async () => {
      const [agentPort, port, proxyPort, modelProxyPort, receiverPort] = await Promise.all([
        freePort(),
        freePort(),
        freePort(),
        freePort(),
        freePort(),
      ]);
      const agent = await startFakeAgent(agentPort);
      const holder = createServer();
      await new Promise<void>(resolve => holder.listen(receiverPort, '127.0.0.1', () => resolve()));
      try {
        const result = await finished([
          'attach',
          `http://localhost:${agentPort}`,
          '--port',
          String(port),
          '--proxy-port',
          String(proxyPort),
          '--model-proxy-port',
          String(modelProxyPort),
          '--receiver-port',
          String(receiverPort),
          '--no-open',
        ]);
        assert.equal(result.code, 1);
        assert.match(
          result.output,
          new RegExp(
            `Port ${receiverPort} is taken\\. Choose another port with --receiver-port\\.`,
          ),
        );
      } finally {
        await closeServer(holder);
        await closeServer(agent);
      }
    },
  );

  it('stops at start when its store cannot be created', {timeout: TIMEOUT}, async () => {
    const cwd = workingDir();
    writeFileSync(path.join(cwd, '.a2ui-spectra'), 'not a directory');
    const result = await finished(['attach', 'http://localhost:9', '--no-open'], cwd);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /Spectra cannot create its store at .*\.a2ui-spectra: /);
    assert.doesNotMatch(result.output, /Waiting for the agent's card/);
  });

  it(
    'attach warns when the card prefers another transport to JSON-RPC, and keeps running',
    {timeout: TIMEOUT},
    async () => {
      const [agentPort, port, proxyPort, modelProxyPort] = await Promise.all([
        freePort(),
        freePort(),
        freePort(),
        freePort(),
      ]);
      const agent = await startFakeAgent(agentPort, {transports: ['GRPC', 'JSONRPC']});
      const spectra = new SpectraProcess([
        'attach',
        `http://localhost:${agentPort}`,
        '--port',
        String(port),
        '--proxy-port',
        String(proxyPort),
        '--model-proxy-port',
        String(modelProxyPort),
        '--receiver-port',
        String(await freePort()),
        '--no-open',
      ]);
      try {
        await spectra.waitFor(/card prefers GRPC/);
        await spectra.waitFor(viewerUrl);
        spectra.signal('SIGTERM');
        assert.equal((await spectra.exited).code, 128 + 15);
      } finally {
        await closeServer(agent);
      }
    },
  );

  it('attach stops when the card lists no interface at all', {timeout: TIMEOUT}, async () => {
    const [agentPort, port, proxyPort, modelProxyPort] = await Promise.all([
      freePort(),
      freePort(),
      freePort(),
      freePort(),
    ]);
    const agent = await startFakeAgent(agentPort, {transports: []});
    try {
      const result = await finished([
        'attach',
        `http://localhost:${agentPort}`,
        '--port',
        String(port),
        '--proxy-port',
        String(proxyPort),
        '--model-proxy-port',
        String(modelProxyPort),
        '--receiver-port',
        String(await freePort()),
        '--no-open',
      ]);
      assert.equal(result.code, 1, result.output);
      assert.match(result.output, /lists no interface/);
      assert.match(result.output, /supportedInterfaces/);
      assert.doesNotMatch(result.output, viewerUrl);
    } finally {
      await closeServer(agent);
    }
  });

  it('attach stops when the card lists no JSON-RPC interface', {timeout: TIMEOUT}, async () => {
    const [agentPort, port, proxyPort, modelProxyPort] = await Promise.all([
      freePort(),
      freePort(),
      freePort(),
      freePort(),
    ]);
    const agent = await startFakeAgent(agentPort, {transports: ['GRPC', 'HTTP+JSON']});
    try {
      const result = await finished([
        'attach',
        `http://localhost:${agentPort}`,
        '--port',
        String(port),
        '--proxy-port',
        String(proxyPort),
        '--model-proxy-port',
        String(modelProxyPort),
        '--receiver-port',
        String(await freePort()),
        '--no-open',
      ]);
      assert.equal(result.code, 1, result.output);
      assert.match(result.output, /lists no A2A JSON-RPC interface/);
      assert.match(result.output, /GRPC, HTTP\+JSON/);
      assert.doesNotMatch(result.output, viewerUrl);
    } finally {
      await closeServer(agent);
    }
  });

  it('reports a taken proxy port and the option that changes it', {timeout: TIMEOUT}, async () => {
    const [agentPort, port, proxyPort, modelProxyPort] = await Promise.all([
      freePort(),
      freePort(),
      freePort(),
      freePort(),
    ]);
    const agent = await startFakeAgent(agentPort);
    const holder = createServer();
    await new Promise<void>(resolve => holder.listen(proxyPort, '127.0.0.1', () => resolve()));
    try {
      const result = await finished([
        'attach',
        `http://localhost:${agentPort}`,
        '--port',
        String(port),
        '--proxy-port',
        String(proxyPort),
        '--model-proxy-port',
        String(modelProxyPort),
        '--receiver-port',
        String(await freePort()),
        '--no-open',
      ]);
      assert.equal(result.code, 1);
      assert.match(result.output, new RegExp(`Port ${proxyPort} is taken`));
      assert.match(result.output, /--proxy-port/);
    } finally {
      await closeServer(holder);
      await closeServer(agent);
    }
  });

  it('reports a taken port and the option that changes it', {timeout: TIMEOUT}, async () => {
    const [agentPort, port, proxyPort, modelProxyPort] = await Promise.all([
      freePort(),
      freePort(),
      freePort(),
      freePort(),
    ]);
    const agent = await startFakeAgent(agentPort);
    const holder = createServer();
    await new Promise<void>(resolve => holder.listen(port, '127.0.0.1', () => resolve()));
    try {
      const result = await finished([
        'attach',
        `http://localhost:${agentPort}`,
        '--port',
        String(port),
        '--proxy-port',
        String(proxyPort),
        '--model-proxy-port',
        String(modelProxyPort),
        '--receiver-port',
        String(await freePort()),
        '--no-open',
      ]);
      assert.equal(result.code, 1);
      assert.match(result.output, new RegExp(`Port ${port} is taken`));
      assert.match(result.output, /--port/);
    } finally {
      await closeServer(holder);
      await closeServer(agent);
    }
  });

  describe('replay and test before the agent is reached', () => {
    it('prints their help, and lists them in the tool help', {timeout: TIMEOUT}, async () => {
      const tool = await finished(['--help']);
      assert.match(
        tool.output,
        /replay <file> \[--model-live\] \[--agent-url <url>\] \[options\] \[-- <command> \[args\.\.\.\]\]/,
      );
      assert.match(
        tool.output,
        /test \[<folder>\] \[--agent-url <url>\] \[options\] \[-- <command> \[args\.\.\.\]\]/,
      );
      const replay = await finished(['replay', '--help']);
      assert.equal(replay.code, 0);
      assert.match(replay.output, /--model-live/);
      assert.doesNotMatch(replay.output, /--no-open|--allow-host|--port <n>/);
      const test = await finished(['test', '--help']);
      assert.equal(test.code, 0);
      assert.match(test.output, /fixtures/);
      assert.doesNotMatch(test.output, /--model-live/);
    });

    it(
      'exits 2 on a record file that is missing or is not a turn record',
      {timeout: TIMEOUT},
      async () => {
        const cwd = workingDir();
        const missing = await finished(['replay', 'missing.json'], cwd);
        assert.equal(missing.code, 2, missing.output);
        assert.match(missing.stderr, /a2ui-spectra: No file at missing\.json\./);
        assert.match(missing.stderr, /Run 'a2ui-spectra replay --help' for usage\./);
        assert.equal(missing.stdout, '');
        writeFileSync(path.join(cwd, 'notes.txt'), 'not json');
        const notRecord = await finished(['replay', 'notes.txt'], cwd);
        assert.equal(notRecord.code, 2, notRecord.output);
        assert.match(
          notRecord.stderr,
          /a2ui-spectra: notes\.txt does not read as a turn record: The file is not JSON/,
        );
      },
    );

    it(
      'exits 2 on a fixtures folder that is missing or holds no .json file',
      {timeout: TIMEOUT},
      async () => {
        const cwd = workingDir();
        const bare = await finished(['test'], cwd);
        assert.equal(bare.code, 2, bare.output);
        assert.match(bare.stderr, /a2ui-spectra: No folder at a2ui-spectra-fixtures\./);
        const given = await finished(['test', 'ci/fixtures'], cwd);
        assert.equal(given.code, 2, given.output);
        assert.match(given.stderr, /a2ui-spectra: No folder at ci\/fixtures\./);
        mkdirSync(path.join(cwd, 'empty'));
        writeFileSync(path.join(cwd, 'empty', 'readme.txt'), '');
        const empty = await finished(['test', 'empty'], cwd);
        assert.equal(empty.code, 2, empty.output);
        assert.match(empty.stderr, /a2ui-spectra: empty holds no \.json file\./);
        assert.equal(empty.stdout, '');
      },
    );

    it(
      'refuses the viewer options and asks for the agent as --agent-url',
      {timeout: TIMEOUT},
      async () => {
        const cwd = workingDir();
        writeFileSync(path.join(cwd, 'any.json'), '{}');
        const viewerOption = await finished(['replay', 'any.json', '--no-open'], cwd);
        assert.equal(viewerOption.code, 2, viewerOption.output);
        assert.match(viewerOption.stderr, /Unknown option '--no-open'/);
        mkdirSync(path.join(cwd, 'fixtures'));
        writeFileSync(path.join(cwd, 'fixtures', 'a.json'), '{}');
        const noAgent = await finished(['test', 'fixtures'], cwd);
        assert.equal(noAgent.code, 2, noAgent.output);
        assert.match(
          noAgent.stderr,
          /test needs the agent's URL: --agent-url, or agent\.url in a2ui-spectra\.json/,
        );
      },
    );
  });

  describe('run', () => {
    async function runArgs(agentArgs: string[]) {
      const [agentPort, port, proxyPort, modelProxyPort] = await Promise.all([
        freePort(),
        freePort(),
        freePort(),
        freePort(),
      ]);
      return [
        'run',
        '--agent-url',
        `http://localhost:${agentPort}`,
        '--port',
        String(port),
        '--proxy-port',
        String(proxyPort),
        '--model-proxy-port',
        String(modelProxyPort),
        '--receiver-port',
        String(await freePort()),
        '--no-open',
        '--',
        process.execPath,
        fakeAgentScript,
        '--port',
        String(agentPort),
        ...agentArgs,
      ];
    }

    it(
      "stops the agent's whole process group when Spectra stops",
      {
        timeout: TIMEOUT,
        skip: !posix,
      },
      async () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'spectra-test-'));
        try {
          const pidFile = path.join(dir, 'grandchild.pid');
          const spectra = new SpectraProcess(await runArgs(['--grandchild-pid-file', pidFile]));
          await spectra.waitFor(cardAnswered);
          const grandchild = Number(readFileSync(pidFile, 'utf8'));
          assert.ok(isAlive(grandchild));

          spectra.signal('SIGTERM');
          const exit = await spectra.exited;
          assert.equal(exit.code, 128 + 15, spectra.output);
          assert.ok(
            await eventually(() => !isAlive(grandchild)),
            "The agent's grandchild outlived Spectra.",
          );
        } finally {
          rmSync(dir, {recursive: true, force: true});
        }
      },
    );

    it('forces the agent on a second stop signal', {timeout: TIMEOUT}, async () => {
      const spectra = new SpectraProcess(await runArgs(['--ignore-sigterm']));
      await spectra.waitFor(cardAnswered);
      spectra.signal('SIGTERM');
      await spectra.waitFor(/Press Ctrl-C again to force it/);
      const forcedAt = Date.now();
      spectra.signal('SIGINT');
      const exit = await spectra.exited;
      // Spectra's exit code is its own, the first stop signal's.
      assert.equal(exit.code, 128 + 15, spectra.output);
      assert.match(spectra.output, /Forcing the agent's process to stop\./);
      assert.ok(Date.now() - forcedAt < 5000, 'The agent went at once, not after the grace.');
    });

    it(
      'does not load a .env file from its working directory',
      {
        timeout: TIMEOUT,
      },
      async () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'spectra-test-'));
        try {
          writeFileSync(path.join(dir, '.env'), 'SPECTRA_TEST_DOTENV=loaded\n');
          const args = await runArgs([]);
          const command = args.indexOf('--');
          const spectra = new SpectraProcess(
            [
              ...args.slice(0, command + 1),
              process.execPath,
              '-e',
              "process.stdout.write('dotenv=' + process.env.SPECTRA_TEST_DOTENV + '\\n'); process.exit(5)",
            ],
            dir,
          );
          await spectra.waitFor(/The agent's process exited with code 5/);
          assert.match(spectra.output, /dotenv=undefined/);
          spectra.signal('SIGTERM');
          assert.equal((await spectra.exited).code, 128 + 15, spectra.output);
        } finally {
          rmSync(dir, {recursive: true, force: true});
        }
      },
    );

    it(
      "sets the base-URL variables in the agent's environment, pointing at the model proxy, and lists none in the context",
      {timeout: TIMEOUT},
      async () => {
        const args = await runArgs([]);
        const command = args.indexOf('--');
        const modelProxyPort = args[args.indexOf('--model-proxy-port') + 1];
        const spectra = new SpectraProcess([
          ...args.slice(0, command + 1),
          process.execPath,
          '-e',
          "process.stdout.write('gemini=' + process.env.GEMINI_API_BASE + ' anthropic=' + process.env.ANTHROPIC_API_BASE + ' openai=' + process.env.OPENAI_BASE_URL + '\\n'); process.exit(6)",
        ]);
        await spectra.waitFor(/The agent's process exited with code 6/);
        assert.match(
          spectra.output,
          new RegExp(
            `gemini=http://127\\.0\\.0\\.1:${modelProxyPort}/GEMINI_API_BASE anthropic=http://127\\.0\\.0\\.1:${modelProxyPort}/ANTHROPIC_API_BASE openai=http://127\\.0\\.0\\.1:${modelProxyPort}/OPENAI_BASE_URL`,
          ),
        );
        assert.doesNotMatch(spectra.output, /set these in the agent's shell/);
        spectra.signal('SIGTERM');
        assert.equal((await spectra.exited).code, 128 + 15, spectra.output);
      },
    );

    it(
      'records a model call the agent makes during a turn, read in full, with the key removed',
      {timeout: TIMEOUT},
      async () => {
        const providerPort = await freePort();
        const provider = await startFakeProvider(providerPort);
        const cwd = workingDir();
        const spectra = new SpectraProcess(await runArgs(['--model-call']), cwd, {
          ANTHROPIC_BASE_URL: `http://127.0.0.1:${providerPort}`,
          SPECTRA_PROVIDER_STAND_IN: `http://127.0.0.1:${providerPort}`,
        });
        try {
          const [, shownPort] = await spectra.waitFor(viewerUrl);
          const port = Number(shownPort);
          const [, shownProxyPort] = await spectra.waitFor(proxyAddress);
          await spectra.waitFor(cardAnswered);
          const context = JSON.parse((await send(port, {path: '/api/context'})).body) as {
            mode: string;
            variables?: unknown;
          };
          assert.equal(context.mode, 'run');
          assert.equal(context.variables, undefined);

          const answer = await send(Number(shownProxyPort), {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: jsonRpc('message/send'),
          });
          assert.equal(answer.body, SEND_REPLY);
          assert.equal(provider.received.length, 1, 'the call reached the provider');
          assert.equal(
            provider.received[0]['x-api-key'],
            FAKE_PROVIDER_KEY,
            'the key is forwarded',
          );

          let traceId: string | undefined;
          const deadline = Date.now() + 10_000;
          while (traceId === undefined) {
            assert.ok(Date.now() < deadline, `No closed turn:\n${spectra.output}`);
            const listed = JSON.parse((await send(port, {path: '/api/turns'})).body) as {
              turns: Array<{traceId: string; open?: boolean}>;
            };
            traceId = listed.turns.find(turn => turn.open !== true)?.traceId;
            if (traceId === undefined) await new Promise(resolve => setTimeout(resolve, 50));
          }
          const served = await send(port, {path: `/api/turns/${traceId}`});
          assert.equal(served.status, 200, served.body);
          const record = JSON.parse(served.body) as TurnRecord;
          assert.deepEqual(turnRecordErrors(record), []);
          const turn = record.turns[record.turns.length - 1];
          const turnEvent = turn.events.find(event => isEventOfKind(event, 'turn'));
          assert.ok(turnEvent?.attributes['a2ui.event.kind'] === 'turn');
          assert.deepEqual(turnEvent.attributes['a2ui.turn.capture_paths'], [
            'wire',
            'model_proxy',
          ]);
          const call = turn.events.find((event): event is ModelCallEvent =>
            isEventOfKind(event, 'model_call'),
          );
          assert.ok(call, 'the turn holds its model call');
          assert.equal(call.parentSpanId, turnEvent.spanId);
          assert.equal(call.name, 'chat claude-fake-1');
          assert.equal(call.attributes['gen_ai.provider.name'], 'anthropic');
          assert.equal(call.attributes['gen_ai.response.id'], 'msg_fake_1');
          assert.equal(call.attributes['gen_ai.usage.input_tokens'], 12);
          assert.deepEqual(call.attributes['gen_ai.system_instructions'], [
            {type: 'text', content: 'You are a fake agent.'},
          ]);
          assert.deepEqual(call.attributes['http.request.header.x-api-key'], ['REMOVED']);
          assert.equal(call.attributes['url.full'], `http://127.0.0.1:${providerPort}/v1/messages`);
          assert.deepEqual(call.status, {code: 1});
          assert.equal(served.body.includes(FAKE_PROVIDER_KEY), false, 'no key in the record');

          spectra.signal('SIGTERM');
          assert.equal((await spectra.exited).code, 128 + 15, spectra.output);
          const store = path.join(realpathSync(cwd), '.a2ui-spectra', 'turns', 'ctx-1');
          const [file] = readdirSync(store);
          assert.equal(
            readFileSync(path.join(store, file), 'utf8').includes(FAKE_PROVIDER_KEY),
            false,
          );
        } finally {
          await closeServer(provider.server);
        }
      },
    );

    it(
      "records the agent's spans and logs through the receiver, placed by the turn's trace id, and amends the written turn",
      {timeout: TIMEOUT},
      async () => {
        const args = await runArgs(['--otel-export']);
        const receiverPort = args[args.indexOf('--receiver-port') + 1];
        const spectra = new SpectraProcess(args, workingDir(), {
          OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector.example:4318',
          OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: 'grpc',
        });
        try {
          const [, shownPort] = await spectra.waitFor(viewerUrl);
          const port = Number(shownPort);
          const [, shownProxyPort] = await spectra.waitFor(proxyAddress);
          await spectra.waitFor(cardAnswered);
          assert.match(
            spectra.output,
            /In the agent's environment, Spectra replaced OTEL_EXPORTER_OTLP_ENDPOINT from http:\/\/collector\.example:4318\/ and OTEL_EXPORTER_OTLP_TRACES_PROTOCOL from grpc, so that its exports reach Spectra's OpenTelemetry receiver\. They are not passed on\./,
          );
          await spectra.waitFor(
            new RegExp(`The OpenTelemetry receiver is at http://127\\.0\\.0\\.1:${receiverPort}`),
          );
          await send(Number(shownProxyPort), {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: jsonRpc('message/send'),
          });

          // The second span arrives after the turn is written, and amends it.
          let turn: TurnRecord['turns'][number] | undefined;
          const deadline = Date.now() + 10_000;
          while (
            turn === undefined ||
            turn.events.filter(event => event.name === 'after the reply').length === 0
          ) {
            assert.ok(Date.now() < deadline, `No amended turn:\n${spectra.output}`);
            await new Promise(resolve => setTimeout(resolve, 100));
            const listed = JSON.parse((await send(port, {path: '/api/turns'})).body) as {
              turns: Array<{traceId: string; open?: boolean}>;
            };
            const closed = listed.turns.find(item => item.open !== true);
            if (closed === undefined) continue;
            const served = await send(port, {path: `/api/turns/${closed.traceId}`});
            const record = JSON.parse(served.body) as TurnRecord;
            assert.deepEqual(turnRecordErrors(record), []);
            turn = record.turns[record.turns.length - 1];
          }
          const turnEvent = turn.events.find(event => isEventOfKind(event, 'turn'));
          assert.ok(turnEvent?.attributes['a2ui.event.kind'] === 'turn');
          assert.deepEqual(turnEvent.attributes['a2ui.turn.capture_paths'], [
            'wire',
            'model_proxy',
            'otel_receiver',
          ]);
          const server = turn.events.find(event => event.name === 'POST /');
          const later = turn.events.find(event => event.name === 'after the reply');
          assert.ok(server && later);
          assert.equal(server.traceId, turnEvent.traceId);
          assert.equal(server.parentSpanId, turnEvent.spanId);
          assert.equal(later.parentSpanId, server.spanId);
          assert.equal(server.attributes['a2ui.event.kind'], 'framework_span');
          assert.equal(server.attributes['otel.scope.name'], 'fake-agent');
          assert.deepEqual(server.attributes['a2ui.received.attributes'], {
            'otlp.protocol': 'http/protobuf',
            'otlp.capture': 'true',
          });
          assert.deepEqual(server.events, [
            {
              timeUnixNano: server.events?.[0].timeUnixNano,
              name: 'INFO',
              attributes: {
                'a2ui.received.log.body': 'answering',
                'a2ui.received.log.severity_text': 'INFO',
              },
            },
          ]);
        } finally {
          spectra.signal('SIGTERM');
          assert.equal((await spectra.exited).code, 128 + 15, spectra.output);
        }
      },
    );

    it(
      'records a tool call the agent makes through a configured tool server, with the token removed',
      {timeout: TIMEOUT},
      async () => {
        const toolPort = await freePort();
        const received: string[] = [];
        const toolServer = createServer((request, response) => {
          let body = '';
          request.setEncoding('utf8');
          request.on('data', (chunk: string) => (body += chunk));
          request.on('end', () => {
            received.push(String(request.headers.authorization));
            const message = JSON.parse(body) as {id: number};
            response.writeHead(200, {'content-type': 'application/json'});
            response.end(
              JSON.stringify({
                jsonrpc: '2.0',
                id: message.id,
                result: {content: [{type: 'text', text: 'Desk 4'}]},
              }),
            );
          });
        });
        await new Promise<void>(resolve =>
          toolServer.listen(toolPort, '127.0.0.1', () => resolve()),
        );
        const cwd = workingDir();
        writeFileSync(
          path.join(cwd, 'a2ui-spectra.json'),
          JSON.stringify({
            tools: [{variable: 'FAKE_TOOL_URL', url: `http://127.0.0.1:${toolPort}/mcp`}],
          }),
        );
        const toolProxyPort = await freePort();
        const args = await runArgs(['--tool-call']);
        const command = args.indexOf('--');
        const spectra = new SpectraProcess(
          [
            ...args.slice(0, command),
            '--tool-proxy-port',
            String(toolProxyPort),
            ...args.slice(command),
          ],
          cwd,
        );
        try {
          const [, shownPort] = await spectra.waitFor(viewerUrl);
          const port = Number(shownPort);
          const [, shownProxyPort] = await spectra.waitFor(proxyAddress);
          await spectra.waitFor(cardAnswered);
          await spectra.waitFor(
            new RegExp(
              `The tool proxy for FAKE_TOOL_URL is at http://127\\.0\\.0\\.1:${toolProxyPort}, forwarding to http://127\\.0\\.0\\.1:${toolPort}`,
            ),
          );
          const answer = await send(Number(shownProxyPort), {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: jsonRpc('message/send'),
          });
          assert.equal(answer.body, SEND_REPLY);
          assert.deepEqual(received, [`Bearer ${FAKE_TOOL_TOKEN}`], 'the token is forwarded');

          let traceId: string | undefined;
          const deadline = Date.now() + 10_000;
          while (traceId === undefined) {
            assert.ok(Date.now() < deadline, `No closed turn:\n${spectra.output}`);
            const listed = JSON.parse((await send(port, {path: '/api/turns'})).body) as {
              turns: Array<{traceId: string; open?: boolean}>;
            };
            traceId = listed.turns.find(turn => turn.open !== true)?.traceId;
            if (traceId === undefined) await new Promise(resolve => setTimeout(resolve, 50));
          }
          const served = await send(port, {path: `/api/turns/${traceId}`});
          assert.equal(served.status, 200, served.body);
          const record = JSON.parse(served.body) as TurnRecord;
          assert.deepEqual(turnRecordErrors(record), []);
          const turn = record.turns[record.turns.length - 1];
          const turnEvent = turn.events.find(event => isEventOfKind(event, 'turn'));
          assert.ok(turnEvent?.attributes['a2ui.event.kind'] === 'turn');
          assert.deepEqual(turnEvent.attributes['a2ui.turn.capture_paths'], [
            'wire',
            'model_proxy',
            'tool_proxy',
          ]);
          const call = turn.events.find((event): event is ToolCallEvent =>
            isEventOfKind(event, 'tool_call'),
          );
          assert.ok(call, 'the turn holds its tool call');
          assert.equal(call.parentSpanId, turnEvent.spanId);
          assert.equal(call.kind, 3);
          assert.equal(call.name, 'tools/call lookup');
          assert.equal(call.attributes['gen_ai.tool.name'], 'lookup');
          assert.deepEqual(call.attributes['gen_ai.tool.call.arguments'], {q: 'floor plan'});
          assert.deepEqual(call.attributes['gen_ai.tool.call.result'], {
            content: [{type: 'text', text: 'Desk 4'}],
          });
          assert.equal(call.attributes['mcp.protocol.version'], '2025-06-18');
          assert.deepEqual(call.attributes['http.request.header.authorization'], ['REMOVED']);
          assert.equal(call.attributes['url.full'], `http://127.0.0.1:${toolPort}/mcp`);
          assert.equal(served.body.includes(FAKE_TOOL_TOKEN), false, 'no token in the record');
          spectra.signal('SIGTERM');
          assert.equal((await spectra.exited).code, 128 + 15, spectra.output);
        } finally {
          await closeServer(toolServer);
        }
      },
    );

    describe("the agent's process", () => {
      /** Spectra under `run` with the fake agent as its command, or with the command given. */
      async function launch(
        agentArgs: string[],
        command?: string[],
        cwd?: string,
        env?: Record<string, string>,
      ) {
        const args = await runArgs(agentArgs);
        const cut = args.indexOf('--');
        const spectra = new SpectraProcess(
          command === undefined ? args : [...args.slice(0, cut + 1), ...command],
          cwd,
          env,
        );
        const number = (option: string) => Number(args[args.indexOf(option) + 1]);
        await spectra.waitFor(viewerUrl);
        return {
          spectra,
          base: `http://127.0.0.1:${number('--port')}`,
          port: number('--port'),
          proxyPort: number('--proxy-port'),
          agentPort: Number(new URL(args[args.indexOf('--agent-url') + 1]).port),
          /** The fake agent's command as launched, as the route and the terminal name it. */
          command: (command ?? args.slice(cut + 1)).join(' '),
        };
      }

      const agentOf = async (base: string) =>
        (await getJson<AgentSnapshot>(`${base}/api/agent`)).body;
      const boxOf = async (base: string) =>
        (await getJson<MessageBoxState>(`${base}/api/message-box`)).body;
      const press = (base: string) =>
        postJson<{accepted?: boolean}>(`${base}/api/agent/restart`, {});

      /** Resolves with the route's answer once the state is the one named, past the number given. */
      async function stateIs(base: string, state: string, after = 0): Promise<AgentSnapshot> {
        const deadline = Date.now() + 15_000;
        for (;;) {
          const agent = await agentOf(base);
          if (agent.state.state === state && agent.state.seq > after) return agent;
          assert.ok(
            Date.now() < deadline,
            `The agent's state is ${JSON.stringify(agent.state)}, not ${state}.`,
          );
          await new Promise(resolve => setTimeout(resolve, 25));
        }
      }

      /** The states the stream sent after the number given, in order. */
      const statesOn = (live: LiveStream, after = 0) =>
        live.events
          .filter(event => event.event === 'agent_state' && Number(event.data.seq) > after)
          .map(event => String(event.data.state));

      const count = (text: string, pattern: RegExp) => text.match(pattern)?.length ?? 0;
      const idle = [process.execPath, '-e', 'setInterval(() => {}, 1000)'];
      /** A command that stays up without listening, appending its process id to the file. */
      const idleWithPid = (pidFile: string) => [
        process.execPath,
        '-e',
        `require('node:fs').appendFileSync(${JSON.stringify(pidFile)}, process.pid + '\\n'); setInterval(() => {}, 1000)`,
      ];
      const pidsIn = (file: string) =>
        existsSync(file)
          ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(Number)
          : [];
      const tempDir = () => mkdtempSync(path.join(tmpdir(), 'spectra-test-'));

      async function stopped(spectra: SpectraProcess) {
        spectra.signal('SIGTERM');
        assert.equal((await spectra.exited).code, 128 + 15, spectra.output);
      }

      it(
        'serves the viewer and the wire proxy before the card answers, the state walking starting, waiting, running',
        {timeout: TIMEOUT},
        async () => {
          // The agent listens and leaves its card unanswered, so the first attempt stays open.
          let held = true;
          const {spectra, base, port, proxyPort, agentPort, command} = await launch([], idle);
          const agent = await startFakeAgent(agentPort, {holdCard: () => held});
          let live: LiveStream | undefined;
          try {
            await spectra.waitFor(
              new RegExp(`Starting the agent: ${command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\n`),
            );
            assert.ok(
              spectra.output.indexOf('The viewer is at') <
                spectra.output.indexOf('Starting the agent'),
              'The addresses print before the command starts.',
            );
            assert.deepEqual(await agentOf(base), {
              command,
              state: {state: 'starting', seq: 1},
              events: [],
            });
            live = new LiveStream(`${base}/api/stream`);
            await live.ready;
            assert.equal((await send(port)).status, 200, 'The viewer answers.');
            assert.equal(
              (await send(proxyPort, {path: '/headers'})).status,
              200,
              'The wire proxy forwards.',
            );
            assert.equal((await boxOf(base)).unavailable, "Can't send · the agent is starting");
            const before = (await getJson<SessionContext>(`${base}/api/context`)).body;
            assert.deepEqual(before, {
              agentUrl: `http://localhost:${agentPort}/`,
              mode: 'run',
              proxyAddress: `http://127.0.0.1:${proxyPort}/`,
              previewPages: [],
              fixturesFolder: 'a2ui-spectra-fixtures',
            });

            const waiting = await live.until(event => event.event === 'agent_state');
            assert.deepEqual(waiting.data, {
              state: 'waiting',
              reason: 'no answer within 2 seconds',
              seq: 2,
            });
            assert.deepEqual((await agentOf(base)).state, waiting.data);
            assert.match(
              spectra.output,
              /Waiting for the agent's card at .*: no answer within 2 seconds\. Change the agent's URL with --agent-url, or agent\.url in the config file\./,
            );
            const waitingLine = "Can't send · waiting for the agent's card";
            assert.equal((await boxOf(base)).unavailable, waitingLine);
            const refused = await postJson<{error: string}>(`${base}/api/message-box/messages`, {
              text: 'Hi',
            });
            assert.deepEqual(refused, {status: 422, body: {error: waitingLine}});

            held = false;
            const running = await live.until(
              event => event.event === 'agent_state' && event.data.state === 'running',
            );
            assert.deepEqual(running.data, {state: 'running', seq: 3});
            // On the state's event the context and the box are current.
            const context = (await getJson<SessionContext>(`${base}/api/context`)).body;
            assert.deepEqual(context, {
              ...before,
              agentName: 'Fake agent',
              a2aVersions: [],
              a2uiExtensions: [],
              examples: [],
            });
            assert.equal((await boxOf(base)).unavailable, undefined);
            assert.deepEqual(statesOn(live), ['waiting', 'running']);
            await spectra.waitFor(cardAnswered);
            await stopped(spectra);
          } finally {
            live?.close();
            await closeServer(agent);
          }
        },
      );

      it(
        'stops on a taken viewer or wire proxy port before the command has started',
        {timeout: TIMEOUT},
        async () => {
          const dir = tempDir();
          try {
            for (const option of ['--port', '--proxy-port']) {
              const marker = path.join(dir, `started${option}`);
              const args = await runArgs([]);
              const cut = args.indexOf('--');
              const taken = Number(args[args.indexOf(option) + 1]);
              const holder = createServer();
              await new Promise<void>(resolve =>
                holder.listen(taken, '127.0.0.1', () => resolve()),
              );
              try {
                const result = await finished([
                  ...args.slice(0, cut + 1),
                  process.execPath,
                  '-e',
                  `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started'); setInterval(() => {}, 1000)`,
                ]);
                assert.equal(result.code, 1, result.output);
                assert.match(
                  result.output,
                  new RegExp(`Port ${taken} is taken\\. Choose another port with ${option}\\.`),
                );
                assert.doesNotMatch(result.output, /Starting the agent/);
                assert.equal(existsSync(marker), false, 'The command never started.');
              } finally {
                await closeServer(holder);
              }
            }
          } finally {
            rmSync(dir, {recursive: true, force: true});
          }
        },
      );

      it(
        'keeps serving when the agent exits on its own, before its card and after it, down with the exit line',
        {timeout: TIMEOUT},
        async () => {
          const early = await launch([], [process.execPath, '-e', 'process.exit(3)']);
          await early.spectra.waitFor(
            /The agent's process exited with code 3 before its card answered\. Restart it from the viewer\./,
          );
          const down = await stateIs(early.base, 'down');
          assert.equal(down.state.state === 'down' && down.state.exit, 'exited with code 3');
          assert.equal(down.events.length, 1);
          const [exited] = down.events;
          assert.ok(exited.type === 'agent_exited');
          assert.equal(exited.exit, 'exited with code 3');
          assert.match(exited.time, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
          assert.ok(
            exited.seq < down.state.seq,
            'The exit is numbered before the state it led to.',
          );
          assert.equal((await send(early.port)).status, 200, 'Spectra keeps serving.');
          assert.equal((await boxOf(early.base)).unavailable, "Can't send · the agent is down");
          early.spectra.signal('SIGTERM');
          assert.equal((await early.spectra.exited).code, 128 + 15, early.spectra.output);
          assert.match(early.spectra.output, /a2ui-spectra: Stopping\.\n/);

          const late = await launch(['--exit-after-card', '4']);
          await late.spectra.waitFor(cardAnswered);
          await late.spectra.waitFor(
            /The agent's process exited with code 4\. Restart it from the viewer\./,
          );
          const after = await stateIs(late.base, 'down');
          assert.equal(after.state.state === 'down' && after.state.exit, 'exited with code 4');
          assert.deepEqual(
            after.events.map(event => event.type),
            ['agent_exited'],
          );
          const context = (await getJson<SessionContext>(`${late.base}/api/context`)).body;
          assert.equal(context.agentName, 'Fake agent', "The last card's details are kept.");
          await stopped(late.spectra);
        },
      );

      it(
        'keeps serving when the command cannot start, down with its could-not-start line',
        {timeout: TIMEOUT},
        async () => {
          const {spectra, base} = await launch([], ['a2ui-spectra-test-no-such-command']);
          await spectra.waitFor(
            /The agent's process could not start: .+\. Restart it from the viewer\./,
          );
          const down = await stateIs(base, 'down');
          assert.match(down.state.state === 'down' ? down.state.exit : '', /^could not start: /);
          assert.doesNotMatch(spectra.output, /before its card answered/);
          await stopped(spectra);
        },
      );

      it(
        'stops a member of the group that outlives the command, then reports down',
        {timeout: TIMEOUT, skip: !posix},
        async () => {
          const dir = tempDir();
          try {
            const pidFile = path.join(dir, 'grandchild.pid');
            const {spectra, base} = await launch([
              '--grandchild-pid-file',
              pidFile,
              '--exit-after-card',
              '0',
            ]);
            await spectra.waitFor(cardAnswered);
            const grandchild = Number(readFileSync(pidFile, 'utf8'));
            await stateIs(base, 'down');
            assert.equal(isAlive(grandchild), false, 'Down means nothing of the group is running.');
            await spectra.waitFor(
              /The agent's process exited with code 0\. Restart it from the viewer\./,
            );
            await stopped(spectra);
          } finally {
            rmSync(dir, {recursive: true, force: true});
          }
        },
      );

      it(
        'restarts with a streaming turn open: the turn fails as a broken connection, the process is gone well inside the grace, and the state walks restarting, waiting, running',
        {timeout: TIMEOUT},
        async () => {
          const dir = tempDir();
          const hold = path.join(dir, 'hold');
          const pidFile = path.join(dir, 'agent.pid');
          writeFileSync(hold, '');
          // The agent waits for its open requests on the stop signal, as uvicorn does.
          const {spectra, base} = await launch([
            '--streaming',
            '--wait-for-open-requests',
            '--hold-stream-while-file',
            hold,
            '--pid-file',
            pidFile,
          ]);
          const live = new LiveStream(`${base}/api/stream`);
          try {
            await spectra.waitFor(cardAnswered);
            const before = await stateIs(base, 'running');
            const sent = await sendMessage(base, 'Hi');
            await live.until(
              event =>
                event.event === 'wire_event' &&
                event.data.traceId === sent.traceId &&
                JSON.stringify(event.data).includes('wire_output'),
            );

            const pressedAt = Date.now();
            assert.deepEqual(await press(base), {status: 202, body: {accepted: true}});
            const turn = await live.closed(sent.traceId);
            const turnEvent = turn.events.find(event => isEventOfKind(event, 'turn'));
            assert.equal(turnEvent?.attributes['a2ui.turn.outcome'], 'failed');
            assert.deepEqual(turnEvent?.status, {
              code: 2,
              message: 'The connection to the agent broke before the reply ended.',
            });
            // Nothing of the agent's process is in the record: only what the wire saw.
            assert.deepEqual(
              turn.events.map(event => event.attributes['a2ui.event.kind']),
              ['turn', 'wire_input', 'wire_output', 'check', 'check', 'check', 'check'],
            );

            await live.until(
              event =>
                event.event === 'agent_state' &&
                event.data.state === 'starting' &&
                Number(event.data.seq) > before.state.seq,
            );
            assert.ok(
              Date.now() - pressedAt < 5000,
              'The cut ended the wait for the open stream: the process went well inside the 10 seconds.',
            );
            const after = await stateIs(base, 'running', before.state.seq);
            assert.deepEqual(statesOn(live, before.state.seq), [
              'restarting',
              'starting',
              'waiting',
              'running',
            ]);
            const [first, second] = pidsIn(pidFile);
            assert.ok(first !== undefined && second !== undefined && first !== second);
            assert.equal(isAlive(first), false);
            assert.ok(isAlive(second));

            assert.equal(after.events.length, 1);
            const [restarted] = after.events;
            assert.ok(restarted.type === 'agent_restarted');
            assert.deepEqual(restarted.cause, {kind: 'press'});
            assert.ok(restarted.seq > before.state.seq && restarted.seq < after.state.seq);
            assert.deepEqual(
              live.events
                .filter(event => event.event === 'agent_restarted')
                .map(event => event.data),
              [restarted].map(({type: _type, ...data}) => data),
            );
            assert.match(
              spectra.output,
              /Restarting the agent: Restart was pressed in the viewer\./,
            );
            assert.equal(count(spectra.output, /Starting the agent: /g), 2);
            assert.equal(count(spectra.output, /The agent's card answered: Fake agent\./g), 2);
            // The second wait says no hint, a card having answered once.
            const waits = spectra.output.match(/Waiting for the agent's card at [^\n]*\n/g) ?? [];
            assert.ok(waits.length >= 1);
            assert.doesNotMatch(waits.at(-1) ?? '', /Change the agent's URL/);
            assert.doesNotMatch(spectra.output, /Restart it from the viewer|force-killed/);
            await stopped(spectra);
          } finally {
            live.close();
            rmSync(dir, {recursive: true, force: true});
          }
        },
      );

      it(
        'takes a press in the other states: down it spawns, during a card wait it stops the starting process and starts another, and during the stop it adds nothing',
        {timeout: TIMEOUT},
        async () => {
          const dir = tempDir();
          try {
            // Down: the press spawns.
            const down = await launch(['--exit-after-card', '4']);
            const first = await stateIs(down.base, 'down');
            assert.equal((await press(down.base)).status, 202);
            const again = await stateIs(down.base, 'down', first.state.seq);
            assert.deepEqual(
              again.events.map(event => event.type),
              ['agent_exited', 'agent_restarted', 'agent_exited'],
            );
            assert.equal(count(down.spectra.output, /Starting the agent: /g), 2);
            await stopped(down.spectra);

            // A card wait: the starting process is stopped and the command spawned again.
            const waitPids = path.join(dir, 'wait.pid');
            const waiting = await launch([], idleWithPid(waitPids));
            const live = new LiveStream(`${waiting.base}/api/stream`);
            try {
              const wait = await stateIs(waiting.base, 'waiting');
              assert.equal(
                wait.state.state === 'waiting' && wait.state.reason,
                'connection refused',
              );
              // The starting process is up once it has written its process id.
              assert.ok(await eventually(() => pidsIn(waitPids).length === 1));
              assert.equal((await press(waiting.base)).status, 202);
              const second = await stateIs(waiting.base, 'waiting', wait.state.seq);
              assert.deepEqual(statesOn(live, wait.state.seq), [
                'restarting',
                'starting',
                'waiting',
              ]);
              assert.deepEqual(
                second.events.map(event => event.type),
                ['agent_restarted'],
              );
              assert.ok(await eventually(() => pidsIn(waitPids).length === 2));
              const [stoppedPid, startedPid] = pidsIn(waitPids);
              assert.equal(isAlive(stoppedPid), false);
              assert.ok(isAlive(startedPid));
            } finally {
              live.close();
            }
            await stopped(waiting.spectra);

            // Restarting: a press during the stop adds nothing, and none is queued behind it.
            const stopPids = path.join(dir, 'stop.pid');
            const slow = await launch(['--stop-delay', '1500', '--pid-file', stopPids]);
            const running = await stateIs(slow.base, 'running');
            assert.equal((await press(slow.base)).status, 202);
            await stateIs(slow.base, 'restarting', running.state.seq);
            assert.equal((await press(slow.base)).status, 202);
            assert.equal((await press(slow.base)).status, 202);
            const back = await stateIs(slow.base, 'running', running.state.seq);
            await new Promise(resolve => setTimeout(resolve, 500));
            const settled = await agentOf(slow.base);
            assert.deepEqual(settled.state, back.state, 'No second restart followed.');
            assert.deepEqual(
              settled.events.map(event => event.type),
              ['agent_restarted'],
            );
            assert.equal(pidsIn(stopPids).length, 2);
            assert.equal(count(slow.spectra.output, /Starting the agent: /g), 2);
            assert.equal(count(slow.spectra.output, /Restarting the agent: /g), 1);
            await stopped(slow.spectra);
          } finally {
            rmSync(dir, {recursive: true, force: true});
          }
        },
      );

      it(
        "follows a card that changed between launches: the context, the box's choice of send or stream, and the agent's name on new turns",
        {timeout: TIMEOUT},
        async () => {
          const dir = tempDir();
          const cardFile = path.join(dir, 'card.json');
          const {spectra, base, proxyPort} = await launch(['--card-file', cardFile]);
          const methods = async () =>
            (
              JSON.parse((await send(proxyPort, {path: '/requests'})).body) as Array<{
                method: string;
              }>
            ).map(request => request.method);
          const listed = async (traceId: string) =>
            (await getJson<{turns: ListedTurn[]}>(`${base}/api/turns`)).body.turns.find(
              turn => turn.traceId === traceId,
            );
          try {
            await spectra.waitFor(cardAnswered);
            const first = await stateIs(base, 'running');
            const sent = await sendMessage(base, 'Hi');
            await boxSettled(base);
            assert.deepEqual(await methods(), ['message/send']);
            assert.equal((await listed(sent.traceId))?.agentName, 'Fake agent');

            writeFileSync(cardFile, JSON.stringify({name: 'Second agent', streaming: true}));
            assert.equal((await press(base)).status, 202);
            await stateIs(base, 'running', first.state.seq);
            await spectra.waitFor(/The agent's card answered: Second agent\./);
            const context = (await getJson<SessionContext>(`${base}/api/context`)).body;
            assert.equal(context.agentName, 'Second agent');
            const streamed = await sendMessage(base, 'Hi again');
            await boxSettled(base);
            assert.deepEqual(await methods(), ['message/stream'], 'The new process got a stream.');
            const turn = await listed(streamed.traceId);
            assert.equal(turn?.agentName, 'Second agent');
            assert.equal(turn?.outcome, 'waiting_for_input');
            assert.equal((await listed(sent.traceId))?.agentName, 'Fake agent');
            await stopped(spectra);
          } finally {
            rmSync(dir, {recursive: true, force: true});
          }
        },
      );

      it(
        'carries on when a card fails the transport check after a restart, the box refusing with its line until a restart with a good card',
        {timeout: TIMEOUT},
        async () => {
          const dir = tempDir();
          const cardFile = path.join(dir, 'card.json');
          const {spectra, base} = await launch(['--card-file', cardFile]);
          try {
            await spectra.waitFor(cardAnswered);
            const first = await stateIs(base, 'running');
            assert.equal((await boxOf(base)).unavailable, undefined);

            writeFileSync(cardFile, JSON.stringify({transports: ['GRPC']}));
            assert.equal((await press(base)).status, 202);
            const second = await stateIs(base, 'running', first.state.seq);
            await spectra.waitFor(
              /The agent's card lists no A2A JSON-RPC interface, only GRPC\. Spectra captures A2A over JSON-RPC only\./,
            );
            const line = "Can't send · the agent's card lists no A2A JSON-RPC interface, only GRPC";
            assert.equal((await boxOf(base)).unavailable, line);
            assert.deepEqual(
              await postJson<{error: string}>(`${base}/api/message-box/messages`, {text: 'Hi'}),
              {status: 422, body: {error: line}},
            );

            writeFileSync(cardFile, JSON.stringify({transports: []}));
            assert.equal((await press(base)).status, 202);
            const third = await stateIs(base, 'running', second.state.seq);
            await spectra.waitFor(/The agent's card lists no interface to reach it at\./);
            assert.equal(
              (await boxOf(base)).unavailable,
              "Can't send · the agent's card lists no interface to reach it at",
            );

            writeFileSync(cardFile, JSON.stringify({}));
            assert.equal((await press(base)).status, 202);
            await stateIs(base, 'running', third.state.seq);
            assert.equal((await boxOf(base)).unavailable, undefined);
            await sendMessage(base, 'Hi');
            await boxSettled(base);
            await stopped(spectra);
          } finally {
            rmSync(dir, {recursive: true, force: true});
          }
        },
      );

      it(
        'sends the conversation id and no task id after a restart, for a conversation that was waiting for input',
        {timeout: TIMEOUT},
        async () => {
          const {spectra, base, proxyPort} = await launch(['--streaming']);
          const messages = async () =>
            (
              JSON.parse((await send(proxyPort, {path: '/requests'})).body) as Array<{
                params: {message: {contextId?: string; taskId?: string}};
              }>
            ).map(({params}) => ({
              contextId: params.message.contextId,
              taskId: params.message.taskId,
            }));
          await spectra.waitFor(cardAnswered);
          const first = await stateIs(base, 'running');
          await sendMessage(base, 'Hi');
          await boxSettled(base);
          await sendMessage(base, 'Ada', 'ctx-1');
          await boxSettled(base);
          assert.deepEqual(await messages(), [
            {contextId: undefined, taskId: undefined},
            {contextId: 'ctx-1', taskId: 't-1'},
          ]);

          assert.equal((await press(base)).status, 202);
          await stateIs(base, 'running', first.state.seq);
          const box = await boxOf(base);
          assert.deepEqual(
            box.conversations.map(conversation => conversation.conversationId),
            ['ctx-1'],
            'The box keeps its conversation.',
          );
          await sendMessage(base, 'Again', 'ctx-1');
          await boxSettled(base);
          assert.deepEqual(await messages(), [{contextId: 'ctx-1', taskId: undefined}]);
          await stopped(spectra);
        },
      );

      it(
        'stops a replay running at a restart, its remaining turns not sent with "The agent was restarted."',
        {timeout: TIMEOUT},
        async () => {
          const dir = tempDir();
          const hold = path.join(dir, 'hold');
          const {spectra, base} = await launch(['--streaming', '--hold-stream-while-file', hold]);
          const live = new LiveStream(`${base}/api/stream`);
          try {
            await spectra.waitFor(cardAnswered);
            const first = await stateIs(base, 'running');
            await sendMessage(base, 'Hi');
            await boxSettled(base);
            const second = await sendMessage(base, 'Ada', 'ctx-1');
            await boxSettled(base);

            // The replay's first turn stays open until the restart cuts it.
            writeFileSync(hold, '');
            const started = await postJson<ReplayStarted>(`${base}/api/replays`, {
              source: {traceId: second.traceId},
              mode: 'model_live',
            });
            assert.equal(started.status, 202, JSON.stringify(started.body));
            assert.equal(started.body.turns, 2);
            assert.equal((await press(base)).status, 202);
            const ended = await live.until(event => event.event === 'replay_ended');
            const turns = ended.data.turns as Array<Record<string, unknown>>;
            assert.equal(turns.length, 2);
            assert.equal(turns[0].traceId, started.body.traceId);
            assert.equal(turns[0].verdict, 'failed');
            assert.equal(turns[1].notSent, 'The agent was restarted.');
            assert.equal(turns[1].traceId, undefined);
            assert.equal(ended.data.verdict, 'failed');
            rmSync(hold);
            await stateIs(base, 'running', first.state.seq);
            assert.equal((await boxOf(base)).replay, undefined);
            await stopped(spectra);
          } finally {
            live.close();
            rmSync(dir, {recursive: true, force: true});
          }
        },
      );

      const logsOf = async (base: string) =>
        (await getJson<LogSnapshot>(`${base}/api/agent/logs`)).body;
      /** The route's entries as short words: a line's text, or a divider's kind. */
      const words = (entries: LogEntry[]) =>
        entries.map(entry => (entry.type === 'line' ? entry.text : entry.type));
      /** Resolves with the route's answer once it holds what the check asks for. */
      async function logsHold(
        base: string,
        check: (logs: LogSnapshot) => boolean,
      ): Promise<LogSnapshot> {
        const deadline = Date.now() + 15_000;
        for (;;) {
          const logs = await logsOf(base);
          if (check(logs)) return logs;
          assert.ok(Date.now() < deadline, `The logs hold ${JSON.stringify(words(logs.entries))}.`);
          await new Promise(resolve => setTimeout(resolve, 25));
        }
      }
      /** A command that writes what the script says once the file exists, and stays up. */
      const onFile = (file: string, before: string, script: string) => [
        process.execPath,
        '-e',
        `const fs = require('node:fs'); ${before}; ` +
          `const wait = setInterval(() => { if (!fs.existsSync(${JSON.stringify(file)})) return; ` +
          `clearInterval(wait); ${script}; }, 20); setInterval(() => {}, 1000)`,
      ];
      /**
       * Saves the file until Spectra says what the pattern asks for. A watch
       * reports nothing for a moment after it is set up, with no sign of when
       * it begins, so no single save rests on how fast the machine is.
       */
      async function savedUntil(spectra: SpectraProcess, file: string, pattern: RegExp) {
        const deadline = Date.now() + 15_000;
        for (let attempt = 1; ; attempt++) {
          writeFileSync(file, `saved ${attempt}\n`);
          try {
            await spectra.waitFor(pattern, 1000);
            return;
          } catch (error) {
            if (Date.now() > deadline) throw error;
          }
        }
      }
      /** The session's restarts a save caused, by the file each names. */
      const savedFiles = (agent: AgentSnapshot) =>
        agent.events.flatMap(event =>
          event.type === 'agent_restarted' && event.cause.kind === 'save' ? [event.cause.file] : [],
        );

      it(
        "echoes the agent's output byte for byte on the stream it was written to, and keeps it as numbered entries on the route and the stream",
        {timeout: TIMEOUT},
        async () => {
          const dir = tempDir();
          const go = path.join(dir, 'go');
          const {spectra, base, command} = await launch(
            [],
            onFile(
              go,
              "process.stdout.write('first\\n')",
              "process.stdout.write('out \\u001b[32mone\\u001b[0m\\r\\nout two\\n'); process.stderr.write('err one\\n')",
            ),
          );
          const live = new LiveStream(`${base}/api/stream`);
          try {
            await live.ready;
            const before = await logsHold(base, logs => logs.entries.length === 2);
            assert.deepEqual(before, {
              entries: [
                {n: 1, type: 'started', time: before.entries[0].time, command},
                {n: 2, type: 'line', time: before.entries[1].time, stream: 'stdout', text: 'first'},
              ],
              lines: 1,
              cap: 1000,
            });
            assert.match(before.entries[0].time, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

            writeFileSync(go, '');
            const after = await logsHold(base, logs => logs.lines === 4);
            const texts = (stream: string) =>
              after.entries.flatMap(entry =>
                entry.type === 'line' && entry.stream === stream ? [entry.text] : [],
              );
            assert.deepEqual(texts('stdout'), ['first', 'out \u001b[32mone\u001b[0m', 'out two']);
            assert.deepEqual(texts('stderr'), ['err one']);
            assert.deepEqual(
              after.entries.map(entry => entry.n),
              [1, 2, 3, 4, 5],
            );
            assert.ok(
              after.entries.every(
                (entry, index, all) => index === 0 || all[index - 1].time <= entry.time,
              ),
              'The times never go backwards.',
            );

            // The terminal carries each chunk as written, on its own stream, without Spectra's prefix.
            assert.ok(spectra.stdout.includes('first\n'));
            assert.ok(spectra.stdout.includes('out \u001b[32mone\u001b[0m\r\nout two\n'));
            assert.ok(spectra.stderr.includes('err one\n'));
            assert.equal(spectra.stderr.includes('out two'), false);
            // The command's own text, which names the line, is on stdout in "Starting the agent".
            assert.equal(spectra.stdout.includes('\nerr one\n'), false);
            assert.doesNotMatch(spectra.output, /a2ui-spectra: (first|out|err one)/);

            // What the stream sent after the first read merges with it by number.
            await live.until(
              event =>
                event.event === 'agent_log' &&
                (event.data.entries as LogEntry[]).some(entry => entry.n === 5),
            );
            const sent = live.events
              .filter(event => event.event === 'agent_log')
              .map(event => event.data as unknown as {entries: LogEntry[]; oldest: number});
            assert.ok(sent.every(event => event.oldest === 1));
            const merged = [
              ...before.entries,
              ...sent.flatMap(event => event.entries).filter(entry => entry.n > 2),
            ];
            assert.deepEqual(merged, after.entries);
            // The two lines of one write travel in one event.
            const one = sent.find(event => event.entries.some(entry => entry.n === 3));
            assert.ok(
              one?.entries.some(entry => entry.type === 'line' && entry.text === 'out two'),
            );
            await stopped(spectra);
          } finally {
            live.close();
            rmSync(dir, {recursive: true, force: true});
          }
        },
      );

      it(
        'shows an unfinished line in the terminal at once and enters it at its newline, or as a last line when the process ends',
        {timeout: TIMEOUT},
        async () => {
          const dir = tempDir();
          const go = path.join(dir, 'go');
          try {
            const {spectra, base} = await launch(
              [],
              onFile(
                go,
                "process.stdout.write('half')",
                "process.stdout.write(' whole\\n'); process.stderr.write('last words'); process.exit(0)",
              ),
            );
            await spectra.waitFor(/half/);
            assert.deepEqual(words((await logsOf(base)).entries), ['started']);
            writeFileSync(go, '');
            await stateIs(base, 'down');
            const logs = await logsHold(base, held => held.entries.at(-1)?.type === 'stopped');
            assert.deepEqual(words(logs.entries), [
              'started',
              'half whole',
              'last words',
              'stopped',
            ]);
            const last = logs.entries.at(-1);
            // An exit the agent took on its own carries no cause.
            assert.deepEqual(last, {
              n: 4,
              type: 'stopped',
              time: last?.time,
              exit: 'exited with code 0',
            });
            assert.ok(spectra.stderr.includes('last words'));
            await stopped(spectra);
          } finally {
            rmSync(dir, {recursive: true, force: true});
          }
        },
      );

      it(
        'writes a stopped divider with the press and the exit line, then a started one, at a restart, and a started then a stopped one for a command that cannot start',
        {timeout: TIMEOUT},
        async () => {
          const {spectra, base, command} = await launch([]);
          const first = await stateIs(base, 'running');
          await press(base);
          await stateIs(base, 'running', first.state.seq);
          const logs = await logsHold(
            base,
            held => held.entries.filter(entry => entry.type === 'started').length === 2,
          );
          const dividers = logs.entries.filter(entry => entry.type !== 'line');
          assert.deepEqual(dividers, [
            {n: 1, type: 'started', time: dividers[0].time, command},
            {
              n: dividers[1].n,
              type: 'stopped',
              time: dividers[1].time,
              exit: posix
                ? 'was ended by SIGTERM'
                : dividers[1].type === 'stopped' && dividers[1].exit,
              cause: {kind: 'press'},
            },
            {n: dividers[1].n + 1, type: 'started', time: dividers[2].time, command},
          ]);
          await stopped(spectra);

          const missing = await launch([], ['a2ui-spectra-test-no-such-command']);
          await stateIs(missing.base, 'down');
          const none = await logsHold(missing.base, held => held.entries.length === 2);
          assert.deepEqual(words(none.entries), ['started', 'stopped']);
          const [, could] = none.entries;
          assert.ok(could.type === 'stopped');
          assert.match(could.exit, /^could not start: /);
          assert.equal(could.cause, undefined);
          await stopped(missing.spectra);
        },
      );

      it(
        "keeps the last 1,000 lines, the route's count and the event's oldest number following",
        {timeout: TIMEOUT},
        async () => {
          const dir = tempDir();
          const go = path.join(dir, 'go');
          const {spectra, base} = await launch(
            [],
            onFile(
              go,
              '',
              "process.stdout.write(Array.from({length: 1005}, (_, i) => 'line ' + (i + 1)).join('\\n') + '\\n')",
            ),
          );
          const live = new LiveStream(`${base}/api/stream`);
          try {
            await live.ready;
            writeFileSync(go, '');
            const logs = await logsHold(base, held => words(held.entries).at(-1) === 'line 1005');
            assert.equal(logs.lines, 1000);
            assert.equal(logs.entries.length, 1000);
            // The started divider left with the lines before it; the first line was the second entry.
            assert.deepEqual([logs.entries[0].n, words(logs.entries)[0]], [7, 'line 6']);
            const last = await live.until(
              event =>
                event.event === 'agent_log' &&
                (event.data.entries as LogEntry[]).some(entry => entry.n === 1006),
            );
            assert.equal(last.data.oldest, 7);
            await stopped(spectra);
          } finally {
            live.close();
            rmSync(dir, {recursive: true, force: true});
          }
        },
      );

      it(
        "sets PYTHONUNBUFFERED in the agent's environment, and keeps a value Spectra's own environment sets",
        {timeout: TIMEOUT},
        async () => {
          const show = [
            process.execPath,
            '-e',
            "process.stdout.write('unbuffered=' + process.env.PYTHONUNBUFFERED + '\\n'); process.exit(7)",
          ];
          // Without the variable in this test's own environment, Spectra sets it.
          if (process.env.PYTHONUNBUFFERED === undefined) {
            const set = await launch([], show);
            await set.spectra.waitFor(/The agent's process exited with code 7/);
            assert.match(set.spectra.output, /unbuffered=1\n/);
            await stopped(set.spectra);
          }
          const kept = await launch([], show, undefined, {PYTHONUNBUFFERED: 'kept'});
          await kept.spectra.waitFor(/The agent's process exited with code 7/);
          assert.match(kept.spectra.output, /unbuffered=kept\n/);
          await stopped(kept.spectra);
        },
      );

      it(
        'restarts the agent on a save, the cause naming the file on the restart event, in the terminal and on the stopped divider',
        {timeout: TIMEOUT},
        async () => {
          const cwd = workingDir();
          const {spectra, base} = await launch([], undefined, cwd);
          await spectra.waitFor(/Starting the agent/);
          assert.ok(
            spectra.output.includes(
              `a2ui-spectra: A save in ${realpathSync(cwd)} restarts the agent. ` +
                'Set watch to false in the config file when the agent reloads itself.\n',
            ),
            spectra.output,
          );
          assert.ok(
            spectra.output.indexOf('restarts the agent.') <
              spectra.output.indexOf('Starting the agent'),
            'The line comes before the command starts.',
          );
          const first = await stateIs(base, 'running');
          await savedUntil(
            spectra,
            path.join(cwd, 'prompt_builder.py'),
            /a2ui-spectra: Restarting the agent: prompt_builder\.py changed\.\n/,
          );
          const again = await stateIs(base, 'running', first.state.seq);
          assert.ok(savedFiles(again).length > 0);
          assert.ok(savedFiles(again).every(file => file === 'prompt_builder.py'));
          assert.deepEqual(
            again.events.map(event => event.type).filter(type => type !== 'agent_restarted'),
            [],
          );
          const logs = await logsHold(base, held =>
            held.entries.some(entry => entry.type === 'stopped'),
          );
          const divider = logs.entries.find(entry => entry.type === 'stopped');
          assert.ok(divider?.type === 'stopped');
          assert.deepEqual(divider.cause, {kind: 'save', file: 'prompt_builder.py'});
          await stopped(spectra);
        },
      );

      it(
        'names the watched file when an ignored write came first',
        {timeout: TIMEOUT},
        async () => {
          const cwd = workingDir();
          const {spectra, base} = await launch([], undefined, cwd);
          const live = new LiveStream(`${base}/api/stream`);
          await live.ready;
          const first = await stateIs(base, 'running');
          for (const folder of ['node_modules', '.wireit', path.join('src', '__pycache__')]) {
            mkdirSync(path.join(cwd, folder), {recursive: true});
            writeFileSync(path.join(cwd, folder, 'written.js'), 'ignored');
          }
          writeFileSync(path.join(cwd, 'src', '.agent.py.swp'), 'ignored');
          writeFileSync(path.join(cwd, '.DS_Store'), 'ignored');
          mkdirSync(path.join(cwd, 'a2ui-spectra-fixtures'));
          writeFileSync(path.join(cwd, 'a2ui-spectra-fixtures', 'greet.json'), '{}');
          const file = path.join('src', 'agent.py');
          await savedUntil(
            spectra,
            path.join(cwd, file),
            /a2ui-spectra: Restarting the agent: src.agent\.py changed\.\n/,
          );
          const again = await stateIs(base, 'running', first.state.seq);
          assert.ok(savedFiles(again).length > 0);
          assert.deepEqual(
            savedFiles(again).filter(saved => saved !== file),
            [],
          );
          // The fixtures folder appearing is told through the same watch, and is no save.
          await live.until(event => event.event === 'fixtures_changed');
          live.close();
          await stopped(spectra);
        },
      );

      it(
        'starts a down agent on a save, and stops a starting process and starts another on a save during a card wait',
        {timeout: TIMEOUT, skip: !posix},
        async () => {
          const cwd = workingDir();
          const down = await launch([], [process.execPath, '-e', 'process.exit(3)'], cwd);
          const exited = await stateIs(down.base, 'down');
          await savedUntil(
            down.spectra,
            path.join(cwd, 'fix.py'),
            /a2ui-spectra: Restarting the agent: fix\.py changed\.\n/,
          );
          // The command exits again, with a restart by the save between the two exits.
          const again = await logsHold(
            down.base,
            held => held.entries.filter(entry => entry.type === 'started').length >= 2,
          );
          assert.deepEqual(words(again.entries).slice(0, 3), ['started', 'stopped', 'started']);
          const after = await stateIs(down.base, 'down', exited.state.seq);
          assert.ok(savedFiles(after).includes('fix.py'));
          await stopped(down.spectra);

          const dir = tempDir();
          try {
            const pidFile = path.join(dir, 'pids');
            const waitCwd = workingDir();
            const waiting = await launch([], idleWithPid(pidFile), waitCwd);
            await stateIs(waiting.base, 'waiting');
            const [firstPid] = pidsIn(pidFile);
            await savedUntil(
              waiting.spectra,
              path.join(waitCwd, 'agent.py'),
              /a2ui-spectra: Restarting the agent: agent\.py changed\.\n/,
            );
            assert.ok(
              await eventually(() => pidsIn(pidFile).length >= 2 && !isAlive(firstPid), 10_000),
              'The starting process was stopped and the command started again.',
            );
            await stopped(waiting.spectra);
          } finally {
            rmSync(dir, {recursive: true, force: true});
          }
        },
      );

      it(
        'watches nothing when watch is false: the off line at start, and a press afterwards the only restart',
        {timeout: TIMEOUT},
        async () => {
          const cwd = workingDir();
          writeFileSync(path.join(cwd, 'a2ui-spectra.json'), JSON.stringify({watch: false}));
          const {spectra, base} = await launch([], undefined, cwd);
          await spectra.waitFor(/Starting the agent/);
          assert.ok(
            spectra.output.includes(
              `a2ui-spectra: Restart on save is off: watch is false in ${path.join(realpathSync(cwd), 'a2ui-spectra.json')}.\n`,
            ),
            spectra.output,
          );
          const first = await stateIs(base, 'running');
          writeFileSync(path.join(cwd, 'agent.py'), 'saved');
          // Long enough for a watch to have restarted, had there been one.
          await new Promise(resolve => setTimeout(resolve, 500));
          await press(base);
          const again = await stateIs(base, 'running', first.state.seq);
          assert.deepEqual(
            again.events.map(event => event.type === 'agent_restarted' && event.cause),
            [{kind: 'press'}],
          );
          assert.doesNotMatch(spectra.output, /changed\./);
          await stopped(spectra);
        },
      );

      it(
        'restarts nothing on a save of the config file, and says to stop and start Spectra',
        {timeout: TIMEOUT},
        async () => {
          const cwd = workingDir();
          const config = path.join(cwd, 'a2ui-spectra.json');
          writeFileSync(config, JSON.stringify({}));
          const {spectra, base} = await launch([], undefined, cwd);
          const first = await stateIs(base, 'running');
          const told =
            /a2ui-spectra: a2ui-spectra\.json changed\. Spectra reads it at start, so stop Spectra and start it again to apply it\.\n/;
          const deadline = Date.now() + 15_000;
          for (;;) {
            writeFileSync(config, JSON.stringify({watch: ['.', '!sessions.db']}));
            if (await spectra.waitFor(told, 1000).catch(() => undefined)) break;
            assert.ok(Date.now() < deadline, spectra.output);
          }
          await savedUntil(
            spectra,
            path.join(cwd, 'agent.py'),
            /a2ui-spectra: Restarting the agent: agent\.py changed\.\n/,
          );
          const again = await stateIs(base, 'running', first.state.seq);
          assert.deepEqual(
            savedFiles(again).filter(saved => saved !== 'agent.py'),
            [],
          );
          await stopped(spectra);
        },
      );

      it(
        'stops at start on a watch path that does not exist, before the command has started, and not on a missing exclusion',
        {timeout: TIMEOUT},
        async () => {
          const cwd = workingDir();
          writeFileSync(
            path.join(cwd, 'a2ui-spectra.json'),
            JSON.stringify({watch: ['.', 'no-such-folder']}),
          );
          const result = await finished(await runArgs([]), cwd);
          assert.equal(result.code, 1, result.output);
          assert.ok(
            result.output.includes(
              `a2ui-spectra: The watch path ${path.join(realpathSync(cwd), 'no-such-folder')} does not exist.\n`,
            ),
            result.output,
          );
          assert.doesNotMatch(result.output, /Starting the agent/);

          const excluded = workingDir();
          writeFileSync(
            path.join(excluded, 'a2ui-spectra.json'),
            JSON.stringify({watch: ['.', '!sessions.db']}),
          );
          const {spectra, base} = await launch([], undefined, excluded);
          const first = await stateIs(base, 'running');
          writeFileSync(path.join(excluded, 'sessions.db'), 'written by the agent');
          await savedUntil(
            spectra,
            path.join(excluded, 'agent.py'),
            /a2ui-spectra: Restarting the agent: agent\.py changed\.\n/,
          );
          const again = await stateIs(base, 'running', first.state.seq);
          assert.deepEqual(
            savedFiles(again).filter(saved => saved !== 'agent.py'),
            [],
          );
          await stopped(spectra);
        },
      );

      it('words the wait for a refused connection itself', {timeout: TIMEOUT}, async () => {
        const {spectra, base, agentPort} = await launch([], idle);
        await spectra.waitFor(
          new RegExp(
            `Waiting for the agent's card at http://localhost:${agentPort}/\\.well-known/agent-card\\.json: ` +
              "connection refused\\. Change the agent's URL with --agent-url, or agent\\.url in the config file\\.\n",
          ),
        );
        const waiting = await stateIs(base, 'waiting');
        assert.deepEqual(waiting.state, {state: 'waiting', reason: 'connection refused', seq: 2});
        await stopped(spectra);
      });
    });
  });
});
