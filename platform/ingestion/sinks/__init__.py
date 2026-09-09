"""Storage and transport behind Protocols (docs/POKER_DECISIONS.md ADR-023).

Three seams, each with one real implementation and one fake:

    HandSink   -> ClickHouseHandSink / FakeHandSink     the canonical tables + dead letters
    RawStore   -> S3RawStore         / FakeRawStore     raw hand text, the source of truth
    EventBus   -> KafkaBus           / FakeBus          upload pointers

Callers above `ingestion` (the API, scripts) build the real ones through the factories below
and never import the implementation modules -- `.importlinter` enforces it -- so swapping a
backend is a change in one module, and every unit of ingestion logic can run against a fake
with no stack.
"""

from __future__ import annotations

from ingestion.sinks.clickhouse import ClickHouseHandSink
from ingestion.sinks.fakes import FakeBus, FakeHandSink, FakeRawStore
from ingestion.sinks.kafka import KafkaBus
from ingestion.sinks.protocols import EventBus, HandSink, RawStore
from ingestion.sinks.s3 import S3RawStore

__all__ = [
    "ClickHouseHandSink",
    "EventBus",
    "FakeBus",
    "FakeHandSink",
    "FakeRawStore",
    "HandSink",
    "KafkaBus",
    "RawStore",
    "S3RawStore",
    "event_bus",
    "hand_sink",
    "raw_store",
]


def hand_sink() -> HandSink:
    """The process's real hand sink: ClickHouse, via the shared client."""
    return ClickHouseHandSink()


def raw_store() -> RawStore:
    """The process's real raw store: S3-compatible object storage from settings."""
    return S3RawStore()


def event_bus() -> EventBus:
    """The process's real event bus: Kafka from settings."""
    return KafkaBus()
