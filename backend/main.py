"""
RAAS Ontology Testing Platform — FastAPI Backend

Full-stack backend for ontology upload, LLM-based test case generation,
test execution, report generation, and deterministic ontology validation.
"""
from dotenv import load_dotenv
load_dotenv()

import json
import uuid
import os
import csv
import io
import logging
import asyncio
import threading
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List, Dict, Union, Any

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from ontology_validator import validate_snapshot as _validate_snapshot

# ─── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(title="RAAS Ontology Testing Platform", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("raas")

DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)

# ─── Storage ──────────────────────────────────────────────────────────────────

SNAPSHOTS_FILE = DATA_DIR / "snapshots.json"
CASES_FILE = DATA_DIR / "generated_cases.json"
RUNS_FILE = DATA_DIR / "test_runs.json"
BUSINESS_DATA_FILE = DATA_DIR / "business_data.json"
API_KEYS_FILE = DATA_DIR / "api_keys.json"
LIBRARY_FILE = DATA_DIR / "test_case_library.json"


def _load_json(path: Path) -> list:
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return []
    return []


def _save_json(path: Path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, default=str), encoding="utf-8")


_lock = threading.RLock()
_snapshots: List[Dict] = _load_json(SNAPSHOTS_FILE)
_cases: List[Dict] = _load_json(CASES_FILE)
_runs: List[Dict] = _load_json(RUNS_FILE)
_business_data: List[Dict] = _load_json(BUSINESS_DATA_FILE)
_api_keys: List[Dict] = _load_json(API_KEYS_FILE)
_library: List[Dict] = _load_json(LIBRARY_FILE)


def _persist_snapshots():
    _save_json(SNAPSHOTS_FILE, _snapshots)


def _persist_cases():
    _save_json(CASES_FILE, _cases)


def _persist_runs():
    _save_json(RUNS_FILE, _runs)


def _persist_business_data():
    _save_json(BUSINESS_DATA_FILE, _business_data)


def _persist_api_keys():
    _save_json(API_KEYS_FILE, _api_keys)


def _persist_library():
    _save_json(LIBRARY_FILE, _library)


# ─── Gemini LLM Client ───────────────────────────────────────────────────────

try:
    from google import genai as _genai
    from google.genai import types as _types
    _GENAI_OK = True
except Exception:
    _genai = None
    _types = None
    _GENAI_OK = False


# Ordered list of fallback models to try if the primary model fails (404 / unavailable)
_FALLBACK_MODELS = [
    "gemini-3.0-pro",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
]


class GeminiClient:
    def __init__(self):
        self._env_keys = [k for k in [os.getenv("GEMINI_API_KEY_1", ""), os.getenv("GEMINI_API_KEY_2", "")] if k]
        self._model = os.getenv("GEMINI_MODEL", "gemini-3.0-pro")
        self._idx = 0
        self.last_error: Optional[str] = None  # stores last LLM error for callers

    @property
    def _keys(self):
        """Dynamically load keys: active persisted keys first, then env keys as fallback."""
        persisted = [k["key"] for k in _api_keys if k.get("isActive") and k.get("provider") == "gemini"]
        all_keys = persisted + [k for k in self._env_keys if k not in persisted]
        return all_keys if all_keys else self._env_keys

    @property
    def _active_key_model(self) -> Optional[str]:
        """Return model from the first active persisted Gemini key (if set via UI)."""
        for k in _api_keys:
            if k.get("isActive") and k.get("provider") == "gemini" and k.get("model"):
                return k["model"]
        return None

    @property
    def is_configured(self):
        return _GENAI_OK and len(self._keys) > 0

    def _models_to_try(self) -> list:
        """Return models to attempt: active-key model first (if set), then primary, then fallbacks (deduped)."""
        candidates = []
        active_model = self._active_key_model
        if active_model:
            candidates.append(active_model)
        candidates.append(self._model)
        candidates.extend(_FALLBACK_MODELS)
        seen = set()
        result = []
        for m in candidates:
            if m not in seen:
                seen.add(m)
                result.append(m)
        return result

    async def generate_json(self, system: str, prompt: str, temp: float = 0.7):
        if not self.is_configured:
            self.last_error = "LLM未配置：请在API Key管理中添加有效的Gemini API Key"
            return None
        self.last_error = None
        errors = []
        for model in self._models_to_try():
            for attempt in range(len(self._keys)):
                idx = (self._idx + attempt) % len(self._keys)
                try:
                    client = _genai.Client(api_key=self._keys[idx])
                    resp = await asyncio.to_thread(
                        client.models.generate_content,
                        model=model,
                        contents=prompt,
                        config=_types.GenerateContentConfig(
                            system_instruction=system,
                            temperature=temp,
                            response_mime_type="application/json",
                        ),
                    )
                    raw = (getattr(resp, "text", "") or "").strip()
                    if not raw:
                        continue
                    parsed = json.loads(raw)
                    self._idx = idx
                    if model != self._model:
                        logger.info(f"Used fallback model {model} (primary={self._model} failed)")
                    return parsed
                except Exception as e:
                    err_str = str(e)
                    logger.warning(f"Gemini key {idx} model {model} failed: {err_str[:200]}")
                    # If model is unavailable (404) for ALL keys, skip to next model
                    if "404" in err_str or "NOT_FOUND" in err_str or "no longer available" in err_str:
                        errors.append(f"模型 {model} 不可用 (404)")
                        break  # try next model immediately
                    elif "429" in err_str or "RESOURCE_EXHAUSTED" in err_str or "quota" in err_str.lower():
                        errors.append(f"模型 {model} Key{idx+1} 配额已用尽 (429)")
                        continue  # try next key
                    else:
                        errors.append(f"模型 {model} Key{idx+1}: {err_str[:100]}")
                        continue
        self.last_error = "LLM调用失败：" + "；".join(errors[-3:]) if errors else "未知错误"
        logger.error(f"All Gemini attempts failed: {self.last_error}")
        return None

    async def generate_text(self, prompt: str, system: str = "", temp: float = 0.7):
        if not self.is_configured:
            return "[LLM unavailable]"
        for model in self._models_to_try():
            for attempt in range(len(self._keys)):
                idx = (self._idx + attempt) % len(self._keys)
                try:
                    client = _genai.Client(api_key=self._keys[idx])
                    cfg_kw = {"temperature": temp}
                    if system:
                        cfg_kw["system_instruction"] = system
                    resp = await asyncio.to_thread(
                        client.models.generate_content,
                        model=model,
                        contents=prompt,
                        config=_types.GenerateContentConfig(**cfg_kw),
                    )
                    text = (getattr(resp, "text", "") or "").strip()
                    if text:
                        self._idx = idx
                        return text
                except Exception as e:
                    err_str = str(e)
                    logger.warning(f"Gemini text key {idx} model {model} failed: {err_str[:200]}")
                    if "404" in err_str or "NOT_FOUND" in err_str:
                        break  # model unavailable, try next model
        return "[LLM unavailable]"


gemini = GeminiClient()


# ─── Schemas ──────────────────────────────────────────────────────────────────

class UploadResponse(BaseModel):
    snapshotId: str
    sourceFiles: List[str]
    rulesCount: int = 0
    dataObjectsCount: int = 0
    actionsCount: int = 0
    eventsCount: int = 0
    linksCount: int = 0
    createdAt: str


class GenerateRequest(BaseModel):
    snapshotId: str
    component: str = "all"
    strategies: List[str] = ["counter_example", "conflict", "boundary", "omission", "challenge"]


class ExecuteRequest(BaseModel):
    snapshotId: str
    caseIds: List[str] = []
    executionMode: str = "full"  # full | component


class ReportRequest(BaseModel):
    runId: str


class LibraryCaseCreate(BaseModel):
    title: str
    description: str
    category: str  # dataobjects | actions_events | rules | links | ontology
    tags: List[str] = []
    priority: str = "P1"
    inputVariables: Dict[str, Any] = {}
    expectedOutcome: str = ""
    steps: List[str] = []


class LibraryCaseUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    tags: Optional[List[str]] = None
    priority: Optional[str] = None
    inputVariables: Optional[Dict[str, Any]] = None
    expectedOutcome: Optional[str] = None
    steps: Optional[List[str]] = None


class LibraryAIGenerateRequest(BaseModel):
    category: str = "dataobjects"
    snapshotId: str
    count: int = 10


# ─── Health ───────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "llm_configured": gemini.is_configured}


# ─── Ontology Upload ─────────────────────────────────────────────────────────

def _parse_ontology_json(raw, filename: str) -> dict:
    """Normalize various JSON formats into a unified ontology dict."""
    sections = {"rules": [], "dataobjects": [], "actions": [], "events": [], "links": []}

    fname = filename.lower()

    if isinstance(raw, list):
        # Detect section by filename
        if "rule" in fname:
            sections["rules"] = raw
        elif "dataobject" in fname or "data_object" in fname:
            sections["dataobjects"] = raw
        elif "action" in fname:
            sections["actions"] = raw
        elif "event" in fname:
            sections["events"] = raw
        elif "link" in fname:
            sections["links"] = raw
        else:
            sections["rules"] = raw
    elif isinstance(raw, dict):
        # First pass: match exact section keys
        for key in sections:
            if key in raw:
                val = raw[key]
                sections[key] = val if isinstance(val, list) else [val]

        # Second pass: if dataobjects still empty but file is a dataobjects file,
        # look for common alternative keys like 'objects'
        if not sections["dataobjects"] and ("dataobject" in fname or "data_object" in fname):
            for alt_key in ("objects", "data_objects", "dataObjects", "items"):
                if alt_key in raw and isinstance(raw[alt_key], list):
                    sections["dataobjects"] = raw[alt_key]
                    break

        # Similarly handle other sections with alternative keys
        if not sections["rules"] and "rule" in fname:
            for alt_key in ("rule_list", "ruleList", "items"):
                if alt_key in raw and isinstance(raw[alt_key], list):
                    sections["rules"] = raw[alt_key]
                    break
        if not sections["actions"] and "action" in fname:
            for alt_key in ("action_list", "actionList", "items"):
                if alt_key in raw and isinstance(raw[alt_key], list):
                    sections["actions"] = raw[alt_key]
                    break
        if not sections["events"] and "event" in fname:
            for alt_key in ("event_list", "eventList", "items"):
                if alt_key in raw and isinstance(raw[alt_key], list):
                    sections["events"] = raw[alt_key]
                    break
        if not sections["links"] and "link" in fname:
            for alt_key in ("link_list", "linkList", "relationships", "items"):
                if alt_key in raw and isinstance(raw[alt_key], list):
                    sections["links"] = raw[alt_key]
                    break
    return sections


@app.post("/ontology/upload")
async def upload_ontology(
    file: UploadFile = File(...),
    description: Optional[str] = Form(None),
):
    content = await file.read()
    filename = file.filename or "unknown.json"

    try:
        raw = json.loads(content.decode("utf-8"))
    except Exception:
        raise HTTPException(400, "无法解析JSON文件")

    sections = _parse_ontology_json(raw, filename)

    snapshot_id = f"snap_{int(datetime.now(timezone.utc).timestamp())}_{uuid.uuid4().hex[:8]}"

    snapshot = {
        "snapshotId": snapshot_id,
        "sourceFiles": [filename],
        "description": description or filename,
        "rules": sections["rules"],
        "dataobjects": sections["dataobjects"],
        "actions": sections["actions"],
        "events": sections["events"],
        "links": sections["links"],
        "rulesCount": len(sections["rules"]),
        "dataObjectsCount": len(sections["dataobjects"]),
        "actionsCount": len(sections["actions"]),
        "eventsCount": len(sections["events"]),
        "linksCount": len(sections["links"]),
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }

    with _lock:
        # Merge into existing snapshot if same source detected
        existing = None
        for s in _snapshots:
            if abs(datetime.fromisoformat(s["createdAt"]).timestamp() -
                   datetime.now(timezone.utc).timestamp()) < 60:
                existing = s
                break

        if existing:
            for key in ["rules", "dataobjects", "actions", "events", "links"]:
                if sections[key]:
                    existing[key] = sections[key]
                    existing[f"{key}Count" if key != "dataobjects" else "dataObjectsCount"] = len(sections[key])
            existing["sourceFiles"].append(filename)
            # Recalculate counts
            existing["rulesCount"] = len(existing["rules"])
            existing["dataObjectsCount"] = len(existing["dataobjects"])
            existing["actionsCount"] = len(existing["actions"])
            existing["eventsCount"] = len(existing["events"])
            existing["linksCount"] = len(existing["links"])
            snapshot = existing
        else:
            _snapshots.insert(0, snapshot)

        _persist_snapshots()

    # Run deterministic validation on upload
    validation_report = _validate_snapshot(snapshot)
    snapshot["validationReport"] = validation_report
    with _lock:
        _persist_snapshots()

    return {"status": "ok", "data": {
        "snapshotId": snapshot["snapshotId"],
        "sourceFiles": snapshot["sourceFiles"],
        "rulesCount": snapshot["rulesCount"],
        "dataObjectsCount": snapshot["dataObjectsCount"],
        "actionsCount": snapshot["actionsCount"],
        "eventsCount": snapshot["eventsCount"],
        "linksCount": snapshot["linksCount"],
        "createdAt": snapshot["createdAt"],
        "validationReport": validation_report,
    }}


@app.get("/ontology/snapshots")
async def list_snapshots():
    summaries = []
    for s in _snapshots:
        summaries.append({
            "snapshotId": s["snapshotId"],
            "sourceFiles": s.get("sourceFiles", []),
            "description": s.get("description", ""),
            "rulesCount": s.get("rulesCount", 0),
            "dataObjectsCount": s.get("dataObjectsCount", 0),
            "actionsCount": s.get("actionsCount", 0),
            "eventsCount": s.get("eventsCount", 0),
            "linksCount": s.get("linksCount", 0),
            "createdAt": s.get("createdAt", ""),
        })
    return {"status": "ok", "data": summaries}


@app.get("/ontology/snapshots/{snapshot_id}")
async def get_snapshot(snapshot_id: str):
    for s in _snapshots:
        if s["snapshotId"] == snapshot_id:
            return {"status": "ok", "data": s}
    raise HTTPException(404, "快照不存在")


@app.delete("/ontology/snapshots/{snapshot_id}")
async def delete_snapshot(snapshot_id: str):
    with _lock:
        before = len(_snapshots)
        _snapshots[:] = [s for s in _snapshots if s["snapshotId"] != snapshot_id]
        if len(_snapshots) < before:
            _persist_snapshots()
            return {"status": "ok"}
    raise HTTPException(404, "快照不存在")


# ─── LLM Prompt Templates ────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are an expert Palantir Ontology test architect specializing in HRO (Human Resource Outsourcing) recruitment systems.

You will receive ontology definitions (rules, dataobjects, actions, events, links) and must generate comprehensive test cases.

Your test case categories follow these patterns:
- **DataObjects**: Schema validation (primary key, property types, naming), FK integrity, state mutation coverage
- **Actions/Events**: Trigger validation, I/O contracts, step execution ordering, side effects, event chain compatibility
- **Rules**: Submission criteria, hard-requirement veto, salary/career-gap logic, client-specific red lines (Tencent/ByteDance), human-executor approval flows
- **Links**: Endpoint validity, cardinality, graph reachability, Object-Rule associations

Each test case MUST include: caseId, component, strategy, description, inputVariables (object), expectedOutcome (string), priority (P0/P1/P2).
Return a JSON array of test case objects."""

COMPONENT_PROMPTS = {
    "dataobjects": """Generate test cases for DataObjects component:
1. Schema Definition Tests: Verify primary_key exists, all properties have name/type/description, naming follows snake_case, no duplicate properties
2. Property Type & Constraint Tests: String/Integer/Enum/List type validation, required field nullability
3. Object Relationship Tests: FK integrity between objects (e.g., Job_Requisition.job_requisition_specification_id references valid Job_Requisition_Specification)
4. State Mutation Coverage Tests: Verify event state_mutations reference valid properties, CREATE produces complete records, MODIFY updates only declared properties""",

    "actions_events": """Generate test cases for Actions & Events:
1. Trigger & Precondition Tests: Action triggers on correct event, rejects wrong event type, blocks when submission_criteria not met
2. Input/Output Contract Tests: All required inputs present, type validation, output completeness
3. Action Step Execution Tests: Steps execute in declared order, conditions evaluated, embedded rules enforced
4. Side Effect Tests: data_changes create/modify correct objects, notifications sent correctly, side effects don't fire on failure
5. Event Payload & State Mutation Tests: Payload completeness, mutation accuracy, chain compatibility""",

    "rules": """Generate test cases for Rules:
1. Rule Submission Criteria Tests: Rule fires when criteria met, blocks when partially met
2. Standardized Logic Tests: Hard-requirement veto (degree, skills, gender, age), salary expectation logic, career gap detection, competitor no-poach
3. Client-Specific Tests: Tencent IEG active process blocking, relative conflict detection; ByteDance stale resume re-push, HC-frozen recall, age limits
4. Human-Executor Tests: HSM verification task routing, approval/rejection flows, multi-tier VP approval
5. Rule Applicability Tests: Universal rule scope, client isolation, department isolation""",

    "links": """Generate test cases for Links (Relationships):
1. Structural Tests: Both endpoints reference valid ObjectDefinitions, relationship type is valid, no duplicates
2. Cardinality & Directionality Tests: HAS_MANY implies 1:N, BELONGS_TO implies N:1, bidirectional consistency
3. Graph Connectivity Tests: Full recruitment path traversable, no orphaned objects, blacklist guard exists
4. Object-Rule Association Tests: Rule relatedEntities match INVOLVES links, client-specific rule scoping
5. Action-Object Dependency Tests: Action target_objects match referenced objects""",
}

E2E_PROMPT = """生成跨越所有本体层的端到端集成测试用例（所有输出必须使用中文）：
1. Action 内嵌规则引用的规则在 rules 定义中确实存在
2. Action 的 triggered_event 与事件目录匹配
3. Event 的 source_action 能回溯到产生它的 Action
4. Action 输入的 source_object 引用了有效的 DataObject 属性
5. Event 的 state_mutations 属性在目标 DataObject 中已定义
6. Link 的 INVOLVES 条目覆盖了规则的 relatedEntities
7. 完整 E2E 流水线：SCHEDULED_SYNC → syncFromClientSystem → REQUIREMENT_SYNCED → ... → onboardCandidate"""


# ─── Test Case Generation ─────────────────────────────────────────────────────

@app.post("/generator/component-test")
async def generate_component_test(request: GenerateRequest):
    snap = None
    for s in _snapshots:
        if s["snapshotId"] == request.snapshotId:
            snap = s
            break
    if not snap:
        raise HTTPException(404, "快照不存在")

    component = request.component
    if component == "all":
        components = ["dataobjects", "actions_events", "rules", "links"]
    else:
        components = [component]

    all_cases = []
    for comp in components:
        comp_prompt = COMPONENT_PROMPTS.get(comp, COMPONENT_PROMPTS["rules"])

        # Build ontology context for this component
        context_parts = []
        if comp == "dataobjects":
            context_parts.append(f"DataObjects ({len(snap.get('dataobjects', []))} objects):\n{json.dumps(snap.get('dataobjects', [])[:10], ensure_ascii=False, indent=1)}")
        elif comp == "actions_events":
            context_parts.append(f"Actions ({len(snap.get('actions', []))} actions):\n{json.dumps(snap.get('actions', [])[:5], ensure_ascii=False, indent=1)}")
            context_parts.append(f"Events ({len(snap.get('events', []))} events):\n{json.dumps(snap.get('events', [])[:5], ensure_ascii=False, indent=1)}")
        elif comp == "rules":
            context_parts.append(f"Rules ({len(snap.get('rules', []))} rules):\n{json.dumps(snap.get('rules', [])[:15], ensure_ascii=False, indent=1)}")
        elif comp == "links":
            context_parts.append(f"Links ({len(snap.get('links', []))} links):\n{json.dumps(snap.get('links', [])[:10], ensure_ascii=False, indent=1)}")

        ontology_context = "\n\n".join(context_parts)
        strategies_text = ", ".join(request.strategies)

        prompt = f"""{comp_prompt}

## Ontology Context
{ontology_context}

## Required Strategies
Generate 2-3 test cases for each of these strategies: {strategies_text}

## Output Format
Return a JSON array. Each object must have:
- caseId: string (format: "TC-{comp.upper()}-XXX")
- component: "{comp}"
- strategy: one of [{strategies_text}]
- description: string (detailed test scenario in Chinese)
- inputVariables: object (test input data)
- expectedOutcome: string (expected result description)
- priority: "P0" | "P1" | "P2"
- testCategory: string (which subcategory this tests)"""

        result = await gemini.generate_json(SYSTEM_PROMPT, prompt, temp=0.4)
        if result is None:
            raise HTTPException(500, gemini.last_error or "LLM调用失败，请检查API Key配置")
        cases = result if isinstance(result, list) else result.get("testCases", result.get("cases", []))
        for c in cases:
            c["snapshotId"] = request.snapshotId
            c["component"] = comp
            c["generatedAt"] = datetime.now(timezone.utc).isoformat()
        all_cases.extend(cases)

    # Persist generated cases
    with _lock:
        _cases.extend(all_cases)
        _persist_cases()

    return {"status": "ok", "data": {
        "generated": all_cases,
        "totalCount": len(all_cases),
    }}


@app.post("/generator/e2e-test")
async def generate_e2e_test(request: GenerateRequest):
    snap = None
    for s in _snapshots:
        if s["snapshotId"] == request.snapshotId:
            snap = s
            break
    if not snap:
        raise HTTPException(404, "快照不存在")

    context = f"""Full Ontology Summary:
- Rules: {len(snap.get('rules', []))} rules
- DataObjects: {len(snap.get('dataobjects', []))} objects
- Actions: {len(snap.get('actions', []))} actions
- Events: {len(snap.get('events', []))} events
- Links: {len(snap.get('links', []))} links

Sample Rules: {json.dumps(snap.get('rules', [])[:5], ensure_ascii=False, indent=1)}
Sample Actions: {json.dumps(snap.get('actions', [])[:3], ensure_ascii=False, indent=1)}
Sample Events: {json.dumps(snap.get('events', [])[:3], ensure_ascii=False, indent=1)}
Sample Links: {json.dumps(snap.get('links', [])[:5], ensure_ascii=False, indent=1)}"""

    prompt = f"""{E2E_PROMPT}

## 本体上下文
{context}

## 输出格式
返回一个包含 5-8 个 E2E 测试用例的 JSON 数组。所有文本字段必须使用中文。每个对象必须包含：
- caseId: string (格式: "TC-E2E-XXX")
- component: "e2e"
- strategy: "integration"
- description: string (详细的中文测试场景描述)
- inputVariables: object (测试输入数据)
- expectedOutcome: string (中文的预期结果描述)
- expectedWorkflow: array of step strings (中文的步骤描述)
- crossReferences: array of referenced component types
- priority: "P0" | "P1"
"""

    result = await gemini.generate_json(SYSTEM_PROMPT, prompt, temp=0.4)
    if result is None:
        raise HTTPException(500, gemini.last_error or "LLM调用失败，请检查API Key配置")
    cases = result if isinstance(result, list) else result.get("testCases", result.get("cases", []))
    for c in cases:
        c["snapshotId"] = request.snapshotId
        c["component"] = "e2e"
        c["generatedAt"] = datetime.now(timezone.utc).isoformat()

    with _lock:
        _cases.extend(cases)
        _persist_cases()

    return {"status": "ok", "data": {"generated": cases, "totalCount": len(cases)}}


@app.post("/generator/full-suite")
async def generate_full_suite(request: GenerateRequest):
    """One-click: generate all component tests + E2E tests."""
    comp_result = await generate_component_test(GenerateRequest(
        snapshotId=request.snapshotId,
        component="all",
        strategies=request.strategies,
    ))
    e2e_result = await generate_e2e_test(request)

    comp_cases = comp_result["data"]["generated"]
    e2e_cases = e2e_result["data"]["generated"]

    return {"status": "ok", "data": {
        "componentCases": comp_cases,
        "e2eCases": e2e_cases,
        "totalGenerated": len(comp_cases) + len(e2e_cases),
        "message": f"生成完成: {len(comp_cases)} 组件用例 + {len(e2e_cases)} E2E用例",
    }}


@app.get("/generator/cases")
async def list_generated_cases(snapshotId: Optional[str] = None):
    if snapshotId:
        filtered = [c for c in _cases if c.get("snapshotId") == snapshotId]
    else:
        filtered = _cases
    return {"status": "ok", "data": filtered}


# ─── Enrich failedNode with ontology rule details ────────────────────────────

def _enrich_failed_node(fn: dict, rules_list: list):
    """Given a failedNode dict and the ontology rules list, inject rule detail fields."""
    if not fn or not isinstance(fn, dict):
        return
    rn = fn.get("ruleName", "")
    for rule in rules_list:
        rule_name = rule.get("name", rule.get("ruleName", rule.get("businessLogicRuleName", "")))
        if rule_name and rule_name == rn:
            for field in ("id", "specificScenarioStage", "businessLogicRuleName",
                          "applicableClient", "applicableDepartment",
                          "standardizedLogicRule", "relatedEntities"):
                if field in rule and field not in fn:
                    fn[field] = rule[field]
            break


# ─── Test Execution ──────────────────────────────────────────────────────────

@app.post("/executor/run")
async def execute_tests(request: ExecuteRequest):
    snap = None
    for s in _snapshots:
        if s["snapshotId"] == request.snapshotId:
            snap = s
            break
    if not snap:
        raise HTTPException(404, "快照不存在")

    # Get test cases
    if request.caseIds:
        cases = [c for c in _cases if c.get("caseId") in request.caseIds]
    else:
        cases = [c for c in _cases if c.get("snapshotId") == request.snapshotId]

    if not cases:
        raise HTTPException(400, "没有可执行的测试用例")

    # Build execution context
    cases_summary = json.dumps([{
        "caseId": c.get("caseId"),
        "component": c.get("component"),
        "description": c.get("description"),
        "inputVariables": c.get("inputVariables"),
        "expectedOutcome": c.get("expectedOutcome"),
    } for c in cases[:100]], ensure_ascii=False, indent=1)

    ontology_summary = f"""Rules: {len(snap.get('rules', []))}
DataObjects: {len(snap.get('dataobjects', []))}
Actions: {len(snap.get('actions', []))}
Events: {len(snap.get('events', []))}
Links: {len(snap.get('links', []))}"""

    exec_prompt = f"""You are evaluating test cases against an HRO ontology.

## Ontology Summary
{ontology_summary}

## Test Cases to Evaluate
{cases_summary}

For each test case, evaluate whether it would PASS or FAIL against the ontology definitions.
Consider: schema validity, rule triggering, action preconditions, event chain correctness, link integrity.

Return a JSON array where each object has:
- caseId: string (matching the input)
- verdict: "PASS" | "FAIL" | "WARNING"
- triggeredRules: array of rule IDs that would fire
- reasoning: string (brief explanation)
- assertionResults: array of {{assertion: string, expected: string, actual: string, passed: boolean}}
- executionDurationMs: number (simulated)
- failedNode: (only when verdict is FAIL) object with {{ruleName: string, ruleDescription: string, brokenLink: string or null, funnelStage: string, failureType: string, contextSnapshot: object}}
"""

    result = await gemini.generate_json(SYSTEM_PROMPT, exec_prompt, temp=0.3)
    records = []

    if result:
        raw_records = result if isinstance(result, list) else result.get("results", result.get("records", []))
        rules_list = snap.get("rules", []) if snap else []
        for r in raw_records:
            r["recordId"] = f"rec_{uuid.uuid4().hex[:8]}"
            r["executedAt"] = datetime.now(timezone.utc).isoformat()
            r["snapshotId"] = request.snapshotId
            _enrich_failed_node(r.get("failedNode"), rules_list)
            records.append(r)
    else:
        for c in cases:
            records.append({
                "recordId": f"rec_{uuid.uuid4().hex[:8]}",
                "caseId": c.get("caseId"),
                "verdict": "ERROR",
                "reasoning": "LLM evaluation unavailable",
                "triggeredRules": [],
                "assertionResults": [],
                "executionDurationMs": 0,
                "executedAt": datetime.now(timezone.utc).isoformat(),
                "snapshotId": request.snapshotId,
            })

    # Build run
    run_id = f"run_{uuid.uuid4().hex[:8]}"
    passed = sum(1 for r in records if r.get("verdict") == "PASS")
    failed = sum(1 for r in records if r.get("verdict") in ("FAIL", "ERROR"))
    warnings = sum(1 for r in records if r.get("verdict") == "WARNING")

    run = {
        "runId": run_id,
        "snapshotId": request.snapshotId,
        "executionMode": request.executionMode,
        "totalCases": len(records),
        "passedCases": passed,
        "failedCases": failed,
        "warningCases": warnings,
        "coverageRate": round(passed / max(len(records), 1), 2),
        "records": records,
        "executedAt": datetime.now(timezone.utc).isoformat(),
    }

    with _lock:
        _runs.insert(0, run)
        _persist_runs()

    return {"status": "ok", "data": run}


class ExecuteLibraryRequest(BaseModel):
    snapshotId: str
    categories: List[str] = []   # empty = all categories
    caseIds: List[str] = []      # empty = all in selected categories


@app.post("/executor/run-library")
async def execute_library_tests(request: ExecuteLibraryRequest):
    """Execute test cases sourced from the library (not the generator store)."""
    snap = None
    for s in _snapshots:
        if s["snapshotId"] == request.snapshotId:
            snap = s
            break
    if not snap:
        raise HTTPException(404, "快照不存在")

    # ── Select cases from library ─────────────────────────────────────────────
    if request.caseIds:
        cases = [c for c in _library if c.get("caseId") in request.caseIds]
    elif request.categories:
        cases = [c for c in _library if c.get("category") in request.categories]
    else:
        cases = list(_library)

    if not cases:
        raise HTTPException(400, "没有可执行的测试用例，请先在测试用例库中生成用例")

    # ── Build LLM evaluation prompt (full structural data, no random sampling) ─
    ontology_context = (
        f"Rules ({len(snap.get('rules', []))}):\n{json.dumps(snap.get('rules', [])[:20], ensure_ascii=False, indent=1)}\n\n"
        f"DataObjects ({len(snap.get('dataobjects', []))}):\n{json.dumps(snap.get('dataobjects', [])[:15], ensure_ascii=False, indent=1)}\n\n"
        f"Actions ({len(snap.get('actions', []))}):\n{json.dumps(snap.get('actions', [])[:10], ensure_ascii=False, indent=1)}\n\n"
        f"Events ({len(snap.get('events', []))}):\n{json.dumps(snap.get('events', [])[:10], ensure_ascii=False, indent=1)}\n\n"
        f"Links ({len(snap.get('links', []))}):\n{json.dumps(snap.get('links', [])[:15], ensure_ascii=False, indent=1)}"
    )

    cases_summary = json.dumps([{
        "caseId": c.get("caseId"),
        "category": c.get("category"),
        "title": c.get("title"),
        "description": c.get("description"),
        "inputVariables": c.get("inputVariables"),
        "expectedOutcome": c.get("expectedOutcome"),
        "steps": c.get("steps", []),
    } for c in cases[:120]], ensure_ascii=False, indent=1)

    exec_prompt = f"""你是 Palantir Ontology 对抗性测试评估专家（TDD 方法），负责**严格**评估测试用例在本体定义下是否真正通过。

## 本体上下文（结构化数据）
{ontology_context}

## 待评估的测试用例（共 {len(cases)} 条）
{cases_summary}

## 评估规则（严格执行，不得妥协）

### 约束 1 — 对抗性视角（先找失败条件）
对每条用例，先假设系统存在缺陷，问自己：
"在什么具体条件下这个用例会失败？inputVariables 中是否存在这种条件？"
只有在确认没有任何失败条件时，才可评为 PASS。

### 约束 2 — 负向用例（isNegative=true 的用例）
这些用例被设计目的是触发失败。你必须：
- 评为 FAIL（正确识别失败）
- 或评为 PASS 并在 reasoning 中明确说明"为什么这个故意设计为失败的用例反而通过了"

### 严格评估维度
1. **Schema 合法性**：inputVariables 中每个字段的值是否在本体 schema 的合法范围内？
2. **规则触发精确性**：触发的规则是否满足全部 AND 条件？只满足部分条件不算触发。
3. **Action 前置条件**：用例声称触发的 Action，其所有 precondition 是否在 inputVariables 中全部满足？
4. **Link 完整性**：引用的实体 ID 是否在 ontology schema 中有效？
5. **业务逻辑合理性**：步骤顺序是否违反业务约束？（如先面试再初筛？）

## 输出格式
返回 JSON 数组，每个元素：
{{
  "caseId": "<与输入一致>",
  "verdict": "PASS" | "FAIL" | "WARNING",
  "evalConfidence": "HIGH" | "MEDIUM" | "LOW",
  "expectedVerdict": "<透传输入中的 expectedVerdict 字段，无则写 null>",
  "verdictMatchesDesign": <verdict == expectedVerdict ? true : false>,
  "triggeredRules": ["<规则ID>"],
  "failureReason": "<如果 FAIL/WARNING，简要说明哪个验证维度失败，为什么>",
  "reasoning": "<中文，2-3句，综合评判依据>",
  "assertionResults": [{{"assertion": "...", "expected": "...", "actual": "...", "passed": bool}}],
  "executionDurationMs": <50-500>,
  "failedNode": <仅 FAIL/WARNING 时提供> {{"ruleName": "<失败的规则名>", "ruleDescription": "<规则描述>", "brokenLink": "<断裂的Link或null>", "funnelStage": "<漏斗阶段如初筛/面试/录用>", "failureType": "<失败类型如RULE_MISMATCH/PRECONDITION_FAIL/BROKEN_LINK>", "contextSnapshot": {{}}}}
}}
"""

    result = await gemini.generate_json(SYSTEM_PROMPT, exec_prompt, temp=0.3)
    records = []

    if result:
        raw_records = result if isinstance(result, list) else result.get("results", result.get("records", []))
        # Build a quick lookup of input cases
        case_map = {c["caseId"]: c for c in cases}
        rules_list = snap.get("rules", [])
        for r in raw_records:
            r["recordId"] = f"rec_{uuid.uuid4().hex[:8]}"
            r["executedAt"] = datetime.now(timezone.utc).isoformat()
            r["snapshotId"] = request.snapshotId
            # Enrich with original case info
            orig = case_map.get(r.get("caseId"), {})
            r["category"] = orig.get("category", "")
            r["title"] = orig.get("title", "")
            _enrich_failed_node(r.get("failedNode"), rules_list)
            records.append(r)
    else:
        for c in cases:
            records.append({
                "recordId": f"rec_{uuid.uuid4().hex[:8]}",
                "caseId": c.get("caseId"),
                "title": c.get("title", ""),
                "category": c.get("category", ""),
                "verdict": "ERROR",
                "reasoning": gemini.last_error or "LLM 评估不可用",
                "triggeredRules": [],
                "assertionResults": [],
                "executionDurationMs": 0,
                "executedAt": datetime.now(timezone.utc).isoformat(),
                "snapshotId": request.snapshotId,
            })

    # ── Build and persist run ─────────────────────────────────────────────────
    run_id = f"run_{uuid.uuid4().hex[:8]}"
    passed = sum(1 for r in records if r.get("verdict") == "PASS")
    failed = sum(1 for r in records if r.get("verdict") in ("FAIL", "ERROR"))
    warnings = sum(1 for r in records if r.get("verdict") == "WARNING")

    categories_label = ", ".join(request.categories) if request.categories else "全部分类"
    run = {
        "runId": run_id,
        "snapshotId": request.snapshotId,
        "executionMode": f"library:{categories_label}",
        "totalCases": len(records),
        "passedCases": passed,
        "failedCases": failed,
        "warningCases": warnings,
        "coverageRate": round(passed / max(len(records), 1), 2),
        "records": records,
        "executedAt": datetime.now(timezone.utc).isoformat(),
    }

    with _lock:
        _runs.insert(0, run)
        _persist_runs()

    return {"status": "ok", "data": run}


@app.get("/executor/runs")
async def list_runs():
    summaries = [{k: v for k, v in r.items() if k != "records"} for r in _runs]
    return {"status": "ok", "data": summaries}


@app.get("/executor/runs/{run_id}")
async def get_run(run_id: str):
    for r in _runs:
        if r["runId"] == run_id:
            return {"status": "ok", "data": r}
    raise HTTPException(404, "运行记录不存在")


# ─── Report Generation ────────────────────────────────────────────────────────

@app.post("/reports/generate")
async def generate_report(request: ReportRequest):
    run = None
    for r in _runs:
        if r["runId"] == request.runId:
            run = r
            break
    if not run:
        raise HTTPException(404, "运行记录不存在")

    records = run.get("records", [])

    # ── Pre-compute componentBreakdown server-side (covers ALL records) ────────
    breakdown: dict[str, dict] = {}
    for rec in records:
        # Support both 'category' (library runs) and 'component' (old generator runs)
        comp = rec.get("category") or rec.get("component") or "unknown"
        if comp not in breakdown:
            breakdown[comp] = {"passed": 0, "failed": 0, "warning": 0, "total": 0}
        verdict = rec.get("verdict", "")
        breakdown[comp]["total"] += 1
        if verdict == "PASS":
            breakdown[comp]["passed"] += 1
        elif verdict in ("FAIL", "ERROR"):
            breakdown[comp]["failed"] += 1
        elif verdict == "WARNING":
            breakdown[comp]["warning"] += 1

    # ── Compact per-case summary (ALL records, no truncation) ──────────────────
    compact_records = [{
        "caseId": rec.get("caseId", ""),
        "category": rec.get("category") or rec.get("component", ""),
        "title": rec.get("title", ""),
        "verdict": rec.get("verdict", ""),
        "reasoning": rec.get("reasoning", ""),
        "triggeredRules": rec.get("triggeredRules", []),
    } for rec in records]

    report_prompt = f"""你是 Palantir Ontology 测试分析专家，根据以下完整测试运行数据生成中文测试报告。

## 运行概要
- 运行 ID: {run['runId']}
- 快照: {run['snapshotId']}
- 执行模式: {run.get('executionMode', 'N/A')}
- 总用例数: {run['totalCases']}
- 通过: {run['passedCases']}，失败: {run['failedCases']}，警告: {run.get('warningCases', 0)}
- 通过率: {round(run['coverageRate'] * 100, 1)}%

## 各分类统计（服务器预计算，100%覆盖）
{json.dumps(breakdown, ensure_ascii=False, indent=1)}

## 全部 {len(compact_records)} 条用例评估结果
{json.dumps(compact_records, ensure_ascii=False, indent=1)}

请基于以上**全部**测试结果，生成一份全面的测试报告 JSON：
- reportId: 留空（服务器会填充）
- summary: string（执行摘要，中文，包含各分类通过情况概述，3-5句话）
- passRate: number（小数，如 0.95）
- coverageAnalysis: string（覆盖率分析，按分类分析覆盖情况）
- riskAssessment: string（风险评估，说明高/中/低风险及原因）
- recommendations: array of strings（改进建议，4-6条具体建议）
- componentBreakdown: 直接使用下面的值，不要自己推断：{json.dumps(breakdown, ensure_ascii=False)}
"""

    result = await gemini.generate_json(SYSTEM_PROMPT, report_prompt, temp=0.3)

    if result:
        report = result if isinstance(result, dict) else {"summary": str(result)}
    else:
        report = {
            "summary": f"测试运行 {run['runId']} 完成，共 {run['totalCases']} 个用例，通过 {run['passedCases']}，失败 {run['failedCases']}",
            "passRate": run["coverageRate"],
        }

    # Always overwrite componentBreakdown with the server-computed accurate value
    report["componentBreakdown"] = breakdown
    report["reportId"] = f"rpt_{uuid.uuid4().hex[:8]}"
    report["runId"] = run["runId"]
    report["generatedAt"] = datetime.now(timezone.utc).isoformat()
    report["runData"] = {k: v for k, v in run.items() if k != "records"}

    return {"status": "ok", "data": report}


@app.get("/reports")
async def list_reports():
    # Return runs that can have reports generated
    summaries = [{k: v for k, v in r.items() if k != "records"} for r in _runs]
    return {"status": "ok", "data": summaries}


# ─── Deadlock Detection ──────────────────────────────────────────────────────

@app.post("/executor/analyze-deadlock")
async def analyze_deadlock(body: dict):
    snapshot_id = body.get("snapshotId", "")
    snap = None
    for s in _snapshots:
        if s["snapshotId"] == snapshot_id:
            snap = s
            break
    if not snap:
        raise HTTPException(404, "快照不存在")

    rules = snap.get("rules", [])

    # Simple cycle detection in rule dependencies
    # Build adjacency from rule conditions/effects
    cycles = []
    total_rules = len(rules)

    # Use LLM for sophisticated analysis if available
    if gemini.is_configured and rules:
        dl_prompt = f"""Analyze these {len(rules)} rules for circular dependencies (deadlocks).
A deadlock occurs when Rule A triggers Rule B which triggers Rule A.

Rules (first 20):
{json.dumps(rules[:20], ensure_ascii=False, indent=1)}

Return JSON:
{{
  "isClean": boolean,
  "cyclesFound": number,
  "totalRules": {total_rules},
  "cycles": [{{ "cycle": ["ruleId1", "ruleId2", ...], "description": "explanation" }}]
}}"""
        result = await gemini.generate_json(SYSTEM_PROMPT, dl_prompt, temp=0.2)
        if result:
            return {"status": "ok", "data": result}

    return {"status": "ok", "data": {
        "isClean": True,
        "cyclesFound": 0,
        "totalRules": total_rules,
        "cycles": [],
    }}


# ─── Business Data Management ────────────────────────────────────────────────

import re as _re
import base64 as _base64


def _clean_pdf_text(raw: str) -> str:
    """Keep lines containing Chinese characters, meaningful English words, or numbers."""
    lines = []
    for line in raw.split("\n"):
        s = line.strip()
        if not s:
            continue
        has_cn = bool(_re.search(r"[\u4e00-\u9fff]", s))
        has_num = bool(_re.search(r"\d{6,}|@[\w.]+\.\w+|\d{4}[-/年]\d{1,2}", s))
        # Keep English lines that contain real words (skills, job titles, etc.)
        has_en = bool(_re.search(r"[A-Za-z]{3,}", s))
        if has_cn or has_num or has_en:
            lines.append(s)
    return "\n".join(lines)


def _regex_resume(text: str) -> dict:
    """Best-effort regex extraction of key resume fields."""
    r: dict = {}

    # Words that are NOT names (section headers, common terms)
    _NOT_NAME = {"简历", "个人", "姓名", "联系", "基本", "信息", "教育", "工作", "经历",
                 "技能", "专业", "项目", "学历", "背景", "求职", "自我", "评价", "荣誉",
                 "证书", "语言", "能力", "经验", "实习", "兴趣", "爱好", "其他", "补充"}

    # 1. Standard: 姓名：xxx (handles spaces between chars like '姓 名 ：李寨燕')
    m = _re.search(r"姓\s*名\s*[：:]\s*([^\s\n，,（(]{2,6})", text)
    if m:
        r["name"] = _re.sub(r"\s+", "", m.group(1)).strip()

    # 2. Fallback: scan first 20 cleaned lines
    if not r.get("name"):
        lines = [l.strip() for l in text.split("\n") if l.strip()]
        for line in lines[:20]:
            # Remove all non-Chinese non-alphanumeric noise chars
            cn_chars = _re.findall(r"[\u4e00-\u9fff]", line)
            cn_str = "".join(cn_chars)
            # Pure 2-4 Chinese char line that isn't a known section header
            if 2 <= len(cn_str) <= 4 and cn_str not in _NOT_NAME:
                # Line's total length should be short (name + noise, not a sentence)
                if len(line) <= 20:
                    r["name"] = cn_str
                    break

    # Phone
    m = _re.search(r"(?:电\s*话|手\s*机|联\s*系)[：:\s]?\s*(1[3-9]\d{9})", text)
    if not m:
        m = _re.search(r"(?<!\d)(1[3-9]\d{9})(?!\d)", text)
    if m:
        r["phone"] = m.group(1)

    # Email
    m = _re.search(r"[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}", text)
    if m:
        r["email"] = m.group(0)

    # Skills: extract from 技能/专业技能/核心技能 section
    skills_match = _re.search(
        r"(?:专业?技能|核心技能|技能证书|技能概述)[：:\s]*\n?((?:.+\n?){1,10})",
        text
    )
    if skills_match:
        skills_block = skills_match.group(1)
        # Find skill items: lines with bullets or comma-separated words
        raw_skills = _re.findall(
            r"[•·\-◆▪\*]?\s*([A-Za-z\u4e00-\u9fff][A-Za-z\u4e00-\u9fff\+\#\s/]{1,30}?)(?=[,，/|；;•·\-◆▪\*\n]|$)",
            skills_block
        )
        clean_skills = []
        for s in raw_skills:
            s = s.strip()
            # Filter out section headers and very short noise
            cn_chars_s = _re.findall(r"[\u4e00-\u9fff]", s)
            if len(s) >= 2 and s not in _NOT_NAME and not ("工作" in s and "经历" in s):
                clean_skills.append(s)
        if clean_skills:
            r["skills"] = clean_skills[:12]

    # Summary: extract from 自我评价/个人简介/核心优势 section
    summary_match = _re.search(
        r"(?:自我评价|个人简介|核心优势|个人优势|自我介绍)[：:\s]*\n?((?:.|\n){30,400}?)(?=\n[^\s]|$)",
        text
    )
    if summary_match:
        raw_summary = summary_match.group(1).strip()
        # Clean up noise characters (single letters/numbers interspersed)
        clean = _re.sub(r"(?<![A-Za-z0-9])[A-Za-z0-9]{1,2}(?![A-Za-z0-9\+\#])\s*", "", raw_summary)
        clean = _re.sub(r"\s+", " ", clean).strip()
        if len(clean) >= 20:
            r["summary"] = clean[:300]

    return r



@app.post("/business-data/upload-resume")
async def upload_resume(file: UploadFile = File(...)):
    """Upload a resume PDF, extract text via pdfplumber, parse with LLM."""
    filename = file.filename or "resume.pdf"
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(400, "仅支持PDF文件")

    content = await file.read()

    try:
        import pdfplumber
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name
        raw_text = ""
        with pdfplumber.open(tmp_path) as pdf:
            for page in pdf.pages:
                t = page.extract_text()
                if t:
                    raw_text += t + "\n"
        os.unlink(tmp_path)
    except Exception as e:
        raise HTTPException(400, f"PDF解析失败: {str(e)}")

    if not raw_text.strip():
        raise HTTPException(400, "无法从PDF中提取到文本内容")

    cleaned = _clean_pdf_text(raw_text)
    parsed_data: dict = {"rawText": cleaned.strip() or raw_text.strip()}
    parsed_data.update(_regex_resume(cleaned))

    if gemini.is_configured:
        parse_prompt = f"""请从以下简历文本中提取结构化信息，返回JSON对象。
文本含部分格式干扰字符，请忽略乱码、识别有意义的中文内容。
只提取文本中明确存在的信息，不编造不存在的内容。

返回格式（纯JSON）：
{{
  "name": "候选人姓名",
  "phone": "电话或null",
  "email": "邮箱或null",
  "education": [{{
    "school": "学校", "degree": "学历",
    "major": "专业", "graduationYear": "年份"
  }}],
  "experience": [{{
    "company": "公司", "title": "职位",
    "startDate": "开始", "endDate": "结束",
    "description": "职责简述"
  }}],
  "skills": ["技能列表"],
  "summary": "核心背景摘要（1-2句）"
}}

简历文本：
{cleaned[:4500]}"""
        result = await gemini.generate_json(
            "你是专业简历解析器。从含格式干扰的简历文本中提取结构化数据，只输出文本中实际存在的内容，返回纯JSON。",
            parse_prompt, temp=0.1
        )
        if result and isinstance(result, dict):
            for k, v in result.items():
                if v is not None and v != "" and v != [] and k != "rawText":
                    parsed_data[k] = v

    item_id = f"bd_{uuid.uuid4().hex[:8]}"
    item = {
        "itemId": item_id,
        "type": "resume",
        "filename": filename,
        "parsedData": parsed_data,
        "pdfBase64": _base64.b64encode(content).decode("ascii"),
        "uploadedAt": datetime.now(timezone.utc).isoformat(),
    }

    with _lock:
        _business_data.insert(0, item)
        _persist_business_data()

    return {"status": "ok", "data": {k: v for k, v in item.items() if k != "pdfBase64"}}


@app.post("/business-data/upload-jd")
async def upload_jd(file: UploadFile = File(...)):
    """Upload a JD CSV. Auto-detect real header row (row with most non-empty cells)."""
    filename = file.filename or "jd.csv"
    if not filename.lower().endswith(".csv"):
        raise HTTPException(400, "仅支持CSV文件")

    content = await file.read()
    text = None
    for enc in ("utf-8-sig", "gbk", "utf-8", "latin-1"):
        try:
            text = content.decode(enc)
            break
        except Exception:
            pass
    if text is None:
        raise HTTPException(400, "CSV编码无法识别")

    all_rows = list(csv.reader(io.StringIO(text)))
    if not all_rows:
        raise HTTPException(400, "CSV文件为空")

    # Find header row = first 6 rows, pick the one with most non-empty cells
    header_idx, max_ne = 0, 0
    for i, row in enumerate(all_rows[:6]):
        ne = sum(1 for c in row if c.strip())
        if ne > max_ne:
            max_ne, header_idx = ne, i

    headers = [h.strip() for h in all_rows[header_idx]]
    records = []
    for row in all_rows[header_idx + 1:]:
        if not any(c.strip() for c in row):
            continue
        rec = {headers[i]: row[i].strip() for i in range(min(len(headers), len(row))) if headers[i]}
        if any(v for v in rec.values()):
            records.append(rec)

    if not records:
        raise HTTPException(400, "CSV文件中没有有效数据")

    clean_columns = [h for h in headers if h]
    now = datetime.now(timezone.utc).isoformat()
    created_items = []

    # Detect title column: prefer columns containing '职位', '岗位', 'title', or use first column
    title_col = clean_columns[0] if clean_columns else ""
    for col in clean_columns:
        if any(kw in col.lower() for kw in ("职位", "岗位", "title", "名称")):
            title_col = col
            break

    for idx, rec in enumerate(records):
        item_id = f"bd_{uuid.uuid4().hex[:8]}"
        rec_title = rec.get(title_col, "") or f"第{idx + 1}条"
        item = {
            "itemId": item_id,
            "type": "jd",
            "filename": f"{rec_title}",
            "columns": clean_columns,
            "records": [rec],
            "recordCount": 1,
            "title": rec_title,
            "sourceFile": filename,
            "uploadedAt": now,
        }
        created_items.append(item)

    with _lock:
        for item in reversed(created_items):
            _business_data.insert(0, item)
        _persist_business_data()

    return {
        "status": "ok",
        "data": {
            "totalRecords": len(created_items),
            "items": [{k: v for k, v in it.items() if k != "records"} for it in created_items],
        },
    }


@app.get("/business-data/list")
async def list_business_data():
    summaries = []
    for item in _business_data:
        summary = {k: v for k, v in item.items() if k not in ("parsedData", "records", "pdfBase64")}
        if item["type"] == "resume":
            pd = item.get("parsedData", {})
            summary["preview"] = {
                "name": pd.get("name") or "(未解析)",
                "phone": pd.get("phone"),
                "email": pd.get("email"),
                "skills": pd.get("skills", [])[:6],
                "summary": pd.get("summary") or "",
                "educationCount": len(pd.get("education") or []),
                "experienceCount": len(pd.get("experience") or []),
            }
        elif item["type"] == "jd":
            recs = item.get("records", [])
            summary["preview"] = {
                "columns": item.get("columns", []),
                "recordCount": item.get("recordCount", len(recs)),
                "sampleRecord": recs[0] if recs else {},
                "title": item.get("title", ""),
                "sourceFile": item.get("sourceFile", ""),
            }
        summaries.append(summary)
    return {"status": "ok", "data": summaries}


@app.get("/business-data/{item_id}/file")
async def get_business_data_file(item_id: str):
    """Serve raw PDF file for browser preview."""
    from fastapi.responses import Response
    from urllib.parse import quote
    for item in _business_data:
        if item["itemId"] == item_id and item["type"] == "resume":
            b64 = item.get("pdfBase64", "")
            if b64:
                # RFC 5987: encode non-ASCII filename so latin-1 headers don't fail
                encoded_name = quote(item["filename"], safe="")
                disposition = f"inline; filename*=UTF-8''{encoded_name}"
                return Response(
                    content=_base64.b64decode(b64),
                    media_type="application/pdf",
                    headers={"Content-Disposition": disposition},
                )
    raise HTTPException(404, "PDF文件不存在")


@app.get("/business-data/{item_id}")
async def get_business_data(item_id: str):
    for item in _business_data:
        if item["itemId"] == item_id:
            # Return all data except the large base64 blob
            data = {k: v for k, v in item.items() if k != "pdfBase64"}
            return {"status": "ok", "data": data}
    raise HTTPException(404, "业务数据不存在")


@app.delete("/business-data/{item_id}")
async def delete_business_data(item_id: str):
    with _lock:
        before = len(_business_data)
        _business_data[:] = [i for i in _business_data if i["itemId"] != item_id]
        if len(_business_data) < before:
            _persist_business_data()
            return {"status": "ok"}
    raise HTTPException(404, "业务数据不存在")


@app.post("/business-data/reparse-names")
async def reparse_names():
    """Fix name/phone/email for stored resumes that are missing or have wrong fields."""
    _HEADER_WORDS = {"专业技能", "工作经历", "教育经历", "教育背景", "基本信息", "个人简历",
                     "求职意向", "项目经验", "自我评价", "联系方式", "荣誉证书", "技能证书"}
    fixed = 0
    with _lock:
        for item in _business_data:
            if item["type"] != "resume":
                continue
            pd = item.get("parsedData", {})
            raw = pd.get("rawText", "")
            if not raw:
                continue
            existing_name = pd.get("name") or ""
            # Re-extract if name is empty or is a section header word
            should_reparse = not existing_name or existing_name in _HEADER_WORDS
            if should_reparse:
                # Temporarily clear the name so _regex_resume will try to find it
                pd.pop("name", None)
                extracted = _regex_resume(raw)
                changed = False
                for key in ("name", "phone", "email"):
                    if extracted.get(key) and not pd.get(key):
                        pd[key] = extracted[key]
                        changed = True
                if changed:
                    fixed += 1
        if fixed:
            _persist_business_data()
    return {"status": "ok", "fixed": fixed}


@app.post("/business-data/reparse-skills")
async def reparse_skills():
    """Re-run parsing on stored resumes that are missing skills or summary.
    Uses regex as primary fallback, then overlays with LLM if configured.
    """
    fixed = 0
    for item in list(_business_data):
        if item["type"] != "resume":
            continue
        pd = item.get("parsedData", {})
        # Only re-parse if skills or summary is missing
        if pd.get("skills") and pd.get("summary"):
            continue
        raw = pd.get("rawText", "")
        if not raw:
            continue

        changed = False

        # Step 1: Always try regex extraction first (no LLM needed)
        regex_result = _regex_resume(raw)
        for k in ("skills", "summary", "name", "phone", "email"):
            v = regex_result.get(k)
            if v is not None and v != "" and v != [] and not pd.get(k):
                pd[k] = v
                changed = True

        # Step 2: Overlay with LLM results if available
        if gemini.is_configured:
            parse_prompt = f"""请从以下简历文本中提取结构化信息，返回JSON对象。
文本含部分格式干扰字符，请忽略乱码、识别有意义的内容。
只提取文本中明确存在的信息，不编造不存在的内容。

返回格式（纯JSON）：
{{
  "name": "候选人姓名",
  "phone": "电话或null",
  "email": "邮箱或null",
  "education": [{{"school": "学校", "degree": "学历", "major": "专业", "graduationYear": "年份"}}],
  "experience": [{{"company": "公司", "title": "职位", "startDate": "开始", "endDate": "结束", "description": "职责简述"}}],
  "skills": ["技能列表"],
  "summary": "核心背景摘要（1-2句）"
}}

简历文本：
{raw[:4500]}"""
            try:
                result = await gemini.generate_json(
                    "你是专业简历解析器。从简历文本中提取结构化数据，只输出文本中实际存在的内容，返回纯JSON。",
                    parse_prompt, temp=0.1
                )
                if result and isinstance(result, dict):
                    for k, v in result.items():
                        if v is not None and v != "" and v != [] and k != "rawText":
                            pd[k] = v
                            changed = True
            except Exception:
                pass

        if changed:
            fixed += 1

    if fixed:
        with _lock:
            _persist_business_data()
    return {"status": "ok", "fixed": fixed}



class BusinessCaseRequest(BaseModel):
    snapshotId: str
    businessDataIds: List[str] = []


@app.post("/business-data/generate-cases")
async def generate_business_cases(request: BusinessCaseRequest):
    """Generate test cases combining business data (resumes/JDs) with ontology."""
    # Find snapshot
    snap = None
    for s in _snapshots:
        if s["snapshotId"] == request.snapshotId:
            snap = s
            break
    if not snap:
        raise HTTPException(404, "快照不存在")

    # Gather selected business data
    selected = []
    for item in _business_data:
        if not request.businessDataIds or item["itemId"] in request.businessDataIds:
            selected.append(item)

    if not selected:
        raise HTTPException(400, "没有可用的业务数据")

    # Build context
    resume_texts = []
    jd_texts = []
    for item in selected:
        if item["type"] == "resume":
            pd = item.get("parsedData", {})
            resume_texts.append(json.dumps({
                "filename": item["filename"],
                "name": pd.get("name", "未知"),
                "skills": pd.get("skills", []),
                "education": pd.get("education", []),
                "experience": pd.get("experience", []),
            }, ensure_ascii=False))
        elif item["type"] == "jd":
            jd_texts.append(json.dumps({
                "filename": item["filename"],
                "sampleRecords": item.get("records", [])[:3],
                "columns": item.get("columns", []),
            }, ensure_ascii=False))

    ontology_summary = f"""Ontology Snapshot ({snap['snapshotId']}):
- Rules: {len(snap.get('rules', []))} (sample: {json.dumps(snap.get('rules', [])[:3], ensure_ascii=False, indent=1)})
- DataObjects: {len(snap.get('dataobjects', []))} (sample: {json.dumps(snap.get('dataobjects', [])[:3], ensure_ascii=False, indent=1)})
- Actions: {len(snap.get('actions', []))} (sample: {json.dumps(snap.get('actions', [])[:2], ensure_ascii=False, indent=1)})
- Events: {len(snap.get('events', []))} events
- Links: {len(snap.get('links', []))} links"""

    prompt = f"""Generate end-to-end test cases that validate the HRO recruitment pipeline using REAL business data.

## Business Data
### Resumes ({len(resume_texts)} candidates)
{chr(10).join(resume_texts[:5])}

### Job Descriptions ({len(jd_texts)} JD files)
{chr(10).join(jd_texts[:3])}

## Ontology Context
{ontology_summary}

## Test Case Categories to Generate
1. **Resume-to-DataObject Mapping**: Does the resume data correctly map to Candidate/Person DataObject schemas?
2. **JD-to-Action Mapping**: Does the JD trigger correct createJobRequisition/publishJobRequisition actions?
3. **Rule Validation**: Do candidate attributes (skills, education, experience) trigger correct screening rules (hard requirements, salary checks, career gap detection)?
4. **Link Verification**: Are proper relationships created between Candidate, Job, Application, Company entities?
5. **Full Pipeline**: Resume submission → initial screening → rule evaluation → interview → offer → onboarding

## Output Format
Return a JSON array of 8-12 test cases. Each must have:
- caseId: string (format: "TC-BIZ-XXX")
- component: "business_integration"
- strategy: one of ["resume_mapping", "jd_mapping", "rule_validation", "link_verification", "full_pipeline"]
- description: string (detailed scenario in Chinese)
- inputVariables: object (use actual data from the business data provided)
- expectedOutcome: string
- priority: "P0" | "P1" | "P2"
- testCategory: string
"""

    system = """You are a Palantir Ontology test architect specializing in HRO recruitment systems.
You generate test cases that validate the integration between real business data (resumes, JDs) and the ontology definitions.
Focus on practical, data-driven test scenarios."""

    result = await gemini.generate_json(system, prompt, temp=0.4)
    if result is None:
        raise HTTPException(500, gemini.last_error or "LLM调用失败，请检查API Key配置")
    cases = result if isinstance(result, list) else result.get("testCases", result.get("cases", []))
    for c in cases:
        c["snapshotId"] = request.snapshotId
        c["component"] = "business_integration"
        c["generatedAt"] = datetime.now(timezone.utc).isoformat()

    with _lock:
        _cases.extend(cases)
        _persist_cases()
        # ── Also save to library for the new 业务数据模拟测试 tab ──────────────
        lib_entries = []
        for c in cases:
            lib_entries.append({
                "caseId": f"LIB-BIZ-{uuid.uuid4().hex[:8].upper()}",
                "title": c.get("description", "业务集成测试用例")[:40],
                "description": c.get("description", ""),
                "category": "business_integration",
                "tags": ["business_integration", c.get("strategy", "integration")],
                "priority": c.get("priority", "P1"),
                "inputVariables": c.get("inputVariables", {}),
                "expectedOutcome": c.get("expectedOutcome", ""),
                "steps": c.get("steps", []),
                "createdAt": datetime.now(timezone.utc).isoformat(),
                "updatedAt": datetime.now(timezone.utc).isoformat(),
                "sourceSnapshotId": request.snapshotId,
                "sourceCaseId": c.get("caseId", ""),
                "strategy": c.get("strategy", ""),
            })
        _library.extend(lib_entries)
        _persist_library()

    return {"status": "ok", "data": {"generated": cases, "totalCount": len(cases)}}


# ─── Test Case Library ───────────────────────────────────────────────────────

LIBRARY_CATEGORIES = ["dataobjects", "actions_events", "rules", "links", "ontology", "business_integration"]


@app.get("/library/cases")
async def list_library_cases(category: Optional[str] = None):
    """List test cases in the library, optionally filtered by category."""
    if category:
        filtered = [c for c in _library if c.get("category") == category]
    else:
        filtered = list(_library)
    return {"status": "ok", "data": filtered}


@app.post("/library/cases")
async def create_library_case(req: LibraryCaseCreate):
    """Add a new test case to the library."""
    if req.category not in LIBRARY_CATEGORIES:
        raise HTTPException(400, f"Invalid category. Must be one of: {LIBRARY_CATEGORIES}")
    case = {
        "caseId": f"LIB-{uuid.uuid4().hex[:8].upper()}",
        "title": req.title,
        "description": req.description,
        "category": req.category,
        "tags": req.tags or [req.category],
        "priority": req.priority,
        "inputVariables": req.inputVariables,
        "expectedOutcome": req.expectedOutcome,
        "steps": req.steps,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }
    with _lock:
        _library.append(case)
        _persist_library()
    return {"status": "ok", "data": case}


@app.put("/library/cases/{case_id}")
async def update_library_case(case_id: str, req: LibraryCaseUpdate):
    """Update a test case in the library."""
    with _lock:
        for c in _library:
            if c["caseId"] == case_id:
                for field in ["title", "description", "category", "tags", "priority",
                              "inputVariables", "expectedOutcome", "steps"]:
                    val = getattr(req, field, None)
                    if val is not None:
                        c[field] = val
                c["updatedAt"] = datetime.now(timezone.utc).isoformat()
                _persist_library()
                return {"status": "ok", "data": c}
    raise HTTPException(404, "用例不存在")


@app.delete("/library/cases/{case_id}")
async def delete_library_case(case_id: str):
    """Delete a test case from the library."""
    with _lock:
        before = len(_library)
        _library[:] = [c for c in _library if c["caseId"] != case_id]
        if len(_library) < before:
            _persist_library()
            return {"status": "ok", "message": "已删除"}
    raise HTTPException(404, "用例不存在")


@app.post("/library/generate")
async def generate_library_cases(req: LibraryAIGenerateRequest):
    """Use AI to generate test cases for the library."""
    if req.category not in LIBRARY_CATEGORIES:
        raise HTTPException(400, f"Invalid category. Must be one of: {LIBRARY_CATEGORIES}")

    snap = None
    for s in _snapshots:
        if s["snapshotId"] == req.snapshotId:
            snap = s
            break
    if not snap:
        raise HTTPException(404, "快照不存在")

    category_descriptions = {
        "dataobjects": "DataObjects（数据对象）— 验证属性、类型、约束、CRUD操作",
        "actions_events": "Actions & Events（操作与事件）— 验证前置条件、副作用、触发时序",
        "rules": "Rules（规则）— 验证规则逻辑、冲突检测、边界条件",
        "links": "Links（关联关系）— 验证实体关联、基数约束、级联效应",
        "ontology": "Ontology（本体综合）— 跨组件集成验证、E2E场景、一致性检查",
    }

    # ── Build category-specific ontology context ──────────────────────────────
    if req.category == "dataobjects":
        section_data = snap.get("dataobjects", [])
        ontology_context = (
            f"DataObjects ({len(section_data)} 个对象):\n"
            f"{json.dumps(section_data, ensure_ascii=False, indent=1)}"
        )
    elif req.category == "actions_events":
        actions = snap.get("actions", [])
        events = snap.get("events", [])
        ontology_context = (
            f"Actions ({len(actions)} 个):\n{json.dumps(actions, ensure_ascii=False, indent=1)}\n\n"
            f"Events ({len(events)} 个):\n{json.dumps(events, ensure_ascii=False, indent=1)}"
        )
    elif req.category == "rules":
        section_data = snap.get("rules", [])
        ontology_context = (
            f"Rules ({len(section_data)} 条规则):\n"
            f"{json.dumps(section_data, ensure_ascii=False, indent=1)}"
        )
    elif req.category == "links":
        section_data = snap.get("links", [])
        ontology_context = (
            f"Links ({len(section_data)} 条关联):\n"
            f"{json.dumps(section_data, ensure_ascii=False, indent=1)}"
        )
    else:  # ontology — full context, randomly sample each section
        import random
        def _sample(lst, n): return random.sample(lst, min(n, len(lst)))
        ontology_context = (
            f"Rules ({len(snap.get('rules', []))}):\n{json.dumps(_sample(snap.get('rules', []), 5), ensure_ascii=False, indent=1)}\n\n"
            f"DataObjects ({len(snap.get('dataobjects', []))}):\n{json.dumps(_sample(snap.get('dataobjects', []), 5), ensure_ascii=False, indent=1)}\n\n"
            f"Actions ({len(snap.get('actions', []))}):\n{json.dumps(_sample(snap.get('actions', []), 3), ensure_ascii=False, indent=1)}\n\n"
            f"Events ({len(snap.get('events', []))}):\n{json.dumps(_sample(snap.get('events', []), 3), ensure_ascii=False, indent=1)}\n\n"
            f"Links ({len(snap.get('links', []))}):\n{json.dumps(_sample(snap.get('links', []), 5), ensure_ascii=False, indent=1)}"
        )

    n_positive = max(1, round(req.count * 0.6))
    n_negative = req.count - n_positive

    prompt = f"""你是 Palantir Ontology 测试架构师，专注于 HRO 招聘系统的本体测试用例设计，采用测试驱动开发（TDD）方法。

## Ontology 上下文（{req.category} 分区）
{ontology_context}

## 生成要求

请生成 **共 {req.count} 条** 测试用例，严格分为两类：

### 正向用例（{n_positive} 条）—— expectedVerdict = "PASS"
验证系统在合法输入下的正确行为：正常 CRUD、规则正确触发、Action 正常执行、Link 正常建立。

### 负向用例（{n_negative} 条）—— expectedVerdict = "FAIL"
故意设计会失败的场景，必须覆盖以下类型（isNegative=true）：
- **BOUNDARY**：数值超出合法范围（salary=-1, experience=999年）
- **INVALID_TYPE**：字段类型错误（name字段传数字，id字段传null）
- **MISSING_REQUIRED**：缺少必填字段（没有 candidateId 就触发 Action）
- **RULE_CONFLICT**：同时满足互斥规则，或违反约束（既满足录用条件又满足淘汰条件）
- **BROKEN_LINK**：Link 指向不存在的对象（非法 UUID 引用）
- **PRECONDITION_FAIL**：Action 前置条件未满足（初筛未通过就进入面试阶段）

## 每条用例的字段
```json
{{
  "title": "简短中文标题（10-20字）",
  "description": "详细中文描述，说明测试目的",
  "priority": "P0|P1|P2",
  "tags": ["...", "{req.category}"],
  "inputVariables": {{ /* 具体的测试输入，包含真实/故意无效的数据 */ }},
  "expectedOutcome": "清晰说明预期结果（正向：成功原因；负向：失败原因）",
  "steps": ["步骤1", "步骤2"],
  "isNegative": false,
  "negativeType": null,
  "expectedVerdict": "PASS"
}}
```
负向用例：`isNegative: true`，`negativeType: "BOUNDARY"（等）`，`expectedVerdict: "FAIL"`

## 输出要求
- 返回 JSON 数组，顺序：先 {n_positive} 条正向，再 {n_negative} 条负向
- 每条负向用例的 inputVariables 中必须包含**真正无效/越界的值**，不能只是描述
- description 中要明确说明"输入哪里有问题，为什么会失败"
"""

    system = """你是 Palantir Ontology 测试架构师，专注于 HRO 招聘系统的本体测试用例设计，采用 TDD 方法。
你对测试边界条件和异常场景有深厚理解，生成的负向用例会真正触发系统失败。
所有标题和描述使用中文。"""

    result = await gemini.generate_json(system, prompt, temp=0.5)
    if result is None:
        raise HTTPException(500, gemini.last_error or "LLM调用失败，请检查API Key配置")

    cases_raw = result if isinstance(result, list) else result.get("testCases", result.get("cases", []))
    generated = []
    for c in cases_raw:
        is_neg = bool(c.get("isNegative", False))
        lib_case = {
            "caseId": f"LIB-{'NEG' if is_neg else 'POS'}-{uuid.uuid4().hex[:8].upper()}",
            "title": c.get("title", "未命名用例"),
            "description": c.get("description", ""),
            "category": req.category,
            "tags": c.get("tags", [req.category]),
            "priority": c.get("priority", "P1"),
            "inputVariables": c.get("inputVariables", {}),
            "expectedOutcome": c.get("expectedOutcome", ""),
            "steps": c.get("steps", []),
            "isNegative": is_neg,
            "negativeType": c.get("negativeType") if is_neg else None,
            "expectedVerdict": "FAIL" if is_neg else "PASS",
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }
        generated.append(lib_case)

    with _lock:
        _library.extend(generated)
        _persist_library()

    return {"status": "ok", "data": {"generated": generated, "totalCount": len(generated)}}


@app.get("/library/stats")
async def library_stats():
    """Get counts per category."""
    stats = {cat: 0 for cat in LIBRARY_CATEGORIES}
    for c in _library:
        cat = c.get("category", "")
        if cat in stats:
            stats[cat] += 1
    return {"status": "ok", "data": stats}


# ─── API Key Management ──────────────────────────────────────────────────────

@app.get("/api-keys")
async def list_api_keys():
    """List all API keys with masked values."""
    masked = []
    for k in _api_keys:
        mk = {**k}
        key_val = mk.get("key", "")
        mk["maskedKey"] = key_val[:8] + "*" * max(0, len(key_val) - 12) + key_val[-4:] if len(key_val) > 12 else "****"
        del mk["key"]
        masked.append(mk)
    return {"status": "ok", "data": masked}


class AddKeyRequest(BaseModel):
    provider: str = "gemini"  # gemini | openai | custom | ...
    label: str = ""
    key: str
    model: str = "gemini-3.0-flash"  # model to use with this key
    baseUrl: Optional[str] = None  # custom endpoint URL (for proxy/custom providers)


@app.post("/api-keys")
async def add_api_key(request: AddKeyRequest):
    """Add a new API key."""
    if not request.key.strip():
        raise HTTPException(400, "API Key不能为空")

    key_id = f"key_{uuid.uuid4().hex[:8]}"
    item = {
        "keyId": key_id,
        "provider": request.provider,
        "label": request.label or f"{request.provider} key",
        "key": request.key.strip(),
        "model": request.model.strip() or "gemini-3.0-flash",
        "baseUrl": request.baseUrl.strip() if request.baseUrl else None,
        "isActive": True,
        "status": "untested",
        "addedAt": datetime.now(timezone.utc).isoformat(),
        "lastTestedAt": None,
    }

    with _lock:
        _api_keys.append(item)
        _persist_api_keys()

    return {"status": "ok", "data": {
        "keyId": key_id,
        "provider": request.provider,
        "label": item["label"],
        "model": item["model"],
        "baseUrl": item["baseUrl"],
        "maskedKey": request.key[:8] + "****" + request.key[-4:] if len(request.key) > 12 else "****",
        "isActive": True,
        "status": "untested",
    }}


@app.delete("/api-keys/{key_id}")
async def delete_api_key(key_id: str):
    with _lock:
        before = len(_api_keys)
        _api_keys[:] = [k for k in _api_keys if k["keyId"] != key_id]
        if len(_api_keys) < before:
            _persist_api_keys()
            return {"status": "ok"}
    raise HTTPException(404, "API Key不存在")


@app.post("/api-keys/{key_id}/test")
async def test_api_key(key_id: str):
    """Test if an API key is working by making a minimal LLM call.
    - Gemini provider: uses Google Genai SDK
    - Custom/OpenAI provider: uses httpx with OpenAI-compatible Chat Completions API
    """
    target = None
    for k in _api_keys:
        if k["keyId"] == key_id:
            target = k
            break
    if not target:
        raise HTTPException(404, "API Key不存在")

    model_name = target.get("model") or os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
    provider = target.get("provider", "gemini")
    base_url = target.get("baseUrl") or ""

    import time
    start = time.time()

    # ── Path A: Custom / OpenAI-compatible endpoint ────────────────────────────
    if provider in ("custom", "openai", "anthropic") or base_url:
        if not base_url:
            return {"status": "ok", "data": {
                "success": False,
                "error": "自定义提供商未配置接口地址（baseUrl），请删除后重新添加并填写URL",
                "latencyMs": 0, "model": model_name,
            }}
        # Normalize: strip trailing slash, ensure no double /v1/v1
        endpoint = base_url.rstrip("/")
        if not endpoint.endswith(("/chat/completions", "/v1")):
            endpoint = endpoint + "/chat/completions"
        else:
            endpoint = endpoint.rstrip("/v1") + "/v1/chat/completions"

        payload = {
            "model": model_name,
            "messages": [{"role": "user", "content": "Reply with 'ok' only."}],
            "max_tokens": 5,
            "temperature": 0,
        }
        headers = {
            "Authorization": f"Bearer {target['key']}",
            "Content-Type": "application/json",
        }
        try:
            import httpx
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.post(endpoint, json=payload, headers=headers)
            latency = int((time.time() - start) * 1000)
            if resp.status_code == 200:
                body = resp.json()
                text = (body.get("choices", [{}])[0]
                        .get("message", {}).get("content", "")).strip()
                with _lock:
                    target["status"] = "valid"
                    target["lastTestedAt"] = datetime.now(timezone.utc).isoformat()
                    _persist_api_keys()
                return {"status": "ok", "data": {
                    "success": True, "response": text,
                    "latencyMs": latency, "model": model_name,
                }}
            else:
                err = f"HTTP {resp.status_code}: {resp.text[:300]}"
                with _lock:
                    target["status"] = "invalid"
                    target["lastTestedAt"] = datetime.now(timezone.utc).isoformat()
                    _persist_api_keys()
                return {"status": "ok", "data": {
                    "success": False, "error": err,
                    "latencyMs": latency, "model": model_name,
                }}
        except Exception as e:
            latency = int((time.time() - start) * 1000)
            with _lock:
                target["status"] = "invalid"
                target["lastTestedAt"] = datetime.now(timezone.utc).isoformat()
                _persist_api_keys()
            return {"status": "ok", "data": {
                "success": False, "error": str(e),
                "latencyMs": latency, "model": model_name,
            }}

    # ── Path B: Google Gemini (native SDK) ─────────────────────────────────────
    if not _GENAI_OK:
        return {"status": "ok", "data": {
            "success": False, "error": "google-genai SDK未安装", "latencyMs": 0,
        }}
    try:
        client = _genai.Client(api_key=target["key"])
        resp = await asyncio.to_thread(
            client.models.generate_content,
            model=model_name,
            contents="Say 'ok' in one word.",
            config=_types.GenerateContentConfig(temperature=0, max_output_tokens=5),
        )
        text = (getattr(resp, "text", "") or "").strip()
        latency = int((time.time() - start) * 1000)
        with _lock:
            target["status"] = "valid"
            target["lastTestedAt"] = datetime.now(timezone.utc).isoformat()
            _persist_api_keys()
        return {"status": "ok", "data": {
            "success": True, "response": text,
            "latencyMs": latency, "model": model_name,
        }}
    except Exception as e:
        latency = int((time.time() - start) * 1000)
        with _lock:
            target["status"] = "invalid"
            target["lastTestedAt"] = datetime.now(timezone.utc).isoformat()
            _persist_api_keys()
        return {"status": "ok", "data": {
            "success": False, "error": str(e),
            "latencyMs": latency, "model": model_name,
        }}



@app.post("/api-keys/{key_id}/toggle")
async def toggle_api_key(key_id: str):
    """Toggle active state of an API key."""
    for k in _api_keys:
        if k["keyId"] == key_id:
            with _lock:
                k["isActive"] = not k.get("isActive", True)
                _persist_api_keys()
            return {"status": "ok", "data": {"keyId": key_id, "isActive": k["isActive"]}}
    raise HTTPException(404, "API Key不存在")


# ─── Neo4j Import ─────────────────────────────────────────────────────────────

class Neo4jConnectionRequest(BaseModel):
    uri: str = "bolt://localhost:7687"
    username: str = "neo4j"
    password: str = ""
    database: str = "neo4j"


class Neo4jPullRequest(BaseModel):
    uri: str = "bolt://localhost:7687"
    username: str = "neo4j"
    password: str = ""
    database: str = "neo4j"
    description: Optional[str] = None


@app.post("/import/neo4j/test-connection")
async def neo4j_test_connection(req: Neo4jConnectionRequest):
    """Test Neo4j connection and return basic stats."""
    try:
        from neo4j import GraphDatabase
    except ImportError:
        raise HTTPException(500, "neo4j驱动未安装，请运行 pip install neo4j")

    try:
        driver = GraphDatabase.driver(req.uri, auth=(req.username, req.password))
        with driver.session(database=req.database) as session:
            # Get node count and label stats
            result = session.run("CALL db.labels() YIELD label RETURN label")
            labels = [r["label"] for r in result]
            result = session.run("MATCH (n) RETURN count(n) as cnt")
            node_count = result.single()["cnt"]
            result = session.run("MATCH ()-[r]->() RETURN count(r) as cnt")
            rel_count = result.single()["cnt"]
            # Get relationship types
            result = session.run("CALL db.relationshipTypes() YIELD relationshipType RETURN relationshipType")
            rel_types = [r["relationshipType"] for r in result]
        driver.close()
        return {"status": "ok", "data": {
            "connected": True,
            "nodeCount": node_count,
            "relationshipCount": rel_count,
            "labels": labels,
            "relationshipTypes": rel_types,
        }}
    except Exception as e:
        return {"status": "ok", "data": {"connected": False, "error": str(e)}}


@app.post("/import/neo4j/pull")
async def neo4j_pull(req: Neo4jPullRequest):
    """Pull graph data from Neo4j and create an ontology snapshot.

    Mapping strategy:
    - Nodes with label containing 'Rule'        → rules
    - Nodes with label containing 'Action'       → actions
    - Nodes with label containing 'Event'        → events
    - All other nodes                            → dataobjects
    - All relationships                          → links
    """
    try:
        from neo4j import GraphDatabase
    except ImportError:
        raise HTTPException(500, "neo4j驱动未安装，请运行 pip install neo4j")

    try:
        driver = GraphDatabase.driver(req.uri, auth=(req.username, req.password))
    except Exception as e:
        raise HTTPException(400, f"Neo4j连接失败: {str(e)}")

    rules = []
    actions = []
    events = []
    dataobjects = []
    links = []

    try:
        with driver.session(database=req.database) as session:
            # Pull all nodes
            result = session.run("MATCH (n) RETURN n, labels(n) as labels, elementId(n) as eid")
            node_map = {}  # eid -> node data for link resolution
            for record in result:
                node = dict(record["n"])
                lbls = record["labels"]
                eid = record["eid"]
                node["_labels"] = lbls
                node["_id"] = eid
                node_map[eid] = node

                labels_lower = " ".join(lbls).lower()
                if "rule" in labels_lower:
                    rules.append(node)
                elif "action" in labels_lower:
                    actions.append(node)
                elif "event" in labels_lower:
                    events.append(node)
                else:
                    dataobjects.append(node)

            # Pull all relationships
            result = session.run(
                "MATCH (a)-[r]->(b) "
                "RETURN type(r) as relType, properties(r) as props, "
                "elementId(a) as srcId, elementId(b) as tgtId, "
                "labels(a) as srcLabels, labels(b) as tgtLabels"
            )
            for record in result:
                src_labels = record["srcLabels"]
                tgt_labels = record["tgtLabels"]
                link = {
                    "relationshipType": record["relType"],
                    "sourceLabels": src_labels,
                    "targetLabels": tgt_labels,
                    "sourceId": record["srcId"],
                    "targetId": record["tgtId"],
                }
                props = record["props"]
                if props:
                    link["properties"] = dict(props)
                links.append(link)
    except Exception as e:
        driver.close()
        raise HTTPException(400, f"Neo4j查询失败: {str(e)}")

    driver.close()

    # Create snapshot
    snapshot_id = f"snap_{int(datetime.now(timezone.utc).timestamp())}_{uuid.uuid4().hex[:8]}"
    snapshot = {
        "snapshotId": snapshot_id,
        "sourceFiles": [f"neo4j://{req.uri}"],
        "description": req.description or f"Neo4j导入 ({req.uri})",
        "rules": rules,
        "dataobjects": dataobjects,
        "actions": actions,
        "events": events,
        "links": links,
        "rulesCount": len(rules),
        "dataObjectsCount": len(dataobjects),
        "actionsCount": len(actions),
        "eventsCount": len(events),
        "linksCount": len(links),
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }

    # Run deterministic validation
    validation_report = _validate_snapshot(snapshot)
    snapshot["validationReport"] = validation_report

    with _lock:
        _snapshots.insert(0, snapshot)
        _persist_snapshots()

    return {"status": "ok", "data": {
        "snapshotId": snapshot["snapshotId"],
        "sourceFiles": snapshot["sourceFiles"],
        "rulesCount": snapshot["rulesCount"],
        "dataObjectsCount": snapshot["dataObjectsCount"],
        "actionsCount": snapshot["actionsCount"],
        "eventsCount": snapshot["eventsCount"],
        "linksCount": snapshot["linksCount"],
        "createdAt": snapshot["createdAt"],
        "validationReport": validation_report,
    }}


# ─── MinIO Import ─────────────────────────────────────────────────────────────

class MinIOConnectionRequest(BaseModel):
    endpoint: str = "localhost:9000"
    access_key: str = ""
    secret_key: str = ""
    secure: bool = False


class MinIOBrowseRequest(BaseModel):
    endpoint: str = "localhost:9000"
    access_key: str = ""
    secret_key: str = ""
    secure: bool = False
    bucket: str = ""
    prefix: str = ""


class MinIOPullRequest(BaseModel):
    endpoint: str = "localhost:9000"
    access_key: str = ""
    secret_key: str = ""
    secure: bool = False
    bucket: str
    objects: List[str]  # list of object keys to pull


def _get_minio_client(endpoint: str, access_key: str, secret_key: str, secure: bool):
    try:
        from minio import Minio
    except ImportError:
        raise HTTPException(500, "minio SDK未安装，请运行 pip install minio")
    return Minio(endpoint, access_key=access_key, secret_key=secret_key, secure=secure)


@app.post("/import/minio/test-connection")
async def minio_test_connection(req: MinIOConnectionRequest):
    """Test MinIO connection and list buckets."""
    try:
        client = _get_minio_client(req.endpoint, req.access_key, req.secret_key, req.secure)
        buckets = client.list_buckets()
        return {"status": "ok", "data": {
            "connected": True,
            "buckets": [{"name": b.name, "creationDate": str(b.creation_date)} for b in buckets],
        }}
    except Exception as e:
        return {"status": "ok", "data": {"connected": False, "error": str(e)}}


@app.post("/import/minio/browse")
async def minio_browse(req: MinIOBrowseRequest):
    """Browse objects in a MinIO bucket."""
    try:
        client = _get_minio_client(req.endpoint, req.access_key, req.secret_key, req.secure)
        if not req.bucket:
            # List all buckets
            buckets = client.list_buckets()
            return {"status": "ok", "data": {
                "buckets": [{"name": b.name, "creationDate": str(b.creation_date)} for b in buckets],
                "objects": [],
            }}
        # List objects in bucket
        objects = client.list_objects(req.bucket, prefix=req.prefix or None, recursive=False)
        items = []
        for obj in objects:
            items.append({
                "name": obj.object_name,
                "size": obj.size,
                "isDir": obj.is_dir,
                "lastModified": str(obj.last_modified) if obj.last_modified else None,
            })
        return {"status": "ok", "data": {"bucket": req.bucket, "prefix": req.prefix, "objects": items}}
    except Exception as e:
        raise HTTPException(400, f"MinIO浏览失败: {str(e)}")


@app.post("/import/minio/pull")
async def minio_pull(req: MinIOPullRequest):
    """Pull files from MinIO and import them.

    Auto-detects file types:
    - .pdf → resume (business data)
    - .csv → JD (business data)
    - .json → ontology snapshot (dataobjects, actions, events, rules, links by filename)
    """
    try:
        client = _get_minio_client(req.endpoint, req.access_key, req.secret_key, req.secure)
    except Exception as e:
        raise HTTPException(400, f"MinIO连接失败: {str(e)}")

    results = {"resumes": 0, "jds": 0, "ontologyFiles": 0, "errors": [], "snapshotId": None}
    ontology_sections = {"rules": [], "dataobjects": [], "actions": [], "events": [], "links": []}
    ontology_source_files = []

    for obj_key in req.objects:
        try:
            response = client.get_object(req.bucket, obj_key)
            content = response.read()
            response.close()
            response.release_conn()
            filename = obj_key.split("/")[-1]
            lower_name = filename.lower()

            if lower_name.endswith(".pdf"):
                # Import as resume
                try:
                    import pdfplumber
                    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                        tmp.write(content)
                        tmp_path = tmp.name
                    raw_text = ""
                    with pdfplumber.open(tmp_path) as pdf:
                        for page in pdf.pages:
                            t = page.extract_text()
                            if t:
                                raw_text += t + "\n"
                    os.unlink(tmp_path)

                    if not raw_text.strip():
                        results["errors"].append(f"{filename}: PDF无文本内容")
                        continue

                    cleaned = _clean_pdf_text(raw_text)
                    parsed_data = {"rawText": cleaned.strip() or raw_text.strip()}
                    parsed_data.update(_regex_resume(cleaned))

                    if gemini.is_configured:
                        parse_prompt = f"""请从以下简历文本中提取结构化信息，返回JSON对象。
文本含部分格式干扰字符，请忽略乱码、识别有意义的中文内容。
只提取文本中明确存在的信息，不编造不存在的内容。

返回格式（纯JSON）：
{{
  "name": "候选人姓名",
  "phone": "电话或null",
  "email": "邮箱或null",
  "education": [{{"school": "学校", "degree": "学历", "major": "专业", "graduationYear": "年份"}}],
  "experience": [{{"company": "公司", "title": "职位", "startDate": "开始", "endDate": "结束", "description": "职责简述"}}],
  "skills": ["技能列表"],
  "summary": "核心背景摘要（1-2句）"
}}

简历文本：
{cleaned[:4500]}"""
                        result = await gemini.generate_json(
                            "你是专业简历解析器。从含格式干扰的简历文本中提取结构化数据，只输出文本中实际存在的内容，返回纯JSON。",
                            parse_prompt, temp=0.1
                        )
                        if result and isinstance(result, dict):
                            for k, v in result.items():
                                if v is not None and v != "" and v != [] and k != "rawText":
                                    parsed_data[k] = v

                    item_id = f"bd_{uuid.uuid4().hex[:8]}"
                    item = {
                        "itemId": item_id,
                        "type": "resume",
                        "filename": filename,
                        "parsedData": parsed_data,
                        "pdfBase64": _base64.b64encode(content).decode("ascii"),
                        "uploadedAt": datetime.now(timezone.utc).isoformat(),
                    }
                    with _lock:
                        _business_data.insert(0, item)
                        _persist_business_data()
                    results["resumes"] += 1
                except Exception as e:
                    results["errors"].append(f"{filename}: PDF解析失败 - {str(e)[:100]}")

            elif lower_name.endswith(".csv"):
                # Import as JD
                try:
                    text = None
                    for enc in ("utf-8-sig", "gbk", "utf-8", "latin-1"):
                        try:
                            text = content.decode(enc)
                            break
                        except Exception:
                            pass
                    if text is None:
                        results["errors"].append(f"{filename}: CSV编码无法识别")
                        continue

                    all_rows = list(csv.reader(io.StringIO(text)))
                    if not all_rows:
                        results["errors"].append(f"{filename}: CSV文件为空")
                        continue

                    header_idx, max_ne = 0, 0
                    for i, row in enumerate(all_rows[:6]):
                        ne = sum(1 for c in row if c.strip())
                        if ne > max_ne:
                            max_ne, header_idx = ne, i

                    headers = [h.strip() for h in all_rows[header_idx]]
                    records = []
                    for row in all_rows[header_idx + 1:]:
                        if not any(c.strip() for c in row):
                            continue
                        rec = {headers[i]: row[i].strip() for i in range(min(len(headers), len(row))) if headers[i]}
                        if any(v for v in rec.values()):
                            records.append(rec)

                    if not records:
                        results["errors"].append(f"{filename}: CSV无有效数据")
                        continue

                    item_id = f"bd_{uuid.uuid4().hex[:8]}"
                    item = {
                        "itemId": item_id,
                        "type": "jd",
                        "filename": filename,
                        "columns": [h for h in headers if h],
                        "records": records,
                        "recordCount": len(records),
                        "uploadedAt": datetime.now(timezone.utc).isoformat(),
                    }
                    with _lock:
                        _business_data.insert(0, item)
                        _persist_business_data()
                    results["jds"] += 1
                except Exception as e:
                    results["errors"].append(f"{filename}: CSV解析失败 - {str(e)[:100]}")

            elif lower_name.endswith(".json"):
                # Import as ontology data
                try:
                    raw = json.loads(content.decode("utf-8"))
                    sections = _parse_ontology_json(raw, filename)
                    for key in ontology_sections:
                        if sections[key]:
                            ontology_sections[key].extend(sections[key])
                    ontology_source_files.append(filename)
                    results["ontologyFiles"] += 1
                except Exception as e:
                    results["errors"].append(f"{filename}: JSON解析失败 - {str(e)[:100]}")
            else:
                results["errors"].append(f"{filename}: 不支持的文件类型")

        except Exception as e:
            results["errors"].append(f"{obj_key}: 下载失败 - {str(e)[:100]}")

    # Create ontology snapshot if any JSON files were imported
    if results["ontologyFiles"] > 0:
        snapshot_id = f"snap_{int(datetime.now(timezone.utc).timestamp())}_{uuid.uuid4().hex[:8]}"
        snapshot = {
            "snapshotId": snapshot_id,
            "sourceFiles": [f"minio://{req.bucket}/{f}" for f in ontology_source_files],
            "description": f"MinIO导入 ({req.bucket})",
            "rules": ontology_sections["rules"],
            "dataobjects": ontology_sections["dataobjects"],
            "actions": ontology_sections["actions"],
            "events": ontology_sections["events"],
            "links": ontology_sections["links"],
            "rulesCount": len(ontology_sections["rules"]),
            "dataObjectsCount": len(ontology_sections["dataobjects"]),
            "actionsCount": len(ontology_sections["actions"]),
            "eventsCount": len(ontology_sections["events"]),
            "linksCount": len(ontology_sections["links"]),
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }
        # Run deterministic validation
        validation_report = _validate_snapshot(snapshot)
        snapshot["validationReport"] = validation_report
        with _lock:
            _snapshots.insert(0, snapshot)
            _persist_snapshots()
        results["snapshotId"] = snapshot_id
        results["validationReport"] = validation_report

    return {"status": "ok", "data": results}


# ─── Deterministic Validation & Execution ────────────────────────────────────

@app.get("/ontology/snapshots/{snapshot_id}/validate")
async def validate_snapshot_endpoint(
    snapshot_id: str,
    strict: bool = Query(False, description="If true, returns error when P0 blockers exist"),
):
    """Run deterministic validation on a snapshot (no LLM)."""
    snap = None
    for s in _snapshots:
        if s["snapshotId"] == snapshot_id:
            snap = s
            break
    if not snap:
        raise HTTPException(404, "快照不存在")

    try:
        report = _validate_snapshot(snap, strict=strict)
    except ValueError as e:
        raise HTTPException(422, str(e))

    # Persist the report on the snapshot
    with _lock:
        snap["validationReport"] = report
        _persist_snapshots()

    return {"status": "ok", "data": report}


class DeterministicExecuteRequest(BaseModel):
    snapshotId: str
    strict: bool = False
    criticalPaths: Optional[List[List[str]]] = None


@app.post("/executor/run-deterministic")
async def execute_deterministic(request: DeterministicExecuteRequest):
    """Deterministic execution: validator + rule graph only, no LLM, no sampling."""
    snap = None
    for s in _snapshots:
        if s["snapshotId"] == request.snapshotId:
            snap = s
            break
    if not snap:
        raise HTTPException(404, "快照不存在")

    try:
        report = _validate_snapshot(
            snap,
            strict=request.strict,
            critical_paths=request.criticalPaths,
        )
    except ValueError as e:
        raise HTTPException(422, str(e))

    # Build a run record from validation results
    run_id = f"run_{uuid.uuid4().hex[:8]}"
    p0 = report["summary"]["P0"]
    p1 = report["summary"]["P1"]
    p2 = report["summary"]["P2"]
    total = report["summary"]["total"]

    # Map validation errors to execution records
    records = []
    for err in report["allErrors"]:
        records.append({
            "recordId": f"rec_{uuid.uuid4().hex[:8]}",
            "caseId": f"VAL-{err['code']}-{err['entityId'][:20]}",
            "category": err["entityType"],
            "verdict": "FAIL" if err["severity"] == "P0" else ("WARNING" if err["severity"] == "P1" else "PASS"),
            "reasoning": err["message"],
            "triggeredRules": [],
            "assertionResults": [{
                "assertion": err["code"],
                "expected": "valid",
                "actual": err["message"][:100],
                "passed": False,
            }],
            "executionDurationMs": 0,
            "executedAt": datetime.now(timezone.utc).isoformat(),
            "snapshotId": request.snapshotId,
            "evidence": err.get("evidence", ""),
        })

    passed = sum(1 for r in records if r["verdict"] == "PASS")
    failed = sum(1 for r in records if r["verdict"] == "FAIL")
    warnings = sum(1 for r in records if r["verdict"] == "WARNING")

    run = {
        "runId": run_id,
        "snapshotId": request.snapshotId,
        "executionMode": "deterministic",
        "totalCases": len(records),
        "passedCases": passed,
        "failedCases": failed,
        "warningCases": warnings,
        "coverageRate": round(passed / max(len(records), 1), 2),
        "records": records,
        "executedAt": datetime.now(timezone.utc).isoformat(),
        "validationReport": report,
    }

    with _lock:
        snap["validationReport"] = report
        _runs.insert(0, run)
        _persist_runs()
        _persist_snapshots()

    return {"status": "ok", "data": run}


# ─── Simulated Data Management ────────────────────────────────────────────────

SIMULATED_DATA_FILE = DATA_DIR / "simulated_data.json"
_simulated_data: List[Dict] = _load_json(SIMULATED_DATA_FILE)


def _persist_simulated_data():
    _save_json(SIMULATED_DATA_FILE, _simulated_data)


class SimulatedDataRequest(BaseModel):
    snapshotId: str
    dataType: str = "resume"  # resume | jd
    subTypes: List[str] = ["normal"]
    count: int = 3


@app.post("/simulated-data/generate")
async def generate_simulated_data(req: SimulatedDataRequest):
    """Use LLM to generate simulated resumes or JDs."""
    snap = None
    for s in _snapshots:
        if s["snapshotId"] == req.snapshotId:
            snap = s
            break
    if not snap:
        raise HTTPException(404, "Snapshot not found")

    rules_sample = json.dumps(snap.get("rules", [])[:5], ensure_ascii=False, indent=1)
    do_sample = json.dumps(snap.get("dataobjects", [])[:5], ensure_ascii=False, indent=1)

    all_generated = []
    for sub_type in req.subTypes:
        if req.dataType == "resume":
            prompt = f"""Generate {req.count} simulated resume(s) of type "{sub_type}" for HRO testing.

Type descriptions:
- normal: Standard well-qualified candidate
- missing_education: Candidate with no or incomplete education info
- missing_skills: Candidate missing key technical skills
- career_gap: Candidate with significant employment gaps (2+ years)
- strange_degree: Candidate with unusual/unrecognized degree
- overqualified: Candidate far exceeding job requirements
- junior_candidate: Fresh graduate with minimal experience

Ontology Rules (for context):
{rules_sample}

DataObjects (for field reference):
{do_sample}

Return a JSON array of {req.count} resume objects. Each must have:
- name: string (Chinese name)
- phone: string
- email: string
- education: [{{school, degree, major, graduationYear}}]
- experience: [{{company, title, startDate, endDate, description}}]
- skills: [string]
- summary: string (1-2 sentence summary)

Make the data realistic and in Chinese. For abnormal types, ensure the defects are clearly present."""
        else:
            prompt = f"""Generate {req.count} simulated Job Description(s) of type "{sub_type}" for HRO testing.

Type descriptions:
- normal: Standard clear JD with reasonable requirements
- vague_requirements: JD with unclear or ambiguous skill requirements
- conflicting_criteria: JD with contradictory requirements (e.g., "5 years experience" + "fresh graduate welcome")
- extreme_salary: JD with unreasonably high or low salary range
- niche_role: Very specialized role that few candidates would match

Ontology context:
{rules_sample}

Return a JSON array of {req.count} JD objects. Each must have:
- title: string (job title in Chinese)
- department: string
- requirements: [string] (list of requirements)
- responsibilities: [string]
- salaryRange: string
- location: string
- experienceYears: string

Make the data realistic and in Chinese. For abnormal types, ensure the issues are clearly present."""

        system = "You are an expert HRO data simulator. Generate realistic Chinese HR data for testing purposes."
        result = await gemini.generate_json(system, prompt, temp=0.6)
        if result is None:
            raise HTTPException(500, gemini.last_error or "LLM generation failed")

        items_raw = result if isinstance(result, list) else [result]
        for item_data in items_raw:
            item = {
                "itemId": f"sim_{uuid.uuid4().hex[:8]}",
                "type": req.dataType,
                "subType": sub_type,
                "filename": f"simulated_{sub_type}_{uuid.uuid4().hex[:4]}.json",
                "generatedData": item_data,
                "generatedAt": datetime.now(timezone.utc).isoformat(),
            }
            all_generated.append(item)

    with _lock:
        _simulated_data.extend(all_generated)
        _persist_simulated_data()

    return {"status": "ok", "data": {"generated": all_generated}}


@app.get("/simulated-data/list")
async def list_simulated_data():
    return {"status": "ok", "data": _simulated_data}


@app.delete("/simulated-data/{item_id}")
async def delete_simulated_data(item_id: str):
    with _lock:
        before = len(_simulated_data)
        _simulated_data[:] = [i for i in _simulated_data if i["itemId"] != item_id]
        if len(_simulated_data) < before:
            _persist_simulated_data()
            return {"status": "ok"}
    raise HTTPException(404, "Item not found")


@app.post("/simulated-data/{item_id}/import")
async def import_simulated_to_real(item_id: str):
    """Import a simulated data item into the real business data pool."""
    target = None
    for item in _simulated_data:
        if item["itemId"] == item_id:
            target = item
            break
    if not target:
        raise HTTPException(404, "Item not found")

    data = target["generatedData"]
    new_id = f"bd_{uuid.uuid4().hex[:8]}"

    if target["type"] == "resume":
        bd_item = {
            "itemId": new_id,
            "type": "resume",
            "filename": f"[simulated] {data.get('name', 'unknown')}.json",
            "parsedData": data,
            "uploadedAt": datetime.now(timezone.utc).isoformat(),
        }
    else:
        bd_item = {
            "itemId": new_id,
            "type": "jd",
            "filename": f"[simulated] {data.get('title', 'unknown')}.json",
            "columns": list(data.keys()),
            "records": [data],
            "recordCount": 1,
            "uploadedAt": datetime.now(timezone.utc).isoformat(),
        }

    with _lock:
        _business_data.insert(0, bd_item)
        _persist_business_data()

    return {"status": "ok", "data": {"itemId": new_id}}


class BatchImportRequest(BaseModel):
    itemIds: List[str] = Field(default_factory=list)


@app.post("/simulated-data/batch-import")
async def batch_import_simulated(req: BatchImportRequest):
    """Batch import simulated data items into the real business data pool."""
    targets = []
    if req.itemIds:
        for item in _simulated_data:
            if item["itemId"] in req.itemIds:
                targets.append(item)
    else:
        targets = list(_simulated_data)

    if not targets:
        raise HTTPException(400, "没有可导入的模拟数据")

    imported = 0
    failed = 0
    errors = []
    for target in targets:
        try:
            data = target["generatedData"]
            new_id = f"bd_{uuid.uuid4().hex[:8]}"
            if target["type"] == "resume":
                bd_item = {
                    "itemId": new_id,
                    "type": "resume",
                    "filename": f"[simulated] {data.get('name', 'unknown')}.json",
                    "parsedData": data,
                    "uploadedAt": datetime.now(timezone.utc).isoformat(),
                }
            else:
                bd_item = {
                    "itemId": new_id,
                    "type": "jd",
                    "filename": f"[simulated] {data.get('title', 'unknown')}.json",
                    "columns": list(data.keys()),
                    "records": [data],
                    "recordCount": 1,
                    "uploadedAt": datetime.now(timezone.utc).isoformat(),
                }
            with _lock:
                _business_data.insert(0, bd_item)
            imported += 1
        except Exception as e:
            failed += 1
            errors.append(str(e))

    with _lock:
        _persist_business_data()

    return {"status": "ok", "data": {"imported": imported, "failed": failed, "errors": errors}}


# ─── Cross-Test APIs ─────────────────────────────────────────────────────────

class CrossTestByResumeRequest(BaseModel):
    snapshotId: str
    resumeId: str
    jdIds: List[str]


class CrossTestByJdRequest(BaseModel):
    snapshotId: str
    jdId: str
    resumeIds: List[str]


class CrossTestValidateRequest(BaseModel):
    snapshotId: str
    resumeIds: List[str] = []
    jdIds: List[str] = []


def _get_business_item(item_id: str):
    for item in _business_data:
        if item["itemId"] == item_id:
            return item
    return None


def _resume_summary(item: dict) -> str:
    pd = item.get("parsedData", item.get("generatedData", {}))
    return json.dumps({
        "name": pd.get("name", "unknown"),
        "skills": pd.get("skills", []),
        "education": pd.get("education", []),
        "experience": pd.get("experience", []),
        "summary": pd.get("summary", ""),
    }, ensure_ascii=False)


def _jd_summary(item: dict) -> str:
    if item.get("records"):
        rec = item["records"][0] if len(item["records"]) == 1 else item["records"][:2]
        title = item.get("title", item.get("filename", ""))
        return json.dumps({"title": title, "data": rec}, ensure_ascii=False)
    gd = item.get("generatedData", {})
    return json.dumps({
        "title": gd.get("title", ""),
        "requirements": gd.get("requirements", []),
        "responsibilities": gd.get("responsibilities", []),
    }, ensure_ascii=False)


async def _run_cross_test(snap: dict, resume_items: list, jd_items: list, mode: str) -> dict:
    """Core cross-test logic: match resumes against JDs using LLM."""
    pairs = []
    for r in resume_items:
        r_name = (r.get("parsedData") or r.get("generatedData") or {}).get("name", r.get("filename", "unknown"))
        for j in jd_items:
            # Extract JD title: prefer title field, then first column of first record, then filename
            j_title = j.get("title", "")
            if not j_title and j.get("records"):
                cols = j.get("columns", [])
                first_rec = j["records"][0] if j["records"] else {}
                # Try to find a title-like column
                for col in cols:
                    if any(kw in col.lower() for kw in ("职位", "岗位", "title", "名称")):
                        j_title = first_rec.get(col, "")
                        break
                if not j_title and cols:
                    j_title = first_rec.get(cols[0], "")
            if not j_title and j.get("generatedData"):
                j_title = j["generatedData"].get("title", "")
            if not j_title:
                j_title = j.get("filename", "unknown")
            pairs.append({"resumeName": r_name, "jdTitle": j_title, "resumeId": r["itemId"], "jdId": j["itemId"]})

    # Build context
    resume_texts = [_resume_summary(r) for r in resume_items[:10]]
    jd_texts = [_jd_summary(j) for j in jd_items[:10]]
    rules_ctx = json.dumps(snap.get("rules", [])[:10], ensure_ascii=False, indent=1)
    pairs_json = json.dumps(
        [{"resumeName": p["resumeName"], "jdTitle": p["jdTitle"]} for p in pairs],
        ensure_ascii=False,
    )

    prompt = f"""You are an HRO recruitment matching evaluator. Evaluate each resume-JD pair below.

## Ontology Rules
{rules_ctx}

## Resumes
{chr(10).join(resume_texts)}

## Job Descriptions
{chr(10).join(jd_texts)}

## Pairs to evaluate ({len(pairs)})
{pairs_json}

For each pair, return:
{{
  "resumeName": "<name>",
  "jdTitle": "<title>",
  "verdict": "PASS" | "FAIL" | "WARNING",
  "triggeredRules": ["<rule IDs that exactly match rule names from the Ontology Rules list above>"],
  "reasoning": "<Chinese, 2-3 sentences explaining WHY the rules are violated or satisfied>",
  "failedNode": <only if FAIL> {{
    "ruleName": "<failed rule, must match a rule name from the Ontology Rules above>",
    "ruleDescription": "<description>",
    "brokenLink": "<broken link or null>",
    "funnelStage": "<stage like screening/interview/offer>",
    "failureType": "<RULE_MISMATCH|SKILL_GAP|EDUCATION_MISMATCH|EXPERIENCE_INSUFFICIENT|PRECONDITION_FAIL>",
    "contextSnapshot": {{}}
  }},
  "matchTrace": [
    {{"step": "<matching dimension name in Chinese, e.g. 技能匹配/学历要求/工作经验/规则校验>", "status": "pass"|"fail"|"skip", "detail": "<Chinese, explain what was checked and the result>"}}
  ]
}}

IMPORTANT: matchTrace must contain 3-6 steps showing the full matching process. Each step represents a dimension checked. Mark the step where matching failed with status "fail" and explain why. Steps after a critical failure should be "skip".

Return a JSON array."""

    result = await gemini.generate_json(SYSTEM_PROMPT, prompt, temp=0.3)

    # Build rule name -> full rule document mapping from snapshot
    rules_list = snap.get("rules", [])
    rule_doc_map = {}
    for rule in rules_list:
        rname = rule.get("name", rule.get("ruleName", ""))
        if rname:
            # Build full rule text from all available fields
            parts = []
            if rule.get("description"):
                parts.append(f"描述: {rule['description']}")
            if rule.get("conditions"):
                cond = rule["conditions"] if isinstance(rule["conditions"], str) else json.dumps(rule["conditions"], ensure_ascii=False)
                parts.append(f"条件: {cond}")
            if rule.get("actions"):
                act = rule["actions"] if isinstance(rule["actions"], str) else json.dumps(rule["actions"], ensure_ascii=False)
                parts.append(f"动作: {act}")
            if rule.get("priority"):
                parts.append(f"优先级: {rule['priority']}")
            if rule.get("category"):
                parts.append(f"类别: {rule['category']}")
            rule_doc_map[rname] = "; ".join(parts) if parts else json.dumps(rule, ensure_ascii=False)

    results = []
    if result:
        if isinstance(result, list):
            raw = result
        elif isinstance(result, dict):
            raw = result.get("results", [])
        else:
            raw = []
        # Validate and fix each result entry
        for i, entry in enumerate(raw):
            if not isinstance(entry, dict):
                continue
            # Ensure required fields exist
            if "verdict" not in entry:
                entry["verdict"] = "WARNING"
            if "reasoning" not in entry:
                entry["reasoning"] = "LLM 未提供推理说明"
            if "triggeredRules" not in entry:
                entry["triggeredRules"] = []
            if "matchTrace" not in entry or not isinstance(entry.get("matchTrace"), list):
                entry["matchTrace"] = []
            # Map pair info if missing
            if i < len(pairs):
                if "resumeName" not in entry:
                    entry["resumeName"] = pairs[i]["resumeName"]
                if "jdTitle" not in entry:
                    entry["jdTitle"] = pairs[i]["jdTitle"]
            # Replace failedNode.ruleDescription with original rule doc text
            fn = entry.get("failedNode")
            if fn and isinstance(fn, dict):
                rn = fn.get("ruleName", "")
                if rn in rule_doc_map:
                    fn["ruleDescription"] = rule_doc_map[rn]
            _enrich_failed_node(entry.get("failedNode"), rules_list)
            results.append(entry)
    else:
        error_msg = gemini.last_error or "LLM 服务不可用，请检查 API Key 配置"
        logger.error(f"Cross-test LLM call failed: {error_msg}")
        for p in pairs:
            results.append({
                "resumeName": p["resumeName"],
                "jdTitle": p["jdTitle"],
                "verdict": "ERROR",
                "triggeredRules": [],
                "reasoning": error_msg,
            })

    now_iso = datetime.now(timezone.utc).isoformat()
    ct_result = {
        "testId": f"ct_{uuid.uuid4().hex[:8]}",
        "mode": mode,
        "resumeNames": list(set(p["resumeName"] for p in pairs)),
        "jdTitles": list(set(p["jdTitle"] for p in pairs)),
        "results": results,
        "executedAt": now_iso,
    }

    # ── Persist cross-test result as a TestRun for history & reports ──
    ct_passed = sum(1 for r in results if r.get("verdict") == "PASS")
    ct_failed = sum(1 for r in results if r.get("verdict") == "FAIL")
    ct_warnings = sum(1 for r in results if r.get("verdict") == "WARNING")
    ct_records = []
    for idx, r in enumerate(results):
        rec = {
            "recordId": f"rec_{uuid.uuid4().hex[:8]}",
            "caseId": f"{r.get('resumeName', '')} × {r.get('jdTitle', '')}",
            "verdict": r.get("verdict", "WARNING"),
            "reasoning": r.get("reasoning", ""),
            "triggeredRules": r.get("triggeredRules", []),
            "assertionResults": [],
            "executionDurationMs": 0,
            "executedAt": now_iso,
            "snapshotId": snap.get("snapshotId", ""),
            "category": "cross_test",
            "title": f"{r.get('resumeName', '')} ↔ {r.get('jdTitle', '')}",
            "failedNode": r.get("failedNode"),
        }
        ct_records.append(rec)

    ct_run = {
        "runId": f"run_{uuid.uuid4().hex[:8]}",
        "snapshotId": snap.get("snapshotId", ""),
        "executionMode": f"cross_test:{mode}",
        "totalCases": len(results),
        "passedCases": ct_passed,
        "failedCases": ct_failed,
        "warningCases": ct_warnings,
        "coverageRate": round(ct_passed / max(len(results), 1), 2),
        "records": ct_records,
        "executedAt": now_iso,
    }
    with _lock:
        _runs.insert(0, ct_run)
        _persist_runs()

    return ct_result


@app.post("/cross-test/by-resume")
async def cross_test_by_resume(req: CrossTestByResumeRequest):
    snap = None
    for s in _snapshots:
        if s["snapshotId"] == req.snapshotId:
            snap = s
            break
    if not snap:
        raise HTTPException(404, "Snapshot not found")

    resume = _get_business_item(req.resumeId)
    if not resume:
        raise HTTPException(404, "Resume not found")

    jd_items = [_get_business_item(jid) for jid in req.jdIds]
    jd_items = [j for j in jd_items if j]
    if not jd_items:
        raise HTTPException(400, "No valid JDs found")

    try:
        result = await _run_cross_test(snap, [resume], jd_items, "by_resume")
    except Exception as e:
        logger.error(f"Cross-test by-resume failed: {e}")
        raise HTTPException(500, f"交叉测试执行失败: {str(e)}")
    return {"status": "ok", "data": result}


@app.post("/cross-test/by-jd")
async def cross_test_by_jd(req: CrossTestByJdRequest):
    snap = None
    for s in _snapshots:
        if s["snapshotId"] == req.snapshotId:
            snap = s
            break
    if not snap:
        raise HTTPException(404, "Snapshot not found")

    jd = _get_business_item(req.jdId)
    if not jd:
        raise HTTPException(404, "JD not found")

    resume_items = [_get_business_item(rid) for rid in req.resumeIds]
    resume_items = [r for r in resume_items if r]
    if not resume_items:
        raise HTTPException(400, "No valid resumes found")

    try:
        result = await _run_cross_test(snap, resume_items, [jd], "by_jd")
    except Exception as e:
        logger.error(f"Cross-test by-jd failed: {e}")
        raise HTTPException(500, f"交叉测试执行失败: {str(e)}")
    return {"status": "ok", "data": result}


@app.post("/cross-test/cross-validate")
async def cross_test_validate(req: CrossTestValidateRequest):
    snap = None
    for s in _snapshots:
        if s["snapshotId"] == req.snapshotId:
            snap = s
            break
    if not snap:
        raise HTTPException(404, "Snapshot not found")

    if req.resumeIds:
        resume_items = [_get_business_item(rid) for rid in req.resumeIds]
        resume_items = [r for r in resume_items if r]
    else:
        resume_items = [i for i in _business_data if i["type"] == "resume"]

    if req.jdIds:
        jd_items = [_get_business_item(jid) for jid in req.jdIds]
        jd_items = [j for j in jd_items if j]
    else:
        jd_items = [i for i in _business_data if i["type"] == "jd"]

    if not resume_items or not jd_items:
        raise HTTPException(400, "Need at least 1 resume and 1 JD for cross-validation")

    try:
        result = await _run_cross_test(snap, resume_items[:10], jd_items[:10], "cross_validate")
    except Exception as e:
        logger.error(f"Cross-test cross-validate failed: {e}")
        raise HTTPException(500, f"交叉测试执行失败: {str(e)}")
    return {"status": "ok", "data": result}


# ─── Optimization APIs ───────────────────────────────────────────────────────

class GapAnalysisRequest(BaseModel):
    runId: str


class SuggestionsRequest(BaseModel):
    runId: str


@app.post("/optimization/gap-analysis")
async def gap_analysis(req: GapAnalysisRequest):
    """Analyze failed test cases to identify gaps for each candidate."""
    run = None
    for r in _runs:
        if r["runId"] == req.runId:
            run = r
            break
    if not run:
        raise HTTPException(404, "Run not found")

    # Build rule name -> full doc mapping from the snapshot used in this run
    snap_id = run.get("snapshotId", "")
    snap = None
    for s in _snapshots:
        if s["snapshotId"] == snap_id:
            snap = s
            break
    rule_doc_map = {}
    if snap:
        for rule in snap.get("rules", []):
            rname = rule.get("name", rule.get("ruleName", ""))
            if rname:
                parts = []
                if rule.get("description"):
                    parts.append(f"描述: {rule['description']}")
                if rule.get("conditions"):
                    cond = rule["conditions"] if isinstance(rule["conditions"], str) else json.dumps(rule["conditions"], ensure_ascii=False)
                    parts.append(f"条件: {cond}")
                if rule.get("actions"):
                    act = rule["actions"] if isinstance(rule["actions"], str) else json.dumps(rule["actions"], ensure_ascii=False)
                    parts.append(f"动作: {act}")
                if rule.get("priority"):
                    parts.append(f"优先级: {rule['priority']}")
                if rule.get("category"):
                    parts.append(f"类别: {rule['category']}")
                rule_doc_map[rname] = "; ".join(parts) if parts else json.dumps(rule, ensure_ascii=False)

    records = run.get("records", [])
    failed_records = [r for r in records if r.get("verdict") in ("FAIL", "ERROR", "WARNING")]

    if not failed_records:
        return {"status": "ok", "data": {"analysis": []}}

    # Include available rule names so LLM can reference them exactly
    available_rules = list(rule_doc_map.keys()) if rule_doc_map else []

    failed_summary = json.dumps([{
        "caseId": r.get("caseId"),
        "verdict": r.get("verdict"),
        "reasoning": r.get("reasoning"),
        "triggeredRules": r.get("triggeredRules", []),
        "failedNode": r.get("failedNode"),
        "category": r.get("category", ""),
        "title": r.get("title", ""),
    } for r in failed_records[:50]], ensure_ascii=False, indent=1)

    prompt = f"""Analyze the following {len(failed_records)} failed/warning test results from an HRO ontology test run.
Extract structured gap analysis information.

## Available Ontology Rule Names
{json.dumps(available_rules, ensure_ascii=False)}

## Failed Records
{failed_summary}

## Task
For each distinct candidate or scenario identified in the failures, produce a gap analysis entry.

Return a JSON array where each item has:
- candidateName: string (candidate name or test scenario name)
- jdTitle: string (related JD or test category)
- failedRules: [{{ruleName: string (MUST match one of the Available Ontology Rule Names above), ruleDescription: string, severity: "P0"|"P1"|"P2"}}]
- missingSkills: [string] (skills or capabilities that are missing)
- gapScore: number (0.0 to 1.0, where 1.0 means maximum gap)

IMPORTANT: Each failedRules[].ruleName MUST exactly match a rule name from the Available Ontology Rule Names list.

Generate 3-8 gap analysis entries based on the failure patterns. Use Chinese for descriptions."""

    result = await gemini.generate_json(SYSTEM_PROMPT, prompt, temp=0.3)
    if result is None:
        raise HTTPException(500, gemini.last_error or "LLM analysis failed")

    analysis = result if isinstance(result, list) else result.get("analysis", [])

    # Post-process: replace ruleDescription and enrich with rule detail fields
    rules_list = snap.get("rules", []) if snap else []
    for item in analysis:
        if not isinstance(item, dict):
            continue
        for fr in item.get("failedRules", []):
            if not isinstance(fr, dict):
                continue
            rn = fr.get("ruleName", "")
            if rn in rule_doc_map:
                fr["ruleDescription"] = rule_doc_map[rn]
            elif rn:
                fr["ruleDescription"] = f"[未匹配规则原文] {fr.get('ruleDescription', '')}"
            # Enrich with full rule detail fields from snapshot
            _enrich_failed_node(fr, rules_list)

    return {"status": "ok", "data": {"analysis": analysis}}


@app.post("/optimization/suggestions")
async def optimization_suggestions(req: SuggestionsRequest):
    """Generate actionable optimization suggestions based on test failures, linked to specific violated rules."""
    run = None
    for r in _runs:
        if r["runId"] == req.runId:
            run = r
            break
    if not run:
        raise HTTPException(404, "Run not found")

    # Build rule doc map from snapshot
    snap_id = run.get("snapshotId", "")
    snap = None
    for s in _snapshots:
        if s["snapshotId"] == snap_id:
            snap = s
            break
    rule_doc_map = {}
    if snap:
        for rule in snap.get("rules", []):
            rname = rule.get("name", rule.get("ruleName", ""))
            if rname:
                parts = []
                if rule.get("description"):
                    parts.append(f"描述: {rule['description']}")
                if rule.get("conditions"):
                    cond = rule["conditions"] if isinstance(rule["conditions"], str) else json.dumps(rule["conditions"], ensure_ascii=False)
                    parts.append(f"条件: {cond}")
                if rule.get("actions"):
                    act = rule["actions"] if isinstance(rule["actions"], str) else json.dumps(rule["actions"], ensure_ascii=False)
                    parts.append(f"动作: {act}")
                rule_doc_map[rname] = "; ".join(parts) if parts else json.dumps(rule, ensure_ascii=False)

    records = run.get("records", [])
    failed_records = [r for r in records if r.get("verdict") in ("FAIL", "ERROR", "WARNING")]

    if not failed_records:
        return {"status": "ok", "data": {"suggestions": []}}

    failed_summary = json.dumps([{
        "caseId": r.get("caseId"),
        "verdict": r.get("verdict"),
        "reasoning": r.get("reasoning"),
        "triggeredRules": r.get("triggeredRules", []),
        "failedNode": r.get("failedNode"),
        "title": r.get("title", ""),
    } for r in failed_records[:50]], ensure_ascii=False, indent=1)

    available_rules = list(rule_doc_map.keys()) if rule_doc_map else []

    prompt = f"""Based on the following {len(failed_records)} failed test results, generate per-rule optimization suggestions for each candidate.

## Available Ontology Rule Names
{json.dumps(available_rules, ensure_ascii=False)}

## Failed Records
{failed_summary}

## Task
For each candidate, analyze EACH violated rule and generate ONE specific optimization suggestion per rule.

Return a JSON array where each item has:
- candidateName: string (candidate name or scenario)
- overallAdvice: string (1-2 sentence overall recommendation in Chinese)
- suggestions: [{{
    ruleName: string (the violated rule name, MUST match one from Available Ontology Rule Names),
    ruleDescription: string (brief description of what the rule requires),
    area: string (improvement area like "技术技能", "学历", "工作经验", "资质认证"),
    currentState: string (what the candidate currently lacks regarding this rule),
    recommendation: string (specific actionable advice for the candidate to satisfy this rule, in Chinese),
    priority: "HIGH" | "MEDIUM" | "LOW" (based on rule severity)
  }}]

IMPORTANT:
- Generate ONE suggestion for EACH violated rule per candidate.
- Each suggestion must be directly tied to a specific violated rule.
- ruleName must exactly match a name from the Available Ontology Rule Names list.
- Advice should be concrete and actionable for the candidate's resume.

Use Chinese for all text fields."""

    result = await gemini.generate_json(SYSTEM_PROMPT, prompt, temp=0.4)
    if result is None:
        raise HTTPException(500, gemini.last_error or "LLM generation failed")

    suggestions = result if isinstance(result, list) else result.get("suggestions", [])

    # Post-process: fill in full rule doc text for ruleDescription and enrich with rule detail fields
    rules_list = snap.get("rules", []) if snap else []
    for sug in suggestions:
        if not isinstance(sug, dict):
            continue
        for s in sug.get("suggestions", []):
            if not isinstance(s, dict):
                continue
            rn = s.get("ruleName", "")
            if rn in rule_doc_map:
                s["ruleDescription"] = rule_doc_map[rn]
            # Enrich with full rule detail fields from snapshot
            _enrich_failed_node(s, rules_list)

    return {"status": "ok", "data": {"suggestions": suggestions}}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
