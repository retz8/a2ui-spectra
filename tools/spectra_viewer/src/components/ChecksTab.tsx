import {Badge} from '@/components/ui/badge.tsx';
import {locateFinding} from '@/model/messages.ts';
import type {CheckEvent, TurnRecordEvent} from '@/model/record.ts';
import type {SchemaCheckState} from '@/model/summary.ts';

import {type GoTo, targetIds} from './links.ts';

/** One section per check event, each finding linked to its message. */
export function ChecksTab({
  open,
  events,
  checks,
  schemaCheck,
  goTo,
}: {
  open: boolean;
  events: readonly TurnRecordEvent[];
  checks: readonly CheckEvent[];
  schemaCheck: SchemaCheckState;
  goTo: GoTo;
}) {
  if (open) return <p className="text-sm text-muted-foreground">Runs when the turn closes.</p>;
  if (checks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No schema check: the turn has no protocol version.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {checks.map((check, checkIndex) => {
        const {attributes} = check;
        const findings = attributes['a2ui.check.findings'];
        const noA2ui =
          attributes['a2ui.check.name'] === 'schema' && schemaCheck.state === 'no_a2ui';
        return (
          <section key={check.spanId + checkIndex} className="rounded-lg border p-3">
            <header className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">{attributes['a2ui.check.name']}</h3>
              <Badge variant={attributes['a2ui.check.passed'] ? 'secondary' : 'destructive'}>
                {attributes['a2ui.check.passed'] ? 'passed' : 'failed'}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {attributes['a2ui.check.protocol_version']}
              </span>
            </header>
            {noA2ui && <p className="mt-2 text-sm text-muted-foreground">No A2UI in this turn.</p>}
            {findings.length > 0 && (
              <ul className="mt-2 flex flex-col gap-2">
                {findings.map((finding, findingIndex) => {
                  const location = locateFinding(events, finding.path);
                  return (
                    <li
                      key={findingIndex}
                      id={targetIds.finding(checkIndex, findingIndex)}
                      className="scroll-mt-4 rounded-md p-1 text-sm"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="font-mono">
                          {finding.code}
                        </Badge>
                        {finding.surfaceId !== undefined && (
                          <span className="font-mono text-xs text-muted-foreground">
                            {finding.surfaceId}
                          </span>
                        )}
                        {location !== undefined && (
                          <>
                            {location.inner !== '' && (
                              <span className="font-mono text-xs">{location.inner}</span>
                            )}
                            <button
                              type="button"
                              className="text-xs underline-offset-2 hover:underline"
                              onClick={() => goTo('raw', targetIds.message(location.key))}
                            >
                              the message
                            </button>
                          </>
                        )}
                      </div>
                      <p className="mt-1 whitespace-pre-wrap">{finding.message}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
