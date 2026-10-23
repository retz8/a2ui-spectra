import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {DEFAULT_PROXY_PORT, DEFAULT_VIEWER_PORT, parseCommandLine, UsageError} from './args.js';

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
    assert.equal(commandLine.options.agentUrl.href, 'http://localhost:10002/');
    assert.equal(commandLine.options.port, DEFAULT_VIEWER_PORT);
    assert.equal(commandLine.options.proxyPort, DEFAULT_PROXY_PORT);
    assert.equal(commandLine.options.open, true);
    assert.deepEqual(commandLine.options.allowedHosts, []);
  });

  it('reads every option', () => {
    const commandLine = parseCommandLine([
      'attach',
      'https://agent.example/a2a',
      '--port',
      '7000',
      '--proxy-port',
      '7001',
      '--no-open',
      '--allow-host',
      'One.Example',
      '--allow-host',
      'two.example',
    ]);
    assert.ok(commandLine.name === 'attach');
    assert.equal(commandLine.options.port, 7000);
    assert.equal(commandLine.options.proxyPort, 7001);
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
    assert.equal(commandLine.options.agentUrl.href, 'http://localhost:10004/');
    assert.equal(commandLine.options.open, false);
    assert.equal(commandLine.options.port, DEFAULT_VIEWER_PORT);
    assert.equal(commandLine.command, 'uv');
    assert.deepEqual(commandLine.args, ['run', '.', '--port', '10004']);
  });

  it('rejects what it cannot run', () => {
    usageError([], /No command/);
    usageError(['serve'], /Unknown command 'serve'/);
    usageError(['--verbose'], /Unknown option '--verbose'/);
    usageError(['attach'], /needs the agent's URL/);
    usageError(['attach', 'http://a', 'http://b'], /Unexpected argument/);
    usageError(['attach', 'http://a', '--', 'uv'], /no command after '--'/);
    usageError(['attach', 'http://a', '--agent-url', 'http://b'], /agent-url/);
    usageError(['attach', 'localhost:10002'], /must start with http/);
    usageError(['attach', 'not a url'], /is not a URL/);
    usageError(['attach', 'http://a', '--port', '0'], /--port must be a port/);
    usageError(['attach', 'http://a', '--port', '9821'], /different ports/);
    usageError(
      ['attach', 'http://a', '--allow-host', 'http://x.example'],
      /--allow-host takes a host name/,
    );
    usageError(['run', '--', 'uv', 'run', '.'], /--agent-url/);
    usageError(['run', '--agent-url', 'http://a'], /after '--'/);
    usageError(['run', '--agent-url', 'http://a', '--'], /after '--'/);
    usageError(['run', '--agent-url', 'http://a', 'uv', 'run', '.'], /goes after '--'/);
  });

  it('names the command whose help to show', () => {
    assert.throws(
      () => parseCommandLine(['run', '--agent-url', 'http://a']),
      (error: unknown) => error instanceof UsageError && error.topic === 'run',
    );
  });
});
