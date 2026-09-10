"""Pool analysis (ADR-026): what the field, a cohort of it, or one opponent does.

Everything here reads the `population` dataset through `stats.service`: population stats by
situation (`service.pool_report`), player lookup (`service.players`), cohorts by stat criteria
(`cohorts`), and the `BaselineProvider` the hero module compares itself against (`baselines`).
"""
