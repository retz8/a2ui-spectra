/**
 * The dev loop's rules as the viewer says them: why Re-run and the Replay
 * popover's rows are off, what a press of Restart will end, and which of the
 * first screen's forms shows. The server is the authority on a refusal; what
 * mirrors its rules here only says it first, and a reason the message box
 * cannot send for is the server's line wherever it is shown.
 */
import type {AgentProcessState} from '../api.ts';
import {plural} from './steps.ts';

/** How the message box's lines start, all but one of them. */
const CANT_SEND = "Can't send · ";

/** How the box words an unset header variable, the one reason of its own form in the composer. */
const UNSET_VARIABLE = "not set in Spectra's environment";

/**
 * The box's reason as a note: its line without "Can't send · ", capitalised.
 * The one line of the box's that does not start so is shown whole.
 */
export function boxNoteOf(reason: string): string {
  if (!reason.startsWith(CANT_SEND)) return reason;
  const rest = reason.slice(CANT_SEND.length);
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/**
 * The box's reason the composer's line carries: the server's line, unless it
 * is the unset header variable's, which keeps its own form.
 */
export function composerReasonOf(box: {
  unavailable?: string;
  unsetVariables?: readonly string[];
}): string | undefined {
  const {unavailable, unsetVariables} = box;
  if (unavailable === undefined) return undefined;
  if ((unsetVariables?.length ?? 0) > 0 && unavailable.endsWith(UNSET_VARIABLE)) return undefined;
  return unavailable;
}

/** What Re-run and the Replay popover's rows are judged by. */
export interface RefusalInput {
  /** Whether the page is connected to Spectra; `false` once the stream is known to be down. */
  connected: boolean;
  /** Whether the turn's record was not written to the store. */
  unwritten: boolean;
  /** The box's reason it cannot send, the server's line. */
  boxReason?: string;
  replaying: boolean;
  turnOpen: boolean;
}

/**
 * Why Re-run, or a row of the Replay popover, is off: the first that
 * applies, in the order the notes are settled in. Nothing when it is on.
 */
export function refusalNoteOf({
  connected,
  unwritten,
  boxReason,
  replaying,
  turnOpen,
}: RefusalInput): string | undefined {
  if (!connected) return 'Not connected to Spectra';
  if (unwritten) return 'Save it as a fixture first';
  if (boxReason !== undefined) return boxNoteOf(boxReason);
  if (replaying) return 'A replay is running';
  if (turnOpen) return 'A turn is open';
  return undefined;
}

/** Re-run's tooltip, its first line: what a press does, and what it costs. */
export const RERUN_TOOLTIP =
  'Sends the conversation again up to this turn · every model and tool call goes live';

/**
 * Restart's tooltip: what the press will end. The count of turns not sent is
 * the replay's total less the number of the turn it is on, so before its
 * first turn opens it is every turn.
 */
export function restartTooltipOf({
  connected,
  openTurns,
  replay,
}: {
  connected: boolean;
  /** How many turns are open. */
  openTurns: number;
  /** The replay running: the number of the turn it is on, of its total. */
  replay?: {turn: number; turns: number};
}): string {
  if (!connected) return 'Restart the agent · not connected to Spectra';
  if (replay !== undefined) {
    const notSent = replay.turns - replay.turn;
    return notSent > 0
      ? `Restart the agent · stops the replay, ${plural(notSent, 'turn')} not sent`
      : 'Restart the agent · stops the replay';
  }
  if (openTurns > 1) return `Restart the agent · ends the ${openTurns} open turns`;
  if (openTurns === 1) return 'Restart the agent · ends the open turn';
  return 'Restart the agent';
}

/**
 * Whether Restart can be pressed: while the page is connected, in every state
 * but restarting, the restart under way being the one asked for.
 */
export function restartEnabled(connected: boolean, state: AgentProcessState['state']): boolean {
  return connected && state !== 'restarting';
}

/** The first screen's forms under `run`, chosen by the agent's state alone. */
export type FirstScreenForm = 'ready' | 'notReady' | 'down';

export function firstScreenFormOf(state: AgentProcessState['state']): FirstScreenForm {
  if (state === 'running') return 'ready';
  return state === 'down' ? 'down' : 'notReady';
}

/**
 * What the live status says of an agent that is not running: its words, whether
 * it spins, and its tooltip, the terminal's line whole where the words are cut.
 */
export function agentStatusOf(
  state: AgentProcessState,
):
  | {form: 'spinning'; text: string; title: string}
  | {form: 'down'; exit: string; title: string}
  | undefined {
  switch (state.state) {
    case 'running':
      return undefined;
    case 'starting':
      return {form: 'spinning', text: 'Starting the agent', title: 'Starting the agent'};
    case 'waiting': {
      const text = `Waiting for the agent's card · ${state.reason}`;
      return {form: 'spinning', text, title: state.line ?? text};
    }
    case 'restarting':
      return {form: 'spinning', text: 'Restarting the agent', title: 'Restarting the agent'};
    case 'down':
      return {form: 'down', exit: state.exit, title: `The agent's process ${state.exit}.`};
  }
}
