/** The surfaces a check could not judge, each listed once. */
import type {SkippedSurface} from '../record/turn_record.js';

export class SkippedList {
  readonly #entries: SkippedSurface[] = [];

  add(entry: SkippedSurface): void {
    const exists = this.#entries.some(
      each =>
        each.surfaceId === entry.surfaceId &&
        each.catalogId === entry.catalogId &&
        each.reason === entry.reason,
    );
    if (!exists) this.#entries.push(entry);
  }

  get list(): SkippedSurface[] {
    return [...this.#entries];
  }
}

/** A skipped entry for a surface, with the catalog id it named when it named one. */
export function skippedSurface(
  surfaceId: string,
  catalogId: string | undefined,
  reason: SkippedSurface['reason'],
): SkippedSurface {
  return {surfaceId, ...(catalogId !== undefined && {catalogId}), reason};
}
