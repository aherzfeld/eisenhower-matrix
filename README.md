# Eisenhower Matrix

A simple, keyboard-first web app for sorting tasks into the Eisenhower Matrix:
Do, Schedule, Delegate, Delete.

Your tasks are stored only in your own browser. Nothing is sent to a server.

## Development

```
npm install
npm run dev     # local dev server
npm test        # unit tests (Vitest + jsdom)
npm run e2e     # browser smoke tests (Playwright; first run: npx playwright install chromium)
```

The build plan is in [`docs/plans/v1.md`](docs/plans/v1.md).
