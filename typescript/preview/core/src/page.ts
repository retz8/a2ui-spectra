/**
 * The page's side of the preview protocol, for every adapter. The page says
 * it is ready with its claims; each render it receives is applied as the
 * render difference says, one message at a time, a refused message reported
 * with its index; every report, and the shown surface's data model, is
 * tagged with the render it belongs to. An
 * adapter gives the core four things: making a processor from the catalogs,
 * feeding it one message, mounting a surface, and tearing down.
 */
import {claimsOf, type ClaimedCatalog} from './claims.js';
import {type Applied, differenceOf, keysOf} from './difference.js';
import {
  isRenderMessage,
  PREVIEW_PROTOCOL,
  type PageMessage,
  type PreviewAction,
  type RenderMessage,
  type Report,
} from './protocol.js';

/** How the page and the viewer reach each other; the web adapters use `postMessage`. */
export interface PreviewTransport {
  send(message: PageMessage): void;
  /** Calls back with each message the viewer sends; returns the way to stop. */
  listen(onMessage: (message: unknown) => void): () => void;
}

/** Errors the page saw outside any component, such as the window's error events. */
export interface ErrorSource {
  listen(onError: (error: unknown) => void): () => void;
}

/** What a processor's surfaces report to the core. */
export interface PageEvents {
  /** A control was pressed; the data model is the surface's at that moment. */
  action(action: PreviewAction, dataModel: unknown): void;
  /** A surface's data model, once it is created and whenever it changes. */
  dataModel(surfaceId: string, dataModel: unknown): void;
  /** Web core reported an error on the surface through its error channel. */
  surfaceError(error: {code: string; message: string; componentId?: string}): void;
  /** A component threw while drawing. */
  componentFailed(failure: {componentId?: string; componentType?: string; error: unknown}): void;
}

/** The four things an adapter gives the core. */
export interface PreviewAdapter<P> {
  /** A processor with the page's catalogs, its surfaces reporting to the events given. */
  createProcessor(events: PageEvents): P;
  /** Feeds one message; throws when the processor refuses it. */
  feed(processor: P, message: unknown): void;
  /** Draws the surface with this id, now or once a message creates it. */
  mount(processor: P, surfaceId: string): void;
  /** Disposes of the processor and what it drew. */
  teardown(processor: P): void;
}

export interface PreviewPageOptions<P> {
  catalogs: Iterable<ClaimedCatalog>;
  adapter: PreviewAdapter<P>;
  transport: PreviewTransport;
  errors?: ErrorSource;
}

/** A running preview page. */
export interface PreviewPage {
  stop(): void;
}

/**
 * Whether a value is an error: an `Error` of this window, or of another,
 * such as an iframe's, which `instanceof` does not see.
 */
function isError(error: unknown): error is {name: string; message: string} {
  return (
    error instanceof Error ||
    (typeof error === 'object' &&
      error !== null &&
      typeof (error as {name?: unknown}).name === 'string' &&
      typeof (error as {message?: unknown}).message === 'string')
  );
}

/** The text of an error as the page reports it: its name and its message. */
export function errorText(error: unknown): string {
  if (isError(error)) {
    return error.message === '' ? error.name : `${error.name}: ${error.message}`;
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as {message: unknown}).message);
  }
  return String(error);
}

/** The code of an error a processor threw: web core's own, or the error's name. */
function codeOf(error: unknown): string {
  const code = (error as {code?: unknown} | null)?.code;
  if (typeof code === 'string') return code;
  return isError(error) ? error.name : 'ERROR';
}

/** The message of a processor's refusal, without the name its text would add. */
function refusalOf(error: unknown): string {
  return isError(error) ? error.message : errorText(error);
}

/** Starts the page's side of the protocol: sends the ready message and applies each render. */
export function startPreviewPage<P>({
  catalogs,
  adapter,
  transport,
  errors,
}: PreviewPageOptions<P>): PreviewPage {
  let current: number | undefined;
  let applied: Applied | undefined;
  let processor: P | undefined;
  /** Counts the processors made, so a disposed one's late events are dropped. */
  let generation = 0;
  /** What the current processor's surfaces have reported, each once, for every later render too. */
  let reports: Report[] = [];
  let seen = new Set<string>();
  /** The surface the current render shows. */
  let shown: string | undefined;
  /** The current processor's last data model of each surface, and the render it was last sent for. */
  let models = new Map<string, unknown>();
  let modelSentFor: number | undefined;

  const send = (report: Report) => {
    if (current !== undefined) {
      transport.send({type: 'a2ui-spectra-preview/report', render: current, report});
    }
  };
  const add = (report: Report) => {
    const key = JSON.stringify(report);
    if (seen.has(key)) return;
    seen.add(key);
    reports.push(report);
    send(report);
  };
  const sendModel = () => {
    if (current === undefined || shown === undefined || !models.has(shown)) return;
    modelSentFor = current;
    transport.send({
      type: 'a2ui-spectra-preview/data-model',
      render: current,
      surfaceId: shown,
      dataModel: models.get(shown),
    });
  };
  const failed = (failure: {componentId?: string; componentType?: string; error: unknown}) => {
    add({
      kind: 'component',
      ...(failure.componentId !== undefined && {componentId: failure.componentId}),
      ...(failure.componentType !== undefined && {componentType: failure.componentType}),
      error: errorText(failure.error),
    });
  };
  const eventsFor = (made: number): PageEvents => ({
    action: (action, dataModel) => {
      if (made !== generation || current === undefined) return;
      transport.send({type: 'a2ui-spectra-preview/action', render: current, action, dataModel});
    },
    dataModel: (surfaceId, dataModel) => {
      if (made !== generation) return;
      models.set(surfaceId, dataModel);
      if (surfaceId === shown) sendModel();
    },
    surfaceError: ({code, message, componentId}) => {
      if (made !== generation) return;
      add({kind: 'surface', code, error: message, ...(componentId !== undefined && {componentId})});
    },
    componentFailed: failure => {
      if (made === generation) failed(failure);
    },
  });

  const apply = (render: RenderMessage) => {
    current = render.render;
    shown = render.surfaceId;
    const keys = keysOf(render.messages);
    const difference = differenceOf(applied, {surfaceId: render.surfaceId, keys});
    let from = 0;
    if (difference.kind === 'reset' || processor === undefined) {
      if (processor !== undefined) adapter.teardown(processor);
      generation += 1;
      reports = [];
      seen = new Set();
      models = new Map();
      processor = adapter.createProcessor(eventsFor(generation));
    } else {
      from = difference.from;
      // What the surface reported so far still holds for the state it stands in.
      for (const report of reports) send(report);
    }
    const target = processor;
    render.messages.slice(from).forEach((message, offset) => {
      try {
        adapter.feed(target, message);
      } catch (error) {
        add({kind: 'refused', index: from + offset, code: codeOf(error), error: refusalOf(error)});
      }
    });
    applied = {surfaceId: render.surfaceId, keys};
    adapter.mount(target, render.surfaceId);
    // A render that left the data model as it was still gets it, under its own number.
    if (modelSentFor !== current) sendModel();
  };

  const stopListening = transport.listen(message => {
    if (isRenderMessage(message)) apply(message);
  });
  const stopErrors = errors?.listen(error => {
    if (current !== undefined) failed({error});
  });
  transport.send({
    type: 'a2ui-spectra-preview/ready',
    protocol: PREVIEW_PROTOCOL,
    claims: claimsOf(catalogs),
  });

  return {
    stop: () => {
      stopListening();
      stopErrors?.();
      if (processor !== undefined) adapter.teardown(processor);
      processor = undefined;
      generation += 1;
    },
  };
}
