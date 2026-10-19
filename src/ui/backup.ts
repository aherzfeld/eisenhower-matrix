/** The backup reminder's wording, from `lastExportAt` (set by export, T11). Pure. */
import { daysSince } from '../core/dates';

/** Over this many days since the last export, the reminder becomes a warning. */
export const BACKUP_WARN_DAYS = 7;

export type BackupReminder = { text: string; warn: boolean };

export function backupReminder(lastExportAt: string | undefined, now: Date): BackupReminder {
  if (lastExportAt === undefined) return { text: 'Never backed up', warn: true };
  const days = daysSince(lastExportAt, now);
  const text =
    days === 0 ? 'Last backup today' : `Last backup ${days} ${days === 1 ? 'day' : 'days'} ago`;
  return { text, warn: days > BACKUP_WARN_DAYS };
}

/** Writes the reminder into the header's backup-status slot. */
export function renderBackupStatus(slot: HTMLElement, reminder: BackupReminder): void {
  if (slot.textContent !== reminder.text) slot.textContent = reminder.text;
  slot.classList.toggle('backup-status--warn', reminder.warn);
}
