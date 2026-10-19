/**
 * Saves text as a file through a Blob URL and a temporary link. Used for the unreadable-data
 * download in the banner; export (T11) can use it as well.
 */

type ObjectUrls = Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;

export type DownloadDeps = {
  doc?: Document;
  url?: ObjectUrls;
  /** Schedules the URL's release. Injected so tests need no timers. */
  later?: (fn: () => void) => void;
};

/**
 * Long enough for any browser to have started reading the Blob before it is released
 * (the figure FileSaver.js uses); it costs only the memory the text already takes.
 */
const REVOKE_AFTER_MS = 40_000;

export function downloadText(
  text: string,
  filename: string,
  {
    doc = document,
    url = URL,
    later = (fn) => void setTimeout(fn, REVOKE_AFTER_MS),
  }: DownloadDeps = {},
  type = 'application/json',
): void {
  const href = url.createObjectURL(new Blob([text], { type }));
  const a = doc.createElement('a');
  a.href = href;
  a.download = filename;
  a.hidden = true;
  doc.body.append(a); // Firefox ignores clicks on links outside the document
  try {
    a.click();
  } finally {
    a.remove();
    later(() => url.revokeObjectURL(href));
  }
}

/** `<stem>-<timestamp>.<ext>`, with the timestamp's colons and milliseconds removed. */
export function safeFilename(stem: string, isoTimestamp: string, ext: string): string {
  const stamp = isoTimestamp.replace(/\.\d+Z?$/, '').replace(/:/g, '-');
  return `${stem}-${stamp}.${ext}`;
}
