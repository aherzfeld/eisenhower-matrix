import { describe, expect, it } from 'vitest';
import { lostChangesWarning, renderBanner } from './banner';

describe('lostChangesWarning', () => {
  it('counts the changes that were discarded', () => {
    expect(lostChangesWarning(1)).toBe("Changed in another tab. 1 change made here wasn't saved.");
    expect(lostChangesWarning(3)).toBe("Changed in another tab. 3 changes made here weren't saved.");
  });
});

describe('renderBanner', () => {
  it('renders one banner per notice, a download button only where raw data exists, and clears', () => {
    const slot = document.createElement('div');
    renderBanner(slot, [{ text: 'First' }, { text: 'Second', raw: '{bad' }]);
    expect([...slot.querySelectorAll('.banner')].map((e) => e.textContent)).toEqual(['First', 'Second']);
    const buttons = slot.querySelectorAll<HTMLButtonElement>('.banner__download');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.textContent).toBe('Download the unreadable data');
    expect(buttons[0]!.type).toBe('button');
    renderBanner(slot, []);
    expect(slot.children).toHaveLength(0);
  });

  it('leaves the DOM alone when nothing changed, so the live region does not re-announce', () => {
    const slot = document.createElement('div');
    renderBanner(slot, [{ text: 'Same' }]);
    const first = slot.firstElementChild;
    renderBanner(slot, [{ text: 'Same' }]);
    expect(slot.firstElementChild).toBe(first);
  });
});
