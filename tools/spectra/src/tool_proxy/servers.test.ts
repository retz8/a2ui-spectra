import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  exportLines,
  startLines,
  toolEnvironmentOf,
  ToolServerError,
  toolServers,
  toolVariablesOf,
} from './servers.js';

const CONFIGURED = [
  {variable: 'FLOOR_PLAN_SERVER_URL', url: new URL('http://127.0.0.1:8000/sse')},
  {variable: 'CIRCLECI_MCP_URL', url: new URL('https://mcp.circleci.com/v1/mcp?token=secret')},
];

describe('toolServers', () => {
  it("points each variable at its own port, followed by the original's path and query", () => {
    const servers = toolServers(CONFIGURED, [9823, 9824], {});
    assert.deepEqual(toolEnvironmentOf(servers), {
      FLOOR_PLAN_SERVER_URL: 'http://127.0.0.1:9823/sse',
      CIRCLECI_MCP_URL: 'http://127.0.0.1:9824/v1/mcp?token=secret',
    });
    assert.equal(servers[1].original.origin, 'https://mcp.circleci.com');
    assert.deepEqual(toolVariablesOf(servers), [
      {name: 'FLOOR_PLAN_SERVER_URL', value: 'http://127.0.0.1:9823/sse'},
      {name: 'CIRCLECI_MCP_URL', value: 'http://127.0.0.1:9824/v1/mcp?token=secret'},
    ]);
  });

  it("takes the environment's value as the original, unless it is blank or the tool proxy itself", () => {
    const [moved] = toolServers(CONFIGURED.slice(0, 1), [9823], {
      FLOOR_PLAN_SERVER_URL: 'http://localhost:8001/sse',
    });
    assert.equal(moved.original.href, 'http://localhost:8001/sse');
    for (const value of ['  ', 'http://127.0.0.1:9823/sse', 'http://localhost:9823/sse']) {
      const [kept] = toolServers(CONFIGURED.slice(0, 1), [9823], {FLOOR_PLAN_SERVER_URL: value});
      assert.equal(kept.original.href, 'http://127.0.0.1:8000/sse', value);
    }
    assert.throws(
      () => toolServers(CONFIGURED.slice(0, 1), [9823], {FLOOR_PLAN_SERVER_URL: 'not a url'}),
      (error: unknown) =>
        error instanceof ToolServerError &&
        /sets FLOOR_PLAN_SERVER_URL to 'not a url'/.test(error.message),
    );
  });

  it('prints a start line and an export line per server, credentials removed from where it forwards', () => {
    const servers = toolServers(CONFIGURED, [9823, 9824], {});
    assert.deepEqual(startLines(servers), [
      'The tool proxy for FLOOR_PLAN_SERVER_URL is at http://127.0.0.1:9823, forwarding to http://127.0.0.1:8000',
      'The tool proxy for CIRCLECI_MCP_URL is at http://127.0.0.1:9824, forwarding to https://mcp.circleci.com',
    ]);
    assert.deepEqual(exportLines(servers), [
      'export FLOOR_PLAN_SERVER_URL=http://127.0.0.1:9823/sse  # forwards to http://127.0.0.1:8000/sse',
      'export CIRCLECI_MCP_URL=http://127.0.0.1:9824/v1/mcp?token=secret  # forwards to https://mcp.circleci.com/v1/mcp?token=REMOVED',
    ]);
  });
});
