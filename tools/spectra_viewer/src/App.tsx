import {useCallback, useEffect, useSyncExternalStore} from 'react';

import {MessageBoxPanel} from '@/components/MessageBoxPanel.tsx';
import {TurnList} from '@/components/TurnList.tsx';
import {TurnView} from '@/components/TurnView.tsx';
import {ResizableHandle, ResizablePanel, ResizablePanelGroup} from '@/components/ui/resizable.tsx';
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
  useEffect(() => spectra.start(), []);

  // A page opened with no turn in its address selects the newest.
  const newest = state.turns[0]?.traceId;
  const pickNewest = state.loaded && selected === undefined && newest !== undefined;
  useEffect(() => {
    if (pickNewest && newest !== undefined) select(newest, {replace: true});
  }, [pickNewest, newest, select]);

  return (
    <div className="flex h-screen flex-col">
      {state.connected === false && (
        <div role="status" className="shrink-0 bg-destructive px-3 py-1 text-sm text-white">
          Not connected to Spectra
        </div>
      )}
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="22" minSize="12">
          <TurnList
            turns={state.turns}
            loaded={state.loaded}
            selected={selected}
            onSelect={select}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="53" minSize="25">
          <TurnView traceId={selected} />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="25" minSize="15">
          <MessageBoxPanel onOpenTurn={select} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
