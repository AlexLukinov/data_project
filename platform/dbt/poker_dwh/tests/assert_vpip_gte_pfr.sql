-- LAW OF POKER: you cannot raise preflop more often than you voluntarily put money in,
-- because every raise IS a voluntary contribution. VPIP >= PFR, always, for every player.
--
-- If this fails, the flag logic is wrong and every preflop stat is suspect. There will be no
-- other symptom: no error, no crash, just numbers that look reasonable and are not. That is
-- the worst failure mode an analytics product has, and it is the one users cannot detect
-- for themselves.
--
-- Returns offending rows; dbt fails the test if any come back.

select
    user_id,
    player_key,
    day,
    -- Aliases deliberately DIFFER from the source column names. Reusing `vpip_action` as an
    -- alias makes ClickHouse resolve the HAVING clause against the aggregate rather than the
    -- column, and it rejects the query as a nested aggregation.
    sum(vpip_action) as total_vpip,
    sum(pfr_action)  as total_pfr
from {{ ref('stats_daily') }}
group by user_id, player_key, day
having total_pfr > total_vpip
