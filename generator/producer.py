"""Emit synthetic clickstream events to Kafka at a steady rate."""
from __future__ import annotations

import json
import os
import random
import time
import uuid
from datetime import datetime, timezone

from confluent_kafka import Producer

BOOTSTRAP = os.environ.get("KAFKA_BOOTSTRAP", "platform-kafka-bootstrap:9092")
TOPIC = os.environ.get("KAFKA_TOPIC", "clickstream")
EVENTS_PER_SEC = float(os.environ.get("EVENTS_PER_SEC", "5"))

EVENT_TYPES = ("page_view", "click", "add_to_cart", "purchase", "search")
PAGES = ("/", "/catalog", "/product", "/cart", "/checkout", "/search")


def make_event() -> dict:
    """Build one clickstream event matching the ClickHouse Kafka table schema."""
    return {
        "event_id": str(uuid.uuid4()),
        "user_id": random.randint(1, 1000),
        "event_type": random.choice(EVENT_TYPES),
        "page": random.choice(PAGES),
        "ts": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
    }


def main() -> None:
    """Produce events to the clickstream topic until the process is stopped."""
    producer = Producer({"bootstrap.servers": BOOTSTRAP})
    interval = 1.0 / EVENTS_PER_SEC
    print(f"producing to {TOPIC} @ {BOOTSTRAP} ~{EVENTS_PER_SEC}/s", flush=True)
    while True:
        producer.produce(TOPIC, json.dumps(make_event()).encode())
        producer.poll(0)
        time.sleep(interval)


if __name__ == "__main__":
    main()
