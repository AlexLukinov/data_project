"""`decode_upload` reads the encodings hand histories are written in, whatever the file's length.

UTF-16 used to be tried second and blind, and it decodes almost any even-length byte string, so a
cp1251 file from a Russian-language client was readable or garbage depending on its size (ADR-051).
"""

from __future__ import annotations

import codecs

import pytest

from ingestion.storage import decode_upload

HEADER = "PokerStars Hand #1: Hold'em No Limit ($0.25/$0.50 USD)\nSeat 1: Игрок ($50 in chips)\n"


@pytest.mark.parametrize("padding", ["", "\n"], ids=["odd-or-even", "the-other-parity"])
def test_cp1251_reads_as_cp1251_at_either_parity(padding: str) -> None:
    data = (HEADER + padding).encode("cp1251")
    assert "Игрок" in decode_upload(data)


def test_both_parities_are_actually_exercised() -> None:
    assert {len(HEADER.encode("cp1251")) % 2, len((HEADER + "\n").encode("cp1251")) % 2} == {0, 1}


def test_utf16_with_its_byte_order_mark_is_read() -> None:
    for bom, codec in ((codecs.BOM_UTF16_LE, "utf-16-le"), (codecs.BOM_UTF16_BE, "utf-16-be")):
        assert decode_upload(bom + HEADER.encode(codec)) == HEADER


def test_utf8_with_and_without_a_bom() -> None:
    assert decode_upload(HEADER.encode("utf-8")) == HEADER
    assert decode_upload(codecs.BOM_UTF8 + HEADER.encode("utf-8")) == HEADER
