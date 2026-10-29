/**
 * The preview protocol: the messages between Spectra's viewer and a preview
 * page. It names no carrier. A2UI messages go in; render errors, the shown
 * surface's data model and actions come out. The web adapters carry it over `postMessage` between the viewer
 * and the page in an iframe.
 */

/** The protocol's version, carried by the ready message. */
export const PREVIEW_PROTOCOL = 1;

/** The query parameter that carries the viewer's origin in a page's address. */
export const VIEWER_PARAMETER = 'a2ui-spectra-viewer';

/** A catalog the page renders: its id and the protocol version its definition targets. */
export interface Claim {
  catalogId: string;
  /** As web core's catalog states it, such as `0.9` or `1.0`. */
  protocolVersion: string;
}

/** The page is ready: the protocol it speaks and the catalogs it renders. */
export interface ReadyMessage {
  type: 'a2ui-spectra-preview/ready';
  protocol: number;
  claims: Claim[];
}

/**
 * Draw a surface: every A2UI message that names it, up to the step selected,
 * in order. Each render carries the next running number.
 */
export interface RenderMessage {
  type: 'a2ui-spectra-preview/render';
  render: number;
  surfaceId: string;
  messages: unknown[];
}

/** What went wrong in the page, of three kinds. */
export type Report = ComponentReport | SurfaceReport | RefusedReport;

/**
 * A component that threw while drawing. A failure the page caught without
 * knowing the component, such as one only the window's error events saw,
 * carries no id.
 */
export interface ComponentReport {
  kind: 'component';
  componentId?: string;
  componentType?: string;
  /** The page's own error text, such as `RangeError: Invalid time value`. */
  error: string;
}

/** An error web core reported on the surface through its error channel. */
export interface SurfaceReport {
  kind: 'surface';
  code: string;
  error: string;
  /** When web core names the component. */
  componentId?: string;
}

/** A message the page's processor refused. */
export interface RefusedReport {
  kind: 'refused';
  /** The message's index in the render's list. */
  index: number;
  code: string;
  error: string;
}

/** A report, tagged with the render it belongs to. */
export interface ReportMessage {
  type: 'a2ui-spectra-preview/report';
  render: number;
  report: Report;
}

/** An action as web core's processor dispatches it. */
export interface PreviewAction {
  name: string;
  surfaceId: string;
  sourceComponentId: string;
  timestamp: string;
  context: Record<string, unknown>;
  catalogId?: string;
  /** v1.0's, when the component has one. */
  userMessage?: string;
  [key: string]: unknown;
}

/**
 * The shown surface's data model, as the agent's messages and the user's
 * typing left it: sent whenever it changes, and once more for each render
 * that leaves it as it was, tagged with the render it belongs to.
 */
export interface DataModelMessage {
  type: 'a2ui-spectra-preview/data-model';
  render: number;
  surfaceId: string;
  dataModel: unknown;
}

/** A control was pressed: the action, and the surface's data model at that moment. */
export interface ActionMessage {
  type: 'a2ui-spectra-preview/action';
  render: number;
  action: PreviewAction;
  dataModel: unknown;
}

/**
 * The screenshot's message type, reserved: no adapter produces it yet, and
 * no viewer asks for it. It arrives with the first adapter that cannot be
 * embedded.
 */
export const SCREENSHOT_TYPE = 'a2ui-spectra-preview/screenshot';

export type ViewerMessage = RenderMessage;

export type PageMessage = ReadyMessage | ReportMessage | DataModelMessage | ActionMessage;

const PAGE_TYPES: ReadonlySet<string> = new Set([
  'a2ui-spectra-preview/ready',
  'a2ui-spectra-preview/report',
  'a2ui-spectra-preview/data-model',
  'a2ui-spectra-preview/action',
]);

/** Whether a value is a message a page sends, by its type. */
export function isPageMessage(value: unknown): value is PageMessage {
  const type = (value as {type?: unknown} | null)?.type;
  return typeof type === 'string' && PAGE_TYPES.has(type);
}

/** Whether a value is a render, with the fields a page reads from it. */
export function isRenderMessage(value: unknown): value is RenderMessage {
  if (typeof value !== 'object' || value === null) return false;
  const {type, render, surfaceId, messages} = value as Partial<RenderMessage>;
  return (
    type === 'a2ui-spectra-preview/render' &&
    typeof render === 'number' &&
    typeof surfaceId === 'string' &&
    Array.isArray(messages)
  );
}
