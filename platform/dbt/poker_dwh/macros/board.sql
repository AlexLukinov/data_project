{#
  Board features over an array of ranks (1..13 for 2..A) or suits (one letter each).
  Used by int_board_by_street.sql for the flop, the turn and the river alike.
#}

{% macro flush_possible(suits) -%}
    toUInt8(arrayMax(arrayMap(s -> countEqual({{ suits }}, s), {{ suits }})) >= 3)
{%- endmacro %}

{#
  Three board cards inside one five-card window make a straight possible. The ace also plays
  low (A-2-3-4-5), so rank 13 is added again as 0 before the windows are tried.
#}
{% macro straight_possible(ranks) -%}
    toUInt8(arrayExists(
        l -> arrayCount(x -> x >= l and x <= l + 4,
                        arrayDistinct(arrayConcat({{ ranks }},
                                                  arrayMap(x -> toUInt64(0),
                                                           arrayFilter(x -> x = 13, {{ ranks }}))))) >= 3,
        range(toUInt64(0), toUInt64(10))
    ))
{%- endmacro %}
