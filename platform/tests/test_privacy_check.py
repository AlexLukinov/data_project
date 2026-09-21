"""The privacy guard (ADR-058): a real screen name is found where it hides, and nowhere else.

Every name here is invented and was checked against the real key list; the guard scans this file
like any other, so a collision would fail it. No database: keys are injected.
"""

from __future__ import annotations

import io
import os
import stat
import subprocess
from pathlib import Path

import pytest

from scripts import privacy_check, privacy_match
from scripts.privacy_check import CheckError, Source, main, pushed_revs, report
from scripts.privacy_match import Matcher, reportable

KEYS = [
    "ggpoker:zqvk",
    "ggpoker:orb wizzle 9",
    "ggpoker:mr plonk zed",
    "ggpoker:wobblefritz",
    "ggpoker:qu4rk_lee",
    "ggpoker:gravelpit",
    "ggpoker:7731",
]
ZERO = "0" * 40


def found(text: str, allow: tuple[str, ...] = ()) -> list[tuple[int, str, str]]:
    return [(f.line, f.key.split(":", 1)[1], f.context) for f in Matcher(KEYS, allow).scan(text)]


@pytest.mark.parametrize(
    "line",
    [
        "Seat 2: Zqvk ($25.00 in chips)",
        "Seat 2: Zqvk (1500 in chips) is sitting out",
        "Zqvk: folds",
        "Zqvk: calls $0.53",
        "Zqvk: raises $0.38 to $0.63 and is all-in",
        "Zqvk: posts small blind $0.10",
        "Zqvk: shows [Ah Kd]",
        "Zqvk: doesn't show hand",
        "Dealt to Zqvk [Ah Kd]",
        "Dealt to Zqvk",
        "Uncalled bet ($24.37) returned to Zqvk",
        "Zqvk collected $4.77 from pot",
        "Seat 3: Zqvk (big blind) collected ($4.77)",
        "Seat 3: Zqvk (button) folded before Flop",
        "Seat 3: Zqvk showed [Qd Js] and won ($6.08)",
    ],
)
def test_a_short_name_is_found_in_every_hand_history_line(line: str) -> None:
    assert found(line) == [(1, "zqvk", "hand history")]


@pytest.mark.parametrize(
    "line",
    [
        '    "Seat 2: Zqvk ($25.00 in chips)\\n"',
        "HAND = 'Zqvk: folds\\n'",
        '{"line": "Zqvk: calls $0.53"}',
        "- Zqvk: checks",
        "+Dealt to Zqvk [Ah Kd]",
        "`Zqvk: bets $1`",
    ],
)
def test_a_hand_history_line_is_found_inside_code_and_markup(line: str) -> None:
    assert found(line) == [(1, "zqvk", "hand history")]


def test_a_name_with_spaces_is_found_whole_in_a_fixture() -> None:
    text = "Seat 6: Orb Wizzle 9 ($45.59 in chips)\nOrb Wizzle 9: folds\nMr Plonk Zed: calls $2\n"
    assert found(text) == [
        (1, "orb wizzle 9", "hand history"),
        (2, "orb wizzle 9", "hand history"),
        (3, "mr plonk zed", "hand history"),
    ]


def test_a_player_key_is_found_at_any_length_and_with_spaces() -> None:
    assert found("on `ggpoker:zqvk`'s report both cells") == [(1, "zqvk", "player key")]
    assert found("playerReport('ggpoker:Orb Wizzle 9')") == [(1, "orb wizzle 9", "player key")]
    assert found("ggpoker:zqvkx and ggpoker:zqv and xggpoker:zqvk") == []


def test_other_text_reports_a_name_by_its_shape_and_length() -> None:
    assert found("the zqvk line") == []
    assert found("met WobbleFritz today") == [(1, "wobblefritz", "text")]
    assert found("met qu4rk_lee today") == [(1, "qu4rk_lee", "text")]
    assert found("hand 7731 of the night, ggpoker 7731") == []
    assert found("mr plonk zed again") == []
    assert found('a player called "Orb Wizzle 9" won') == [(1, "orb wizzle 9", "text")]
    assert found("it's `zqvk`, isn't it") == []


def test_the_thresholds_are_the_ones_the_adr_records() -> None:
    assert (privacy_match.MIN_LETTERS, privacy_match.MIN_MIXED, privacy_match.MIN_SPACED) == (
        8,
        5,
        13,
    )
    assert reportable("abcdefgh") and not reportable("abcdefg")
    assert reportable("ab_cd") and not reportable("ab_c")
    assert reportable("abc def ghi j") and not reportable("abc def ghij")
    assert reportable("ab c", quoted=True) and reportable("a_1", quoted=True)
    assert not reportable("abcdefg", quoted=True)
    assert not reportable("12345678") and not reportable("12 345", quoted=True)


def test_a_name_inside_a_longer_token_is_not_a_match_but_one_in_brackets_is() -> None:
    assert found("xwobblefritz wobblefritzy wobblefritz_2") == []
    assert found("see [wobblefritz]!") == [(1, "wobblefritz", "text")]


def test_the_allowlist_excuses_an_ordinary_word_in_other_text_only() -> None:
    allow = ("Gravelpit",)
    assert found("the gravelpit stays open") == [(1, "gravelpit", "text")]
    assert found("the gravelpit stays open", allow) == []
    assert found("Seat 1: Gravelpit ($20 in chips)", allow) == [(1, "gravelpit", "hand history")]
    assert found("ggpoker:gravelpit", allow) == [(1, "gravelpit", "player key")]


def test_a_name_outside_the_text_alphabet_is_still_matched_where_the_context_is_exact() -> None:
    matcher = Matcher(["pokerstars:Zed.Qorv"])
    assert matcher.unmatched_in_text == 1
    hits = matcher.scan("Zed.Qorv: folds\nsaw zed.qorv\npokerstars:zed.qorv")
    assert [(f.line, f.key, f.context) for f in hits] == [
        (1, "pokerstars:Zed.Qorv", "hand history"),
        (3, "pokerstars:Zed.Qorv", "player key"),
    ]


def test_every_line_is_found_again_when_it_repeats() -> None:
    assert [f.line for f in Matcher(KEYS).scan("intro\nZqvk: folds\nmid\nZqvk: folds\n")] == [2, 4]


def test_a_matcher_refuses_nothing_to_match_and_a_malformed_key() -> None:
    with pytest.raises(ValueError, match="no player keys"):
        Matcher([])
    with pytest.raises(ValueError, match="not a player key"):
        Matcher(["wobblefritz"])


def test_a_finding_prints_the_place_and_the_key_never_the_line() -> None:
    out = io.StringIO()
    sources = [
        Source("docs/notes.md", "WobbleFritz: folds  -- WTSD 31%, WWSF 48%\n"),
        Source("old.py", "\nx = 'ggpoker:zqvk'\n", where="blob ab12ab12ab12"),
    ]
    assert report(sources, Matcher(KEYS), out) == 2
    assert out.getvalue() == (
        "docs/notes.md:1: ggpoker:wobblefritz (hand history)\n"
        "old.py:2: ggpoker:zqvk (player key) [blob ab12ab12ab12]\n"
    )


def test_pushed_revs_reads_git_pre_push_lines() -> None:
    local, pushed, unknown = "a" * 40, "b" * 40, "c" * 40
    lines = [
        f"refs/heads/x {local} refs/heads/x {pushed}\n",
        f"refs/heads/y {ZERO} refs/heads/y {pushed}\n",
        f"refs/heads/z {local} refs/heads/z {unknown}\n",
        "\n",
    ]
    revs = pushed_revs("origin", lines, lambda oid: oid == pushed)
    assert revs == [local, local, f"^{pushed}", "--not", "--remotes=origin"]
    assert pushed_revs("origin", [f"refs/heads/y {ZERO} refs/heads/y {pushed}\n"], bool) == []
    with pytest.raises(CheckError, match="not a pre-push line"):
        pushed_revs("origin", ["garbage\n"], bool)


def test_the_keys_are_read_read_only_from_the_real_core_tables(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, dict[str, int]]] = []

    class Client:
        def query(self, sql: str, settings: dict[str, int]) -> object:
            calls.append((sql, settings))
            return type("Result", (), {"result_rows": rows})()

    monkeypatch.setattr(privacy_check, "clickhouse", Client)
    rows = [("ggpoker:zqvk",)]
    assert privacy_check.real_player_keys() == ["ggpoker:zqvk"]
    sql, settings = calls[0]
    assert settings == {"readonly": 1}
    assert "FROM core.hand_players" in sql and "is_hero = 0" in sql and "test_" not in sql
    rows = []
    with pytest.raises(CheckError, match="no player keys"):
        privacy_check.real_player_keys()


def _git(repo: Path, *args: str) -> str:
    identity = [
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@example.invalid",
        "-c",
        "commit.gpgsign=false",
    ]
    done = subprocess.run(
        ["git", "-C", str(repo), *identity, *args], capture_output=True, check=True
    )
    return done.stdout.decode().strip()


@pytest.fixture
def repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A repository whose history once held a name, whose index holds another, and a binary."""
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", os.devnull)
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    _git(tmp_path, "init", "-q", "-b", "main")
    (tmp_path / "hand.txt").write_text("Zqvk: folds\n")
    (tmp_path / "blob.bin").write_bytes(b"\0Seat 1: Zqvk ($1 in chips)\n")
    _git(tmp_path, "add", ".")
    _git(tmp_path, "commit", "-q", "-m", "one")
    (tmp_path / "hand.txt").write_text("Hero: folds\n")
    _git(tmp_path, "commit", "-q", "-am", "two")
    (tmp_path / "notes.md").write_text("met qu4rk_lee\n")
    _git(tmp_path, "add", "notes.md")
    (tmp_path / "notes.md").write_text("met nobody\n")
    return tmp_path


def run(repo: Path, *args: str, stdin: str = "") -> tuple[int, str]:
    out = io.StringIO()
    status = main(
        ["--repo", str(repo), *args], keys=lambda: KEYS, stdin=io.StringIO(stdin), out=out
    )
    return status, out.getvalue()


def test_the_tree_scan_reads_tracked_files_and_the_staged_version(repo: Path) -> None:
    status, out = run(repo)
    assert status == 1
    assert out.splitlines()[0] == "notes.md:1: ggpoker:qu4rk_lee (text) [index]"
    assert "hand.txt" not in out and "blob.bin" not in out


def test_the_history_scan_finds_a_name_the_tree_no_longer_holds(repo: Path) -> None:
    status, out = run(repo, "--history", "HEAD")
    assert status == 1
    assert out.startswith("hand.txt:1: ggpoker:zqvk (hand history) [blob ")
    assert "blob.bin" not in out


def test_the_pre_push_scan_sends_only_what_the_remote_lacks(repo: Path) -> None:
    head, first = _git(repo, "rev-parse", "HEAD"), _git(repo, "rev-parse", "HEAD~1")
    assert (
        run(repo, "--pre-push", "origin", stdin=f"refs/heads/main {head} refs/heads/main {ZERO}\n")[
            0
        ]
        == 1
    )
    assert (
        run(
            repo, "--pre-push", "origin", stdin=f"refs/heads/main {head} refs/heads/main {first}\n"
        )[0]
        == 0
    )
    assert (
        run(repo, "--pre-push", "origin", stdin=f"refs/heads/main {ZERO} refs/heads/main {head}\n")[
            0
        ]
        == 0
    )


def test_nothing_checked_is_exit_2_not_a_pass(
    repo: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    def unreachable() -> list[str]:
        raise CheckError("cannot reach ClickHouse")

    assert main(["--repo", str(repo)], keys=unreachable, out=io.StringIO()) == 2
    assert "nothing was checked -- cannot reach ClickHouse" in capsys.readouterr().err


def test_the_hook_is_installed_once_and_never_over_another(repo: Path) -> None:
    assert run(repo, "--install-hook") == (0, f"installed: {repo / '.git/hooks/pre-push'}\n")
    hook = repo / ".git" / "hooks" / "pre-push"
    assert hook.stat().st_mode & stat.S_IXUSR and "privacy-check" in hook.read_text()
    assert run(repo, "--install-hook")[1].startswith("already installed")
    hook.write_text("#!/bin/sh\nexit 0\n")
    assert run(repo, "--install-hook")[0] == 2
    assert hook.read_text() == "#!/bin/sh\nexit 0\n" and os.access(hook, os.X_OK)
