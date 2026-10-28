import {useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {usePanelRef} from 'react-resizable-panels';

import {ContextBar} from '@/components/ContextBar.tsx';
import {KeysDialog} from '@/components/KeysDialog.tsx';
import {Rail} from '@/components/Rail.tsx';
import {Strip} from '@/components/Strip.tsx';
import {TurnList} from '@/components/TurnList.tsx';
import {TurnView} from '@/components/TurnView.tsx';
import {ResizableHandle, ResizablePanel, ResizablePanelGroup} from '@/components/ui/resizable.tsx';
import {cn} from '@/lib/utils';
import {type Address, historyOf, readAddress, writeAddress} from '@/model/address.ts';
import {followNewest} from '@/model/follow.ts';
import {pageKeyOf} from '@/model/keys.ts';
import {rememberedSize, rememberSize} from '@/state/layout.ts';
import {previewHost} from '@/state/preview_host.ts';
import {useRenderErrorsInView} from '@/state/render_errors.ts';
import {spectra, useSpectra} from '@/state/spectra.ts';
import {setViewSetting, useViewSettings} from '@/state/view_settings.ts';
import {useSmallWindow} from '@/state/window.ts';

/** The turn list's width until its divider is dragged, in pixels. */
const TURN_LIST = 296;

/** The strip's width, the turn list's size when collapsed, in pixels. */
const STRIP = 52;

/** How long the turn list takes to collapse to its strip or expand from it, in milliseconds. */
const SWING_MS = 200;

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function subscribeToHash(listener: () => void): () => void {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}

/**
 * The page address: the selected turn and its step. Changing the turn adds an
 * entry to the browser's history; changing the step, or the viewer's own
 * move, replaces it.
 */
function useAddress(): [Address, (traceId: string, stepId?: string, own?: boolean) => void] {
  const hash = useSyncExternalStore(subscribeToHash, () => window.location.hash);
  const address = useMemo(() => readAddress(hash), [hash]);
  const go = useCallback((traceId: string, stepId?: string, own = false) => {
    const next = writeAddress(traceId, stepId);
    switch (historyOf(readAddress(window.location.hash), {traceId, stepId}, {own})) {
      case 'push':
        window.location.hash = next;
        break;
      case 'replace':
        window.history.replaceState(null, '', next);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
        break;
      case 'none':
        break;
    }
  }, []);
  return [address, go];
}

export function App() {
  const state = useSpectra();
  const [address, go] = useAddress();
  const selected = address.traceId;
  const [selections, setSelections] = useState(0);
  const small = useSmallWindow();
  // The turn list is a strip below 1,280px wide. On a wide window it collapses to the strip and
  // expands from it in place, its panel's width moving between the two; dragging never collapses it.
  const {turnListCollapsed} = useViewSettings();
  const [swing, setSwing] = useState<'collapse' | 'expand' | undefined>();
  // The list's width while it swings: its width as the collapse starts, or the one it opens to.
  const [swingWidth, setSwingWidth] = useState(TURN_LIST);
  const stripInPanel = turnListCollapsed || swing !== undefined;
  // The turn in view counts its preview's render errors on its row.
  const renderErrors = useRenderErrorsInView();
  const turns = useMemo(
    () =>
      renderErrors === undefined || renderErrors.count === 0
        ? state.turns
        : state.turns.map(turn =>
            turn.traceId === renderErrors.traceId
              ? {...turn, renderErrors: renderErrors.count}
              : turn,
          ),
    [state.turns, renderErrors],
  );
  // The turn list over the turn view on a small window, and what took focus as it opened.
  const [overlay, setOverlay] = useState<'list' | 'search' | undefined>();
  const [keysOpen, setKeysOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const stripButton = useRef<HTMLButtonElement>(null);
  const overlayBox = useRef<HTMLDivElement>(null);
  const turnList = usePanelRef();
  const startSwing = (direction: 'collapse' | 'expand') => {
    setSwingWidth(
      direction === 'collapse'
        ? (turnList.current?.getSize().inPixels ?? TURN_LIST)
        : (rememberedSize('turnList') ?? TURN_LIST),
    );
    setSwing(direction);
  };

  // The full list takes the overlay's place as the window grows past 1,280px.
  if (!small && overlay !== undefined) setOverlay(undefined);
  const closeOverlay = useCallback(({refocus}: {refocus: boolean}) => {
    setOverlay(undefined);
    if (refocus) stripButton.current?.focus();
  }, []);

  // Selecting the turn in view again keeps its step; selecting another adds a history entry.
  const pick = useCallback(
    (traceId: string) => {
      setSelections(count => count + 1);
      if (traceId !== readAddress(window.location.hash).traceId) go(traceId);
    },
    [go],
  );
  const onStep = useCallback(
    (traceId: string, stepId: string | undefined) => {
      if (traceId === readAddress(window.location.hash).traceId) go(traceId, stepId, true);
    },
    [go],
  );
  useEffect(() => {
    spectra.start();
  }, []);
  // A swing moves the list's panel, then settles the setting once it has landed. The move waits a
  // frame, until the panels have taken the list's panel as collapsible.
  useEffect(() => {
    const panel = turnList.current;
    if (swing === undefined || panel === null) return;
    let landed: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      if (swing === 'collapse') panel.collapse();
      else panel.resize(rememberedSize('turnList') ?? TURN_LIST);
      landed = setTimeout(
        () => {
          setViewSetting('turnListCollapsed', swing === 'collapse');
          setSwing(undefined);
        },
        reducedMotion() ? 0 : SWING_MS,
      );
    });
    return () => {
      cancelAnimationFrame(frame);
      if (landed !== undefined) clearTimeout(landed);
    };
  }, [swing, turnList]);

  // The preview pages load once the session says which are configured.
  useEffect(() => {
    if (state.context !== undefined) previewHost.configure(state.context.previewPages ?? []);
  }, [state.context]);

  // With no turn in the address, the newest is selected; while the newest is selected, a new turn is as it opens.
  const newest = state.loaded ? state.turns[0]?.traceId : undefined;
  const newestBefore = useRef<string | undefined>(undefined);
  useEffect(() => {
    const next = followNewest(newestBefore.current, newest, selected);
    newestBefore.current = newest;
    if (next !== undefined) go(next, undefined, true);
  }, [newest, selected, go]);

  // `/` focuses the turn list's search, opening the overlay on a small window and expanding a collapsed list; `?` lists the keys.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = pageKeyOf(event);
      if (key === '/') {
        event.preventDefault();
        if (small && overlay === undefined) setOverlay('search');
        else if (!small && turnListCollapsed) {
          setSwingWidth(rememberedSize('turnList') ?? TURN_LIST);
          setSwing('expand');
          setTimeout(() => search.current?.focus(), reducedMotion() ? 0 : SWING_MS);
        } else search.current?.focus();
      } else if (key === '?') {
        event.preventDefault();
        setKeysOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [small, overlay, turnListCollapsed]);

  // The overlay closes on Esc, and on a press outside it and the strip's button.
  useEffect(() => {
    if (overlay === undefined) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeOverlay({refocus: true});
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (overlayBox.current?.contains(target) || stripButton.current?.contains(target)) return;
      closeOverlay({refocus: false});
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [overlay, closeOverlay]);

  const turnView = (
    <TurnView
      traceId={selected}
      stepId={address.stepId}
      selection={selections}
      onSelect={traceId => go(traceId)}
      onStep={onStep}
    />
  );
  return (
    <div className="flex h-screen min-w-[740px] bg-canvas">
      <Rail keysOpen={keysOpen} onKeys={() => setKeysOpen(true)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <ContextBar context={state.context} connected={state.connected} />
        <div className="relative flex min-h-0 flex-1 gap-2 pr-2 pb-2">
          {small && (
            <Strip
              turns={turns}
              selected={selected}
              onSelect={pick}
              open={overlay !== undefined}
              onOpen={() =>
                overlay === undefined ? setOverlay('list') : closeOverlay({refocus: true})
              }
              buttonRef={stripButton}
            />
          )}
          {small && overlay !== undefined && (
            <div ref={overlayBox} className="absolute top-0 bottom-2 left-[60px] z-30 w-[296px]">
              <TurnList
                turns={turns}
                loaded={state.loaded}
                selected={selected}
                onSelect={(traceId, how) => {
                  pick(traceId);
                  // A turn pressed closes the overlay; the arrows move through it, and Enter closes it on the turn reached.
                  if (how === 'press') closeOverlay({refocus: true});
                }}
                onChoose={() => closeOverlay({refocus: true})}
                searchRef={search}
                autoFocus={overlay}
                className="shadow-overlay"
              />
            </div>
          )}
          <ResizablePanelGroup
            orientation="horizontal"
            className={cn(
              'min-h-0 min-w-0 flex-1',
              // The panels' widths move while the list swings, and only then, so a drag follows the pointer.
              swing !== undefined &&
                '[&>[data-panel]]:transition-[flex-grow] [&>[data-panel]]:duration-200 [&>[data-panel]]:ease-out motion-reduce:[&>[data-panel]]:transition-none',
            )}
            onLayoutChanged={(_, {isUserInteraction}) => {
              const panel = turnList.current;
              if (isUserInteraction && panel !== null && !panel.isCollapsed()) {
                rememberSize('turnList', panel.getSize().inPixels);
              }
            }}
          >
            {!small && (
              <ResizablePanel
                id="turn-list"
                panelRef={turnList}
                defaultSize={turnListCollapsed ? STRIP : (rememberedSize('turnList') ?? TURN_LIST)}
                minSize={240}
                collapsible={turnListCollapsed || swing !== undefined}
                collapsedSize={STRIP}
                groupResizeBehavior="preserve-pixel-size"
              >
                {/* A card is on screen throughout a swing: the list, opaque and held at its full
                    width so its text never reflows, is clipped to the card's rounded shape as the
                    panel narrows or revealed as it widens, while the strip fades in over it where
                    it lands, or away as the list opens. The list stays mounted while collapsed,
                    hidden under the strip, so opening it replays nothing and keeps its search. */}
                <div className="relative h-full [clip-path:inset(-4px_-1px_-4px_-4px_round_12px)]">
                  <div
                    className={cn(
                      'h-full',
                      swing === undefined && 'min-w-[240px]',
                      swing === undefined && turnListCollapsed && 'invisible',
                    )}
                    style={swing === undefined ? undefined : {width: swingWidth}}
                    inert={swing === undefined && turnListCollapsed}
                  >
                    <TurnList
                      turns={turns}
                      loaded={state.loaded}
                      selected={selected}
                      onSelect={pick}
                      searchRef={search}
                      onCollapse={() => startSwing('collapse')}
                    />
                  </div>
                  {stripInPanel && (
                    <div
                      className={cn(
                        'absolute inset-y-0 left-0 flex',
                        swing === 'collapse' && 'strip-arrive pointer-events-none',
                        swing === 'expand' && 'strip-leave pointer-events-none',
                      )}
                    >
                      <Strip
                        turns={turns}
                        selected={selected}
                        onSelect={pick}
                        open={false}
                        expands
                        onOpen={() => startSwing('expand')}
                        buttonRef={stripButton}
                      />
                    </div>
                  )}
                </div>
              </ResizablePanel>
            )}
            {!small && (
              <ResizableHandle
                className="w-2 bg-transparent"
                disabled={turnListCollapsed || swing !== undefined}
              />
            )}
            <ResizablePanel id="turn-view" {...(!small && {minSize: 640})}>
              {turnView}
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </div>
      <KeysDialog open={keysOpen} onOpenChange={setKeysOpen} />
    </div>
  );
}
