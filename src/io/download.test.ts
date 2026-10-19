import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadText, safeFilename } from './download';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('downloadText', () => {
  it('saves the text, byte for byte, through a Blob URL and a temporary link', async () => {
    let blob: Blob | undefined;
    let connectedAtClick = false;
    const url = {
      createObjectURL: vi.fn((b: Blob) => {
        blob = b;
        return 'blob:test/1';
      }),
      revokeObjectURL: vi.fn(),
    };
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      connectedAtClick = this.isConnected; // Firefox only follows links that are in the document
    });
    let revoke: (() => void) | undefined;
    downloadText('{"broken', 'data.json', {
      doc: document,
      url,
      later: (fn) => {
        revoke = fn;
      },
    });
    expect(click).toHaveBeenCalledOnce();
    const clicked = click.mock.contexts[0] as HTMLAnchorElement;
    expect(await blob!.text()).toBe('{"broken');
    expect(blob!.type).toBe('application/json');
    expect(clicked!.download).toBe('data.json');
    expect(clicked!.href).toBe('blob:test/1');
    expect(connectedAtClick).toBe(true);
    expect(clicked!.isConnected).toBe(false);
    expect(url.revokeObjectURL).not.toHaveBeenCalled();
    revoke!();
    expect(url.revokeObjectURL).toHaveBeenCalledWith('blob:test/1');
  });
});

describe('safeFilename', () => {
  it('turns a timestamp into something every OS accepts', () => {
    expect(safeFilename('eisenhower-unreadable', '2026-10-19T12:00:00.000Z', 'json')).toBe(
      'eisenhower-unreadable-2026-10-19T12-00-00.json',
    );
  });
});
