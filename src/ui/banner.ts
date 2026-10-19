/**
 * Persistent warning banners. Each notice is one `.banner` paragraph; a notice carrying the
 * unreadable stored data (`raw`) is followed by a button that downloads it. The caller wires
 * the button's click (by delegation) and decides when a notice clears.
 */

export type Notice = { text: string; raw?: string };

export const DOWNLOAD_RAW_LABEL = 'Download the unreadable data';

/** Banner text after a reload discarded changes this tab could not save. */
export function lostChangesWarning(count: number): string {
  return count === 1
    ? "Changed in another tab. 1 change made here wasn't saved."
    : `Changed in another tab. ${count} changes made here weren't saved.`;
}

/** What is on screen, so an unchanged banner is not rebuilt (a rebuilt live region re-announces). */
const shown = new WeakMap<HTMLElement, string>();

export function renderBanner(slot: HTMLElement, notices: readonly Notice[]): void {
  const key = JSON.stringify(notices.map((n) => [n.text, n.raw !== undefined]));
  if (shown.get(slot) === key) return;
  shown.set(slot, key);
  const doc = slot.ownerDocument;
  const parts: HTMLElement[] = [];
  notices.forEach((notice, i) => {
    const p = doc.createElement('p');
    p.className = 'banner';
    p.textContent = notice.text;
    parts.push(p);
    if (notice.raw === undefined) return;
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'banner__download';
    button.dataset.notice = String(i);
    button.textContent = DOWNLOAD_RAW_LABEL;
    parts.push(button);
  });
  slot.replaceChildren(...parts);
}
