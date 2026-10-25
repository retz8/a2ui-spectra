import {Popover} from 'radix-ui';
import {Fragment} from 'react';

import type {SessionContext} from '@/api.ts';
import {catalogName, shownUrl, transportLine} from '@/model/agent_card.ts';

import {CopyButton} from './CopyButton.tsx';
import {Icon} from './icons.tsx';

/**
 * The context bar: the attached agent's name, which opens the agent's
 * popover, the mode, the live status and the wire proxy's address with a
 * copy button.
 */
export function ContextBar({
  context,
  connected,
}: {
  context: SessionContext | undefined;
  connected: boolean | undefined;
}) {
  const name = context?.agentName ?? 'The agent';
  return (
    <header className="flex h-12 shrink-0 items-center gap-2.5 pr-4 pl-1">
      {context === undefined ? (
        <span className="px-2 text-sm font-semibold">{name}</span>
      ) : (
        <AgentPopover context={context} name={name} />
      )}
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

/** The agent's name, opening what its card states: its address, the transport, the A2UI it advertises and the mode. */
function AgentPopover({context, name}: {context: SessionContext; name: string}) {
  const rows: Array<[label: string, value: string]> = [
    ['Address', shownUrl(context.agentUrl)],
    ['Transport', transportLine(context.a2aVersions)],
    ...(context.a2uiExtensions.length === 0
      ? [['A2UI', 'None advertised'] as [string, string]]
      : context.a2uiExtensions.flatMap(extension => [
          ['A2UI', extension.version] as [string, string],
          ...extension.catalogIds.map(id => ['Catalog', catalogName(id)] as [string, string]),
        ])),
    [
      'Mode',
      context.mode === 'run' ? 'Launched by Spectra (run)' : 'Attached to a running agent (attach)',
    ],
  ];
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="ease-quick inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-sm font-semibold hover:bg-tint data-[state=open]:bg-tint"
        >
          {name}
          <Icon kind="chevronDown" size={14} className="text-muted-foreground" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          aria-label="The agent"
          className="fade-in-quick z-50 flex w-[340px] flex-col gap-2.5 rounded-xl bg-panel px-4 py-3.5 text-foreground shadow-float"
        >
          <span className="text-base font-semibold">{name}</span>
          <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-y-1.5 text-xs">
            {rows.map(([label, value], index) => (
              <Fragment key={index}>
                <span className="text-muted-foreground">{label}</span>
                <span className="[overflow-wrap:anywhere]">{value}</span>
              </Fragment>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
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
export function addressOf(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}
