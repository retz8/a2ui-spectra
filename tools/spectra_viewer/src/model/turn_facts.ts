/**
 * What a turn's view draws from its record alone, worked out once per turn:
 * the turn's facts, and its surfaces replayed over the whole turn. A view of
 * one turn calls each once; a view comparing two turns calls each for both.
 */
import {type Retry, retriesOf} from './a2ui_step.ts';
import type {ProcessorCatalog} from './catalogs.ts';
import {legacyByStep, legacyEntriesOf, legacyKeysByPath, type StepLegacy} from './legacy_form.ts';
import {rowTagsOf} from './provenance.ts';
import {
  isParse,
  isPromptGeneration,
  type LegacyFormEntry,
  newerStepVersionOf,
  type Turn,
  type TurnRecordEvent,
} from './record.ts';
import {type Replay, replay} from './replay.ts';
import {type TimelineRow, timelineOf} from './steps.ts';
import {summaryOf, type TurnSummary} from './summary.ts';

/** A turn as its view holds it: closed, or open with its events so far. */
export type TurnInView =
  | {
      /** The closed turn. */
      turn: Turn;
      /** The conversation's earlier turns; none while they are being read. */
      earlier: readonly Turn[] | undefined;
    }
  | {
      /** The open turn's events so far. */
      events: readonly TurnRecordEvent[];
      /** The open turn's start, as the live stream sent it. */
      startTime: string;
      earlier: readonly Turn[] | undefined;
    };

/** A turn's facts, from its record alone. */
export interface TurnFacts {
  /** Whether the turn is still open. */
  open: boolean;
  events: readonly TurnRecordEvent[];
  /** The closed turn; none while it is open. */
  turn: Turn | undefined;
  /** The closed turn's summary. */
  summary: TurnSummary | undefined;
  /** The turn's start, in milliseconds since the Unix epoch. */
  startMs: number;
  /** A closed turn's end, to which its lanes run; none for an open turn, whose lanes run to the present. */
  endMs: number | undefined;
  earlier: readonly Turn[] | undefined;
  timeline: TimelineRow[];
  /** The retries among the model calls. */
  retries: Map<string, Retry>;
  /** Each row's tag, by its id. */
  tags: ReadonlyMap<string, string>;
  /** Whether a wrapper reported the A2UI step: a parse or a prompt generation. */
  hasStep: boolean;
  /** The turn record version a step was reported under when it is newer than this Spectra reads. */
  newerStep: string | undefined;
  /** The legacy form, as the record's catalog check lists it. */
  legacyEntries: LegacyFormEntry[];
  legacySteps: Map<string, StepLegacy>;
  legacyStepIds: ReadonlySet<string>;
  legacyKeys: Map<string, string[]>;
  /** The events whose A2UI messages the surfaces replay: the turn's own, its wire's messages read. */
  surfaceEvents: readonly TurnRecordEvent[];
}

/** A turn's facts, as its view holds it. */
export function turnFactsOf(view: TurnInView): TurnFacts {
  const open = !('turn' in view);
  const turn = 'turn' in view ? view.turn : undefined;
  const events = 'turn' in view ? view.turn.events : view.events;
  const summary = turn === undefined ? undefined : summaryOf(turn);
  const startMs = 'turn' in view ? (summary?.startTime ?? 0) : Date.parse(view.startTime);
  const endMs = open || summary === undefined ? undefined : summary.startTime + summary.durationMs;
  const timeline = timelineOf(events, startMs);
  const retries = retriesOf(events);
  const legacyEntries = legacyEntriesOf(events);
  const legacySteps = legacyByStep(events, timeline, legacyEntries);
  return {
    open,
    events,
    turn,
    summary,
    startMs,
    endMs,
    earlier: view.earlier,
    timeline,
    retries,
    tags: rowTagsOf(timeline, retries),
    hasStep: events.some(event => isParse(event) || isPromptGeneration(event)),
    newerStep: newerStepVersionOf(events),
    legacyEntries,
    legacySteps,
    legacyStepIds: new Set(legacySteps.keys()),
    legacyKeys: legacyKeysByPath(legacyEntries),
    surfaceEvents: events,
  };
}

/**
 * A turn's surfaces replayed over the whole turn, from the events its facts
 * name for them, with the conversation's earlier turns before; none while the
 * earlier turns are being read.
 */
export function turnSurfacesOf(
  earlier: readonly Turn[] | undefined,
  surfaceEvents: readonly TurnRecordEvent[],
  catalogs: readonly ProcessorCatalog[],
): Replay | undefined {
  return earlier === undefined ? undefined : replay(earlier, surfaceEvents, undefined, catalogs);
}
