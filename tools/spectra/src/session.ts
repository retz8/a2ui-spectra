import {constants} from 'node:os';

import {cardDetailsOf, checkTransport, rewriteCard} from './a2a/card.js';
import {startWireProxy, type WireProxy} from './a2a/proxy.js';
import {agentCardUrl, waitForAgentCard} from './agent_card.js';
import {
  type AgentExit,
  type AgentProcess,
  describeExit,
  exitCodeOf,
  startAgentProcess,
} from './agent_process.js';
import type {SessionOptions} from './args.js';
import {openBrowser} from './browser.js';
import {CatalogRegistry} from './catalog/registry.js';
import {ConfigError, type SpectraConfig, substituteVariables} from './config.js';
import {MessageBox, unsetVariablesClause} from './message_box.js';
import type {Output} from './output.js';
import {CallPlacer} from './placement.js';
import {TurnRecorder} from './recorder.js';
import {PortTakenError, startViewerServer, type ViewerServer} from './server.js';
import {TurnStore} from './store/store.js';
import {TurnHub} from './turn_hub.js';

/** The agent's command, under `run`. */
export interface AgentCommand {
  command: string;
  args: string[];
}

/** The session's settings: the command line's options with the agent's URL settled, and the config. */
export interface SessionSettings extends Omit<SessionOptions, 'agentUrl' | 'config'> {
  agentUrl: URL;
  config: SpectraConfig;
}

const STOP_SIGNALS: NodeJS.Signals[] =
  process.platform === 'win32' ? ['SIGINT', 'SIGTERM'] : ['SIGINT', 'SIGTERM', 'SIGHUP'];

/**
 * Runs `attach`, or `run` when given the agent's command: opens the store,
 * waits for the agent's card, checks the card offers A2A over JSON-RPC,
 * starts the wire proxy, the message box and the server, prints their
 * addresses and opens the browser, then runs until a stop signal, or until
 * the agent's process exits. Each turn the proxy captures is checked and
 * written to the store, then closed on the live stream, and Spectra waits
 * for the turns still open when it stops. Resolves with Spectra's exit code.
 */
export async function runSession(
  options: SessionSettings,
  agentCommand: AgentCommand | undefined,
  out: Output,
  viewerDir: string,
): Promise<number> {
  let store: TurnStore;
  try {
    store = await TurnStore.open(process.cwd());
  } catch (error) {
    out.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  let catalogs: CatalogRegistry;
  try {
    catalogs = await CatalogRegistry.load(options.config.catalogs);
  } catch (error) {
    if (error instanceof ConfigError) {
      out.error(error.message);
      return 1;
    }
    throw error;
  }
  if (options.config.file !== undefined) {
    out.info(`Settings read from ${options.config.file}`);
  }
  const configured = catalogs.known.filter(catalog => catalog.source === 'configured');
  if (configured.length > 0) {
    out.info(`Catalogs configured: ${configured.map(catalog => catalog.id).join(', ')}`);
  }
  const {headers, unset} = substituteVariables(options.config.headers, process.env);
  if (unset.length > 0) {
    const left = Object.keys(options.config.headers).filter(name => !(name in headers));
    out.error(
      `${unsetVariablesClause(unset)}, so the ${left.join(', ')} header${left.length === 1 ? ' is' : 's are'} not sent ` +
        'and the message box cannot send.',
    );
  }
  const turns = new TurnHub();
  const recorder = new TurnRecorder(store, out, {onRecorded: turns.onRecorded, catalogs});
  const placer = new CallPlacer({
    onTurn: recorder.onTurn,
    log: line => out.info(line),
    ...(agentCommand !== undefined && {alwaysCapturePaths: ['model_proxy']}),
  });

  const stop = new AbortController();
  let stoppedBy: NodeJS.Signals | undefined;
  let agent: AgentProcess | undefined;
  let agentExit: AgentExit | undefined;
  let proxy: WireProxy | undefined;
  let box: MessageBox | undefined;
  let server: ViewerServer | undefined;
  let failed = false;

  const onSignal = (signal: NodeJS.Signals) => {
    if (!stop.signal.aborted) {
      stoppedBy = signal;
      out.info(
        agent === undefined || agentExit !== undefined
          ? 'Stopping.'
          : "Stopping the agent's process. Press Ctrl-C again to force it.",
      );
      stop.abort();
    } else if (agent !== undefined && agentExit === undefined) {
      out.info("Forcing the agent's process to stop.");
      agent.kill();
    }
  };
  for (const signal of STOP_SIGNALS) {
    process.on(signal, onSignal);
  }

  try {
    if (agentCommand !== undefined) {
      agent = startAgentProcess(agentCommand.command, agentCommand.args);
      void agent.exited.then(exit => {
        agentExit = exit;
        if (!stop.signal.aborted) {
          const when =
            server === undefined && exit.error === undefined ? ' before its card answered' : '';
          out.info(`The agent's process ${describeExit(exit)}${when}.`);
          stop.abort();
        }
      });
    }

    const cardUrl = agentCardUrl(options.agentUrl);
    const card = await waitForAgentCard(cardUrl, {
      signal: stop.signal,
      headers,
      onWaiting: reason =>
        out.info(
          `Waiting for the agent's card at ${cardUrl.href}: ${reason}. ` +
            (agentCommand === undefined
              ? "The agent's URL is attach's <agent-url> argument, or agent.url in the config file."
              : "Change the agent's URL with --agent-url, or agent.url in the config file.") +
            (unset.length > 0 ? ` ${unsetVariablesClause(unset)}.` : ''),
        ),
    });

    if (card !== undefined && !stop.signal.aborted) {
      const transport = checkTransport(card);
      if (transport.kind === 'no_interface') {
        out.error(
          "The agent's card lists no interface to reach it at. A2A 1.0 requires the card's " +
            'supportedInterfaces, and A2A 0.3 its url, so hosts that follow the card cannot reach ' +
            'the agent either.',
        );
        stop.abort();
        return 1;
      }
      if (transport.kind === 'no_jsonrpc') {
        out.error(
          `The agent's card lists no A2A JSON-RPC interface, only ${transport.transports.join(', ')}. ` +
            'Spectra captures A2A over JSON-RPC only.',
        );
        stop.abort();
        return 1;
      }
      if (transport.kind === 'jsonrpc_later') {
        out.info(
          `The agent's card prefers ${transport.preferred} to JSON-RPC. ` +
            "Hosts that follow the card's preference bypass the wire proxy, and their turns are not captured.",
        );
      }
      proxy = await startWireProxy({
        port: options.proxyPort,
        agentUrl: options.agentUrl,
        agentName: typeof card.name === 'string' ? card.name : undefined,
        onTurn: notification => {
          placer.onTurn(notification);
          turns.onTurn(notification);
        },
        traceIdTaken: async traceId =>
          turns.isOpen(traceId) || (await store.list()).some(turn => turn.traceId === traceId),
        warn: line => out.info(line),
      });
      box = new MessageBox({
        card: rewriteCard(card, proxy.origin),
        turns,
        headers,
        unsetVariables: unset,
        offer: catalogs.offer(),
      });
      if (box.unavailable !== undefined) {
        out.info(box.unavailable);
      }
      server = await startViewerServer({
        port: options.port,
        viewerDir,
        allowedHosts: options.allowedHosts,
        api: {
          store,
          turns,
          box,
          catalogs,
          context: {
            ...(typeof card.name === 'string' && {agentName: card.name}),
            agentUrl: options.agentUrl.href,
            mode: agentCommand === undefined ? 'attach' : 'run',
            proxyAddress: proxy.address,
            previewPages: options.config.preview,
            ...cardDetailsOf(card),
          },
        },
      });
      out.info(`The viewer is at ${server.url}`);
      out.info(`Point a host at the wire proxy: ${proxy.address}`);
      out.info(`Turns are saved in ${store.turnsDir}`);
      if (options.open) {
        openBrowser(server.url);
      }
      await aborted(stop.signal);
    }
  } catch (error) {
    failed = true;
    if (error instanceof PortTakenError) {
      const option = error.port === options.port ? '--port' : '--proxy-port';
      out.error(`Port ${error.port} is taken. Choose another port with ${option}.`);
    } else {
      out.error(`Spectra failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  } finally {
    await server?.close();
    box?.close();
    await proxy?.close();
    await recorder.idle();
    if (agent !== undefined) {
      await agent.stop();
      agentExit = await agent.exited;
    }
    for (const signal of STOP_SIGNALS) {
      process.off(signal, onSignal);
    }
  }

  if (failed) {
    return 1;
  }
  if (agentExit !== undefined) {
    return exitCodeOf(agentExit);
  }
  return stoppedBy === undefined ? 0 : 128 + (constants.signals[stoppedBy] ?? 0);
}

function aborted(signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) {
      resolve();
    } else {
      signal.addEventListener('abort', () => resolve(), {once: true});
    }
  });
}
