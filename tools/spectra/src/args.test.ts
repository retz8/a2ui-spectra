import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  agentUrlOf,
  DEFAULT_MODEL_PROXY_PORT,
  DEFAULT_PROXY_PORT,
  DEFAULT_RECEIVER_PORT,
  DEFAULT_TOOL_PROXY_PORT,
  DEFAULT_VIEWER_PORT,
  parseCommandLine,
  toolProxyPorts,
  UsageError,
} from './args.js';

function usageError(argv: string[], pattern: RegExp) {
  assert.throws(
    () => parseCommandLine(argv),
    (error: unknown) => error instanceof UsageError && pattern.test(error.message),
  );
}

describe('parseCommandLine', () => {
  it('reads help and version', () => {
    assert.deepEqual(parseCommandLine(['--help']), {name: 'help'});
    assert.deepEqual(parseCommandLine(['--version']), {name: 'version'});
    assert.deepEqual(parseCommandLine(['attach', '--help']), {
      name: 'help',
      topic: 'attach',
    });
    assert.deepEqual(parseCommandLine(['run', '--help']), {
      name: 'help',
      topic: 'run',
    });
  });

  it("reads attach with the agent's URL and the defaults", () => {
    const commandLine = parseCommandLine(['attach', 'http://localhost:10002']);
    assert.equal(commandLine.name, 'attach');
    assert.ok(commandLine.name === 'attach');
    assert.equal(commandLine.options.agentUrl?.href, 'http://localhost:10002/');
    assert.equal(commandLine.options.port, DEFAULT_VIEWER_PORT);
    assert.equal(commandLine.options.proxyPort, DEFAULT_PROXY_PORT);
    assert.equal(commandLine.options.toolProxyPort, DEFAULT_TOOL_PROXY_PORT);
    assert.equal(commandLine.options.receiverPort, DEFAULT_RECEIVER_PORT);
    assert.equal(DEFAULT_RECEIVER_PORT, 9823);
    assert.equal(DEFAULT_TOOL_PROXY_PORT, 9824);
    assert.equal(commandLine.options.open, true);
    assert.deepEqual(commandLine.options.allowedHosts, []);
    assert.equal(commandLine.options.config, undefined);
  });

  it("reads attach and run without the agent's URL, which the config file may then give", () => {
    const attach = parseCommandLine(['attach', '--config', 'spectra/config.json']);
    assert.ok(attach.name === 'attach');
    assert.equal(attach.options.agentUrl, undefined);
    assert.equal(attach.options.config, 'spectra/config.json');
    const run = parseCommandLine(['run', '--', 'uv', 'run', '.']);
    assert.ok(run.name === 'run');
    assert.equal(run.options.agentUrl, undefined);
    assert.equal(run.options.config, undefined);
    assert.equal(run.command, 'uv');
  });

  it('reads every option', () => {
    const commandLine = parseCommandLine([
      'attach',
      'https://agent.example/a2a',
      '--port',
      '7000',
      '--proxy-port',
      '7001',
      '--tool-proxy-port',
      '7003',
      '--receiver-port',
      '7004',
      '--no-open',
      '--allow-host',
      'One.Example',
      '--allow-host',
      'two.example',
    ]);
    assert.ok(commandLine.name === 'attach');
    assert.equal(commandLine.options.port, 7000);
    assert.equal(commandLine.options.proxyPort, 7001);
    assert.equal(commandLine.options.toolProxyPort, 7003);
    assert.equal(commandLine.options.receiverPort, 7004);
    assert.equal(commandLine.options.open, false);
    assert.deepEqual(commandLine.options.allowedHosts, ['one.example', 'two.example']);
  });

  it("reads run with the agent's command after --, untouched", () => {
    const commandLine = parseCommandLine([
      'run',
      '--agent-url',
      'http://localhost:10004',
      '--no-open',
      '--',
      'uv',
      'run',
      '.',
      '--port',
      '10004',
    ]);
    assert.ok(commandLine.name === 'run');
    assert.equal(commandLine.options.agentUrl?.href, 'http://localhost:10004/');
    assert.equal(commandLine.options.open, false);
    assert.equal(commandLine.options.port, DEFAULT_VIEWER_PORT);
    assert.equal(commandLine.command, 'uv');
    assert.deepEqual(commandLine.args, ['run', '.', '--port', '10004']);
  });

  it('rejects what it cannot run', () => {
    usageError([], /No command/);
    usageError(['serve'], /Unknown command 'serve'/);
    usageError(['--verbose'], /Unknown option '--verbose'/);
    usageError(['attach', 'http://a', 'http://b'], /Unexpected argument/);
    usageError(['attach', 'http://a', '--', 'uv'], /no command after '--'/);
    usageError(['attach', 'http://a', '--agent-url', 'http://b'], /agent-url/);
    usageError(['attach', 'localhost:10002'], /must start with http/);
    usageError(['attach', 'not a url'], /is not a URL/);
    usageError(['attach', 'http://a', '--port', '0'], /--port must be a port/);
    usageError(['attach', 'http://a', '--port', '9821'], /different ports/);
    usageError(
      ['attach', 'http://a', '--model-proxy-port', '9821'],
      /--proxy-port and --model-proxy-port are both 9821/,
    );
    usageError(
      ['run', '--agent-url', 'http://a', '--port', '9822', '--', 'x'],
      /--port and --model-proxy-port/,
    );
    usageError(
      ['attach', 'http://a', '--tool-proxy-port', '9820'],
      /--port and --tool-proxy-port are both 9820/,
    );
    usageError(
      ['attach', 'http://a', '--receiver-port', '9822'],
      /--model-proxy-port and --receiver-port are both 9822/,
    );
    usageError(['attach', 'http://a', '--receiver-port', 'x'], /--receiver-port must be a port/);
    usageError(
      ['attach', 'http://a', '--allow-host', 'http://x.example'],
      /--allow-host takes a host name/,
    );
    usageError(['run', '--agent-url', 'http://a'], /after '--'/);
    usageError(['run', '--agent-url', 'http://a', '--'], /after '--'/);
    usageError(['run', '--agent-url', 'http://a', 'uv', 'run', '.'], /goes after '--'/);
  });

  it("takes the agent's URL from the command line first, then the config file", () => {
    const config = {
      agentUrl: new URL('http://localhost:10002/'),
      headers: {},
      catalogs: [],
      catalogPaths: [],
      preview: [],
      tools: [],
      prices: {},
      fixtures: '/tmp/a2ui-spectra-fixtures',
      watch: {paths: ['/tmp'], excluded: []},
    };
    const attach = parseCommandLine(['attach']);
    assert.ok(attach.name === 'attach');
    assert.equal(agentUrlOf(attach.options, config, 'attach').href, 'http://localhost:10002/');
    const given = parseCommandLine(['attach', 'http://localhost:10004']);
    assert.ok(given.name === 'attach');
    assert.equal(agentUrlOf(given.options, config, 'attach').href, 'http://localhost:10004/');
    const none = {...config, agentUrl: undefined};
    assert.throws(
      () => agentUrlOf(attach.options, none, 'attach'),
      (error: unknown) =>
        error instanceof UsageError &&
        error.topic === 'attach' &&
        /attach needs the agent's URL: its <agent-url> argument, or agent\.url in a2ui-spectra\.json/.test(
          error.message,
        ),
    );
    const run = parseCommandLine(['run', '--', 'uv', 'run', '.']);
    assert.ok(run.name === 'run');
    assert.throws(
      () => agentUrlOf(run.options, none, 'run'),
      (error: unknown) =>
        error instanceof UsageError &&
        error.topic === 'run' &&
        /run needs the agent's URL: --agent-url, or agent\.url in a2ui-spectra\.json/.test(
          error.message,
        ),
    );
  });

  it('gives each tool server the next port from --tool-proxy-port, apart from the other ports', () => {
    const attach = parseCommandLine(['attach', 'http://a', '--port', '9826']);
    assert.ok(attach.name === 'attach');
    assert.deepEqual(toolProxyPorts(attach.options, 0, 'attach'), []);
    assert.deepEqual(toolProxyPorts(attach.options, 2, 'attach'), [9824, 9825]);
    assert.throws(
      () => toolProxyPorts(attach.options, 3, 'attach'),
      (error: unknown) =>
        error instanceof UsageError &&
        /The tool proxy's ports, 9824 to 9826 for the 3 tool servers in the config file, include --port's 9826/.test(
          error.message,
        ),
    );
    // The tool proxy's ports come after every other default, so any number of tool servers fits.
    const defaults = parseCommandLine(['attach', 'http://a']);
    assert.ok(defaults.name === 'attach');
    assert.deepEqual(toolProxyPorts(defaults.options, 3, 'attach'), [9824, 9825, 9826]);
    const high = parseCommandLine(['attach', 'http://a', '--tool-proxy-port', '65535']);
    assert.ok(high.name === 'attach');
    assert.deepEqual(toolProxyPorts(high.options, 1, 'attach'), [65535]);
    assert.throws(
      () => toolProxyPorts(high.options, 2, 'attach'),
      (error: unknown) => error instanceof UsageError && /past 65535/.test(error.message),
    );
  });

  it('names the command whose help to show', () => {
    assert.throws(
      () => parseCommandLine(['run', '--agent-url', 'http://a']),
      (error: unknown) => error instanceof UsageError && error.topic === 'run',
    );
  });
});

describe('the headless commands', () => {
  it("reads replay with the record's file and the defaults", () => {
    const commandLine = parseCommandLine(['replay', 'fixtures/greet-ada.json']);
    assert.ok(commandLine.name === 'replay');
    assert.equal(commandLine.file, 'fixtures/greet-ada.json');
    assert.equal(commandLine.modelLive, false);
    assert.equal(commandLine.command, undefined);
    assert.equal(commandLine.options.agentUrl, undefined);
    assert.equal(commandLine.options.config, undefined);
    assert.equal(commandLine.options.proxyPort, DEFAULT_PROXY_PORT);
    assert.equal(commandLine.options.modelProxyPort, DEFAULT_MODEL_PROXY_PORT);
    assert.equal(commandLine.options.toolProxyPort, DEFAULT_TOOL_PROXY_PORT);
    assert.equal(commandLine.options.receiverPort, DEFAULT_RECEIVER_PORT);
    assert.ok(!('port' in commandLine.options));
    assert.ok(!('open' in commandLine.options));
    assert.ok(!('allowedHosts' in commandLine.options));
  });

  it("reads replay with every option and the agent's command after --, untouched", () => {
    const commandLine = parseCommandLine([
      'replay',
      'greet-ada.json',
      '--model-live',
      '--agent-url',
      'http://localhost:10004',
      '--config',
      'spectra/config.json',
      '--proxy-port',
      '7001',
      '--model-proxy-port',
      '7002',
      '--tool-proxy-port',
      '7003',
      '--receiver-port',
      '7004',
      '--',
      'uv',
      'run',
      '.',
      '--port',
      '10004',
    ]);
    assert.ok(commandLine.name === 'replay');
    assert.equal(commandLine.file, 'greet-ada.json');
    assert.equal(commandLine.modelLive, true);
    assert.equal(commandLine.options.agentUrl?.href, 'http://localhost:10004/');
    assert.equal(commandLine.options.config, 'spectra/config.json');
    assert.equal(commandLine.options.proxyPort, 7001);
    assert.equal(commandLine.options.modelProxyPort, 7002);
    assert.equal(commandLine.options.toolProxyPort, 7003);
    assert.equal(commandLine.options.receiverPort, 7004);
    assert.deepEqual(commandLine.command, {command: 'uv', args: ['run', '.', '--port', '10004']});
  });

  it('reads test with and without the folder', () => {
    const bare = parseCommandLine(['test']);
    assert.ok(bare.name === 'test');
    assert.equal(bare.folder, undefined);
    assert.equal(bare.command, undefined);
    assert.equal(bare.options.proxyPort, DEFAULT_PROXY_PORT);
    const given = parseCommandLine(['test', 'ci/fixtures', '--agent-url', 'http://localhost:1']);
    assert.ok(given.name === 'test');
    assert.equal(given.folder, 'ci/fixtures');
    assert.equal(given.options.agentUrl?.href, 'http://localhost:1/');
    const launched = parseCommandLine(['test', '--', 'node', 'agent.js']);
    assert.ok(launched.name === 'test');
    assert.equal(launched.folder, undefined);
    assert.deepEqual(launched.command, {command: 'node', args: ['agent.js']});
  });

  it('names the command whose help to show', () => {
    assert.deepEqual(parseCommandLine(['replay', '--help']), {name: 'help', topic: 'replay'});
    assert.deepEqual(parseCommandLine(['test', '--help']), {name: 'help', topic: 'test'});
    assert.throws(
      () => parseCommandLine(['replay']),
      (error: unknown) => error instanceof UsageError && error.topic === 'replay',
    );
    assert.throws(
      () => parseCommandLine(['test', '--model-live']),
      (error: unknown) => error instanceof UsageError && error.topic === 'test',
    );
  });

  it('rejects what it cannot run', () => {
    usageError(['replay'], /replay needs the record's file/);
    usageError(['replay', 'a.json', 'b.json'], /Unexpected argument 'b.json'/);
    usageError(['replay', 'a.json', '--port', '1'], /Unknown option '--port'/);
    usageError(['replay', 'a.json', '--no-open'], /Unknown option '--no-open'/);
    usageError(['replay', 'a.json', '--allow-host', 'x'], /Unknown option '--allow-host'/);
    usageError(['test', '--model-live'], /Unknown option '--model-live'/);
    usageError(['test', 'a', 'b'], /Unexpected argument 'b'/);
    usageError(['replay', 'a.json', '--'], /after '--'/);
    usageError(['test', '--'], /after '--'/);
    usageError(
      ['replay', 'a.json', '--proxy-port', '9822'],
      /--proxy-port and --model-proxy-port are both 9822/,
    );
    usageError(['test', '--agent-url', 'not a url'], /is not a URL/);
  });

  it("asks replay and test for the agent's URL as --agent-url", () => {
    const config = {
      headers: {},
      catalogs: [],
      catalogPaths: [],
      preview: [],
      tools: [],
      prices: {},
      fixtures: '/tmp/fixtures',
      watch: {paths: ['/tmp'], excluded: []},
    };
    const options = {
      proxyPort: DEFAULT_PROXY_PORT,
      modelProxyPort: DEFAULT_MODEL_PROXY_PORT,
      toolProxyPort: DEFAULT_TOOL_PROXY_PORT,
      receiverPort: DEFAULT_RECEIVER_PORT,
    };
    assert.throws(
      () => agentUrlOf(options, config, 'replay'),
      (error: unknown) =>
        error instanceof UsageError &&
        /replay needs the agent's URL: --agent-url, or agent.url in a2ui-spectra.json/.test(
          error.message,
        ),
    );
    assert.throws(
      () => agentUrlOf(options, config, 'test'),
      (error: unknown) =>
        error instanceof UsageError && /^test needs the agent's URL/.test(error.message),
    );
    assert.deepEqual(toolProxyPorts(options, 2, 'test'), [
      DEFAULT_TOOL_PROXY_PORT,
      DEFAULT_TOOL_PROXY_PORT + 1,
    ]);
  });
});
