"""
RAAS Ontology Deterministic Validator

Pure-rule validation engine — no LLM dependency.
Produces identical output for identical input (deterministic).

Five check categories:
  1. objects  — primary key, property duplication, FK targets
  2. rules    — required fields, ID uniqueness, relatedEntities resolution
  3. actions_events — trigger/event consistency, source_object, state_mutations
  4. links    — node type parsing, endpoint validity, relationship legality
  5. ontology — global graph connectivity, dangling nodes, critical path reachability
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Any, Dict, List, Optional, Set, Tuple


# ── Error Model ──────────────────────────────────────────────────────────────

class Severity(str, Enum):
    P0 = "P0"  # blocker
    P1 = "P1"  # major
    P2 = "P2"  # minor


@dataclass
class ValidationError:
    code: str
    severity: Severity
    entityType: str      # objects | rules | actions | events | links | ontology
    entityId: str        # affected entity identifier
    message: str
    evidence: str = ""   # supporting detail

    def to_dict(self) -> dict:
        return {
            "code": self.code,
            "severity": self.severity.value,
            "entityType": self.entityType,
            "entityId": self.entityId,
            "message": self.message,
            "evidence": self.evidence,
        }


@dataclass
class ValidationReport:
    errors: List[ValidationError] = field(default_factory=list)
    isDeterministicallyValid: bool = True
    blockers: List[dict] = field(default_factory=list)
    summary: Dict[str, int] = field(default_factory=dict)
    runnable: Optional[bool] = None
    runnableBlockers: List[dict] = field(default_factory=list)

    def _sort(self):
        """Fixed sort: severity -> code -> entityId for determinism."""
        severity_order = {"P0": 0, "P1": 1, "P2": 2}
        self.errors.sort(key=lambda e: (
            severity_order.get(e.severity.value, 9),
            e.code,
            e.entityId,
        ))

    def finalize(self) -> dict:
        self._sort()
        self.blockers = [e.to_dict() for e in self.errors if e.severity == Severity.P0]
        self.isDeterministicallyValid = len(self.blockers) == 0
        self.summary = {
            "total": len(self.errors),
            "P0": sum(1 for e in self.errors if e.severity == Severity.P0),
            "P1": sum(1 for e in self.errors if e.severity == Severity.P1),
            "P2": sum(1 for e in self.errors if e.severity == Severity.P2),
        }
        # Group by entityType
        by_type: Dict[str, List[dict]] = {}
        for e in self.errors:
            by_type.setdefault(e.entityType, []).append(e.to_dict())
        return {
            "isDeterministicallyValid": self.isDeterministicallyValid,
            "blockers": self.blockers,
            "summary": self.summary,
            "errorsByType": by_type,
            "allErrors": [e.to_dict() for e in self.errors],
            "runnable": self.runnable,
            "runnableBlockers": self.runnableBlockers,
            "checksum": self._checksum(),
        }

    def _checksum(self) -> str:
        """SHA-256 of sorted errors for idempotency verification."""
        blob = json.dumps([e.to_dict() for e in self.errors], sort_keys=True, ensure_ascii=False)
        return hashlib.sha256(blob.encode("utf-8")).hexdigest()


# ── Helper: parse link node string ───────────────────────────────────────────

_NODE_RE = re.compile(
    r"\(:(\w+)\s*\{([^}]*)\}\)"
)
_UID_RE = re.compile(r"uid:\s*([^,}]+)")


def _parse_link_node(node_str: str) -> Tuple[Optional[str], Optional[str]]:
    """Parse '(:ObjectDefinition {uid: Foo, ...})' -> ('ObjectDefinition', 'Foo')."""
    m = _NODE_RE.search(node_str)
    if not m:
        return None, None
    node_type = m.group(1)
    props = m.group(2)
    uid_m = _UID_RE.search(props)
    uid = uid_m.group(1).strip() if uid_m else None
    return node_type, uid


def _parse_relationship(rel_str: str) -> Optional[str]:
    """Parse '[:HAS_MANY {description: ...}]' -> 'HAS_MANY'."""
    m = re.match(r"\[:(\w+)", rel_str)
    return m.group(1) if m else None


# ── Check 1: Objects ─────────────────────────────────────────────────────────

def check_objects(objects: List[Dict], all_object_ids: Set[str]) -> List[ValidationError]:
    errors: List[ValidationError] = []
    seen_ids: Set[str] = set()

    for obj in objects:
        obj_id = obj.get("id") or obj.get("name") or "UNKNOWN"

        # 1a. Primary key existence
        pk = obj.get("primary_key")
        if not pk:
            errors.append(ValidationError(
                code="OBJ-001",
                severity=Severity.P0,
                entityType="objects",
                entityId=obj_id,
                message=f"对象 '{obj_id}' 缺少 primary_key 定义",
            ))
        else:
            # 1b. Primary key field must exist in properties
            props = obj.get("properties", [])
            prop_names = {p.get("name") for p in props if isinstance(p, dict)}
            if pk not in prop_names and props:
                errors.append(ValidationError(
                    code="OBJ-002",
                    severity=Severity.P0,
                    entityType="objects",
                    entityId=obj_id,
                    message=f"对象 '{obj_id}' 的 primary_key '{pk}' 不在其 properties 列表中",
                    evidence=f"已有属性: {sorted(prop_names)[:10]}",
                ))

        # 1c. Duplicate property names
        props = obj.get("properties", [])
        prop_name_list = [p.get("name") for p in props if isinstance(p, dict) and p.get("name")]
        seen_props: Set[str] = set()
        for pn in prop_name_list:
            if pn in seen_props:
                errors.append(ValidationError(
                    code="OBJ-003",
                    severity=Severity.P1,
                    entityType="objects",
                    entityId=obj_id,
                    message=f"对象 '{obj_id}' 存在重复属性 '{pn}'",
                ))
            seen_props.add(pn)

        # 1d. Duplicate object IDs
        if obj_id in seen_ids:
            errors.append(ValidationError(
                code="OBJ-004",
                severity=Severity.P0,
                entityType="objects",
                entityId=obj_id,
                message=f"对象 ID '{obj_id}' 重复定义",
            ))
        seen_ids.add(obj_id)

        # 1e. FK target existence (check property names ending with _id that reference other objects)
        for prop in props:
            if not isinstance(prop, dict):
                continue
            pname = prop.get("name", "")
            pdesc = prop.get("description", "")
            # Heuristic: if property name ends with _id and its description references another object
            if pname.endswith("_id") and pname != pk:
                # Try to resolve FK target from property name
                candidate_target = pname.rsplit("_id", 1)[0]
                # Convert snake_case to PascalCase for matching
                pascal = "".join(w.capitalize() for w in candidate_target.split("_"))
                if pascal and all_object_ids and pascal not in all_object_ids:
                    # Only warn if we have objects to check against and it's a plausible FK
                    if len(candidate_target) > 2:
                        errors.append(ValidationError(
                            code="OBJ-005",
                            severity=Severity.P2,
                            entityType="objects",
                            entityId=obj_id,
                            message=f"对象 '{obj_id}' 的外键属性 '{pname}' 可能引用不存在的对象 '{pascal}'",
                            evidence=f"已知对象: {sorted(all_object_ids)[:10]}",
                        ))

    return errors


# ── Check 2: Rules ───────────────────────────────────────────────────────────

_RULE_REQUIRED_FIELDS = ["id", "standardizedLogicRule"]


def check_rules(rules: List[Dict], all_object_ids: Set[str]) -> List[ValidationError]:
    errors: List[ValidationError] = []
    seen_ids: Set[str] = set()

    for rule in rules:
        rule_id = str(rule.get("id", "UNKNOWN"))

        # 2a. Required fields
        for rf in _RULE_REQUIRED_FIELDS:
            val = rule.get(rf)
            if not val or (isinstance(val, str) and not val.strip()):
                errors.append(ValidationError(
                    code="RULE-001",
                    severity=Severity.P0,
                    entityType="rules",
                    entityId=rule_id,
                    message=f"规则 '{rule_id}' 缺少必填字段 '{rf}'",
                ))

        # 2b. ID uniqueness
        if rule_id in seen_ids:
            errors.append(ValidationError(
                code="RULE-002",
                severity=Severity.P0,
                entityType="rules",
                entityId=rule_id,
                message=f"规则 ID '{rule_id}' 重复",
            ))
        seen_ids.add(rule_id)

        # 2c. relatedEntities resolution
        related = rule.get("relatedEntities", "")
        if related and isinstance(related, str) and all_object_ids:
            # Parse "候选人 (Candidate)\n客户单位 (Client)" format
            entity_refs = re.findall(r"\((\w+)\)", related)
            for ref in entity_refs:
                if ref not in all_object_ids:
                    errors.append(ValidationError(
                        code="RULE-003",
                        severity=Severity.P1,
                        entityType="rules",
                        entityId=rule_id,
                        message=f"规则 '{rule_id}' 的 relatedEntities 引用了不存在的对象 '{ref}'",
                        evidence=f"已知对象: {sorted(all_object_ids)[:10]}",
                    ))

    return errors


# ── Check 3: Actions & Events ────────────────────────────────────────────────

def check_actions_events(
    actions: List[Dict],
    events: List[Dict],
    all_object_ids: Set[str],
) -> List[ValidationError]:
    errors: List[ValidationError] = []

    event_names: Set[str] = {e.get("name", "") for e in events if e.get("name")}
    event_by_name: Dict[str, Dict] = {e["name"]: e for e in events if e.get("name")}
    action_names: Set[str] = {a.get("name", "") for a in actions if a.get("name")}

    # Build object property map
    # (populated externally but we accept all_object_ids for now)

    for action in actions:
        action_id = action.get("id") or action.get("name") or "UNKNOWN"
        action_name = action.get("name", "")

        # 3a. Trigger events must exist
        triggers = action.get("trigger", [])
        if isinstance(triggers, list):
            for trig in triggers:
                trig_name = trig.get("name") if isinstance(trig, dict) else str(trig)
                if trig_name and trig_name not in event_names:
                    errors.append(ValidationError(
                        code="AE-001",
                        severity=Severity.P0,
                        entityType="actions",
                        entityId=str(action_id),
                        message=f"Action '{action_name}' 的 trigger 事件 '{trig_name}' 在事件列表中不存在",
                        evidence=f"已知事件: {sorted(event_names)[:10]}",
                    ))

        # 3b. triggered_event must exist
        triggered = action.get("triggered_event", [])
        if isinstance(triggered, list):
            for te in triggered:
                te_name = te.get("name") if isinstance(te, dict) else str(te)
                if te_name and te_name not in event_names:
                    errors.append(ValidationError(
                        code="AE-002",
                        severity=Severity.P0,
                        entityType="actions",
                        entityId=str(action_id),
                        message=f"Action '{action_name}' 的 triggered_event '{te_name}' 在事件列表中不存在",
                        evidence=f"已知事件: {sorted(event_names)[:10]}",
                    ))
        elif isinstance(triggered, str) and triggered:
            if triggered not in event_names:
                errors.append(ValidationError(
                    code="AE-002",
                    severity=Severity.P0,
                    entityType="actions",
                    entityId=str(action_id),
                    message=f"Action '{action_name}' 的 triggered_event '{triggered}' 在事件列表中不存在",
                ))

        # 3c. source_object existence check
        source_objects = action.get("source_object", [])
        if isinstance(source_objects, list):
            for so in source_objects:
                so_name = so.get("name") if isinstance(so, dict) else str(so)
                if so_name and all_object_ids and so_name not in all_object_ids:
                    errors.append(ValidationError(
                        code="AE-003",
                        severity=Severity.P1,
                        entityType="actions",
                        entityId=str(action_id),
                        message=f"Action '{action_name}' 的 source_object '{so_name}' 不在已知对象中",
                    ))

    # 3d. Event source_action consistency
    for event in events:
        event_name = event.get("name", "UNKNOWN")
        payload = event.get("payload", {})
        if isinstance(payload, dict):
            source_action = payload.get("source_action")
            if source_action and source_action not in action_names:
                errors.append(ValidationError(
                    code="AE-004",
                    severity=Severity.P0,
                    entityType="events",
                    entityId=event_name,
                    message=f"事件 '{event_name}' 的 source_action '{source_action}' 不在已知 Action 列表中",
                    evidence=f"已知 actions: {sorted(action_names)[:10]}",
                ))

            # 3e. state_mutations property existence
            mutations = payload.get("state_mutations", [])
            if isinstance(mutations, list):
                for mut in mutations:
                    if not isinstance(mut, dict):
                        continue
                    target_obj = mut.get("target_object", "")
                    if target_obj and all_object_ids and target_obj not in all_object_ids:
                        errors.append(ValidationError(
                            code="AE-005",
                            severity=Severity.P1,
                            entityType="events",
                            entityId=event_name,
                            message=f"事件 '{event_name}' 的 state_mutation 目标对象 '{target_obj}' 不存在",
                        ))

    return errors


# ── Check 4: Links ───────────────────────────────────────────────────────────

_VALID_NODE_TYPES = {"ObjectDefinition", "RuleDefinition", "PropertyDefinition"}


def check_links(
    links: List[Dict],
    all_object_ids: Set[str],
    all_rule_ids: Set[str],
) -> List[ValidationError]:
    errors: List[ValidationError] = []
    seen_link_keys: Set[str] = set()

    for idx, link in enumerate(links):
        link_id = f"link_{idx}"

        node_1_str = link.get("node_1", "")
        node_2_str = link.get("node_2", "")
        rel_str = link.get("relationship", "")

        n1_type, n1_uid = _parse_link_node(node_1_str)
        n2_type, n2_uid = _parse_link_node(node_2_str)
        rel_type = _parse_relationship(rel_str)

        # 4a. Node type must be parseable
        if n1_type is None:
            errors.append(ValidationError(
                code="LINK-001",
                severity=Severity.P1,
                entityType="links",
                entityId=link_id,
                message=f"Link #{idx} 的 node_1 无法解析节点类型",
                evidence=node_1_str[:100],
            ))
            continue
        if n2_type is None:
            errors.append(ValidationError(
                code="LINK-001",
                severity=Severity.P1,
                entityType="links",
                entityId=link_id,
                message=f"Link #{idx} 的 node_2 无法解析节点类型",
                evidence=node_2_str[:100],
            ))
            continue

        # 4b. Node type legality
        if n1_type not in _VALID_NODE_TYPES:
            errors.append(ValidationError(
                code="LINK-002",
                severity=Severity.P1,
                entityType="links",
                entityId=link_id,
                message=f"Link #{idx} 的 node_1 类型 '{n1_type}' 不是合法节点类型",
                evidence=f"合法类型: {_VALID_NODE_TYPES}",
            ))
        if n2_type not in _VALID_NODE_TYPES:
            errors.append(ValidationError(
                code="LINK-002",
                severity=Severity.P1,
                entityType="links",
                entityId=link_id,
                message=f"Link #{idx} 的 node_2 类型 '{n2_type}' 不是合法节点类型",
                evidence=f"合法类型: {_VALID_NODE_TYPES}",
            ))

        # 4c. ObjectDefinition uid must reference existing object
        if n1_type == "ObjectDefinition" and n1_uid and all_object_ids and n1_uid not in all_object_ids:
            errors.append(ValidationError(
                code="LINK-003",
                severity=Severity.P1,
                entityType="links",
                entityId=link_id,
                message=f"Link #{idx} 的 node_1 ObjectDefinition uid '{n1_uid}' 不在已知对象中",
            ))
        if n2_type == "ObjectDefinition" and n2_uid and all_object_ids and n2_uid not in all_object_ids:
            errors.append(ValidationError(
                code="LINK-003",
                severity=Severity.P1,
                entityType="links",
                entityId=link_id,
                message=f"Link #{idx} 的 node_2 ObjectDefinition uid '{n2_uid}' 不在已知对象中",
            ))

        # 4d. RuleDefinition uid must reference existing rule
        if n1_type == "RuleDefinition" and n1_uid and all_rule_ids:
            if n1_uid not in all_rule_ids:
                errors.append(ValidationError(
                    code="LINK-004",
                    severity=Severity.P1,
                    entityType="links",
                    entityId=link_id,
                    message=f"Link #{idx} 的 node_1 RuleDefinition uid '{n1_uid}' 不在已知规则中",
                ))
        if n2_type == "RuleDefinition" and n2_uid and all_rule_ids:
            if n2_uid not in all_rule_ids:
                errors.append(ValidationError(
                    code="LINK-004",
                    severity=Severity.P1,
                    entityType="links",
                    entityId=link_id,
                    message=f"Link #{idx} 的 node_2 RuleDefinition uid '{n2_uid}' 不在已知规则中",
                ))

        # 4e. Relationship type must be parseable
        if not rel_type:
            errors.append(ValidationError(
                code="LINK-005",
                severity=Severity.P1,
                entityType="links",
                entityId=link_id,
                message=f"Link #{idx} 的 relationship 无法解析类型",
                evidence=rel_str[:100],
            ))

        # 4f. INVOLVES links: node_1 should be RuleDefinition
        if rel_type == "INVOLVES" and n1_type != "RuleDefinition":
            errors.append(ValidationError(
                code="LINK-006",
                severity=Severity.P2,
                entityType="links",
                entityId=link_id,
                message=f"Link #{idx} 的 INVOLVES 关系的 node_1 应为 RuleDefinition，实际为 '{n1_type}'",
            ))

        # 4g. HAS_PROPERTY links: node_1 should be ObjectDefinition, node_2 should be PropertyDefinition
        if rel_type == "HAS_PROPERTY":
            if n1_type != "ObjectDefinition":
                errors.append(ValidationError(
                    code="LINK-007",
                    severity=Severity.P2,
                    entityType="links",
                    entityId=link_id,
                    message=f"Link #{idx} 的 HAS_PROPERTY 关系的 node_1 应为 ObjectDefinition，实际为 '{n1_type}'",
                ))
            if n2_type != "PropertyDefinition":
                errors.append(ValidationError(
                    code="LINK-007",
                    severity=Severity.P2,
                    entityType="links",
                    entityId=link_id,
                    message=f"Link #{idx} 的 HAS_PROPERTY 关系的 node_2 应为 PropertyDefinition，实际为 '{n2_type}'",
                ))

        # 4h. Duplicate link detection
        link_key = f"{n1_type}:{n1_uid}-[{rel_type}]->{n2_type}:{n2_uid}"
        if link_key in seen_link_keys:
            errors.append(ValidationError(
                code="LINK-008",
                severity=Severity.P2,
                entityType="links",
                entityId=link_id,
                message=f"Link #{idx} 与已有 link 重复",
                evidence=link_key,
            ))
        seen_link_keys.add(link_key)

    return errors


# ── Check 5: Ontology (whole-graph runnability) ──────────────────────────────

def check_ontology(
    actions: List[Dict],
    events: List[Dict],
    objects: List[Dict],
    links: List[Dict],
    critical_paths: Optional[List[List[str]]] = None,
) -> Tuple[List[ValidationError], bool, List[dict]]:
    """
    Returns (errors, runnable, runnable_blockers).
    """
    errors: List[ValidationError] = []
    runnable_blockers: List[dict] = []

    event_names: Set[str] = {e.get("name", "") for e in events if e.get("name")}
    action_names: Set[str] = {a.get("name", "") for a in actions if a.get("name")}

    # 5a. Must have at least one start event (source_action=null)
    start_events = []
    for e in events:
        payload = e.get("payload", {})
        if isinstance(payload, dict):
            sa = payload.get("source_action")
            if sa is None or sa == "" or sa == "null":
                start_events.append(e.get("name", ""))
    if not start_events:
        err = ValidationError(
            code="ONTO-001",
            severity=Severity.P0,
            entityType="ontology",
            entityId="global",
            message="本体中不存在起始事件（source_action=null），流程无法启动",
        )
        errors.append(err)
        runnable_blockers.append(err.to_dict())

    # 5b. All action triggers must exist as events
    for action in actions:
        action_name = action.get("name", "UNKNOWN")
        triggers = action.get("trigger", [])
        if isinstance(triggers, list):
            for trig in triggers:
                trig_name = trig.get("name") if isinstance(trig, dict) else str(trig)
                if trig_name and trig_name not in event_names:
                    err = ValidationError(
                        code="ONTO-002",
                        severity=Severity.P0,
                        entityType="ontology",
                        entityId=action_name,
                        message=f"Action '{action_name}' 依赖的触发事件 '{trig_name}' 未定义，流程链断裂",
                    )
                    errors.append(err)
                    runnable_blockers.append(err.to_dict())

    # 5c. All emitted events must have definitions and source_action alignment
    for action in actions:
        action_name = action.get("name", "UNKNOWN")
        triggered = action.get("triggered_event", [])
        if isinstance(triggered, list):
            for te in triggered:
                te_name = te.get("name") if isinstance(te, dict) else str(te)
                if te_name and te_name not in event_names:
                    err = ValidationError(
                        code="ONTO-003",
                        severity=Severity.P0,
                        entityType="ontology",
                        entityId=action_name,
                        message=f"Action '{action_name}' 产出的事件 '{te_name}' 未在事件列表中定义",
                    )
                    errors.append(err)
                    runnable_blockers.append(err.to_dict())
                elif te_name:
                    # Check source_action alignment
                    evt = next((e for e in events if e.get("name") == te_name), None)
                    if evt:
                        payload = evt.get("payload", {})
                        if isinstance(payload, dict):
                            sa = payload.get("source_action")
                            if sa and sa != action_name:
                                errors.append(ValidationError(
                                    code="ONTO-004",
                                    severity=Severity.P1,
                                    entityType="ontology",
                                    entityId=te_name,
                                    message=f"事件 '{te_name}' 的 source_action='{sa}' 与产出它的 Action '{action_name}' 不一致",
                                ))

    # 5d. Dangling objects: objects not referenced by any link or action
    object_ids = {o.get("id") or o.get("name") for o in objects if o.get("id") or o.get("name")}
    referenced_objects: Set[str] = set()
    for link in links:
        _, uid1 = _parse_link_node(link.get("node_1", ""))
        _, uid2 = _parse_link_node(link.get("node_2", ""))
        if uid1:
            referenced_objects.add(uid1)
        if uid2:
            referenced_objects.add(uid2)
    # Also count objects referenced in actions
    for action in actions:
        for so in action.get("source_object", []):
            if isinstance(so, dict):
                referenced_objects.add(so.get("name", ""))
            else:
                referenced_objects.add(str(so))
    dangling = object_ids - referenced_objects
    for d in sorted(dangling):
        if d:
            errors.append(ValidationError(
                code="ONTO-005",
                severity=Severity.P2,
                entityType="ontology",
                entityId=d,
                message=f"对象 '{d}' 未被任何 link 或 action 引用（悬挂节点）",
            ))

    # 5e. Critical path reachability (BFS through action->event chain)
    if critical_paths is None:
        # Default: check if SCHEDULED_SYNC can reach onboardCandidate
        critical_paths = [["SCHEDULED_SYNC", "onboardCandidate"]]

    # Build event->action and action->event graphs
    event_triggers_action: Dict[str, List[str]] = {}  # event_name -> [action_names]
    action_emits_event: Dict[str, List[str]] = {}     # action_name -> [event_names]

    for action in actions:
        aname = action.get("name", "")
        triggers = action.get("trigger", [])
        if isinstance(triggers, list):
            for trig in triggers:
                tname = trig.get("name") if isinstance(trig, dict) else str(trig)
                if tname:
                    event_triggers_action.setdefault(tname, []).append(aname)
        triggered = action.get("triggered_event", [])
        if isinstance(triggered, list):
            for te in triggered:
                tname = te.get("name") if isinstance(te, dict) else str(te)
                if tname:
                    action_emits_event.setdefault(aname, []).append(tname)

    for path_spec in critical_paths:
        if len(path_spec) < 2:
            continue
        start, end = path_spec[0], path_spec[-1]

        # BFS: start from event/action, find if we can reach end event/action
        visited: Set[str] = set()
        queue: List[str] = [start]
        found = False

        while queue:
            current = queue.pop(0)
            if current in visited:
                continue
            visited.add(current)

            if current == end:
                found = True
                break

            # If current is an event, find actions it triggers
            for aname in event_triggers_action.get(current, []):
                queue.append(aname)
            # If current is an action, find events it emits
            for ename in action_emits_event.get(current, []):
                queue.append(ename)

        if not found:
            err = ValidationError(
                code="ONTO-006",
                severity=Severity.P0,
                entityType="ontology",
                entityId="critical_path",
                message=f"关键业务路径不可达: '{start}' -> ... -> '{end}'",
                evidence=f"BFS visited: {sorted(visited)[:15]}",
            )
            errors.append(err)
            runnable_blockers.append(err.to_dict())

    runnable = len(runnable_blockers) == 0
    return errors, runnable, runnable_blockers


# ── Main Entry Point ─────────────────────────────────────────────────────────

def validate_snapshot(
    snapshot: Dict[str, Any],
    strict: bool = False,
    critical_paths: Optional[List[List[str]]] = None,
) -> dict:
    """
    Run all 5 deterministic checks on a snapshot.

    Args:
        snapshot: Ontology snapshot dict with rules/dataobjects/actions/events/links.
        strict: If True, raises ValueError when P0 blockers exist.
        critical_paths: List of [start, end] pairs for reachability checks.

    Returns:
        Finalized ValidationReport dict.
    """
    objects = snapshot.get("dataobjects", [])
    rules = snapshot.get("rules", [])
    actions = snapshot.get("actions", [])
    events = snapshot.get("events", [])
    links = snapshot.get("links", [])

    # Build ID sets
    all_object_ids: Set[str] = set()
    for obj in objects:
        oid = obj.get("id") or obj.get("name")
        if oid:
            all_object_ids.add(oid)

    all_rule_ids: Set[str] = set()
    for rule in rules:
        rid = rule.get("id")
        if rid:
            all_rule_ids.add(str(rid))

    report = ValidationReport()

    # Run all checks
    report.errors.extend(check_objects(objects, all_object_ids))
    report.errors.extend(check_rules(rules, all_object_ids))
    report.errors.extend(check_actions_events(actions, events, all_object_ids))
    report.errors.extend(check_links(links, all_object_ids, all_rule_ids))

    onto_errors, runnable, runnable_blockers = check_ontology(
        actions, events, objects, links, critical_paths
    )
    report.errors.extend(onto_errors)
    report.runnable = runnable
    report.runnableBlockers = runnable_blockers

    result = report.finalize()

    if strict and not result["isDeterministicallyValid"]:
        raise ValueError(
            f"Ontology validation failed with {result['summary']['P0']} P0 blockers. "
            f"Set strict=False to allow warnings-only mode."
        )

    return result
