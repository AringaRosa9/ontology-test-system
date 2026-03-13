import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { RuleCheckReport, RuleCheckGroupResult, CoverageMatrixData, FunnelSuggestionItem } from './types';

/* ── Validation Page Store ─────────────────────────────────────────────────── */

interface ValidationState {
    cachedSnapshotId: string | null;
    /** Legacy single-group report (kept for type compat) */
    ruleCheckReport: RuleCheckReport | null;
    /** Per-client-group results keyed by snapshotId → clientGroup */
    ruleCheckByGroup: Record<string, Record<string, RuleCheckGroupResult>>;
    setGroupResult: (snapshotId: string, clientGroup: string, result: RuleCheckGroupResult) => void;
    loadAllGroups: (snapshotId: string, byClientGroup: Record<string, RuleCheckGroupResult>) => void;
    getGroupResult: (snapshotId: string, clientGroup: string) => RuleCheckGroupResult | null;
    /** Legacy setter (unused but kept for compat) */
    setRuleCheckReport: (snapshotId: string, report: RuleCheckReport | null) => void;
    clearRuleCheck: () => void;
}

export const useValidationStore = create<ValidationState>()(
    persist(
        (set, get) => ({
            cachedSnapshotId: null,
            ruleCheckReport: null,
            ruleCheckByGroup: {},
            setGroupResult: (snapshotId, clientGroup, result) =>
                set((state) => {
                    const snap = { ...(state.ruleCheckByGroup[snapshotId] || {}) };
                    snap[clientGroup] = result;
                    return {
                        cachedSnapshotId: snapshotId,
                        ruleCheckByGroup: { ...state.ruleCheckByGroup, [snapshotId]: snap },
                    };
                }),
            loadAllGroups: (snapshotId, byClientGroup) =>
                set((state) => ({
                    cachedSnapshotId: snapshotId,
                    ruleCheckByGroup: { ...state.ruleCheckByGroup, [snapshotId]: byClientGroup },
                })),
            getGroupResult: (snapshotId, clientGroup) => {
                const groups = get().ruleCheckByGroup[snapshotId];
                return groups?.[clientGroup] ?? null;
            },
            setRuleCheckReport: (snapshotId, report) =>
                set({ cachedSnapshotId: snapshotId, ruleCheckReport: report }),
            clearRuleCheck: () =>
                set({ cachedSnapshotId: null, ruleCheckReport: null, ruleCheckByGroup: {} }),
        }),
        {
            name: 'validation-store',
            storage: createJSONStorage(() => sessionStorage),
            partialize: (state) => ({
                cachedSnapshotId: state.cachedSnapshotId,
                ruleCheckReport: state.ruleCheckReport,
                ruleCheckByGroup: state.ruleCheckByGroup,
            }),
        },
    ),
);

/* ── Coverage Matrix Page Store ────────────────────────────────────────────── */

interface CoverageState {
    cachedRunId: string | null;
    matrixData: CoverageMatrixData | null;
    funnelSuggestions: FunnelSuggestionItem[];
    selectedRuleIds: string[];
    scoreThreshold: number;

    setMatrixData: (runId: string, data: CoverageMatrixData | null) => void;
    setFunnelSuggestions: (suggestions: FunnelSuggestionItem[]) => void;
    setSelectedRuleIds: (ids: string[]) => void;
    setScoreThreshold: (v: number) => void;
    clearCoverageCache: () => void;
}

export const useCoverageStore = create<CoverageState>()(
    persist(
        (set) => ({
            cachedRunId: null,
            matrixData: null,
            funnelSuggestions: [],
            selectedRuleIds: [],
            scoreThreshold: 60,

            setMatrixData: (runId, data) =>
                set({ cachedRunId: runId, matrixData: data }),
            setFunnelSuggestions: (suggestions) =>
                set({ funnelSuggestions: suggestions }),
            setSelectedRuleIds: (ids) =>
                set({ selectedRuleIds: ids }),
            setScoreThreshold: (v) =>
                set({ scoreThreshold: v }),
            clearCoverageCache: () =>
                set({
                    cachedRunId: null,
                    matrixData: null,
                    funnelSuggestions: [],
                    selectedRuleIds: [],
                    scoreThreshold: 60,
                }),
        }),
        {
            name: 'coverage-store',
            storage: createJSONStorage(() => sessionStorage),
            partialize: (state) => ({
                cachedRunId: state.cachedRunId,
                matrixData: state.matrixData,
                funnelSuggestions: state.funnelSuggestions,
                selectedRuleIds: state.selectedRuleIds,
                scoreThreshold: state.scoreThreshold,
            }),
        },
    ),
);
