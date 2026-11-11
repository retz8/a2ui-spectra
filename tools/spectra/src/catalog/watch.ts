/**
 * The watch of the configured catalog files that no watch of the save
 * watcher's tells: one watch, not recursive, of each folder that holds one,
 * shared by the files in it, since a save that replaces a file would end a
 * watch on the file itself. Every watch is opened at start and none while
 * Spectra runs: on macOS opening a watcher drops the events of every other
 * while the system's stream is rebuilt. A file's change is told once, a quiet
 * spell after its last event.
 */
import {existsSync, watch} from 'node:fs';
import path from 'node:path';

import {type QuietSpell, quietSpell} from '../quiet_spell.js';
import {type OpenWatch, QUIET_SPELL_MS, type WatchHandle} from '../save_watcher.js';

export interface CatalogWatchOptions {
  /** The catalog files to watch, as absolute paths. */
  files: readonly string[];
  /** A file changed, or may have: it is to be read again. */
  onChange(file: string): void;
  /** Takes each line for the terminal. */
  log(line: string): void;
  quietSpellMs?: number;
  /** Asks the system for a watch of a folder; `fs.watch` by default. */
  open?: OpenWatch;
}

/** The watch as started. */
export interface CatalogWatch {
  stop(): void;
}

function reasonOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\.$/, '');
}

/** What the terminal says when a folder cannot be watched, or its watch fails. */
function failedLine(folder: string, reason: string): string {
  return (
    `Changes to the catalog files in ${folder} are not read: ${reason}. ` +
    'Stop Spectra and start it again to read a changed definition.'
  );
}

/**
 * Starts the watch. A watch that cannot be set up, or fails, or whose folder
 * is removed, is said in the terminal and Spectra carries on; a removed
 * folder is not picked up when it reappears.
 */
export function startCatalogWatch(options: CatalogWatchOptions): CatalogWatch {
  const {files, onChange, log} = options;
  const quietSpellMs = options.quietSpellMs ?? QUIET_SPELL_MS;
  const openWatch: OpenWatch =
    options.open ?? ((folder, watchOptions, listener) => watch(folder, watchOptions, listener));
  const watchers = new Map<string, WatchHandle>();
  let stopped = false;

  const drop = (folder: string) => {
    watchers.get(folder)?.close();
    watchers.delete(folder);
  };

  const spells = new Map<string, QuietSpell>(
    files.map(file => [
      file,
      quietSpell(() => {
        if (stopped) return;
        const folder = path.dirname(file);
        // A watched folder that is gone is watched no longer: its watch stays on what was removed.
        if (watchers.has(folder) && !existsSync(folder)) {
          drop(folder);
          log(
            `${folder} is gone, so its catalog files are no longer read again. ` +
              'Stop Spectra and start it again to watch it.',
          );
        }
        onChange(file);
      }, quietSpellMs),
    ]),
  );

  for (const folder of new Set(files.map(file => path.dirname(file)))) {
    const held = files.filter(file => path.dirname(file) === folder);
    try {
      const watcher = openWatch(folder, {recursive: false}, (_event, name) => {
        if (stopped || !watchers.has(folder)) return;
        // Without a name any of the folder's catalog files may have changed.
        const changed =
          name === null ? held : held.filter(file => file === path.resolve(folder, name));
        for (const file of changed) spells.get(file)?.notice();
      });
      watcher.unref();
      watcher.on('error', error => {
        if (stopped || !watchers.has(folder)) return;
        drop(folder);
        log(failedLine(folder, reasonOf(error)));
      });
      watchers.set(folder, watcher);
    } catch (error) {
      log(failedLine(folder, reasonOf(error)));
    }
  }

  return {
    stop() {
      stopped = true;
      for (const spell of spells.values()) spell.cancel();
      for (const folder of [...watchers.keys()]) drop(folder);
    },
  };
}
