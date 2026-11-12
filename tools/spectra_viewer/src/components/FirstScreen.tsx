import type {SessionContext} from '@/api.ts';
import {type FirstScreenForm, firstScreenFormOf} from '@/model/dev_loop.ts';
import {logTimeOf, tailSinceStartOf} from '@/model/logs.ts';
import {cn} from '@/lib/utils';
import {agentNameOf} from '@/state/selectors.ts';
import {spectra, useSpectra} from '@/state/spectra.ts';

import {addressOf, LiveStatus} from './ContextBar.tsx';
import {CopyButton} from './CopyButton.tsx';
import {Icon, Mark} from './icons.tsx';
import {LOGS_DRAWER_ID} from './LogsDrawer.tsx';
import {PressButton} from './Refusal.tsx';

/**
 * The turn view with no turns: the agent and its live status, the first
 * example of each of its card's skills as prompts that fill the composer, the
 * wire proxy's address to point a host app at, and under `attach` the
 * variables to set in the agent's shell, with one copy button for all.
 *
 * Under `run` it has three forms, chosen by the agent's state alone: ready,
 * while the agent is running; not ready, while it is starting, waiting for
 * its card or restarting, the live status reading as the context bar's does;
 * and down, with the last lines the agent wrote since its latest start, Open
 * Logs and Restart. Until a card has answered, the agent's command stands for
 * its name, in monospace.
 */
export function FirstScreen({
  context,
  connected,
  canSend,
  onExample,
  logsOpen,
  onLogs,
}: {
  context: SessionContext | undefined;
  connected: boolean | undefined;
  /** Whether the message box can send to the agent; its examples are offered only then. */
  canSend: boolean;
  onExample: (text: string) => void;
  /** Whether the logs drawer is open. */
  logsOpen: boolean;
  /** Opens the logs drawer. */
  onLogs: () => void;
}) {
  const state = useSpectra();
  const {agent} = state;
  const form: FirstScreenForm =
    agent === undefined ? 'ready' : firstScreenFormOf(agent.state.state);
  const name = agentNameOf(state);
  const examples = canSend && form === 'ready' ? (context?.examples ?? []) : [];
  const variables = context?.mode === 'attach' ? (context.variables ?? []) : [];
  const tail = form === 'down' ? tailSinceStartOf(state.logs?.entries ?? []) : [];
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3.5 overflow-y-auto p-8 text-center">
      <Mark size={40} />
      <div className="flex flex-col items-center gap-1">
        <h1
          className={cn(
            'max-w-full text-lg leading-tight font-semibold wrap-anywhere',
            name.isCommand && 'font-mono',
          )}
        >
          {name.text}
        </h1>
        {form === 'ready' ? (
          <Status connected={connected} />
        ) : (
          <span className="flex max-w-160 justify-center">
            <LiveStatus connected={connected} />
          </span>
        )}
      </div>
      {form === 'ready' && (
        <p className="max-w-105 text-muted-foreground">Send a message to start your first turn.</p>
      )}
      {form === 'notReady' && (
        <p className="max-w-105 text-muted-foreground">
          The message box opens when the agent’s card answers.
        </p>
      )}
      {form === 'down' && (
        <div className="mt-1.5 flex w-170 max-w-full flex-col gap-2.5 text-left">
          {tail.length > 0 && (
            <div
              aria-label="The agent’s last lines"
              className="overflow-x-auto rounded-lg bg-tint px-3 py-2 font-mono text-xs leading-relaxed"
            >
              {tail.map(line => (
                <div key={line.key} className="flex gap-3 whitespace-pre">
                  <span className="shrink-0 text-muted-foreground">{logTimeOf(line.time)}</span>
                  <span className="w-6 shrink-0 text-muted-foreground">{line.stream}</span>
                  <span>{line.text}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between gap-4">
            <button
              type="button"
              aria-controls={LOGS_DRAWER_ID}
              aria-expanded={logsOpen}
              onClick={onLogs}
              className="cursor-pointer text-xs font-semibold text-brand hover:underline"
            >
              Open Logs
            </button>
            <PressButton
              label="Restart"
              icon={<Icon kind="restart" size={14} />}
              tooltip={
                connected === false
                  ? 'Restart the agent · not connected to Spectra'
                  : 'Restart the agent'
              }
              off={connected === false}
              onPress={() => spectra.restart()}
              refusalLabel="Restart was refused"
              className={cn(
                'h-8 gap-1.5 border-0 pr-3.5 pl-3 font-semibold',
                connected === false
                  ? 'bg-border'
                  : 'bg-brand text-brand-on hover:bg-brand [&>span]:text-brand-on',
              )}
            />
          </div>
        </div>
      )}
      {examples.length > 0 && (
        <div className="mt-1.5 flex flex-col items-center gap-2">
          <span className="section-label">From the agent's card</span>
          {examples.map((example, index) => (
            <button
              key={index}
              type="button"
              onClick={() => onExample(example)}
              className="ease-quick inline-flex h-9 max-w-140 cursor-pointer items-center gap-2 rounded-full border bg-panel px-3.5 hover:bg-tint"
            >
              <Icon kind="text" size={14} className="text-muted-foreground" />
              <span className="truncate">{example}</span>
            </button>
          ))}
        </div>
      )}
      {context !== undefined && form !== 'down' && (
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          or point your host app at
          <CopyButton
            text={context.proxyAddress}
            label="Copy the wire proxy's address"
            className="h-7 gap-1.5 rounded-lg border bg-panel pr-2 pl-2.5 text-xs text-foreground hover:bg-panel"
          >
            {addressOf(context.proxyAddress)}
          </CopyButton>
        </div>
      )}
      {variables.length > 0 && (
        <div className="mt-2.5 flex w-150 max-w-full flex-col gap-2 text-left">
          <div className="flex items-center gap-2">
            <span className="flex-1 text-xs text-muted-foreground">
              To see model and tool calls, set these in the agent’s shell
            </span>
            <CopyButton
              text={variables
                .map(({name: variable, value}) => `export ${variable}=${value}`)
                .join('\n')}
              label="Copy the variables"
              className="h-7 gap-1.5 rounded-lg border bg-panel pr-2 pl-2.5 text-xs text-foreground hover:bg-panel"
            >
              Copy
            </CopyButton>
          </div>
          <div className="overflow-x-auto rounded-lg bg-tint px-3 py-2 font-mono text-xs leading-relaxed">
            {variables.map(({name: variable, value}) => (
              <div key={variable} className="whitespace-pre">
                {variable}={value}
              </div>
            ))}
          </div>
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
