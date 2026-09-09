"""The stat engine (POKER_PLAN.md phase C; ADR-020, ADR-021, ADR-022).

`stats.registry` loads the YAML registry -- every dimension and every built-in stat -- into
typed models. `stats.ast` is the filter / expression tree those definitions, every saved
filter and every custom stat are written in. Nothing here touches a database: the compiler
(plan step C.4) is the only consumer that emits SQL, and it reads the registry rather than any
hand-written column list.
"""
