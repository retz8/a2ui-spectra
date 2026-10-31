/**
 * The command-line test: starts Spectra as a separate process and checks it
 * from outside. It runs under Node by default. When SPECTRA_BINARY names a
 * compiled binary, the same cases run against the binary instead.
 */
import assert from 'node:assert/strict';
import {mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {createServer, request as httpRequest, type Server} from 'node:http';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

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
        `Waiting for the agent's card at http://localhost:${agentPort}/\\.well-known/agent-card\\.json`,
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
          await spectra.waitFor(viewerUrl);
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
      await spectra.waitFor(viewerUrl);
      spectra.signal('SIGTERM');
      await spectra.waitFor(/Press Ctrl-C again to force it/);
      spectra.signal('SIGINT');
      const exit = await spectra.exited;
      assert.equal(exit.code, 128 + 9, spectra.output);
    });

    it("exits with the agent's exit code when the agent exits", {timeout: TIMEOUT}, async () => {
      const result = await finished(await runArgs(['--exit-after-card', '4']));
      assert.equal(result.code, 4, result.output);
      assert.match(result.output, /The agent's process exited with code 4/);
    });

    it(
      'exits with the exit code of an agent that exits before its card answers',
      {
        timeout: TIMEOUT,
      },
      async () => {
        const args = await runArgs([]);
        const command = args.indexOf('--');
        const result = await finished([
          ...args.slice(0, command + 1),
          process.execPath,
          '-e',
          'process.exit(3)',
        ]);
        assert.equal(result.code, 3, result.output);
        assert.match(
          result.output,
          /The agent's process exited with code 3 before its card answered/,
        );
      },
    );

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
          const result = await finished(
            [
              ...args.slice(0, command + 1),
              process.execPath,
              '-e',
              "process.stdout.write('dotenv=' + process.env.SPECTRA_TEST_DOTENV + '\\n'); process.exit(5)",
            ],
            dir,
          );
          assert.equal(result.code, 5, result.output);
          assert.match(result.output, /dotenv=undefined/);
        } finally {
          rmSync(dir, {recursive: true, force: true});
        }
      },
    );

    it(
      "stops the agent's process when its card lists no JSON-RPC interface",
      {timeout: TIMEOUT},
      async () => {
        const result = await finished(await runArgs(['--transports', 'GRPC']));
        assert.equal(result.code, 1, result.output);
        assert.match(result.output, /lists no A2A JSON-RPC interface/);
      },
    );

    it(
      "sets the base-URL variables in the agent's environment, pointing at the model proxy, and lists none in the context",
      {timeout: TIMEOUT},
      async () => {
        const args = await runArgs([]);
        const command = args.indexOf('--');
        const modelProxyPort = args[args.indexOf('--model-proxy-port') + 1];
        const result = await finished([
          ...args.slice(0, command + 1),
          process.execPath,
          '-e',
          "process.stdout.write('gemini=' + process.env.GEMINI_API_BASE + ' anthropic=' + process.env.ANTHROPIC_API_BASE + ' openai=' + process.env.OPENAI_BASE_URL + '\\n'); process.exit(6)",
        ]);
        assert.equal(result.code, 6, result.output);
        assert.match(
          result.output,
          new RegExp(
            `gemini=http://127\\.0\\.0\\.1:${modelProxyPort}/GEMINI_API_BASE anthropic=http://127\\.0\\.0\\.1:${modelProxyPort}/ANTHROPIC_API_BASE openai=http://127\\.0\\.0\\.1:${modelProxyPort}/OPENAI_BASE_URL`,
          ),
        );
        assert.doesNotMatch(result.output, /set these in the agent's shell/);
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

    it('reports a command that cannot start', {timeout: TIMEOUT}, async () => {
      const args = await runArgs([]);
      const command = args.indexOf('--');
      const result = await finished([
        ...args.slice(0, command + 1),
        'a2ui-spectra-test-no-such-command',
      ]);
      assert.equal(result.code, 127, result.output);
      assert.match(result.output, /The agent's process could not start/);
    });
  });
});
