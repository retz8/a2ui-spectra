/**
 * The browser end-to-end test of the v1.0 component envelope keys on the
 * built-in preview page: Spectra attached to the stub agent's v1.0 booking
 * form, driven in Chromium through Playwright, each of its three forms sent
 * in a conversation of its own. The `@` form is drawn with its check
 * messages and passes clean; the bare form is drawn the same and passes,
 * the legacy form marked in the header and its tooltip, on the step's row,
 * in the step's detail, on the bare keys' lines in the message and on the
 * nodes in Structure, and counted nowhere; the form carrying both keys on
 * the ChoicePicker leaves the preview empty, with its two problems. It runs
 * under Node by default, and against the binary when SPECTRA_BINARY names
 * one. Chromium is installed with Playwright's own command.
 */
import assert from 'node:assert/strict';
import {after, before, describe, it} from 'node:test';

import {type Browser, chromium, type Locator, type Page} from 'playwright';

import {binary, freePort, SpectraProcess, workingDir} from './testing/spectra_process.js';
import {startStub} from './testing/stub_agent.js';

const TIMEOUT = 180_000;

/** The stub's request for each form of the envelope keys. */
const FORMS = {
  at: 'Book a table at Han Il Kwan',
  bare: 'Book a table at Han Il Kwan, bare',
  both: 'Book a table at Han Il Kwan, both',
} as const;

/** The check messages the booking form's `required` checks show while their fields are empty. */
const CHECK_MESSAGES = ['We need a name for the booking.', 'Pick a date.', 'Pick a time.'];

const BOTH = "Component 'time' cannot specify both '@checks' and legacy 'checks'.";

/** The timeline's row holding this text. */
function row(page: Page, text: string): Locator {
  return page
    .getByRole('listbox', {name: 'Steps of the turn'})
    .getByRole('option')
    .filter({hasText: text})
    .first();
}

/** A node's row in Structure, by its id. */
function node(page: Page, id: string): Locator {
  return page
    .locator('div[role="button"][aria-pressed]')
    .filter({hasText: `#${id}`})
    .first();
}

/** The turn's header: the one holding the turn's title. */
function turnHeader(page: Page): Locator {
  return page.locator('header').filter({has: page.getByRole('heading', {level: 1})});
}

/** The legacy form's hourglasses inside a place. */
function hourglasses(place: Locator | Page): Locator {
  return place.getByRole('img', {name: 'Legacy form'});
}

/** Resolves once a locator's text, whitespace collapsed, holds a string. */
async function holds(locator: Locator, text: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const found = ((await locator.textContent()) ?? '').replace(/\s+/g, ' ');
    if (found.includes(text)) return;
    assert.ok(Date.now() < deadline, `"${text}" never appeared in: ${found}`);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

/** Sends a form's request in a new conversation, once the composer offers one, and waits for its turn to close. */
async function send(page: Page, text: string, first: boolean): Promise<void> {
  if (!first) await page.getByRole('button', {name: 'New conversation'}).click();
  await page.getByRole('textbox', {name: 'Message the agent'}).fill(text);
  await page.getByRole('button', {name: 'Send', exact: true}).click();
  await page.getByRole('heading', {level: 1, name: text, exact: true}).waitFor();
  // The check state shows once the turn has closed and its checks have run.
  await turnHeader(page)
    .getByText(/^(No problems|\d+ problems?)/)
    .first()
    .waitFor();
}

describe(`the v1.0 booking form's envelope keys in Chromium, ${binary ? 'the binary' : 'under Node'}`, () => {
  let browser: Browser;
  before(async () => {
    browser = await chromium.launch();
  });
  after(async () => {
    await browser?.close();
  });

  it(
    'draws the @ form with its check messages, the bare form the same with the legacy form marked at its five places, and the form carrying both keys with an empty preview and its two problems',
    {timeout: TIMEOUT},
    async () => {
      const [agentPort, port] = await Promise.all([freePort(), freePort()]);
      const stub = await startStub(agentPort, [], '--v1-booking');
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
        workingDir(),
      );
      const page = await browser.newPage({
        viewport: {width: 1440, height: 900},
        reducedMotion: 'reduce',
      });
      const preview = page.frameLocator('iframe[title="Spectra’s built-in preview"]');
      const header = turnHeader(page);
      const detail = page.getByRole('region', {name: "The step's detail"});
      try {
        await spectra.waitFor(/The viewer is at /);
        await page.goto(`http://127.0.0.1:${port}`);

        // 1. The @ form: drawn with its check messages, clean, with no mark.
        await send(page, FORMS.at, true);
        for (const message of CHECK_MESSAGES) await preview.getByText(message).waitFor();
        await header.getByText('No problems', {exact: true}).waitFor();
        assert.equal(await hourglasses(page).count(), 0);

        // 2. The bare form: drawn the same, passing, the legacy form marked.
        await send(page, FORMS.bare, false);
        for (const message of CHECK_MESSAGES) await preview.getByText(message).waitFor();
        const chip = header.getByText('No problems · legacy form', {exact: true});
        await chip.waitFor();
        // Not a problem: the label is not pressable, and nothing is counted.
        assert.equal(await header.locator('button[aria-pressed]').count(), 0);
        // The header's tooltip: the remark on the Catalog check's row.
        await chip.hover();
        await holds(page.getByRole('tooltip'), 'Passed · 3 components in the legacy form');
        await page.mouse.move(0, 0);
        // The step's row: the hourglass, and no problem mark.
        const step = row(page, 'updateComponents');
        assert.equal(await hourglasses(step).count(), 1);
        assert.equal(await step.getByTitle(/problems?$/).count(), 0);
        // The step's detail: the two lines, then the bare keys' lines in the message.
        await step.click();
        await holds(
          detail,
          '3 components carry bare envelope keys, the legacy form: checks, accessibility',
        );
        await holds(
          detail,
          'The v1.0 form is @checks, @accessibility. The bare keys are accepted during upstream’s transition.',
        );
        // One before the two lines, and one on each bare key's line.
        assert.equal(await hourglasses(detail).count(), 4);
        // Structure: the nodes in the legacy form, and the opened node's line under its properties as written.
        for (const id of ['name', 'date', 'submit']) {
          assert.equal(await hourglasses(node(page, id)).count(), 1, `#${id} carries no hourglass`);
        }
        for (const id of ['root', 'time', 'submit_label']) {
          assert.equal(await hourglasses(node(page, id)).count(), 0, `#${id} carries an hourglass`);
        }
        await page.getByRole('button', {name: 'Show the properties of #name', exact: true}).click();
        const properties = node(page, 'name').locator('xpath=following-sibling::div[1]');
        await holds(properties, 'Legacy form: checks');
        const names = await properties
          .locator('span.w-21')
          .evaluateAll(spans => spans.map(span => span.textContent));
        assert.deepEqual(names, ['checks', 'label', 'value']);

        // 3. Both keys on the ChoicePicker: web core refuses the whole updateComponents.
        await send(page, FORMS.both, false);
        await header.getByText('2 problems', {exact: true}).waitFor();
        await page.getByText('The preview page refused this message.').waitFor();
        await page
          .getByText('No components: this surface’s only updateComponents was rejected.')
          .waitFor();
        assert.equal(await preview.getByText(CHECK_MESSAGES[0]).count(), 0);
        const refused = row(page, 'updateComponents');
        assert.equal(await hourglasses(refused).count(), 1);
        await refused.click();
        await detail.getByText(BOTH, {exact: true}).waitFor();
        await holds(detail, `A2UI web core also rejected this message · ${BOTH}`);
        await holds(
          detail,
          '3 components carry bare envelope keys, the legacy form: checks, accessibility',
        );
        await row(page, 'Waiting for input').click();
        await detail
          .getByText(
            "The surface 'booking' has no component with the id 'root': web core refused the updateComponents that carried one.",
          )
          .waitFor();
      } finally {
        await page.close();
        spectra.signal('SIGTERM');
        await spectra.exited;
        stub.kill();
      }
    },
  );
});
