// The link check: every relative link and image in every tracked Markdown file names a tracked
// file or a folder holding one, inside the repository, and every anchor a link names, in the
// same file or another, is a heading or an `<a>` anchor there, as GitHub reads them.
//
// From the repository root, as CI's `ci` job runs it:
//
//     node scripts/check_links.mjs
//
// It exits non-zero with a line for each link that does not resolve. Links with a scheme, such
// as `https:`, are not fetched. `--untracked` counts the files git does not ignore as tracked,
// for a document not yet added.

import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {linksOf, pathProblem, resolveTarget, trackedFiles, trackedFolders} from './markdown.mjs';

const REPO_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const files = trackedFiles(REPO_DIR, {untracked: process.argv.includes('--untracked')});
const folders = trackedFolders(files);
const texts = new Map();
const read = file => {
  if (!texts.has(file)) texts.set(file, readFileSync(path.join(REPO_DIR, file), 'utf8'));
  return texts.get(file);
};

const markdown = [...files].filter(file => file.endsWith('.md')).sort();
const problems = [];
let count = 0;
for (const file of markdown) {
  for (const link of linksOf(read(file))) {
    const resolved = resolveTarget(file, link.target);
    if (resolved === null) continue;
    count += 1;
    const problem = pathProblem(resolved, {files, folders, read, kind: link.kind});
    if (problem !== null) problems.push(`${file}:${link.line}: ${link.target} ${problem}.`);
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  console.error(
    `\ncheck_links: ${problems.length} of ${count} relative links in ${markdown.length} Markdown files do not resolve.`,
  );
  process.exitCode = 1;
} else {
  console.log(`check_links: ${count} relative links in ${markdown.length} Markdown files resolve.`);
}
