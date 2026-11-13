/**
 * The browser end-to-end tests of the viewer on a recorded turn, the
 * retried-parse full record, `full_record_retried_parse.json`, placed in the
 * store of a Spectra attached to the stub agent: Flow 6, finding out why a
 * turn retried and where the model's text went wrong, walked in Chromium
 * through Playwright; and the built-in preview page drawing the record's
 * basic catalog icons as their glyphs; the agent popover on a catalog file
 * that did not read; and the dev loop on the fake agent under `run`: Flow 8,
 * edit, save, restart, re-run, see, a refused press, a crash with the down
 * forms and Restart, and the first screen's forms. They run under Node by
 * default, and against the binary when SPECTRA_BINARY names one. Chromium is
 * installed with Playwright's own command.
 */
import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
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

  it(
    'draws the surface again after two reloads of the built-in preview page in quick succession, the page still answered past its time to answer',
    {timeout: TIMEOUT},
    async () => {
      const {traceId} = retriedTurn();
      await withViewer(browser, async (page, base) => {
        await page.goto(`${base}/#/turns/${traceId}`);
        await row(page, 'Completed').click();
        const pane = page
          .getByRole('group', {name: 'Result panes'})
          .getByRole('button', {name: 'Preview'});
        if ((await pane.getAttribute('aria-pressed')) !== 'true') await pane.click();
        const icons = page
          .frameLocator('iframe[title="Spectra’s built-in preview"]')
          .locator('i.a2ui-icon');
        await icons.first().waitFor();

        // The second reload comes as soon as the first one's document is there, before it has drawn.
        const frameOf = () =>
          page.frames().find(frame => frame.url().startsWith(`${base}/preview/`));
        for (let reload = 0; reload < 2; reload += 1) {
          await frameOf()!.evaluate('window.spectraBefore = true; location.reload();');
          const deadline = Date.now() + 30_000;
          while (
            (await frameOf()
              ?.evaluate<boolean>('window.spectraBefore === true')
              .catch(() => true)) === true
          ) {
            assert.ok(Date.now() < deadline, 'The built-in preview page did not reload.');
            await new Promise(resolve => setTimeout(resolve, 5));
          }
        }

        await icons.first().waitFor();
        const note = page.locator('span[title="Spectra’s built-in preview page"]');
        // Past the five seconds a document has to answer, the page is drawing, not reloading.
        await page.waitForTimeout(6_000);
        assert.ok(await icons.first().isVisible(), 'The surface is drawn after the two reloads.');
        assert.equal(await note.textContent(), 'built-in');
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

const fakeAgentScript = fileURLToPath(new URL('./testing/fake_agent.js', import.meta.url));

/** The A2UI the fake agent answers each turn with: one surface whose root is a text. */
function surfaceSaying(text: string): string {
  return JSON.stringify([
    {
      version: 'v0.9',
      createSurface: {
        surfaceId: 'default',
        catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
      },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'default',
        components: [{id: 'root', component: 'Text', text}],
      },
    },
  ]);
}

/**
 * Spectra under `run` on the fake agent, in a working directory of its own:
 * the agent answers each turn with the A2UI in `surface.json`, a watched
 * file; it holds its card until `.state/card` exists and crashes at start
 * while `.state/crash` does, both in a folder the save watcher ignores, so
 * a test sets them without restarting the agent.
 */
interface DevLoop {
  spectra: SpectraProcess;
  page: Page;
  base: string;
  /** Saves `surface.json`, again until Spectra has said it restarts the agent for it once more. */
  save: (text: string) => Promise<void>;
  /** Makes or removes a file under `.state`. */
  set: (name: 'card' | 'crash', exists: boolean) => void;
}

async function withDevLoop(
  browser: Browser,
  start: {card: boolean; crash: boolean},
  walk: (loop: DevLoop) => Promise<void>,
): Promise<void> {
  const cwd = workingDir();
  writeFileSync(path.join(cwd, 'surface.json'), surfaceSaying('Version one'));
  mkdirSync(path.join(cwd, '.state'));
  const set = (name: 'card' | 'crash', exists: boolean) => {
    const file = path.join(cwd, '.state', name);
    if (exists) writeFileSync(file, '');
    else rmSync(file, {force: true});
  };
  set('card', start.card);
  set('crash', start.crash);
  const [agentPort, port] = await Promise.all([freePort(), freePort()]);
  const spectra = new SpectraProcess(
    [
      'run',
      '--agent-url',
      `http://localhost:${agentPort}`,
      '--port',
      String(port),
      '--proxy-port',
      String(await freePort()),
      '--model-proxy-port',
      String(await freePort()),
      '--receiver-port',
      String(await freePort()),
      '--no-open',
      '--',
      process.execPath,
      fakeAgentScript,
      '--port',
      String(agentPort),
      '--streaming',
      '--a2ui-file',
      'surface.json',
      '--log',
      '--hold-card-until-file',
      path.join('.state', 'card'),
      '--crash-if-file',
      path.join('.state', 'crash'),
    ],
    cwd,
  );
  const restarts = () =>
    spectra.output.split('Restarting the agent: surface.json changed.').length - 1;
  const save = async (text: string) => {
    const before = restarts();
    const deadline = Date.now() + 15_000;
    // A watch tells nothing for a moment after it is set up: the save is made again until it is told.
    while (restarts() === before) {
      assert.ok(Date.now() < deadline, spectra.output);
      writeFileSync(path.join(cwd, 'surface.json'), surfaceSaying(text));
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  };
  const page = await browser.newPage({
    viewport: {width: 1440, height: 900},
    reducedMotion: 'reduce',
  });
  try {
    await spectra.waitFor(/The viewer is at /);
    await walk({spectra, page, base: `http://127.0.0.1:${port}`, save, set});
  } finally {
    await page.close();
    await spectra.stop();
  }
}

/** The context bar's live status. */
function liveStatus(page: Page): Locator {
  return page.getByRole('banner').getByRole('status');
}

/** Logs in the context bar, which opens and closes the drawer. */
function logsButton(page: Page): Locator {
  return page.getByRole('banner').locator('button[aria-pressed][aria-controls="logs-drawer"]');
}

/** The turn list's restart divider of this wording. */
function divider(page: Page, name: string | RegExp): Locator {
  return page.getByRole('tree', {name: 'Turns by conversation'}).getByRole('separator', {name});
}

/** What the built-in preview page draws. */
function preview(page: Page): Locator {
  return page.frameLocator('iframe[title="Spectra’s built-in preview"]').locator('body');
}

/** Waits until an element's attribute reads a value. */
async function becomes(element: Locator, name: string, value: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while ((await element.getAttribute(name)) !== value) {
    assert.ok(Date.now() < deadline, `${name} did not become ${value}.`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

/** The trace id of the turn in the page address. */
function turnInAddress(page: Page): string {
  const traceId = /#\/turns\/([0-9a-f]{32})/.exec(page.url())?.[1];
  assert.ok(traceId, `No turn in the address ${page.url()}.`);
  return traceId;
}

describe(`the dev loop in the viewer on the fake agent under run, in Chromium, ${binary ? 'the binary' : 'under Node'}`, () => {
  let browser: Browser;
  before(async () => {
    browser = await chromium.launch();
  });
  after(async () => {
    await browser?.close();
  });

  it(
    'Flow 8: a save restarts the agent, shown in the live status, the drawer and the turn list; a re-run lands as a new turn with the changed surface; a refused press says why; a crash shows the down forms, and Restart brings the agent back',
    {timeout: TIMEOUT},
    async () => {
      await withDevLoop(browser, {card: true, crash: false}, async loop => {
        const {page, base, save, set} = loop;
        const rerun = page.getByRole('button', {name: 'Re-run live'});
        const restart = page.getByRole('banner').getByRole('button', {name: 'Restart'});
        const drawer = page.getByRole('region', {name: 'Logs'});
        const composerLine = page.getByRole('main').getByText(/^Can't send · /);

        // A first turn, from the composer: the surface as the agent's file has it.
        await page.goto(base);
        await liveStatus(page).getByText('Capturing').waitFor();
        await page.getByRole('textbox', {name: 'Message the agent'}).fill('Hello there');
        await page.keyboard.press('Enter');
        await page.waitForURL(/#\/turns\/[0-9a-f]{32}/);
        const first = turnInAddress(page);
        await preview(page).getByText('Version one').waitFor();
        assert.equal(await rerun.getAttribute('aria-disabled'), 'false');

        // 1. Save the agent's file: Spectra restarts the agent, and its card is waited for.
        await logsButton(page).click();
        await drawer.getByRole('separator', {name: /^Started · /}).waitFor();
        await drawer.getByText('Fake agent listening on port').waitFor();
        await drawer.getByText('turn: message/stream').waitFor();
        await drawer.getByText(/^Turn closed · waiting for input · /).waitFor();
        set('card', false);
        await save('Version two');
        await liveStatus(page)
          .getByText(/^(Starting the agent|Waiting for the agent's card · .+)$/)
          .waitFor();
        await composerLine
          .getByText(/the agent is starting|waiting for the agent's card/)
          .waitFor();
        // The waiting form's tooltip is the terminal's wait line whole.
        await page
          .getByRole('banner')
          .locator('[role="status"][title^="Waiting for the agent\'s card at http://localhost:"]')
          .waitFor();
        // Restart is enabled during the card wait; Re-run is off, with the box's reason as its note.
        assert.equal(await restart.getAttribute('aria-disabled'), 'false');
        assert.equal(await rerun.getAttribute('aria-disabled'), 'true');
        await rerun.hover();
        await page
          .getByRole('tooltip')
          .getByText(/^(The agent is starting|Waiting for the agent's card)$/)
          .waitFor();
        await page.mouse.move(0, 0);
        await drawer
          .getByRole('separator', {name: /^Stopped · surface\.json changed · /})
          .waitFor();
        assert.equal(await drawer.getByRole('separator', {name: /^Started · /}).count(), 2);
        await divider(page, 'Restarted · surface.json changed').waitFor();

        // 2. The card answers: capturing again, Re-run enabled.
        set('card', true);
        await liveStatus(page).getByText('Capturing').waitFor();
        await composerLine.waitFor({state: 'detached'});
        await becomes(rerun, 'aria-disabled', 'false');

        // The drawer's open state is remembered in the browser.
        await page.reload();
        await drawer.getByText('Fake agent listening on port').first().waitFor();
        await divider(page, 'Restarted · surface.json changed').waitFor();

        // A press the server refuses: its sentence under the button, closed by Escape.
        const sentence = 'A turn is open. Wait for it to close before replaying.';
        await page.route('**/api/replays', route =>
          route.fulfill({status: 409, json: {error: sentence}}),
        );
        await rerun.click();
        const refusal = page.getByRole('dialog', {name: 'Re-run was refused'});
        await refusal.getByText(sentence, {exact: true}).waitFor();
        await page.keyboard.press('Escape');
        await refusal.waitFor({state: 'detached'});
        // The next press closes it, and is a press: the server's answer shows again; a press outside closes it.
        await rerun.click();
        await refusal.waitFor();
        await page.getByRole('heading', {name: 'Hello there', level: 1}).click();
        await refusal.waitFor({state: 'detached'});
        await page.unroute('**/api/replays');
        assert.equal(turnInAddress(page), first);

        // 3. and 4. Re-run the turn: a new turn, re-run of the first, with the surface the saved file draws.
        await rerun.click();
        await page.waitForURL(url => !url.hash.includes(first) && url.hash.startsWith('#/turns/'));
        const second = turnInAddress(page);
        const line = page.getByLabel('Re-run of');
        await line.getByText(/turn 1 of 1 · live$/).waitFor();
        await preview(page).getByText('Version two').waitFor();
        assert.equal(await preview(page).getByText('Version one').count(), 0);
        // The line's source links back to the turn re-run, and the drawer's marker to the re-run.
        await line.getByRole('button', {name: 'Hello there'}).click();
        await page.waitForURL(url => url.hash.includes(first));
        await drawer.getByRole('button', {name: 'Hello there'}).last().click();
        await page.waitForURL(url => url.hash.includes(second));
        await drawer.waitFor();

        // A crash after a save: the agent down with its exit line, the traceback in the logs.
        set('crash', true);
        await save('Version three');
        await liveStatus(page).getByText('Agent down · exited with code 1').waitFor();
        await liveStatus(page).getByRole('button', {name: 'Logs'}).waitFor();
        await drawer.getByText('SyntaxError: the fake agent was asked to crash').waitFor();
        await drawer.getByRole('separator', {name: 'Stopped · exited with code 1'}).waitFor();
        await divider(page, 'Agent exited with code 1').waitFor();
        await composerLine.getByText("Can't send · the agent is down").waitFor();
        assert.equal(await rerun.getAttribute('aria-disabled'), 'true');
        await rerun.hover();
        await page.getByRole('tooltip').getByText('The agent is down', {exact: true}).waitFor();
        await page.mouse.move(0, 0);
        assert.equal(
          await page.getByRole('textbox', {name: 'Message the agent'}).isDisabled(),
          true,
        );

        // Restart, pressed while the agent is down, starts it.
        set('crash', false);
        assert.equal(await restart.getAttribute('aria-disabled'), 'false');
        await restart.click();
        await liveStatus(page).getByText('Capturing').waitFor();
        await divider(page, 'Restarted · Restart pressed').waitFor();
        await composerLine.waitFor({state: 'detached'});
      });
    },
  );

  it(
    "shows the first screen's down form before any card has answered, the command for the name, the agent's last lines, Open Logs and Restart; then its not-ready form, and its ready form once the card answers",
    {timeout: TIMEOUT},
    async () => {
      await withDevLoop(browser, {card: false, crash: true}, async loop => {
        const {page, base, set} = loop;
        const main = page.getByRole('main');
        await page.goto(base);

        // Down: the command in the heading and in the bar, the exit line, the lines since the start.
        await main.getByRole('heading', {level: 1, name: /fake_agent\.js --port/}).waitFor();
        await page
          .getByRole('banner')
          .getByRole('button', {name: /fake_agent\.js --port/})
          .waitFor();
        await main.getByRole('status').getByText('Agent down · exited with code 1').waitFor();
        const lines = main.getByLabel('The agent’s last lines');
        await lines.getByText('SyntaxError: the fake agent was asked to crash').waitFor();
        await lines.getByText('Traceback (most recent call last):').waitFor();
        await main.getByText("Can't send · the agent is down").waitFor();
        assert.equal(await main.getByText('Send a message to start your first turn.').count(), 0);

        // Open Logs opens the drawer, which draws the buffer as it stands.
        await main.getByRole('button', {name: 'Open Logs'}).click();
        const drawer = page.getByRole('region', {name: 'Logs'});
        await drawer.getByRole('separator', {name: /^Started · /}).waitFor();
        await drawer.getByRole('separator', {name: 'Stopped · exited with code 1'}).waitFor();
        await drawer.getByRole('button', {name: 'Close the logs'}).click();
        await drawer.waitFor({state: 'detached'});

        // Restart, the screen's main action: the agent starts, and its card is waited for.
        set('crash', false);
        await main.getByRole('button', {name: 'Restart'}).click();
        await main.getByText('The message box opens when the agent’s card answers.').waitFor();
        await main
          .getByRole('status')
          .getByText(/^(Starting the agent|Waiting for the agent's card · .+)$/)
          .waitFor();
        await main.getByRole('heading', {level: 1, name: /fake_agent\.js --port/}).waitFor();

        // The card answers: its name, capturing, and the message box open.
        set('card', true);
        await main.getByRole('heading', {level: 1, name: 'Fake agent'}).waitFor();
        await main.getByText('Send a message to start your first turn.').waitFor();
        await main.getByText(/^Can't send · /).waitFor({state: 'detached'});
        assert.equal(
          await page.getByRole('textbox', {name: 'Message the agent'}).isDisabled(),
          false,
        );
      });
    },
  );

  it(
    "says on the first screen, while the agent runs and the message box cannot send, what can still start a turn: a host app at the wire proxy while a header's variable is not set, and nothing once the card lists no JSON-RPC interface",
    {timeout: TIMEOUT},
    async () => {
      const cwd = workingDir();
      const cardFile = path.join(cwd, 'card.json');
      writeFileSync(cardFile, JSON.stringify({}));
      writeFileSync(
        path.join(cwd, 'a2ui-spectra.json'),
        JSON.stringify({
          agent: {headers: {Authorization: 'Bearer ${SPECTRA_FIRST_SCREEN_TOKEN}'}},
        }),
      );
      const [agentPort, port, proxyPort] = await Promise.all([freePort(), freePort(), freePort()]);
      const spectra = new SpectraProcess(
        [
          'run',
          '--agent-url',
          `http://localhost:${agentPort}`,
          '--port',
          String(port),
          '--proxy-port',
          String(proxyPort),
          '--model-proxy-port',
          String(await freePort()),
          '--receiver-port',
          String(await freePort()),
          '--no-open',
          '--',
          process.execPath,
          fakeAgentScript,
          '--port',
          String(agentPort),
          '--card-file',
          cardFile,
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
        const main = page.getByRole('main');
        const proxyAddress = main.getByRole('button', {name: "Copy the wire proxy's address"});
        await page.goto(base);

        // A header's variable is not set: a host app at the wire proxy can still start a turn.
        await main.getByRole('heading', {level: 1, name: 'Fake agent'}).waitFor();
        await main.getByText('To start your first turn, point your host app at').waitFor();
        await proxyAddress.getByText(String(proxyPort)).waitFor();
        assert.equal(await proxyAddress.count(), 1);
        assert.equal(await main.getByText('Send a message to start your first turn.').count(), 0);
        assert.equal(await main.getByText('or point your host app at').count(), 0);
        await main.getByText(/is not set in Spectra's environment/).waitFor();

        // The card lists gRPC alone after a restart: no turn can start, and the address is left out.
        writeFileSync(cardFile, JSON.stringify({transports: ['GRPC']}));
        const pressed = await fetch(`${base}/api/agent/restart`, {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: '{}',
        });
        assert.equal(pressed.status, 202);
        await main
          .getByText('No turn can start until the agent’s card lists an A2A JSON-RPC interface.')
          .waitFor();
        await main.getByText('The card is read again when the agent restarts.').waitFor();
        await main
          .getByText("Can't send · the agent's card lists no A2A JSON-RPC interface, only GRPC")
          .waitFor();
        assert.equal(await proxyAddress.count(), 0);
        assert.equal(await main.getByText('To start your first turn').count(), 0);
        assert.equal(await main.getByText('Send a message to start your first turn.').count(), 0);
      } finally {
        await page.close();
        await spectra.stop();
      }
    },
  );
});
