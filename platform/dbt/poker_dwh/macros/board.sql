{#
  Board features over an array of ranks (1..13 for 2..A) or suits (one letter each).
  Used by int_board_by_street.sql for the flop, the turn and the river alike, and rendered a
  second time for the worker's hot path (scripts/hot_path_sql.py, ADR-047).

  Every classification the registry names (stats/registry/dimensions.yaml: flop_suitedness,
  flop_pairing, flop_connectivity, flop_high_card_class, turn_change, river_change) is a macro
  here rather than inline in the model, so that tests/fixtures/board_texture.json can be run
  through the SAME expressions the marts are built from
  (tests/integration/test_board_texture_fixture.py). The TypeScript twin of every rule is
  web/packages/poker-core/src/texture.ts, and the fixture is what keeps the two from drifting
  (plan H.3, ADR-083).
#}

{% macro flush_possible(suits) -%}
    toUInt8(arrayMax(arrayMap(s -> countEqual({{ suits }}, s), {{ suits }})) >= 3)
{%- endmacro %}

{#
  The distinct board ranks with the ace duplicated as rank 0, so that every window test below
  sees the ace playing low (A-2-3-4-5) as well as high.
#}
{% macro ranks_ace_low(ranks) -%}
    arrayDistinct(arrayConcat({{ ranks }},
                              arrayMap(x -> toUInt64(0), arrayFilter(x -> x = 13, {{ ranks }}))))
{%- endmacro %}

{#
  How many board cards take part in the best straight: the most distinct board ranks inside any
  one five-card window (A2345 through TJQKA). Three means some two-card holding has a straight,
  four means a one-card straight, five means the straight is on the board.
#}
{% macro straight_cards(ranks) -%}
    arrayMax(arrayMap(
        l -> arrayCount(x -> x >= l and x <= l + 4, {{ ranks_ace_low(ranks) }}),
        range(toUInt64(0), toUInt64(10))
    ))
{%- endmacro %}

{#
  Three board cards inside one five-card window make a straight possible: some two-card holding
  already has a made straight.
#}
{% macro straight_possible(ranks) -%}
    toUInt8({{ straight_cards(ranks) }} >= 3)
{%- endmacro %}

{#
  Two board ranks inside one four-card window OPEN AT BOTH ENDS make an open-ended straight
  draw possible for some two-card holding. `range(1, 10)` is the whole decision: it admits the
  windows 2345 through TJQK and excludes A234 and JQKA, which complete at one end only and are
  therefore gutshots, not open-enders (ADR-075).
#}
{% macro oesd_possible(ranks) -%}
    toUInt8(arrayExists(
        l -> arrayCount(x -> x >= l and x <= l + 3, {{ ranks_ace_low(ranks) }}) >= 2,
        range(toUInt64(1), toUInt64(10))
    ))
{%- endmacro %}

{# ---- the flop, one macro per registry dimension ------------------------------------------ #}

{% macro flop_suitedness(suits) -%}
    multiIf(
        {{ suits }}[1] = {{ suits }}[2] and {{ suits }}[2] = {{ suits }}[3], 'monotone',
        {{ suits }}[1] = {{ suits }}[2] or {{ suits }}[2] = {{ suits }}[3] or {{ suits }}[1] = {{ suits }}[3], 'two_tone',
        'rainbow'
    )
{%- endmacro %}

{% macro flop_pairing(ranks) -%}
    multiIf(
        {{ ranks }}[1] = {{ ranks }}[2] and {{ ranks }}[2] = {{ ranks }}[3], 'trips',
        {{ ranks }}[1] = {{ ranks }}[2] or {{ ranks }}[2] = {{ ranks }}[3] or {{ ranks }}[1] = {{ ranks }}[3], 'paired',
        'unpaired'
    )
{%- endmacro %}

{#
  What a two-card holding can already make or draw to (ADR-075): a made straight is
  `connected`, an open-ended draw with no made straight is `oesd`, anything else is
  `disconnected`. A paired flop has two ranks and can never be connected; trips has one and is
  never even an OESD.
#}
{% macro flop_connectivity(ranks) -%}
    multiIf(
        {{ straight_possible(ranks) }} = 1, 'connected',
        {{ oesd_possible(ranks) }} = 1, 'oesd',
        'disconnected'
    )
{%- endmacro %}

{#
  The highest flop rank in five classes balanced on the real corpus (ADR-075 §4): ace 21%,
  king or queen 34%, jack or ten 22%, nine to seven 18%, six and below 5.4%.
#}
{% macro flop_high_card_class(ranks) -%}
    multiIf(
        arrayMax({{ ranks }}) = 13, 'ace',
        arrayMax({{ ranks }}) >= 11, 'king_queen',
        arrayMax({{ ranks }}) >= 9, 'jack_ten',
        arrayMax({{ ranks }}) >= 6, 'middle',
        'low'
    )
{%- endmacro %}

{# ---- a later street: what the one new card changed (ADR-082) ----------------------------- #}

{#
  One class per card, the FIRST that applies, in this order of precedence:

    <prefix>_flush       at least two of its suit were already on the board: a flush is now
                         made with this card (the third, fourth or fifth of a suit)
    <prefix>_straight    the card takes part in a straight that needs fewer hole cards than
                         before: `straight_cards` reaches three (a two-card straight), rises
                         to four (a one-card straight) or to five (the straight is on the board)
    <prefix>_pair        its rank was already on the board
    <prefix>_flush_draw  exactly one of its suit was already on the board (the turn only: on
                         the river there is no card to come, so a draw is nothing)
    <prefix>_overcard    above every earlier board card
    <prefix>_blank       none of the above

  Made hands before draws, draws before an overcard, and among the made hands the order of the
  hand rankings (a flush beats a straight beats a pair): the class names the strongest thing
  the card made. "Made" is measured against the board before it: a card of a suit that was
  already there twice makes flushes whatever the count, so a fourth heart is a flush card; a
  card that merely joins a window the board already filled to the same depth (a king on 9-8-7)
  made no straight cheaper and is judged by the rules below it (ADR-082).

  `before_ranks` / `before_suits` are the board BEFORE this card; `rank` / `suit` are the card.
#}
{% macro street_change(before_ranks, before_suits, rank, suit, prefix, draws) -%}
    multiIf(
        countEqual({{ before_suits }}, {{ suit }}) >= 2, '{{ prefix }}_flush',
        {{ straight_cards('arrayConcat(' ~ before_ranks ~ ', [' ~ rank ~ '])') }} >= 3
            and {{ straight_cards('arrayConcat(' ~ before_ranks ~ ', [' ~ rank ~ '])') }}
                > {{ straight_cards(before_ranks) }}, '{{ prefix }}_straight',
        has({{ before_ranks }}, {{ rank }}), '{{ prefix }}_pair',
        {%- if draws %}
        countEqual({{ before_suits }}, {{ suit }}) = 1, '{{ prefix }}_flush_draw',
        {%- endif %}
        {{ rank }} > arrayMax({{ before_ranks }}), '{{ prefix }}_overcard',
        '{{ prefix }}_blank'
    )
{%- endmacro %}
