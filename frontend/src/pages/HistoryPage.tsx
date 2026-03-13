import { useEffect, useState } from 'react';
import { Typography, Card, Table, Tag, Space, Button, Row, Col, Descriptions, Popconfirm, App } from 'antd';
import { ReloadOutlined, EyeOutlined, BugOutlined, DeleteOutlined, AimOutlined } from '@ant-design/icons';
import api from '../api';
import type { ApiResponse, TestRun, FailedNode, StepTraceItem } from '../types';
import StepTraceModal from '../components/StepTraceModal';

const VERDICT_META: Record<string, { color: string; label: string }> = {
    PASS: { color: 'green', label: 'PASS' },
    FAIL: { color: 'red', label: 'FAIL' },
    WARNING: { color: 'orange', label: 'WARNING' },
    ERROR: { color: 'magenta', label: 'ERROR' },
    MATCHED: { color: 'green', label: 'MATCHED' },
    LOW_MATCH: { color: 'orange', label: 'LOW_MATCH' },
    BLOCKED: { color: 'red', label: 'BLOCKED' },
    PENDING_REVIEW: { color: 'gold', label: 'PENDING_REVIEW' },
};

function verdictMeta(verdict: string) {
    return VERDICT_META[verdict] || { color: 'default', label: verdict || '—' };
}

function FailedNodePanel({ node }: { node: FailedNode }) {
    const entities = (node.relatedEntities || '').split('\n').filter((e: string) => e.trim());

    return (
        <Card size="small" style={{ background: 'rgba(251, 113, 133, 0.08)', border: '1px solid rgba(251, 113, 133, 0.3)' }}>
            <Space direction="vertical" style={{ width: '100%' }} size="small">
                <Space>
                    <BugOutlined style={{ color: '#fb7185' }} />
                    <Typography.Text strong style={{ color: '#fb7185' }}>失败节点追踪</Typography.Text>
                </Space>
                <Row gutter={16}>
                    <Col>
                        <Typography.Text type="secondary">漏斗阶段：</Typography.Text>
                        <Tag color="purple">{node.funnelStage || '—'}</Tag>
                    </Col>
                    <Col>
                        <Typography.Text type="secondary">失败类型：</Typography.Text>
                        <Tag color="volcano">{node.failureType || '规则不匹配'}</Tag>
                    </Col>
                    {node.brokenLink && (
                        <Col>
                            <Typography.Text type="secondary">断裂链接：</Typography.Text>
                            <Tag color="orange">{node.brokenLink}</Tag>
                        </Col>
                    )}
                </Row>
                <Descriptions
                    bordered
                    size="small"
                    column={{ xxl: 3, xl: 3, lg: 2, md: 2, sm: 1, xs: 1 }}
                    style={{ marginTop: 4 }}
                    title={<Typography.Text type="secondary" strong>失败规则</Typography.Text>}
                >
                    <Descriptions.Item label="规则ID">{node.id || '—'}</Descriptions.Item>
                    <Descriptions.Item label="场景阶段">{node.specificScenarioStage || '—'}</Descriptions.Item>
                    <Descriptions.Item label="规则名称">{node.businessLogicRuleName || node.ruleName || '—'}</Descriptions.Item>
                    <Descriptions.Item label="适用客户">{node.applicableClient || '—'}</Descriptions.Item>
                    <Descriptions.Item label="适用部门">{node.applicableDepartment || '—'}</Descriptions.Item>
                    <Descriptions.Item label="关联实体">
                        {entities.length > 0
                            ? entities.map((e: string, i: number) => <Tag key={i} color="blue" style={{ marginBottom: 2 }}>{e.trim()}</Tag>)
                            : '—'}
                    </Descriptions.Item>
                    <Descriptions.Item label="规则详情" span={3}>
                        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {node.standardizedLogicRule || node.ruleDescription || '—'}
                        </div>
                    </Descriptions.Item>
                </Descriptions>
            </Space>
        </Card>
    );
}

function PassDetailPanel({ row }: { row: any }) {
    return (
        <Card size="small" style={{ background: 'rgba(74, 222, 128, 0.08)', border: '1px solid rgba(74, 222, 128, 0.3)' }}>
            <Space direction="vertical" style={{ width: '100%' }} size="small">
                {row.reasoning && (
                    <div>
                        <Typography.Text type="secondary" style={{ color: '#4ade80' }}>推理说明：</Typography.Text>
                        <Typography.Paragraph style={{ margin: 0 }}>{row.reasoning}</Typography.Paragraph>
                    </div>
                )}
                {row.triggeredRules?.length > 0 && (
                    <div>
                        <Typography.Text type="secondary">触发规则：</Typography.Text>
                        <div style={{ marginTop: 4 }}>
                            {row.triggeredRules.map((r: string) => (
                                <Tag key={r} color="green" style={{ marginBottom: 2 }}>{r}</Tag>
                            ))}
                        </div>
                    </div>
                )}
            </Space>
        </Card>
    );
}

export default function HistoryPage() {
    const { message } = App.useApp();
    const [runs, setRuns] = useState<TestRun[]>([]);
    const [detail, setDetail] = useState<TestRun | null>(null);
    const [loading, setLoading] = useState(false);

    // Step trace modal
    const [traceVisible, setTraceVisible] = useState(false);
    const [traceData, setTraceData] = useState<StepTraceItem[]>([]);
    const [traceTitle, setTraceTitle] = useState('');

    const fetchRuns = () => {
        setLoading(true);
        api.get<ApiResponse<TestRun[]>>('/executor/runs')
            .then(r => setRuns(r.data.data || []))
            .catch(() => message.error('加载历史记录失败'))
            .finally(() => setLoading(false));
    };

    useEffect(() => { fetchRuns(); }, []);

    const viewDetail = async (runId: string) => {
        try {
            const { data } = await api.get<ApiResponse<TestRun>>(`/executor/runs/${runId}`);
            setDetail(data.data);
        } catch { message.error('加载详情失败'); }
    };

    const handleDeleteRun = async (runId: string) => {
        try {
            await api.delete(`/executor/runs/${runId}`);
            message.success('删除成功');
            setRuns(prev => prev.filter(r => r.runId !== runId));
            if (detail?.runId === runId) setDetail(null);
        } catch { message.error('删除失败'); }
    };

    const openTrace = (row: any) => {
        setTraceData(row.stepTrace && row.stepTrace.length > 0 ? row.stepTrace : []);
        setTraceTitle(row.title || row.caseId || '');
        setTraceVisible(true);
    };

    return (
        <div>
            <Typography.Title level={3} className="page-title">历史记录</Typography.Title>
            <Typography.Paragraph style={{ color: '#9ba6c7' }}>所有测试运行的历史记录</Typography.Paragraph>

            <Card
                title={`运行记录 (${runs.length})`}
                extra={<Button icon={<ReloadOutlined />} onClick={fetchRuns} loading={loading}>刷新</Button>}
                style={{ marginBottom: 16 }}
            >
                <Table
                    rowKey="runId"
                    size="small"
                    pagination={{ pageSize: 8 }}
                    dataSource={runs}
                    loading={loading}
                    columns={[
                        { title: '运行 ID', dataIndex: 'runId', width: 180, ellipsis: true },
                        { title: '快照 ID', dataIndex: 'snapshotId', width: 180, ellipsis: true },
                        {
                            title: '模式', dataIndex: 'executionMode', width: 140,
                            render: (m: string) => {
                                if (m.startsWith('cross_test:')) {
                                    const sub = m.replace('cross_test:', '');
                                    const labels: Record<string, string> = { by_resume: '按简历', by_jd: '按JD', cross_validate: '多对多测试' };
                                    return <Tag color="purple">{`交叉测试:${labels[sub] || sub}`}</Tag>;
                                }
                                return <Tag>{m}</Tag>;
                            },
                        },
                        { title: '总用例', dataIndex: 'totalCases', width: 80 },
                        {
                            title: 'MATCHED/通过',
                            dataIndex: 'passedCases',
                            width: 110,
                            render: (c: number) => <Tag color="green">{c}</Tag>,
                        },
                        {
                            title: '非通过/失败',
                            dataIndex: 'failedCases',
                            width: 110,
                            render: (c: number) => <Tag color={c ? 'red' : 'green'}>{c}</Tag>,
                        },
                        { title: 'MATCHED率/通过率', dataIndex: 'coverageRate', width: 130, render: (r: number) => `${(r * 100).toFixed(0)}%` },
                        { title: '时间', dataIndex: 'executedAt', width: 170, render: (t: string) => new Date(t).toLocaleString('zh-CN') },
                        {
                            title: '操作', width: 140, render: (_: any, row: TestRun) => (
                                <Space>
                                    <Button size="small" icon={<EyeOutlined />} onClick={() => viewDetail(row.runId)}>详情</Button>
                                    <Popconfirm title="确定删除此运行记录？此操作不可恢复。" onConfirm={() => handleDeleteRun(row.runId)} okText="删除" cancelText="取消">
                                        <Button size="small" danger icon={<DeleteOutlined />} />
                                    </Popconfirm>
                                </Space>
                            ),
                        },
                    ]}
                />
            </Card>

            {detail && (
                <Card title={`运行详情 — ${detail.runId}`}>
                    <Descriptions bordered size="small" column={4} style={{ marginBottom: 16 }}>
                        <Descriptions.Item label="快照">{detail.snapshotId}</Descriptions.Item>
                        <Descriptions.Item label="总用例">{detail.totalCases}</Descriptions.Item>
                        <Descriptions.Item label={detail.executionMode.startsWith('cross_test:') ? 'MATCHED' : '通过'}>{detail.passedCases}</Descriptions.Item>
                        <Descriptions.Item label={detail.executionMode.startsWith('cross_test:') ? '非通过' : '失败'}>{detail.failedCases}</Descriptions.Item>
                    </Descriptions>
                    <Table
                        rowKey="recordId"
                        size="small"
                        pagination={{ pageSize: 10 }}
                        dataSource={detail.records || []}
                        columns={[
                            { title: '用例 ID', dataIndex: 'caseId', width: 200, ellipsis: true },
                            {
                                title: '裁定',
                                dataIndex: 'verdict',
                                width: 130,
                                render: (v: string) => {
                                    const meta = verdictMeta(v);
                                    return <Tag color={meta.color}>{meta.label}</Tag>;
                                },
                            },
                            ...(detail.executionMode.startsWith('cross_test') ? [{
                                title: '匹配分', dataIndex: 'score', width: 80, sorter: (a: any, b: any) => (a.score ?? 0) - (b.score ?? 0),
                                render: (s: number | undefined) => s != null ? (
                                    <span style={{ color: s >= 80 ? '#4ade80' : s >= 60 ? '#fbbf24' : '#fb7185', fontWeight: 600 }}>{s}</span>
                                ) : '—',
                            }] : []),
                            { title: '推理', dataIndex: 'reasoning', ellipsis: true },
                            { title: '触发规则', dataIndex: 'triggeredRules', render: (rules: string[]) => rules?.map(r => <Tag key={r} color="volcano">{r}</Tag>) },
                            {
                                title: '链路', width: 80,
                                render: (_: any, row: any) => {
                                    if (row.verdict === 'ERROR') return null;
                                    const hasTrace = row.stepTrace && row.stepTrace.length > 0;
                                    return (
                                        <Tag
                                            color={hasTrace ? 'geekblue' : 'default'}
                                            icon={hasTrace ? <AimOutlined /> : <BugOutlined />}
                                            style={{ cursor: hasTrace ? 'pointer' : 'not-allowed', opacity: hasTrace ? 1 : 0.45 }}
                                            onClick={(e) => { e.stopPropagation(); if (hasTrace) openTrace(row); }}
                                        >
                                            链路
                                        </Tag>
                                    );
                                },
                            },
                        ]}
                        expandable={{
                            expandedRowRender: (row: any) => row.failedNode ? (
                                <FailedNodePanel node={row.failedNode} />
                            ) : (
                                <PassDetailPanel row={row} />
                            ),
                            rowExpandable: (row: any) => row.verdict !== 'ERROR',
                        }}
                    />
                </Card>
            )}

            <StepTraceModal
                stepTrace={traceData}
                visible={traceVisible}
                onClose={() => setTraceVisible(false)}
                title={traceTitle}
            />
        </div>
    );
}
