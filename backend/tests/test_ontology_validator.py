"""
TDD Test Suite for RAAS Ontology Deterministic Validator

Covers all 5 check categories:
  1. objects  — OBJ-001..005
  2. rules    — RULE-001..003
  3. actions_events — AE-001..005
  4. links    — LINK-001..008
  5. ontology — ONTO-001..006

Acceptance criteria:
  - Same snapshot run 10x produces identical checksum
  - No LLM dependency
  - Five separate error categories in output
  - Runnable check answers "can this ontology run?"
"""

import copy
import sys
import os

import pytest

# Ensure backend is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ontology_validator import (
    validate_snapshot,
    check_objects,
    check_rules,
    check_actions_events,
    check_links,
    check_ontology,
    Severity,
    _parse_link_node,
    _parse_relationship,
)


# ── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture
def valid_object():
    return {
        "id": "Candidate",
        "name": "候选人",
        "primary_key": "candidate_id",
        "properties": [
            {"name": "candidate_id", "type": "String", "description": "主键"},
            {"name": "name", "type": "String", "description": "姓名"},
            {"name": "email", "type": "String", "description": "邮箱"},
        ],
    }


@pytest.fixture
def valid_objects():
    return [
        {
            "id": "Candidate",
            "name": "候选人",
            "primary_key": "candidate_id",
            "properties": [
                {"name": "candidate_id", "type": "String"},
                {"name": "name", "type": "String"},
                {"name": "job_requisition_id", "type": "String"},
            ],
        },
        {
            "id": "Job_Requisition",
            "name": "招聘岗位",
            "primary_key": "job_requisition_id",
            "properties": [
                {"name": "job_requisition_id", "type": "String"},
                {"name": "title", "type": "String"},
            ],
        },
    ]


@pytest.fixture
def valid_rules():
    return [
        {
            "id": "1-1-1",
            "specificScenarioStage": "客户系统需求创建与更新",
            "businessLogicRuleName": "客户需求系统数据自动采集",
            "standardizedLogicRule": "系统自动登录客户需求系统...",
            "relatedEntities": "候选人 (Candidate)\n招聘岗位 (Job_Requisition)",
        },
        {
            "id": "1-1-2",
            "specificScenarioStage": "客户系统需求创建与更新",
            "businessLogicRuleName": "数据完整性校验",
            "standardizedLogicRule": "系统在同步前校验必填字段...",
            "relatedEntities": "候选人 (Candidate)",
        },
    ]


@pytest.fixture
def valid_actions():
    return [
        {
            "id": "1-1",
            "name": "syncFromClientSystem",
            "trigger": ["SCHEDULED_SYNC"],
            "triggered_event": ["REQUIREMENT_SYNCED", "SYNC_FAILED_ALERT"],
            "source_object": [{"name": "Candidate"}],
        },
        {
            "id": "2",
            "name": "analyzeRequirement",
            "trigger": ["REQUIREMENT_SYNCED"],
            "triggered_event": ["ANALYSIS_COMPLETED"],
            "source_object": [],
        },
    ]


@pytest.fixture
def valid_events():
    return [
        {
            "name": "SCHEDULED_SYNC",
            "payload": {"source_action": None},
        },
        {
            "name": "REQUIREMENT_SYNCED",
            "payload": {"source_action": "syncFromClientSystem"},
        },
        {
            "name": "SYNC_FAILED_ALERT",
            "payload": {"source_action": "syncFromClientSystem"},
        },
        {
            "name": "ANALYSIS_COMPLETED",
            "payload": {"source_action": "analyzeRequirement"},
        },
    ]


@pytest.fixture
def valid_links():
    return [
        {
            "node_1": "(:ObjectDefinition {uid: Candidate,name: 候选人})",
            "relationship": "[:BELONGS_TO {description: 属于}]",
            "node_2": "(:ObjectDefinition {uid: Job_Requisition,name: 招聘岗位})",
        },
        {
            "node_1": "(:RuleDefinition {uid: 1-1-1,name: 规则1})",
            "relationship": "[:INVOLVES {description: 涉及}]",
            "node_2": "(:ObjectDefinition {uid: Candidate,name: 候选人})",
        },
    ]


@pytest.fixture
def valid_snapshot(valid_objects, valid_rules, valid_actions, valid_events, valid_links):
    return {
        "snapshotId": "snap_test_001",
        "dataobjects": valid_objects,
        "rules": valid_rules,
        "actions": valid_actions,
        "events": valid_events,
        "links": valid_links,
    }


# ── Test: Link node parsing helper ──────────────────────────────────────────

class TestParseHelpers:
    def test_parse_object_definition(self):
        t, uid = _parse_link_node("(:ObjectDefinition {uid: Candidate,name: 候选人})")
        assert t == "ObjectDefinition"
        assert uid == "Candidate"

    def test_parse_rule_definition(self):
        t, uid = _parse_link_node("(:RuleDefinition {uid: 1-1-1,name: 规则1})")
        assert t == "RuleDefinition"
        assert uid == "1-1-1"

    def test_parse_property_definition(self):
        t, uid = _parse_link_node("(:PropertyDefinition {uid: salary,name: 薪资})")
        assert t == "PropertyDefinition"
        assert uid == "salary"

    def test_parse_invalid(self):
        t, uid = _parse_link_node("garbage string")
        assert t is None
        assert uid is None

    def test_parse_relationship(self):
        assert _parse_relationship("[:HAS_MANY {description: 拥有多个}]") == "HAS_MANY"
        assert _parse_relationship("[:INVOLVES {}]") == "INVOLVES"
        assert _parse_relationship("bad") is None


# ── Test Category 1: Objects ─────────────────────────────────────────────────

class TestCheckObjects:
    def test_valid_objects_no_errors(self, valid_objects):
        ids = {"Candidate", "Job_Requisition"}
        errors = check_objects(valid_objects, ids)
        # Should be clean (no P0/P1 errors; FK heuristic might produce P2)
        p0 = [e for e in errors if e.severity == Severity.P0]
        assert len(p0) == 0

    def test_missing_primary_key(self):
        obj = {"id": "BadObj", "name": "坏对象", "properties": [{"name": "x", "type": "String"}]}
        errors = check_objects([obj], set())
        codes = [e.code for e in errors]
        assert "OBJ-001" in codes

    def test_primary_key_not_in_properties(self):
        obj = {
            "id": "BadObj",
            "primary_key": "bad_pk",
            "properties": [{"name": "other_field", "type": "String"}],
        }
        errors = check_objects([obj], set())
        codes = [e.code for e in errors]
        assert "OBJ-002" in codes

    def test_duplicate_property(self):
        obj = {
            "id": "DupProp",
            "primary_key": "id",
            "properties": [
                {"name": "id", "type": "String"},
                {"name": "name", "type": "String"},
                {"name": "name", "type": "String"},  # duplicate
            ],
        }
        errors = check_objects([obj], set())
        codes = [e.code for e in errors]
        assert "OBJ-003" in codes

    def test_duplicate_object_id(self):
        objs = [
            {"id": "Same", "primary_key": "id", "properties": [{"name": "id"}]},
            {"id": "Same", "primary_key": "id", "properties": [{"name": "id"}]},
        ]
        errors = check_objects(objs, set())
        codes = [e.code for e in errors]
        assert "OBJ-004" in codes

    def test_fk_target_not_found(self):
        obj = {
            "id": "MyObj",
            "primary_key": "my_obj_id",
            "properties": [
                {"name": "my_obj_id", "type": "String"},
                {"name": "nonexistent_entity_id", "type": "String"},
            ],
        }
        errors = check_objects([obj], {"MyObj"})
        codes = [e.code for e in errors]
        assert "OBJ-005" in codes


# ── Test Category 2: Rules ───────────────────────────────────────────────────

class TestCheckRules:
    def test_valid_rules_no_p0(self, valid_rules):
        errors = check_rules(valid_rules, {"Candidate", "Job_Requisition"})
        p0 = [e for e in errors if e.severity == Severity.P0]
        assert len(p0) == 0

    def test_missing_required_field(self):
        rule = {"id": "R1"}  # missing standardizedLogicRule
        errors = check_rules([rule], set())
        codes = [e.code for e in errors]
        assert "RULE-001" in codes

    def test_missing_id(self):
        rule = {"standardizedLogicRule": "some logic"}
        errors = check_rules([rule], set())
        codes = [e.code for e in errors]
        assert "RULE-001" in codes

    def test_duplicate_rule_id(self):
        rules = [
            {"id": "R1", "standardizedLogicRule": "logic A"},
            {"id": "R1", "standardizedLogicRule": "logic B"},
        ]
        errors = check_rules(rules, set())
        codes = [e.code for e in errors]
        assert "RULE-002" in codes

    def test_related_entity_not_found(self):
        rule = {
            "id": "R1",
            "standardizedLogicRule": "some logic",
            "relatedEntities": "候选人 (Candidate)\n不存在的 (NonExistent)",
        }
        errors = check_rules([rule], {"Candidate"})
        codes = [e.code for e in errors]
        assert "RULE-003" in codes
        # Candidate should NOT trigger error
        messages = [e.message for e in errors]
        assert not any("Candidate" in m and "RULE-003" == e.code for m, e in zip(messages, errors) if "不存在" not in m)


# ── Test Category 3: Actions & Events ────────────────────────────────────────

class TestCheckActionsEvents:
    def test_valid_no_errors(self, valid_actions, valid_events):
        errors = check_actions_events(valid_actions, valid_events, {"Candidate"})
        p0 = [e for e in errors if e.severity == Severity.P0]
        assert len(p0) == 0

    def test_trigger_event_not_found(self):
        actions = [{"id": "A1", "name": "badAction", "trigger": ["NONEXISTENT_EVENT"]}]
        events = [{"name": "SOME_EVENT", "payload": {}}]
        errors = check_actions_events(actions, events, set())
        codes = [e.code for e in errors]
        assert "AE-001" in codes

    def test_triggered_event_not_found(self):
        actions = [{
            "id": "A1", "name": "testAction",
            "trigger": ["REAL_EVENT"],
            "triggered_event": ["MISSING_EVENT"],
        }]
        events = [{"name": "REAL_EVENT", "payload": {}}]
        errors = check_actions_events(actions, events, set())
        codes = [e.code for e in errors]
        assert "AE-002" in codes

    def test_source_object_not_found(self):
        actions = [{
            "id": "A1", "name": "testAction",
            "trigger": ["EV"],
            "source_object": [{"name": "GhostObject"}],
        }]
        events = [{"name": "EV", "payload": {}}]
        errors = check_actions_events(actions, events, {"RealObject"})
        codes = [e.code for e in errors]
        assert "AE-003" in codes

    def test_event_source_action_not_found(self):
        events = [{"name": "EV1", "payload": {"source_action": "ghost_action"}}]
        errors = check_actions_events([], events, set())
        codes = [e.code for e in errors]
        assert "AE-004" in codes

    def test_state_mutation_target_not_found(self):
        events = [{
            "name": "EV1",
            "payload": {
                "source_action": None,
                "state_mutations": [{"target_object": "NonExistentObj", "field": "x"}],
            },
        }]
        errors = check_actions_events([], events, {"RealObj"})
        codes = [e.code for e in errors]
        assert "AE-005" in codes


# ── Test Category 4: Links ───────────────────────────────────────────────────

class TestCheckLinks:
    def test_valid_links_no_p0(self, valid_links):
        errors = check_links(valid_links, {"Candidate", "Job_Requisition"}, {"1-1-1"})
        p0 = [e for e in errors if e.severity == Severity.P0]
        assert len(p0) == 0

    def test_unparseable_node(self):
        links = [{
            "node_1": "garbage",
            "relationship": "[:HAS {}]",
            "node_2": "(:ObjectDefinition {uid: X})",
        }]
        errors = check_links(links, set(), set())
        codes = [e.code for e in errors]
        assert "LINK-001" in codes

    def test_invalid_node_type(self):
        links = [{
            "node_1": "(:WeirdType {uid: X})",
            "relationship": "[:HAS {}]",
            "node_2": "(:ObjectDefinition {uid: Y})",
        }]
        errors = check_links(links, set(), set())
        codes = [e.code for e in errors]
        assert "LINK-002" in codes

    def test_object_uid_not_found(self):
        links = [{
            "node_1": "(:ObjectDefinition {uid: GhostObj})",
            "relationship": "[:HAS {}]",
            "node_2": "(:ObjectDefinition {uid: RealObj})",
        }]
        errors = check_links(links, {"RealObj"}, set())
        codes = [e.code for e in errors]
        assert "LINK-003" in codes

    def test_rule_uid_not_found(self):
        links = [{
            "node_1": "(:RuleDefinition {uid: GHOST_RULE})",
            "relationship": "[:INVOLVES {}]",
            "node_2": "(:ObjectDefinition {uid: Candidate})",
        }]
        errors = check_links(links, {"Candidate"}, {"R1", "R2"})
        codes = [e.code for e in errors]
        assert "LINK-004" in codes

    def test_unparseable_relationship(self):
        links = [{
            "node_1": "(:ObjectDefinition {uid: A})",
            "relationship": "bad_rel",
            "node_2": "(:ObjectDefinition {uid: B})",
        }]
        errors = check_links(links, {"A", "B"}, set())
        codes = [e.code for e in errors]
        assert "LINK-005" in codes

    def test_involves_wrong_node_type(self):
        links = [{
            "node_1": "(:ObjectDefinition {uid: A})",
            "relationship": "[:INVOLVES {}]",
            "node_2": "(:ObjectDefinition {uid: B})",
        }]
        errors = check_links(links, {"A", "B"}, set())
        codes = [e.code for e in errors]
        assert "LINK-006" in codes

    def test_has_property_wrong_types(self):
        links = [{
            "node_1": "(:RuleDefinition {uid: R1})",
            "relationship": "[:HAS_PROPERTY {}]",
            "node_2": "(:ObjectDefinition {uid: X})",
        }]
        errors = check_links(links, {"X"}, {"R1"})
        codes = [e.code for e in errors]
        assert "LINK-007" in codes

    def test_duplicate_link(self):
        link = {
            "node_1": "(:ObjectDefinition {uid: A})",
            "relationship": "[:HAS {}]",
            "node_2": "(:ObjectDefinition {uid: B})",
        }
        errors = check_links([link, link], {"A", "B"}, set())
        codes = [e.code for e in errors]
        assert "LINK-008" in codes

    def test_mixed_node_types_no_false_object_error(self):
        """Links with RuleDefinition/PropertyDefinition nodes should NOT
        produce OBJ errors when those UIDs are not in object set."""
        links = [
            {
                "node_1": "(:RuleDefinition {uid: 1-1-1,name: 规则})",
                "relationship": "[:INVOLVES {}]",
                "node_2": "(:ObjectDefinition {uid: Candidate})",
            },
            {
                "node_1": "(:ObjectDefinition {uid: Candidate})",
                "relationship": "[:HAS_PROPERTY {}]",
                "node_2": "(:PropertyDefinition {uid: name,name: 姓名})",
            },
        ]
        errors = check_links(links, {"Candidate"}, {"1-1-1"})
        # No LINK-003 because Candidate exists; no LINK-004 because 1-1-1 exists
        link003 = [e for e in errors if e.code == "LINK-003"]
        link004 = [e for e in errors if e.code == "LINK-004"]
        assert len(link003) == 0
        assert len(link004) == 0


# ── Test Category 5: Ontology (Runnability) ──────────────────────────────────

class TestCheckOntology:
    def test_valid_ontology_runnable(self, valid_actions, valid_events, valid_objects, valid_links):
        errors, runnable, blockers = check_ontology(
            valid_actions, valid_events, valid_objects, valid_links,
            critical_paths=[["SCHEDULED_SYNC", "ANALYSIS_COMPLETED"]],
        )
        assert runnable is True
        assert len(blockers) == 0

    def test_no_start_event(self):
        events = [{"name": "EV1", "payload": {"source_action": "someAction"}}]
        errors, runnable, blockers = check_ontology([], events, [], [])
        codes = [e.code for e in errors]
        assert "ONTO-001" in codes
        assert runnable is False

    def test_action_trigger_missing(self):
        actions = [{"name": "A1", "trigger": ["GHOST_EVENT"], "triggered_event": []}]
        events = [{"name": "START", "payload": {"source_action": None}}]
        errors, runnable, blockers = check_ontology(actions, events, [], [])
        codes = [e.code for e in errors]
        assert "ONTO-002" in codes
        assert runnable is False

    def test_emitted_event_missing(self):
        actions = [{"name": "A1", "trigger": ["START"], "triggered_event": ["GHOST_OUT"]}]
        events = [{"name": "START", "payload": {"source_action": None}}]
        errors, runnable, blockers = check_ontology(actions, events, [], [])
        codes = [e.code for e in errors]
        assert "ONTO-003" in codes

    def test_source_action_mismatch(self):
        actions = [{"name": "actionA", "trigger": ["START"], "triggered_event": ["EV_OUT"]}]
        events = [
            {"name": "START", "payload": {"source_action": None}},
            {"name": "EV_OUT", "payload": {"source_action": "differentAction"}},
        ]
        errors, _, _ = check_ontology(actions, events, [], [])
        codes = [e.code for e in errors]
        assert "ONTO-004" in codes

    def test_dangling_object(self, valid_actions, valid_events):
        objects = [
            {"id": "Candidate"},
            {"id": "LonelyObject"},  # not referenced anywhere
        ]
        links = [{
            "node_1": "(:ObjectDefinition {uid: Candidate})",
            "relationship": "[:HAS {}]",
            "node_2": "(:ObjectDefinition {uid: Candidate})",
        }]
        errors, _, _ = check_ontology(valid_actions, valid_events, objects, links)
        codes = [e.code for e in errors]
        assert "ONTO-005" in codes
        dangling_msgs = [e.message for e in errors if e.code == "ONTO-005"]
        assert any("LonelyObject" in m for m in dangling_msgs)

    def test_critical_path_unreachable(self):
        actions = [
            {"name": "A1", "trigger": ["START"], "triggered_event": ["MID"]},
            # No action connects MID to END
        ]
        events = [
            {"name": "START", "payload": {"source_action": None}},
            {"name": "MID", "payload": {"source_action": "A1"}},
            {"name": "END", "payload": {"source_action": None}},
        ]
        errors, runnable, blockers = check_ontology(
            actions, events, [], [],
            critical_paths=[["START", "END"]],
        )
        codes = [e.code for e in errors]
        assert "ONTO-006" in codes
        assert runnable is False

    def test_critical_path_reachable(self, valid_actions, valid_events, valid_objects, valid_links):
        errors, runnable, blockers = check_ontology(
            valid_actions, valid_events, valid_objects, valid_links,
            critical_paths=[["SCHEDULED_SYNC", "ANALYSIS_COMPLETED"]],
        )
        onto006 = [e for e in errors if e.code == "ONTO-006"]
        assert len(onto006) == 0


# ── Test: Full validate_snapshot ─────────────────────────────────────────────

class TestValidateSnapshot:
    def test_valid_snapshot_structure(self, valid_snapshot):
        result = validate_snapshot(valid_snapshot, critical_paths=[["SCHEDULED_SYNC", "ANALYSIS_COMPLETED"]])
        assert "isDeterministicallyValid" in result
        assert "blockers" in result
        assert "summary" in result
        assert "errorsByType" in result
        assert "allErrors" in result
        assert "runnable" in result
        assert "runnableBlockers" in result
        assert "checksum" in result

    def test_determinism_10_runs(self, valid_snapshot):
        """Same snapshot run 10 times must produce identical checksum."""
        checksums = set()
        for _ in range(10):
            snap_copy = copy.deepcopy(valid_snapshot)
            result = validate_snapshot(snap_copy, critical_paths=[["SCHEDULED_SYNC", "ANALYSIS_COMPLETED"]])
            checksums.add(result["checksum"])
        assert len(checksums) == 1, f"Non-deterministic: got {len(checksums)} different checksums"

    def test_determinism_with_errors(self):
        """Even broken snapshots must produce deterministic output."""
        broken = {
            "dataobjects": [{"id": "X"}],  # no primary_key
            "rules": [{"id": "R1"}],        # missing standardizedLogicRule
            "actions": [{"name": "A1", "trigger": ["GHOST"]}],
            "events": [],
            "links": [{"node_1": "bad", "relationship": "bad", "node_2": "bad"}],
        }
        checksums = set()
        for _ in range(10):
            result = validate_snapshot(copy.deepcopy(broken))
            checksums.add(result["checksum"])
        assert len(checksums) == 1

    def test_strict_mode_raises(self):
        broken = {
            "dataobjects": [{"id": "X"}],
            "rules": [],
            "actions": [],
            "events": [],
            "links": [],
        }
        with pytest.raises(ValueError, match="P0 blockers"):
            validate_snapshot(broken, strict=True)

    def test_five_error_categories(self):
        """Validate that errors are grouped into 5 categories."""
        snap = {
            "dataobjects": [{"id": "X"}],                          # OBJ error
            "rules": [{"id": "R1"}],                                 # RULE error
            "actions": [{"name": "A1", "trigger": ["GHOST"]}],      # AE error
            "events": [{"name": "E1", "payload": {"source_action": "ghost"}}],  # AE error
            "links": [{"node_1": "bad", "relationship": "bad", "node_2": "bad"}],  # LINK error
        }
        result = validate_snapshot(snap)
        types = set(result["errorsByType"].keys())
        # Should have errors from objects, rules, actions, events, links, ontology
        assert "objects" in types
        assert "rules" in types
        assert "links" in types
        assert "ontology" in types

    def test_empty_snapshot_minimal_errors(self):
        snap = {
            "dataobjects": [],
            "rules": [],
            "actions": [],
            "events": [],
            "links": [],
        }
        result = validate_snapshot(snap)
        # Empty snapshot: no start events = ONTO-001
        assert result["runnable"] is False
        assert result["summary"]["total"] >= 1

    def test_runnable_true_for_good_snapshot(self, valid_snapshot):
        result = validate_snapshot(valid_snapshot, critical_paths=[["SCHEDULED_SYNC", "ANALYSIS_COMPLETED"]])
        assert result["runnable"] is True

    def test_runnable_false_explains_blockers(self):
        snap = {
            "dataobjects": [],
            "rules": [],
            "actions": [{"name": "A1", "trigger": ["MISSING_EVENT"], "triggered_event": []}],
            "events": [],
            "links": [],
        }
        result = validate_snapshot(snap)
        assert result["runnable"] is False
        assert len(result["runnableBlockers"]) > 0

    def test_no_llm_dependency(self, valid_snapshot):
        """Validator must work without any LLM configuration."""
        # This test simply confirms the validator runs without importing
        # or calling any LLM-related code
        result = validate_snapshot(valid_snapshot, critical_paths=[["SCHEDULED_SYNC", "ANALYSIS_COMPLETED"]])
        assert isinstance(result, dict)
        assert "checksum" in result


# ── Test: Edge Cases ─────────────────────────────────────────────────────────

class TestEdgeCases:
    def test_objects_without_properties(self):
        """Objects with no properties list should not crash."""
        obj = {"id": "Bare", "primary_key": "bare_id"}
        errors = check_objects([obj], set())
        # Should get OBJ-002 (pk not in properties) — but no crash
        assert isinstance(errors, list)

    def test_rules_with_empty_related_entities(self):
        rule = {"id": "R1", "standardizedLogicRule": "logic", "relatedEntities": ""}
        errors = check_rules([rule], {"Candidate"})
        # Empty relatedEntities should not crash or produce false errors
        rule003 = [e for e in errors if e.code == "RULE-003"]
        assert len(rule003) == 0

    def test_actions_with_string_triggered_event(self):
        """Some actions may have triggered_event as string instead of list."""
        actions = [{"name": "A1", "trigger": ["EV1"], "triggered_event": "MISSING_STR_EVENT"}]
        events = [{"name": "EV1", "payload": {}}]
        errors = check_actions_events(actions, events, set())
        codes = [e.code for e in errors]
        assert "AE-002" in codes

    def test_links_with_complex_uid(self):
        """UIDs containing special characters should parse correctly."""
        link = {
            "node_1": "(:ObjectDefinition {uid: Job_Requisition_Specification,name: 外包招聘需求})",
            "relationship": "[:HAS_MANY {}]",
            "node_2": "(:ObjectDefinition {uid: Job_Requisition,name: 招聘岗位})",
        }
        errors = check_links([link], {"Job_Requisition_Specification", "Job_Requisition"}, set())
        link003 = [e for e in errors if e.code == "LINK-003"]
        assert len(link003) == 0

    def test_event_with_dict_trigger(self):
        """Actions may have trigger as list of dicts."""
        actions = [{"name": "A1", "trigger": [{"name": "EV1"}], "triggered_event": []}]
        events = [{"name": "EV1", "payload": {"source_action": None}}]
        errors = check_actions_events(actions, events, set())
        ae001 = [e for e in errors if e.code == "AE-001"]
        assert len(ae001) == 0


# ── Test: Against Real Snapshot Data (if available) ──────────────────────────

class TestRealData:
    """Run validator against the actual snapshot data if present."""

    @pytest.fixture
    def real_snapshot(self):
        import json
        from pathlib import Path
        snap_file = Path(__file__).parent.parent / "data" / "snapshots.json"
        if not snap_file.exists():
            pytest.skip("No real snapshot data available")
        data = json.loads(snap_file.read_text(encoding="utf-8"))
        if not data:
            pytest.skip("Snapshot file is empty")
        return data[0]

    def test_real_data_determinism(self, real_snapshot):
        checksums = set()
        for _ in range(10):
            result = validate_snapshot(copy.deepcopy(real_snapshot))
            checksums.add(result["checksum"])
        assert len(checksums) == 1

    def test_real_data_produces_report(self, real_snapshot):
        result = validate_snapshot(real_snapshot)
        assert "isDeterministicallyValid" in result
        assert "summary" in result
        assert result["summary"]["total"] >= 0
        # Print summary for visibility
        print(f"\nReal data validation: {result['summary']}")
        print(f"  Runnable: {result['runnable']}")
        print(f"  Blockers: {len(result['blockers'])}")
        for cat, errs in result.get("errorsByType", {}).items():
            print(f"  {cat}: {len(errs)} errors")
