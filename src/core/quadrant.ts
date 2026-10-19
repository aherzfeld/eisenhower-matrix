export type Quadrant = 'do' | 'schedule' | 'delegate' | 'delete';

export type Flags = { urgent: boolean; important: boolean };

export type QuadrantInfo = Flags & {
  id: Quadrant;
  number: 1 | 2 | 3 | 4;
  label: string;
  key: '1' | '2' | '3' | '4';
};

/** In display order: Do(1), Schedule(2), Delegate(3), Delete(4). */
export const QUADRANTS: readonly QuadrantInfo[] = [
  { id: 'do', number: 1, label: 'Do', key: '1', urgent: true, important: true },
  { id: 'schedule', number: 2, label: 'Schedule', key: '2', urgent: false, important: true },
  { id: 'delegate', number: 3, label: 'Delegate', key: '3', urgent: true, important: false },
  { id: 'delete', number: 4, label: 'Delete', key: '4', urgent: false, important: false },
];

export function quadrantOf({ urgent, important }: Flags): Quadrant {
  if (important) return urgent ? 'do' : 'schedule';
  return urgent ? 'delegate' : 'delete';
}

export function flagsFor(quadrant: Quadrant): Flags {
  const q = QUADRANTS.find((info) => info.id === quadrant)!;
  return { urgent: q.urgent, important: q.important };
}
