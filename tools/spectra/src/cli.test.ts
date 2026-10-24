/**
 * The command-line test: starts Spectra as a separate process and checks it
 * from outside. It runs under Node by default. When SPECTRA_BINARY names a
 * compiled binary, the same cases run against the binary instead.
 */
import assert from 'node:assert/strict';
import {type ChildProcess, spawn} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {createServer, request as httpRequest, type Server} from 'node:http';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {after, describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

import {SEND_REPLY, startFakeAgent, STREAM_REPLY} from './testing/fake_agent.js';
import {VERSION} from './version.js';

const binary = process.env.SPECTRA_BINARY;
const spectraCommand: [string, ...string[]] =
  binary === undefined || binary === ''
    ? [process.execPath, fileURLToPath(new URL('./cli.js', import.meta.url))]
    : [path.resolve(binary)];
const fakeAgentScript = fileURLToPath(new URL('./testing/fake_agent.js', import.meta.url));
const posix = process.platform !== 'win32';
const TIMEOUT = 30_000;

interface Exit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

/** Spectra running as a process, with its stdout and stderr collected. */
class SpectraProcess {
  output = '';
  readonly exited: Promise<Exit>;
  readonly #child: ChildProcess;
  #listeners: Array<() => void> = [];

  constructor(args: string[], cwd?: string) {
    const [command, ...prefix] = spectraCommand;
    this.#child = spawn(command, [...prefix, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd,
    });
    for (const stream of [this.#child.stdout, this.#child.stderr]) {
      stream?.setEncoding('utf8');
      stream?.on('data', (chunk: string) => {
        this.output += chunk;
        for (const listener of this.#listeners) listener();
      });
    }
    this.exited = new Promise(resolve => {
      this.#child.once('exit', (code, signal) => resolve({code, signal}));
      this.#child.once('error', error => {
        this.output += `Spectra could not start: ${error.message}\n`;
        resolve({code: null, signal: null});
      });
    });
    running.add(this);
    void this.exited.then(() => running.delete(this));
  }

  /** Resolves with the first match of the pattern in the output so far. */
  waitFor(pattern: RegExp, timeoutMs = 15_000): Promise<RegExpMatchArray> {
    return new Promise((resolve, reject) => {
      const check = () => {
        const match = this.output.match(pattern);
        if (match !== null) {
          done();
          resolve(match);
        }
      };
      const timer = setTimeout(() => {
        done();
        reject(new Error(`No ${pattern} in Spectra's output:\n${this.output}`));
      }, timeoutMs);
      const done = () => {
        clearTimeout(timer);
        this.#listeners = this.#listeners.filter(l => l !== check);
      };
      this.#listeners.push(check);
      check();
    });
  }

  signal(signal: NodeJS.Signals): void {
    this.#child.kill(signal);
  }
}

const running = new Set<SpectraProcess>();
after(() => {
  for (const spectra of running) spectra.signal('SIGKILL');
});

async function finished(args: string[], cwd?: string): Promise<Exit & {output: string}> {
  const spectra = new SpectraProcess(args, cwd);
  const exit = await spectra.exited;
  return {...exit, output: spectra.output};
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() =>
        typeof address === 'object' && address !== null
          ? resolve(address.port)
          : reject(new Error('No port.')),
      );
    });
  });
}

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
    assert.match(tool.output, /attach <agent-url>/);
    assert.match(tool.output, /run --agent-url <url> \[options\] -- <command>/);
    const run = await finished(['run', '--help']);
    assert.equal(run.code, 0);
    assert.match(run.output, /--agent-url <url>/);
  });

  it("rejects run without the agent's command", {timeout: TIMEOUT}, async () => {
    const result = await finished(['run', '--agent-url', 'http://localhost:1']);
    assert.equal(result.code, 2);
    assert.match(result.output, /after '--'/);
  });

  it('attach waits for the card, then serves the viewer', {timeout: TIMEOUT}, async () => {
    const [agentPort, port, proxyPort] = await Promise.all([freePort(), freePort(), freePort()]);
    const spectra = new SpectraProcess([
      'attach',
      `http://localhost:${agentPort}`,
      '--port',
      String(port),
      '--proxy-port',
      String(proxyPort),
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
      const [agentPort, port, proxyPort] = await Promise.all([freePort(), freePort(), freePort()]);
      const agent = await startFakeAgent(agentPort);
      const spectra = new SpectraProcess([
        'attach',
        `http://localhost:${agentPort}`,
        '--port',
        String(port),
        '--proxy-port',
        String(proxyPort),
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
    'attach warns when the card prefers another transport to JSON-RPC, and keeps running',
    {timeout: TIMEOUT},
    async () => {
      const [agentPort, port, proxyPort] = await Promise.all([freePort(), freePort(), freePort()]);
      const agent = await startFakeAgent(agentPort, {transports: ['GRPC', 'JSONRPC']});
      const spectra = new SpectraProcess([
        'attach',
        `http://localhost:${agentPort}`,
        '--port',
        String(port),
        '--proxy-port',
        String(proxyPort),
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
    const [agentPort, port, proxyPort] = await Promise.all([freePort(), freePort(), freePort()]);
    const agent = await startFakeAgent(agentPort, {transports: []});
    try {
      const result = await finished([
        'attach',
        `http://localhost:${agentPort}`,
        '--port',
        String(port),
        '--proxy-port',
        String(proxyPort),
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
    const [agentPort, port, proxyPort] = await Promise.all([freePort(), freePort(), freePort()]);
    const agent = await startFakeAgent(agentPort, {transports: ['GRPC', 'HTTP+JSON']});
    try {
      const result = await finished([
        'attach',
        `http://localhost:${agentPort}`,
        '--port',
        String(port),
        '--proxy-port',
        String(proxyPort),
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
    const [agentPort, port, proxyPort] = await Promise.all([freePort(), freePort(), freePort()]);
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
    const [agentPort, port, proxyPort] = await Promise.all([freePort(), freePort(), freePort()]);
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
      const [agentPort, port, proxyPort] = await Promise.all([freePort(), freePort(), freePort()]);
      return [
        'run',
        '--agent-url',
        `http://localhost:${agentPort}`,
        '--port',
        String(port),
        '--proxy-port',
        String(proxyPort),
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
