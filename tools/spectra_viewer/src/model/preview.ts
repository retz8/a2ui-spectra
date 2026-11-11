/**
 * The preview: what a page is sent to draw the surface in view, which page
 * draws it, and where what the page reports goes.
 *
 * A render carries the messages that name the surface, the conversation's
 * earlier turns' and then the turn's own up to the step selected. A surface
 * goes to the first page, configured pages in config order and the built-in
 * page last, whose claims cover the catalogs its messages name at its
 * protocol version, matched with web core's compatibility rule. A page's
 * reports become problems of the turn in view, each on a step: a component
 * failure on the step whose message carried the component, a refused
 * message on that message's step, an error web core reported on the
 * component's step or the outcome. A component failure always counts; a
 * refused message or a web core error on a step with a problem of the
 * viewer's own folds under it as a quiet line, and a refused message of an
 * earlier turn, which that turn counts, folds on the last step.
 */
import {isCatalogVersionCompatible} from '@a2ui/web_core/adapters';
import type {Claim, Report} from 'a2ui-spectra-preview';

import {agentMessages, catalogIdsIn, componentPointer, surfaceIdOf} from './messages.ts';
import type {FoldedRejection, Problem} from './problems.ts';
import type {Turn, TurnRecordEvent} from './record.ts';
import {isThrough, messageTypeOf, type Position, type TimelineRow} from './steps.ts';

/** The third line of a render error's problem block. */
export const PREVIEW_NOTE = 'Preview page · not recorded';

/** One message of a surface's list: the message, and its key when it is the turn's own. */
export interface FeedMessage {
  message: unknown;
  key?: string;
}

/**
 * The messages that name a surface: the agent's of the conversation's
 * earlier turns, then the turn's own up to a position, or through the turn.
 */
export function surfaceFeedOf(
  earlierTurns: readonly Turn[],
  events: readonly TurnRecordEvent[],
  through: Position | undefined,
  surfaceId: string,
): FeedMessage[] {
  const earlier = earlierTurns
    .flatMap(turn => agentMessages(turn.events))
    .filter(({message}) => surfaceIdOf(message) === surfaceId)
    .map(({message}) => ({message}));
  const own = agentMessages(events)
    .filter(message => through === undefined || isThrough(message, through))
    .filter(({message}) => surfaceIdOf(message) === surfaceId)
    .map(({key, message}) => ({key, message}));
  return [...earlier, ...own];
}

/** What a page has to render to draw a surface. */
export interface SurfaceTarget {
  /** The catalogs its messages name: the surface's, and in v1.0 its components' own. */
  catalogIds: string[];
  /** Its `createSurface`'s version, such as `v0.9.1`. */
  protocolVersion?: string;
}

export function targetOf(feed: readonly FeedMessage[]): SurfaceTarget {
  const ids = new Set<string>();
  let version: string | undefined;
  for (const {message} of feed) {
    const type = messageTypeOf(message);
    if (type !== 'createSurface' && type !== 'updateComponents') continue;
    for (const id of catalogIdsIn((message as Record<string, unknown>)[type])) ids.add(id);
    const stated = (message as {version?: unknown}).version;
    if (type === 'createSurface' && version === undefined && typeof stated === 'string') {
      version = stated;
    }
  }
  return {catalogIds: [...ids], ...(version !== undefined && {protocolVersion: version})};
}

/** A preview page as the viewer knows it. */
export interface PreviewPageState {
  id: string;
  /** Its URL as configured, or `built-in`. */
  label: string;
  /**
   * `waiting` until it first answers or times out; `ready` once it said it is
   * ready in the protocol's version; `reloading` when a ready page loaded
   * again and has not answered yet, its claims kept meanwhile; `unanswered`
   * when it did not answer in time; `mismatch` when it speaks another version
   * of the protocol.
   */
  status: PageStatus;
  claims: Claim[];
  /** The protocol version a mismatched page speaks. */
  protocol?: number;
  /** Whether the page has been reloading for long enough that the Preview header says so. */
  reloadingNoted?: boolean;
}

export type PageStatus = 'waiting' | 'ready' | 'reloading' | 'unanswered' | 'mismatch';

/** How long a page has to say it is ready, and how long a ready that came first is owed its document's load. */
export const ANSWER_MS = 5000;

/** How close a page's second ready is to its last, no load between, to be the same document's. */
export const SAME_DOCUMENT_MS = 1000;

/**
 * What is open between a page's readies and its iframe's loads. A page's
 * ready and its load come in either order, a built page's ready first and a
 * dev server's page's load first, and a page on another origin cannot be seen
 * to begin a reload, so the two are paired, each document's load with its
 * ready.
 */
export interface Pairing {
  /** Until when the page's last ready is owed its document's load. */
  owedUntil?: number;
  /** Whether a load is waiting for its document's ready. */
  loadWaiting?: boolean;
  /** When the page's last ready came, no load since. */
  lastReady?: number;
}

/**
 * What a ready does to the pairing. One that comes while a load is waiting
 * answers it, and is owed nothing. One within a second of the page's last
 * ready, no load between, is the same document's, as React's development
 * mode mounts twice, and changes nothing. Any other is owed one load, its
 * own document's, for the answer window.
 */
export function readyOf(pairing: Pairing, now: number): Pairing {
  if (pairing.loadWaiting === true) return {lastReady: now};
  if (pairing.lastReady !== undefined && now - pairing.lastReady <= SAME_DOCUMENT_MS) {
    return pairing;
  }
  return {owedUntil: now + ANSWER_MS, lastReady: now};
}

/**
 * What a load of a page's iframe does. A load that is owed changes nothing,
 * and nothing is owed after it. One that is not owed is a new document that
 * has not answered, and waits for its ready: a ready page is reloading, and
 * the answer timer is to be armed; a page in any other state is left as it
 * is.
 */
export function loadOf(
  page: {status: PageStatus} & Pairing,
  now: number,
): {status: PageStatus; arm: boolean; pairing: Pairing} {
  if (page.owedUntil !== undefined && now <= page.owedUntil) {
    return {status: page.status, arm: false, pairing: {}};
  }
  return page.status === 'ready'
    ? {status: 'reloading', arm: true, pairing: {loadWaiting: true}}
    : {status: page.status, arm: false, pairing: {loadWaiting: true}};
}

/**
 * How long a page reloads before the Preview header says so. A healthy page
 * on a dev server answers within milliseconds of its load, 0 to 15 ms as
 * measured, and the note would flicker for it.
 */
export const RELOADING_NOTE_MS = 200;

/**
 * The Preview header's quiet note of the page drawing the surface: its
 * label, and that it is reloading once it has been for a moment.
 */
export function pageNoteOf(page: PreviewPageState): {text: string; reloading: boolean} {
  const reloading = page.status === 'reloading' && page.reloadingNoted === true;
  return {text: reloading ? `${page.label} · reloading` : page.label, reloading};
}

/** A page that did not answer in time: unanswered, claiming nothing. */
export function timedOut<P extends PreviewPageState>(page: P): P {
  return {...page, status: 'unanswered', claims: []};
}

export type Route<P extends PreviewPageState = PreviewPageState> =
  {kind: 'page'; page: P} | {kind: 'waiting'} | {kind: 'none'; catalogId?: string; unanswered: P[]};

/** Whether a claim covers a catalog at a surface's protocol version. */
export function serves(
  claim: Claim,
  catalogId: string,
  protocolVersion: string | undefined,
): boolean {
  return (
    claim.catalogId === catalogId &&
    (protocolVersion === undefined ||
      isCatalogVersionCompatible(claim.protocolVersion, protocolVersion))
  );
}

function claimsTarget(page: PreviewPageState, target: SurfaceTarget): boolean {
  return (
    target.catalogIds.length > 0 &&
    target.catalogIds.every(id =>
      page.claims.some(claim => serves(claim, id, target.protocolVersion)),
    )
  );
}

/** Whether a page's claims stand: it is ready, or reloading with the claims it last made. */
function answers(page: PreviewPageState): boolean {
  return page.status === 'ready' || page.status === 'reloading';
}

/**
 * The page that draws a surface: the first, in the order given, that is
 * ready and claims every catalog the surface's messages name. A page still
 * waiting for its first answer ahead of it holds the surface until it
 * answers or times out, and a page that is reloading keeps the surfaces it
 * claimed until it answers again or times out.
 */
export function routeOf<P extends PreviewPageState>(
  pages: readonly P[],
  target: SurfaceTarget,
): Route<P> {
  for (const page of pages) {
    if (page.status === 'waiting') return {kind: 'waiting'};
    if (answers(page) && claimsTarget(page, target)) return {kind: 'page', page};
  }
  const ready = pages.filter(answers);
  const unclaimed =
    target.catalogIds.find(
      id =>
        !ready.some(page => page.claims.some(claim => serves(claim, id, target.protocolVersion))),
    ) ?? target.catalogIds[0];
  return {
    kind: 'none',
    ...(unclaimed !== undefined && {catalogId: unclaimed}),
    unanswered: pages.filter(page => page.status === 'unanswered' || page.status === 'mismatch'),
  };
}

/** Why a page that does not draw is not answering, as the "No preview" state names it. */
export function unansweredLine(page: PreviewPageState, speaks: number): string {
  return page.status === 'mismatch'
    ? `${page.label}: preview page speaks protocol ${page.protocol}, this Spectra speaks ${speaks}`
    : `${page.label} has not answered`;
}

/** A page's reports as the turn's problems, and the ones that fold under the viewer's own. */
export interface PreviewProblems {
  problems: Problem[];
  folded: FoldedRejection[];
  /** The plain sentence of every report, for the Preview pane's strip, in order. */
  lines: string[];
}

/**
 * Where the reports of a page's render go, the render of a surface's list
 * given: each on its step, counted or folded under the problems the viewer
 * already has on that step.
 */
export function previewProblemsOf(
  reports: readonly Report[],
  feed: readonly FeedMessage[],
  surfaceId: string,
  timeline: readonly TimelineRow[],
  existing: readonly Problem[],
): PreviewProblems {
  const stepOfMessage = new Map<string, string>();
  for (const row of timeline) {
    if (row.row === 'step' && row.messageKey !== undefined) {
      stepOfMessage.set(row.messageKey, row.id);
    }
  }
  const last = [...timeline].reverse().find(row => row.row === 'step');
  const turnLevel = last?.id ?? '';
  const withProblems = new Set(existing.map(problem => problem.stepId));
  const result: PreviewProblems = {problems: [], folded: [], lines: []};

  /** The step of the turn's own message that last carried a component, and the line of the component's id in it. */
  const componentStep = (componentId: string): {stepId: string; inner?: string} => {
    for (let index = feed.length - 1; index >= 0; index -= 1) {
      const {message, key} = feed[index];
      const pointer = componentPointer(message, componentId);
      if (pointer === undefined) continue;
      const stepId = key === undefined ? undefined : stepOfMessage.get(key);
      return stepId === undefined ? {stepId: turnLevel} : {stepId, inner: `${pointer}/id`};
    }
    return {stepId: turnLevel};
  };

  for (const report of reports) {
    if (report.kind === 'component') {
      const place =
        report.componentId === undefined ? {stepId: turnLevel} : componentStep(report.componentId);
      const sentence =
        report.componentId === undefined
          ? 'A component did not render.'
          : `${report.componentType ?? 'Component'} ${report.componentId} did not render.`;
      result.lines.push(sentence);
      result.problems.push({
        stepId: place.stepId,
        sentence,
        code: report.error,
        note: PREVIEW_NOTE,
        surfaceId,
        ...(place.inner !== undefined && {inner: place.inner}),
      });
      continue;
    }
    if (report.kind === 'refused') {
      const key = feed[report.index]?.key;
      const stepId = (key === undefined ? undefined : stepOfMessage.get(key)) ?? turnLevel;
      const sentence = 'The preview page refused this message.';
      result.lines.push(sentence);
      if (key === undefined) {
        // An earlier turn's message: that turn counts the refusal.
        result.folded.push({
          stepId,
          sentence: report.error,
          lead: "The preview page also refused an earlier turn's message",
        });
      } else if (withProblems.has(stepId)) {
        result.folded.push({
          stepId,
          sentence: report.error,
          lead: 'The preview page also refused this message',
        });
      } else {
        result.problems.push({
          stepId,
          sentence,
          code: `${report.code}: ${report.error}`,
          note: PREVIEW_NOTE,
          surfaceId,
        });
      }
      continue;
    }
    const place =
      report.componentId === undefined ? {stepId: turnLevel} : componentStep(report.componentId);
    result.lines.push(report.error);
    if (withProblems.has(place.stepId)) {
      result.folded.push({
        stepId: place.stepId,
        sentence: report.error,
        lead: 'The preview page also reported',
      });
    } else {
      result.problems.push({
        stepId: place.stepId,
        sentence: report.error,
        code: `${report.code} · A2UI web core in the preview page`,
        note: PREVIEW_NOTE,
        surfaceId,
        ...(place.inner !== undefined && {inner: place.inner}),
      });
    }
  }
  return result;
}
