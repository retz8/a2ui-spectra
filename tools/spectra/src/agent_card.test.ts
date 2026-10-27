import assert from 'node:assert/strict';
import {createServer, type Server} from 'node:http';
import {after, before, describe, it} from 'node:test';

import {agentCardUrl, fetchAgentCard, waitForAgentCard} from './agent_card.js';

describe('agentCardUrl', () => {
  it("puts the card at the well-known path under the agent's base address", () => {
    const card = (url: string) => agentCardUrl(new URL(url)).href;
    assert.equal(
      card('http://localhost:10002'),
      'http://localhost:10002/.well-known/agent-card.json',
    );
    assert.equal(
      card('http://localhost:10002/'),
      'http://localhost:10002/.well-known/agent-card.json',
    );
    assert.equal(
      card('https://agent.example/agents/finder?x=1#y'),
      'https://agent.example/agents/finder/.well-known/agent-card.json',
    );
  });
});

describe('fetching the card', () => {
  let server: Server;
  let base: string;
  let answers = 0;

  before(async () => {
    server = createServer((request, response) => {
      answers++;
      switch (request.url) {
        case '/ready/.well-known/agent-card.json':
          response.writeHead(200, {'content-type': 'application/json'});
          response.end('{"name": "Ready"}');
          return;
        case '/late/.well-known/agent-card.json':
          if (answers < 3) {
            response.writeHead(503);
            response.end();
          } else {
            response.writeHead(200, {'content-type': 'application/json'});
            response.end('{"name": "Late"}');
          }
          return;
        case '/html/.well-known/agent-card.json':
          response.writeHead(200, {'content-type': 'text/html'});
          response.end('<html></html>');
          return;
        case '/guarded/.well-known/agent-card.json':
          if (request.headers.authorization !== 'Bearer t0k3n') {
            response.writeHead(401);
            response.end();
          } else {
            response.writeHead(200, {'content-type': 'application/json'});
            response.end(JSON.stringify({name: 'Guarded', seen: request.headers['x-tenant']}));
          }
          return;
        case '/changing/.well-known/agent-card.json':
          response.writeHead(answers < 2 ? 503 : 401);
          response.end();
          return;
        default:
          response.writeHead(404);
          response.end();
      }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    assert.ok(typeof address === 'object' && address !== null);
    base = `http://127.0.0.1:${address.port}`;
  });

  after(() => {
    server.closeAllConnections();
    server.close();
  });

  const cardOf = (agentPath: string) => agentCardUrl(new URL(`${base}${agentPath}`));

  it('returns the card when the agent answers with a JSON object', async () => {
    assert.deepEqual(await fetchAgentCard(cardOf('/ready')), {card: {name: 'Ready'}});
  });

  it('names why there is no card: the status, a body that is not JSON, or no answer', async () => {
    assert.deepEqual(await fetchAgentCard(cardOf('/missing')), {missing: 'it answered 404'});
    assert.deepEqual(await fetchAgentCard(cardOf('/html')), {
      missing: 'it answered 200 with no JSON object',
    });
    const unreachable = await fetchAgentCard(
      new URL('http://127.0.0.1:1/.well-known/agent-card.json'),
    );
    assert.ok(unreachable.missing);
    assert.match(unreachable.missing, /^it did not answer \(.+\)$/);
  });

  it('sends the headers it is given with the fetch', async () => {
    assert.deepEqual(await fetchAgentCard(cardOf('/guarded')), {missing: 'it answered 401'});
    assert.deepEqual(
      await fetchAgentCard(cardOf('/guarded'), {
        headers: {Authorization: 'Bearer t0k3n', 'X-Tenant': 'acme'},
      }),
      {card: {name: 'Guarded', seen: 'acme'}},
    );
  });

  it('waits until the card answers, saying why it waits once', async () => {
    answers = 0;
    const reasons: string[] = [];
    const card = await waitForAgentCard(cardOf('/late'), {
      signal: new AbortController().signal,
      onWaiting: reason => reasons.push(reason),
      intervalMs: 10,
    });
    assert.deepEqual(card, {name: 'Late'});
    assert.deepEqual(reasons, ['it answered 503']);
  });

  it('says so again when the reason changes', async () => {
    answers = 0;
    const stop = new AbortController();
    const reasons: string[] = [];
    const card = await waitForAgentCard(cardOf('/changing'), {
      signal: stop.signal,
      onWaiting: reason => {
        reasons.push(reason);
        if (reasons.length === 2) stop.abort();
      },
      intervalMs: 10,
    });
    assert.equal(card, undefined);
    assert.deepEqual(reasons, ['it answered 503', 'it answered 401']);
  });

  it('stops waiting when its signal ends the wait', async () => {
    const stop = new AbortController();
    const waiting = waitForAgentCard(cardOf('/missing'), {
      signal: stop.signal,
      onWaiting: () => stop.abort(),
      intervalMs: 10,
    });
    assert.equal(await waiting, undefined);
  });
});
