import pytest

from storyteller import tools


def test_fright_meter_kids_is_cozy():
    assert tools.fright_meter("kids are listening") == "1"


def test_fright_meter_bounds():
    assert tools.fright_meter("brave") == "4"
    assert 1 <= int(tools.fright_meter("hmm")) <= 5


def test_title_card_clamps_and_uppercases():
    card = tools.title_card("the lamp", 99)
    assert "THE LAMP" in card and "nightmare" in card


def test_save_story_slugs_and_stays_inside(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    p = tools.save_story("../../etc/Passwd Boo!", "text")
    assert p.startswith(str((tmp_path / "stories").resolve()))
    assert (tmp_path / "stories" / "etc-passwd-boo.md").read_text().startswith("# ../../etc/Passwd Boo!")


def test_crypt_keeper_mcp_wiring():
    """Starts the real MCP server via the app's client (no LLM needed)."""
    from storyteller.agent import DEFAULT_CRYPT, crypt_client

    if not DEFAULT_CRYPT.exists():
        pytest.skip("build crypt-keeper-mcp first: npm install && npm run build")
    with crypt_client() as c:
        names = {t.tool_name for t in c.list_tools_sync()}
    assert {"story_seed", "random_curse", "haunted_location"} <= names
