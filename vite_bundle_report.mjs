/**
 * A Vite plugin that reports what a build bundled, for the third-party notices
 * of Spectra's binary, which embeds the viewer's build and the basic
 * preview's: every file from an npm package that put something into the
 * build's output, written to `bundle-report.json` in the project's root,
 * relative to it.
 *
 * A module counts when it rendered into a chunk, and a stylesheet whatever its
 * JavaScript renders to, since its rules go to the build's CSS; an emitted
 * asset, such as a font, by the files it came from. A package that one of the
 * project's own stylesheets imports by name, as `@import 'tailwindcss'`, is
 * inlined by Tailwind where the bundle does not see it, and counts by its
 * `package.json`. List this plugin first, so that it reads those stylesheets
 * before any other plugin transforms them.
 */
import {existsSync, writeFileSync} from 'node:fs';
import path from 'node:path';

const IN_NODE_MODULES = /[\\/]node_modules[\\/]/;
const STYLESHEET = /\.css$/;

/** A module id without its query or hash. */
function fileOf(id) {
  return id.replace(/[?#].*$/, '');
}

/** The package a bare specifier names: `@scope/name` or `name`. */
function packageOf(specifier) {
  const parts = specifier.split('/');
  return (specifier.startsWith('@') ? parts.slice(0, 2) : parts.slice(0, 1)).join('/');
}

/** A package's `package.json` as Node finds it from a directory, walking up. */
function manifestFrom(dir, name) {
  for (let at = dir; ; at = path.dirname(at)) {
    const manifest = path.join(at, 'node_modules', name, 'package.json');
    if (existsSync(manifest)) return manifest;
    if (path.dirname(at) === at) return undefined;
  }
}

export function bundleReport() {
  let root = process.cwd();
  const files = new Set();
  const add = file => {
    if (IN_NODE_MODULES.test(file)) files.add(file);
  };
  return {
    name: 'a2ui-spectra-bundle-report',
    apply: 'build',
    enforce: 'pre',
    configResolved(config) {
      root = config.root;
    },
    transform(code, id) {
      const file = fileOf(id);
      if (!STYLESHEET.test(file) || IN_NODE_MODULES.test(file)) return null;
      for (const [, specifier] of code.matchAll(/@import\s+(?:url\(\s*)?['"]([^'"]+)['"]/g)) {
        if (/^(\.|\/|[a-z][a-z0-9+.-]*:)/i.test(specifier)) continue;
        const manifest = manifestFrom(path.dirname(file), packageOf(specifier));
        if (manifest === undefined) {
          this.error(`${file} imports ${specifier}, whose package is not installed.`);
        }
        add(manifest);
      }
      return null;
    },
    generateBundle(_options, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type === 'chunk') {
          for (const [id, module] of Object.entries(item.modules)) {
            if (module.renderedLength > 0 || STYLESHEET.test(fileOf(id))) add(fileOf(id));
          }
        } else {
          for (const name of item.originalFileNames) add(path.resolve(root, name));
        }
      }
    },
    closeBundle() {
      const relative = [...files].map(file => path.relative(root, file).split(path.sep).join('/'));
      writeFileSync(
        path.join(root, 'bundle-report.json'),
        `${JSON.stringify({files: relative.sort()}, null, 2)}\n`,
      );
    },
  };
}
