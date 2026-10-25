import type {SessionContext} from '@/api.ts';

import {CopyButton} from './CopyButton.tsx';
import {Icon} from './icons.tsx';

/**
 * The context bar: the attached agent's name, the mode, the live status and
 * the wire proxy's address with a copy button.
 */
export function ContextBar({
  context,
  connected,
}: {
  context: SessionContext | undefined;
  connected: boolean | undefined;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2.5 pr-4 pl-1">
      <span className="px-2 text-sm font-semibold">{context?.agentName ?? 'The agent'}</span>
      {context !== undefined && (
        <span className="inline-flex h-5 items-center rounded-md bg-tint px-[7px] text-xs text-muted-foreground">
          {context.mode}
        </span>
      )}
      <span className="h-4 w-px bg-border" />
      <LiveStatus connected={connected} />
      <div className="flex-1" />
      {context !== undefined && (
        <>
          <span className="text-xs text-muted-foreground">Proxy</span>
          <CopyButton
            text={context.proxyAddress}
            label="Copy the wire proxy's address"
            className="h-7 gap-1.5 rounded-lg border bg-panel pr-2 pl-2.5 text-xs text-foreground hover:bg-panel"
          >
            {addressOf(context.proxyAddress)}
          </CopyButton>
        </>
      )}
    </header>
  );
}

/** Whether the page hears Spectra's live stream. */
export function LiveStatus({connected}: {connected: boolean | undefined}) {
  if (connected === false) {
    return (
      <span
        role="status"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-problem"
      >
        <Icon kind="dot" size={10} />
        Not connected to Spectra · reconnecting
      </span>
    );
  }
  return (
    <span role="status" className="inline-flex items-center gap-1.5 text-xs font-medium">
      <Icon kind="dot" size={10} className={connected ? 'text-brand' : 'text-muted-foreground'} />
      {connected ? 'Capturing' : 'Connecting'}
    </span>
  );
}

/** An address without its scheme or a bare trailing slash, as the bar shows it. */
function addressOf(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}
