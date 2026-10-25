import type {SessionContext} from '@/api.ts';
import {cn} from '@/lib/utils';

import {addressOf} from './ContextBar.tsx';
import {CopyButton} from './CopyButton.tsx';
import {Icon, Mark} from './icons.tsx';

/**
 * The turn view with no turns: the agent and its live status, the first
 * example of each of its card's skills as prompts that fill the composer, and
 * the wire proxy's address to point a host app at.
 */
export function FirstScreen({
  context,
  connected,
  canSend,
  onExample,
}: {
  context: SessionContext | undefined;
  connected: boolean | undefined;
  /** Whether the message box can send to the agent; its examples are offered only then. */
  canSend: boolean;
  onExample: (text: string) => void;
}) {
  const examples = canSend ? (context?.examples ?? []) : [];
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3.5 overflow-y-auto p-8 text-center">
      <Mark size={40} />
      <div className="flex flex-col items-center gap-1">
        <h1 className="text-lg leading-[1.3] font-semibold">{context?.agentName ?? 'The agent'}</h1>
        <Status connected={connected} />
      </div>
      <p className="max-w-[420px] text-muted-foreground">
        Send a message to start your first turn.
      </p>
      {examples.length > 0 && (
        <div className="mt-1.5 flex flex-col items-center gap-2">
          <span className="section-label">From the agent's card</span>
          {examples.map((example, index) => (
            <button
              key={index}
              type="button"
              onClick={() => onExample(example)}
              className="ease-quick inline-flex h-[34px] max-w-[560px] cursor-pointer items-center gap-2 rounded-full border bg-panel px-3.5 hover:bg-tint"
            >
              <Icon kind="text" size={14} className="text-muted-foreground" />
              <span className="truncate">{example}</span>
            </button>
          ))}
        </div>
      )}
      {context !== undefined && (
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          or point your host app at
          <CopyButton
            text={context.proxyAddress}
            label="Copy the wire proxy's address"
            className="h-[26px] gap-1.5 rounded-lg border bg-panel pr-2 pl-2.5 text-xs text-foreground hover:bg-panel"
          >
            {addressOf(context.proxyAddress)}
          </CopyButton>
        </div>
      )}
    </div>
  );
}

/** Whether the page hears Spectra's live stream, under the agent's name. */
function Status({connected}: {connected: boolean | undefined}) {
  if (connected === false) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-problem">
        <Icon kind="dot" size={8} />
        Not connected to Spectra · reconnecting
      </span>
    );
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs font-semibold',
        connected ? 'text-brand' : 'text-muted-foreground',
      )}
    >
      <Icon kind="dot" size={8} />
      {connected ? 'Capturing' : 'Connecting'}
    </span>
  );
}
