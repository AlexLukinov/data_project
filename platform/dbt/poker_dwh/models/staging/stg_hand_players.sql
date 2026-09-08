-- One row per occupied seat per hand.

select
    user_id,
    hand_uid,
    played_at_utc,
    toDate(played_at_utc)   as played_date,
    seat,
    -- NULL player_key means the site anonymizes opponents (GGPoker and friends). This single
    -- field is what every opponent-stat gate keys off; see int_hand_player_flags.
    player_key,
    screen_name,
    is_hero,
    is_anonymized,
    anon_alias,
    position,
    position_index,
    starting_stack,
    starting_stack_bb,
    hole_cards,
    total_invested,
    net_won,
    net_won_bb,
    allin_equity,
    ev_won_bb,
    saw_flop,
    saw_turn,
    saw_river,
    went_to_showdown,
    won_hand
from {{ source('core', 'hand_players') }} final
