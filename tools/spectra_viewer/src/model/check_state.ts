/**
 * What the turn's header says of its checks: the problem count when there
 * are problems; otherwise that there are none, or that the turn was not
 * checked and why. Each check that ran is listed with its protocol version
 * and its result.
 */
import {agentMessages} from './messages.ts';
import {isCheck, type Turn} from './record.ts';
import {plural} from './steps.ts';
import {schemaCheckOf} from './summary.ts';

export type CheckState =
  {state: 'problems'; count: number} | {state: 'clean'} | {state: 'unchecked'; reason: string};

/** One check, as the header's tooltip lists it. */
export interface CheckLine {
  name: string;
  version: string;
  result: string;
}

export function checkStateOf(turn: Turn, problems: number): CheckState {
  if (problems > 0) return {state: 'problems', count: problems};
  const schema = schemaCheckOf(turn);
  if (schema.state === 'no_a2ui') return {state: 'unchecked', reason: 'no A2UI in this turn'};
  if (schema.state === 'none') return {state: 'unchecked', reason: 'no schema check'};
  return {state: 'clean'};
}

export function checkLinesOf(turn: Turn): CheckLine[] {
  const checks = turn.events.filter(isCheck);
  if (checks.length === 0) {
    return [{name: 'Schema check', version: '', result: 'Not run: the turn names no A2UI version'}];
  }
  const noA2ui = agentMessages(turn.events).length === 0;
  return checks.map(({attributes}) => {
    const findings = attributes['a2ui.check.findings'].length;
    return {
      name: `${capitalized(attributes['a2ui.check.name'])} check`,
      version: `A2UI ${attributes['a2ui.check.protocol_version']}`,
      result: !attributes['a2ui.check.passed']
        ? plural(findings, 'finding')
        : noA2ui
          ? 'Passed, with no A2UI from the agent'
          : 'Passed',
    };
  });
}

function capitalized(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
