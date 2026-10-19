# Visual design — "Riso desk"

The board looks like a sheet printed on a risograph: four flat spot inks on
uncoated paper, halftone tints, and one small mis-registration effect. The
matrix is a printed grid with axis labels set along its edges, like a chart.
This is the only direction. Builders apply it; they do not reinterpret it.

Every token below resolves to the exact hex given. Write hexes, not HSL or
`color-mix()`, so nothing drifts.

## Privacy constraint
No third-party requests at runtime. Fonts are **self-hosted through
`@fontsource` npm packages** and bundled by Vite. No Google Fonts link, no CDN.

## Type
| Role | Face | Package | Use |
| --- | --- | --- | --- |
| Display | Bricolage Grotesque (variable) | `@fontsource-variable/bricolage-grotesque` | Wordmark, quadrant names, prompt question. Weights 700–800, tight tracking (-0.02em). |
| Body | Instrument Sans (variable) | `@fontsource-variable/instrument-sans` | Task titles, inputs, buttons. 400/500/600. |
| Utility | IBM Plex Mono | `@fontsource/ibm-plex-mono` (400, 500) | Axis labels, key chips, counts, dates, footer. Uppercase labels get 0.08em tracking. |

Fallback stacks: display/body `"Helvetica Neue", Arial, sans-serif`; mono `ui-monospace, Menlo, monospace`.

Scale (rem): 0.75 · 0.875 · 1 · 1.125 · 1.5 · 2 · 3. Task titles 1rem/1.4.

## Colour tokens
Light ("white stock"):

| Token | Hex | Role |
| --- | --- | --- |
| `--paper` | `#F1F2EE` | Page background |
| `--sheet` | `#FAFAF7` | Raised surfaces: input, prompt, toast |
| `--ink` | `#1B2340` | Text, rules, focus ring (federal-blue black) |
| `--ink-muted` | `#545B73` | Secondary text |
| `--rule` | `#C9CCD3` | Hairlines |
| `--do` | `#FF48B0` | Do band (fluorescent pink) |
| `--do-tint` | `#FFD9EC` | Do body |
| `--schedule` | `#0078BF` | Schedule band (riso blue) |
| `--schedule-tint` | `#CCE4F2` | Schedule body |
| `--delegate` | `#FFE800` | Delegate band (yellow) |
| `--delegate-tint` | `#FFF8B3` | Delegate body |
| `--delete` | `#A5AAA8` | Delete band (grey) |
| `--delete-tint` | `#E3E5E4` | Delete body |
| `--danger` | `#C8102E` | Error banner rule, error icon, and a date or Who? field's error text only |

Dark ("black stock"): `--paper #121315`, `--sheet #1C1E22`, `--ink #ECEDE8`,
`--ink-muted #A3A8B8`, `--rule #33363D`, tints `--do-tint #3A1A2C`,
`--schedule-tint #0F2A3D`, `--delegate-tint #2E2A0C`, `--delete-tint #26292B`,
`--danger #FF5A6E`. The four band inks keep their light values in dark mode.

Band text is always `#1B2340` on Do, Delegate and Delete bands, and `#FAFAF7`
on the Schedule band (set at ≥ 1.125rem / 700, where 3:1 is enough). These
two are literal on purpose: band colours do not change with the theme.

Theme structure follows the standard pattern: every token on bare `:root`,
redefined under `@media (prefers-color-scheme: dark)`. There is no theme
toggle in v1.

## Texture
- **Paper grain:** one inline SVG `feTurbulence` noise as a data URI, fixed on
  `body::before` at 6% opacity (light) or 8% (dark), `pointer-events: none`.
- **Halftone:** each quadrant body is its tint plus a dot screen of its band ink:
  `radial-gradient(var(--q-ink) 0.6px, transparent 0.8px) 0 0 / 6px 6px` at 18%
  opacity, on a pseudo-element behind the list so it never sits under text at
  full strength.

## Layout
- **Header:** wordmark "Eisenhower" left in display 800, with a 2px/2px
  `--do` text-shadow offset (the mis-registration). On the right is the backup
  status in mono.
- **Capture line:** full-width input on `--sheet` with a 2px `--ink` bottom
  rule, placeholder "What needs doing?", and a `/` key chip at its right end.
- **Triage prompt:** appears directly under the capture line. Left: the question
  in display 700 2rem ("Important?", then "Urgent?") with `Y` `N` key chips.
  Right: a 64px mini-matrix (4 squares in the band inks at 25%). Answering
  "Important" lights the matching row to full ink; answering "Urgent" lights the
  column, leaving only the destination square lit for 250 ms before the task lands.
- **Board:** a 2×2 grid with a 1.5rem gutter. Mono axis labels sit along the top
  ("URGENT" over column 1, "NOT URGENT" over column 2) and up the left side,
  rotated ("IMPORTANT", "NOT IMPORTANT"). Below 640px the axes hide, the
  quadrants stack, and each band shows its axis pair as a subtitle.
- **Quadrant:** an ink band (key chip `1`–`4`, name in display 800 1.5rem, open
  count in mono at the right), then a one-line verb in mono under the name:
  "DO IT NOW", "PICK A DATE", "HAND IT OFF", "LET IT GO". The body is halftone,
  the list sits on top, and the footer action (Drop all in Delete) is a text button.
- **Task row:** a round checkbox drawn as a 1.5px ink circle that fills with
  band ink when done. Title, then inline extras: a date field in Schedule, a
  "Who?" field in Delegate. Move buttons `1`–`4` appear as small key chips on
  hover or focus only. The focused row gets a 2px `--ink` outline, 2px offset.
- **Field errors:** a rejected date or Who? value's message sits on its own
  line under that field, right-aligned, in mono 0.75rem `--danger`, tied to the
  field by `aria-describedby`.
- **Stamps:** NEXT (Do), DUE (Schedule) and WAITING ON <who> (Delegate) are
  mono 0.75rem uppercase labels in a 1.5px border, rotated -2deg, coloured
  `--ink`, with the band ink as background for NEXT and DUE.
- **Done tasks:** title in `--ink-muted` with a 1.5px line-through in band ink.
- **Toast (undo):** bottom-centre on `--sheet`, 2px `--ink` border, with the
  text "Deleted 'Call Sam'" and an Undo button. Its 5-second countdown is a
  `--do` bar shrinking across the top edge.
- **Banners:** full width under the header on `--sheet`, with a 4px left rule
  in `--danger` and plain text. Not dismissible while the condition holds.
- **Footer:** mono 0.75rem: Clear done on the left; Export and Import (as
  buttons) on the right. The last-backup status lives in the header. There is
  no "? keys" hint, because the app has no `?` shortcut.

## Motion
One orchestrated moment: when a task lands, its row prints in. It enters with
a 3px/3px band-ink shadow offset that settles to 0 over 220 ms
(`cubic-bezier(.2,.8,.2,1)`), as if the plates came into register. The
mini-matrix lighting also animates. Nothing else moves. Under
`prefers-reduced-motion: reduce`, both animations are skipped.

## Accessibility
- Visible focus everywhere.
- Every control has an accessible name; key chips are `aria-hidden` next to labelled buttons.
- The prompt is an `aria-live="assertive"` region.
- Quadrants are `<section aria-labelledby>`, each with a list.
- Body text contrast ≥ 4.5:1 on the tints in both themes.
