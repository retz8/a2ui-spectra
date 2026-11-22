import type {SessionContext} from '@/api.ts';
import {type FirstScreenBox, type FirstScreenForm, firstScreenFormOf} from '@/model/dev_loop.ts';
import {logTimeOf, tailSinceStartOf} from '@/model/logs.ts';
import {pasteBlocksOf} from '@/model/paste.ts';
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
 * variables to set in the agent's shell, with one copy button for all, and on
 * Windows a PowerShell block and a cmd block, each with its own.
 *
 * While the agent is running and the message box cannot send, the ready form
 * says what can still start a turn instead: a host app pointed at the wire
 * proxy, the sentence carrying the address; or nothing, until the agent's card
 * lists an A2A JSON-RPC interface, the wire proxy's address left out.
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
  box,
  onExample,
  logsOpen,
  onLogs,
}: {
  context: SessionContext | undefined;
  connected: boolean | undefined;
  /** What the ready form says of the message box; the card's examples are offered only while it can send. */
  box: FirstScreenBox;
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
  const said: FirstScreenBox | undefined = form === 'ready' ? box : undefined;
  const examples = said === 'canSend' ? (context?.examples ?? []) : [];
  const variables = context?.mode === 'attach' ? (context.variables ?? []) : [];
  const blocks = pasteBlocksOf(variables, context?.shells);
  const tail = form === 'down' ? tailSinceStartOf(state.logs?.entries ?? []) : [];
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center-safe gap-3.5 overflow-y-auto p-8 text-center">
      <Mark size={40} />
      <div className="flex flex-col items-center gap-1">
        <h1 className="type-view-title max-w-160 wrap-anywhere">{name.text}</h1>
        {form === 'ready' ? (
          <Status connected={connected} />
        ) : (
          <span className="flex max-w-160 justify-center">
            <LiveStatus connected={connected} />
          </span>
        )}
      </div>
      {said === 'canSend' && (
        <p className="type-quiet max-w-105">Send a message to start your first turn.</p>
      )}
      {said === 'hostOnly' && context !== undefined && (
        <div className="type-quiet flex flex-wrap items-center justify-center gap-1.5">
          To start your first turn, point your host app at
          <span>
            <code className="type-code-inline text-xs">{addressOf(context.proxyAddress)}</code>.
          </span>
          <CopyButton
            text={context.proxyAddress}
            label="Copy the wire proxy's address"
            className="-ml-1"
          />
        </div>
      )}
      {said === 'noTurn' && (
        <p className="type-quiet max-w-140">
          <span className="block">
            No turn can start until the agent’s card lists an A2A JSON-RPC interface.
          </span>
          <span className="block">The card is read again when the agent restarts.</span>
        </p>
      )}
      {form === 'notReady' && (
        <p className="type-quiet max-w-105">The message box opens when the agent’s card answers.</p>
      )}
      {form === 'down' && (
        <div className="mt-1.5 flex w-170 max-w-full flex-col gap-2.5 text-left">
          {tail.length > 0 && (
            <div
              aria-label="The agent’s last lines"
              className="type-code overflow-x-auto rounded-lg bg-tint px-3 py-2.5 leading-relaxed"
            >
              {tail.map(line => (
                <div key={line.key} className="flex gap-3 whitespace-pre">
                  <span className="type-code-muted shrink-0">{logTimeOf(line.time)}</span>
                  <span className="type-code-muted w-[3ch] shrink-0">{line.stream}</span>
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
              className="type-link cursor-pointer text-xs"
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
              accent
            />
          </div>
        </div>
      )}
      {examples.length > 0 && (
        <div className="mt-1.5 flex flex-col items-center gap-2">
          <span className="type-section-label">From the agent's card</span>
          {examples.map((example, index) => (
            <button
              key={index}
              type="button"
              onClick={() => onExample(example)}
              className="ease-quick type-name inline-flex h-9 max-w-140 cursor-pointer items-center gap-2 rounded-full border bg-panel px-3.5 hover:bg-tint"
            >
              <Icon kind="text" size={14} className="shrink-0 tone-muted" />
              <span className="truncate">{example}</span>
            </button>
          ))}
        </div>
      )}
      {context !== undefined && (said === 'canSend' || form === 'notReady') && (
        <div className="type-meta mt-3 flex items-center gap-1.5">
          or point your host app at
          <code className="type-code-inline">{addressOf(context.proxyAddress)}</code>
          <CopyButton
            text={context.proxyAddress}
            label="Copy the wire proxy's address"
            className="-ml-0.5"
          />
        </div>
      )}
      {variables.length > 0 && (
        <div className="mt-2.5 flex w-150 max-w-full flex-col gap-2 text-left">
          {blocks.length > 1 && (
            <span className="type-meta">
              To see model and tool calls, set these in the agent’s shell
            </span>
          )}
          {blocks.map(block => (
            <div key={block.caption} className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="type-meta flex-1">{block.caption}</span>
                <CopyButton text={block.copied} label={block.copyLabel}>
                  Copy
                </CopyButton>
              </div>
              <div className="type-code overflow-x-auto rounded-lg bg-tint px-3 py-2.5 leading-relaxed">
                {block.lines.map(line => (
                  <div key={line} className="whitespace-pre">
                    {line}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Whether the page hears Spectra's live stream, under the agent's name. */
function Status({connected}: {connected: boolean | undefined}) {
  if (connected === false) {
    return (
      <span className="type-mark-problem inline-flex items-center gap-1.5">
        <Icon kind="dot" size={8} />
        Not connected to Spectra · reconnecting
      </span>
    );
  }
  return (
    <span className="type-mark inline-flex items-center gap-1.5">
      <Icon kind="dot" size={8} className={connected ? 'tone-brand' : 'tone-muted'} />
      {connected ? 'Capturing' : 'Connecting'}
    </span>
  );
}
