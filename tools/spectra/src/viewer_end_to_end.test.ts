/**
 * The browser end-to-end tests of the viewer on a recorded turn, the
 * retried-parse full record, `full_record_retried_parse.json`, placed in the
 * store of a Spectra attached to the stub agent: Flow 6, finding out why a
 * turn retried and where the model's text went wrong, walked in Chromium
 * through Playwright; and the built-in preview page drawing the record's
 * basic catalog icons as their glyphs. They run under Node by default, and
 * against the binary when SPECTRA_BINARY names one. Chromium is installed
 * with Playwright's own command.
 */
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
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

/** The retried-parse record's turn, with its trace id, its two parses and its retry. */
function retriedTurn() {
  const record = JSON.parse(readFileSync(RECORD, 'utf8')) as TurnRecord;
  const [turn] = record.turns;
  const traceId = (turn.events.find(event => isEventOfKind(event, 'turn')) as TurnEvent).traceId;
  const parses = turn.events.filter(event => event.attributes['a2ui.event.kind'] === 'parse');
  const calls = turn.events.filter(event => event.attributes['a2ui.event.kind'] === 'model_call');
  assert.equal(parses.length, 2);
  assert.equal(calls.length, 2);
  const [failed, read] = parses;
  return {turn, traceId, failed, read, retry: calls[1]};
}

/**
 * Places the retried turn in a fresh store, attaches Spectra to the stub
 * agent on it, opens a page and runs the walk; then closes the page and
 * stops Spectra.
 */
async function withViewer(
  browser: Browser,
  walk: (page: Page, base: string) => Promise<void>,
): Promise<void> {
  const cwd = workingDir();
  const store = await TurnStore.open(cwd);
  await store.write(retriedTurn().turn);
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
  const page = await browser.newPage({
    viewport: {width: 1440, height: 900},
    reducedMotion: 'reduce',
  });
  try {
    await spectra.waitFor(/The viewer is at /);
    await walk(page, `http://127.0.0.1:${port}`);
  } finally {
    await page.close();
    spectra.signal('SIGTERM');
    await spectra.exited;
  }
}

describe(`the viewer on the retried-parse record in Chromium, ${binary ? 'the binary' : 'under Node'}`, () => {
  let browser: Browser;
  before(async () => {
    browser = await chromium.launch();
  });
  after(async () => {
    await browser?.close();
  });

  it(
    'Flow 6: opens the retried turn on its failed parse, shows the rejected block, marks the retry with its cause, and ties a final tree node to its range in the retry’s parse',
    {timeout: TIMEOUT},
    async () => {
      const {traceId, failed, read, retry} = retriedTurn();
      await withViewer(browser, async (page, base) => {
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
      });
    },
  );

  it(
    'draws the final tree’s basic catalog icons in the built-in preview as their glyphs, not their names',
    {timeout: TIMEOUT},
    async () => {
      const {traceId} = retriedTurn();
      await withViewer(browser, async (page, base) => {
        await page.goto(`${base}/#/turns/${traceId}`);
        await row(page, 'Completed').click();
        const preview = page
          .getByRole('group', {name: 'Result panes'})
          .getByRole('button', {name: 'Preview'});
        if ((await preview.getAttribute('aria-pressed')) !== 'true') await preview.click();

        const icons = page
          .frameLocator('iframe[title="Spectra’s built-in preview"]')
          .locator('i.a2ui-icon');
        await icons.first().waitFor();
        // Each icon's name, set in the icon font, is one ligature as wide as the icon's box.
        const overflowing = await icons.evaluateAll(async all => {
          const wider = () =>
            all.flatMap(icon => {
              const range = icon.ownerDocument.createRange();
              range.selectNodeContents(icon);
              const text = range.getBoundingClientRect().width;
              const box = icon.getBoundingClientRect().width;
              return text > box + 1 ? [`${icon.textContent} (${text}px in ${box}px)`] : [];
            });
          const deadline = Date.now() + 5_000;
          while (wider().length > 0 && Date.now() < deadline) {
            await all[0].ownerDocument.fonts.ready;
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          return {count: all.length, wider: wider()};
        });
        assert.ok(overflowing.count > 0, 'The preview drew no icon.');
        assert.deepEqual(overflowing.wider, [], 'Icons drawn as their names.');
        // While the font loads, an icon's name is hidden, not drawn in a fallback font.
        const displays = await icons
          .first()
          .evaluate(icon =>
            [...icon.ownerDocument.fonts]
              .filter(face => face.family.replace(/["']/g, '') === 'Material Icons')
              .map(face => face.display),
          );
        assert.ok(displays.length > 0, 'The preview declares no Material Icons font.');
        assert.deepEqual([...new Set(displays)], ['block']);
      });
    },
  );
});

describe(`the agent popover on a catalog file that did not read, in Chromium, ${binary ? 'the binary' : 'under Node'}`, () => {
  let browser: Browser;
  before(async () => {
    browser = await chromium.launch();
  });
  after(async () => {
    await browser?.close();
  });

  it(
    "shows a broken catalog file's two lines on a Catalog row of its own, the page not reloaded, and drops them at the fix",
    {timeout: TIMEOUT},
    async () => {
      const cwd = workingDir();
      const file = path.join(cwd, 'notes.json');
      const definition = JSON.stringify({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        catalogId: 'https://example.com/notes.json',
        title: 'Notes',
        components: {Note: {type: 'object', properties: {component: {const: 'Note'}}}},
        $defs: {anyComponent: {oneOf: [{$ref: '#/components/Note'}]}},
      });
      writeFileSync(file, definition);
      writeFileSync(
        path.join(cwd, 'a2ui-spectra.json'),
        JSON.stringify({catalogs: ['./notes.json']}),
      );
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
      const page = await browser.newPage({viewport: {width: 1440, height: 900}});
      /** Saves the file, again until Spectra's output holds the line: a watch tells nothing for a moment after it is set up. */
      const savedUntil = async (content: string, line: () => boolean) => {
        const deadline = Date.now() + 15_000;
        while (!line()) {
          assert.ok(Date.now() < deadline, spectra.output);
          writeFileSync(file, content);
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      };
      try {
        await spectra.waitFor(/The viewer is at /);
        await page.goto(`http://127.0.0.1:${port}`);
        await page.getByRole('button', {name: 'Spectra stub agent'}).click();
        const popover = page.getByRole('dialog', {name: 'The agent'});
        await popover.waitFor();
        // The stub's card does not advertise the configured catalog, and a file that reads has no row.
        assert.equal(await popover.getByText('Notes', {exact: true}).count(), 0);

        await savedUntil('{"catalogId": ', () =>
          spectra.stderr.includes('changed and did not read'),
        );
        await popover.getByText('Notes', {exact: true}).waitFor();
        await popover
          .getByText(
            /^\.\/notes\.json did not read at \d\d:\d\d:\d\d · checking against the definition read at \d\d:\d\d:\d\d$/,
          )
          .waitFor();
        const error = /did not read: (.+)\. The definition read before stays in force\./.exec(
          spectra.stderr,
        )?.[1];
        assert.ok(error);
        await popover.getByText(error, {exact: true}).waitFor();

        await savedUntil(definition, () =>
          spectra.output.includes('Its catalog definition was read again.'),
        );
        await popover.getByText(/did not read at/).waitFor({state: 'detached'});
        assert.equal(await popover.getByText('Notes', {exact: true}).count(), 0);
      } finally {
        await page.close();
        spectra.signal('SIGTERM');
        await spectra.exited;
      }
    },
  );
});
