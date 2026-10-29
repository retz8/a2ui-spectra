/**
 * The stub agent of the conformance workspace, started for the end-to-end
 * tests with its canned A2UI conversation. The conformance workspace builds it.
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

/** Starts the stub agent with its canned A2UI conversation and resolves once it listens. */
export function startStub(port: number, flags: string[]): Promise<ChildProcess> {
  const stub = spawn(
    process.execPath,
    [stubScript, '--port', String(port), '--canned-a2ui', ...flags],
    {stdio: ['ignore', 'pipe', 'pipe']},
  );
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
