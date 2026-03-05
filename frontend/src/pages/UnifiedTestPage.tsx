import { useEffect, useState } from 'react';
import { Typography, Card, Select, Button, Table, Tag, Space, message, Empty, Descriptions, Alert } from 'antd';
import { ExperimentOutlined, RocketOutlined, ThunderboltOutlined } from '@ant-design/icons';
import api from '../api';
import type { ApiResponse, OntologySnapshot, GeneratedTestCase } from '../types';

export default function UnifiedTestPage() {
    const [snapshots, setSnapshots] = useState<OntologySnapshot[]>([]);
    const [snapshotId, setSnapshotId] = useState('');
    const [cases, setCases] = useState<GeneratedTestCase[]>([]);
    const [generating, setGenerating] = useState(false);
    const [fullSuiteLoading, setFullSuiteLoading] = useState(false);
    const [fullSuiteResult, setFullSuiteResult] = useState<any>(null);

    useEffect(() => {
        api.get<ApiResponse<OntologySnapshot[]>>('/ontology/snapshots')
            .then(r => setSnapshots(r.data.data || []))
            .catch(() => { });
        api.get<ApiResponse<GeneratedTestCase[]>>('/generator/cases')
            .then(r => setCases(r.data.data || []))
            .catch(() => { });
    }, []);

    const handleGenerateAll = async () => {
        if (!snapshotId) { message.warning('请先选择本体快照'); return; }
        setGenerating(true);
        try {
            const { data } = await api.post<ApiResponse<{ generated: GeneratedTestCase[] }>>('/generator/component-test', {
                snapshotId,
                component: 'all',
                strategies: ['counter_example', 'conflict', 'boundary', 'omission', 'challenge'],
            });
            setCases(prev => [...data.data.generated, ...prev]);
            message.success(`生成了 ${data.data.generated?.length || 0} 条测试用例`);
        } catch { message.error('生成失败'); }
        setGenerating(false);
    };

    const handleFullSuite = async () => {
        if (!snapshotId) { message.warning('请先选择快照'); return; }
        setFullSuiteLoading(true);
        try {
            const { data } = await api.post<ApiResponse<any>>('/generator/full-suite', {
                snapshotId,
                strategies: ['counter_example', 'conflict', 'boundary', 'omission', 'challenge'],
            });
            setFullSuiteResult(data.data);
            setCases(prev => [...(data.data.componentCases || []), ...(data.data.e2eCases || []), ...prev]);
            message.success(data.data.message || '全量测试用例生成完成');
        } catch { message.error('全量生成失败'); }
        setFullSuiteLoading(false);
    };

    const componentStats = cases.reduce((acc, c) => {
        acc[c.component] = (acc[c.component] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);

    return (
        <div>
            <Typography.Title level={3} className="page-title">用例生成</Typography.Title>
            <Typography.Paragraph style={{ color: '#9ba6c7' }}>
                基于 Ontology 快照和 LLM 智能分析，自动生成全量测试用例（分部 + E2E 集成）
            </Typography.Paragraph>

            <Card style={{ marginBottom: 16 }}>
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                    <Space wrap>
                        <Typography.Text strong>本体快照：</Typography.Text>
                        <Select
                            style={{ width: 400 }}
                            placeholder="选择本体快照"
                            value={snapshotId || undefined}
                            onChange={setSnapshotId}
                            options={snapshots.map(s => ({
                                label: `${s.snapshotId.slice(0, 20)}... (${s.rulesCount}R, ${s.dataObjectsCount}DO, ${s.actionsCount}A)`,
                                value: s.snapshotId,
                            }))}
                        />
                    </Space>
                    <Space>
                        <Button type="primary" icon={<ExperimentOutlined />} loading={generating} onClick={handleGenerateAll}>
                            生成全部组件用例
                        </Button>
                        <Button icon={<RocketOutlined />} loading={fullSuiteLoading} onClick={handleFullSuite}>
                            一键全量生成（组件 + E2E）
                        </Button>
                    </Space>
                </Space>
            </Card>

            {fullSuiteResult && (
                <Alert
                    type="success"
                    showIcon
                    icon={<ThunderboltOutlined />}
                    message="全量生成完成"
                    description={
                        <Space direction="vertical">
                            <span>{fullSuiteResult.message}</span>
                            <span>总计: <strong>{fullSuiteResult.totalGenerated}</strong> 条用例</span>
                        </Space>
                    }
                    style={{ marginBottom: 16 }}
                />
            )}

            <Card
                title={`测试用例库 (${cases.length} 条)`}
                extra={
                    <Space wrap>
                        {Object.entries(componentStats).map(([comp, count]) => (
                            <Tag key={comp} color="blue">{comp}: {count}</Tag>
                        ))}
                    </Space>
                }
            >
                {cases.length > 0 ? (
                    <Table
                        rowKey={(r, i) => r.caseId || `case-${i}`}
                        size="small"
                        pagination={{ pageSize: 10 }}
                        dataSource={cases}
                        columns={[
                            { title: '用例 ID', dataIndex: 'caseId', width: 200, ellipsis: true },
                            { title: '组件', dataIndex: 'component', width: 130, render: (c: string) => <Tag color="blue">{c}</Tag> },
                            { title: '策略', dataIndex: 'strategy', width: 130, render: (s: string) => <Tag color="gold">{s}</Tag> },
                            { title: '优先级', dataIndex: 'priority', width: 70, render: (p: string) => <Tag color={p === 'P0' ? 'red' : 'orange'}>{p}</Tag> },
                            { title: '描述', dataIndex: 'description', ellipsis: true },
                        ]}
                        expandable={{
                            expandedRowRender: (r: GeneratedTestCase) => (
                                <Descriptions size="small" column={1} bordered>
                                    <Descriptions.Item label="完整描述">{r.description}</Descriptions.Item>
                                    <Descriptions.Item label="输入变量"><pre style={{ margin: 0, fontSize: 12 }}>{JSON.stringify(r.inputVariables, null, 2)}</pre></Descriptions.Item>
                                    <Descriptions.Item label="预期结果">{r.expectedOutcome}</Descriptions.Item>
                                </Descriptions>
                            ),
                        }}
                    />
                ) : (
                    <Empty description="点击上方按钮生成测试用例" />
                )}
            </Card>
        </div>
    );
}
