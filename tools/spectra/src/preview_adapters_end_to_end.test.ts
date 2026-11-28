/**
 * The browser test of the React, Lit and Angular preview adapters, and of the
 * built-in preview page's claims, in Chromium through Playwright. Each
 * adapter's page under `tools/spectra_preview_test_pages/` is framed by a
 * stand-in viewer on another origin, which posts the preview protocol's
 * renders and pings into it and keeps what the page posts back. No Spectra
 * runs: what is checked is each adapter's side of the protocol, the page's
 * drawing, and what the adapter does as the framework mounts, unmounts,
 * disconnects or destroys it. Chromium is installed with Playwright's own
 * command.
 */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import path from 'node:path';
import {after, before, describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

import {type Browser, chromium, type Frame, type Page} from 'playwright';

const testPages = fileURLToPath(new URL('../../spectra_preview_test_pages/dist/', import.meta.url));
const builtInPage = fileURLToPath(new URL('../../spectra_basic_preview/dist/', import.meta.url));
const TIMEOUT = 60_000;

/** The test pages' catalog, as `tools/spectra_preview_test_pages/shared/thrower.ts` names it. */
const TEST_CATALOG_ID = 'https://example.com/a2ui-spectra/preview-test-pages/catalog.json';
const THROWER_FAILURE = 'Error: The thrower was told to fail.';
const STANDALONE_LINE = 'This is a Spectra preview page. It previews only inside Spectra.';
const BASIC_V09 = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';

/**
 * The stand-in viewer: it frames the page its `page` parameter names, posts
 * what `window.post` is given to the page's origin, and keeps each message
 * the frame posts from that origin in `window.received`.
 */
const VIEWER = `<!doctype html>
<html lang="en">
  <body>
    <script>
      const page = new URLSearchParams(location.search).get('page');
      const origin = new URL(page).origin;
      const frame = document.createElement('iframe');
      frame.style.width = '640px';
      frame.style.height = '480px';
      frame.src = page;
      document.body.append(frame);
      window.received = [];
      addEventListener('message', event => {
        if (event.source === frame.contentWindow && event.origin === origin) {
          window.received.push(event.data);
        }
      });
      window.post = message => frame.contentWindow.postMessage(message, origin);
    </script>
  </body>
</html>`;

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
};

/** Serves the stand-in viewer, the test pages under their folders and the built-in page under `/preview/`. */
async function startServer(): Promise<{server: Server; port: number}> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === '/viewer') {
      response.writeHead(200, {'content-type': 'text/html'}).end(VIEWER);
      return;
    }
    const [root, rest] = url.pathname.startsWith('/preview/')
      ? [builtInPage, url.pathname.slice('/preview/'.length)]
      : [testPages, url.pathname.slice(1)];
    const file = path.join(root, rest.endsWith('/') || rest === '' ? `${rest}index.html` : rest);
    if (!file.startsWith(root)) {
      response.writeHead(404).end();
      return;
    }
    readFile(file).then(
      body =>
        response
          .writeHead(200, {
            'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
          })
          .end(body),
      () => response.writeHead(404).end(),
    );
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return {server, port: (server.address() as AddressInfo).port};
}

type Message = {type: string; [key: string]: unknown};

/** A page framed by the stand-in viewer. */
interface Framed {
  page: Page;
  frame: Frame;
  post(message: unknown): Promise<void>;
  received(): Promise<Message[]>;
  /** Resolves with the first message received that matches, waiting for it. */
  waitForMessage(match: (message: Message) => boolean): Promise<Message>;
}

const create = {version: 'v0.9', createSurface: {surfaceId: 'main', catalogId: TEST_CATALOG_ID}};

/** The surface's components; the thrower throws while drawing when `fail` is true. */
function components(fail = false) {
  return {
    version: 'v0.9',
    updateComponents: {
      surfaceId: 'main',
      components: [
        {id: 'root', component: 'Column', children: ['greeting', 'thrower', 'book']},
        {id: 'greeting', component: 'Text', text: 'Hello from the test'},
        {id: 'thrower', component: 'Thrower', text: 'Thrower drawn', fail},
        {
          id: 'book',
          component: 'Button',
          child: 'book_label',
          action: {event: {name: 'book', context: {seats: 2}}},
        },
        {id: 'book_label', component: 'Text', text: 'Book'},
      ],
    },
  };
}

function render(number: number, messages: unknown[]) {
  return {type: 'a2ui-spectra-preview/render', render: number, surfaceId: 'main', messages};
}

const isReady = (message: Message) => message.type === 'a2ui-spectra-preview/ready';

describe('the preview adapters and the built-in page in Chromium', {timeout: 10 * TIMEOUT}, () => {
  let browser: Browser;
  let server: Server;
  let port: number;
  before(async () => {
    browser = await chromium.launch();
    ({server, port} = await startServer());
  });
  after(async () => {
    await browser?.close();
    server?.close();
  });

  /** The page's address on the page's origin, told the stand-in viewer's origin. */
  const pageUrl = (page: string) =>
    `http://localhost:${port}/${page}${page.includes('?') ? '&' : '?'}a2ui-spectra-viewer=${encodeURIComponent(`http://127.0.0.1:${port}`)}`;

  /** Frames the page in the stand-in viewer and resolves once it said it is ready. */
  async function frame(name: string): Promise<Framed> {
    const page = await browser.newPage();
    const url = pageUrl(name);
    await page.goto(`http://127.0.0.1:${port}/viewer?page=${encodeURIComponent(url)}`);
    const received = () => page.evaluate<Message[]>('window.received');
    const waitForMessage = async (match: (message: Message) => boolean) => {
      const deadline = Date.now() + 20_000;
      for (;;) {
        const found = (await received()).find(match);
        if (found !== undefined) return found;
        assert.ok(
          Date.now() < deadline,
          `No such message; received: ${JSON.stringify(await received())}`,
        );
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    };
    await waitForMessage(isReady);
    const found = page
      .frames()
      .find(candidate => candidate.url().startsWith(`http://localhost:${port}/`));
    assert.ok(found, 'The page is framed.');
    return {
      page,
      frame: found,
      post: message => page.evaluate(`window.post(${JSON.stringify(message)})`),
      received,
      waitForMessage,
    };
  }

  /** Whether the page answers a ping, waiting a moment for the answer. */
  async function answers(framed: Framed, load: number): Promise<boolean> {
    await framed.post({type: 'a2ui-spectra-preview/ping', load});
    await new Promise(resolve => setTimeout(resolve, 500));
    return (await framed.received()).some(
      message => message.type === 'a2ui-spectra-preview/pong' && message.load === load,
    );
  }

  const reportsOf = async (framed: Framed) =>
    (await framed.received()).filter(message => message.type === 'a2ui-spectra-preview/report');

  for (const adapter of ['react', 'lit', 'angular'] as const) {
    describe(`the ${adapter} adapter`, () => {
      it(
        'opened on its own, shows the standalone line and starts nothing',
        {timeout: TIMEOUT},
        async () => {
          const page = await browser.newPage();
          const errors: string[] = [];
          page.on('pageerror', error => errors.push(String(error)));
          try {
            await page.goto(`http://localhost:${port}/${adapter}/`);
            await page.getByText(STANDALONE_LINE).waitFor();
            if (adapter === 'angular') {
              // The page bootstraps without the renderer config when opened on its own.
              await page.waitForFunction("'spectraTestPage' in window");
              assert.deepEqual(await page.evaluate('window.spectraTestPage.pageErrors'), []);
            }
            assert.deepEqual(errors, []);
          } finally {
            await page.close();
          }
        },
      );

      it('says it is ready with the claims of its catalogs', {timeout: TIMEOUT}, async () => {
        const framed = await frame(`${adapter}/`);
        try {
          assert.deepEqual(await framed.waitForMessage(isReady), {
            type: 'a2ui-spectra-preview/ready',
            protocol: 2,
            claims: [{catalogId: TEST_CATALOG_ID, protocolVersion: '0.9'}],
          });
        } finally {
          await framed.page.close();
        }
      });

      it(
        'draws a surface that a message after the first render creates, and sends its data model',
        {timeout: TIMEOUT},
        async () => {
          const framed = await frame(`${adapter}/`);
          try {
            await framed.post(render(1, []));
            await framed.post(render(2, [create, components()]));
            await framed.frame.getByText('Hello from the test').waitFor();
            await framed.frame.getByText('Thrower drawn').waitFor();
            await framed.waitForMessage(
              message =>
                message.type === 'a2ui-spectra-preview/data-model' &&
                message.render === 2 &&
                message.surfaceId === 'main',
            );
            assert.deepEqual(await reportsOf(framed), []);
          } finally {
            await framed.page.close();
          }
        },
      );

      it(
        'starts over on a render that does not extend the last, drawing the surface anew',
        {timeout: TIMEOUT},
        async () => {
          const framed = await frame(`${adapter}/`);
          try {
            await framed.post(render(1, [create, components()]));
            const greeting = framed.frame.getByText('Hello from the test');
            await greeting.waitFor();
            await greeting.evaluate(element =>
              (
                element as unknown as {setAttribute(name: string, value: string): void}
              ).setAttribute('data-drawn-first', ''),
            );
            // A shorter list: a new processor, whose surface has no components yet.
            await framed.post(render(2, [create]));
            await greeting.waitFor({state: 'detached'});
            await framed.post(render(3, [create, components()]));
            await greeting.waitFor();
            assert.equal(await framed.frame.locator('[data-drawn-first]').count(), 0);
          } finally {
            await framed.page.close();
          }
        },
      );

      it(
        adapter === 'angular'
          ? 'reports a component of its own drawn inside a universal one that throws with no id, as the window saw it, and keeps the rest drawn'
          : 'reports a component that throws with its id and type, and keeps the rest drawn',
        {timeout: TIMEOUT},
        async () => {
          const framed = await frame(`${adapter}/`);
          try {
            await framed.post(render(1, [create, components(true)]));
            await framed.frame.getByText('Hello from the test').waitFor();
            const failure =
              adapter === 'angular'
                ? {kind: 'component', error: THROWER_FAILURE}
                : {
                    kind: 'component',
                    componentId: 'thrower',
                    componentType: 'Thrower',
                    error: THROWER_FAILURE,
                  };
            await framed.waitForMessage(
              message =>
                message.type === 'a2ui-spectra-preview/report' &&
                message.render === 1 &&
                JSON.stringify(message.report) === JSON.stringify(failure),
            );
            // After a reset the new processor's surfaces report to the page in its turn.
            await framed.post(render(2, [create]));
            await framed.post(render(3, [create, components(true)]));
            await framed.waitForMessage(
              message =>
                message.type === 'a2ui-spectra-preview/report' &&
                message.render === 3 &&
                JSON.stringify(message.report) === JSON.stringify(failure),
            );
          } finally {
            await framed.page.close();
          }
        },
      );

      it(
        "validates as the host's processor options say, reports every refusal, and sends nothing through the host's channel to its agent",
        {timeout: TIMEOUT},
        async () => {
          const framed = await frame(`${adapter}/?options`);
          try {
            // The host's options refuse every message but a surface's and its components.
            const data = {version: 'v0.9', updateDataModel: {surfaceId: 'main', value: {seats: 3}}};
            await framed.post(render(1, [create, components(), data]));
            await framed.frame.getByText('Hello from the test').waitFor();
            const refused = await framed.waitForMessage(
              message =>
                message.type === 'a2ui-spectra-preview/report' &&
                (message.report as {kind: string}).kind === 'refused',
            );
            assert.deepEqual(refused.report, {
              kind: 'refused',
              index: 2,
              code: 'VALIDATION_ERROR',
              error:
                "Operation 'updateDataModel' is not permitted by ValidationConfig.allowedMessages",
            });
            assert.deepEqual(await framed.frame.evaluate('window.spectraTestPage.hostSent'), []);
          } finally {
            await framed.page.close();
          }
        },
      );

      it(
        adapter === 'angular'
          ? "sends a press with the surface's data model, in place of the page's own action handler"
          : "sends a press with the surface's data model",
        {timeout: TIMEOUT},
        async () => {
          const framed = await frame(`${adapter}/`);
          try {
            await framed.post(render(4, [create, components()]));
            await framed.frame.getByText('Book', {exact: true}).click();
            const press = await framed.waitForMessage(
              message => message.type === 'a2ui-spectra-preview/action',
            );
            const action = press.action as Record<string, unknown>;
            assert.equal(press.render, 4);
            assert.equal(action.name, 'book');
            assert.equal(action.surfaceId, 'main');
            assert.equal(action.sourceComponentId, 'book');
            assert.deepEqual(action.context, {seats: 2});
            assert.deepEqual(press.dataModel, {});
            if (adapter === 'angular') {
              assert.deepEqual(
                await framed.frame.evaluate('window.spectraTestPage.pageActions'),
                [],
              );
            }
          } finally {
            await framed.page.close();
          }
        },
      );
    });
  }

  it(
    "the React adapter leaves the page's catalog objects as they were",
    {timeout: TIMEOUT},
    async () => {
      const framed = await frame('react/');
      try {
        await framed.post(render(1, [create, components(true)]));
        await framed.frame.getByText('Hello from the test').waitFor();
        assert.equal(
          await framed.frame.evaluate(
            "window.spectraTestPage.testCatalog.components.get('Thrower') === window.spectraTestPage.Thrower",
          ),
          true,
        );
      } finally {
        await framed.page.close();
      }
    },
  );

  it(
    'the React adapter reads its catalogs once, and stops when unmounted',
    {timeout: TIMEOUT},
    async () => {
      const framed = await frame('react/');
      try {
        await framed.frame.evaluate('window.spectraTestPage.changeCatalogs()');
        await framed.post(render(1, [create, components()]));
        await framed.frame.getByText('Hello from the test').waitFor();
        assert.equal((await framed.received()).filter(isReady).length, 1);
        assert.equal(await answers(framed, 1), true);
        await framed.frame.evaluate('window.spectraTestPage.unmount()');
        assert.equal(await answers(framed, 2), false);
      } finally {
        await framed.page.close();
      }
    },
  );

  it(
    'the Lit adapter defines its tag on import, stops when disconnected, starts anew when connected again, and starts once its catalogs are set',
    {timeout: TIMEOUT},
    async () => {
      const framed = await frame('lit/');
      try {
        assert.equal(
          await framed.frame.evaluate(
            "customElements.get('a2ui-spectra-preview') === window.spectraTestPage.SpectraPreviewElement",
          ),
          true,
        );
        // Disconnected, the element stops.
        await framed.frame.evaluate(
          "window.removed = document.querySelector('a2ui-spectra-preview'); window.removed.remove();",
        );
        assert.equal(await answers(framed, 1), false);
        // Connected again, it starts anew with the catalogs it then holds.
        await framed.frame.evaluate(
          "window.removed.catalogs = window.spectraTestPage.otherCatalogs; document.getElementById('root').append(window.removed);",
        );
        const claimsOfReady = async () =>
          (await framed.received()).filter(isReady).map(message => message.claims);
        await framed.waitForMessage(
          message =>
            isReady(message) &&
            JSON.stringify(message.claims) ===
              JSON.stringify([{catalogId: BASIC_V09, protocolVersion: '0.9'}]),
        );
        await framed.frame.evaluate("document.querySelector('a2ui-spectra-preview').remove()");
        // An element connected before its catalogs are set starts once they are, and reads them once.
        await framed.frame.evaluate(
          "const element = document.createElement('a2ui-spectra-preview'); document.getElementById('root').append(element); element.catalogs = window.spectraTestPage.catalogs;",
        );
        await framed.waitForMessage(
          message =>
            isReady(message) &&
            JSON.stringify(message.claims) ===
              JSON.stringify([{catalogId: TEST_CATALOG_ID, protocolVersion: '0.9'}]),
        );
        await framed.frame.evaluate(
          "document.querySelector('a2ui-spectra-preview').catalogs = window.spectraTestPage.otherCatalogs",
        );
        await framed.post(render(1, [create, components()]));
        await framed.frame.getByText('Hello from the test').waitFor();
        assert.equal((await claimsOfReady()).length, 3);
      } finally {
        await framed.page.close();
      }
    },
  );

  it(
    "the Angular adapter reports a component Angular draws itself that throws with no id, and hands the error on to the page's error handler",
    {timeout: TIMEOUT},
    async () => {
      const framed = await frame('angular/?native');
      try {
        const alone = {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 'main',
            components: [{id: 'root', component: 'Thrower', text: 'Thrower drawn', fail: true}],
          },
        };
        await framed.post(render(1, [create, alone]));
        await framed.waitForMessage(
          message =>
            message.type === 'a2ui-spectra-preview/report' &&
            JSON.stringify(message.report) ===
              JSON.stringify({kind: 'component', error: THROWER_FAILURE}),
        );
        const pageErrors = await framed.frame.evaluate<string[]>(
          'window.spectraTestPage.pageErrors',
        );
        assert.ok(
          pageErrors.some(error => error === THROWER_FAILURE),
          JSON.stringify(pageErrors),
        );
      } finally {
        await framed.page.close();
      }
    },
  );

  it(
    "the Angular adapter stops when its application is destroyed, and gives the page's error handler back",
    {timeout: TIMEOUT},
    async () => {
      const framed = await frame('angular/');
      try {
        await framed.post(render(1, [create, components()]));
        await framed.frame.getByText('Hello from the test').waitFor();
        assert.equal(await answers(framed, 1), true);
        assert.equal(
          await framed.frame.evaluate('window.spectraTestPage.errorHandlerReplaced()'),
          true,
        );
        await framed.frame.evaluate('window.spectraTestPage.destroy()');
        assert.equal(await answers(framed, 2), false);
        // The page's own error handler is its own again.
        assert.equal(
          await framed.frame.evaluate('window.spectraTestPage.errorHandlerReplaced()'),
          false,
        );
      } finally {
        await framed.page.close();
      }
    },
  );

  it(
    'the built-in page claims the v0.9 basic catalog under both its ids, and the v1.0 basic catalog',
    {timeout: TIMEOUT},
    async () => {
      const framed = await frame('preview/');
      try {
        assert.deepEqual((await framed.waitForMessage(isReady)).claims, [
          {catalogId: BASIC_V09, protocolVersion: '0.9'},
          {
            catalogId: 'https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json',
            protocolVersion: '0.9',
          },
          {
            catalogId: 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
            protocolVersion: '1.0',
          },
        ]);
      } finally {
        await framed.page.close();
      }
    },
  );
});
