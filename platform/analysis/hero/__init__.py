"""Hero analysis (ADR-026): "what do I do here, and what does it cost me?"

Reads the `hero` dataset, hero seat only, through `stats.service`: leaks against a baseline
(`leaks`), sessions split on gaps in play (`sessions`), and the presets of the My game area.
The baseline comes through `analysis.pool.baselines` -- the only pool import allowed here.
"""
