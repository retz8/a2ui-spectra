import {cn} from '@/lib/utils';
import {chooseTheme, type ThemeChoice, useTheme} from '@/state/theme.ts';

import {Icon, type IconKind, Mark} from './icons.tsx';

const THEMES: Array<{choice: ThemeChoice; icon: IconKind; label: string}> = [
  {choice: 'system', icon: 'system', label: 'Follow the system'},
  {choice: 'light', icon: 'sun', label: 'Light'},
  {choice: 'dark', icon: 'moon', label: 'Dark'},
];

/** The left rail: Spectra's mark and name, the sections, and the theme switch at its foot. */
export function Rail() {
  const theme = useTheme();
  return (
    <nav
      aria-label="Sections"
      className="flex w-16 shrink-0 flex-col items-center gap-1.5 pt-3 pb-2.5"
    >
      <div className="mb-2.5 flex flex-col items-center gap-[3px] pt-1">
        <Mark size={22} />
        <span className="text-xs font-semibold">Spectra</span>
      </div>
      <div
        aria-current="page"
        className="flex w-12 flex-col items-center gap-[3px] rounded-[10px] bg-brand-soft pt-[7px] pb-[5px] text-brand"
      >
        <Icon kind="turns" size={18} />
        <span className="text-xs font-semibold">Turns</span>
      </div>
      <div className="flex-1" />
      <div
        role="group"
        aria-label="Theme"
        className="flex flex-col gap-0.5 rounded-[10px] bg-tint p-[3px]"
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
              'ease-quick flex h-[26px] w-8 cursor-pointer items-center justify-center rounded-[7px]',
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
