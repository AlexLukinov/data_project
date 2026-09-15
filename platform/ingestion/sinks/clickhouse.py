"""`HandSink` on ClickHouse: the canonical `core.*` tables plus the dead-letter table."""

from __future__ import annotations

from clickhouse_connect.driver.client import Client

from core.models import CanonicalHand
from core.settings import get_settings
from ingestion.clickhouse import clickhouse
from ingestion.hot_path import derive_batch
from ingestion.loader import batch_stamp, insert_hands
from ingestion.sinks.protocols import PARSE_FAILURE_COLUMNS


class ClickHouseHandSink:
    """Writes to the process-wide ClickHouse client unless one is injected.

    With `hot_path` (the default, and what the worker uses) every batch is also derived into
    `marts.decisions` and `marts.player_hands` right after the core insert, so the rollup's
    materialized view fires and the upload is in stats without a dbt run (ADR-047). The bulk
    importer and the re-parse pass `hot_path=False`: they are followed by `scripts.backfill`,
    which derives everything anyway, and a 9M-hand import would otherwise run the derivation
    once per 5,000-hand batch for nothing.
    """

    def __init__(self, client: Client | None = None, *, hot_path: bool = True) -> None:
        """Wrap `client`, or the shared process client when none is given."""
        self._client = client
        self.hot_path = hot_path

    @property
    def client(self) -> Client:
        """The client, resolved lazily so constructing the sink opens no connection."""
        if self._client is None:
            self._client = clickhouse()
        return self._client

    def insert_hands(
        self, hands: list[CanonicalHand], tenant_id: int, dataset: str
    ) -> dict[str, int]:
        """Batched insert into every core table, then the hot path for the same batch.

        One stamp for both: the hot path finds the batch in `core.*` by the `parsed_at` the
        core insert wrote, so the two must be the same value to the millisecond.
        """
        stamp = batch_stamp()
        counts = insert_hands(self.client, hands, tenant_id, dataset, parsed_at=stamp)
        if self.hot_path and hands:
            counts.update(derive_batch(self.client, hands, tenant_id, stamp))
        return counts

    def record_failures(self, rows: list[list[object]]) -> None:
        """Write dead-letter rows.

        This table is a product backlog, not an error log: every row is a parser bug with a
        reproducible input attached. Review it weekly; it drives the parser roadmap better
        than guessing which network to support next.
        """
        if not rows:
            return
        table = f"{get_settings().db('core')}.parse_failures"
        self.client.insert(table, rows, column_names=list(PARSE_FAILURE_COLUMNS))
