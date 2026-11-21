// Markdown's links, images and heading anchors, read as GitHub reads them, for the link check,
// `check_links.mjs`, and for the packing commands and their checks, which write a packed README's
// relative links and images as GitHub URLs at the tag of the version being packed.
//
// A link is an inline link or image, `[text](target)` or `![alt](target)`, a reference
// definition, `[label]: target`, or an `href`, `src` or `srcset` on an `<a>`, `<img>` or
// `<source>`. Fenced code blocks, inline code and HTML comments hold no links. A Markdown file's
// anchors are its headings', as GitHub slugs them, and the `id` or `name` of each `<a>`.

import {execFileSync} from 'node:child_process';
import path from 'node:path';

/** This repository on GitHub, and its raw files. */
export const REPOSITORY = 'https://github.com/retz8/a2ui-spectra';
export const RAW_REPOSITORY = 'https://raw.githubusercontent.com/retz8/a2ui-spectra';

/** A link's target with a scheme, `https:`, `mailto:` and the like, or `//host`. */
const ABSOLUTE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/** A fence's opening line: up to three spaces, then three or more backticks or tildes. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** An inline link or image: its text, which may hold one level of brackets, and its target. */
const INLINE =
  /(!?)\[(?:[^[\]\\]|\\.|\[(?:[^[\]\\]|\\.)*\])*\]\(\s*(<[^>\n]*>|(?:[^\s()\\]|\\.|\((?:[^\s()\\]|\\.)*\))*)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;

/** A reference definition, on a line of its own. */
const DEFINITION = /^( {0,3}\[[^\]]+\]:[ \t]*)(<[^>\n]*>|\S+)/;

/** An `<a>`, `<img>` or `<source>` tag, and the attributes on it that hold a URL. */
const TAG = /<(a|img|source)\b[^>]*>/gi;
const URL_ATTRIBUTE = /\s(href|src|srcset)\s*=\s*("([^"]*)"|'([^']*)')/gi;
const ANCHOR_ATTRIBUTE = /\s(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

/** An ATX heading's line. */
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;

/**
 * The lines of a Markdown file that hold prose: each line's text, with fenced code blocks
 * blanked, and inline code and HTML comments replaced by spaces of the same length, so that an
 * offset in a masked line is the same offset in the line as written.
 */
function maskedLines(text) {
  const lines = text.split('\n');
  const masked = [];
  let fence = null;
  let comment = false;
  for (const line of lines) {
    if (fence !== null) {
      const close = new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`);
      if (close.test(line)) fence = null;
      masked.push({line, prose: ''.padEnd(line.length), code: true});
      continue;
    }
    const open = FENCE.exec(line);
    if (open !== null && !(open[1][0] === '`' && line.slice(open[0].length).includes('`'))) {
      fence = open[1];
      masked.push({line, prose: ''.padEnd(line.length), code: true});
      continue;
    }
    let prose = '';
    for (let at = 0; at < line.length;) {
      if (comment) {
        const end = line.indexOf('-->', at);
        const stop = end === -1 ? line.length : end + 3;
        prose += ''.padEnd(stop - at);
        at = stop;
        if (end !== -1) comment = false;
        continue;
      }
      if (line.startsWith('<!--', at)) {
        comment = true;
        continue;
      }
      if (line[at] === '`') {
        const run = /^`+/.exec(line.slice(at))[0];
        const end = line.indexOf(run, at + run.length);
        // A run of backticks that closes on the line, and not inside a longer run.
        if (end !== -1 && line[end + run.length] !== '`') {
          prose += ''.padEnd(end + run.length - at);
          at = end + run.length;
          continue;
        }
        prose += run;
        at += run.length;
        continue;
      }
      if (line[at] === '\\' && at + 1 < line.length) {
        prose += line.slice(at, at + 2);
        at += 2;
        continue;
      }
      prose += line[at];
      at += 1;
    }
    masked.push({line, prose, code: false});
  }
  return masked;
}

/**
 * Every link in a Markdown file: its kind, `link` or `image`, its target as written, the line it
 * is on, from 1, and the target's offsets in the file's text.
 */
export function linksOf(text) {
  const links = [];
  let offset = 0;
  maskedLines(text).forEach(({line, prose, code}, index) => {
    const add = (kind, target, start) =>
      links.push({
        kind,
        target,
        line: index + 1,
        start: offset + start,
        end: offset + start + target.length,
      });
    if (!code) {
      const definition = DEFINITION.exec(prose);
      if (definition !== null) {
        const raw = definition[2];
        const bare = raw.startsWith('<') ? raw.slice(1, -1) : raw;
        add('link', bare, definition[1].length + (raw.startsWith('<') ? 1 : 0));
      }
      for (const match of prose.matchAll(INLINE)) {
        const raw = match[2];
        if (raw === '') continue;
        const at = match.index + match[0].indexOf(`(`, match[0].lastIndexOf(']')) + 1;
        const start = line.indexOf(raw, at);
        const bare = raw.startsWith('<') ? raw.slice(1, -1) : raw;
        add(match[1] === '!' ? 'image' : 'link', bare, start + (raw.startsWith('<') ? 1 : 0));
      }
      for (const tag of prose.matchAll(TAG)) {
        const kind = tag[1].toLowerCase() === 'a' ? 'link' : 'image';
        for (const attribute of tag[0].matchAll(URL_ATTRIBUTE)) {
          const value = attribute[3] ?? attribute[4];
          const valueAt = tag.index + attribute.index + attribute[0].length - value.length - 1;
          if (attribute[1].toLowerCase() === 'srcset') {
            // Each candidate's URL, before its descriptor.
            for (const candidate of value.matchAll(/[^,\s][^\s,]*/g)) {
              if (/^\d+(\.\d+)?[wx]$/.test(candidate[0])) continue;
              add(kind, candidate[0], valueAt + candidate.index);
            }
          } else if (value !== '') {
            add(kind, value, valueAt);
          }
        }
      }
    }
    offset += line.length + 1;
  });
  return links;
}

/** A heading's text as GitHub renders it: inline code, links and emphasis read as their text. */
function headingText(markdown) {
  return markdown
    .replace(/(`+)([\s\S]*?)\1/g, (_, __, code) => code.trim())
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\*+/g, '')
    .replace(/(^|[^\p{L}\p{N}])_+(?=\S)|(?<=\S)_+(?=[^\p{L}\p{N}]|$)/gu, '$1')
    .replace(/~~/g, '')
    .replace(/\\(.)/g, '$1');
}

/** GitHub's slug of a heading's text, before a repeated slug is numbered. */
export function slugOf(text) {
  return headingText(text)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
}

/** Every anchor of a Markdown file: its headings' slugs, numbered as GitHub numbers them, and each `<a>`'s `id` and `name`. */
export function anchorsOf(text) {
  const anchors = new Set();
  const seen = new Map();
  const add = heading => {
    const base = slugOf(heading);
    let slug = base;
    while (seen.has(slug)) {
      const count = seen.get(base) + 1;
      seen.set(base, count);
      slug = `${base}-${count}`;
    }
    seen.set(slug, 0);
    anchors.add(slug);
  };
  const lines = maskedLines(text);
  lines.forEach(({line, prose, code}, index) => {
    if (code) return;
    const atx = ATX.exec(line);
    if (atx !== null) {
      add(atx[2] ?? '');
    } else if (/^ {0,3}(=+|-+)[ \t]*$/.test(line) && index > 0) {
      // A setext heading's underline, under a line of paragraph text.
      const above = lines[index - 1];
      const paragraph =
        !above.code &&
        above.line.trim() !== '' &&
        ATX.exec(above.line) === null &&
        !/^ {0,3}([-*+]|\d+[.)])\s|^ {0,3}>|^ {0,3}\||^ {0,3}</.test(above.line) &&
        (index < 2 ||
          lines[index - 2].line.trim() === '' ||
          lines[index - 2].code ||
          ATX.test(lines[index - 2].line));
      if (paragraph) add(above.line.trim());
    }
    for (const tag of prose.matchAll(/<a\b[^>]*>/gi)) {
      for (const attribute of tag[0].matchAll(ANCHOR_ATTRIBUTE)) {
        anchors.add(attribute[1] ?? attribute[2]);
      }
    }
  });
  return anchors;
}

/**
 * The repository's tracked files, as paths from its root with `/`; with `untracked`, the files
 * git does not ignore as well.
 */
export function trackedFiles(repoDir, {untracked = false} = {}) {
  const args = [
    'ls-files',
    '-z',
    ...(untracked ? ['--cached', '--others', '--exclude-standard'] : []),
  ];
  return new Set(
    execFileSync('git', args, {cwd: repoDir, encoding: 'utf8', maxBuffer: 1 << 26})
      .split('\0')
      .filter(file => file !== ''),
  );
}

/** The folders holding a tracked file, as paths from the root with `/`, the root as `''`. */
export function trackedFolders(files) {
  const folders = new Set(['']);
  for (const file of files) {
    for (let dir = path.posix.dirname(file); dir !== '.'; dir = path.posix.dirname(dir)) {
      folders.add(dir);
    }
  }
  return folders;
}

/**
 * A relative target, from the Markdown file at `from`, as the path it names from the
 * repository's root and its fragment; `null` for a target with a scheme. The path is `undefined`
 * when the target leaves the repository.
 */
export function resolveTarget(from, target) {
  if (ABSOLUTE.test(target)) return null;
  const hash = target.indexOf('#');
  const beforeHash = hash === -1 ? target : target.slice(0, hash);
  const fragment = hash === -1 ? undefined : target.slice(hash + 1);
  const pathPart = beforeHash.split('?')[0];
  let decoded;
  try {
    decoded = decodeURI(pathPart);
  } catch {
    decoded = pathPart;
  }
  if (decoded === '') return {path: from, fragment, self: true};
  const joined = decoded.startsWith('/')
    ? path.posix.normalize(decoded.slice(1))
    : path.posix.normalize(path.posix.join(path.posix.dirname(from), decoded));
  const cleaned = joined.replace(/\/$/, '') === '.' ? '' : joined.replace(/\/$/, '');
  if (cleaned === '..' || cleaned.startsWith('../')) return {path: undefined, fragment};
  return {path: cleaned, fragment, self: false};
}

/** Whether a fragment names a line or lines of a file GitHub shows as code, `L3` or `L3-L9`. */
const LINE_FRAGMENT = /^L\d+(-L\d+)?$/;

/**
 * What is wrong with a link to a path in the repository with a fragment: `null` when it
 * resolves. `read` returns a tracked Markdown file's text.
 */
export function pathProblem({path: target, fragment}, {files, folders, read, kind}) {
  if (target === undefined) return 'names a path outside the repository';
  const isFile = files.has(target);
  if (!isFile && !(kind === 'link' && folders.has(target))) {
    return kind === 'image'
      ? `names ${target}, which is not a tracked file`
      : `names ${target}, which is not tracked`;
  }
  if (fragment === undefined || fragment === '') return null;
  let decoded;
  try {
    decoded = decodeURIComponent(fragment);
  } catch {
    decoded = fragment;
  }
  const markdown = isFile
    ? target.endsWith('.md')
      ? target
      : null
    : files.has(`${target}/README.md`)
      ? `${target}/README.md`
      : null;
  if (markdown === null) {
    return isFile && LINE_FRAGMENT.test(decoded)
      ? null
      : `names #${fragment}, an anchor ${target} cannot hold`;
  }
  return anchorsOf(read(markdown)).has(decoded)
    ? null
    : `names #${fragment}, which ${markdown} has no heading or anchor for`;
}

/** A GitHub URL for a path in this repository at a ref: the raw file for an image, else its page. */
export function githubUrl({path: target, fragment}, {ref, kind, files}) {
  const encoded = encodeURI(target);
  const hash = fragment === undefined ? '' : `#${fragment}`;
  if (kind === 'image') return `${RAW_REPOSITORY}/${ref}/${encoded}`;
  return `${REPOSITORY}/${files.has(target) ? 'blob' : 'tree'}/${ref}/${encoded}${hash}`;
}

/**
 * A URL into this repository at a ref, as the path it names and its fragment; `null` for any
 * other URL, the repository's own pages, such as its issues, among them.
 */
export function repositoryPath(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const decode = part => {
    try {
      return decodeURI(part);
    } catch {
      return part;
    }
  };
  const fragment = parsed.hash === '' ? undefined : parsed.hash.slice(1);
  const page = /^\/retz8\/a2ui-spectra\/(blob|tree|raw)\/([^/]+)(?:\/(.*))?$/.exec(parsed.pathname);
  if (parsed.host === 'github.com' && page !== null) {
    return {
      ref: page[2],
      path: decode((page[3] ?? '').replace(/\/$/, '')),
      fragment,
      form: page[1],
    };
  }
  const raw = /^\/retz8\/a2ui-spectra\/([^/]+)\/(.+)$/.exec(parsed.pathname);
  if (parsed.host === 'raw.githubusercontent.com' && raw !== null) {
    return {ref: raw[1], path: decode(raw[2]), fragment, form: 'raw'};
  }
  return null;
}

/**
 * A README as a package carries it: each relative link and image written as a GitHub URL at the
 * version's tag, `v<version>`, a link to a file as its page, to a folder as the folder's page,
 * an image as the raw file, and a link to an anchor of the README itself as the README's page
 * with that anchor. `readme` is the README's path from the repository's root. A relative target
 * that does not resolve stops the packing.
 */
export function packedReadme(text, {readme, version, files, folders, read}) {
  const ref = `v${version}`;
  const problems = [];
  let out = '';
  let at = 0;
  for (const link of linksOf(text)) {
    const resolved = resolveTarget(readme, link.target);
    if (resolved === null) continue;
    const problem = pathProblem(resolved, {files, folders, read, kind: link.kind});
    if (problem !== null) {
      problems.push(`${readme}:${link.line}: ${link.target} ${problem}.`);
      continue;
    }
    out += text.slice(at, link.start) + githubUrl(resolved, {ref, kind: link.kind, files});
    at = link.end;
  }
  return {text: out + text.slice(at), problems};
}

/**
 * What is wrong with a packed README's links: a relative link, or a URL into this repository
 * whose path is not in it or whose anchor does not resolve.
 */
export function packedReadmeProblems(text, {where, files, folders, read}) {
  const problems = [];
  for (const link of linksOf(text)) {
    if (resolveTarget('README.md', link.target) !== null) {
      problems.push(`${where}:${link.line}: ${link.target} is a relative link.`);
      continue;
    }
    const inRepo = repositoryPath(link.target);
    if (inRepo === null) continue;
    const kind = inRepo.form === 'tree' ? 'link' : inRepo.form === 'raw' ? 'image' : 'file';
    if (kind === 'file' && !files.has(inRepo.path)) {
      problems.push(
        `${where}:${link.line}: ${link.target} names ${inRepo.path}, which is not a tracked file.`,
      );
      continue;
    }
    const problem = pathProblem(inRepo, {
      files,
      folders,
      read,
      kind: kind === 'file' ? 'link' : kind,
    });
    if (problem !== null) problems.push(`${where}:${link.line}: ${link.target} ${problem}.`);
  }
  return problems;
}
