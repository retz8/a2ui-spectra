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
 * has answered, the agent's command stands for its name.
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
        <span className="type-name min-w-0 truncate px-2">{name.text}</span>
      ) : (
        <AgentPopover context={context} name={name} />
      )}
      {context !== undefined && (
        <span className="type-meta inline-flex h-6 shrink-0 items-center rounded-full bg-tint px-2.5">
          {context.mode}
        </span>
      )}
      <span aria-hidden="true" className="w-1.5 shrink-0" />
      <LiveStatus
        connected={connected}
        onAddress={onAddress}
        {...(agent !== undefined && {logs: {open: logsOpen, onOpen: () => onLogs(true)}})}
      />
      <div className="flex-1" />
      {context !== undefined && (
        <>
          <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap">
            <span className="type-meta">Proxy</span>
            <span className="type-value">{addressOf(context.proxyAddress)}</span>
            <CopyButton
              text={context.proxyAddress}
              label="Copy the wire proxy's address"
              className="-ml-0.5"
            />
          </span>
        </>
      )}
      {context?.mode === 'run' && agent !== undefined && (
        <>
          <span aria-hidden="true" className="w-1.5 shrink-0" />
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
              'ease-quick type-control inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 whitespace-nowrap',
              logsOpen ? 'bg-tint' : 'bg-panel hover:bg-tint',
            )}
          >
            <Icon kind="logs" size={14} className={logsOpen ? 'tone-foreground' : 'tone-muted'} />
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
          className="ease-quick type-name inline-flex h-8 max-w-90 min-w-0 shrink cursor-pointer items-center gap-1.5 rounded-lg px-2 whitespace-nowrap hover:bg-tint data-[state=open]:bg-tint"
        >
          <span className="min-w-0 truncate">{name.text}</span>
          <Icon kind="chevronDown" size={14} className="tone-muted" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          aria-label="The agent"
          className="fade-in-quick z-50 flex w-110 flex-col gap-2.5 rounded-xl bg-panel px-3.5 py-3 shadow-float"
        >
          <span className="type-pane-title leading-tight wrap-anywhere">{name.text}</span>
          <div className="grid grid-cols-facts gap-x-3 gap-y-0.5">
            {rows.map(({label, value, failedRead}, index) => (
              <Fragment key={index}>
                <span className="type-meta leading-5">{label}</span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="type-value leading-5 wrap-anywhere">{value}</span>
                  {failedRead !== undefined && (
                    <span className="mt-1 flex items-start gap-2.5 rounded-lg bg-problem-soft px-3 py-2.5">
                      <Icon kind="failed" size={14} className="mt-0.5 shrink-0 tone-problem" />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="type-body wrap-anywhere">{failedRead.line}</span>
                        <span className="type-meta wrap-anywhere">
                          <code className="type-code-inline">{failedRead.error}</code>
                        </span>
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
      <span role="status" className="type-mark-problem inline-flex items-center gap-1.5">
        <Icon kind="dot" size={8} />
        Not connected to Spectra · reconnecting
      </span>
    );
  }
  if (status.form === 'agentSpinning') {
    return (
      <span
        role="status"
        title={status.title}
        className="type-mark inline-flex min-w-0 items-center gap-1.5"
      >
        <Icon kind="open" size={14} className="shrink-0 tone-brand" />
        <span className="min-w-0 truncate">
          <LeadAndRest text={status.text} />
        </span>
      </span>
    );
  }
  if (status.form === 'agentDown') {
    return (
      <span role="status" className="type-mark inline-flex min-w-0 items-center whitespace-nowrap">
        <Icon kind="dot" size={8} className="mr-1.5 shrink-0 tone-problem" />
        <span title={status.title} className="min-w-0 truncate">
          Agent down
          <span className="type-meta">
            {' '}
            · {status.exit}
            {logs !== undefined && ' ·'}
          </span>
        </span>
        {logs !== undefined && (
          <button
            type="button"
            aria-controls={LOGS_DRAWER_ID}
            aria-expanded={logs.open}
            onClick={logs.onOpen}
            className="type-link ml-1 shrink-0 cursor-pointer"
          >
            Logs
          </button>
        )}
      </span>
    );
  }
  if (status.form === 'replaying') {
    const to = sourceAddressOf(status.source, status.recordedTurn);
    return (
      <span
        role="status"
        className="type-mark inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap"
      >
        <Icon kind="open" size={14} className="shrink-0 tone-brand" />
        <span className="shrink-0">Replaying</span>
        <span className="type-meta min-w-0 truncate">
          {to === undefined || onAddress === undefined ? (
            sourceName(status.source)
          ) : (
            <button
              type="button"
              onClick={() => onAddress(to)}
              className="type-link cursor-pointer"
            >
              {sourceName(status.source)}
            </button>
          )}
          {status.turn !== undefined && ` · ${status.turn}`}
        </span>
      </span>
    );
  }
  const capturing = status.form === 'capturing';
  return (
    <span role="status" className="type-mark inline-flex items-center gap-1.5">
      <Icon kind="dot" size={8} className={capturing ? 'tone-brand' : 'tone-muted'} />
      {capturing ? 'Capturing' : 'Connecting'}
    </span>
  );
}

/** A status's lead, and after its first " · " the rest in Meta. */
export function LeadAndRest({text}: {text: string}) {
  const at = text.indexOf(' · ');
  if (at === -1) return text;
  return (
    <>
      {text.slice(0, at)}
      <span className="type-meta">{text.slice(at)}</span>
    </>
  );
}

/** An address without its scheme or a bare trailing slash, as the bar shows it. */
export function addressOf(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}
