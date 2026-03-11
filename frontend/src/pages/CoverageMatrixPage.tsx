import { useEffect, useState } from 'react';
import {
    Typography, Card, Select, Table, Tag, Space, message, Tabs, Row, Col,
    Statistic, Alert, Descriptions, Progress, Button, Slider, Checkbox, Modal,
} from 'antd';
import type { TabsProps } from 'antd';
import {
    AppstoreOutlined, NodeIndexOutlined, StopOutlined, FunnelPlotOutlined,
    CheckCircleOutlined, CloseCircleOutlined, WarningOutlined, InfoCircleOutlined,
    BulbOutlined, ArrowUpOutlined, ArrowDownOutlined,
    FileTextOutlined, SolutionOutlined, DownloadOutlined,
} from '@ant-design/icons';
import api from '../api';
import { useCoverageStore } from '../store';
import type {
    ApiResponse, TestRun, CoverageMatrixData, RuleCoverageItem, CaseCoverageItem,
    BlockingSummary, FunnelSuggestionItem, FailedNode, RuleDetailFields, BusinessDataDetail,
} from '../types';

const FUNNEL_LABEL: Record<string, string> = {
    screening: '初筛', interview: '面试', offer: '录用', unknown: '未知',
};

function scoreColor(s: number) {
    return s >= 80 ? '#4ade80' : s >= 60 ? '#fbbf24' : '#fb7185';
}

/* ── Rule Detail Modal (shared) ────────────────────────────────────────────── */

function RuleDetailModal({ rule, open, onClose }: { rule: RuleDetailFields | null; open: boolean; onClose: () => void }) {
    if (!rule) return null;
    return (
        <Modal
            title={<span><InfoCircleOutlined style={{ color: '#1890ff', marginRight: 8 }} />规则详情 - {rule.id || '未知'}</span>}
            open={open} onCancel={onClose} footer={null} width={720}
        >
            <Descriptions bordered column={2} size="small" style={{ marginTop: 12 }}>
                <Descriptions.Item label="规则ID">{rule.id || '-'}</Descriptions.Item>
                <Descriptions.Item label="场景阶段">{rule.specificScenarioStage || '-'}</Descriptions.Item>
                <Descriptions.Item label="规则名称" span={2}>{rule.businessLogicRuleName || '-'}</Descriptions.Item>
                <Descriptions.Item label="适用客户">{rule.applicableClient || '-'}</Descriptions.Item>
                <Descriptions.Item label="适用部门">{rule.applicableDepartment || '-'}</Descriptions.Item>
                <Descriptions.Item label="规则详情" span={2}>
                    <div style={{ maxHeight: 300, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{rule.standardizedLogicRule || '-'}</div>
                </Descriptions.Item>
                <Descriptions.Item label="关联实体" span={2}>
                    {rule.relatedEntities ? rule.relatedEntities.split('\n').filter(Boolean).map((e, i) => (
                        <Tag key={i} color="blue" style={{ marginBottom: 4 }}>{e.trim()}</Tag>
                    )) : '-'}
                </Descriptions.Item>
            </Descriptions>
        </Modal>
    );
}

/* ── FailedNode Panel ──────────────────────────────────────────────────────── */

function FailedNodePanel({ node }: { node: FailedNode }) {
    return (
        <Card size="small" style={{ background: 'rgba(251,113,133,0.08)', border: '1px solid rgba(251,113,133,0.3)' }}>
            <Space direction="vertical" style={{ width: '100%' }} size="small">
                <Row gutter={16}>
                    <Col><Typography.Text type="secondary">漏斗阶段：</Typography.Text><Tag color="purple">{FUNNEL_LABEL[node.funnelStage || ''] || node.funnelStage || '—'}</Tag></Col>
                    <Col><Typography.Text type="secondary">失败类型：</Typography.Text><Tag color="volcano">{node.failureType || '规则不匹配'}</Tag></Col>
                    {node.brokenLink && <Col><Typography.Text type="secondary">断裂链接：</Typography.Text><Tag color="orange">{node.brokenLink}</Tag></Col>}
                </Row>
                <Table size="small" pagination={false} scroll={{ x: 900 }}
                    dataSource={[{
                        key: 'r0', id: node.id || '—',
                        specificScenarioStage: node.specificScenarioStage || '—',
                        businessLogicRuleName: node.businessLogicRuleName || node.ruleName || '—',
                        standardizedLogicRule: node.standardizedLogicRule || node.ruleDescription || '—',
                        relatedEntities: node.relatedEntities || '',
                    }]}
                    columns={[
                        { title: '规则ID', dataIndex: 'id', width: 100 },
                        { title: '场景阶段', dataIndex: 'specificScenarioStage', width: 140 },
                        { title: '规则名称', dataIndex: 'businessLogicRuleName', width: 160 },
                        { title: '规则详情', dataIndex: 'standardizedLogicRule',
                            render: (v: string) => <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{v || '—'}</div>,
                        },
                        { title: '关联实体', dataIndex: 'relatedEntities', width: 180, render: (v: string) => v ? v.split('\n').map((e, i) => <Tag key={i} color="blue">{e.trim()}</Tag>) : '—' },
                    ]}
                />
            </Space>
        </Card>
    );
}

/* ── Main Page ─────────────────────────────────────────────────────────────── */

export default function CoverageMatrixPage() {
    const [runs, setRuns] = useState<TestRun[]>([]);
    const [loading, setLoading] = useState(false);
    const [activeTab, setActiveTab] = useState('trace');
    const [funnelLoading, setFunnelLoading] = useState(false);

    // Persisted state from store
    const matrixData = useCoverageStore(s => s.matrixData);
    const cachedRunId = useCoverageStore(s => s.cachedRunId);
    const storeSetMatrixData = useCoverageStore(s => s.setMatrixData);
    const funnelSuggestions = useCoverageStore(s => s.funnelSuggestions);
    const storSetFunnelSuggestions = useCoverageStore(s => s.setFunnelSuggestions);
    const selectedRuleIds = useCoverageStore(s => s.selectedRuleIds);
    const storeSetSelectedRuleIds = useCoverageStore(s => s.setSelectedRuleIds);
    const scoreThreshold = useCoverageStore(s => s.scoreThreshold);
    const storeSetScoreThreshold = useCoverageStore(s => s.setScoreThreshold);
    const clearCoverageCache = useCoverageStore(s => s.clearCoverageCache);

    const [selectedRunId, setSelectedRunIdLocal] = useState('');

    // Rule detail modal
    const [detailRule, setDetailRule] = useState<RuleDetailFields | null>(null);
    const [detailOpen, setDetailOpen] = useState(false);

    // Resume / JD modal
    const [bdModalData, setBdModalData] = useState<BusinessDataDetail | null>(null);
    const [bdModalType, setBdModalType] = useState<'resume' | 'jd'>('resume');
    const [bdModalOpen, setBdModalOpen] = useState(false);
    const [bdModalLoading, setBdModalLoading] = useState(false);

    const openBusinessDataModal = async (itemId: string, type: 'resume' | 'jd') => {
        setBdModalType(type);
        setBdModalOpen(true);
        setBdModalLoading(true);
        setBdModalData(null);
        try {
            const { data } = await api.get<ApiResponse<BusinessDataDetail>>(`/business-data/${itemId}`);
            setBdModalData(data.data);
        } catch {
            message.error(`加载${type === 'resume' ? '简历' : 'JD'}失败`);
        }
        setBdModalLoading(false);
    };

    const setSelectedRunId = (id: string) => {
        setSelectedRunIdLocal(id);
    };

    useEffect(() => {
        api.get<ApiResponse<TestRun[]>>('/executor/runs')
            .then(r => {
                const data = r.data.data || [];
                setRuns(data);
                // Restore cached run if still valid, otherwise pick first
                if (cachedRunId && data.some(d => d.runId === cachedRunId)) {
                    setSelectedRunIdLocal(cachedRunId);
                } else if (data.length > 0) {
                    setSelectedRunIdLocal(data[0].runId);
                }
            }).catch(() => {});
    }, []);

    const fetchMatrix = async (runId: string) => {
        if (!runId) return;
        // Skip fetch if we already have cached data for this run
        if (runId === cachedRunId && matrixData) {
            return;
        }
        setLoading(true);
        clearCoverageCache();
        try {
            const { data } = await api.get<ApiResponse<CoverageMatrixData>>(`/coverage-matrix/${runId}`);
            storeSetMatrixData(runId, data.data);
        } catch {
            message.error('加载覆盖矩阵失败');
        }
        setLoading(false);
    };

    useEffect(() => {
        if (selectedRunId) fetchMatrix(selectedRunId);
    }, [selectedRunId]);

    const handleFunnelSuggestions = async () => {
        if (!selectedRunId || selectedRuleIds.length === 0) {
            message.warning('请至少选择一条规则');
            return;
        }
        setFunnelLoading(true);
        storSetFunnelSuggestions([]);
        try {
            const { data } = await api.post<ApiResponse<{ suggestions: FunnelSuggestionItem[] }>>('/coverage-matrix/funnel-suggestions', {
                runId: selectedRunId,
                ruleIds: selectedRuleIds,
                scoreThreshold,
            });
            storSetFunnelSuggestions(data.data.suggestions || []);
            message.success(`已生成 ${data.data.suggestions?.length || 0} 条放松建议`);
        } catch (e: any) {
            message.error(e?.response?.data?.detail || '生成建议失败');
        }
        setFunnelLoading(false);
    };

    const selectedRun = runs.find(r => r.runId === selectedRunId);
    const isCross = matrixData?.isCrossTest ?? false;
    const summary: BlockingSummary | null = matrixData?.blockingSummary ?? null;

    const showRuleDetail = (ruleId: string, ruleName: string, ruleDesc: string, stage: string, client: string, entities: string) => {
        setDetailRule({
            id: ruleId,
            specificScenarioStage: stage,
            businessLogicRuleName: ruleName,
            applicableClient: client,
            standardizedLogicRule: ruleDesc,
            relatedEntities: entities,
        });
        setDetailOpen(true);
    };

    /* ── Tab 1: Rule Traceability ─────────────────────────────────────────── */

    const ruleTraceView = (
        <div>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                按规则维度聚合：每条规则被哪些测试用例触发，以及阻拦情况
            </Typography.Text>
            <Table
                rowKey="ruleId" size="small" loading={loading}
                pagination={{ pageSize: 10 }}
                dataSource={matrixData?.ruleCoverage || []}
                columns={[
                    {
                        title: '规则ID', dataIndex: 'ruleId', width: 100,
                        render: (id: string, row: RuleCoverageItem) => (
                            <a onClick={() => showRuleDetail(id, row.ruleName, row.ruleDescription, row.scenarioStage, row.applicableClient, row.relatedEntities)} style={{ color: '#1890ff' }}>{id}</a>
                        ),
                    },
                    { title: '场景阶段', dataIndex: 'scenarioStage', width: 140, ellipsis: true },
                    { title: '规则名称', dataIndex: 'ruleName', width: 160, ellipsis: true },
                    {
                        title: '漏斗阶段', dataIndex: 'funnelStage', width: 90,
                        render: (v: string) => v ? <Tag color="purple">{FUNNEL_LABEL[v] || v}</Tag> : '—',
                    },
                    {
                        title: '触发次数', dataIndex: 'totalTriggered', width: 90, sorter: (a: RuleCoverageItem, b: RuleCoverageItem) => a.totalTriggered - b.totalTriggered,
                    },
                    {
                        title: '阻拦次数', dataIndex: 'blockedCount', width: 90, sorter: (a: RuleCoverageItem, b: RuleCoverageItem) => a.blockedCount - b.blockedCount,
                        defaultSortOrder: 'descend' as const,
                        render: (c: number) => <Tag color={c > 0 ? 'red' : 'green'}>{c}</Tag>,
                    },
                    ...(isCross ? [{
                        title: '平均评分', dataIndex: 'avgScore' as const, width: 90,
                        sorter: (a: RuleCoverageItem, b: RuleCoverageItem) => (a.avgScore ?? 0) - (b.avgScore ?? 0),
                        render: (s: number | null) => s != null ? (
                            <Typography.Text strong style={{ color: scoreColor(s) }}>{s}</Typography.Text>
                        ) : '—',
                    }] : []),
                ]}
                expandable={{
                    expandedRowRender: (row: RuleCoverageItem) => (
                        <Table size="small" pagination={false} rowKey="caseId"
                            dataSource={row.triggeredByCases}
                            columns={[
                                { title: '用例', dataIndex: 'title', ellipsis: true },
                                {
                                    title: '判定', dataIndex: 'verdict', width: 80,
                                    render: (v: string) => <Tag color={v === 'PASS' ? 'green' : v === 'FAIL' ? 'red' : 'orange'}>{v}</Tag>,
                                },
                                ...(isCross ? [{
                                    title: '评分', dataIndex: 'score' as const, width: 80,
                                    render: (s: number | undefined) => s != null ? <Typography.Text strong style={{ color: scoreColor(s) }}>{s}</Typography.Text> : '—',
                                }] : []),
                            ]}
                        />
                    ),
                }}
            />

            <Typography.Title level={5} style={{ marginTop: 24 }}>按用例维度</Typography.Title>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                每个测试用例触发了哪些规则
            </Typography.Text>
            <Table
                rowKey="caseId" size="small" loading={loading}
                pagination={{ pageSize: 10 }}
                dataSource={matrixData?.caseCoverage || []}
                columns={[
                    { title: '用例标题', dataIndex: 'title', ellipsis: true },
                    { title: '类别', dataIndex: 'category', width: 100, render: (c: string) => <Tag>{c}</Tag> },
                    {
                        title: '判定', dataIndex: 'verdict', width: 80,
                        render: (v: string) => <Tag color={v === 'PASS' ? 'green' : v === 'FAIL' ? 'red' : v === 'ERROR' ? 'magenta' : 'orange'}>{v}</Tag>,
                    },
                    ...(isCross ? [{
                        title: '评分', dataIndex: 'score' as const, width: 80,
                        sorter: (a: CaseCoverageItem, b: CaseCoverageItem) => (a.score ?? 0) - (b.score ?? 0),
                        render: (s: number | undefined) => s != null ? <Typography.Text strong style={{ color: scoreColor(s) }}>{s}</Typography.Text> : '—',
                    }] : []),
                    {
                        title: '触发规则', dataIndex: 'triggeredRuleIds', width: 250,
                        render: (ids: string[]) => ids?.map(id => <Tag key={id} color="volcano" style={{ marginBottom: 2 }}>{id}</Tag>) || '—',
                    },
                ]}
                expandable={{
                    expandedRowRender: (row: CaseCoverageItem) => (
                        <Space direction="vertical" style={{ width: '100%' }} size="small">
                            {/* Resume / JD buttons for cross-test cases */}
                            {isCross && (row.resumeItemId || row.jdItemId) && (
                                <Space style={{ marginBottom: 8 }}>
                                    {row.resumeItemId && (
                                        <Button
                                            icon={<FileTextOutlined />}
                                            onClick={() => openBusinessDataModal(row.resumeItemId!, 'resume')}
                                        >
                                            查看简历{row.resumeName ? `（${row.resumeName}）` : ''}
                                        </Button>
                                    )}
                                    {row.jdItemId && (
                                        <Button
                                            icon={<SolutionOutlined />}
                                            onClick={() => openBusinessDataModal(row.jdItemId!, 'jd')}
                                        >
                                            查看JD{row.jdTitle ? `（${row.jdTitle.length > 15 ? row.jdTitle.slice(0, 15) + '…' : row.jdTitle}）` : ''}
                                        </Button>
                                    )}
                                </Space>
                            )}
                            {row.triggeredRuleDetails.length > 0 && (
                                <Table size="small" pagination={false} rowKey="ruleId"
                                    dataSource={row.triggeredRuleDetails}
                                    columns={[
                                        {
                                            title: '规则ID', dataIndex: 'ruleId', width: 100,
                                            render: (id: string, r: any) => <a onClick={() => showRuleDetail(id, r.ruleName, r.ruleDescription, '', '', '')} style={{ color: '#1890ff' }}>{id}</a>,
                                        },
                                        {
                                            title: '规则极性', dataIndex: 'rulePolarity', width: 90,
                                            render: (v: string) => {
                                                const map: Record<string, { color: string; label: string }> = {
                                                    positive: { color: 'green', label: '正向' },
                                                    negative: { color: 'red', label: '负向' },
                                                    neutral: { color: 'default', label: '无影响' },
                                                };
                                                const item = map[v] || map.neutral;
                                                return <Tag color={item.color}>{item.label}</Tag>;
                                            },
                                        },
                                        { title: '规则名称', dataIndex: 'ruleName', width: 180 },
                                        { title: '规则描述', dataIndex: 'ruleDescription',
                                            render: (v: string) => <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{v || '—'}</div>,
                                        },
                                        {
                                            title: 'AI思维链', dataIndex: 'aiChainOfThought', width: 320,
                                            render: (v: string) => (
                                                <Typography.Paragraph
                                                    ellipsis={{ rows: 2, expandable: true, symbol: '展开' }}
                                                    style={{ margin: 0, fontSize: 12, color: '#8b95b0' }}
                                                >
                                                    {v || '—'}
                                                </Typography.Paragraph>
                                            ),
                                        },
                                    ]}
                                />
                            )}
                            {row.failedNode && <FailedNodePanel node={row.failedNode} />}
                        </Space>
                    ),
                }}
            />
        </div>
    );

    /* ── Tab 2: Blocking Statistics ───────────────────────────────────────── */

    const blockingView = (
        <div>
            {summary && (
                <>
                    <Row gutter={16} style={{ marginBottom: 16 }}>
                        <Col span={6}>
                            <Statistic title="涉及规则数" value={summary.totalRulesInvolved} prefix={<AppstoreOutlined />} />
                        </Col>
                        <Col span={6}>
                            <Statistic title="被阻拦用例" value={summary.totalBlocked} valueStyle={{ color: '#fb7185' }} prefix={<StopOutlined />} />
                        </Col>
                        {isCross && summary.avgScoreAll != null && (
                            <Col span={6}>
                                <Statistic title="全部平均评分" value={summary.avgScoreAll} valueStyle={{ color: scoreColor(summary.avgScoreAll) }} />
                            </Col>
                        )}
                        {isCross && summary.avgScoreBlocked != null && (
                            <Col span={6}>
                                <Statistic title="被阻拦平均评分" value={summary.avgScoreBlocked} valueStyle={{ color: '#fb7185' }} />
                            </Col>
                        )}
                    </Row>

                    {/* Funnel Breakdown */}
                    {Object.keys(summary.funnelBreakdown).length > 0 && (
                        <Card size="small" title="漏斗阶段分布" style={{ marginBottom: 16 }}>
                            <Row gutter={16}>
                                {Object.entries(summary.funnelBreakdown).map(([stage, data]) => (
                                    <Col span={6} key={stage}>
                                        <Card size="small" style={{ textAlign: 'center' }}>
                                            <Typography.Text strong>{FUNNEL_LABEL[stage] || stage}</Typography.Text>
                                            <Progress
                                                type="circle" size={80}
                                                percent={data.total > 0 ? Math.round((data.blocked / data.total) * 100) : 0}
                                                strokeColor="#fb7185"
                                                format={() => `${data.blocked}/${data.total}`}
                                                style={{ display: 'block', margin: '8px auto' }}
                                            />
                                            <Typography.Text type="secondary">阻拦率</Typography.Text>
                                        </Card>
                                    </Col>
                                ))}
                            </Row>
                        </Card>
                    )}

                    {/* Top blocking rules table with checkbox selection */}
                    <Card size="small" title="阻拦规则排行">
                        <Table
                            rowKey="ruleId" size="small" pagination={false}
                            dataSource={summary.topBlockingRules}
                            rowSelection={{
                                selectedRowKeys: selectedRuleIds,
                                onChange: (keys) => storeSetSelectedRuleIds(keys as string[]),
                            }}
                            columns={[
                                { title: '规则ID', dataIndex: 'ruleId', width: 100 },
                                { title: '规则名称', dataIndex: 'ruleName', width: 180, ellipsis: true },
                                {
                                    title: '漏斗阶段', dataIndex: 'funnelStage', width: 90,
                                    render: (v: string) => v ? <Tag color="purple">{FUNNEL_LABEL[v] || v}</Tag> : '—',
                                },
                                {
                                    title: '阻拦人数', dataIndex: 'blockedCount', width: 100,
                                    sorter: (a: any, b: any) => a.blockedCount - b.blockedCount,
                                    defaultSortOrder: 'descend' as const,
                                    render: (c: number) => <Tag color="red">{c}</Tag>,
                                },
                                ...(isCross ? [{
                                    title: '阻拦平均评分', dataIndex: 'avgBlockedScore' as const, width: 120,
                                    render: (s: number | null) => s != null ? <Typography.Text strong style={{ color: scoreColor(s) }}>{s}</Typography.Text> : '—',
                                }] : []),
                            ]}
                        />
                        {selectedRuleIds.length > 0 && (
                            <Button
                                type="primary" style={{ marginTop: 12, background: 'linear-gradient(135deg, #a78bfa, #6366f1)', border: 'none' }}
                                icon={<FunnelPlotOutlined />}
                                onClick={() => { setActiveTab('funnel'); }}
                            >
                                对选中的 {selectedRuleIds.length} 条规则生成漏斗管理建议
                            </Button>
                        )}
                    </Card>
                </>
            )}
            {!summary && !loading && <Alert type="info" showIcon message="选择测试运行以查看阻拦统计" />}
        </div>
    );

    /* ── Tab 3: Funnel Management ─────────────────────────────────────────── */

    const riskColorMap: Record<string, string> = { LOW: 'green', MEDIUM: 'orange', HIGH: 'red' };
    const riskAlertMap: Record<string, 'info' | 'warning' | 'error'> = { LOW: 'info', MEDIUM: 'warning', HIGH: 'error' };

    const funnelView = (
        <div>
            <Alert type="warning" showIcon message="以下预测基于 AI 模拟分析，仅供参考，不代表实际修改效果。" style={{ marginBottom: 16 }} />

            <Card size="small" style={{ marginBottom: 16 }}>
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                    <div>
                        <Typography.Text strong>已选规则：</Typography.Text>
                        <div style={{ marginTop: 4 }}>
                            {selectedRuleIds.length > 0 ? selectedRuleIds.map(id => (
                                <Tag key={id} color="volcano" closable onClose={() => storeSetSelectedRuleIds(selectedRuleIds.filter(r => r !== id))}>{id}</Tag>
                            )) : <Typography.Text type="secondary">请在「阻拦统计」Tab 中勾选规则，或手动添加</Typography.Text>}
                        </div>
                    </div>
                    <div>
                        <Typography.Text strong>从阻拦排行中选择：</Typography.Text>
                        <Select
                            mode="multiple" style={{ width: '100%', marginTop: 4 }}
                            placeholder="选择要分析的高阻拦规则"
                            value={selectedRuleIds}
                            onChange={storeSetSelectedRuleIds}
                            options={(summary?.topBlockingRules || []).map(r => ({
                                label: `${r.ruleId} - ${r.ruleName} (阻拦 ${r.blockedCount})`,
                                value: r.ruleId,
                            }))}
                        />
                    </div>
                    {isCross && (
                        <div>
                            <Typography.Text strong>评分阈值（低于此分视为阻拦）：{scoreThreshold}</Typography.Text>
                            <Slider min={0} max={100} value={scoreThreshold} onChange={storeSetScoreThreshold} />
                        </div>
                    )}
                    <Button
                        type="primary" icon={<BulbOutlined />}
                        loading={funnelLoading} onClick={handleFunnelSuggestions}
                        disabled={selectedRuleIds.length === 0}
                        style={{ background: 'linear-gradient(135deg, #fbbf24, #f59e0b)', border: 'none', minWidth: 200 }}
                    >
                        {funnelLoading ? '生成中...' : '生成放松建议'}
                    </Button>
                </Space>
            </Card>

            {funnelSuggestions.map((sug, idx) => (
                <Card
                    key={idx} size="small" style={{ marginBottom: 16 }}
                    title={
                        <Space>
                            <FunnelPlotOutlined style={{ color: '#a78bfa' }} />
                            <span>规则 {sug.ruleId}：{sug.ruleName}</span>
                            <Tag color={riskColorMap[sug.riskLevel] || 'blue'}>风险: {sug.riskLevel}</Tag>
                            <Tag color="red">当前阻拦: {sug.currentBlockedCount}</Tag>
                        </Space>
                    }
                >
                    <Space direction="vertical" style={{ width: '100%' }} size="middle">
                        {/* Relaxation suggestion */}
                        <Card size="small" title={<span><BulbOutlined style={{ color: '#fbbf24' }} /> 放松建议</span>}>
                            <Typography.Paragraph style={{ margin: 0 }}>{sug.relaxSuggestion}</Typography.Paragraph>
                        </Card>

                        {/* Modified rule preview */}
                        <Card size="small" title="修改后规则预览">
                            <Typography.Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap', background: 'rgba(34,211,238,0.06)', padding: 12, borderRadius: 8 }}>
                                {sug.modifiedRulePreview}
                            </Typography.Paragraph>
                        </Card>

                        {/* Pass rate change */}
                        <Card size="small" title="通过率变化预测">
                            <Row gutter={24} align="middle">
                                <Col>
                                    <Statistic title="当前通过率" value={Math.round(sug.prediction.currentPassRate * 100)} suffix="%" />
                                </Col>
                                <Col>
                                    <Typography.Text style={{ fontSize: 24, color: '#a78bfa' }}>→</Typography.Text>
                                </Col>
                                <Col>
                                    <Statistic
                                        title="预测通过率"
                                        value={Math.round(sug.prediction.predictedPassRate * 100)}
                                        suffix="%"
                                        valueStyle={{ color: '#4ade80' }}
                                    />
                                </Col>
                                <Col>
                                    <Tag color="green" icon={<ArrowUpOutlined />} style={{ fontSize: 16, padding: '4px 12px' }}>
                                        {sug.prediction.passRateChange}
                                    </Tag>
                                </Col>
                            </Row>
                        </Card>

                        {/* Funnel change */}
                        <Card size="small" title="漏斗阶段人数变化">
                            <Table size="small" pagination={false} rowKey="stage"
                                dataSource={Object.keys(sug.prediction.currentFunnel).map(stage => ({
                                    stage,
                                    stageLabel: FUNNEL_LABEL[stage] || stage,
                                    current: sug.prediction.currentFunnel[stage] || 0,
                                    predicted: sug.prediction.predictedFunnel[stage] || 0,
                                }))}
                                columns={[
                                    { title: '阶段', dataIndex: 'stageLabel', width: 100 },
                                    { title: '当前人数', dataIndex: 'current', width: 100 },
                                    { title: '预测人数', dataIndex: 'predicted', width: 100, render: (v: number) => <Typography.Text strong style={{ color: '#4ade80' }}>{v}</Typography.Text> },
                                    {
                                        title: '变化', width: 100,
                                        render: (_: any, row: any) => {
                                            const diff = row.predicted - row.current;
                                            if (diff === 0) return <span>—</span>;
                                            return diff > 0
                                                ? <Tag color="green" icon={<ArrowUpOutlined />}>+{diff}</Tag>
                                                : <Tag color="red" icon={<ArrowDownOutlined />}>{diff}</Tag>;
                                        },
                                    },
                                ]}
                            />
                        </Card>

                        {/* Newly passed candidates */}
                        {sug.prediction.newlyPassedCandidates.length > 0 && (
                            <Card size="small" title="预测新通过候选人">
                                <Table size="small" pagination={false} rowKey="name"
                                    dataSource={sug.prediction.newlyPassedCandidates}
                                    columns={[
                                        { title: '候选人', dataIndex: 'name', width: 120 },
                                        {
                                            title: '当前评分', dataIndex: 'currentScore', width: 100,
                                            render: (s: number) => <Typography.Text style={{ color: scoreColor(s) }}>{s}</Typography.Text>,
                                        },
                                        {
                                            title: '预测评分', dataIndex: 'predictedScore', width: 100,
                                            render: (s: number) => <Typography.Text strong style={{ color: scoreColor(s) }}>{s}</Typography.Text>,
                                        },
                                        {
                                            title: '变化', width: 80,
                                            render: (_: any, row: any) => <Tag color="green">+{row.predictedScore - row.currentScore}</Tag>,
                                        },
                                    ]}
                                />
                            </Card>
                        )}

                        {/* Risk alert */}
                        <Alert
                            type={riskAlertMap[sug.riskLevel] || 'info'}
                            showIcon
                            message={`风险等级：${sug.riskLevel}`}
                            description={sug.riskDescription}
                        />
                    </Space>
                </Card>
            ))}

            {funnelSuggestions.length === 0 && !funnelLoading && (
                <Alert type="info" showIcon message="选择高阻拦规则并点击「生成放松建议」以获取漏斗管理建议" />
            )}
        </div>
    );

    /* ── Tabs ─────────────────────────────────────────────────────────────── */

    const tabItems: TabsProps['items'] = [
        { key: 'trace', label: <span><NodeIndexOutlined /> 规则溯源</span>, children: ruleTraceView },
        { key: 'blocking', label: <span><StopOutlined /> 阻拦统计</span>, children: blockingView },
        { key: 'funnel', label: <span><FunnelPlotOutlined /> 漏斗管理</span>, children: funnelView },
    ];

    return (
        <div>
            <Typography.Title level={3} className="page-title">覆盖矩阵</Typography.Title>
            <Typography.Paragraph style={{ color: '#9ba6c7' }}>
                规则溯源、阻拦统计与漏斗管理 — 分析测试运行中的规则覆盖情况
            </Typography.Paragraph>

            {/* Run Selector */}
            <Card style={{ marginBottom: 16 }}>
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                    <Space wrap>
                        <Typography.Text strong>测试运行：</Typography.Text>
                        <Select
                            style={{ width: 500 }}
                            placeholder="选择一次测试运行"
                            value={selectedRunId || undefined}
                            onChange={setSelectedRunId}
                            options={runs.map(r => {
                                const isCross = r.executionMode.startsWith('cross_test:');
                                const prefix = isCross ? '[交叉测试] ' : '';
                                return {
                                    label: `${prefix}${r.runId} | ${r.totalCases} 用例 | ${r.passedCases}通过/${r.failedCases}失败 | ${(r.coverageRate * 100).toFixed(0)}%`,
                                    value: r.runId,
                                };
                            })}
                        />
                    </Space>
                    {selectedRun && (
                        <Row gutter={16}>
                            <Col span={6}><Statistic title="总用例数" value={selectedRun.totalCases} /></Col>
                            <Col span={6}><Statistic title="通过" value={selectedRun.passedCases} valueStyle={{ color: '#4ade80' }} prefix={<CheckCircleOutlined />} /></Col>
                            <Col span={6}><Statistic title="失败" value={selectedRun.failedCases} valueStyle={{ color: '#fb7185' }} prefix={<CloseCircleOutlined />} /></Col>
                            <Col span={6}>
                                <Typography.Text type="secondary" style={{ fontSize: 12 }}>通过率</Typography.Text>
                                <Progress percent={Math.round(selectedRun.coverageRate * 100)} strokeColor={selectedRun.coverageRate >= 0.7 ? '#4ade80' : '#fbbf24'} />
                            </Col>
                        </Row>
                    )}
                </Space>
            </Card>

            {/* Tabs */}
            <Card>
                <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
            </Card>

            <RuleDetailModal rule={detailRule} open={detailOpen} onClose={() => setDetailOpen(false)} />

            {/* Resume / JD Detail Modal */}
            <Modal
                title={
                    <span>
                        {bdModalType === 'resume' ? <FileTextOutlined style={{ color: '#1890ff', marginRight: 8 }} /> : <SolutionOutlined style={{ color: '#52c41a', marginRight: 8 }} />}
                        {bdModalType === 'resume' ? '候选人简历' : '岗位JD'}
                        {bdModalData ? ` — ${bdModalType === 'resume' ? (bdModalData.parsedData?.name || bdModalData.filename) : (bdModalData.title || bdModalData.filename)}` : ''}
                    </span>
                }
                open={bdModalOpen}
                onCancel={() => setBdModalOpen(false)}
                footer={bdModalData ? (
                    <Button
                        icon={<DownloadOutlined />}
                        onClick={() => window.open(`http://localhost:8000/business-data/${bdModalData.itemId}/file`, '_blank')}
                    >
                        下载原始文件
                    </Button>
                ) : null}
                width={800}
            >
                {bdModalLoading ? (
                    <div style={{ textAlign: 'center', padding: 48 }}><Typography.Text type="secondary">加载中…</Typography.Text></div>
                ) : bdModalData && bdModalType === 'resume' ? (
                    <Space direction="vertical" style={{ width: '100%' }} size="middle">
                        <Descriptions bordered column={2} size="small">
                            <Descriptions.Item label="姓名">{bdModalData.parsedData?.name || '—'}</Descriptions.Item>
                            <Descriptions.Item label="联系电话">{bdModalData.parsedData?.phone || '—'}</Descriptions.Item>
                            <Descriptions.Item label="邮箱" span={2}>{bdModalData.parsedData?.email || '—'}</Descriptions.Item>
                        </Descriptions>
                        {bdModalData.parsedData?.education && bdModalData.parsedData.education.length > 0 && (
                            <Card size="small" title="教育背景">
                                <Table size="small" pagination={false} rowKey={(_, i) => `edu-${i}`}
                                    dataSource={bdModalData.parsedData.education}
                                    columns={[
                                        { title: '学校', dataIndex: 'school' },
                                        { title: '学位', dataIndex: 'degree', width: 80 },
                                        { title: '专业', dataIndex: 'major' },
                                        { title: '毕业年份', dataIndex: 'graduationYear', width: 90 },
                                    ]}
                                />
                            </Card>
                        )}
                        {bdModalData.parsedData?.experience && bdModalData.parsedData.experience.length > 0 && (
                            <Card size="small" title="工作经历">
                                <Table size="small" pagination={false} rowKey={(_, i) => `exp-${i}`}
                                    dataSource={bdModalData.parsedData.experience}
                                    columns={[
                                        { title: '公司', dataIndex: 'company', width: 140 },
                                        { title: '职位', dataIndex: 'title', width: 120 },
                                        { title: '起止时间', width: 160, render: (_: any, r: any) => `${r.startDate || '?'} ~ ${r.endDate || '?'}` },
                                        { title: '描述', dataIndex: 'description', render: (v: string) => <div style={{ whiteSpace: 'pre-wrap', maxHeight: 100, overflow: 'auto' }}>{v || '—'}</div> },
                                    ]}
                                />
                            </Card>
                        )}
                        {bdModalData.parsedData?.skills && bdModalData.parsedData.skills.length > 0 && (
                            <Card size="small" title="技能">
                                <Space wrap>
                                    {bdModalData.parsedData.skills.map((s, i) => <Tag key={i} color="blue">{s}</Tag>)}
                                </Space>
                            </Card>
                        )}
                        {bdModalData.parsedData?.summary && (
                            <Card size="small" title="个人总结">
                                <Typography.Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{bdModalData.parsedData.summary}</Typography.Paragraph>
                            </Card>
                        )}
                    </Space>
                ) : bdModalData && bdModalType === 'jd' ? (
                    <Space direction="vertical" style={{ width: '100%' }} size="middle">
                        <Descriptions bordered column={2} size="small">
                            <Descriptions.Item label="JD标题">{bdModalData.title || bdModalData.filename}</Descriptions.Item>
                            <Descriptions.Item label="部门">{bdModalData.department || '—'}</Descriptions.Item>
                            <Descriptions.Item label="适用客户">{bdModalData.applicableClient || '—'}</Descriptions.Item>
                            <Descriptions.Item label="记录数">{bdModalData.recordCount ?? bdModalData.records?.length ?? '—'}</Descriptions.Item>
                        </Descriptions>
                        {bdModalData.records && bdModalData.records.length > 0 && (
                            <Card size="small" title="JD详情">
                                {bdModalData.records.slice(0, 3).map((rec, idx) => (
                                    <Descriptions key={idx} bordered column={1} size="small" style={{ marginBottom: idx < Math.min(bdModalData.records!.length, 3) - 1 ? 12 : 0 }}>
                                        {Object.entries(rec).map(([k, v]) => (
                                            <Descriptions.Item key={k} label={k}>
                                                <div style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{String(v ?? '—')}</div>
                                            </Descriptions.Item>
                                        ))}
                                    </Descriptions>
                                ))}
                                {bdModalData.records.length > 3 && (
                                    <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                                        仅展示前 3 条记录，共 {bdModalData.records.length} 条
                                    </Typography.Text>
                                )}
                            </Card>
                        )}
                    </Space>
                ) : null}
            </Modal>
        </div>
    );
}
