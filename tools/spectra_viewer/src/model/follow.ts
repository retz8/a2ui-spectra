/**
 * Following the newest: the step the turn view shows while a turn is open and
 * where it lands when the turn closes, and the turn the list selects as new
 * turns open.
 */
import type {TimelineRow} from './steps.ts';

/** The step the turn view shows. */
export interface StepInView {
  /** The step the result and the step's detail show. */
  row: TimelineRow | undefined;
  /** Whether the view follows the newest step of the open turn. */
  following: boolean;
  /** Whether a step is selected: picked, or landed on as a problem. The step's detail opens for it. */
  selected: boolean;
}

/**
 * The step in view. A picked step stays until it is let go of, as Jump to
 * latest does. While the turn is open, the view follows its newest step. When
 * a turn the view followed closes, it lands on the first step with a problem,
 * or on the final state, the last step, when there is none; a turn opened
 * once closed shows its final state.
 */
export function stepInView(
  rows: readonly TimelineRow[],
  {
    open,
    picked,
    followed,
    problems,
  }: {
    open: boolean;
    /** The step picked, by its id. */
    picked: string | undefined;
    /** Whether the view followed the turn while it was open. */
    followed: boolean;
    /** How many problems each step has, by its id. */
    problems: ReadonlyMap<string, number>;
  },
): StepInView {
  const pickedRow = picked === undefined ? undefined : rows.find(row => row.id === picked);
  if (pickedRow !== undefined) return {row: pickedRow, following: false, selected: true};
  const last = rows[rows.length - 1];
  if (open) return {row: last, following: true, selected: false};
  const problem = followed ? rows.find(row => (problems.get(row.id) ?? 0) > 0) : undefined;
  if (problem !== undefined) return {row: problem, following: false, selected: true};
  return {row: last, following: false, selected: false};
}

/**
 * The turn the list selects as the newest turn changes, or nothing when the
 * selection stays: the newest, when no turn is selected, or when a new turn
 * opened while the newest before it was selected.
 */
export function followNewest(
  before: string | undefined,
  newest: string | undefined,
  selected: string | undefined,
): string | undefined {
  if (newest === undefined || newest === selected) return undefined;
  if (selected === undefined) return newest;
  return newest !== before && selected === before ? newest : undefined;
}
