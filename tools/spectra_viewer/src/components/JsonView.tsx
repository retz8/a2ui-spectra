import {ChevronDownIcon, ChevronRightIcon} from 'lucide-react';
import {useState} from 'react';

/** JSON as a collapsible view, open to `depth` levels. */
export function JsonView({value, depth = 1}: {value: unknown; depth?: number}) {
  return (
    <div className="overflow-x-auto pl-4 font-mono text-xs leading-5">
      <JsonNode value={value} depth={depth} />
    </div>
  );
}

function JsonNode({
  name,
  value,
  depth,
  last = true,
}: {
  name?: string;
  value: unknown;
  depth: number;
  last?: boolean;
}) {
  const [open, setOpen] = useState(depth > 0);
  const label =
    name === undefined ? null : (
      <span className="text-sky-800 dark:text-sky-300">{JSON.stringify(name)}: </span>
    );
  const comma = last ? '' : ',';
  if (typeof value !== 'object' || value === null) {
    return (
      <div className="whitespace-pre-wrap break-all">
        {label}
        <Primitive value={value} />
        {comma}
      </div>
    );
  }
  const entries: Array<[string | undefined, unknown]> = Array.isArray(value)
    ? value.map(item => [undefined, item])
    : Object.entries(value);
  const [opening, closing] = Array.isArray(value) ? ['[', ']'] : ['{', '}'];
  if (entries.length === 0) {
    return (
      <div>
        {label}
        {opening}
        {closing}
        {comma}
      </div>
    );
  }
  const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
  return (
    <div>
      <button
        type="button"
        className="-ml-4 inline-flex items-center text-left hover:bg-accent"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <Chevron className="size-4 shrink-0 text-muted-foreground" />
        <span>
          {label}
          {opening}
          {!open && (
            <span className="text-muted-foreground">
              {' '}
              {Array.isArray(value) ? `${entries.length} items` : `${entries.length} keys`}{' '}
              {closing}
              {comma}
            </span>
          )}
        </span>
      </button>
      {open && (
        <>
          <div className="ml-2 border-l pl-4">
            {entries.map(([key, item], index) => (
              <JsonNode
                key={key ?? index}
                name={key}
                value={item}
                depth={depth - 1}
                last={index === entries.length - 1}
              />
            ))}
          </div>
          <div>
            {closing}
            {comma}
          </div>
        </>
      )}
    </div>
  );
}

function Primitive({value}: {value: unknown}) {
  if (typeof value === 'string')
    return <span className="text-emerald-800 dark:text-emerald-300">{JSON.stringify(value)}</span>;
  if (typeof value === 'number')
    return <span className="text-violet-700 dark:text-violet-300">{value}</span>;
  if (typeof value === 'boolean')
    return <span className="text-amber-700 dark:text-amber-300">{String(value)}</span>;
  return (
    <span className="text-muted-foreground">{value === undefined ? 'undefined' : 'null'}</span>
  );
}
