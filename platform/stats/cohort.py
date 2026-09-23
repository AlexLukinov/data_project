"""Cohorts outside the report path: how many pool players a `CohortSpec` names (plan §2.8).

Inside a report the cohort is a predicate (`stats.query.cohort_subquery`); this answers the
one question a report cannot -- the size of the set -- through the same subquery, so the
count and the reports always agree on who is a member.
"""

from __future__ import annotations

from typing import Any

from stats import tenancy
from stats.compiler import Params
from stats.query import cohort_subquery
from stats.registry import Registry, registry
from stats.request import DATASET_POPULATION, Cohort
from stats.service import Runner


def cohort_size_query(spec: Cohort, tenant_id: int, reg: Registry) -> tuple[str, dict[str, Any]]:
    """(sql, parameters) counting the cohort's members for one tenant."""
    params = Params()
    members = cohort_subquery(spec, reg, params)
    scalars: dict[str, Any] = {"tenant_id": tenant_id, "dataset": DATASET_POPULATION}
    return f"SELECT count() AS players FROM ({members})", {**scalars, **params.values}


def cohort_size(
    spec: Cohort, tenant_id: int, *, run: Runner | None = None, reg: Registry | None = None
) -> int:
    """How many players meet every rule of the cohort."""
    runner = run or tenancy.runner_for(tenant_id)
    _, rows = runner(*cohort_size_query(spec, tenant_id, reg or registry()))
    return int(rows[0][0]) if rows else 0
