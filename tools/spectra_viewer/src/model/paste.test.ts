import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {pasteBlocksOf} from './paste.ts';

const RECEIVER = "for Spectra's OpenTelemetry receiver";
const variables = [
  {
    name: 'ANTHROPIC_BASE_URL',
    value: 'http://127.0.0.1:9822/ANTHROPIC_BASE_URL',
    note: 'forwards to https://api.anthropic.com',
  },
  {name: 'OTEL_EXPORTER_OTLP_ENDPOINT', value: 'http://127.0.0.1:9823', note: RECEIVER},
  {name: 'OTEL_EXPORTER_OTLP_PROTOCOL', value: 'http/protobuf', note: RECEIVER},
];

/** A block's lines as they read, a comment marked. */
function shown(lines: ReadonlyArray<{text: string; comment: boolean}>): string[] {
  return lines.map(({text, comment}) => (comment ? `(muted) ${text}` : text));
}

describe('the first screen’s variables', () => {
  it('are one block of NAME=value on macOS and Linux, each note a comment above the variables it is said of, copied as POSIX exports', () => {
    const [posix, ...others] = pasteBlocksOf(variables);
    assert.equal(others.length, 0);
    assert.equal(posix.caption, 'To see model and tool calls, set these in the agent’s shell');
    assert.equal(posix.copyLabel, 'Copy the variables');
    assert.deepEqual(shown(posix.lines), [
      '(muted) # forwards to https://api.anthropic.com',
      'ANTHROPIC_BASE_URL=http://127.0.0.1:9822/ANTHROPIC_BASE_URL',
      "(muted) # for Spectra's OpenTelemetry receiver",
      'OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:9823',
      'OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf',
    ]);
    assert.equal(
      posix.copied,
      '# forwards to https://api.anthropic.com\n' +
        'export ANTHROPIC_BASE_URL=http://127.0.0.1:9822/ANTHROPIC_BASE_URL\n' +
        "# for Spectra's OpenTelemetry receiver\n" +
        'export OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:9823\n' +
        'export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf',
    );
  });

  it('are a PowerShell block with the notes and a cmd block without, as attach prints them on Windows, each copied as it shows', () => {
    const [powershell, cmd] = pasteBlocksOf(variables, ['powershell', 'cmd']);
    assert.equal(powershell.caption, 'In PowerShell');
    assert.equal(powershell.copyLabel, 'Copy the variables for PowerShell');
    assert.deepEqual(shown(powershell.lines), [
      '(muted) # forwards to https://api.anthropic.com',
      "$env:ANTHROPIC_BASE_URL = 'http://127.0.0.1:9822/ANTHROPIC_BASE_URL'",
      "(muted) # for Spectra's OpenTelemetry receiver",
      "$env:OTEL_EXPORTER_OTLP_ENDPOINT = 'http://127.0.0.1:9823'",
      "$env:OTEL_EXPORTER_OTLP_PROTOCOL = 'http/protobuf'",
    ]);
    assert.equal(powershell.copied, powershell.lines.map(({text}) => text).join('\n'));
    assert.equal(cmd.caption, 'In cmd');
    assert.equal(cmd.copyLabel, 'Copy the variables for cmd');
    assert.deepEqual(shown(cmd.lines), [
      'set "ANTHROPIC_BASE_URL=http://127.0.0.1:9822/ANTHROPIC_BASE_URL"',
      'set "OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:9823"',
      'set "OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf"',
    ]);
    assert.equal(cmd.copied, cmd.lines.map(({text}) => text).join('\n'));
  });

  it('show a variable with no note on its own line, as a Spectra that sends none serves it', () => {
    const [posix] = pasteBlocksOf([{name: 'A', value: '1'}]);
    assert.deepEqual(shown(posix.lines), ['A=1']);
    assert.equal(posix.copied, 'export A=1');
  });
});
