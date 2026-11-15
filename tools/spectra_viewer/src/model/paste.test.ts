import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {pasteBlocksOf} from './paste.ts';

const variables = [
  {name: 'ANTHROPIC_BASE_URL', value: 'http://127.0.0.1:9822/ANTHROPIC_BASE_URL'},
  {name: 'OTEL_EXPORTER_OTLP_PROTOCOL', value: 'http/protobuf'},
];

describe('the first screen’s variables', () => {
  it('are one block of NAME=value on macOS and Linux, copied as POSIX exports', () => {
    assert.deepEqual(pasteBlocksOf(variables), [
      {
        caption: 'To see model and tool calls, set these in the agent’s shell',
        copyLabel: 'Copy the variables',
        lines: [
          'ANTHROPIC_BASE_URL=http://127.0.0.1:9822/ANTHROPIC_BASE_URL',
          'OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf',
        ],
        copied:
          'export ANTHROPIC_BASE_URL=http://127.0.0.1:9822/ANTHROPIC_BASE_URL\n' +
          'export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf',
      },
    ]);
  });

  it('are a PowerShell block and a cmd block on Windows, each copied as it shows', () => {
    const [powershell, cmd] = pasteBlocksOf(variables, ['powershell', 'cmd']);
    assert.equal(powershell.caption, 'In PowerShell');
    assert.equal(powershell.copyLabel, 'Copy the variables for PowerShell');
    assert.deepEqual(powershell.lines, [
      "$env:ANTHROPIC_BASE_URL = 'http://127.0.0.1:9822/ANTHROPIC_BASE_URL'",
      "$env:OTEL_EXPORTER_OTLP_PROTOCOL = 'http/protobuf'",
    ]);
    assert.equal(powershell.copied, powershell.lines.join('\n'));
    assert.equal(cmd.caption, 'In cmd');
    assert.equal(cmd.copyLabel, 'Copy the variables for cmd');
    assert.deepEqual(cmd.lines, [
      'set "ANTHROPIC_BASE_URL=http://127.0.0.1:9822/ANTHROPIC_BASE_URL"',
      'set "OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf"',
    ]);
  });
});
