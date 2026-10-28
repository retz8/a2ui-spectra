import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {after, before, describe, it} from 'node:test';

import {resolveViewerFile, viewerDirFor} from './viewer_files.js';

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

describe('viewerDirFor', () => {
  it("puts the viewer's files beside the code", () => {
    assert.equal(viewerDirFor('/x/dist'), path.join('/x/dist', 'viewer'));
  });
});
