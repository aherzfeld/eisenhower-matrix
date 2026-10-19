/** Persistent warning banner. Renders into the banner slot; an empty message clears it. */
export function renderBanner(slot: HTMLElement, message: string | undefined): void {
  if (!message) {
    slot.replaceChildren();
    return;
  }
  const el = document.createElement('p');
  el.className = 'banner';
  el.textContent = message;
  slot.replaceChildren(el);
}
