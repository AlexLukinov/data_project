"""Parser exception types.

Kept narrow on purpose: the worker distinguishes "this hand is bad" (dead-letter it, keep
going) from "this whole file is the wrong format" (fail the upload).
"""

from __future__ import annotations


class ParserError(Exception):
    """Base class for every parser failure."""


class UnsupportedSiteError(ParserError):
    """No parser is registered for the requested site."""


class HandParseError(ParserError):
    """One hand could not be parsed. The file may still be fine — dead-letter this hand.

    Carries the offending text so the dead-letter record is reproducible: a parser bug you
    cannot reproduce is a parser bug you cannot fix.
    """

    def __init__(self, message: str, raw_text: str = "", line_no: int | None = None) -> None:
        """Record what failed and where."""
        super().__init__(message)
        self.raw_text = raw_text
        self.line_no = line_no


class FormatDetectionError(ParserError):
    """The text does not look like any registered format."""
