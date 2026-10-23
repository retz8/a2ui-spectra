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
    assert.deepEqual(await fetchAgentCard(cardOf('/ready')), {name: 'Ready'});
  });

  it('returns nothing for an error, a non-JSON answer or no answer', async () => {
    assert.equal(await fetchAgentCard(cardOf('/missing')), undefined);
    assert.equal(await fetchAgentCard(cardOf('/html')), undefined);
    assert.equal(
      await fetchAgentCard(new URL('http://127.0.0.1:1/.well-known/agent-card.json')),
      undefined,
    );
  });

  it('waits until the card answers, saying so once', async () => {
    answers = 0;
    let waitingMessages = 0;
    const card = await waitForAgentCard(cardOf('/late'), {
      signal: new AbortController().signal,
      onWaiting: () => waitingMessages++,
      intervalMs: 10,
    });
    assert.deepEqual(card, {name: 'Late'});
    assert.equal(waitingMessages, 1);
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
