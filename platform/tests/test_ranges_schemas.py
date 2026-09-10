"""The range library's request models: the weights text is the one thing the server checks."""

from __future__ import annotations

import re

import pytest
from pydantic import ValidationError

from api.schemas_ranges import COMBO_COUNT, BulkIn, RangeIn, RangeUpdate, check_weights

NODE = {"hero_position": "UTG", "action_sequence": [{"position": "UTG", "action": "raise"}]}


def _range(weights: str, **extra: object) -> dict[str, object]:
    return {"name": "UTG RFI", "node_key": NODE, "weights": weights, **extra}


def test_canonical_combo_text_is_accepted() -> None:
    text = "AsAh: 1,AsKh: 0.5,Tc9d: 1.005,2d2c: 1e-3"
    assert check_weights(text) == text
    assert RangeIn.model_validate(_range(text)).weights == text
    assert RangeIn.model_validate(_range("")).weights == ""


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ("AA: 1", "entry 1 ('AA: 1') is not combo notation"),
        ("AsKh: 1,AKs: 0.5", "entry 2 ('AKs: 0.5') is not combo notation"),
        ("AsKh:1", "entry 1"),
        ("AsKh: 1, AsKd: 1", "entry 2 (' AsKd: 1')"),
        ("AsKh: -1", "entry 1"),
        ("AsKh", "entry 1"),
    ],
)
def test_anything_else_is_rejected_with_the_entry_number(text: str, message: str) -> None:
    with pytest.raises(ValueError, match=re.escape(message)):
        check_weights(text)
    with pytest.raises(ValidationError, match="entry"):
        RangeIn.model_validate(_range(text))


def test_more_entries_than_combos_is_rejected() -> None:
    too_many = ",".join(["AsKh: 1"] * (COMBO_COUNT + 1))
    with pytest.raises(ValueError, match="at most 1326 combos"):
        check_weights(too_many)


def test_range_in_fills_defaults_and_bounds_tags() -> None:
    body = RangeIn.model_validate(_range("AsKh: 1"))
    assert (body.source, body.format, body.tags, body.note) == ("own", "combo", [], "")
    assert body.node_key.canonical()["eff_stack_bb"] == 100
    with pytest.raises(ValidationError):
        RangeIn.model_validate(_range("AsKh: 1", source="gto"))
    with pytest.raises(ValidationError):
        RangeIn.model_validate(_range("AsKh: 1", tags=[""]))
    with pytest.raises(ValidationError):
        RangeIn.model_validate(_range("AsKh: 1", tags=["t"] * 21))


def test_update_is_all_optional_and_bulk_is_bounded() -> None:
    assert RangeUpdate().weights is None
    assert RangeUpdate(weights="AsKh: 1", note="edited").note == "edited"
    with pytest.raises(ValidationError):
        RangeUpdate(weights="AKs: 1")
    with pytest.raises(ValidationError):
        BulkIn(ranges=[])
    bulk = BulkIn.model_validate({"ranges": [_range("AsKh: 1")]})
    assert bulk.on_conflict == "version"
