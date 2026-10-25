import {useCallback, useEffect, useRef, useSyncExternalStore} from 'react';

import {ContextBar} from '@/components/ContextBar.tsx';
import {Rail} from '@/components/Rail.tsx';
import {TurnList} from '@/components/TurnList.tsx';
import {TurnView} from '@/components/TurnView.tsx';
import {ResizableHandle, ResizablePanel, ResizablePanelGroup} from '@/components/ui/resizable.tsx';
import {followNewest} from '@/model/follow.ts';
import {spectra, useSpectra} from '@/state/spectra.ts';

const TURN_HASH = /^#\/turns\/([0-9a-f]{32})$/;

function selectedInHash(): string | undefined {
  return TURN_HASH.exec(window.location.hash)?.[1];
}

function subscribeToHash(listener: () => void): () => void {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}

/** The selected turn, kept in the page address's hash. */
function useSelection(): [
  string | undefined,
  (traceId: string, options?: {replace?: boolean}) => void,
] {
  const selected = useSyncExternalStore(subscribeToHash, selectedInHash);
  const select = useCallback((traceId: string, {replace = false}: {replace?: boolean} = {}) => {
    const hash = `#/turns/${traceId}`;
    if (replace) {
      window.history.replaceState(null, '', hash);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } else {
      window.location.hash = hash;
    }
  }, []);
  return [selected, select];
}

export function App() {
  const state = useSpectra();
  const [selected, select] = useSelection();
  useEffect(() => {
    spectra.start();
  }, []);

  // With no turn in the address, the newest is selected; while the newest is selected, a new turn is as it opens.
  const newest = state.loaded ? state.turns[0]?.traceId : undefined;
  const newestBefore = useRef<string | undefined>(undefined);
  useEffect(() => {
    const next = followNewest(newestBefore.current, newest, selected);
    newestBefore.current = newest;
    if (next !== undefined) select(next, {replace: true});
  }, [newest, selected, select]);

  return (
    <div className="flex h-screen min-w-[1080px] bg-canvas">
      <Rail />
      <div className="flex min-w-0 flex-1 flex-col">
        <ContextBar context={state.context} connected={state.connected} />
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1 pr-2 pb-2">
          <ResizablePanel defaultSize={296} minSize={240}>
            <TurnList
              turns={state.turns}
              loaded={state.loaded}
              selected={selected}
              onSelect={select}
            />
          </ResizablePanel>
          <ResizableHandle className="w-2 bg-transparent" />
          <ResizablePanel minSize={640}>
            <TurnView traceId={selected} onSelect={select} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
