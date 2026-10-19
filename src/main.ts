import { createMemoryStorage } from './core/ports';
import { createApp } from './ui/app';

// T10 swaps the in-memory storage for the real localStorage adapter.
createApp({
  root: document.getElementById('app')!,
  storage: createMemoryStorage(),
  now: () => new Date().toISOString(),
  newId: () => crypto.randomUUID(),
});
