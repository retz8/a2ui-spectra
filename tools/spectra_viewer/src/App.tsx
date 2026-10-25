import {useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {usePanelRef} from 'react-resizable-panels';

import {ContextBar} from '@/components/ContextBar.tsx';
import {KeysDialog} from '@/components/KeysDialog.tsx';
import {Rail} from '@/components/Rail.tsx';
import {Strip} from '@/components/Strip.tsx';
import {TurnList} from '@/components/TurnList.tsx';
import {TurnView} from '@/components/TurnView.tsx';
import {ResizableHandle, ResizablePanel, ResizablePanelGroup} from '@/components/ui/resizable.tsx';
import {type Address, historyOf, readAddress, writeAddress} from '@/model/address.ts';
import {followNewest} from '@/model/follow.ts';
import {pageKeyOf} from '@/model/keys.ts';
import {rememberedSize, rememberSize} from '@/state/layout.ts';
import {spectra, useSpectra} from '@/state/spectra.ts';
import {useSmallWindow} from '@/state/window.ts';

/** The turn list's width until its divider is dragged, in pixels. */
const TURN_LIST = 296;

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
  // The turn list over the turn view on a small window, and what took focus as it opened.
  const [overlay, setOverlay] = useState<'list' | 'search' | undefined>();
  const [keysOpen, setKeysOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const stripButton = useRef<HTMLButtonElement>(null);
  const overlayBox = useRef<HTMLDivElement>(null);
  const turnList = usePanelRef();

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

  // With no turn in the address, the newest is selected; while the newest is selected, a new turn is as it opens.
  const newest = state.loaded ? state.turns[0]?.traceId : undefined;
  const newestBefore = useRef<string | undefined>(undefined);
  useEffect(() => {
    const next = followNewest(newestBefore.current, newest, selected);
    newestBefore.current = newest;
    if (next !== undefined) go(next, undefined, true);
  }, [newest, selected, go]);

  // `/` focuses the turn list's search, opening the overlay on a small window; `?` lists the keys.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = pageKeyOf(event);
      if (key === '/') {
        event.preventDefault();
        if (small && overlay === undefined) setOverlay('search');
        else search.current?.focus();
      } else if (key === '?') {
        event.preventDefault();
        setKeysOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [small, overlay]);

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
              turns={state.turns}
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
                turns={state.turns}
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
            className="min-h-0 min-w-0 flex-1"
            onLayoutChanged={(_, {isUserInteraction}) => {
              const panel = turnList.current;
              if (isUserInteraction && panel !== null) {
                rememberSize('turnList', panel.getSize().inPixels);
              }
            }}
          >
            {!small && (
              <ResizablePanel
                id="turn-list"
                panelRef={turnList}
                defaultSize={rememberedSize('turnList') ?? TURN_LIST}
                minSize={240}
                groupResizeBehavior="preserve-pixel-size"
              >
                <TurnList
                  turns={state.turns}
                  loaded={state.loaded}
                  selected={selected}
                  onSelect={pick}
                  searchRef={search}
                />
              </ResizablePanel>
            )}
            {!small && <ResizableHandle className="w-2 bg-transparent" />}
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
