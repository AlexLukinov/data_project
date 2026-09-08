-- Fix the drift view to read the DEDUPLICATED truth.
--
-- core.hands is a ReplacingMergeTree, so after a re-parse there are temporarily two physical
-- rows per hand until a background merge collapses them -- and merges are eventual, not
-- immediate. Without FINAL the drift view showed one row per (site, OLD signature) and
-- another per (site, NEW signature) for the same hands, which is exactly the false alarm a
-- drift monitor must not produce.
--
-- The same lesson as the lab's Sprint 4 notes: never rely on the background merge for
-- correctness; force the collapse at read time.

DROP VIEW IF EXISTS core.v_format_drift;

CREATE VIEW core.v_format_drift AS
SELECT
    site,
    format_signature,
    parser_version,
    schema_version,
    count()                 AS hands,
    min(played_at_utc)      AS first_seen,
    max(played_at_utc)      AS last_seen,
    sum(unparsed_count)     AS unparsed_lines_total
FROM core.hands FINAL
GROUP BY site, format_signature, parser_version, schema_version;
