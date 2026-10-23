import {spawn} from 'node:child_process';

/** Opens a URL in the default browser, ignoring any failure to do so. */
export function openBrowser(url: string): void {
  const [command, args, verbatim] =
    process.platform === 'darwin'
      ? ['open', [url], false]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')], true]
        : ['xdg-open', [url], false];
  try {
    const child = spawn(command, args, {
      stdio: 'ignore',
      detached: true,
      windowsVerbatimArguments: verbatim,
    });
    child.on('error', () => {});
    child.unref();
  } catch {
    // The URL is printed; opening the browser is a convenience.
  }
}
