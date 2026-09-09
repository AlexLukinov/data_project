-- One row per decision. The largest table in the system and the one all stat logic reads.

select
    user_id,
    hand_uid,
    played_at_utc,
    toDate(played_at_utc)         as played_date,
    -- GLOBAL order within the hand, not per-street: stat logic constantly asks "did anyone
    -- raise BEFORE this player acted", which a per-street counter cannot answer.
    action_index,
    toString(street)              as street,
    seat,
    toString(action_type)         as action_type,
    amount,
    amount_to,
    pot_before,
    to_call,
    is_allin,
    -- Blind and ante posts move chips but are NOT voluntary. This one flag is why VPIP is
    -- correct rather than "every hand you were dealt in".
    is_voluntary,
    action_type in ('fold', 'check', 'call', 'bet', 'raise') as is_decision,
    -- Ingestion watermark, not a business timestamp. Every incremental model downstream
    -- carries max(src_parsed_at) forward and compares it against core.hands.parsed_at to
    -- decide which month partitions need rebuilding -- see macros/incremental.sql.
    parsed_at                     as src_parsed_at
from {{ source('core', 'actions') }} final
