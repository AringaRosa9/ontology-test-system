import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { RuleCheckReport, CoverageMatrixData, FunnelSuggestionItem } from './types';

/* ── Validation Page Store ─────────────────────────────────────────────────── */

interface ValidationState {
    cachedSnapshotId: string | null;
    ruleCheckReport: RuleCheckReport | null;
    setRuleCheckReport: (snapshotId: string, report: RuleCheckReport | null) => void;
    clearRuleCheck: () => void;
}

export const useValidationStore = create<ValidationState>()(
    persist(
        (set) => ({
            cachedSnapshotId: null,
            ruleCheckReport: null,
            setRuleCheckReport: (snapshotId, report) =>
                set({ cachedSnapshotId: snapshotId, ruleCheckReport: report }),
            clearRuleCheck: () =>
                set({ cachedSnapshotId: null, ruleCheckReport: null }),
        }),
        {
            name: 'validation-store',
            storage: createJSONStorage(() => sessionStorage),
            partialize: (state) => ({
                cachedSnapshotId: state.cachedSnapshotId,
                ruleCheckReport: state.ruleCheckReport,
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
