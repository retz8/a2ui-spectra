import {cn} from '@/lib/utils';
import type {Section} from '@/model/address.ts';
import {chooseTheme, type ThemeChoice, useTheme} from '@/state/theme.ts';

import {Icon, type IconKind, Mark} from './icons.tsx';

const THEMES: Array<{choice: ThemeChoice; icon: IconKind; label: string}> = [
  {choice: 'system', icon: 'system', label: 'Follow the system'},
  {choice: 'light', icon: 'sun', label: 'Light'},
  {choice: 'dark', icon: 'moon', label: 'Dark'},
];

const SECTIONS: Array<{section: Section; icon: IconKind; label: string}> = [
  {section: 'turns', icon: 'turns', label: 'Turns'},
  {section: 'fixtures', icon: 'fixtures', label: 'Fixtures'},
];

/**
 * The left rail: Spectra's mark and name, the sections, each a link to the
 * address it was last on, and at its foot the list of keys and the theme
 * switch.
 */
export function Rail({
  section,
  hrefOf,
  keysOpen,
  onKeys,
}: {
  section: Section;
  hrefOf: (section: Section) => string;
  keysOpen: boolean;
  onKeys: () => void;
}) {
  const theme = useTheme();
  return (
    <nav
      aria-label="Sections"
      className="flex w-16 shrink-0 flex-col items-center gap-1.5 pt-3 pb-2.5"
    >
      <div className="mb-2.5 flex flex-col items-center gap-1 pt-1">
        <Mark size={24} />
        <span className="text-xs font-semibold">Spectra</span>
      </div>
      {SECTIONS.map(({section: each, icon, label}) => (
        <a
          key={each}
          href={hrefOf(each)}
          aria-current={each === section ? 'page' : undefined}
          className={cn(
            'ease-quick flex w-13 flex-col items-center gap-1 rounded-lg pt-2 pb-1.5',
            each === section
              ? 'bg-brand-soft text-brand'
              : 'text-muted-foreground hover:bg-tint hover:text-foreground',
          )}
        >
          <Icon kind={icon} size={20} />
          <span className={cn('text-xs', each === section ? 'font-semibold' : 'font-medium')}>
            {label}
          </span>
        </a>
      ))}
      <div className="flex-1" />
      <button
        type="button"
        aria-label="Keys"
        title="Keys · ?"
        aria-haspopup="dialog"
        aria-expanded={keysOpen}
        onClick={onKeys}
        className={cn(
          'ease-quick mb-0.5 flex h-8 w-9 cursor-pointer items-center justify-center rounded-lg',
          keysOpen
            ? 'bg-tint text-foreground'
            : 'text-muted-foreground hover:bg-border hover:text-foreground',
        )}
      >
        <Icon kind="keys" size={16} />
      </button>
      <div
        role="group"
        aria-label="Theme"
        className="flex flex-col gap-0.5 rounded-lg bg-tint p-0.5"
      >
        {THEMES.map(({choice, icon, label}) => (
          <button
            key={choice}
            type="button"
            aria-label={label}
            title={label}
            aria-pressed={theme === choice}
            onClick={() => chooseTheme(choice)}
            className={cn(
              'ease-quick flex h-7 w-8 cursor-pointer items-center justify-center rounded-md',
              theme === choice
                ? 'bg-panel text-foreground shadow-panel'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon kind={icon} size={14} />
          </button>
        ))}
      </div>
    </nav>
  );
}
