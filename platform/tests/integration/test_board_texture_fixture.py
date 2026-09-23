"""The board-texture fixture, run through the dbt SQL the marts are built from (plan H.3).

`tests/fixtures/board_texture.json` is parsed by two suites: `poker-core/test/texture.test.ts`
runs its boards through `textureTags()`, and this file runs them through
`models/intermediate/int_board_by_street.sql` with `macros/board.sql` -- rendered the way the
hot path renders it (ADR-047), with the staging view replaced by the fixture's boards. A Python
re-implementation of the rules would be a third copy; the SQL itself is what must agree.

Integration because it needs a ClickHouse to evaluate the expressions; it reads no table.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from jinja2 import Environment, StrictUndefined

from ingestion.clickhouse import clickhouse
from scripts.hot_path_sql import BOARD_MODEL, PROJECT

pytestmark = pytest.mark.integration

FIXTURE = Path(__file__).resolve().parent.parent / "fixtures" / "board_texture.json"
COLUMNS = (
    "flop_suitedness",
    "flop_pairing",
    "flop_connectivity",
    "flop_high_card_class",
    "turn_change",
    "river_change",
)
BOARDS_PARAM = "{boards:Array(Array(String))}"

STG_HANDS_STUB = (
    "(select toUInt32(1) as user_id, idx as hand_uid, now() as played_at_utc,"
    " now64(3) as src_parsed_at, b[1] as board_flop_1, b[2] as board_flop_2,"
    " b[3] as board_flop_3, b[4] as board_turn, b[5] as board_river"
    f" from (select arrayJoin(arrayEnumerate({BOARDS_PARAM})) as idx, {BOARDS_PARAM}[idx] as b))"
)
"""What `ref('stg_hands')` becomes: one row per fixture board, indexed by its position in the
fixture. An index past the board's length reads '' -- exactly how a hand with no turn is stored."""


def render_board_model() -> str:
    """The board model's SQL over the fixture, with dbt's three stubs replaced."""
    env = Environment(undefined=StrictUndefined, autoescape=False)
    env.globals.update(
        ref=lambda name: STG_HANDS_STUB if name == "stg_hands" else _refuse(name),
        config=lambda **_: "",
        dirty_partitions=lambda column: "1",
    )
    macros = (PROJECT / "macros" / "board.sql").read_text()
    model = (PROJECT / BOARD_MODEL).read_text()
    return env.from_string(macros + "\n" + model).render().strip()


def _refuse(name: str) -> str:
    raise ValueError(f"the board model must not ref({name!r})")


def _fixture() -> dict[str, Any]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))  # type: ignore[no-any-return]


def tags_by_board(boards: list[list[str]]) -> dict[int, list[str]]:
    """Fixture index -> the tags the SQL gives that board ('' columns dropped)."""
    sql = f"select hand_uid, {', '.join(COLUMNS)} from ({render_board_model()}) order by hand_uid"
    rows = clickhouse().query(sql, parameters={"boards": boards}).result_rows
    return {int(row[0]): [value for value in row[1:] if value != ""] for row in rows}


def test_the_sql_agrees_with_the_fixture_on_every_board() -> None:
    fixture = _fixture()
    assert list(fixture["dimensions"]) == list(COLUMNS)
    cases = fixture["boards"]
    got = tags_by_board([case["board"] for case in cases])
    disagreements = []
    for index, case in enumerate(cases, start=1):
        expected = case["tags"]
        if not case["board"]:
            assert index not in got, "a hand with no flop has no row"
            continue
        if got.get(index) != expected:
            disagreements.append(f"{' '.join(case['board'])}: sql {got.get(index)} != {expected}")
    assert not disagreements, "\n".join(disagreements)
