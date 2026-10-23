import {readFileSync, statSync} from 'node:fs';
import type {IncomingMessage, ServerResponse} from 'node:http';
import path from 'node:path';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

/** The viewer's files: the copy of its build beside the tool's code. */
export function viewerDirFor(codeDir: string): string {
  return path.join(codeDir, 'viewer');
}

export type ViewerFile =
  {kind: 'file'; path: string} | {kind: 'index'; path: string} | {kind: 'outside'};

/**
 * Which file answers a URL path: the file itself when it exists in the
 * viewer's directory, the viewer's `index.html` for any other path inside it,
 * and nothing for a path that leads outside it.
 */
export function resolveViewerFile(viewerDir: string, urlPath: string): ViewerFile {
  const root = path.resolve(viewerDir);
  const target = path.resolve(root, '.' + path.posix.normalize('/' + urlPath));
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return {kind: 'outside'};
  }
  if (relative !== '' && isFile(target)) {
    return {kind: 'file', path: target};
  }
  return {kind: 'index', path: path.join(root, 'index.html')};
}

/** Answers a GET or HEAD request from the viewer's files. */
export function serveViewerFile(
  viewerDir: string,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  let urlPath: string;
  try {
    urlPath = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  } catch {
    sendText(response, 400, 'Bad request: the path is not valid.\n');
    return;
  }
  if (urlPath.includes('\0')) {
    sendText(response, 400, 'Bad request: the path is not valid.\n');
    return;
  }
  const file = resolveViewerFile(viewerDir, urlPath);
  if (file.kind === 'outside') {
    sendText(response, 404, 'Not found.\n');
    return;
  }
  let body: Buffer;
  try {
    body = readFileSync(file.path);
  } catch {
    sendText(
      response,
      500,
      "The viewer's files are missing. Build the tool, which copies the viewer's build beside it.\n",
    );
    return;
  }
  const type = CONTENT_TYPES[path.extname(file.path).toLowerCase()] ?? 'application/octet-stream';
  response.writeHead(200, {
    'content-type': type,
    'content-length': body.length,
    'x-content-type-options': 'nosniff',
    ...(file.kind === 'index' ? {'cache-control': 'no-cache'} : {}),
  });
  response.end(request.method === 'HEAD' ? undefined : body);
}

/** Sends a short plain-text answer. */
export function sendText(response: ServerResponse, status: number, text: string): void {
  const body = Buffer.from(text, 'utf8');
  response.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': body.length,
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

function isFile(target: string): boolean {
  try {
    return statSync(target).isFile();
  } catch {
    return false;
  }
}
