/**
 * The hint on a model call of a turn with no A2UI step events: switch the
 * wrapper on to see which text became which component, with how to in
 * both languages, each line as the packages' READMEs give it. Under
 * `attach`, each launch line's caption says the variables on the first
 * screen go in the agent's shell, and the launch is the agent's own.
 */
import {useState} from 'react';

import {CopyButton} from './CopyButton.tsx';
import {BlockLabel} from './JsonBlock.tsx';

interface Lines {
  language: string;
  install: string;
  launch: {label: string; code: string};
  line: {label: string; code: string};
}

/** The lines of the two packages' READMEs, "Installing" and "Switching it on". */
const LINES: Lines[] = [
  {
    language: 'Python',
    install:
      'uv add --dev "a2ui-spectra-instrumentation @ git+https://github.com/retz8/a2ui-spectra#subdirectory=python/a2ui_spectra_instrumentation"',
    launch: {
      label: 'Launch under opentelemetry-instrument',
      code: 'a2ui-spectra run -- opentelemetry-instrument python agent.py',
    },
    line: {
      label: 'Or one line, before the agent parses or generates a prompt',
      code: 'import a2ui_spectra_instrumentation\n\na2ui_spectra_instrumentation.instrument()',
    },
  },
  {
    language: 'TypeScript',
    install:
      'npm install --save-dev /path/to/a2ui-spectra/typescript/instrumentation/a2ui-spectra-instrumentation.tgz',
    launch: {
      label: "Launch through Node's --import",
      code: 'a2ui-spectra run -- node --import a2ui-spectra-instrumentation/register agent.js',
    },
    line: {
      label: 'Or one line, before the agent parses or generates a prompt',
      code: "import {instrument} from 'a2ui-spectra-instrumentation';\n\ninstrument();",
    },
  },
];

export function SwitchOnHint({mode}: {mode: 'run' | 'attach' | undefined}) {
  const [open, setOpen] = useState(false);
  const attach = mode === 'attach';
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-muted-foreground">
        No A2UI step recorded · switch the wrapper on to see which text became which component
      </p>
      <BlockLabel label="How to switch it on" fold={{open, onToggle: () => setOpen(!open)}} />
      {open && (
        <div className="grid gap-4 pl-0.5 md:grid-cols-2">
          {LINES.map(lines => (
            <div key={lines.language} className="flex min-w-0 flex-col gap-2">
              <span className="text-xs font-semibold">{lines.language}</span>
              <Code label="Install" code={lines.install} />
              <Code
                label={
                  attach
                    ? `${lines.launch.label}, with the variables on the first screen set in the agent’s shell`
                    : lines.launch.label
                }
                code={
                  attach
                    ? lines.launch.code.replace(/^a2ui-spectra run -- /, '')
                    : lines.launch.code
                }
              />
              <Code label={lines.line.label} code={lines.line.code} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Code({label, code}: {label: string; code: string}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-h-6 items-center gap-2">
        <span className="min-w-0 flex-1 text-xs text-muted-foreground">{label}</span>
        <CopyButton iconFirst text={code} label={`Copy: ${label}`} className="h-6 px-1.5 text-xs">
          Copy
        </CopyButton>
      </div>
      <pre className="overflow-x-auto rounded-lg bg-tint px-2.5 py-1.5 font-mono text-xs leading-relaxed wrap-anywhere whitespace-pre-wrap">
        {code}
      </pre>
    </div>
  );
}
