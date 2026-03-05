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
}

export interface ApiResponse<T> {
    status: string;
    data: T;
}
