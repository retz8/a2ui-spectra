/**
 * Ports for the servers the tests start, each given once and to one caller.
 *
 * A port found by listening on port 0 and closing is free again until the
 * test's server takes it, and the system hands that range to every outgoing
 * connection and to every other listener on port 0, the other test files'
 * included, which run as processes side by side. The ports here are below
 * that range, 32768 to 60999 by default on Linux and 49152 to 65535 on macOS,
 * and each process takes them from a slice of its own, which it holds by
 * listening on the slice's first port until it exits.
 */
import {createServer, type Server} from 'node:net';

const FIRST_PORT = 20000;
const SLICE_SIZE = 100;
const SLICE_COUNT = 100;

/** The port after the last one given, and the end of this process's slice. */
let next = 0;
let end = 0;
let last: Promise<unknown> = Promise.resolve();

/** A listener on the port, on loopback, or nothing when the port is taken. */
function listenOn(port: number): Promise<Server | undefined> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', (error: NodeJS.ErrnoException) =>
      error.code === 'EADDRINUSE' ? resolve(undefined) : reject(error),
    );
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

/** Takes a slice no other process holds, and keeps its first port for as long as this process runs. */
async function holdSlice(): Promise<void> {
  for (let i = 0; i < SLICE_COUNT; i++) {
    const first = FIRST_PORT + ((process.pid + i) % SLICE_COUNT) * SLICE_SIZE;
    const held = await listenOn(first);
    if (held === undefined) continue;
    held.unref();
    next = first + 1;
    end = first + SLICE_SIZE;
    return;
  }
  throw new Error(
    `No ports left for the tests between ${FIRST_PORT} and ${FIRST_PORT + SLICE_COUNT * SLICE_SIZE - 1}.`,
  );
}

async function take(): Promise<number> {
  for (;;) {
    if (next === end) await holdSlice();
    const port = next++;
    const server = await listenOn(port);
    if (server === undefined) continue;
    await new Promise(resolve => server.close(resolve));
    return port;
  }
}

/** A port nothing listens on, given to no other caller in this process or in another running beside it. */
export function freePort(): Promise<number> {
  const port = last.then(take, take);
  last = port;
  return port;
}
