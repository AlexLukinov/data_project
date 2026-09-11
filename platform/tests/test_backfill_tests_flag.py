"""When the backfill runs the data tests, and when it defers them (plan F.10).

`dbt build` runs the models and the data tests together, and those tests scan **whole tables**
rather than the partitions a pass touched. On a chain built from empty that is cheap and grows
with it; on one that is already populated — a re-parse, or a column added by `ALTER` instead of
the `empty_chain` recreate — every pass re-scans all 73.7M rows. That cost 3.6 GiB alongside the
pass's own work and, worse, `dbt build` **skips** everything downstream of a failed test: the
anchor model never built, so no partition was ever marked clean and the loop spun with the row
budget halving after each "failure".

So `--skip-tests` builds models only and runs the tests once at the end, over the finished
chain. These tests pin exactly that, because getting it backwards is silent: the loop would
still look like it was working.
"""

from __future__ import annotations

from typing import Any

import pytest

from scripts import backfill


@pytest.fixture
def verbs(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Record the dbt verb of every invocation, and run nothing."""
    seen: list[str] = []

    def fake_dbt(
        verb: str, batch: int, anchors: Any, select: str | None, rebuild_from: int | None = None
    ) -> bool:
        seen.append(verb)
        return True

    monkeypatch.setattr(backfill, "_dbt", fake_dbt)
    return seen


def _one_pass_then_clean(monkeypatch: pytest.MonkeyPatch) -> None:
    """Dirty on the first look, clean on every look after: exactly one pass."""
    answers = iter([[(20241231, 1_000)], []])

    def pending(anchors: Any, rebuild_from: int | None = None) -> list[tuple[int, int]]:
        return next(answers, [])

    monkeypatch.setattr(backfill, "_dirty_partitions", pending)


def test_a_populated_chain_builds_models_and_tests_once_at_the_end(
    verbs: list[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    _one_pass_then_clean(monkeypatch)
    assert backfill.main(["--skip-tests"]) == 0
    assert verbs == ["run", "test"]


def test_without_the_flag_every_pass_still_builds_and_tests_together(
    verbs: list[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """The default is unchanged: a small incremental run wants its tests with it."""
    _one_pass_then_clean(monkeypatch)
    assert backfill.main([]) == 0
    assert verbs == ["build"]


def test_a_failure_of_the_final_tests_is_a_failure_of_the_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The loop cannot report success by skipping the assertion it deferred."""
    _one_pass_then_clean(monkeypatch)
    monkeypatch.setattr(backfill, "_dbt", lambda verb, *a: verb != "test")
    assert backfill.main(["--skip-tests"]) == 1
