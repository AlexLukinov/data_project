"""What an uploaded file is, decided before anything is stored (plan D.8, ADR-051).

Every refusal is a sentence the upload page shows as it is, so these tests pin the words, not
only the status. No stack: `inspect` touches nothing but the parser registry.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from api import upload_intake
from api.upload_intake import EMPTY, UNDETECTED, ZIP, inspect
from core.enums import Site

LIMIT = 1024 * 1024


def _refusal(data: bytes, site: str = "", limit: int = LIMIT) -> HTTPException:
    with pytest.raises(HTTPException) as caught:
        inspect(data, "hh.txt", site, limit)
    return caught.value


def test_an_empty_file_is_refused() -> None:
    refusal = _refusal(b"")
    assert (refusal.status_code, refusal.detail) == (400, EMPTY)


def test_a_file_over_the_limit_is_told_the_limit() -> None:
    refusal = _refusal(b"x" * (2 * LIMIT + 1), limit=2 * LIMIT)
    assert refusal.status_code == 413
    assert refusal.detail == "The file is larger than 2 MB. Split it and upload the parts."


def test_a_zip_archive_is_told_to_be_unzipped(stars_cash_text: str) -> None:
    refusal = _refusal(b"PK\x03\x04" + stars_cash_text.encode(), site="pokerstars")
    assert (refusal.status_code, refusal.detail) == (415, ZIP)


def test_an_unknown_site_names_the_supported_ones(stars_cash_text: str) -> None:
    refusal = _refusal(stars_cash_text.encode(), site="winamax")
    assert refusal.status_code == 400
    assert refusal.detail == "Unknown site 'winamax'. Supported: ggpoker, pokerstars."


def test_a_declared_site_the_text_contradicts_is_refused(gg_text: str) -> None:
    """The mislabelling that used to store zero hands as a `completed` upload."""
    refusal = _refusal(gg_text.encode(), site="pokerstars")
    assert refusal.status_code == 422
    assert refusal.detail == (
        "This file does not look like a pokerstars hand history. "
        "Choose the right site, or let the site be detected."
    )


def test_text_no_parser_recognises_asks_for_the_site() -> None:
    refusal = _refusal(b"just some notes about last night's session\n")
    assert (refusal.status_code, refusal.detail) == (422, UNDETECTED)


def test_the_site_is_detected_when_not_given(gg_text: str, stars_cash_text: str) -> None:
    assert inspect(gg_text.encode(), "a.txt", "", LIMIT).site is Site.GGPOKER
    assert inspect(stars_cash_text.encode(), "b.txt", "", LIMIT).site is Site.POKERSTARS


def test_a_declared_site_the_text_agrees_with_is_kept(stars_cash_text: str) -> None:
    incoming = inspect(stars_cash_text.encode(), "hh.txt", "pokerstars", LIMIT)
    assert incoming.site is Site.POKERSTARS
    assert incoming.filename == "hh.txt" and len(incoming.digest) == 64


def test_a_file_over_the_bulk_threshold_takes_the_bulk_topic(
    stars_cash_text: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    data = stars_cash_text.encode()
    assert not inspect(data, "hh.txt", "", LIMIT).is_bulk
    monkeypatch.setattr(upload_intake, "BULK_THRESHOLD_BYTES", len(data) - 1)
    assert inspect(data, "hh.txt", "", LIMIT).is_bulk


def test_a_preamble_hides_the_site_from_detection_but_not_from_a_chosen_site(
    stars_cash_text: str,
) -> None:
    """Detection reads the start of the file; a chosen site is checked against every line."""
    data = ("\r\n" + stars_cash_text).encode()
    refusal = _refusal(data)
    assert (refusal.status_code, refusal.detail) == (422, UNDETECTED)
    assert inspect(data, "hh.txt", "pokerstars", LIMIT).site is Site.POKERSTARS
    assert _refusal(data, site="ggpoker").status_code == 422, "the other site still refused"
