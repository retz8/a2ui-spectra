/**
 * The stub agent of the conformance workspace, started for the end-to-end
 * tests with its canned A2UI conversation or another behaviour. The
 * conformance workspace builds it.
 */
import {type ChildProcess, spawn} from 'node:child_process';
import {after} from 'node:test';
import {fileURLToPath} from 'node:url';

const stubScript = fileURLToPath(
  new URL('../../../../conformance/dist/stub_agent/stub_agent.js', import.meta.url),
);

const stubs = new Set<ChildProcess>();
after(() => {
  for (const stub of stubs) stub.kill('SIGKILL');
});

/** Starts the stub agent with a behaviour, its canned A2UI conversation by default, and resolves once it listens. */
export function startStub(
  port: number,
  flags: string[],
  behaviour: '--canned-a2ui' | '--flawed-booking' = '--canned-a2ui',
): Promise<ChildProcess> {
  const stub = spawn(process.execPath, [stubScript, '--port', String(port), behaviour, ...flags], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  stubs.add(stub);
  return new Promise((resolve, reject) => {
    let output = '';
    const onData = (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.includes('Spectra stub agent at')) resolve(stub);
    };
    stub.stdout.on('data', onData);
    stub.stderr.on('data', onData);
    stub.once('exit', code => reject(new Error(`The stub agent exited with ${code}:\n${output}`)));
  });
}
