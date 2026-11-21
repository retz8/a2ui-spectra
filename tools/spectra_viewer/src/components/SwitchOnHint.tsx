/**
 * The hint on a model call of a turn with no A2UI step events: switch the
 * wrapper on to see which text became which component, with how to in
 * both languages, each line as the wrappers' READMEs give it, and each
 * README linked at this Spectra's version. Under `attach`, each launch
 * line's caption says the variables on the first screen go in the agent's
 * shell, and the launch is the agent's own.
 */
import {useState} from 'react';

import {launchFor, readmeLink, SWITCH_ON_LINES} from '@/model/switch_on.ts';
import {useSpectra} from '@/state/spectra.ts';

import {CopyButton} from './CopyButton.tsx';
import {Icon} from './icons.tsx';
import {BlockLabel} from './JsonBlock.tsx';

export function SwitchOnHint({mode}: {mode: 'run' | 'attach' | undefined}) {
  const [open, setOpen] = useState(false);
  const version = useSpectra().context?.version;
  const attach = mode === 'attach';
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-muted-foreground">
        No A2UI step recorded · switch the wrapper on to see which text became which component
      </p>
      <BlockLabel label="How to switch it on" fold={{open, onToggle: () => setOpen(!open)}} />
      {open && (
        <div className="grid gap-4 pl-0.5 md:grid-cols-2">
          {SWITCH_ON_LINES.map(lines => {
            const readme = readmeLink(lines.readme, version);
            const launch = launchFor(lines, attach);
            return (
              <div key={lines.language} className="flex min-w-0 flex-col gap-2">
                <span className="text-xs font-semibold">{lines.language}</span>
                <Code label="Install" code={lines.install} />
                <Code label={launch.label} code={launch.code} />
                <Code label={lines.line.label} code={lines.line.code} />
                <a
                  href={readme.href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`The ${lines.language} wrapper's README, at ${readme.ref}, on GitHub`}
                  className="inline-flex min-h-6 items-center gap-1 self-start text-xs font-medium text-brand hover:underline"
                >
                  {readme.text}
                  <Icon kind="external" size={12} />
                </a>
              </div>
            );
          })}
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
