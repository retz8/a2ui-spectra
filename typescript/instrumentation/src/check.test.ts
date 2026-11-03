/** The pinned-API check: the SDK resolves, its version is at least the floor, and every hooked name is there. */

import assert from 'node:assert/strict';
import {cp, mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import * as path from 'node:path';
import {afterEach, describe, it} from 'node:test';

import {atLeast} from './check.js';
import {instrument, uninstrument} from './index.js';
import {
  Capture,
  childEnv,
  hooked,
  OPENTELEMETRY,
  PACKAGE,
  runNode,
  sdk,
  Warnings,
} from './testing/support.js';

afterEach(() => uninstrument());

/**
 * Switches the wrapper on in a subprocess whose `node_modules` holds the
 * wrapper, OpenTelemetry, and a stub `@a2ui/agent` at a version or none, and
 * returns the warnings it wrote.
 */
async function warningsWith(stubVersion: string | undefined): Promise<string[]> {
  const dir = await mkdtemp(path.join(tmpdir(), 'a2ui-spectra-instrumentation-'));
  try {
    const modules = path.join(dir, 'node_modules');
    const wrapper = path.join(modules, 'a2ui-spectra-instrumentation');
    await mkdir(wrapper, {recursive: true});
    await cp(path.join(PACKAGE, 'package.json'), path.join(wrapper, 'package.json'));
    await cp(path.join(PACKAGE, 'dist'), path.join(wrapper, 'dist'), {
      recursive: true,
      filter: source => !source.includes('.test.') && !source.includes(`${path.sep}testing`),
    });
    await symlink(OPENTELEMETRY, path.join(modules, '@opentelemetry'), 'dir');
    if (stubVersion !== undefined) {
      const agent = path.join(modules, '@a2ui', 'agent');
      await mkdir(agent, {recursive: true});
      await writeFile(
        path.join(agent, 'package.json'),
        JSON.stringify({
          name: '@a2ui/agent',
          version: stubVersion,
          type: 'module',
          exports: {'.': './index.js'},
        }),
      );
      await writeFile(path.join(agent, 'index.js'), 'export class Parser {}\n');
    }
    const child = [
      'process.on("warning", warning => console.log(JSON.stringify(warning.message)));',
      'const {instrument} = await import("a2ui-spectra-instrumentation");',
      'instrument();',
    ].join('\n');
    const {code, stdout, stderr} = await runNode(['--input-type=module', '-e', child], {
      cwd: dir,
      env: childEnv(),
    });
    assert.equal(code, 0, stderr);
    return stdout
      .trim()
      .split('\n')
      .filter(line => line !== '')
      .map(line => JSON.parse(line) as string);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
}

describe('the pinned-API check', () => {
  it('a hooked name missing from its prototype: nothing patched, one warning', async () => {
    const prototype = sdk.RendererState.prototype as unknown as Record<string, unknown>;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'markChecked');
    assert.ok(descriptor);
    delete prototype.markChecked;
    const warnings = new Warnings();
    try {
      instrument({tracerProvider: new Capture().provider});
      const lines = await warnings.settled();
      assert.equal(lines.length, 1);
      assert.match(
        lines[0],
        /left @a2ui\/agent 0\.1\.0 unpatched: RendererState\.markChecked is missing/,
      );
      assert.match(
        lines[0],
        /written against @a2ui\/agent 0\.1\.0, upstream's release of 2026-11-02/,
      );
    } finally {
      warnings.stop();
      Object.defineProperty(prototype, 'markChecked', descriptor);
    }
    assert.ok(hooked().every(on => !on));
  });

  it('the SDK below the floor, its version read from its package.json: one warning', async () => {
    const lines = await warningsWith('0.0.2');
    assert.equal(lines.length, 1);
    assert.match(lines[0], /left @a2ui\/agent 0\.0\.2 unpatched: it is below the version floor/);
    assert.match(lines[0], /\(@a2ui\/agent >= 0\.1\.0\)/);
  });

  it('the SDK not installed: one warning', async () => {
    const lines = await warningsWith(undefined);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /left @a2ui\/agent \(not installed\) unpatched: it is not installed/);
  });

  it('the floor: a release at or past it passes, a prerelease of it does not', () => {
    assert.ok(atLeast('0.1.0', '0.1.0'));
    assert.ok(atLeast('0.1.1', '0.1.0'));
    assert.ok(atLeast('1.0.0', '0.1.0'));
    assert.ok(!atLeast('0.0.2', '0.1.0'));
    assert.ok(!atLeast('0.1.0-rc.0', '0.1.0'));
    assert.ok(!atLeast('not a version', '0.1.0'));
  });
});
