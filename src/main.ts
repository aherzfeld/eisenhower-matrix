import { createBrowserStorage } from './io/storage';
import { createApp } from './ui/app';

createApp({
  root: document.getElementById('app')!,
  storage: createBrowserStorage(),
  now: () => new Date().toISOString(),
  newId: () => crypto.randomUUID(),
});
