// The first run's Node agent. It appends what happens to it to --log:
// `up <pid>` at start, `child <pid>` for a child it starts, and, with
// --handler, `signal <name>` for each console event; on SIGBREAK it then
// exits 0. --child starts a detached long-running child, --orphan exits
// 300 ms after starting it, --exit-code <n> exits with <n> after 300 ms,
// --port <n> listens on 127.0.0.1.
import {spawn} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {parseArgs} from 'node:util';

const {values} = parseArgs({
  options: {
    log: {type: 'string'},
    handler: {type: 'boolean'},
    child: {type: 'boolean'},
    orphan: {type: 'boolean'},
    'exit-code': {type: 'string'},
    port: {type: 'string'},
  },
});
const log = line => appendFileSync(values.log, `${line}\n`);
if (values.handler) {
  process.on('SIGINT', () => log('signal SIGINT'));
  process.on('SIGHUP', () => log('signal SIGHUP'));
  process.on('SIGBREAK', () => {
    log('signal SIGBREAK');
    process.exit(0);
  });
}
log(`up ${process.pid}`);
if (values.child || values.orphan) {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: true,
    stdio: 'ignore',
  });
  log(`child ${child.pid}`);
  if (values.orphan) setTimeout(() => process.exit(0), 300);
}
if (values['exit-code'] !== undefined) {
  setTimeout(() => process.exit(Number(values['exit-code'])), 300);
}
if (values.port !== undefined) {
  createServer((_request, response) => response.end('agent')).listen(
    Number(values.port),
    '127.0.0.1',
  );
}
setInterval(() => {}, 1000);
