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

export interface MatchTraceStep {
    step: string;
    status: 'pass' | 'fail' | 'skip';
    detail: string;
}

export interface FailedNode {
    ruleName: string;
    ruleDescription: string;
    brokenLink?: string;
    funnelStage?: string;
    failureType?: string;
    contextSnapshot?: Record<string, any>;
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
    failedNode?: FailedNode;
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
    preview?: {
        name?: string;
        skills?: string[];
        summary?: string;
        columns?: string[];
        recordCount?: number;
        sampleRecord?: Record<string, any>;
    };
    uploadedAt: string;
}

export interface ApiKeyItem {
    keyId: string;
    provider: string;
    label: string;
    maskedKey: string;
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
        triggeredRules: string[];
        reasoning: string;
        failedNode?: FailedNode;
        matchTrace?: MatchTraceStep[];
    }[];
    executedAt: string;
}

export interface SimulatedDataItem {
    itemId: string;
    type: 'resume' | 'jd';
    subType: string;
    filename: string;
    generatedData: Record<string, any>;
    generatedAt: string;
}

export interface ApiResponse<T> {
    status: string;
    data: T;
}
