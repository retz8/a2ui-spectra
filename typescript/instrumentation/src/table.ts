/** The hooked names, all public on `@a2ui/agent`, in one table. */

/** An inference format, as the record names it. */
export type InferenceFormat = 'direct_json' | 'express';

/** What a hooked name does, and so the hook it gets. */
export type Role =
  | 'parse_response'
  | 'open_stream'
  | 'feed'
  | 'close'
  | 'compile'
  | 'generate'
  | 'check_topology'
  | 'mark_checked';

export interface Hook {
  /** The exported class whose prototype holds the method. */
  readonly className: string;
  readonly method: string;
  readonly role: Role;
}

export const HOOKS: readonly Hook[] = [
  {className: 'Parser', method: 'parseResponse', role: 'parse_response'},
  {className: 'DirectJsonParser', method: 'openStream', role: 'open_stream'},
  {className: 'ExpressParser', method: 'openStream', role: 'open_stream'},
  {className: 'DirectJsonResponseStream', method: 'feed', role: 'feed'},
  {className: 'DirectJsonResponseStream', method: 'close', role: 'close'},
  {className: 'ExpressResponseStream', method: 'feed', role: 'feed'},
  {className: 'ExpressResponseStream', method: 'close', role: 'close'},
  {className: 'DirectJsonParser', method: 'compile', role: 'compile'},
  {className: 'ExpressParser', method: 'compile', role: 'compile'},
  {className: 'DirectJsonPromptGenerator', method: 'generate', role: 'generate'},
  {className: 'ExpressPromptGenerator', method: 'generate', role: 'generate'},
  {className: 'RendererState', method: 'checkTopology', role: 'check_topology'},
  {className: 'RendererState', method: 'markChecked', role: 'mark_checked'},
];

/** The classes a parser's or a prompt generator's format is read from. */
export const FORMAT_CLASSES: Readonly<
  Record<InferenceFormat, {parser: string; generator: string}>
> = {
  direct_json: {parser: 'DirectJsonParser', generator: 'DirectJsonPromptGenerator'},
  express: {parser: 'ExpressParser', generator: 'ExpressPromptGenerator'},
};
