import {useEffect, useMemo, useState} from 'react';

import {type Address} from '@/model/address.ts';
import {fixtureViewOf} from '@/state/fixtures.ts';
import type {TurnView as TurnViewState} from '@/state/selectors.ts';
import {spectra, useSpectra} from '@/state/spectra.ts';

import {Empty, TurnBody} from './TurnView.tsx';

/**
 * The fixture view: a fixture's turn in the turn view's shape, under a line
 * naming the file. It reads what was recorded: a press in its preview is
 * dropped, and sending belongs to the replayed conversation in Turns.
 */
export function FixtureView({
  address,
  onAddress,
  onReplayStarted,
  heldWidth,
}: {
  address: Address;
  onAddress: (address: Address, own?: boolean) => void;
  /** A replay started from the header: its first turn has opened. */
  onReplayStarted: (traceId: string) => void;
  /** The width the content is held at while the list swings. */
  heldWidth?: number;
}) {
  const {fixtures} = useSpectra();
  const view = useMemo(() => fixtureViewOf(address, fixtures), [address, fixtures]);
  const [maximized, setMaximized] = useState(false);
  const {fixture: name} = address;
  useEffect(() => {
    if (name !== undefined && view.status === 'reading') spectra.ensureFixture(name);
  }, [name, view.status]);
  const shown = view.status === 'shown' ? view : undefined;
  const turnView = useMemo<Extract<TurnViewState, {status: 'closed'}> | undefined>(
    () =>
      shown === undefined
        ? undefined
        : {status: 'closed', turn: shown.turn, earlier: {turns: shown.earlier}},
    [shown],
  );
  let body;
  if (shown !== undefined && turnView !== undefined && address.traceId !== undefined) {
    body = (
      <TurnBody
        key={`${shown.name}:${address.traceId}`}
        traceId={address.traceId}
        view={turnView}
        stepId={address.stepId}
        node={address.node}
        onStep={(stepId, node) =>
          onAddress(
            {
              section: 'fixtures',
              fixture: shown.name,
              traceId: address.traceId!,
              ...(stepId !== undefined && {stepId}),
              ...(node !== undefined && {node}),
            },
            true,
          )
        }
        onOther={(traceId, stepId) =>
          onAddress({section: 'fixtures', fixture: shown.name, traceId, stepId})
        }
        onAddress={onAddress}
        onReplayStarted={onReplayStarted}
        maximized={maximized}
        onMaximized={setMaximized}
        fixture={{name: shown.name, record: shown.record, saved: shown.saved}}
      />
    );
  } else if (view.status === 'empty') {
    body = <Empty>No fixtures yet.</Empty>;
  } else if (view.status === 'unreadable') {
    body = <Empty>None of the files in the folder reads as a turn record.</Empty>;
  } else if (view.status === 'missing') {
    body = <Empty>{view.message}</Empty>;
  } else {
    body = <Empty>Reading the fixture…</Empty>;
  }
  return (
    <main className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl bg-panel shadow-panel">
      <div
        className="flex min-h-0 flex-1 flex-col"
        style={heldWidth === undefined ? undefined : {width: heldWidth}}
      >
        {body}
      </div>
    </main>
  );
}
