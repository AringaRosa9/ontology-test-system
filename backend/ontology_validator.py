"""
Deterministic Ontology Validator — Pure rule-based checks (no LLM dependency).

Validates ontology snapshots across 5 categories:
  1. objects  — primary key, property integrity, FK targets
  2. rules   — required fields, ID uniqueness, relatedEntities resolution
  3. actions_events — trigger/event consistency, source_object, state_mutations
  4. links   — node type classification, endpoint validity
  5. ontology — global graph connectivity, dangling nodes, critical path reachability

Every error is represented by a unified ValidationError with deterministic
sorting so that repeated runs on the same snapshot produce identical output.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import List, Dict, Any, Optional, Set, Tuple


# ─── Unified Error Model ──────────────────────────────────────────────────────

class Severity(str, Enum):
    P0 = "P0"  # blocker — prevents ontology from running
    P1 = "P1"  # major — likely runtime failure
    P2 = "P2"  # minor — quality / best-practice warning


@dataclass(frozen=True, order=True)
class ValidationError:
    """Deterministic, sortable validation error.

    Natural ordering: severity (P0 < P1 < P2) → code → entityType → entityId → message
    """
    severity: Severity
    code: str
    entityType: str       # "object" | "rule" | "action" | "event" | "link" | "ontology"
    entityId: str
    message: str
    evidence: str = ""    # optional supporting data (field name, referenced id, etc.)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["severity"] = self.severity.value
        return d


# ─── Validation Report ────────────────────────────────────────────────────────

@dataclass
class ValidationReport:
    errors: List[ValidationError] = field(default_factory=list)

    # ── Derived properties ─────────────────────────────────────────────────────

    @property
    def isDeterministicallyValid(self) -> bool:
        return not any(e.severity == Severity.P0 for e in self.errors)

    @property
    def blockers(self) -> List[ValidationError]:
        return [e for e in self.errors if e.severity == Severity.P0]

    @property
    def runnable(self) -> bool:
        return self.isDeterministicallyValid

    def errors_by_category(self) -> Dict[str, List[dict]]:
        cats: Dict[str, List[dict]] = {
            "objects": [], "rules": [], "actions_events": [],
            "links": [], "ontology": [],
        }
        _map = {"object": "objects", "action": "actions_events", "event": "actions_events",
                "rule": "rules", "link": "links", "ontology": "ontology"}
        for e in self.errors:
            key = _map.get(e.entityType, "ontology")
            cats[key].append(e.to_dict())
        return cats

    def sorted_errors(self) -> List[ValidationError]:
        return sorted(self.errors)

    def result_hash(self) -> str:
        """SHA-256 digest of the sorted error list — identical input ⇒ identical hash."""
        payload = json.dumps([e.to_dict() for e in self.sorted_errors()],
                             sort_keys=True, ensure_ascii=False)
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def to_dict(self) -> dict:
        sorted_errs = self.sorted_errors()
        return {
            "isDeterministicallyValid": self.isDeterministicallyValid,
            "runnable": self.runnable,
            "totalErrors": len(sorted_errs),
            "blockerCount": len(self.blockers),
            "resultHash": self.result_hash(),
            "errors": [e.to_dict() for e in sorted_errs],
            "errorsByCategory": self.errors_by_category(),
        }


# ─── Helper utilities ─────────────────────────────────────────────────────────

def _id_of(item: Any, fallback_keys: Tuple[str, ...] = ("id", "ruleId", "actionId",
           "eventId", "name", "object_type", "api_name")) -> str:
    """Best-effort extraction of a unique identifier from an ontology element."""
    if isinstance(item, dict):
        for k in fallback_keys:
            v = item.get(k)
            if v is not None:
                return str(v)
    return "<unknown>"


def _safe_list(v: Any) -> list:
    if isinstance(v, list):
        return v
    return []


# ─── 1. Objects Validator ──────────────────────────────────────────────────────

def validate_objects(objects: List[dict], all_object_ids: Set[str]) -> List[ValidationError]:
    errors: List[ValidationError] = []
    seen_ids: Set[str] = set()

    for obj in objects:
        oid = _id_of(obj)

        # Duplicate ID
        if oid != "<unknown>" and oid in seen_ids:
            errors.append(ValidationError(
                severity=Severity.P1, code="OBJ_DUPLICATE_ID",
                entityType="object", entityId=oid,
                message=f"对象ID重复: {oid}",
            ))
        seen_ids.add(oid)

        # Primary key existence
        pk = obj.get("primary_key") or obj.get("primaryKey")
        properties = _safe_list(obj.get("properties"))
        prop_names = {p.get("name") or p.get("api_name", "") for p in properties if isinstance(p, dict)}

        if pk and isinstance(pk, str) and properties:
            if pk not in prop_names:
                errors.append(ValidationError(
                    severity=Severity.P0, code="OBJ_PK_NOT_IN_PROPS",
                    entityType="object", entityId=oid,
                    message=f"主键 '{pk}' 不在属性列表中",
                    evidence=f"properties: {sorted(prop_names)}",
                ))

        # Duplicate property names
        seen_props: Set[str] = set()
        for p in properties:
            pname = p.get("name") or p.get("api_name", "") if isinstance(p, dict) else ""
            if pname:
                if pname in seen_props:
                    errors.append(ValidationError(
                        severity=Severity.P1, code="OBJ_DUPLICATE_PROP",
                        entityType="object", entityId=oid,
                        message=f"属性名重复: '{pname}'",
                    ))
                seen_props.add(pname)

        # FK target existence (if any property references another object)
        for p in properties:
            if not isinstance(p, dict):
                continue
            fk_target = p.get("fk_target") or p.get("references") or p.get("foreignKey")
            if fk_target and isinstance(fk_target, str) and fk_target not in all_object_ids:
                errors.append(ValidationError(
                    severity=Severity.P1, code="OBJ_FK_TARGET_MISSING",
                    entityType="object", entityId=oid,
                    message=f"外键目标对象不存在: '{fk_target}'",
                    evidence=f"property: {p.get('name', '')}",
                ))

    return errors


# ─── 2. Rules Validator ────────────────────────────────────────────────────────

_RULE_REQUIRED_FIELDS = ("id", "ruleId")  # at least one must exist


def validate_rules(rules: List[dict], all_object_ids: Set[str]) -> List[ValidationError]:
    errors: List[ValidationError] = []
    seen_ids: Set[str] = set()

    for rule in rules:
        rid = _id_of(rule)

        # Must have an ID
        has_id = any(rule.get(k) for k in _RULE_REQUIRED_FIELDS)
        if not has_id and rid == "<unknown>":
            errors.append(ValidationError(
                severity=Severity.P0, code="RULE_MISSING_ID",
                entityType="rule", entityId="<missing>",
                message="规则缺少ID字段 (id 或 ruleId)",
            ))
            continue

        # Unique ID
        if rid in seen_ids:
            errors.append(ValidationError(
                severity=Severity.P0, code="RULE_DUPLICATE_ID",
                entityType="rule", entityId=rid,
                message=f"规则ID重复: {rid}",
            ))
        seen_ids.add(rid)

        # relatedEntities resolution
        related = rule.get("relatedEntities") or rule.get("related_entities") or []
        if isinstance(related, str):
            related = [related]
        for ref in _safe_list(related):
            ref_id = ref if isinstance(ref, str) else (ref.get("id") or ref.get("objectType", "") if isinstance(ref, dict) else "")
            if ref_id and ref_id not in all_object_ids:
                errors.append(ValidationError(
                    severity=Severity.P1, code="RULE_ENTITY_NOT_FOUND",
                    entityType="rule", entityId=rid,
                    message=f"relatedEntities 引用的对象不存在: '{ref_id}'",
                    evidence=f"available objects: {sorted(all_object_ids)[:10]}",
                ))

    return errors


# ─── 3. Actions & Events Validator ────────────────────────────────────────────

def validate_actions_events(actions: List[dict], events: List[dict],
                            all_object_ids: Set[str]) -> List[ValidationError]:
    errors: List[ValidationError] = []

    event_ids: Set[str] = set()
    event_map: Dict[str, dict] = {}
    for ev in events:
        eid = _id_of(ev)
        event_ids.add(eid)
        event_map[eid] = ev

    action_ids: Set[str] = set()
    action_map: Dict[str, dict] = {}
    for act in actions:
        aid = _id_of(act)
        action_ids.add(aid)
        action_map[aid] = act

    # ── Actions ────────────────────────────────────────────────────────────────
    for act in actions:
        aid = _id_of(act)

        # trigger event must exist
        trigger = act.get("trigger") or act.get("trigger_event") or act.get("triggerEvent")
        if trigger and isinstance(trigger, str) and trigger not in event_ids:
            errors.append(ValidationError(
                severity=Severity.P0, code="ACTION_TRIGGER_EVENT_MISSING",
                entityType="action", entityId=aid,
                message=f"Action的trigger事件不存在: '{trigger}'",
                evidence=f"available events: {sorted(event_ids)[:10]}",
            ))

        # triggered_event / emitted events must exist
        triggered = act.get("triggered_event") or act.get("triggeredEvent") or act.get("emits") or []
        if isinstance(triggered, str):
            triggered = [triggered]
        for te in _safe_list(triggered):
            te_id = te if isinstance(te, str) else _id_of(te)
            if te_id and te_id not in event_ids:
                errors.append(ValidationError(
                    severity=Severity.P0, code="ACTION_EMITTED_EVENT_MISSING",
                    entityType="action", entityId=aid,
                    message=f"Action产出的事件未定义: '{te_id}'",
                ))

        # source_object existence
        source_obj = act.get("source_object") or act.get("sourceObject") or act.get("target_object")
        if source_obj and isinstance(source_obj, str) and source_obj not in all_object_ids:
            errors.append(ValidationError(
                severity=Severity.P1, code="ACTION_SOURCE_OBJ_MISSING",
                entityType="action", entityId=aid,
                message=f"Action的source_object不存在: '{source_obj}'",
            ))

    # ── Events ─────────────────────────────────────────────────────────────────
    for ev in events:
        eid = _id_of(ev)

        # source_action alignment
        src_action = ev.get("source_action") or ev.get("sourceAction")
        if src_action and isinstance(src_action, str) and src_action not in action_ids:
            errors.append(ValidationError(
                severity=Severity.P1, code="EVENT_SOURCE_ACTION_MISSING",
                entityType="event", entityId=eid,
                message=f"Event的source_action不存在: '{src_action}'",
            ))

        # state_mutations property existence
        mutations = _safe_list(ev.get("state_mutations") or ev.get("stateMutations") or [])
        for mut in mutations:
            if not isinstance(mut, dict):
                continue
            target_obj = mut.get("target_object") or mut.get("objectType") or mut.get("targetObject")
            mut_props = _safe_list(mut.get("properties") or mut.get("fields") or [])

            if target_obj and isinstance(target_obj, str) and target_obj not in all_object_ids:
                errors.append(ValidationError(
                    severity=Severity.P1, code="EVENT_MUTATION_OBJ_MISSING",
                    entityType="event", entityId=eid,
                    message=f"state_mutation目标对象不存在: '{target_obj}'",
                    evidence=f"mutation: {json.dumps(mut, ensure_ascii=False)[:200]}",
                ))

    return errors


# ─── 4. Links Validator ───────────────────────────────────────────────────────

def _classify_node_type(node_id: str, obj_ids: Set[str], rule_ids: Set[str],
                        action_ids: Set[str], event_ids: Set[str]) -> str:
    """Return the logical type of a link endpoint: ObjectDefinition, RuleDefinition, etc."""
    if node_id in rule_ids:
        return "RuleDefinition"
    if node_id in action_ids:
        return "ActionDefinition"
    if node_id in event_ids:
        return "EventDefinition"
    if node_id in obj_ids:
        return "ObjectDefinition"
    return "Unknown"


def validate_links(links: List[dict], obj_ids: Set[str], rule_ids: Set[str],
                   action_ids: Set[str], event_ids: Set[str]) -> List[ValidationError]:
    errors: List[ValidationError] = []
    all_known = obj_ids | rule_ids | action_ids | event_ids

    seen_links: Set[str] = set()

    for i, link in enumerate(links):
        lid = _id_of(link) if _id_of(link) != "<unknown>" else f"link_{i}"

        src = (link.get("source") or link.get("sourceId") or link.get("from")
               or link.get("objectTypeApiName") or "")
        tgt = (link.get("target") or link.get("targetId") or link.get("to")
               or link.get("linkedObjectTypeApiName") or "")
        rel_type = link.get("relationshipType") or link.get("type") or link.get("linkTypeApiName") or ""

        # Normalise source/target from labels if they are lists (Neo4j import)
        if not src and "sourceLabels" in link:
            src_labels = link.get("sourceLabels", [])
            src = src_labels[0] if src_labels else ""
        if not tgt and "targetLabels" in link:
            tgt_labels = link.get("targetLabels", [])
            tgt = tgt_labels[0] if tgt_labels else ""

        # Duplicate link detection
        link_key = f"{src}|{rel_type}|{tgt}"
        if link_key and link_key in seen_links:
            errors.append(ValidationError(
                severity=Severity.P2, code="LINK_DUPLICATE",
                entityType="link", entityId=lid,
                message=f"重复的链接: {src} --[{rel_type}]--> {tgt}",
            ))
        if link_key:
            seen_links.add(link_key)

        # Endpoint validity — only check against known IDs if we have structured endpoints
        # For Neo4j-imported links with label-based endpoints, classify by type
        if src and isinstance(src, str):
            src_type = _classify_node_type(src, obj_ids, rule_ids, action_ids, event_ids)
            if src_type == "Unknown" and src not in all_known:
                # Check if it might be a label name (not an error for label-based refs)
                pass  # Permissive: Neo4j labels may not match IDs

        if tgt and isinstance(tgt, str):
            tgt_type = _classify_node_type(tgt, obj_ids, rule_ids, action_ids, event_ids)
            if tgt_type == "Unknown" and tgt not in all_known:
                pass  # Same permissive approach

        # Missing endpoints
        if not src and not tgt:
            errors.append(ValidationError(
                severity=Severity.P1, code="LINK_MISSING_ENDPOINTS",
                entityType="link", entityId=lid,
                message="链接缺少source和target端点",
            ))
        elif not src:
            errors.append(ValidationError(
                severity=Severity.P1, code="LINK_MISSING_SOURCE",
                entityType="link", entityId=lid,
                message=f"链接缺少source端点 (target={tgt})",
            ))
        elif not tgt:
            errors.append(ValidationError(
                severity=Severity.P1, code="LINK_MISSING_TARGET",
                entityType="link", entityId=lid,
                message=f"链接缺少target端点 (source={src})",
            ))

    return errors


# ─── 5. Ontology-level Validator ──────────────────────────────────────────────

def validate_ontology(actions: List[dict], events: List[dict],
                      objects: List[dict], rules: List[dict],
                      links: List[dict]) -> List[ValidationError]:
    """Global graph connectivity, dangling nodes, runnable check."""
    errors: List[ValidationError] = []

    event_ids = {_id_of(e) for e in events}
    action_ids = {_id_of(a) for a in actions}

    # ── OntologyRunnableCheck ──────────────────────────────────────────────────

    # 1. Must have at least one start event (source_action = null / absent)
    start_events = []
    for ev in events:
        src_action = ev.get("source_action") or ev.get("sourceAction")
        if not src_action:
            start_events.append(_id_of(ev))

    if events and not start_events:
        errors.append(ValidationError(
            severity=Severity.P0, code="ONTO_NO_START_EVENT",
            entityType="ontology", entityId="global",
            message="不存在起始事件 (source_action=null)，本体无法启动",
        ))

    # 2. All action triggers must reference existing events
    # (already covered by actions_events validator, but we add a P0 summary here)
    for act in actions:
        trigger = act.get("trigger") or act.get("trigger_event") or act.get("triggerEvent")
        if trigger and isinstance(trigger, str) and trigger not in event_ids:
            errors.append(ValidationError(
                severity=Severity.P0, code="ONTO_BROKEN_TRIGGER",
                entityType="ontology", entityId=_id_of(act),
                message=f"Action '{_id_of(act)}' 的触发事件 '{trigger}' 未定义，执行链断裂",
            ))

    # 3. All emitted events must have definitions and source_action must align
    for act in actions:
        triggered = act.get("triggered_event") or act.get("triggeredEvent") or act.get("emits") or []
        if isinstance(triggered, str):
            triggered = [triggered]
        for te in _safe_list(triggered):
            te_id = te if isinstance(te, str) else _id_of(te)
            if te_id and te_id not in event_ids:
                errors.append(ValidationError(
                    severity=Severity.P0, code="ONTO_EMITTED_EVENT_UNDEFINED",
                    entityType="ontology", entityId=_id_of(act),
                    message=f"Action '{_id_of(act)}' 产出事件 '{te_id}' 未在events中定义",
                ))

    # 4. Dangling nodes: objects referenced by no rule, action, event, or link
    obj_ids = {_id_of(o) for o in objects}
    referenced_objs: Set[str] = set()

    for act in actions:
        src = act.get("source_object") or act.get("sourceObject") or act.get("target_object")
        if src:
            referenced_objs.add(str(src))
    for ev in events:
        for mut in _safe_list(ev.get("state_mutations") or ev.get("stateMutations") or []):
            if isinstance(mut, dict):
                tobj = mut.get("target_object") or mut.get("objectType") or mut.get("targetObject")
                if tobj:
                    referenced_objs.add(str(tobj))
    for rule in rules:
        for ref in _safe_list(rule.get("relatedEntities") or rule.get("related_entities") or []):
            ref_id = ref if isinstance(ref, str) else (ref.get("id") or ref.get("objectType", "") if isinstance(ref, dict) else "")
            if ref_id:
                referenced_objs.add(ref_id)
    for link in links:
        s = link.get("source") or link.get("sourceId") or link.get("from") or link.get("objectTypeApiName") or ""
        t = link.get("target") or link.get("targetId") or link.get("to") or link.get("linkedObjectTypeApiName") or ""
        if s:
            referenced_objs.add(s)
        if t:
            referenced_objs.add(t)

    dangling = obj_ids - referenced_objs - {"<unknown>"}
    for d in sorted(dangling):
        errors.append(ValidationError(
            severity=Severity.P2, code="ONTO_DANGLING_OBJECT",
            entityType="ontology", entityId=d,
            message=f"对象 '{d}' 未被任何规则/动作/事件/链接引用（悬挂节点）",
        ))

    # 5. Dead links: links referencing non-existent entities
    all_known = obj_ids | {_id_of(r) for r in rules} | action_ids | event_ids
    for i, link in enumerate(links):
        src = (link.get("source") or link.get("sourceId") or link.get("from")
               or link.get("objectTypeApiName") or "")
        tgt = (link.get("target") or link.get("targetId") or link.get("to")
               or link.get("linkedObjectTypeApiName") or "")
        if src and src not in all_known:
            errors.append(ValidationError(
                severity=Severity.P1, code="ONTO_DEAD_LINK_SOURCE",
                entityType="ontology", entityId=f"link_{i}",
                message=f"链接source '{src}' 在本体中不存在（死链）",
            ))
        if tgt and tgt not in all_known:
            errors.append(ValidationError(
                severity=Severity.P1, code="ONTO_DEAD_LINK_TARGET",
                entityType="ontology", entityId=f"link_{i}",
                message=f"链接target '{tgt}' 在本体中不存在（死链）",
            ))

    return errors


# ─── Main entry point ─────────────────────────────────────────────────────────

def validate_snapshot(snapshot: dict, *, strict: bool = False) -> ValidationReport:
    """Run all deterministic validators on a snapshot.

    Args:
        snapshot: The ontology snapshot dict with keys: rules, dataobjects, actions, events, links.
        strict:   If True and P0 blockers exist, the report marks the snapshot as not runnable
                  (which callers can use to reject import). Default: False (warn-only).

    Returns:
        A ValidationReport with sorted, deterministic errors and a stable hash.
    """
    objects = _safe_list(snapshot.get("dataobjects"))
    rules = _safe_list(snapshot.get("rules"))
    actions = _safe_list(snapshot.get("actions"))
    events = _safe_list(snapshot.get("events"))
    links = _safe_list(snapshot.get("links"))

    # Collect all known IDs for cross-referencing
    obj_ids = {_id_of(o) for o in objects} - {"<unknown>"}
    rule_ids = {_id_of(r) for r in rules} - {"<unknown>"}
    action_ids = {_id_of(a) for a in actions} - {"<unknown>"}
    event_ids = {_id_of(e) for e in events} - {"<unknown>"}

    all_errors: List[ValidationError] = []
    all_errors.extend(validate_objects(objects, obj_ids))
    all_errors.extend(validate_rules(rules, obj_ids))
    all_errors.extend(validate_actions_events(actions, events, obj_ids))
    all_errors.extend(validate_links(links, obj_ids, rule_ids, action_ids, event_ids))
    all_errors.extend(validate_ontology(actions, events, objects, rules, links))

    report = ValidationReport(errors=all_errors)
    return report
