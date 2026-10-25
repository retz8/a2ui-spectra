import {Dialog} from 'radix-ui';

import {Icon} from './icons.tsx';

const SECTIONS: Array<{title: string; rows: Array<{label: string; keys: string[]}>}> = [
  {
    title: 'Turn list',
    rows: [
      {label: 'Previous or next turn', keys: ['↑', '↓']},
      {label: 'Close or open a conversation', keys: ['←', '→']},
      {label: 'Search turns', keys: ['/']},
      {label: 'Choose the turn and close the list, on a small window', keys: ['Enter']},
      {label: 'Close the list on a small window', keys: ['Esc']},
    ],
  },
  {
    title: 'Timeline',
    rows: [
      {label: 'Previous or next step', keys: ['↑', '↓']},
      {label: 'First step', keys: ['Home']},
      {label: 'Latest step', keys: ['End']},
      {label: 'Jump to latest', keys: ['l']},
    ],
  },
  {
    title: 'Problems',
    rows: [
      {label: 'Next problem', keys: ['n']},
      {label: 'Previous problem', keys: ['Shift', 'n']},
    ],
  },
  {
    title: 'Composer',
    rows: [
      {label: 'Send', keys: ['Enter']},
      {label: 'New line', keys: ['Shift', 'Enter']},
    ],
  },
];

/** The list of keys, opened by `?` or the rail's Keys button. */
export function KeysDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fade-in-quick fixed inset-0 z-40 bg-scrim" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fade-in-quick fixed top-1/2 left-1/2 z-50 flex w-[600px] max-w-[calc(100%-32px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-[14px] bg-panel px-5 py-4 shadow-overlay outline-none"
        >
          <div className="flex items-center gap-2">
            <Dialog.Title className="text-base font-semibold">Keys</Dialog.Title>
            <div className="flex-1" />
            <Dialog.Close
              aria-label="Close"
              className="ease-quick flex size-7 cursor-pointer items-center justify-center rounded-[7px] text-muted-foreground hover:bg-tint hover:text-foreground"
            >
              <Icon kind="close" size={14} />
            </Dialog.Close>
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-[18px]">
            {SECTIONS.map(section => (
              <section key={section.title} className="flex flex-col gap-0.5">
                <h3 className="section-label mb-1">{section.title}</h3>
                {section.rows.map(row => (
                  <div key={row.label} className="flex min-h-7 items-center gap-2.5">
                    <span className="min-w-0 flex-1">{row.label}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {row.keys.map(key => (
                        <kbd
                          key={key}
                          className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-[5px] border bg-tint px-1.5 font-sans text-xs font-medium"
                        >
                          {key}
                        </kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </section>
            ))}
          </div>
          <p className="border-t pt-3 text-xs text-muted-foreground">
            Press ? anywhere to open this list, and Esc to close it. A key of one character does
            nothing while you type in a field.
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
