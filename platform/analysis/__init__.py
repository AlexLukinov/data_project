"""The analysis modules (ADR-026): `hero` (My game) and `pool` (the population), as siblings.

Both are services over the shared `stats` engine and contain no stat SQL; each has its own
report presets (`presets.yaml`) and its own router in `api/routers/`. `hero` reaches the pool
only through `analysis.pool.baselines` (a Protocol), `pool` never imports `hero` -- enforced
by `platform/.importlinter`.
"""
