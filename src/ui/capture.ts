/** Triage prompt: "Important?" then "Urgent?". The logic is pure; `renderPrompt` is the DOM glue. */
import { QUADRANTS, quadrantOf, type Flags, type Quadrant } from '../core/quadrant';

export type Triage = { step: 'important' } | { step: 'urgent'; important: boolean };

export const START: Triage = { step: 'important' };

export type TriageOutcome =
  | { kind: 'continue'; state: Triage }
  | { kind: 'done'; flags: Flags }
  | { kind: 'cancel' }
  | { kind: 'ignore' };

/** Only y/Y/n/N/Escape act. Every other key is ignored: there is no default answer. */
export function triageKey(state: Triage, key: string): TriageOutcome {
  if (key === 'Escape') return { kind: 'cancel' };
  const answer = key === 'y' || key === 'Y' ? true : key === 'n' || key === 'N' ? false : undefined;
  if (answer === undefined) return { kind: 'ignore' };
  if (state.step === 'important') return { kind: 'continue', state: { step: 'urgent', important: answer } };
  return { kind: 'done', flags: { important: state.important, urgent: answer } };
}

export type Answers = { important?: boolean; urgent?: boolean };

/** State classes for the four mini-matrix squares, given the answers so far. */
export function squareClasses({ important, urgent }: Answers): Record<Quadrant, string> {
  const out = {} as Record<Quadrant, string>;
  for (const q of QUADRANTS) {
    const classes: string[] = [];
    if (important !== undefined && q.important === important) classes.push('is-row');
    if (urgent !== undefined && q.urgent === urgent) classes.push('is-col');
    if (important !== undefined && urgent !== undefined && quadrantOf({ important, urgent }) === q.id) {
      classes.push('is-target');
    }
    out[q.id] = classes.join(' ');
  }
  return out;
}

/** The elements the prompt writes into; built by render.ts. */
export type PromptEls = {
  region: HTMLElement;
  question: HTMLElement;
  mini: HTMLElement;
  squares: Record<Quadrant, HTMLElement>;
};

const QUESTIONS = { important: 'Important?', urgent: 'Urgent?' } as const;

function answersOf(state: Triage): Answers {
  return state.step === 'urgent' ? { important: state.important } : {};
}

/** Shows the question for `state`, or clears the prompt when `state` is undefined. */
export function renderPrompt(els: PromptEls, state: Triage | undefined): void {
  els.region.dataset.active = state ? 'true' : 'false';
  els.question.textContent = state ? QUESTIONS[state.step] : '';
  els.mini.hidden = !state;
  if (state) paintSquares(els, squareClasses(answersOf(state)));
}

/** Leaves the final answers painted on the squares; the next prompt repaints them. */
export function paintSquares(els: PromptEls, classes: Record<Quadrant, string>): void {
  for (const q of QUADRANTS) els.squares[q.id].className = `mini__sq mini__sq--${q.id} ${classes[q.id]}`.trim();
}
