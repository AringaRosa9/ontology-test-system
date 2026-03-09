import { useEffect, useState } from 'react';
import {
    Typography, Card, Select, Button, Table, Tag, Space, message,
    Tabs, Row, Col, Empty, Descriptions, Alert, Progress, Statistic, Modal, Tooltip,
} from 'antd';
import type { TabsProps } from 'antd';
import {
    BulbOutlined, SearchOutlined,
    WarningOutlined, CheckCircleOutlined, InfoCircleOutlined,
} from '@ant-design/icons';
import api from '../api';
import type { ApiResponse, TestRun, GapAnalysisItem, OptimizationSuggestion, RuleDetailFields } from '../types';

/* ── Rule Detail Modal Component ─────────────────────────────────────────── */

function RuleDetailModal({ rule, open, onClose }: { rule: RuleDetailFields | null; open: boolean; onClose: () => void }) {
    if (!rule) return null;
    return (
        <Modal
            title={<span><InfoCircleOutlined style={{ color: '#1890ff', marginRight: 8 }} />规则详情 - {rule.id || '未知'}</span>}
            open={open}
            onCancel={onClose}
            footer={null}
            width={720}
        >
            <Descriptions bordered column={2} size="small" style={{ marginTop: 12 }}>
                <Descriptions.Item label="规则ID">{rule.id || '-'}</Descriptions.Item>
                <Descriptions.Item label="场景阶段">{rule.specificScenarioStage || '-'}</Descriptions.Item>
                <Descriptions.Item label="规则名称" span={2}>{rule.businessLogicRuleName || '-'}</Descriptions.Item>
                <Descriptions.Item label="适用客户">{rule.applicableClient || '-'}</Descriptions.Item>
                <Descriptions.Item label="适用部门">{rule.applicableDepartment || '-'}</Descriptions.Item>
                <Descriptions.Item label="规则详情" span={2}>
                    <div style={{ maxHeight: 300, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                        {rule.standardizedLogicRule || '-'}
                    </div>
                </Descriptions.Item>
                <Descriptions.Item label="关联实体" span={2}>
                    {rule.relatedEntities
                        ? rule.relatedEntities.split('\n').filter(Boolean).map((e, i) => (
                            <Tag key={i} color="blue" style={{ marginBottom: 4 }}>{e.trim()}</Tag>
                        ))
                        : '-'}
                </Descriptions.Item>
            </Descriptions>
        </Modal>
    );
}

/* ── Main Page ───────────────────────────────────────────────────────────── */

export default function OptimizationPage() {
    const [runs, setRuns] = useState<TestRun[]>([]);
    const [selectedRunId, setSelectedRunId] = useState('');
    const [activeTab, setActiveTab] = useState('gap');

    // Gap Analysis state
    const [gapLoading, setGapLoading] = useState(false);
    const [gapResults, setGapResults] = useState<GapAnalysisItem[]>([]);

    // Optimization Suggestions state
    const [sugLoading, setSugLoading] = useState(false);
    const [suggestions, setSuggestions] = useState<OptimizationSuggestion[]>([]);

    // Rule detail modal state
    const [detailRule, setDetailRule] = useState<RuleDetailFields | null>(null);
    const [detailOpen, setDetailOpen] = useState(false);

    const showRuleDetail = (rule: RuleDetailFields) => {
        setDetailRule(rule);
        setDetailOpen(true);
    };

    useEffect(() => {
        api.get<ApiResponse<TestRun[]>>('/executor/runs')
            .then(r => {
                const data = r.data.data || [];
                setRuns(data);
                if (data.length > 0) setSelectedRunId(data[0].runId);
            })
            .catch(() => {});
    }, []);

    const handleGapAnalysis = async () => {
        if (!selectedRunId) { message.warning('请选择一次测试运行'); return; }
        setGapLoading(true);
        setGapResults([]);
        try {
            const { data } = await api.post<ApiResponse<{ analysis: GapAnalysisItem[] }>>('/optimization/gap-analysis', {
                runId: selectedRunId,
            });
            setGapResults(data.data.analysis || []);
            message.success(`差距分析完成：${data.data.analysis?.length || 0} 条`);
        } catch (e: any) {
            message.error(e?.response?.data?.detail || '差距分析失败');
        }
        setGapLoading(false);
    };

    const handleSuggestions = async () => {
        if (!selectedRunId) { message.warning('请选择一次测试运行'); return; }
        setSugLoading(true);
        setSuggestions([]);
        try {
            const { data } = await api.post<ApiResponse<{ suggestions: OptimizationSuggestion[] }>>('/optimization/suggestions', {
                runId: selectedRunId,
            });
            setSuggestions(data.data.suggestions || []);
            message.success(`已生成 ${data.data.suggestions?.length || 0} 条优化建议`);
        } catch (e: any) {
            message.error(e?.response?.data?.detail || '建议生成失败');
        }
        setSugLoading(false);
    };

    const selectedRun = runs.find(r => r.runId === selectedRunId);

    /* ── Expanded row columns for gap analysis failed rules ─── */
    const gapExpandedColumns = [
        { title: '规则ID', dataIndex: 'id', width: 100,
            render: (id: string, record: any) => id
                ? <a onClick={() => showRuleDetail(record)} style={{ color: '#1890ff' }}>{id}</a>
                : '-',
        },
        { title: '场景阶段', dataIndex: 'specificScenarioStage', width: 140,
            render: (v: string) => v || '-',
        },
        { title: '规则名称', dataIndex: 'businessLogicRuleName', width: 160,
            render: (v: string) => v || '-',
        },
        { title: '适用客户', dataIndex: 'applicableClient', width: 120,
            render: (v: string) => v || '-',
        },
        { title: '适用部门', dataIndex: 'applicableDepartment', width: 120,
            render: (v: string) => v || '-',
        },
        { title: '规则详情', dataIndex: 'standardizedLogicRule', ellipsis: true,
            render: (v: string) => v || '-',
        },
        { title: '关联实体', dataIndex: 'relatedEntities', width: 180,
            render: (v: string) => v
                ? v.split('\n').filter(Boolean).map((e, i) => (
                    <Tag key={i} color="blue" style={{ marginBottom: 2 }}>{e.trim()}</Tag>
                ))
                : '-',
        },
        { title: '严重程度', dataIndex: 'severity', width: 80,
            render: (s: string) => <Tag color={s === 'P0' ? 'red' : s === 'P1' ? 'orange' : 'blue'}>{s}</Tag>,
        },
    ];

    const tabItems: TabsProps['items'] = [
        {
            key: 'gap',
            label: <span><SearchOutlined /> 差距分析</span>,
            children: (
                <div>
                    <Space style={{ marginBottom: 16 }}>
                        <Button type="primary" icon={<SearchOutlined />}
                            loading={gapLoading} onClick={handleGapAnalysis}
                            disabled={!selectedRunId}>
                            执行差距分析
                        </Button>
                        {gapLoading && <Typography.Text type="secondary">分析失败规则中...</Typography.Text>}
                    </Space>

                    {gapResults.length > 0 ? (
                        <Table
                            rowKey={(_, i) => `gap-${i}`}
                            size="small"
                            pagination={{ pageSize: 10 }}
                            dataSource={gapResults}
                            columns={[
                                { title: '候选人', dataIndex: 'candidateName', width: 120 },
                                { title: 'JD', dataIndex: 'jdTitle', width: 150, ellipsis: true },
                                {
                                    title: '差距评分', dataIndex: 'gapScore', width: 120,
                                    render: (score: number) => (
                                        <Progress
                                            percent={Math.round(score * 100)}
                                            size="small"
                                            strokeColor={score > 0.6 ? '#fb7185' : score > 0.3 ? '#fbbf24' : '#4ade80'}
                                        />
                                    ),
                                },
                                {
                                    title: '失败规则', dataIndex: 'failedRules', width: 250,
                                    render: (rules: any[]) => rules?.slice(0, 3).map((r, i) => (
                                        <Tooltip key={i} title={r.businessLogicRuleName || r.ruleName}>
                                            <Tag
                                                color={r.severity === 'P0' ? 'red' : r.severity === 'P1' ? 'orange' : 'blue'}
                                                style={{ cursor: r.id ? 'pointer' : 'default' }}
                                                onClick={() => r.id && showRuleDetail(r)}
                                            >
                                                {r.id || r.ruleName}
                                            </Tag>
                                        </Tooltip>
                                    )) || '-',
                                },
                                {
                                    title: '缺失技能', dataIndex: 'missingSkills',
                                    render: (skills: string[]) => skills?.map(s => (
                                        <Tag key={s} color="volcano" style={{ marginBottom: 2 }}>{s}</Tag>
                                    )) || '-',
                                },
                            ]}
                            expandable={{
                                expandedRowRender: (row: GapAnalysisItem) => (
                                    <Card size="small" title="失败规则详情">
                                        <Table
                                            rowKey={(_, i) => `fr-${i}`}
                                            size="small"
                                            pagination={false}
                                            dataSource={row.failedRules}
                                            columns={gapExpandedColumns}
                                            scroll={{ x: 1100 }}
                                        />
                                    </Card>
                                ),
                            }}
                        />
                    ) : !gapLoading && (
                        <Empty description="执行差距分析以查看结果" />
                    )}
                </div>
            ),
        },
        {
            key: 'suggestions',
            label: <span><BulbOutlined /> 优化建议</span>,
            children: (
                <div>
                    <Space style={{ marginBottom: 16 }}>
                        <Button type="primary" icon={<BulbOutlined />}
                            loading={sugLoading} onClick={handleSuggestions}
                            disabled={!selectedRunId}
                            style={{ background: 'linear-gradient(135deg, #fbbf24, #f59e0b)', border: 'none' }}>
                            生成建议
                        </Button>
                        {sugLoading && <Typography.Text type="secondary">LLM 生成建议中...</Typography.Text>}
                    </Space>

                    {suggestions.length > 0 ? (
                        <Space direction="vertical" style={{ width: '100%' }} size="middle">
                            {suggestions.map((sug, idx) => (
                                <Card
                                    key={idx}
                                    size="small"
                                    title={<Space><BulbOutlined style={{ color: '#fbbf24' }} /><span>{sug.candidateName}</span></Space>}
                                >
                                    <Alert
                                        type="info" showIcon
                                        message="整体建议"
                                        description={sug.overallAdvice}
                                        style={{ marginBottom: 12 }}
                                    />
                                    <Table
                                        rowKey={(_, i) => `sug-${idx}-${i}`}
                                        size="small"
                                        pagination={false}
                                        dataSource={sug.suggestions}
                                        columns={[
                                            {
                                                title: '违反规则', dataIndex: 'id', width: 120,
                                                render: (id: string, record: any) => id
                                                    ? <Tooltip title={record.businessLogicRuleName || record.ruleName}>
                                                        <Tag color="red" style={{ cursor: 'pointer' }} onClick={() => showRuleDetail(record)}>{id}</Tag>
                                                      </Tooltip>
                                                    : <Tag color="red">{record.ruleName || '-'}</Tag>,
                                            },
                                            {
                                                title: '规则说明', dataIndex: 'standardizedLogicRule', width: 220,
                                                ellipsis: true,
                                                render: (v: string, record: any) => v || record.ruleDescription || '-',
                                            },
                                            {
                                                title: '领域', dataIndex: 'area', width: 100,
                                                render: (a: string) => <Tag color="blue">{a}</Tag>,
                                            },
                                            { title: '当前状态', dataIndex: 'currentState', width: 180, ellipsis: true },
                                            { title: '优化建议', dataIndex: 'recommendation' },
                                            {
                                                title: '优先级', dataIndex: 'priority', width: 80,
                                                render: (p: string) => <Tag color={p === 'HIGH' ? 'red' : p === 'MEDIUM' ? 'orange' : 'blue'}>{p}</Tag>,
                                            },
                                        ]}
                                    />
                                </Card>
                            ))}
                        </Space>
                    ) : !sugLoading && (
                        <Empty description="生成建议以查看候选人的可操作反馈" />
                    )}
                </div>
            ),
        },
    ];

    return (
        <div>
            <Typography.Title level={3} className="page-title">优化建议</Typography.Title>
            <Typography.Paragraph style={{ color: '#9ba6c7' }}>
                分析测试失败用例，识别差距，为候选人生成可操作的改进建议
            </Typography.Paragraph>

            {/* Run Selector */}
            <Card style={{ marginBottom: 16 }}>
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                    <Space wrap>
                        <Typography.Text strong>测试运行：</Typography.Text>
                        <Select
                            style={{ width: 500 }}
                            placeholder="选择一次测试运行进行分析"
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
                            <Col span={6}><Statistic title="失败" value={selectedRun.failedCases} valueStyle={{ color: '#fb7185' }} prefix={<WarningOutlined />} /></Col>
                            <Col span={6}>
                                <Typography.Text type="secondary" style={{ fontSize: 12 }}>通过率</Typography.Text>
                                <Progress
                                    percent={Math.round(selectedRun.coverageRate * 100)}
                                    strokeColor={selectedRun.coverageRate >= 0.7 ? '#4ade80' : '#fbbf24'}
                                />
                            </Col>
                        </Row>
                    )}
                </Space>
            </Card>

            {/* Tabs */}
            <Card>
                <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
            </Card>

            {/* Rule Detail Modal */}
            <RuleDetailModal rule={detailRule} open={detailOpen} onClose={() => setDetailOpen(false)} />
        </div>
    );
}
