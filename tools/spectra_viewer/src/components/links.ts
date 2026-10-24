/** The turn view's tabs, and the elements a link inside it lands on. */
export type TabName = 'input' | 'raw' | 'surfaces' | 'checks';

/** Opens a tab and lands on an element in it. */
export type GoTo = (tab: TabName, targetId: string) => void;

export const targetIds = {
  message: (key: string) => `message-${key}`,
  finding: (check: number, finding: number) => `finding-${check}-${finding}`,
  rejection: (key: string) => `rejection-${key}`,
};

/** What links to an A2UI message: its findings and its rejection. */
export interface MessageMarks {
  findings: string[];
  rejection?: string;
}
