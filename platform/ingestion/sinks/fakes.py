"""In-memory sinks for unit tests. They record what they were given and nothing else."""

from __future__ import annotations

from dataclasses import dataclass, field

from core.models import CanonicalHand
from ingestion.messages import UploadMessage


@dataclass
class FakeHandSink:
    """Records every insert as (hands, tenant_id, dataset) and every dead-letter row."""

    inserts: list[tuple[list[CanonicalHand], int, str]] = field(default_factory=list)
    failures: list[list[object]] = field(default_factory=list)

    def insert_hands(
        self, hands: list[CanonicalHand], tenant_id: int, dataset: str
    ) -> dict[str, int]:
        """Record the batch; counts mirror the real sink's shape."""
        self.inserts.append((list(hands), tenant_id, dataset))
        return {
            "hands": len(hands),
            "hand_players": sum(len(h.players) for h in hands),
            "actions": sum(len(h.actions) for h in hands),
            "pot_winners": sum(len(h.pot_winners) for h in hands),
        }

    def record_failures(self, rows: list[list[object]]) -> None:
        """Keep the dead letters."""
        self.failures.extend(rows)

    @property
    def hands(self) -> list[CanonicalHand]:
        """Every hand stored, across batches, in order."""
        return [hand for batch, _, _ in self.inserts for hand in batch]


@dataclass
class FakeRawStore:
    """A dict of key -> text. `put` stores bytes decoded as UTF-8."""

    objects: dict[str, str] = field(default_factory=dict)

    def put(self, key: str, data: bytes) -> int:
        """Store; returns the byte count."""
        self.objects[key] = data.decode("utf-8")
        return len(data)

    def get(self, key: str) -> str:
        """Fetch; KeyError if never stored."""
        return self.objects[key]


@dataclass
class FakeBus:
    """Records every published pointer as (message, bulk)."""

    published: list[tuple[UploadMessage, bool]] = field(default_factory=list)

    def publish_upload(self, message: UploadMessage, *, bulk: bool = False) -> None:
        """Record."""
        self.published.append((message, bulk))
