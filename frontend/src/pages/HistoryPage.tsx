import { useEffect, useState } from 'react';
import { Typography, Card, Table, Tag, Space, Button, Row, Col, message, Descriptions } from 'antd';
import { ReloadOutlined, EyeOutlined, BugOutlined } from '@ant-design/icons';
import api from '../api';
import type { ApiResponse, TestRun, FailedNode } from '../types';

function FailedNodePanel({ node }: { node: FailedNode }) {
    return (
        <Card size="small" style={{ background: 'rgba(251, 113, 133, 0.08)', border: '1px solid rgba(251, 113, 133, 0.3)' }}>
            <Space direction="vertical" style={{ width: '100%' }} size="small">
                <Space>
                    <BugOutlined style={{ color: '#fb7185' }} />
                    <Typography.Text strong style={{ color: '#fb7185' }}>Failed Node Trace</Typography.Text>
                </Space>
                <Row gutter={16}>
                    <Col span={12}>
                        <Typography.Text type="secondary">Failed Rule: </Typography.Text>
                        <Tag color="red">{node.ruleName}</Tag>
                    </Col>
                    <Col span={12}>
                        <Typography.Text type="secondary">Failure Type: </Typography.Text>
                        <Tag color="volcano">{node.failureType || 'Rule Mismatch'}</Tag>
                    </Col>
                </Row>
                <div>
                    <Typography.Text type="secondary">Rule Description: </Typography.Text>
                    <Typography.Text>{node.ruleDescription}</Typography.Text>
                </div>
                {node.brokenLink && (
                    <div>
                        <Typography.Text type="secondary">Broken Link: </Typography.Text>
                        <Tag color="orange">{node.brokenLink}</Tag>
                    </div>
                )}
                {node.funnelStage && (
                    <div>
                        <Typography.Text type="secondary">Funnel Stage: </Typography.Text>
                        <Tag color="purple">{node.funnelStage}</Tag>
                    </div>
                )}
            </Space>
        </Card>
    );
}

export default function HistoryPage() {
    const [runs, setRuns] = useState<TestRun[]>([]);
    const [detail, setDetail] = useState<TestRun | null>(null);
    const [loading, setLoading] = useState(false);

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
                                    const labels: Record<string, string> = { by_resume: '按简历', by_jd: '按JD', cross_validate: '交叉验证' };
                                    return <Tag color="purple">{`交叉测试:${labels[sub] || sub}`}</Tag>;
                                }
                                return <Tag>{m}</Tag>;
                            },
                        },
                        { title: '总用例', dataIndex: 'totalCases', width: 80 },
                        { title: '通过', dataIndex: 'passedCases', width: 70, render: (c: number) => <Tag color="green">{c}</Tag> },
                        { title: '失败', dataIndex: 'failedCases', width: 70, render: (c: number) => <Tag color={c ? 'red' : 'green'}>{c}</Tag> },
                        { title: '通过率', dataIndex: 'coverageRate', width: 90, render: (r: number) => `${(r * 100).toFixed(0)}%` },
                        { title: '时间', dataIndex: 'executedAt', width: 170, render: (t: string) => new Date(t).toLocaleString('zh-CN') },
                        { title: '操作', width: 80, render: (_: any, row: TestRun) => <Button size="small" icon={<EyeOutlined />} onClick={() => viewDetail(row.runId)}>详情</Button> },
                    ]}
                />
            </Card>

            {detail && (
                <Card title={`运行详情 — ${detail.runId}`}>
                    <Descriptions bordered size="small" column={4} style={{ marginBottom: 16 }}>
                        <Descriptions.Item label="快照">{detail.snapshotId}</Descriptions.Item>
                        <Descriptions.Item label="总用例">{detail.totalCases}</Descriptions.Item>
                        <Descriptions.Item label="通过">{detail.passedCases}</Descriptions.Item>
                        <Descriptions.Item label="失败">{detail.failedCases}</Descriptions.Item>
                    </Descriptions>
                    <Table
                        rowKey="recordId"
                        size="small"
                        pagination={{ pageSize: 10 }}
                        dataSource={detail.records || []}
                        columns={[
                            { title: '用例 ID', dataIndex: 'caseId', width: 200, ellipsis: true },
                            { title: '裁定', dataIndex: 'verdict', width: 90, render: (v: string) => <Tag color={v === 'PASS' ? 'green' : v === 'FAIL' ? 'red' : 'orange'}>{v}</Tag> },
                            { title: '推理', dataIndex: 'reasoning', ellipsis: true },
                            { title: '触发规则', dataIndex: 'triggeredRules', render: (rules: string[]) => rules?.map(r => <Tag key={r} color="volcano">{r}</Tag>) },
                            {
                                title: 'Debug', width: 70,
                                render: (_: any, row: any) => row.failedNode ? (
                                    <Tag color="red" icon={<BugOutlined />}>Trace</Tag>
                                ) : null,
                            },
                        ]}
                        expandable={{
                            expandedRowRender: (row: any) => row.failedNode ? (
                                <FailedNodePanel node={row.failedNode} />
                            ) : null,
                            rowExpandable: (row: any) => !!row.failedNode,
                        }}
                    />
                </Card>
            )}
        </div>
    );
}
