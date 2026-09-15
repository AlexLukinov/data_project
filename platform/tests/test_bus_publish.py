"""A pointer counts as published only when the broker acknowledged that pointer (ADR-051).

`Producer.flush()`'s return used to be ignored, so a broker outage answered 202 and left the upload
`queued` for ever; and `flush()` counts every message in the process-wide producer, so reading it
would fail one upload for another's stuck pointer. Success is now the pointer's own delivery report.
"""

from __future__ import annotations

from collections.abc import Callable

import pytest

from ingestion import bus
from ingestion.messages import PublishError, UploadMessage

MESSAGE = UploadMessage(
    upload_id="u", tenant_id=1, site="pokerstars", object_key="k", sha256="", hero_names=[]
)
Report = Callable[[object, object], None]
REAL_ACK_WAIT = bus.ACK_WAIT_SECONDS


class _Producer:
    """Answers each `produce` with `outcome` on the next poll: None (acked), an error, silence."""

    SILENT = object()

    def __init__(self, outcome: object) -> None:
        self.outcome = outcome
        self.produced: list[str] = []
        self._pending: list[Report] = []

    def produce(self, topic: str, key: bytes, value: bytes, on_delivery: Report) -> None:
        self.produced.append(topic)
        self._pending.append(on_delivery)

    def poll(self, timeout: float) -> int:
        if self.outcome is self.SILENT:
            return 0
        served = len(self._pending)
        for report in self._pending:
            report(self.outcome, None)
        self._pending.clear()
        return served


@pytest.fixture(autouse=True)
def _short_wait(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(bus, "ACK_WAIT_SECONDS", 0.3)
    monkeypatch.setattr(bus, "POLL_STEP_SECONDS", 0.01)


def test_a_pointer_the_broker_timed_out_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(bus, "producer", lambda: _Producer("Local: Message timed out"))
    with pytest.raises(PublishError, match="not delivered"):
        bus.publish_upload(MESSAGE)


def test_a_pointer_nobody_reported_on_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(bus, "producer", lambda: _Producer(_Producer.SILENT))
    with pytest.raises(PublishError, match="no delivery report"):
        bus.publish_upload(MESSAGE)


def test_an_acknowledged_pointer_goes_to_its_topic(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _Producer(None)
    monkeypatch.setattr(bus, "producer", lambda: fake)
    bus.publish_upload(MESSAGE)
    bus.publish_upload(MESSAGE, bulk=True)
    settings = bus.get_settings()
    assert fake.produced == [settings.kafka_uploads_topic, settings.kafka_bulk_topic]


def test_the_producer_gives_up_on_a_pointer_before_the_api_stops_waiting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Otherwise librdkafka retries for five minutes and delivers a pointer reported as not sent."""
    configs: list[dict[str, object]] = []
    monkeypatch.setattr(bus, "_producer", None)
    monkeypatch.setattr(bus, "Producer", lambda config: configs.append(config) or object())
    bus.producer()
    (config,) = configs
    timeout_ms = config["message.timeout.ms"]
    assert isinstance(timeout_ms, int) and timeout_ms / 1000 < REAL_ACK_WAIT
