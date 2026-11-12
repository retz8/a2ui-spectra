import {Popover} from 'radix-ui';
import {Fragment} from 'react';

import type {SessionContext} from '@/api.ts';
import type {Address} from '@/model/address.ts';
import {agentRowsOf} from '@/model/agent_card.ts';
import {restartEnabled, restartTooltipOf} from '@/model/dev_loop.ts';
import {sourceAddressOf, sourceName} from '@/model/provenance.ts';
import {type AgentName, agentNameOf, liveStatusOf} from '@/state/selectors.ts';
import {spectra, useSpectra} from '@/state/spectra.ts';
import {cn} from '@/lib/utils';

import {CopyButton} from './CopyButton.tsx';
import {formatTime} from './format.ts';
import {Icon} from './icons.tsx';
import {LOGS_DRAWER_ID} from './LogsDrawer.tsx';
import {PressButton} from './Refusal.tsx';

/**
 * The context bar: the attached agent's name, which opens the agent's
 * popover, the mode, the live status and the wire proxy's address with a
 * copy button; under `run`, Restart and Logs after the address. Until a card
 * has answered, the agent's command stands for its name, in monospace.
 */
export function ContextBar({
  context,
  connected,
  onAddress,
  logsOpen,
  onLogs,
}: {
  context: SessionContext | undefined;
  connected: boolean | undefined;
  /** Follows a link to where a replay's source is. */
  onAddress: (address: Address) => void;
  /** Whether the logs drawer is open. */
  logsOpen: boolean;
  /** Opens or closes the logs drawer. */
  onLogs: (open: boolean) => void;
}) {
  const state = useSpectra();
  const name = agentNameOf(state);
  const {agent} = state;
  return (
    <header className="flex h-12 shrink-0 items-center gap-2.5 pr-4 pl-1">
      {context === undefined ? (
        <span className="min-w-0 truncate px-2 text-sm font-semibold">{name.text}</span>
      ) : (
        <AgentPopover context={context} name={name} />
      )}
      {context !== undefined && (
        <span className="inline-flex h-5 items-center rounded-md bg-tint px-2 text-xs text-muted-foreground">
          {context.mode}
        </span>
      )}
      <span className="h-4 w-px bg-border" />
      <LiveStatus
        connected={connected}
        onAddress={onAddress}
        {...(agent !== undefined && {logs: {open: logsOpen, onOpen: () => onLogs(true)}})}
      />
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
      {context?.mode === 'run' && agent !== undefined && (
        <>
          <span className="h-4 w-px bg-border" />
          <PressButton
            label="Restart"
            icon={<Icon kind="restart" size={14} />}
            tooltip={restartTooltipOf({
              connected: connected !== false,
              openTurns: state.turns.filter(turn => turn.open === true).length,
              ...(state.box.replay !== undefined && {replay: state.box.replay}),
            })}
            off={!restartEnabled(connected !== false, agent.state.state)}
            onPress={() => spectra.restart()}
            refusalLabel="Restart was refused"
          />
          <button
            type="button"
            aria-pressed={logsOpen}
            aria-controls={LOGS_DRAWER_ID}
            onClick={() => onLogs(!logsOpen)}
            className={cn(
              'ease-quick inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border pr-2.5 pl-2 text-xs font-medium whitespace-nowrap',
              logsOpen ? 'bg-tint' : 'bg-panel hover:bg-tint',
            )}
          >
            <Icon
              kind="logs"
              size={14}
              className={logsOpen ? 'text-foreground' : 'text-muted-foreground'}
            />
            Logs
          </button>
        </>
      )}
    </header>
  );
}

/**
 * The agent's name, opening what its card states: its address, the transport, the A2UI it
 * advertises and the mode; and under a catalog whose file did not read, that it did not, and
 * the reader's error.
 */
function AgentPopover({context, name}: {context: SessionContext; name: AgentName}) {
  const {catalogs} = useSpectra();
  const rows = agentRowsOf(context, catalogs ?? [], formatTime);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          // A long command is cut in the bar, whole in its tooltip and in the popover.
          title={name.isCommand ? name.text : undefined}
          className={cn(
            'ease-quick inline-flex h-8 max-w-96 min-w-0 shrink cursor-pointer items-center gap-1.5 rounded-lg px-2 text-sm font-semibold whitespace-nowrap hover:bg-tint data-[state=open]:bg-tint',
            name.isCommand && 'font-mono',
          )}
        >
          <span className="min-w-0 truncate">{name.text}</span>
          <Icon kind="chevronDown" size={14} className="text-muted-foreground" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          aria-label="The agent"
          className="fade-in-quick z-50 flex w-85 flex-col gap-2.5 rounded-xl bg-panel px-4 py-3.5 text-foreground shadow-float"
        >
          <span
            className={cn('text-base font-semibold wrap-anywhere', name.isCommand && 'font-mono')}
          >
            {name.text}
          </span>
          <div className="grid grid-cols-facts gap-y-1.5 text-xs">
            {rows.map(({label, value, failedRead}, index) => (
              <Fragment key={index}>
                <span className="text-muted-foreground">{label}</span>
                <span className="flex min-w-0 flex-col gap-1 wrap-anywhere">
                  <span>{value}</span>
                  {failedRead !== undefined && (
                    <span className="flex items-start gap-1.5 text-muted-foreground">
                      <Icon kind="failed" size={12} className="mt-0.5 shrink-0" />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span>{failedRead.line}</span>
                        <span className="font-mono">{failedRead.error}</span>
                      </span>
                    </span>
                  )}
                </span>
              </Fragment>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * Whether the page hears Spectra's live stream; under `run`, the agent's
 * process while it is not running, starting, waiting for its card,
 * restarting, or down with its exit line and a link that opens the logs;
 * and, while a replay runs, the record replayed and its turn, the source
 * named and linked as the replayed turn's line does.
 */
export function LiveStatus({
  connected,
  onAddress,
  logs,
}: {
  connected: boolean | undefined;
  onAddress?: (address: Address) => void;
  /** Under `run`: whether the logs drawer is open, and what opens it. */
  logs?: {open: boolean; onOpen: () => void};
}) {
  const status = liveStatusOf(useSpectra());
  if (connected === false || status.form === 'down') {
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
  if (status.form === 'agentSpinning') {
    return (
      <span
        role="status"
        title={status.title}
        className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium"
      >
        <Icon kind="open" size={14} className="text-brand" />
        <span className="min-w-0 truncate">{status.text}</span>
      </span>
    );
  }
  if (status.form === 'agentDown') {
    return (
      <span
        role="status"
        className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium whitespace-nowrap"
      >
        <Icon kind="dot" size={10} className="text-problem" />
        <span title={status.title} className="min-w-0 truncate">
          Agent down · {status.exit}
        </span>
        {logs !== undefined && (
          <>
            <span className="shrink-0 text-muted-foreground">·</span>
            <button
              type="button"
              aria-controls={LOGS_DRAWER_ID}
              aria-expanded={logs.open}
              onClick={logs.onOpen}
              className="shrink-0 cursor-pointer font-semibold text-brand hover:underline"
            >
              Logs
            </button>
          </>
        )}
      </span>
    );
  }
  if (status.form === 'replaying') {
    const to = sourceAddressOf(status.source, status.recordedTurn);
    return (
      <span
        role="status"
        className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium whitespace-nowrap"
      >
        <Icon kind="open" size={14} className="text-brand" />
        <span className="min-w-0 truncate">
          Replaying{' '}
          {to === undefined || onAddress === undefined ? (
            sourceName(status.source)
          ) : (
            <button
              type="button"
              onClick={() => onAddress(to)}
              className="cursor-pointer font-medium text-brand hover:underline"
            >
              {sourceName(status.source)}
            </button>
          )}
          {status.turn !== undefined && ` · ${status.turn}`}
        </span>
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
