import type {RefObject} from 'react';

import {type FixtureGroup, type FixtureRow, searchFixtureGroups} from '@/model/fixtures.ts';
import type {TurnGroup} from '@/model/turn_groups.ts';

import {formatClock, STATUS_ICONS} from './format.ts';
import {GroupedList, type GroupLine} from './TurnList.tsx';

/** A fixture's header: its name, when it was saved, its turn count and cost, and its own turn's status. */
function lineOfFixture(group: TurnGroup<FixtureRow>): GroupLine {
  const fixture = group as FixtureGroup;
  const own = fixture.turns[fixture.turns.length - 1];
  return {
    title: fixture.name,
    time: formatClock(fixture.savedAt),
    meta: fixture.meta,
    icon: own === undefined ? 'file' : STATUS_ICONS[own.outcome ?? 'completed'],
    ...(fixture.reason !== undefined && {reason: fixture.reason}),
  };
}

/** The Fixtures section's list: one group per file of the folder, its turns in order, its own turn last. */
export function FixturesList({
  groups,
  loaded,
  ...list
}: {
  groups: readonly FixtureGroup[];
  loaded: boolean;
  selected: string | undefined;
  onSelect: (rowId: string, how: 'press' | 'key') => void;
  searchRef?: RefObject<HTMLInputElement | null>;
  autoFocus?: 'list' | 'search';
  onChoose?: () => void;
  onCollapse?: () => void;
  className?: string;
}) {
  return (
    <GroupedList<FixtureRow>
      heading="Fixtures"
      count={groups.length}
      groups={groups}
      searchOf={(all, query) => searchFixtureGroups(all as readonly FixtureGroup[], query)}
      lineOf={lineOfFixture}
      searchLabel="Search fixtures"
      treeLabel="Fixtures and their turns"
      collapseLabel="Collapse the fixtures list"
      emptyText={loaded ? 'No fixtures yet.' : 'Reading the fixtures…'}
      noMatchText={query => `No fixture matches “${query}”.`}
      {...list}
    />
  );
}
