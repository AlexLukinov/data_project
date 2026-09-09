"""`HandSink` on ClickHouse: the canonical `core.*` tables plus the dead-letter table."""

from __future__ import annotations

from clickhouse_connect.driver.client import Client

from core.models import CanonicalHand
from ingestion.clickhouse import clickhouse
from ingestion.loader import insert_hands
from ingestion.sinks.protocols import PARSE_FAILURE_COLUMNS


class ClickHouseHandSink:
    """Writes to the process-wide ClickHouse client unless one is injected."""

    def __init__(self, client: Client | None = None) -> None:
        """Wrap `client`, or the shared process client when none is given."""
        self._client = client

    @property
    def client(self) -> Client:
        """The client, resolved lazily so constructing the sink opens no connection."""
        if self._client is None:
            self._client = clickhouse()
        return self._client

    def insert_hands(
        self, hands: list[CanonicalHand], tenant_id: int, dataset: str
    ) -> dict[str, int]:
        """Batched insert into every core table (see `ingestion.loader.insert_hands`)."""
        return insert_hands(self.client, hands, tenant_id, dataset)

    def record_failures(self, rows: list[list[object]]) -> None:
        """Write dead-letter rows.

        This table is a product backlog, not an error log: every row is a parser bug with a
        reproducible input attached. Review it weekly; it drives the parser roadmap better
        than guessing which network to support next.
        """
        if not rows:
            return
        self.client.insert("core.parse_failures", rows, column_names=list(PARSE_FAILURE_COLUMNS))
