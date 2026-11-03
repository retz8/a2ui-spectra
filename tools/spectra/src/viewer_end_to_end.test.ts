/**
 * The browser end-to-end test of the viewer on a recorded turn: Flow 6,
 * finding out why a turn retried and where the model's text went wrong,
 * walked in Chromium through Playwright on the retried-parse full record,
 * `full_record_retried_parse.json`, placed in the store of a Spectra
 * attached to the stub agent. It runs under Node by default, and against the
 * binary when SPECTRA_BINARY names one. Chromium is installed with
 * Playwright's own command.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {after, before, describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

import {type Browser, chromium, type Locator, type Page} from 'playwright';

import {isEventOfKind, type TurnEvent, type TurnRecord} from './record/turn_record.js';
import {TurnStore} from './store/store.js';
import {binary, freePort, SpectraProcess, workingDir} from './testing/spectra_process.js';
import {startStub} from './testing/stub_agent.js';

const RECORD = fileURLToPath(
  new URL(
    '../../../conformance/test_data/turn_record/v0_1/full_record_retried_parse.json',
    import.meta.url,
  ),
);
const TIMEOUT = 120_000;

/** Whether an element's box overlaps the box of the scrolled pane that holds it. */
async function inPane(element: Locator): Promise<boolean> {
  const pane = element.locator('xpath=ancestor::*[contains(@class, "overflow-auto")][1]');
  const [box, paneBox] = await Promise.all([element.boundingBox(), pane.boundingBox()]);
  assert.ok(box && paneBox, 'The element or its pane is not drawn.');
  return box.y < paneBox.y + paneBox.height && box.y + box.height > paneBox.y;
}

/** The timeline's row holding this text. */
function row(page: Page, text: string): Locator {
  return page
    .getByRole('listbox', {name: 'Steps of the turn'})
    .getByRole('option')
    .filter({hasText: text})
    .first();
}

describe(`Flow 6 in Chromium, ${binary ? 'the binary' : 'under Node'}`, () => {
  let browser: Browser;
  before(async () => {
    browser = await chromium.launch();
  });
  after(async () => {
    await browser?.close();
  });

  it(
    'opens the retried turn on its failed parse, shows the rejected block, marks the retry with its cause, and ties a final tree node to its range in the retry’s parse',
    {timeout: TIMEOUT},
    async () => {
      const record = JSON.parse(readFileSync(RECORD, 'utf8')) as TurnRecord;
      const [turn] = record.turns;
      const traceId = (turn.events.find(event => isEventOfKind(event, 'turn')) as TurnEvent)
        .traceId;
      const parses = turn.events.filter(event => event.attributes['a2ui.event.kind'] === 'parse');
      const calls = turn.events.filter(
        event => event.attributes['a2ui.event.kind'] === 'model_call',
      );
      assert.equal(parses.length, 2);
      assert.equal(calls.length, 2);
      const [failed, read] = parses;
      const retry = calls[1];

      const cwd = workingDir();
      const store = await TurnStore.open(cwd);
      await store.write(turn);
      const [agentPort, port] = await Promise.all([freePort(), freePort()]);
      await startStub(agentPort, []);
      const spectra = new SpectraProcess(
        [
          'attach',
          `http://127.0.0.1:${agentPort}`,
          '--port',
          String(port),
          '--proxy-port',
          String(await freePort()),
          '--model-proxy-port',
          String(await freePort()),
          '--receiver-port',
          String(await freePort()),
          '--no-open',
        ],
        cwd,
      );
      const base = `http://127.0.0.1:${port}`;
      const page = await browser.newPage({
        viewport: {width: 1440, height: 900},
        reducedMotion: 'reduce',
      });
      try {
        await spectra.waitFor(/The viewer is at /);

        // 1. The turn opens on its one problem, the failed parse.
        await page.goto(`${base}/#/turns/${traceId}`);
        await page.waitForURL(`${base}/#/turns/${traceId}/steps/${failed.spanId}`);
        await page.getByText('1 problem', {exact: true}).waitFor();
        await page
          .getByText('The parse stopped on this block: Surface default already exists.')
          .waitFor();

        // 2. Show text brings the rejected block into view.
        await page.getByText('Show text', {exact: true}).click();
        const block = page.locator('[data-block]').first();
        await block.waitFor();
        await page.waitForTimeout(300);
        assert.ok(await inPane(block), 'The rejected block is not in view.');

        // 3. The next model call is the retry, marked with its cause.
        await row(page, 'Retry 1').click();
        await page.waitForURL(`${base}/#/turns/${traceId}/steps/${retry.spanId}`);
        await page
          .getByRole('link', {name: 'failed to parse'})
          .or(page.getByRole('button', {name: 'failed to parse'}))
          .waitFor();

        // 4. A component of the final tree selects the retry's parse, its range tinted and in view.
        await row(page, 'Completed').click();
        const structure = page
          .getByRole('group', {name: 'Result panes'})
          .getByRole('button', {name: 'Structure'});
        if ((await structure.getAttribute('aria-pressed')) !== 'true') await structure.click();
        await page
          .locator('div[role="button"][aria-pressed]')
          .filter({hasText: '#restaurantName'})
          .first()
          .click();
        const address = `${base}/#/turns/${traceId}/steps/${read.spanId}/nodes/restaurant-card-surface/restaurantName`;
        await page.waitForURL(address);
        const range = page.locator('[data-component].bg-brand-soft');
        await range.waitFor();
        await page.waitForTimeout(300);
        assert.ok(await inPane(range), 'The selected component’s range is not in view.');

        // A reload brings back the node, its parse and its range in view.
        await page.reload();
        await page.waitForURL(address);
        await range.waitFor();
        await page.waitForTimeout(300);
        assert.ok(await inPane(range), 'After a reload, the range is not in view.');
      } finally {
        await page.close();
        spectra.signal('SIGTERM');
        await spectra.exited;
      }
    },
  );
});
