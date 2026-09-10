# @poker/importers

Range files in, ranges out (spec §11.3). Every importer is a pure function
`(text, fileName) => { importer, ranges, warnings }`; a file that cannot be read throws
`ImportError` with what is wrong and, where there is one, the way round. Depends on
`@poker/core` only — no DOM, no network — so it runs in the app, in a Worker and in Node tests.

| Importer | Reads | Situation | Source · tool |
|---|---|---|---|
| `importSph` | Simple Preflop Holdem's text export: combo notation (class notation accepted with a warning). **The guaranteed path.** | inferred from the file name | `own` · Simple Preflop Holdem |
| `importOwnJson` | the backup `GET /v1/ranges/export` writes (`{"format": "poker-ranges/1", "ranges": [...]}`) | stated in the file | as stored |
| `importGtoWizard` | GTO Wizard's copied range: class notation, fractional or percentage weights | inferred | `solver` · GTO Wizard |
| `importPio` | a PioSOLVER script (`#Range0#` OOP, `#Range1#` IP) or plain range text; the 1326-number list is refused with the way round | inferred | `solver` · PioSOLVER |
| `importEquilab` | Equilab / Flopzilla class notation with `[75]AKo,KQo[/75]` weight blocks | inferred | `own` · Equilab |
| `importCsv` | `situation,range,weight` rows (the range quoted; the weight an optional fraction or percentage for the row) | inferred from the situation cell | `own` |
| `importPlainText` | class or combo notation from an unnamed tool | inferred | `own` |

`importText(file)` picks the importer by extension (`.json`, `.csv`), then by content
(`#RangeN#` → Pio, `[75]…[/75]` → Equilab, combo notation → SPH, else plain text); `.bin` is
refused with a message pointing at SPH's text export (Appendix A stays backlog). `importFiles(files)`
runs a whole folder and returns `{ imported, failed }` — the import report of spec §11.2.

## Filename → situation

`inferFromName('BB_defend_vs_CO_2.5x.txt')` gives a `NodeKey` — hero BB, villain CO, sequence
`[CO raise 2.5, BB call]` — with a confidence (`high` / `medium` / `low`), notes to check, and the
tokens it did not understand. The grammar: positions and their aliases (`BU`, `LJ`, `EP` …), one
action word (`RFI`/`open`, `3bet`, `4bet`, `5bet`, `call`/`defend`/`flat`, `squeeze`, `iso`,
`limp`, `shove`/`jam`, `fold`), `vs` between hero's side and villain's, `100bb` for the stack
(20bb and up), `2.5x` / `2.5bb` for a raise size (before `vs` it is hero's, after it villain's),
`NL5` for the stake, `6max` for the table. Never trusted silently: the app's review table shows
every inference before anything is saved.

## Weights

Percentages are recognised (largest weight in (1, 100]) and divided by 100 with a warning; the
combo text a range is stored as is always `serializeRange(range, 'combo')` from `@poker/core`.
