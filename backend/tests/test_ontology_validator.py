"""
TDD test suite for the deterministic ontology validator.

Covers:
  - Objects:       primary key consistency, duplicate properties, FK targets
  - Rules:         missing ID, duplicate ID, relatedEntities resolution
  - Actions/Events: trigger/event consistency, source_object, state_mutations
  - Links:         type classification, missing endpoints, duplicates
  - Ontology:      start event, broken triggers, dangling nodes, dead links
  - Stability:     same input → identical hash across 10 runs
"""

import pytest
from ontology_validator import (
    validate_snapshot, validate_objects, validate_rules,
    validate_actions_events, validate_links, validate_ontology,
    ValidationReport, ValidationError, Severity,
)


# ─── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def minimal_valid_snapshot():
    """A minimal but structurally valid ontology snapshot."""
    return {
        "dataobjects": [
            {
                "id": "Candidate",
                "primary_key": "candidate_id",
                "properties": [
                    {"name": "candidate_id", "type": "string"},
                    {"name": "name", "type": "string"},
                    {"name": "status", "type": "string"},
                ],
            },
        ],
        "rules": [
            {
                "id": "rule_screen",
                "ruleId": "rule_screen",
                "relatedEntities": ["Candidate"],
            },
        ],
        "actions": [
            {
                "id": "screenCandidate",
                "trigger": "CANDIDATE_SUBMITTED",
                "triggered_event": "SCREENING_DONE",
                "source_object": "Candidate",
            },
        ],
        "events": [
            {
                "id": "CANDIDATE_SUBMITTED",
                "source_action": None,  # start event
            },
            {
                "id": "SCREENING_DONE",
                "source_action": "screenCandidate",
                "state_mutations": [
                    {"target_object": "Candidate", "properties": ["status"]},
                ],
            },
        ],
        "links": [
            {
                "source": "Candidate",
                "target": "rule_screen",
                "relationshipType": "INVOLVES",
            },
        ],
    }


@pytest.fixture
def broken_snapshot():
    """Snapshot with known defects in every category."""
    return {
        "dataobjects": [
            {
                "id": "Person",
                "primary_key": "person_id",
                "properties": [
                    {"name": "name", "type": "string"},
                    {"name": "name", "type": "string"},  # duplicate prop
                    # person_id not present → PK not in props
                ],
            },
            {
                "id": "Person",  # duplicate object ID
                "properties": [
                    {"name": "age", "type": "integer", "fk_target": "NonExistentObj"},
                ],
            },
        ],
        "rules": [
            {},  # missing ID
            {"id": "r1", "relatedEntities": ["GhostObject"]},
            {"id": "r1"},  # duplicate rule ID
        ],
        "actions": [
            {
                "id": "doSomething",
                "trigger": "GHOST_EVENT",  # non-existent trigger
                "triggered_event": "ANOTHER_GHOST",
                "source_object": "MissingObj",
            },
        ],
        "events": [
            {
                "id": "ONLY_EVENT",
                "source_action": "nonExistentAction",
                "state_mutations": [
                    {"target_object": "MissingMutTarget", "properties": ["x"]},
                ],
            },
        ],
        "links": [
            {"source": "Person", "target": "Person", "relationshipType": "SELF"},
            {"source": "Person", "target": "Person", "relationshipType": "SELF"},  # dup
            {},  # missing endpoints
        ],
    }


# ─── Object Tests ──────────────────────────────────────────────────────────────

class TestObjectValidation:
    def test_pk_not_in_properties(self, broken_snapshot):
        obj_ids = {"Person"}
        errs = validate_objects(broken_snapshot["dataobjects"], obj_ids)
        pk_errs = [e for e in errs if e.code == "OBJ_PK_NOT_IN_PROPS"]
        assert len(pk_errs) >= 1

    def test_duplicate_property(self, broken_snapshot):
        obj_ids = {"Person"}
        errs = validate_objects(broken_snapshot["dataobjects"], obj_ids)
        dup_errs = [e for e in errs if e.code == "OBJ_DUPLICATE_PROP"]
        assert len(dup_errs) >= 1

    def test_duplicate_object_id(self, broken_snapshot):
        obj_ids = {"Person"}
        errs = validate_objects(broken_snapshot["dataobjects"], obj_ids)
        dup_errs = [e for e in errs if e.code == "OBJ_DUPLICATE_ID"]
        assert len(dup_errs) >= 1

    def test_fk_target_missing(self, broken_snapshot):
        obj_ids = {"Person"}
        errs = validate_objects(broken_snapshot["dataobjects"], obj_ids)
        fk_errs = [e for e in errs if e.code == "OBJ_FK_TARGET_MISSING"]
        assert len(fk_errs) >= 1

    def test_valid_object_no_errors(self, minimal_valid_snapshot):
        obj_ids = {"Candidate"}
        errs = validate_objects(minimal_valid_snapshot["dataobjects"], obj_ids)
        assert len(errs) == 0


# ─── Rule Tests ────────────────────────────────────────────────────────────────

class TestRuleValidation:
    def test_missing_rule_id(self, broken_snapshot):
        errs = validate_rules(broken_snapshot["rules"], {"Person"})
        missing = [e for e in errs if e.code == "RULE_MISSING_ID"]
        assert len(missing) >= 1

    def test_duplicate_rule_id(self, broken_snapshot):
        errs = validate_rules(broken_snapshot["rules"], {"Person"})
        dups = [e for e in errs if e.code == "RULE_DUPLICATE_ID"]
        assert len(dups) >= 1

    def test_related_entity_not_found(self, broken_snapshot):
        errs = validate_rules(broken_snapshot["rules"], {"Person"})
        ref_errs = [e for e in errs if e.code == "RULE_ENTITY_NOT_FOUND"]
        assert len(ref_errs) >= 1

    def test_valid_rules_no_errors(self, minimal_valid_snapshot):
        errs = validate_rules(minimal_valid_snapshot["rules"], {"Candidate"})
        assert len(errs) == 0


# ─── Actions/Events Tests ─────────────────────────────────────────────────────

class TestActionEventValidation:
    def test_trigger_event_missing(self, broken_snapshot):
        errs = validate_actions_events(
            broken_snapshot["actions"], broken_snapshot["events"], {"Person"})
        trigger_errs = [e for e in errs if e.code == "ACTION_TRIGGER_EVENT_MISSING"]
        assert len(trigger_errs) >= 1

    def test_emitted_event_missing(self, broken_snapshot):
        errs = validate_actions_events(
            broken_snapshot["actions"], broken_snapshot["events"], {"Person"})
        emit_errs = [e for e in errs if e.code == "ACTION_EMITTED_EVENT_MISSING"]
        assert len(emit_errs) >= 1

    def test_source_object_missing(self, broken_snapshot):
        errs = validate_actions_events(
            broken_snapshot["actions"], broken_snapshot["events"], {"Person"})
        src_errs = [e for e in errs if e.code == "ACTION_SOURCE_OBJ_MISSING"]
        assert len(src_errs) >= 1

    def test_event_source_action_missing(self, broken_snapshot):
        errs = validate_actions_events(
            broken_snapshot["actions"], broken_snapshot["events"], {"Person"})
        sa_errs = [e for e in errs if e.code == "EVENT_SOURCE_ACTION_MISSING"]
        assert len(sa_errs) >= 1

    def test_event_mutation_object_missing(self, broken_snapshot):
        errs = validate_actions_events(
            broken_snapshot["actions"], broken_snapshot["events"], {"Person"})
        mut_errs = [e for e in errs if e.code == "EVENT_MUTATION_OBJ_MISSING"]
        assert len(mut_errs) >= 1

    def test_valid_actions_events_no_errors(self, minimal_valid_snapshot):
        errs = validate_actions_events(
            minimal_valid_snapshot["actions"],
            minimal_valid_snapshot["events"],
            {"Candidate"},
        )
        assert len(errs) == 0


# ─── Links Tests ──────────────────────────────────────────────────────────────

class TestLinkValidation:
    def test_duplicate_link(self, broken_snapshot):
        errs = validate_links(
            broken_snapshot["links"],
            {"Person"}, {"r1"}, set(), {"ONLY_EVENT"})
        dup_errs = [e for e in errs if e.code == "LINK_DUPLICATE"]
        assert len(dup_errs) >= 1

    def test_missing_endpoints(self, broken_snapshot):
        errs = validate_links(
            broken_snapshot["links"],
            {"Person"}, {"r1"}, set(), {"ONLY_EVENT"})
        ep_errs = [e for e in errs if e.code == "LINK_MISSING_ENDPOINTS"]
        assert len(ep_errs) >= 1

    def test_valid_links_no_errors(self, minimal_valid_snapshot):
        errs = validate_links(
            minimal_valid_snapshot["links"],
            {"Candidate"}, {"rule_screen"},
            {"screenCandidate"},
            {"CANDIDATE_SUBMITTED", "SCREENING_DONE"},
        )
        assert len(errs) == 0


# ─── Ontology-level Tests ─────────────────────────────────────────────────────

class TestOntologyValidation:
    def test_no_start_event(self):
        """All events have source_action → no start event."""
        events = [{"id": "E1", "source_action": "someAction"}]
        errs = validate_ontology([], events, [], [], [])
        start_errs = [e for e in errs if e.code == "ONTO_NO_START_EVENT"]
        assert len(start_errs) == 1

    def test_broken_trigger_chain(self):
        actions = [{"id": "act1", "trigger": "NONEXISTENT_EVENT"}]
        events = [{"id": "REAL_EVENT"}]
        errs = validate_ontology(actions, events, [], [], [])
        trigger_errs = [e for e in errs if e.code == "ONTO_BROKEN_TRIGGER"]
        assert len(trigger_errs) == 1

    def test_dangling_object(self):
        objects = [{"id": "OrphanObj"}, {"id": "ReferencedObj"}]
        rules = [{"id": "r1", "relatedEntities": ["ReferencedObj"]}]
        errs = validate_ontology([], [], objects, rules, [])
        dangling = [e for e in errs if e.code == "ONTO_DANGLING_OBJECT"]
        assert any(e.entityId == "OrphanObj" for e in dangling)

    def test_valid_ontology_is_runnable(self, minimal_valid_snapshot):
        report = validate_snapshot(minimal_valid_snapshot)
        assert report.runnable is True
        assert report.isDeterministicallyValid is True
        assert len(report.blockers) == 0

    def test_broken_ontology_not_runnable(self, broken_snapshot):
        report = validate_snapshot(broken_snapshot)
        assert report.runnable is False
        assert len(report.blockers) > 0


# ─── Full Report Tests ────────────────────────────────────────────────────────

class TestFullReport:
    def test_errors_by_category(self, broken_snapshot):
        report = validate_snapshot(broken_snapshot)
        cats = report.errors_by_category()
        assert "objects" in cats
        assert "rules" in cats
        assert "actions_events" in cats
        assert "links" in cats
        assert "ontology" in cats
        # Broken snapshot should have errors in every category
        assert len(cats["objects"]) > 0
        assert len(cats["rules"]) > 0
        assert len(cats["actions_events"]) > 0

    def test_to_dict_structure(self, broken_snapshot):
        report = validate_snapshot(broken_snapshot)
        d = report.to_dict()
        assert "isDeterministicallyValid" in d
        assert "runnable" in d
        assert "totalErrors" in d
        assert "blockerCount" in d
        assert "resultHash" in d
        assert "errors" in d
        assert "errorsByCategory" in d


# ─── Stability (Determinism) Tests ─────────────────────────────────────────────

class TestDeterminism:
    def test_same_input_same_hash_10_runs(self, broken_snapshot):
        """Same snapshot run 10 times must produce identical result hash."""
        hashes = set()
        for _ in range(10):
            report = validate_snapshot(broken_snapshot)
            hashes.add(report.result_hash())
        assert len(hashes) == 1, f"Non-deterministic! Got {len(hashes)} distinct hashes: {hashes}"

    def test_valid_snapshot_stable(self, minimal_valid_snapshot):
        hashes = set()
        for _ in range(10):
            report = validate_snapshot(minimal_valid_snapshot)
            hashes.add(report.result_hash())
        assert len(hashes) == 1

    def test_sorted_errors_are_deterministic(self, broken_snapshot):
        report1 = validate_snapshot(broken_snapshot)
        report2 = validate_snapshot(broken_snapshot)
        errs1 = [e.to_dict() for e in report1.sorted_errors()]
        errs2 = [e.to_dict() for e in report2.sorted_errors()]
        assert errs1 == errs2


# ─── Edge Cases ────────────────────────────────────────────────────────────────

class TestEdgeCases:
    def test_empty_snapshot(self):
        report = validate_snapshot({})
        assert report.runnable is True
        assert len(report.errors) == 0

    def test_snapshot_with_only_objects(self):
        snap = {"dataobjects": [{"id": "A", "properties": []}]}
        report = validate_snapshot(snap)
        # A is dangling (unreferenced) → P2 warning
        dangling = [e for e in report.errors if e.code == "ONTO_DANGLING_OBJECT"]
        assert len(dangling) == 1
        assert report.runnable is True  # P2 doesn't block

    def test_string_related_entities(self):
        """relatedEntities as a single string (not list)."""
        rules = [{"id": "r1", "relatedEntities": "MissingObj"}]
        errs = validate_rules(rules, {"RealObj"})
        assert any(e.code == "RULE_ENTITY_NOT_FOUND" for e in errs)

    def test_triggered_event_as_string(self):
        """triggered_event as a string (not list)."""
        actions = [{"id": "a1", "trigger": "E1", "triggered_event": "GHOST"}]
        events = [{"id": "E1"}]
        errs = validate_actions_events(actions, events, set())
        assert any(e.code == "ACTION_EMITTED_EVENT_MISSING" for e in errs)
