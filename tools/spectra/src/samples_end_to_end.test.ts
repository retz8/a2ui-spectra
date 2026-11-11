/**
 * The browser end-to-end test through the sample catalog apps under
 * `samples/preview/`. For the React, Lit and Angular samples in turn: the
 * stub agent holding its canned A2UI conversation, the sample's dev server
 * on the port its `a2ui-spectra.json` names, and Spectra started with that
 * file, driven in Chromium through Playwright. The sample's page draws the
 * stub's surface in the sample catalog; the custom slider is moved and the
 * Button pressed; the pending action is sent; and the turn lands with the
 * stub's reply echoing the volume from the action's context and in the data
 * model. On the way the page is reloaded in its frame, as its dev server
 * reloads it after a save, and draws the surface again; and on the React
 * sample the page is reloaded with its dev server stopped, which the Preview
 * pane says, until the server is back. It runs under Node by default, and against the binary when
 * SPECTRA_BINARY names one. Chromium is installed with Playwright's own
 * command.
 */
import assert from 'node:assert/strict';
import {type ChildProcess, spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {after, before, describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

import {type Browser, chromium, type Page} from 'playwright';

import type {ListedTurn} from './api.js';
import {VARIABLES} from './model_proxy/redirection.js';
import {
  type A2uiPart,
  isEventOfKind,
  type TextPart,
  type Turn,
  type TurnRecord,
  type WireInputEvent,
  type WireOutputEvent,
} from './record/turn_record.js';
import {binary, freePort, SpectraProcess} from './testing/spectra_process.js';
import {startStub} from './testing/stub_agent.js';

const samplesDir = fileURLToPath(new URL('../../../samples/preview/', import.meta.url));
const SAMPLES = ['react', 'lit', 'angular'] as const;
const TIMEOUT = 240_000;

/** The preview page a sample's config file names. */
function pageOf(sample: string): string {
  const config = JSON.parse(
    readFileSync(path.join(samplesDir, sample, 'a2ui-spectra.json'), 'utf8'),
  ) as {preview: string[]};
  assert.equal(config.preview.length, 1);
  return config.preview[0];
}

const servers = new Set<ChildProcess>();
after(() => {
  for (const server of servers) stopServer(server);
});

function stopServer(server: ChildProcess): void {
  // The dev server is the group's leader, so its own children stop with it.
  try {
    process.kill(-server.pid!, 'SIGTERM');
  } catch {
    // Already gone.
  }
  servers.delete(server);
}

/** Starts a sample's dev server, as its README does, and resolves once its page answers. */
async function startDevServer(sample: string, page: string): Promise<ChildProcess> {
  const server = spawn('yarn', ['dev'], {
    cwd: path.join(samplesDir, sample),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  servers.add(server);
  let output = '';
  for (const stream of [server.stdout, server.stderr]) {
    stream.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
  }
  let exited = false;
  server.once('exit', () => (exited = true));
  const deadline = Date.now() + 180_000;
  for (;;) {
    assert.ok(!exited, `The ${sample} sample's dev server exited:\n${output}`);
    try {
      if ((await fetch(page)).ok) return server;
    } catch {
      // Not listening yet.
    }
    assert.ok(Date.now() < deadline, `The ${sample} sample's page did not answer:\n${output}`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

async function getJson<T>(url: string): Promise<T> {
  return (await (await fetch(url)).json()) as T;
}

/** Resolves with the listing once it holds this many turns, every one closed. */
async function turnsClosed(base: string, count: number): Promise<ListedTurn[]> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const {turns} = await getJson<{turns: ListedTurn[]}>(`${base}/api/turns`);
    if (turns.length === count && turns.every(turn => turn.open === undefined)) return turns;
    assert.ok(Date.now() < deadline, `The listing never held ${count} closed turns.`);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

/** The texts of the agent's replies in a turn. */
function textsOf(turn: Turn): string[] {
  return turn.events
    .filter((event): event is WireOutputEvent => isEventOfKind(event, 'wire_output'))
    .flatMap(event => event.attributes['a2ui.wire.message'].parts)
    .filter((part): part is TextPart => part.type === 'text')
    .map(part => String(part.content));
}

/** The A2UI parts of the host's message in a turn. */
function inputPartsOf(turn: Turn): A2uiPart[] {
  return turn.events
    .filter((event): event is WireInputEvent => isEventOfKind(event, 'wire_input'))
    .flatMap(event => event.attributes['a2ui.wire.message'].parts)
    .filter((part): part is A2uiPart => part.type === 'a2ui');
}

/** How long a preview page has to answer, in the viewer. */
const ANSWER_MS = 5000;

/**
 * Reloads the preview page in its frame, as its dev server reloads it after
 * a save, and resolves once the frame holds another document, or none.
 */
async function reloadFrame(page: Page, pageUrl: string): Promise<void> {
  const frameOf = () => page.frames().find(frame => frame.url().startsWith(pageUrl));
  await frameOf()!.evaluate('window.spectraBefore = true; location.reload();');
  const deadline = Date.now() + 30_000;
  for (;;) {
    const before = await frameOf()
      ?.evaluate<boolean>('window.spectraBefore === true')
      .catch(() => true);
    if (before !== true) return;
    assert.ok(Date.now() < deadline, 'The preview page did not reload.');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

/** The Preview header's note of the page drawing the surface. */
const noteOf = (page: Page, pageUrl: string) => page.locator(`span[title="${pageUrl}"]`);

describe(`the sample catalog apps in Chromium, ${binary ? 'the binary' : 'under Node'}`, () => {
  let browser: Browser;
  before(async () => {
    browser = await chromium.launch();
  });
  after(async () => {
    await browser?.close();
  });

  for (const sample of SAMPLES) {
    it(
      `draws the stub's surface from the ${sample} sample's page, and sends its pressed action`,
      {timeout: TIMEOUT},
      async () => {
        const pageUrl = pageOf(sample);
        const [agentPort, port, proxyPort, modelProxyPort] = await Promise.all([
          freePort(),
          freePort(),
          freePort(),
          freePort(),
        ]);
        const stub = await startStub(agentPort, []);
        const server = await startDevServer(sample, pageUrl);
        const spectra = new SpectraProcess([
          'attach',
          `http://127.0.0.1:${agentPort}`,
          '--config',
          path.join(samplesDir, sample, 'a2ui-spectra.json'),
          '--port',
          String(port),
          '--proxy-port',
          String(proxyPort),
          '--model-proxy-port',
          String(modelProxyPort),
          '--receiver-port',
          String(await freePort()),
          '--no-open',
        ]);
        const base = `http://127.0.0.1:${port}`;
        const page = await browser.newPage({viewport: {width: 1440, height: 900}});
        try {
          await spectra.waitFor(/The viewer is at /);
          await page.goto(base);

          // Under attach, the first screen lists the variables to set in the agent's shell.
          await page.getByText('set these in the agent’s shell').waitFor();
          for (const name of VARIABLES) {
            await page
              .getByText(`${name}=http://127.0.0.1:${modelProxyPort}/${name}`, {exact: true})
              .waitFor();
          }

          // The first turn, from the composer: the stub answers in the sample catalog.
          await page.getByRole('textbox', {name: 'Message the agent'}).fill('Hi');
          await page.getByRole('button', {name: 'Send', exact: true}).click();

          // The sample's page draws the surface, named in the Preview pane's header.
          await page.locator(`span[title="${pageUrl}"]`).waitFor();
          const preview = page.frameLocator(`iframe[title="Preview page ${pageUrl}"]`);
          const slider = preview.locator('input[type="range"]');
          await slider.waitFor();

          // The page reloads itself: the surface is drawn again, and the page stays answered past
          // the answer window, its ready and its load paired whichever came first.
          await reloadFrame(page, pageUrl);
          await slider.waitFor();
          await page.waitForTimeout(ANSWER_MS + 1000);
          assert.ok(await slider.isVisible(), 'The surface is drawn after the reload.');
          assert.equal(await noteOf(page, pageUrl).textContent(), pageUrl);

          await slider.press('End');
          await preview.getByRole('button', {name: 'Set the volume'}).click();

          // The pending action, carrying the slider's value.
          await page.getByText('Action “setVolume”').waitFor();
          const send = page.locator('button:has-text("Discard") + button');
          // The box holds the action's title line, its buttons, and the wire message under them.
          const box = send.locator('xpath=../..');
          assert.match((await box.textContent()) ?? '', /"volume":\s*100/);
          await send.click();

          const turns = await turnsClosed(base, 2);
          const [, second] = [...turns].sort((a, b) => a.startTime.localeCompare(b.startTime));
          const record = await getJson<TurnRecord>(`${base}/api/turns/${second.traceId}`);
          const turn = record.turns.at(-1)!;
          const action = inputPartsOf(turn)
            .flatMap(part => (Array.isArray(part.content) ? part.content : [part.content]))
            .map(message => (message as {action?: {name: string; context: unknown}}).action)
            .find(found => found !== undefined);
          assert.deepEqual(action && {name: action.name, context: action.context}, {
            name: 'setVolume',
            context: {volume: 100},
          });
          const texts = textsOf(turn);
          assert.ok(texts.includes('Volume set to 100.'), texts.join('\n'));
          const echoed = texts.find(text => text.startsWith('Data model: '));
          assert.ok(echoed, texts.join('\n'));
          assert.match(echoed, /"volume":\{"volume":100,/);
        } finally {
          await page.close();
          spectra.signal('SIGTERM');
          await spectra.exited;
          stopServer(server);
          stub.kill();
        }
      },
    );
  }
  it(
    "says the React sample's page is reloading when it loads again without answering, then that it has not answered, and draws the surface again once its dev server is back",
    {timeout: TIMEOUT},
    async () => {
      const sample = 'react';
      const pageUrl = pageOf(sample);
      const [agentPort, port] = await Promise.all([freePort(), freePort()]);
      const stub = await startStub(agentPort, []);
      let server = await startDevServer(sample, pageUrl);
      const spectra = new SpectraProcess([
        'attach',
        `http://127.0.0.1:${agentPort}`,
        '--config',
        path.join(samplesDir, sample, 'a2ui-spectra.json'),
        '--port',
        String(port),
        '--proxy-port',
        String(await freePort()),
        '--model-proxy-port',
        String(await freePort()),
        '--receiver-port',
        String(await freePort()),
        '--no-open',
      ]);
      const page = await browser.newPage({viewport: {width: 1440, height: 900}});
      try {
        await spectra.waitFor(/The viewer is at /);
        await page.goto(`http://127.0.0.1:${port}`);
        await page.getByRole('textbox', {name: 'Message the agent'}).fill('Hi');
        await page.getByRole('button', {name: 'Send', exact: true}).click();
        const slider = page
          .frameLocator(`iframe[title="Preview page ${pageUrl}"]`)
          .locator('input[type="range"]');
        await slider.waitFor();

        // The dev server stops, and the page loads again: a document that does not answer.
        stopServer(server);
        const deadline = Date.now() + 30_000;
        while (
          await fetch(pageUrl).then(
            () => true,
            () => false,
          )
        ) {
          assert.ok(Date.now() < deadline, "The sample's dev server did not stop.");
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        await reloadFrame(page, pageUrl);
        await page.getByText(`${pageUrl} · reloading`, {exact: true}).waitFor();
        // The frame stays on the page meanwhile, nothing laid over it.
        assert.equal(await page.getByText('No preview for catalog').count(), 0);

        // After the answer window the page has not answered, and claims nothing.
        await page.getByText(`${pageUrl} has not answered`, {exact: true}).waitFor();
        await page.getByText('No preview for catalog').waitFor();

        // The dev server is back: the viewer's own reload of the page finds it, and the surface is drawn again.
        server = await startDevServer(sample, pageUrl);
        await slider.waitFor({timeout: 60_000});
        assert.equal(await noteOf(page, pageUrl).textContent(), pageUrl);
      } finally {
        await page.close();
        spectra.signal('SIGTERM');
        await spectra.exited;
        stopServer(server);
        stub.kill();
      }
    },
  );
});
