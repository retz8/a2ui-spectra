/**
 * The rows a selected call or parse covers: the rows after it that start
 * inside it, up to the moment its result shows, its end or a parse's last
 * message. A row its delivery times starts at its delivery's moment.
 */
import type {TimelineRow} from './steps.ts';

export function coveredRowsOf(
  rows: readonly TimelineRow[],
  selectedId: string,
  untilMs: number,
): ReadonlySet<string> {
  const covered = new Set<string>();
  const index = rows.findIndex(row => row.id === selectedId);
  if (index < 0) return covered;
  let atMs = rows[index].offsetMs ?? 0;
  for (const row of rows.slice(index + 1)) {
    atMs = row.offsetMs ?? atMs;
    if (atMs <= untilMs) covered.add(row.id);
  }
  return covered;
}
