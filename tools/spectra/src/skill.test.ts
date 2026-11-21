/**
 * The skill for a coding agent, `skills/a2ui-spectra/SKILL.md`, held to the tool it describes.
 *
 * Its frontmatter is checked against the Agent Skills format's rules, as the specification at
 * https://agentskills.io/specification states them, and its install commands against the root
 * README's, word for word. Every attribute it names is one the turn record's specification names.
 *
 * Every command block the skill states is then run as written, through a shell, against Spectra
 * and the stub agent: the `sh` blocks of `SKILL.md` under `/bin/sh` on macOS and Linux, and the
 * `powershell` blocks of `references/windows.md` under `powershell.exe` on Windows. `a2ui-spectra` on the shell's
 * `PATH` is the binary SPECTRA_BINARY names, or on macOS and Linux a script that runs Spectra
 * under Node; under Node on Windows nothing stands in for a binary, and the blocks are not run.
 * Before a block runs, the test fills in what the skill leaves to its reader, the placeholders in
 * angle brackets, and moves what would collide between test runs: the viewer's port, the folder
 * `/tmp/a2ui-spectra`, and Spectra's other ports, given as options.
 */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {connect} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {after, describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

import {freePort} from './testing/free_port.js';
import {binary, workingDir} from './testing/spectra_process.js';
import {startStandIn} from './testing/stand_in_provider.js';
import {stubScript} from './testing/stub_agent.js';
import {startToolServer} from './testing/tool_server.js';

const windows = process.platform === 'win32';
const binaryFile = binary !== undefined && binary !== '' ? path.resolve(binary) : undefined;
const runsBlocks = binaryFile !== undefined || !windows;
const TIMEOUT = 180_000;

const REPO_DIR = fileURLToPath(new URL('../../../', import.meta.url));
const SKILL_DIR = path.join(REPO_DIR, 'skills', 'a2ui-spectra');
const SKILL = readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8').replaceAll('\r\n', '\n');
const WINDOWS = readFileSync(path.join(SKILL_DIR, 'references', 'windows.md'), 'utf8').replaceAll(
  '\r\n',
  '\n',
);
const CLI_SCRIPT = fileURLToPath(new URL('./cli.js', import.meta.url));
const restaurantFinderHar = fileURLToPath(
  new URL(
    '../../../conformance/test_data/model_capture/v0_1/gemini/restaurant_finder_google_genai.har',
    import.meta.url,
  ),
);
/** The variable the stub reads its tool server's URL from, in its model-calling mode. */
const TOOL_SERVER_VARIABLE = 'SPECTRA_STUB_TOOL_SERVER_URL';

/** What the skill writes, and the test moves. */
const VIEWER = 'http://localhost:9820';
const POSIX_FOLDER = '/tmp/a2ui-spectra';
const WINDOWS_FOLDER = '$env:TEMP\\a2ui-spectra';
/** The same folder as `cmd.exe` writes it. */
const CMD_FOLDER = '%TEMP%\\a2ui-spectra';

/** The part of `scripts/install_check.mjs` the test uses. */
interface InstallCheck {
  readmeInstallCommands(): Record<'npx' | 'uvx' | 'sh' | 'powershell', string>;
}

/** The frontmatter's keys with their values, a folded value joined into one line. */
function frontmatter(): Record<string, string> {
  const match = SKILL.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, 'SKILL.md opens with frontmatter between two lines of ---.');
  const fields: Record<string, string> = {};
  let key: string | undefined;
  for (const line of match[1].split('\n')) {
    const top = line.match(/^([A-Za-z-]+):\s*(.*)$/);
    if (top !== null) {
      key = top[1];
      fields[key] = /^[>|][+-]?$/.test(top[2]) ? '' : top[2];
    } else {
      assert.ok(key !== undefined && /^\s+\S/.test(line), `The frontmatter line reads: ${line}`);
      fields[key] = `${fields[key]} ${line.trim()}`.trim();
    }
  }
  return fields;
}

/** The skill's fenced blocks of one language, in its file's order: `sh` in `SKILL.md`, `powershell` in the Windows file. */
function blocks(language: string): string[] {
  return [
    ...(language === 'powershell' ? WINDOWS : SKILL).matchAll(/^```(\w+)\n([\s\S]*?)\n```$/gm),
  ]
    .filter(match => match[1] === language)
    .map(match => match[2]);
}

/** The one block of the language that holds the text. */
function block(language: string, holding: string): string {
  const found = blocks(language).filter(text => text.includes(holding));
  assert.equal(found.length, 1, `One ${language} block of the skill holds: ${holding}`);
  return found[0];
}

function filled(text: string, values: Record<string, string>): string {
  let result = text;
  for (const [from, to] of Object.entries(values)) {
    assert.ok(result.includes(from), `The block holds ${from}:\n${text}`);
    result = result.replaceAll(from, to);
  }
  assert.doesNotMatch(result, /<[a-z0-9-]+>/, `No placeholder is left in:\n${result}`);
  return result;
}

interface Session {
  /** The agent's folder, Spectra's working directory. */
  cwd: string;
  /** The folder standing in for the skill's `/tmp/a2ui-spectra`. */
  folder: string;
  viewer: string;
  agentPort: number;
  agentUrl: string;
  /** Spectra's other ports, as options. */
  ports: string;
  env: Record<string, string>;
}

const folders: string[] = [];
after(() => {
  for (const folder of folders) rmSync(folder, {recursive: true, force: true});
});

/** A folder holding `a2ui-spectra`, for the shell's `PATH`. */
function commandFolder(): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'spectra-skill-bin-'));
  folders.push(folder);
  if (windows) {
    copyFileSync(binaryFile!, path.join(folder, 'a2ui-spectra.exe'));
    return folder;
  }
  const command = path.join(folder, 'a2ui-spectra');
  const target =
    binaryFile === undefined ? `"${process.execPath}" "${CLI_SCRIPT}"` : `"${binaryFile}"`;
  writeFileSync(command, `#!/bin/sh\nexec ${target} "$@"\n`);
  chmodSync(command, 0o755);
  return folder;
}

async function session(env: Record<string, string> = {}): Promise<Session> {
  const [port, agentPort, proxy, modelProxy, receiver, toolProxy] = await Promise.all([
    freePort(),
    freePort(),
    freePort(),
    freePort(),
    freePort(),
    freePort(),
  ]);
  const folder = mkdtempSync(path.join(tmpdir(), 'spectra-skill-'));
  folders.push(folder);
  const {PSModulePath: _left, ...inherited} = process.env;
  return {
    cwd: workingDir(),
    folder,
    viewer: `http://localhost:${port}`,
    agentPort,
    agentUrl: `http://127.0.0.1:${agentPort}`,
    ports: `--proxy-port ${proxy} --model-proxy-port ${modelProxy} --receiver-port ${receiver} --tool-proxy-port ${toolProxy}`,
    env: {
      // Windows PowerShell finds no module under the PSModulePath PowerShell 7 leaves behind.
      ...(inherited as Record<string, string>),
      ...env,
      PATH: `${commandFolder()}${path.delimiter}${process.env.PATH ?? ''}`,
    },
  };
}

/** The command that starts the stub agent, as the skill's `<agent-command>`. */
function agentCommand(s: Session, behaviour: string): string {
  const quote = (text: string) => (windows ? text : `"${text}"`);
  return `${quote(process.execPath)} ${quote(stubScript)} --port ${s.agentPort} ${behaviour}`;
}

/** Runs a block of the skill in the agent's folder, with what the test moves moved. */
function run(
  s: Session,
  text: string,
  values: Record<string, string> = {},
): {status: number | null; stdout: string; stderr: string} {
  const script = filled(text, values)
    .replaceAll(VIEWER, s.viewer)
    .replaceAll(POSIX_FOLDER, s.folder)
    .replaceAll(WINDOWS_FOLDER, s.folder)
    .replaceAll(CMD_FOLDER, s.folder)
    .replaceAll('--no-open', `--no-open --port ${new URL(s.viewer).port} ${s.ports}`);
  let result;
  if (windows) {
    const file = path.join(s.folder, `block-${Date.now()}.ps1`);
    writeFileSync(file, script);
    result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file],
      {cwd: s.cwd, env: s.env, encoding: 'utf8', timeout: TIMEOUT},
    );
  } else {
    result = spawnSync('/bin/sh', ['-c', script], {
      cwd: s.cwd,
      env: s.env,
      encoding: 'utf8',
      timeout: TIMEOUT,
    });
  }
  assert.equal(result.error, undefined, String(result.error));
  return {status: result.status, stdout: result.stdout, stderr: result.stderr};
}

function listens(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

async function until(what: string, check: () => Promise<boolean>, ms = 20_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await check())) {
    assert.ok(Date.now() < end, `Within ${ms} ms: ${what}`);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const sh = {
  start: () => block('sh', 'nohup a2ui-spectra run'),
  ready: () => block('sh', 'grep -q \'"state":"running"\''),
  send: () => block('sh', '{"text": "<message>"}'),
  wait: () => block('sh', '/api/turns/<trace-id>'),
  list: () => block('sh', `curl -s ${VIEWER}/api/turns`),
  action: () => block('sh', '"action":'),
  restart: () => block('sh', '/api/agent/restart'),
  save: () => block('sh', '/api/fixtures'),
  stop: () => block('sh', 'kill '),
  test: () => block('sh', 'a2ui-spectra test'),
  replay: () => block('sh', 'a2ui-spectra replay'),
};

interface Finding {
  code?: string;
  message?: string;
  path?: string;
}
interface TurnEvent {
  attributes: Record<string, unknown>;
  status?: {code: number};
}
interface Turn {
  events: TurnEvent[];
}
interface Row {
  traceId: string;
  outcome?: string;
  findings?: number;
  rejections?: number;
}

/** The skill's loop on macOS and Linux, block by block. */
class Loop {
  constructor(readonly s: Session) {}

  /** Steps 1: the start, then the wait for the agent's card. */
  start(behaviour: string): void {
    const started = run(this.s, sh.start(), {
      '<agent-url>': this.s.agentUrl,
      '<agent-command>': agentCommand(this.s, behaviour),
    });
    assert.equal(started.status, 0, started.stderr);
    this.ready();
  }

  ready(): void {
    const ready = run(this.s, sh.ready());
    assert.equal(ready.status, 0, ready.stderr);
    assert.match(ready.stdout, /"state":"running"/, this.log());
  }

  log(): string {
    const file = path.join(this.s.folder, 'spectra.log');
    return existsSync(file) ? readFileSync(file, 'utf8') : 'Spectra wrote no log.';
  }

  /** Step 2. */
  send(message: string): string {
    const sent = run(this.s, sh.send(), {'<message>': message});
    assert.equal(sent.status, 0, sent.stderr);
    const {traceId} = JSON.parse(sent.stdout) as {traceId?: string};
    assert.match(traceId ?? '', /^[0-9a-f]{32}$/, sent.stdout);
    return traceId!;
  }

  /** Step 3: the wait, the record it leaves, and the turn's row of the list. */
  closed(traceId: string): {turn: Turn; row: Row} {
    const waited = run(this.s, sh.wait(), {'<trace-id>': traceId});
    assert.equal(waited.stdout.trim(), '200', this.log());
    const record = JSON.parse(readFileSync(path.join(this.s.folder, 'turn.json'), 'utf8')) as {
      version: string;
      turns: Turn[];
    };
    assert.ok(record.version);
    const listed = run(this.s, sh.list());
    const row = (JSON.parse(listed.stdout) as {turns: Row[]}).turns.find(
      turn => turn.traceId === traceId,
    );
    assert.ok(row, listed.stdout);
    return {turn: record.turns.at(-1)!, row};
  }

  /** Step 7's stop: Spectra gone, and the agent with it. */
  async stop(): Promise<void> {
    const pid = Number(readFileSync(path.join(this.s.folder, 'spectra.pid'), 'utf8'));
    assert.ok(alive(pid), 'Spectra runs until the stop.');
    const stopped = run(this.s, sh.stop());
    assert.equal(stopped.status, 0, stopped.stderr);
    await until('Spectra exits', async () => !alive(pid));
    await until('the agent stops listening', async () => !(await listens(this.s.agentPort)));
  }

  /** Ends what a failed test left running. */
  async cleanUp(): Promise<void> {
    const file = path.join(this.s.folder, 'spectra.pid');
    if (!existsSync(file)) return;
    const pid = Number(readFileSync(file, 'utf8'));
    if (!alive(pid)) return;
    process.kill(pid, 'SIGTERM');
    await until('Spectra exits', async () => !alive(pid), 5000).catch(() =>
      process.kill(pid, 'SIGKILL'),
    );
  }
}

function kindOf(event: TurnEvent): unknown {
  return event.attributes['a2ui.event.kind'];
}

/** What a JSON pointer names in a value, or undefined. */
function pointed(value: unknown, pointer: string): unknown {
  let at = value;
  for (const segment of pointer.split('/').slice(1)) {
    if (at === null || typeof at !== 'object') return undefined;
    at = (at as Record<string, unknown>)[segment.replaceAll('~1', '/').replaceAll('~0', '~')];
  }
  return at;
}

describe('the skill’s form', () => {
  const fields = frontmatter();

  it('carries the fields of the Agent Skills format, and no other', () => {
    const allowed = [
      'name',
      'description',
      'license',
      'compatibility',
      'metadata',
      'allowed-tools',
    ];
    assert.deepEqual(
      Object.keys(fields).filter(key => !allowed.includes(key)),
      [],
    );
    assert.equal(fields.license, 'Apache-2.0');
  });

  it('is named as its folder is, in the format’s characters', () => {
    assert.equal(fields.name, path.basename(SKILL_DIR));
    assert.match(fields.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(fields.name.length <= 64);
  });

  it('describes itself in 1 to 1024 characters', () => {
    assert.ok(fields.description.length >= 1 && fields.description.length <= 1024);
  });

  it('stays under the 500 lines the format advises', () => {
    assert.ok(SKILL.split('\n').length < 500);
  });

  it('gives the root README’s four install commands, word for word', async () => {
    const check = (await import(
      new URL('../scripts/install_check.mjs', import.meta.url).href
    )) as InstallCheck;
    for (const command of Object.values(check.readmeInstallCommands())) {
      assert.ok(SKILL.includes(`\`${command}\``), `SKILL.md gives: ${command}`);
    }
  });

  it('gives each wrapper’s install command as its README does', () => {
    for (const [readme, command] of [
      [
        'python/a2ui_spectra_instrumentation/README.md',
        'uv add --dev a2ui-spectra-instrumentation',
      ],
      [
        'typescript/instrumentation/README.md',
        'npm install --save-dev a2ui-spectra-instrumentation',
      ],
    ]) {
      assert.ok(readFileSync(path.join(REPO_DIR, readme), 'utf8').includes(command), readme);
      assert.ok(SKILL.includes(`\`${command}\``), `SKILL.md gives: ${command}`);
    }
  });

  it('names only attributes the turn record’s specification names', () => {
    const specification = readFileSync(
      path.join(REPO_DIR, 'specification/turn_record/v0_1/docs/turn_record.md'),
      'utf8',
    );
    const named = [...SKILL.matchAll(/`((?:a2ui|gen_ai)\.[a-z_.]+[a-z_])`/g)].map(
      match => match[1],
    );
    assert.ok(named.length > 20);
    for (const name of named) {
      assert.ok(specification.includes(`\`${name}\``), `The turn record names ${name}.`);
    }
  });

  it('holds eleven sh blocks, and five powershell blocks in the Windows file it links', () => {
    assert.equal(blocks('sh').length, 11);
    assert.equal(blocks('powershell').length, 5);
    assert.equal([...SKILL.matchAll(/^```powershell$/gm)].length, 0);
    assert.ok(SKILL.includes('(references/windows.md)'));
  });
});

if (runsBlocks && !windows) {
  describe('the skill’s loop, each sh block run as written', () => {
    it(
      'reads the problems of a flawed turn from its record, each finding’s path pointing into the turn',
      {timeout: TIMEOUT},
      async () => {
        const loop = new Loop(await session());
        try {
          loop.start('--flawed-booking');
          const {turn, row} = loop.closed(loop.send('Book a table'));
          assert.equal(row.outcome, 'completed');
          assert.ok((row.findings ?? 0) > 0, JSON.stringify(row));
          assert.equal(row.rejections, 0);
          const checks = turn.events.filter(event => kindOf(event) === 'check');
          assert.deepEqual(
            checks.map(check => check.attributes['a2ui.check.name']),
            ['schema', 'catalog', 'structural', 'binding'],
          );
          const findings = checks.flatMap(
            check => check.attributes['a2ui.check.findings'] as Finding[],
          );
          assert.equal(findings.length, row.findings);
          assert.ok(checks.some(check => check.attributes['a2ui.check.passed'] === false));
          for (const finding of findings) {
            assert.ok(finding.code && finding.message, JSON.stringify(finding));
            if (finding.path !== undefined) {
              assert.notEqual(pointed(turn, finding.path), undefined, finding.path);
            }
          }
          assert.ok(findings.some(finding => finding.path !== undefined));
          const turnEvent = turn.events.find(event => kindOf(event) === 'turn')!;
          assert.equal(turnEvent.attributes['a2ui.turn.outcome'], 'completed');
          assert.ok(Array.isArray(turnEvent.attributes['a2ui.turn.capture_paths']));
          await loop.stop();
        } finally {
          await loop.cleanUp();
        }
      },
    );

    it(
      'sends an action into the conversation of a turn that waits for input',
      {timeout: TIMEOUT},
      async () => {
        const loop = new Loop(await session());
        try {
          loop.start('--canned-a2ui');
          const first = loop.closed(loop.send('Hello'));
          assert.equal(first.row.outcome, 'waiting_for_input');
          assert.equal(first.row.findings, 0);
          const box = run(loop.s, `curl -s ${VIEWER}/api/message-box`);
          const {conversations} = JSON.parse(box.stdout) as {
            conversations: Array<{conversationId?: string}>;
          };
          const conversationId = conversations[0]?.conversationId;
          assert.ok(conversationId, box.stdout);
          const sent = run(loop.s, sh.action(), {
            '<a2ui-version>': '1.0',
            '<action-name>': 'greet',
            '<surface-id>': 'greeting',
            '<component-id>': 'greet',
            '<iso-8601-time>': '2026-11-21T04:21:00.000Z',
            '<conversation-id>': conversationId,
          });
          const answer = JSON.parse(sent.stdout) as {traceId?: string; conversationId?: string};
          assert.equal(answer.conversationId, conversationId, sent.stdout);
          const second = loop.closed(answer.traceId!);
          const input = second.turn.events.find(event => kindOf(event) === 'wire_input')!;
          assert.match(JSON.stringify(input.attributes['a2ui.wire.message']), /"greet"/);
          await loop.stop();
        } finally {
          await loop.cleanUp();
        }
      },
    );

    it(
      'reads the model call and the tool call inside a turn, restarts the agent, saves the turn as a fixture, and passes test and replay from the record',
      {timeout: TIMEOUT},
      async () => {
        const [standInPort, toolServerPort] = await Promise.all([freePort(), freePort()]);
        const standIn = await startStandIn(standInPort, [restaurantFinderHar]);
        const toolServer = await startToolServer(toolServerPort);
        const loop = new Loop(
          await session({
            GOOGLE_GEMINI_BASE_URL: standIn.origin,
            SPECTRA_PROVIDER_STAND_IN: standIn.origin,
          }),
        );
        writeFileSync(
          path.join(loop.s.cwd, 'a2ui-spectra.json'),
          JSON.stringify({
            tools: [{variable: TOOL_SERVER_VARIABLE, url: `${toolServer.origin}/mcp`}],
          }),
        );
        try {
          loop.start('--model-calling');
          const traceId = loop.send('Top 2 Chinese restaurants in New York');
          const {turn, row} = loop.closed(traceId);
          assert.equal(row.outcome, 'completed');
          const turnEvent = turn.events.find(event => kindOf(event) === 'turn')!;
          const paths = turnEvent.attributes['a2ui.turn.capture_paths'] as string[];
          assert.ok(paths.includes('model_proxy') && paths.includes('tool_proxy'), String(paths));
          const modelCalls = turn.events.filter(event => kindOf(event) === 'model_call');
          assert.equal(modelCalls.length, 2);
          for (const name of [
            'gen_ai.system_instructions',
            'gen_ai.input.messages',
            'gen_ai.tool.definitions',
            'gen_ai.output.messages',
          ]) {
            assert.ok(
              modelCalls.some(call => call.attributes[name] !== undefined),
              name,
            );
          }
          const toolCalls = turn.events.filter(event => kindOf(event) === 'tool_call');
          for (const name of [
            'gen_ai.tool.name',
            'gen_ai.tool.call.arguments',
            'gen_ai.tool.call.result',
          ]) {
            assert.ok(
              toolCalls.some(call => call.attributes[name] !== undefined),
              name,
            );
          }

          // Step 6: the restart by hand, and the wait for the card again.
          const restarted = run(loop.s, sh.restart());
          assert.deepEqual(JSON.parse(restarted.stdout), {accepted: true});
          await until('the restart is recorded', async () =>
            run(loop.s, `curl -s ${VIEWER}/api/agent`).stdout.includes('"agent_restarted"'),
          );
          loop.ready();

          // Step 7: the fixture, the stop, then test and replay with everything recorded.
          const saved = run(loop.s, sh.save(), {
            '<trace-id>': traceId,
            '<fixture-name>': 'restaurants',
          });
          const fixture = JSON.parse(saved.stdout) as {name?: string; path?: string};
          assert.equal(fixture.name, 'restaurants', saved.stdout);
          assert.ok(fixture.path && existsSync(path.join(loop.s.cwd, fixture.path)));
          await loop.stop();
          standIn.process.kill('SIGKILL');

          const headless = {
            '<agent-url>': `${loop.s.agentUrl} ${loop.s.ports}`,
            '<agent-command>': agentCommand(loop.s, '--model-calling'),
          };
          const tested = run(loop.s, sh.test(), headless);
          assert.equal(tested.status, 0, tested.stdout + tested.stderr);
          assert.match(tested.stdout, /^restaurants: passed/m);
          const replayed = run(loop.s, sh.replay(), {
            ...headless,
            '<fixture-path>': fixture.path,
          });
          assert.equal(replayed.status, 0, replayed.stdout + replayed.stderr);
          assert.match(replayed.stdout, /^turn 1 of 1: passed$/m);
        } finally {
          await loop.cleanUp();
        }
      },
    );
  });
}

if (runsBlocks && windows) {
  describe('the skill’s Windows file, each powershell block run as written', () => {
    it(
      'starts Spectra in the background, sends a message, waits for the turn and stops Spectra and the agent',
      {timeout: TIMEOUT},
      async () => {
        const s = await session();
        const ps = (holding: string) => block('powershell', holding);
        const pidFile = path.join(s.folder, 'spectra.pid');
        const viewerPort = Number(new URL(s.viewer).port);
        try {
          const started = run(s, ps('Start-Process'), {
            '<agent-url>': s.agentUrl,
            '<agent-command>': agentCommand(s, '--canned-a2ui'),
          });
          assert.equal(started.status, 0, started.stdout + started.stderr);
          const pid = Number(readFileSync(pidFile, 'utf8'));
          const ready = run(s, ps('/api/agent'));
          assert.match(ready.stdout, /"state":"running"/, ready.stdout + ready.stderr);
          assert.notEqual(readFileSync(path.join(s.folder, 'spectra.log'), 'utf8'), '');

          const sent = run(s, ps('/api/message-box/messages'), {'<message>': 'Hello'});
          const {traceId} = JSON.parse(sent.stdout) as {traceId?: string};
          assert.match(traceId ?? '', /^[0-9a-f]{32}$/, sent.stdout + sent.stderr);
          const waited = run(s, ps('/api/turns/<trace-id>'), {'<trace-id>': traceId!});
          assert.equal(waited.stdout.trim(), '200', waited.stderr);
          const record = JSON.parse(readFileSync(path.join(s.folder, 'turn.json'), 'utf8')) as {
            turns: Turn[];
          };
          const turnEvent = record.turns.at(-1)!.events.find(event => kindOf(event) === 'turn')!;
          assert.equal(turnEvent.attributes['a2ui.turn.outcome'], 'waiting_for_input');

          const stopped = run(s, ps('taskkill.exe'));
          assert.equal(stopped.status, 0, stopped.stdout + stopped.stderr);
          await until('the started process exits', async () => !alive(pid));
          await until('Spectra stops listening', async () => !(await listens(viewerPort)));
          await until('the agent stops listening', async () => !(await listens(s.agentPort)));
        } finally {
          // The id is `cmd.exe`'s, with Spectra and the agent under it.
          if (existsSync(pidFile)) {
            const pid = Number(readFileSync(pidFile, 'utf8'));
            if (alive(pid)) spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F']);
          }
        }
      },
    );
  });
}
