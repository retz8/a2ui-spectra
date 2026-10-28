import {PREVIEW_PROTOCOL} from 'a2ui-spectra-preview';
import {useLayoutEffect, useRef} from 'react';

import {cn} from '@/lib/utils';
import {type Route, unansweredLine} from '@/model/preview.ts';
import {previewHost} from '@/state/preview_host.ts';
import {setViewSetting, type ViewSettings} from '@/state/view_settings.ts';

import {Icon} from './icons.tsx';

/** Narrow's frame width: a phone-like width, Tailwind's `sm` container. */
export const NARROW = 384;

/**
 * The Preview pane: the surface drawn by the page it is routed to, in a
 * frame on the pane's tinted canvas, Narrow or the pane's width, under a
 * strip of what the page reported; or why there is no preview.
 */
export function PreviewPane({
  route,
  lines,
  width,
}: {
  route: Route;
  /** The plain sentence of each report of the page's render. */
  lines: readonly string[];
  width: ViewSettings['width'];
}) {
  if (route.kind === 'waiting') {
    return <Quiet>Loading the preview pages…</Quiet>;
  }
  if (route.kind === 'none') {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        {route.catalogId === undefined ? (
          <p className="max-w-[560px] leading-[1.7]">No preview: the surface names no catalog.</p>
        ) : (
          <p className="max-w-[560px] leading-[1.7]">
            No preview for catalog{' '}
            <span className="rounded-md bg-tint px-1.5 py-0.5 font-mono text-xs [overflow-wrap:anywhere]">
              {route.catalogId}
            </span>
          </p>
        )}
        <p className="max-w-[440px] text-muted-foreground">
          Add a page built with a Spectra preview adapter to the config’s preview pages.
        </p>
        {route.unanswered.map(page => (
          <p
            key={page.id}
            className="max-w-[440px] text-xs text-muted-foreground [overflow-wrap:anywhere]"
          >
            {unansweredLine(page, PREVIEW_PROTOCOL)}
          </p>
        ))}
      </div>
    );
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {lines.length > 0 && (
        <div className="flex shrink-0 flex-col gap-1 px-4 pt-2.5">
          {lines.map((line, index) => (
            <div
              key={index}
              className="flex h-8 items-center gap-2 rounded-lg bg-problem-soft px-3 text-xs"
            >
              <Icon kind="failed" size={13} className="shrink-0 text-problem" />
              <span className="min-w-0 truncate font-medium">{line}</span>
            </div>
          ))}
        </div>
      )}
      <Frame pageId={route.page.id} width={width} />
    </div>
  );
}

/** The frame the page's iframe is laid over, kept in place as the layout moves. */
function Frame({pageId, width}: {pageId: string; width: ViewSettings['width']}) {
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    let frame = 0;
    let last = '';
    const follow = () => {
      const element = slot.current;
      if (element !== null) {
        const {left, top, width, height} = element.getBoundingClientRect();
        const key = `${left},${top},${width},${height}`;
        if (key !== last) {
          last = key;
          previewHost.place(pageId, {left, top, width, height});
        }
      }
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => {
      cancelAnimationFrame(frame);
      previewHost.place(undefined);
    };
  }, [pageId]);
  return (
    <div className="flex min-h-0 flex-1 justify-center overflow-hidden bg-tint p-4">
      <div
        ref={slot}
        style={width === 'narrow' ? {width: NARROW} : undefined}
        className={cn(
          'h-full max-w-full shrink-0 rounded-[6px] bg-white shadow-[0_0_0_1px_var(--border)]',
          width === 'wide' && 'w-full',
        )}
      />
    </div>
  );
}

function Quiet({children}: {children: string}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-muted-foreground">
      <p>{children}</p>
    </div>
  );
}

/** Narrow and Wide, the preview's two widths, remembered in the browser. */
export function WidthSwitch({width}: {width: ViewSettings['width']}) {
  const options: Array<{value: ViewSettings['width']; label: string}> = [
    {value: 'narrow', label: `Narrow · ${NARROW}`},
    {value: 'wide', label: 'Wide'},
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Preview width"
      className="flex shrink-0 gap-0.5 rounded-lg bg-tint p-0.5"
    >
      {options.map(option => {
        const on = option.value === width;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => setViewSetting('width', option.value)}
            className={cn(
              'ease-quick h-6 cursor-pointer rounded-md px-2.5 text-xs font-medium whitespace-nowrap',
              on
                ? 'bg-panel text-foreground shadow-panel'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
