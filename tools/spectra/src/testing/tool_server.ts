/**
 * Spectra's own tool server, of the conformance workspace, started for the
 * tool capture suite. The conformance workspace builds it.
 */
import {type ChildProcess, spawn} from 'node:child_process';
import {after} from 'node:test';
import {fileURLToPath} from 'node:url';

const script = fileURLToPath(
  new URL('../../../../conformance/dist/tool_server/tool_server.js', import.meta.url),
);

const running = new Set<ChildProcess>();
after(() => {
  for (const child of running) child.kill('SIGKILL');
});

/** Starts the tool server on a port, and resolves with its origin once it listens. */
export function startToolServer(
  port: number,
): Promise<{origin: string; process: ChildProcess; output: () => string}> {
  const child = spawn(process.execPath, [script, '--port', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  running.add(child);
  let output = '';
  return new Promise((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.includes('Spectra tool server at')) {
        resolve({origin: `http://127.0.0.1:${port}`, process: child, output: () => output});
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('exit', code =>
      reject(new Error(`The tool server exited with ${code}:\n${output}`)),
    );
  });
}
