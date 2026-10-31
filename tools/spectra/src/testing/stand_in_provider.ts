/**
 * The stand-in provider of the conformance workspace, started for the model
 * capture suite with the HAR files it plays. The conformance workspace
 * builds it.
 */
import {type ChildProcess, spawn} from 'node:child_process';
import {after} from 'node:test';
import {fileURLToPath} from 'node:url';

const script = fileURLToPath(
  new URL('../../../../conformance/dist/stand_in_provider/stand_in_provider.js', import.meta.url),
);

const running = new Set<ChildProcess>();
after(() => {
  for (const child of running) child.kill('SIGKILL');
});

/** Starts the stand-in on a port with the HAR files, and resolves with its origin once it listens. */
export function startStandIn(
  port: number,
  harFiles: string[],
): Promise<{origin: string; process: ChildProcess; output: () => string}> {
  const child = spawn(
    process.execPath,
    [script, '--port', String(port), ...harFiles.flatMap(file => ['--har', file])],
    {stdio: ['ignore', 'pipe', 'pipe']},
  );
  running.add(child);
  let output = '';
  return new Promise((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.includes('Spectra stand-in provider at')) {
        resolve({origin: `http://127.0.0.1:${port}`, process: child, output: () => output});
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('exit', code =>
      reject(new Error(`The stand-in provider exited with ${code}:\n${output}`)),
    );
  });
}
