"""The one error the registry raises."""

from __future__ import annotations


class RegistryError(ValueError):
    """A registry entry, a filter or an expression is wrong. The message says where and why.

    `where` is a path -- `postflop.yaml: fold_to_cbet_flop: situation.all[1]` -- so a YAML
    author or an API caller can go straight to the offending leaf instead of reading a
    ClickHouse error about an unknown identifier.
    """
