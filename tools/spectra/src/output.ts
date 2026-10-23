import {NAME} from './version.js';

/** Where Spectra writes: help and version as they are, status lines prefixed. */
export interface Output {
  /** Writes text as it is, such as help. */
  print(text: string): void;
  /** Writes one status line. */
  info(line: string): void;
  /** Writes one error line. */
  error(line: string): void;
}

export const consoleOutput: Output = {
  print: text => {
    process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
  },
  info: line => {
    process.stdout.write(`${NAME}: ${line}\n`);
  },
  error: line => {
    process.stderr.write(`${NAME}: ${line}\n`);
  },
};
