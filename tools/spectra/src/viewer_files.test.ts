import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {after, before, describe, it} from 'node:test';

import {listen} from './testing/listen.js';
import {resolveViewerFile, serveViewerFile, viewerDirFor} from './viewer_files.js';

describe('resolveViewerFile', () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'spectra-viewer-'));
    writeFileSync(path.join(dir, 'index.html'), '<html></html>');
    mkdirSync(path.join(dir, 'assets'));
    writeFileSync(path.join(dir, 'assets', 'index.js'), '');
    mkdirSync(path.join(dir, 'preview', 'assets'), {recursive: true});
    writeFileSync(path.join(dir, 'preview', 'index.html'), '<html></html>');
    writeFileSync(path.join(dir, 'preview', 'assets', 'index.js'), '');
  });

  after(() => rmSync(dir, {recursive: true, force: true}));

  it('answers a file that exists with the file', () => {
    assert.deepEqual(resolveViewerFile(dir, '/assets/index.js'), {
      kind: 'file',
      path: path.join(dir, 'assets', 'index.js'),
    });
  });

  it("answers any other path with the viewer's index.html", () => {
    const index = {kind: 'index', path: path.join(dir, 'index.html')};
    assert.deepEqual(resolveViewerFile(dir, '/'), index);
    assert.deepEqual(resolveViewerFile(dir, '/turns/abc'), index);
    assert.deepEqual(resolveViewerFile(dir, '/assets'), index);
    assert.deepEqual(resolveViewerFile(dir, '/assets/missing.js'), index);
  });

  it("answers a path under preview/ with the built-in preview page's file, or its index.html", () => {
    const index = {kind: 'index', path: path.join(dir, 'preview', 'index.html')};
    assert.deepEqual(resolveViewerFile(dir, '/preview/'), index);
    assert.deepEqual(resolveViewerFile(dir, '/preview'), index);
    assert.deepEqual(resolveViewerFile(dir, '/preview/missing.js'), index);
    assert.deepEqual(resolveViewerFile(dir, '/preview/assets/index.js'), {
      kind: 'file',
      path: path.join(dir, 'preview', 'assets', 'index.js'),
    });
    assert.deepEqual(resolveViewerFile(dir, '/previews'), {
      kind: 'index',
      path: path.join(dir, 'index.html'),
    });
  });

  it('never leaves the viewer directory', () => {
    const outside = resolveViewerFile(dir, '/../../etc/passwd');
    assert.notEqual(outside.kind, 'file');
    if (outside.kind !== 'outside') {
      assert.equal(outside.path, path.join(dir, 'index.html'));
    }
  });
});

describe('serveViewerFile', () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'spectra-viewer-'));
    writeFileSync(path.join(dir, 'index.html'), '<html></html>');
    mkdirSync(path.join(dir, 'assets'));
    writeFileSync(path.join(dir, 'assets', 'index.js'), '');
    mkdirSync(path.join(dir, 'preview', 'assets'), {recursive: true});
    writeFileSync(path.join(dir, 'preview', 'index.html'), '<html></html>');
    writeFileSync(path.join(dir, 'preview', 'assets', 'index.js'), '');
  });

  after(() => rmSync(dir, {recursive: true, force: true}));

  const framing = async (paths: string[]) => {
    const server = createServer((request, response) => serveViewerFile(dir, request, response));
    const port = await listen(server);
    try {
      const answers: Record<string, [string | null, string | null]> = {};
      for (const urlPath of paths) {
        const response = await fetch(`http://127.0.0.1:${port}${urlPath}`);
        assert.equal(response.status, 200, urlPath);
        await response.arrayBuffer();
        answers[urlPath] = [
          response.headers.get('content-security-policy'),
          response.headers.get('x-frame-options'),
        ];
      }
      return answers;
    } finally {
      await new Promise(done => server.close(done));
    }
  };

  it("forbids every page to frame the viewer's files", async () => {
    const none: [string, string] = ["frame-ancestors 'none'", 'DENY'];
    assert.deepEqual(await framing(['/', '/turns/abc', '/index.html', '/assets/index.js']), {
      '/': none,
      '/turns/abc': none,
      '/index.html': none,
      '/assets/index.js': none,
    });
  });

  it("lets the viewer's own origin alone frame the built-in preview page's files", async () => {
    const self: [string, string] = ["frame-ancestors 'self'", 'SAMEORIGIN'];
    assert.deepEqual(
      await framing(['/preview/', '/preview', '/preview/index.html', '/preview/assets/index.js']),
      {
        '/preview/': self,
        '/preview': self,
        '/preview/index.html': self,
        '/preview/assets/index.js': self,
      },
    );
  });
});

describe('viewerDirFor', () => {
  it("puts the viewer's files beside the code", () => {
    assert.equal(viewerDirFor('/x/dist'), path.join('/x/dist', 'viewer'));
  });
});
