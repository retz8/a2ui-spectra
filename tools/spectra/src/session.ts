import {stat} from 'node:fs/promises';
import {constants} from 'node:os';

import {cardDetailsOf, checkTransport, rewriteCard, type TransportCheck} from './a2a/card.js';
import {startWireProxy, type WireProxy} from './a2a/proxy.js';
import {type AgentCard, agentCardUrl, waitForAgentCard} from './agent_card.js';
import {
  type AgentExit,
  type AgentProcess,
  describeExit,
  forceKilledLine,
  startAgentProcess,
} from './agent_process.js';
import {AgentSupervisor} from './agent_supervisor.js';
import type {SessionContext} from './api.js';
import type {AgentCommand, HeadlessOptions} from './args.js';
import {openBrowser} from './browser.js';
import {CatalogRegistry, rereadLine} from './catalog/registry.js';
import {startCatalogWatch} from './catalog/watch.js';
import {agentHeaders, ConfigError, type SpectraConfig} from './config.js';
import {FixturesFolder} from './fixtures/fixtures.js';
import {MessageBox, unsetVariablesClause} from './message_box.js';
import {type ModelProxy, startModelProxy} from './model_proxy/proxy.js';
import {attachLines, environmentOf, redirections, variablesOf} from './model_proxy/redirection.js';
import type {Output} from './output.js';
import {CallPlacer} from './placement.js';
import {type ReceiverListener, startReceiverListener} from './receiver/listener.js';
import {SpanReceiver} from './receiver/receiver.js';
import {receiverExportLines, receiverVariables, replacedLine} from './receiver/variables.js';
import {type CapturePath, isEventOfKind, type Turn, type TurnEvent} from './record/turn_record.js';
import {TurnRecorder} from './recorder.js';
import {startSaveWatcher} from './save_watcher.js';
import {LOOPBACK_ADDRESS, PortTakenError, startViewerServer, type ViewerServer} from './server.js';
import {TurnStore} from './store/store.js';
import {startToolProxy, type ToolProxy} from './tool_proxy/proxy.js';
import {
  exportLines,
  startLines,
  toolEnvironmentOf,
  type ToolServer,
  ToolServerError,
  toolServers,
  toolVariablesOf,
} from './tool_proxy/servers.js';
import {TurnHub} from './turn_hub.js';

export type {AgentCommand};

/** The session's settings: the command line's options with the agent's URL settled, and the config. */
export interface SessionSettings extends Omit<HeadlessOptions, 'agentUrl' | 'config'> {
  agentUrl: URL;
  config: SpectraConfig;
  /** The tool proxy's port for each configured tool server, in config order. */
  toolPorts: number[];
  /** The viewer's settings under `attach` and `run`; none under the headless commands. */
  viewer?: {port: number; open: boolean; allowedHosts: string[]};
}

/** What a headless command works with once the agent's card has answered and the box is ready. */
export interface HeadlessSession {
  box: MessageBox;
  turns: TurnHub;
  store: TurnStore;
  /** Aborted once Spectra stops: on a stop signal, or when the agent's process ends. */
  stopping: AbortSignal;
  /** Why Spectra is stopping, once it is. */
  stopReason(): string;
}

/** A headless command's work, run in place of the viewer; resolves with its exit code. */
export type HeadlessWork = (session: HeadlessSession) => Promise<number>;

const STOP_SIGNALS: NodeJS.Signals[] =
  process.platform === 'win32' ? ['SIGINT', 'SIGTERM'] : ['SIGINT', 'SIGTERM', 'SIGHUP'];

/**
 * Names the stand-in provider's origin, for the tests: a call forwarded there
 * is read as the own host of the API its path names.
 */
const STAND_IN_VARIABLE = 'SPECTRA_PROVIDER_STAND_IN';

/**
 * Runs `attach`, or `run` when given the agent's command. `attach` opens the
 * store, waits for the agent's card, checks the card offers A2A over
 * JSON-RPC, starts the wire proxy, the message box and the server, prints
 * their addresses and opens the browser, then runs until a stop signal.
 * `run` binds every listener first, the wire proxy and the viewer included,
 * prints their addresses, starts the agent's command and opens the browser
 * at once; it reads the card at each start of the command, outlives whatever
 * the agent's process does, and runs until a stop signal. Each turn the
 * proxy captures is checked and written to the store, then closed on the
 * live stream, and Spectra waits for the turns still open when it stops.
 * Given headless work, `replay` or `test`, it runs that in place of the
 * viewer and the browser once the box is ready, in `attach`'s order, the
 * agent's output on stderr, and stops when the work is done, exiting with
 * the work's code, or 1 when the agent's process ended first. Resolves with
 * Spectra's exit code.
 */
export async function runSession(
  options: SessionSettings,
  agentCommand: AgentCommand | undefined,
  out: Output,
  viewerDir: string,
  headless?: HeadlessWork,
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
    catalogs = await CatalogRegistry.load(
      options.config.catalogs.map((file, index) => ({
        file,
        path: options.config.catalogPaths[index] ?? file,
      })),
    );
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
  const {headers, unset, left} = agentHeaders(options.config.headers, options.headers, process.env);
  if (unset.length > 0) {
    out.error(
      `${unsetVariablesClause(unset)}, so the ${left.join(', ')} header${left.length === 1 ? ' is' : 's are'} not sent ` +
        'and the message box cannot send.',
    );
  }
  let tools: ToolServer[];
  try {
    tools = toolServers(options.config.tools, options.toolPorts, process.env);
  } catch (error) {
    if (error instanceof ToolServerError) {
      out.error(error.message);
      return 1;
    }
    throw error;
  }
  // Under `run` a listed watch path that does not exist stops Spectra, as a missing catalog file does.
  const watching = agentCommand !== undefined && headless === undefined;
  if (watching) {
    for (const listed of options.config.watch.paths) {
      const exists = await stat(listed).then(
        () => true,
        () => false,
      );
      if (!exists) {
        out.error(`The watch path ${listed} does not exist.`);
        return 1;
      }
    }
  }
  const turns = new TurnHub();
  const recorder = new TurnRecorder(store, out, {onRecorded: turns.onRecorded, catalogs});
  const fixtures = new FixturesFolder(options.config.fixtures, process.cwd());
  const fixturesChanged = () => turns.notify({type: 'fixtures_changed'});
  /** The reads of changed catalog files, one at a time. */
  let catalogReads: Promise<void> = Promise.resolve();
  /** Reads a changed catalog file again, says what the read did, and tells the viewer. */
  const catalogChanged = (file: string): void => {
    catalogReads = catalogReads.then(async () => {
      try {
        const shown = catalogs.known.find(catalog => catalog.file === file)?.path ?? file;
        const said = rereadLine(shown, await catalogs.reread(file));
        if (said === undefined) return;
        if (said.error === true) out.error(said.line);
        else out.info(said.line);
        turns.notify({type: 'catalogs_changed'});
      } catch (error) {
        out.error(
          `${file} could not be read again: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  };
  /** Stops the catalog files' own watch, under `attach` and `run`. */
  let stopCatalogWatch: (() => void) | undefined;
  // Under `run` with restart on save, the save watcher's own watch tells the fixtures folder's
  // changes when it holds the folder; else the folder has its own.
  let stopWatching =
    watching && options.config.watch.paths.length > 0
      ? () => {}
      : fixtures.watch(fixturesChanged).stop;
  const alwaysCapturePaths: CapturePath[] =
    agentCommand === undefined
      ? []
      : ['model_proxy', ...(tools.length > 0 ? ['tool_proxy' as const] : [])];
  // The receiver's spans join a turn when the placer hands it on, and amend it once written.
  const placer: CallPlacer = new CallPlacer({
    onTurn: recorder.onTurn,
    log: line => out.info(line),
    alwaysCapturePaths,
    assemble: (turn: Turn): Turn => spans.assemble(turn),
    onCallEnded: (traceId, call) => spans.takeCall(traceId, call),
  });
  const spans: SpanReceiver = new SpanReceiver({
    turns: placer,
    store,
    onAmended: turns.onAmended,
    log: line => out.info(line),
  });
  const receiverOrigin = `http://${LOOPBACK_ADDRESS}:${options.receiverPort}`;
  const otel = receiverVariables(process.env, receiverOrigin);
  const modelProxyOrigin = `http://${LOOPBACK_ADDRESS}:${options.modelProxyPort}`;
  const redirected = redirections(process.env, modelProxyOrigin);
  const standIn = process.env[STAND_IN_VARIABLE]?.trim().replace(/\/+$/, '');

  const stop = new AbortController();
  let stoppedBy: NodeJS.Signals | undefined;
  /** The agent's process under the headless commands, which end when it does. */
  let agent: AgentProcess | undefined;
  let agentExit: AgentExit | undefined;
  /** The agent's process under `run`, which Spectra outlives. */
  let supervisor: AgentSupervisor | undefined;
  /** Stops the watch that restarts the agent on a save, under `run`. */
  let stopSaveWatcher: (() => void) | undefined;
  let proxy: WireProxy | undefined;
  let modelProxy: ModelProxy | undefined;
  let toolProxy: ToolProxy | undefined;
  let receiverListener: ReceiverListener | undefined;
  let box: MessageBox | undefined;
  let server: ViewerServer | undefined;
  let failed = false;
  /** Whether the agent's process ended on its own, before Spectra stopped. */
  let agentExitedEarly = false;
  let exitCode = 0;

  const onSignal = (signal: NodeJS.Signals) => {
    if (!stop.signal.aborted) {
      stoppedBy = signal;
      out.info(
        agentAlive()
          ? "Stopping the agent's process. Press Ctrl-C again to force it."
          : 'Stopping.',
      );
      supervisor?.beginStop();
      stop.abort();
    } else if (agentAlive()) {
      out.info("Forcing the agent's process to stop.");
      agent?.kill();
      supervisor?.kill();
    }
  };
  for (const signal of STOP_SIGNALS) {
    process.on(signal, onSignal);
  }

  try {
    // The model proxy listens before the agent starts, so its first call finds it.
    modelProxy = await startModelProxy({
      port: options.modelProxyPort,
      redirections: redirected,
      ...(standIn !== undefined && standIn !== '' && {standInOrigin: standIn}),
      place: call => placer.place(call),
      onCall: turns.onCall,
      log: line => out.info(line),
    });
    if (tools.length > 0) {
      toolProxy = await startToolProxy({
        servers: tools,
        place: call => placer.tryPlace(call),
        onCall: turns.onCall,
        log: line => out.info(line),
      });
    }
    receiverListener = await startReceiverListener({
      port: options.receiverPort,
      onSpans: received => spans.takeSpans(received),
      onLogs: received => spans.takeLogs(received),
    });
    const agentEnvironment = {
      ...environmentOf(redirected),
      ...toolEnvironmentOf(tools),
      ...otel.environment,
    };
    const cardUrl = agentCardUrl(options.agentUrl);
    const waitLine = (reason: string, hint: boolean): string =>
      `Waiting for the agent's card at ${cardUrl.href}: ${reason}.` +
      (hint
        ? agentCommand === undefined
          ? " The agent's URL is attach's <agent-url> argument, or agent.url in the config file."
          : " Change the agent's URL with --agent-url, or agent.url in the config file."
        : '') +
      (unset.length > 0 ? ` ${unsetVariablesClause(unset)}.` : '');
    const openWireProxy = (agentName: string | undefined): Promise<WireProxy> =>
      startWireProxy({
        port: options.proxyPort,
        agentUrl: options.agentUrl,
        agentName,
        onTurn: notification => {
          placer.onTurn(notification);
          turns.onTurn(notification);
        },
        traceIdTaken: async traceId =>
          turns.isOpen(traceId) || (await store.list()).some(turn => turn.traceId === traceId),
        warn: line => out.info(line),
      });
    const armed = {modelProxy, toolProxy};
    const openBox = (card: AgentCard | undefined): MessageBox =>
      new MessageBox({
        ...(card !== undefined && {card}),
        turns,
        headers,
        unsetVariables: unset,
        offer: () => catalogs.offer(),
        replay: {
          arm: pool => {
            armed.modelProxy.arm(pool);
            armed.toolProxy?.arm(pool);
          },
          disarm: () => {
            armed.modelProxy.disarm();
            armed.toolProxy?.disarm();
          },
          annotate: (traceId, attributes) => recorder.annotate(traceId, attributes),
          amend: async (traceId, attributes) => {
            const amended = await store.amend(traceId, (turn: Turn): Turn => ({
              events: turn.events.map(event =>
                isEventOfKind(event, 'turn')
                  ? {...event, attributes: {...event.attributes, ...attributes}}
                  : event,
              ),
            }));
            const turnEvent = amended?.turn.events.find((event): event is TurnEvent =>
              isEventOfKind(event, 'turn'),
            );
            if (turnEvent !== undefined) turns.onAmended(traceId, [turnEvent]);
          },
          log: line => out.info(line),
        },
      });
    const viewer = options.viewer ?? {port: 0, open: false, allowedHosts: []};

    if (agentCommand !== undefined && headless === undefined) {
      // Under `run` every listener binds before the command starts, and the card is read at each start.
      const wire = await openWireProxy(undefined);
      proxy = wire;
      const session = openBox(undefined);
      box = session;
      const context: SessionContext = {
        agentUrl: options.agentUrl.href,
        mode: 'run',
        proxyAddress: wire.address,
        previewPages: options.config.preview,
        fixturesFolder: fixtures.display,
      };
      const agentProcess = new AgentSupervisor({
        command: agentCommand,
        // Python holds its stdout back when it is not a terminal, and the agent's streams are pipes.
        env: {
          ...agentEnvironment,
          ...(process.env.PYTHONUNBUFFERED === undefined && {PYTHONUNBUFFERED: '1'}),
        },
        cardUrl,
        headers,
        out,
        waitLine,
        notify: event => turns.notify(event),
        session: {
          stateChanged: state => session.setAgentState(state),
          processEnded: reason => session.agentEnded(reason),
          processStopped: () => session.agentStopped(),
          cutOpenTurns: () => wire.cut(),
          cardAnswered: card => {
            const name = typeof card.name === 'string' ? card.name : undefined;
            wire.setAgentName(name);
            session.setCard(rewriteCard(card, wire.origin));
            delete context.agentName;
            Object.assign(context, name !== undefined && {agentName: name}, cardDetailsOf(card));
            const transport = checkTransport(card);
            const line = transportLine(transport);
            if (transport.kind === 'no_interface' || transport.kind === 'no_jsonrpc') {
              if (line !== undefined) out.error(line);
            } else {
              if (line !== undefined) out.info(line);
              if (session.cardRefusal !== undefined) out.info(session.cardRefusal);
            }
          },
        },
      });
      supervisor = agentProcess;
      server = await startViewerServer({
        port: viewer.port,
        viewerDir,
        allowedHosts: viewer.allowedHosts,
        api: {
          store,
          turns,
          box: session,
          fixtures,
          catalogs,
          prices: options.config.prices,
          context,
          agent: supervisor,
        },
      });
      const replaced = replacedLine(otel);
      if (replaced !== undefined) out.info(replaced);
      out.info(`The viewer is at ${server.url}`);
      out.info(`Point a host at the wire proxy: ${wire.address}`);
      for (const line of startLines(tools)) out.info(line);
      out.info(`The OpenTelemetry receiver is at ${receiverListener.origin}`);
      out.info(`Turns are saved in ${store.turnsDir}`);
      out.info(`Fixtures are saved in ${fixtures.dir}`);
      const watch = options.config.watch;
      /** The catalog files the save watcher's watch tells, which need no watch of their own. */
      let told: string[] = [];
      if (watch.paths.length === 0) {
        out.info(`Restart on save is off: watch is false in ${options.config.file}.`);
      } else {
        out.info(
          `A save in ${orList(watch.paths)} restarts the agent. ` +
            'Set watch to false in the config file when the agent reloads itself.',
        );
        const saveWatcher = await startSaveWatcher({
          watch,
          ignoredPaths: [store.dir, fixtures.dir],
          ...(options.config.file !== undefined && {configFile: options.config.file}),
          workingDir: process.cwd(),
          onSave: file => agentProcess.restart({kind: 'save', file}),
          log: line => out.info(line),
          observed: [
            {path: fixtures.dir, onChange: fixturesChanged},
            ...options.config.catalogs.map(file => ({
              path: file,
              onChange: () => catalogChanged(file),
            })),
          ],
        });
        stopSaveWatcher = () => saveWatcher.stop();
        if (!saveWatcher.observing.includes(fixtures.dir)) {
          stopWatching = fixtures.watch(fixturesChanged).stop;
        }
        told = saveWatcher.observing;
      }
      // A catalog file no watched folder holds has its folder watched, from the start.
      stopCatalogWatch = startCatalogWatch({
        files: options.config.catalogs.filter(file => !told.includes(file)),
        onChange: catalogChanged,
        log: line => out.info(line),
      }).stop;
      supervisor.start();
      if (viewer.open) {
        openBrowser(server.url);
      }
      await aborted(stop.signal);
    } else {
      if (headless === undefined) {
        // Under attach each catalog file's folder is watched, from the start.
        stopCatalogWatch = startCatalogWatch({
          files: options.config.catalogs,
          onChange: catalogChanged,
          log: line => out.info(line),
        }).stop;
      }
      if (agentCommand !== undefined) {
        const replaced = replacedLine(otel);
        if (replaced !== undefined) out.info(replaced);
        agent = startAgentProcess(agentCommand.command, agentCommand.args, {
          env: agentEnvironment,
          output: 'stderr',
        });
        void agent.exited.then(exit => {
          agentExit = exit;
          if (!stop.signal.aborted) {
            agentExitedEarly = true;
            const when =
              box === undefined && exit.error === undefined ? ' before its card answered' : '';
            out.info(`The agent's process ${describeExit(exit)}${when}.`);
            stop.abort();
          }
        });
      }

      const card = await waitForAgentCard(cardUrl, {
        signal: stop.signal,
        headers,
        onWaiting: reason => out.info(waitLine(reason, true)),
      });

      if (card !== undefined && !stop.signal.aborted) {
        const transport = checkTransport(card);
        const line = transportLine(transport);
        if (transport.kind === 'no_interface' || transport.kind === 'no_jsonrpc') {
          if (line !== undefined) out.error(line);
          stop.abort();
          return 1;
        }
        if (line !== undefined) out.info(line);
        proxy = await openWireProxy(typeof card.name === 'string' ? card.name : undefined);
        box = openBox(rewriteCard(card, proxy.origin));
        if (headless !== undefined) {
          for (const line of startLines(tools)) out.info(line);
          out.info(`The OpenTelemetry receiver is at ${receiverListener.origin}`);
          out.info(`Turns are saved in ${store.turnsDir}`);
          out.info(`Fixtures are saved in ${fixtures.dir}`);
          const session: HeadlessSession = {
            box,
            turns,
            store,
            stopping: stop.signal,
            stopReason: () =>
              agentExit !== undefined && agentExitedEarly
                ? `The agent's process ${describeExit(agentExit)}.`
                : 'Spectra is stopping.',
          };
          exitCode = await headless(session);
          stop.abort();
        } else {
          if (box.unavailable !== undefined) {
            out.info(box.unavailable);
          }
          server = await startViewerServer({
            port: viewer.port,
            viewerDir,
            allowedHosts: viewer.allowedHosts,
            api: {
              store,
              turns,
              box,
              fixtures,
              catalogs,
              prices: options.config.prices,
              context: {
                ...(typeof card.name === 'string' && {agentName: card.name}),
                agentUrl: options.agentUrl.href,
                mode: 'attach',
                proxyAddress: proxy.address,
                previewPages: options.config.preview,
                fixturesFolder: fixtures.display,
                variables: [...variablesOf(redirected), ...toolVariablesOf(tools), ...otel.printed],
                ...cardDetailsOf(card),
              },
            },
          });
          out.info(`The viewer is at ${server.url}`);
          out.info(`Point a host at the wire proxy: ${proxy.address}`);
          for (const line of startLines(tools)) out.info(line);
          out.info(`The OpenTelemetry receiver is at ${receiverListener.origin}`);
          out.info(`Turns are saved in ${store.turnsDir}`);
          out.info(`Fixtures are saved in ${fixtures.dir}`);
          const lines = attachLines(redirected, [
            ...exportLines(tools),
            ...receiverExportLines(otel),
          ]);
          out.info(lines.intro);
          for (const line of lines.exports) out.print(line);
          out.info(lines.note);
          if (viewer.open) {
            openBrowser(server.url);
          }
          await aborted(stop.signal);
        }
      }
    }
  } catch (error) {
    failed = true;
    if (error instanceof PortTakenError) {
      const option =
        error.port === options.viewer?.port
          ? '--port'
          : error.port === options.proxyPort
            ? '--proxy-port'
            : error.port === options.modelProxyPort
              ? '--model-proxy-port'
              : error.port === options.receiverPort
                ? '--receiver-port'
                : '--tool-proxy-port';
      out.error(`Port ${error.port} is taken. Choose another port with ${option}.`);
    } else {
      out.error(`Spectra failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  } finally {
    supervisor?.beginStop();
    stopSaveWatcher?.();
    stopCatalogWatch?.();
    stopWatching();
    await server?.close();
    box?.close();
    await proxy?.close();
    // A call the stop cuts off ends as aborted, so its turn can be written.
    await modelProxy?.close();
    await toolProxy?.close();
    await recorder.idle();
    if (agent !== undefined) {
      const stopped = await agent.stop();
      if (stopped.forceKilled) out.info(forceKilledLine());
      agentExit = await agent.exited;
    }
    await supervisor?.stop();
    // The receiver listens until the agent has gone, for the spans its exporter flushes as it stops.
    await receiverListener?.close();
    await spans.idle();
    for (const signal of STOP_SIGNALS) {
      process.off(signal, onSignal);
    }
  }

  return finish();

  /** Spectra's exit code, once everything has closed. */
  function finish(): number {
    if (failed) {
      return 1;
    }
    if (headless !== undefined) {
      if (agentExitedEarly) {
        return 1;
      }
      return stoppedBy === undefined ? exitCode : 128 + (constants.signals[stoppedBy] ?? 0);
    }
    return stoppedBy === undefined ? 0 : 128 + (constants.signals[stoppedBy] ?? 0);
  }

  /** Whether the agent's own process is running, under `run` and the headless commands. */
  function agentAlive(): boolean {
    return supervisor?.alive ?? (agent !== undefined && agentExit === undefined);
  }
}

/**
 * What the terminal says of where a card puts JSON-RPC: that it lists no
 * interface or no JSON-RPC interface, an error, or that it prefers another
 * transport; nothing for a card that puts JSON-RPC first.
 */
function transportLine(transport: TransportCheck): string | undefined {
  switch (transport.kind) {
    case 'no_interface':
      return (
        "The agent's card lists no interface to reach it at. A2A 1.0 requires the card's " +
        'supportedInterfaces, and A2A 0.3 its url, so hosts that follow the card cannot reach ' +
        'the agent either.'
      );
    case 'no_jsonrpc':
      return (
        `The agent's card lists no A2A JSON-RPC interface, only ${transport.transports.join(', ')}. ` +
        'Spectra captures A2A over JSON-RPC only.'
      );
    case 'jsonrpc_later':
      return (
        `The agent's card prefers ${transport.preferred} to JSON-RPC. ` +
        "Hosts that follow the card's preference bypass the wire proxy, and their turns are not captured."
      );
    case 'jsonrpc_first':
      return undefined;
  }
}

/** The paths as one phrase: `a`, `a or b`, `a, b or c`. */
function orList(paths: readonly string[]): string {
  return paths.length <= 1
    ? paths.join('')
    : `${paths.slice(0, -1).join(', ')} or ${paths[paths.length - 1]}`;
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
