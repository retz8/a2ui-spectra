import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {failureText} from './agent_tree.js';

describe("a command the launcher could not start, in Spectra's own line", () => {
  it('names the argument a batch file cannot safely take, the reason and the way out', () => {
    // Bun 1.4.4's refusal, as the first run on windows-latest read it.
    const refusal = {
      message:
        'The argument \'args[3]\' contains a cmd.exe special character and cannot be safely passed to a .bat/.cmd file. Received "a&b"',
      code: 'ERR_INVALID_ARG_VALUE',
    };
    assert.equal(
      failureText(refusal, ['run', 'agent', 'a&b']),
      'its argument "a&b" holds "&" that cmd.exe reads as its own, and the command is a batch file, ' +
        'which runs through cmd.exe. Spectra does not escape arguments for cmd.exe: start the program ' +
        'the batch file starts, or a script that passes the argument itself',
    );
  });

  it("says so of the command's name, and passes any other reason on as Bun gave it", () => {
    assert.match(
      failureText(
        {
          message:
            'The command name contains a cmd.exe special character and cannot be safely passed to a .bat/.cmd file. Received "a&b.cmd"',
        },
        [],
      ),
      /^the command's name holds a character that cmd\.exe reads as its own/,
    );
    assert.equal(
      failureText({message: 'Executable not found in $PATH: "nope"'}, []),
      'Executable not found in $PATH: "nope"',
    );
  });
});
