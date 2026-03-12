import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import main


def test_normalize_neo4j_http_url_from_bolt_uri():
    assert main._normalize_neo4j_http_url("bolt://localhost:7687") == "http://localhost:7474"


def test_normalize_neo4j_http_url_from_secure_uri():
    assert main._normalize_neo4j_http_url("neo4j+s://graph.example.com") == "https://graph.example.com:7473"


def test_neo4j_test_connection_falls_back_to_http(monkeypatch):
    async def fake_http(req):
        return {
            "connected": True,
            "nodeCount": 3,
            "relationshipCount": 2,
            "labels": ["Rule"],
            "relationshipTypes": ["RELATES_TO"],
        }

    monkeypatch.setattr(main, "_neo4j_test_connection_via_driver", lambda req: None)
    monkeypatch.setattr(main, "_neo4j_test_connection_via_http", fake_http)

    result = asyncio.run(main.neo4j_test_connection(main.Neo4jConnectionRequest()))

    assert result["status"] == "ok"
    assert result["data"]["connected"] is True
    assert result["data"]["nodeCount"] == 3


def test_neo4j_pull_falls_back_to_http(monkeypatch):
    async def fake_http(req):
        return {
            "rules": [{"id": "r1", "_labels": ["Rule"], "_id": "1"}],
            "actions": [],
            "events": [],
            "dataobjects": [{"id": "o1", "_labels": ["Object"], "_id": "2"}],
            "links": [{"relationshipType": "REL", "sourceId": "1", "targetId": "2"}],
        }

    monkeypatch.setattr(main, "_neo4j_fetch_via_driver", lambda req: None)
    monkeypatch.setattr(main, "_neo4j_fetch_via_http", fake_http)
    monkeypatch.setattr(main, "_validate_snapshot", lambda snapshot: {"ok": True})
    monkeypatch.setattr(main, "_persist_snapshots", lambda: None)
    monkeypatch.setattr(main, "_snapshots", [])

    result = asyncio.run(main.neo4j_pull(main.Neo4jPullRequest()))

    assert result["status"] == "ok"
    assert result["data"]["rulesCount"] == 1
    assert result["data"]["dataObjectsCount"] == 1
    assert result["data"]["linksCount"] == 1
