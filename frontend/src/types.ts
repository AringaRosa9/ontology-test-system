export interface ValidationErrorItem {
    code: string;
    severity: 'P0' | 'P1' | 'P2';
    entityType: string;
    entityId: string;
    message: string;
    evidence?: string;
}

export interface ValidationReport {
    isDeterministicallyValid: boolean;
    blockers: ValidationErrorItem[];
    summary: { total: number; P0: number; P1: number; P2: number };
    errorsByType: Record<string, ValidationErrorItem[]>;
    allErrors: ValidationErrorItem[];
    runnable: boolean | null;
    runnableBlockers: ValidationErrorItem[];
    checksum: string;
}

export interface OntologySnapshot {
    snapshotId: string;
    sourceFiles: string[];
    description: string;
    rulesCount: number;
    dataObjectsCount: number;
    actionsCount: number;
    eventsCount: number;
    linksCount: number;
    createdAt: string;
    validationReport?: ValidationReport;
}

export interface OntologySnapshotDetail extends OntologySnapshot {
    rules: any[];
    dataobjects: any[];
    actions: any[];
    events: any[];
    links: any[];
}

export interface GeneratedTestCase {
    caseId: string;
    component: string;
    strategy: string;
    description: string;
    inputVariables: Record<string, any>;
    expectedOutcome: string;
    priority: string;
    testCategory?: string;
    snapshotId: string;
    generatedAt: string;
}

// ── Action → Step → Rule chain trace ──

export interface StepRuleResult {
    ruleId: string;
    status: 'pass' | 'fail' | 'skip';
    criteriaMatch: boolean;
    detail: string;
    terminateFlow: boolean;
}

export interface StepTraceItem {
    actionId: string;
    actionName: string;
    stepOrder: string;
    stepName: string;
    stepDescription?: string;
    stepStatus: 'pass' | 'fail' | 'skip' | 'terminated' | 'error';
    rules: StepRuleResult[];
    stepSummary?: string;
    candidateStatusUpdates?: string[];
}

export interface FailedNode {
    ruleName: string;
    ruleDescription: string;
    brokenLink?: string;
    funnelStage?: string;
    failureType?: string;
    contextSnapshot?: Record<string, any>;
    // Action-Step 定位（新交叉测试模型）
    actionId?: string;
    actionName?: string;
    stepName?: string;
    // 规则详情字段（从本体快照注入）
    id?: string;
    specificScenarioStage?: string;
    businessLogicRuleName?: string;
    applicableClient?: string;
    applicableDepartment?: string;
    standardizedLogicRule?: string;
    relatedEntities?: string;
}

export interface TestExecutionRecord {
    recordId: string;
    caseId: string;
    verdict: string;
    reasoning: string;
    triggeredRules: string[];
    assertionResults: { assertion: string; expected: string; actual: string; passed: boolean }[];
    executionDurationMs: number;
    executedAt: string;
    snapshotId: string;
    category?: string;
    title?: string;
    score?: number;
    failedNode?: FailedNode;
    stepTrace?: StepTraceItem[];
    resumeName?: string;
    jdTitle?: string;
}

export interface TestRun {
    runId: string;
    snapshotId: string;
    executionMode: string;
    totalCases: number;
    passedCases: number;
    failedCases: number;
    warningCases: number;
    coverageRate: number;
    records?: TestExecutionRecord[];
    executedAt: string;
    validationReport?: ValidationReport;
}

export interface TestReport {
    reportId: string;
    runId: string;
    summary: string;
    passRate?: number;
    coverageAnalysis?: string;
    riskAssessment?: string;
    recommendations?: string[];
    componentBreakdown?: Record<string, any>;
    generatedAt: string;
    runData?: Partial<TestRun>;
}

export interface BusinessDataItem {
    itemId: string;
    type: 'resume' | 'jd';
    filename: string;
    columns?: string[];
    recordCount?: number;
    department?: string;
    applicableClient?: '通用' | '字节' | '腾讯';
    preview?: {
        name?: string;
        skills?: string[];
        summary?: string;
        columns?: string[];
        recordCount?: number;
        sampleRecord?: Record<string, any>;
        department?: string;
    };
    uploadedAt: string;
}

export interface ApiKeyItem {
    keyId: string;
    provider: string;
    label: string;
    maskedKey: string;
    model?: string;
    baseUrl?: string;
    isActive: boolean;
    status: 'untested' | 'valid' | 'invalid';
    addedAt: string;
    lastTestedAt: string | null;
}

export interface LibraryCase {
    caseId: string;
    title: string;
    description: string;
    category: string;
    tags: string[];
    priority: string;
    inputVariables: Record<string, any>;
    expectedOutcome: string;
    steps: string[];
    createdAt: string;
    updatedAt: string;
    // Negative test case fields
    isNegative?: boolean;
    negativeType?: string | null;
    expectedVerdict?: 'PASS' | 'FAIL' | null;
    strategy?: string;
}

export interface RuleDetailFields {
    id?: string;
    specificScenarioStage?: string;
    businessLogicRuleName?: string;
    applicableClient?: string;
    applicableDepartment?: string;
    standardizedLogicRule?: string;
    relatedEntities?: string;
}

export interface GapAnalysisItem {
    candidateName: string;
    jdTitle: string;
    failedRules: (RuleDetailFields & { ruleName: string; ruleDescription: string; severity: string })[];
    missingSkills: string[];
    gapScore: number;
}

export interface OptimizationSuggestion {
    candidateName: string;
    suggestions: (RuleDetailFields & { ruleName: string; ruleDescription: string; area: string; currentState: string; recommendation: string; priority: string })[];
    overallAdvice: string;
}

export interface CrossTestResult {
    testId: string;
    mode: 'by_resume' | 'by_jd' | 'cross_validate';
    resumeNames: string[];
    jdTitles: string[];
    results: {
        resumeName: string;
        jdTitle: string;
        verdict: string;
        score: number;
        triggeredRules: string[];
        reasoning: string;
        failedNode?: FailedNode;
        stepTrace?: StepTraceItem[];
    }[];
    executedAt: string;
}

export interface SimulatedDataItem {
    itemId: string;
    type: 'resume' | 'jd';
    subType: string;
    filename: string;
    generatedData: Record<string, any>;
    applicableClient?: '通用' | '字节' | '腾讯';
    generatedAt: string;
}

// ── Coverage Matrix Types ──

export interface RuleCoverageItem {
    ruleId: string;
    ruleName: string;
    ruleDescription: string;
    scenarioStage: string;
    applicableClient: string;
    funnelStage: string;
    relatedEntities: string;
    triggeredByCases: {
        caseId: string;
        title: string;
        verdict: string;
        score?: number;
    }[];
    totalTriggered: number;
    blockedCount: number;
    avgScore?: number | null;
}

export interface CaseCoverageItem {
    caseId: string;
    title: string;
    category: string;
    verdict: string;
    score?: number;
    triggeredRuleIds: string[];
    triggeredRuleDetails: {
        ruleId: string;
        ruleName: string;
        rulePolarity: 'positive' | 'negative' | 'neutral';
        ruleDescription: string;
        aiChainOfThought: string;
    }[];
    failedNode?: FailedNode;
    resumeItemId?: string | null;
    resumeName?: string | null;
    jdItemId?: string | null;
    jdTitle?: string | null;
}

export interface BlockingSummary {
    totalRulesInvolved: number;
    totalCases: number;
    totalBlocked: number;
    avgScoreAll?: number | null;
    avgScoreBlocked?: number | null;
    funnelBreakdown: Record<string, { total: number; blocked: number }>;
    topBlockingRules: {
        ruleId: string;
        ruleName: string;
        blockedCount: number;
        avgBlockedScore?: number | null;
        funnelStage: string;
    }[];
}

export interface CoverageMatrixData {
    runId: string;
    executedAt: string;
    executionMode: string;
    isCrossTest: boolean;
    ruleCoverage: RuleCoverageItem[];
    caseCoverage: CaseCoverageItem[];
    blockingSummary: BlockingSummary;
}

export interface FunnelPrediction {
    currentPassRate: number;
    predictedPassRate: number;
    passRateChange: string;
    currentFunnel: Record<string, number>;
    predictedFunnel: Record<string, number>;
    newlyPassedCandidates: {
        name: string;
        currentScore: number;
        predictedScore: number;
    }[];
}

export interface FunnelSuggestionItem {
    ruleId: string;
    ruleName: string;
    currentBlockedCount: number;
    currentRule: string;
    relaxSuggestion: string;
    modifiedRulePreview: string;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    riskDescription: string;
    prediction: FunnelPrediction;
}

// ── Rule Self-Check Types ──

export interface RuleCheckFinding {
    ruleId: string;
    ruleIdB?: string;
    severity: 'P0' | 'P1' | 'P2';
    strategy: string;
    finding: string;
    suggestion: string;
}

export interface RuleCheckReport {
    snapshotId: string;
    checkResults: Record<string, RuleCheckFinding[]>;
    summary: {
        total: number;
        P0: number;
        P1: number;
        P2: number;
        byStrategy: Record<string, number>;
    };
}

export interface BusinessDataDetail {
    itemId: string;
    type: 'resume' | 'jd';
    filename: string;
    title?: string;
    department?: string;
    applicableClient?: string;
    columns?: string[];
    recordCount?: number;
    records?: Record<string, any>[];
    parsedData?: {
        name?: string;
        phone?: string;
        email?: string;
        education?: { school: string; degree: string; major: string; graduationYear: number }[];
        experience?: { company: string; title: string; startDate: string; endDate: string; description: string }[];
        skills?: string[];
        summary?: string;
    };
    uploadedAt: string;
}

export interface ApiResponse<T> {
    status: string;
    data: T;
}
