import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Typography, Card, Select, Tabs, Table, Tag, Space, Button, message, Empty, Descriptions, Checkbox } from 'antd';
import { ExperimentOutlined, PlayCircleOutlined } from '@ant-design/icons';
import api from '../api';
import type { ApiResponse, OntologySnapshot, GeneratedTestCase, TestExecutionRecord, TestRun } from '../types';

type CompTab = 'dataobjects' | 'actions_events' | 'rules' | 'links';

const TAB_META: Record<CompTab, { title: string; desc: string }> = {
    dataobjects: { title: 'DataObjects', desc: '验证数据对象的属性类型、状态枚举合法性，以及 CRUD 操作一致性' },
    actions_events: { title: 'Actions & Events', desc: '校验 actions 的前置条件与副作用，以及 events 的触发时序与数据一致性' },
    rules: { title: 'Rules', desc: '针对规则集进行反例、冲突、边界、遗漏与综合策略测试' },
    links: { title: 'Links', desc: '测试对象关系建立、断开及级联反应，验证基数约束与关联逻辑' },
};

const STRATEGIES = [
    { label: '反例 (counter_example)', value: 'counter_example' },
    { label: '冲突 (conflict)', value: 'conflict' },
    { label: '边界 (boundary)', value: 'boundary' },
    { label: '遗漏 (omission)', value: 'omission' },
    { label: '综合挑战 (challenge)', value: 'challenge' },
];

export default function ComponentTestPage() {
    const { tab } = useParams<{ tab: string }>();
    const navigate = useNavigate();
    const activeTab = (tab || 'dataobjects') as CompTab;

    const [snapshots, setSnapshots] = useState<OntologySnapshot[]>([]);
    const [snapshotId, setSnapshotId] = useState('');
    const [strategies, setStrategies] = useState(['counter_example', 'conflict', 'boundary', 'omission', 'challenge']);
    const [generating, setGenerating] = useState(false);
    const [testing, setTesting] = useState(false);
    const [cases, setCases] = useState<GeneratedTestCase[]>([]);
    const [results, setResults] = useState<TestExecutionRecord[]>([]);

    useEffect(() => {
        api.get<ApiResponse<OntologySnapshot[]>>('/ontology/snapshots')
            .then(r => setSnapshots(r.data.data || []))
            .catch(() => { });
    }, []);

    const handleGenerate = async () => {
        if (!snapshotId) { message.warning('请先选择本体快照'); return; }
        setGenerating(true);
        try {
            const { data } = await api.post<ApiResponse<{ generated: GeneratedTestCase[] }>>('/generator/component-test', {
                snapshotId,
                component: activeTab,
                strategies,
            });
            setCases(data.data.generated || []);
            message.success(`生成了 ${data.data.generated?.length || 0} 条 ${TAB_META[activeTab].title} 测试用例`);
        } catch (e: any) { message.error(e?.response?.data?.detail || '生成测试用例失败，请检查API Key配置'); }
        setGenerating(false);
    };

    const handleRun = async () => {
        if (!cases.length) { message.warning('请先生成测试用例'); return; }
        setTesting(true);
        try {
            const { data } = await api.post<ApiResponse<TestRun>>('/executor/run', {
                snapshotId,
                caseIds: cases.map(c => c.caseId),
                executionMode: 'component',
            });
            setResults(data.data.records || []);
            message.success(`${TAB_META[activeTab].title} 测试完成：${data.data.passedCases} 通过 / ${data.data.failedCases} 失败`);
        } catch { message.error('测试执行失败'); }
        setTesting(false);
    };

    return (
        <div>
            <Typography.Title level={3} className="page-title">分部测试 — {TAB_META[activeTab].title}</Typography.Title>
            <Typography.Paragraph style={{ color: '#9ba6c7' }}>{TAB_META[activeTab].desc}</Typography.Paragraph>

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
                                label: `${s.snapshotId.slice(0, 20)}... (${s.rulesCount}R, ${s.dataObjectsCount}DO, ${s.actionsCount}A, ${s.eventsCount}E, ${s.linksCount}L)`,
                                value: s.snapshotId,
                            }))}
                        />
                    </Space>
                    <Space wrap>
                        <Typography.Text strong>测试策略：</Typography.Text>
                        <Checkbox.Group options={STRATEGIES} value={strategies} onChange={v => setStrategies(v as string[])} />
                    </Space>
                </Space>
            </Card>

            <Tabs
                activeKey={activeTab}
                onChange={key => navigate(`/component-test/${key}`)}
                items={Object.entries(TAB_META).map(([key, meta]) => ({ key, label: meta.title }))}
            />

            <Card
                title={`测试用例 (${cases.length} 条)`}
                extra={
                    <Space>
                        <Button icon={<ExperimentOutlined />} loading={generating} onClick={handleGenerate}>生成用例</Button>
                        <Button type="primary" icon={<PlayCircleOutlined />} loading={testing} disabled={!cases.length} onClick={handleRun}>运行测试</Button>
                    </Space>
                }
                style={{ marginBottom: 16 }}
            >
                {cases.length > 0 ? (
                    <Table
                        rowKey="caseId"
                        size="small"
                        pagination={{ pageSize: 8 }}
                        dataSource={cases}
                        columns={[
                            { title: '用例 ID', dataIndex: 'caseId', width: 180 },
                            { title: '策略', dataIndex: 'strategy', width: 120, render: (s: string) => <Tag color="gold">{s}</Tag> },
                            { title: '优先级', dataIndex: 'priority', width: 70, render: (p: string) => <Tag color={p === 'P0' ? 'red' : p === 'P1' ? 'orange' : 'blue'}>{p}</Tag> },
                            { title: '描述', dataIndex: 'description', ellipsis: true },
                        ]}
                        expandable={{
                            expandedRowRender: (r: GeneratedTestCase) => (
                                <Descriptions size="small" column={1} bordered>
                                    <Descriptions.Item label="完整描述">{r.description}</Descriptions.Item>
                                    <Descriptions.Item label="输入变量"><pre style={{ margin: 0, fontSize: 12 }}>{JSON.stringify(r.inputVariables, null, 2)}</pre></Descriptions.Item>
                                    <Descriptions.Item label="预期结果">{r.expectedOutcome || '-'}</Descriptions.Item>
                                    <Descriptions.Item label="测试类别">{r.testCategory || '-'}</Descriptions.Item>
                                </Descriptions>
                            ),
                        }}
                    />
                ) : (
                    <Empty description="点击「生成用例」按钮以生成分部测试用例" />
                )}
            </Card>

            {results.length > 0 && (
                <Card title={`测试结果 (${results.length} 条)`}>
                    <Table
                        rowKey="recordId"
                        size="small"
                        pagination={{ pageSize: 8 }}
                        dataSource={results}
                        columns={[
                            { title: '用例 ID', dataIndex: 'caseId', width: 180 },
                            { title: '裁定', dataIndex: 'verdict', width: 100, render: (v: string) => <Tag color={v === 'PASS' ? 'green' : v === 'FAIL' ? 'red' : 'orange'}>{v}</Tag> },
                            { title: '触发规则', dataIndex: 'triggeredRules', render: (rules: string[]) => rules?.map(r => <Tag key={r} color="volcano">{r}</Tag>) || <Tag>无</Tag> },
                            { title: '耗时(ms)', dataIndex: 'executionDurationMs', width: 100 },
                        ]}
                        expandable={{
                            expandedRowRender: (r: TestExecutionRecord) => (
                                <Space direction="vertical" style={{ width: '100%' }}>
                                    <Card size="small" title="推理过程">
                                        <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{r.reasoning || '暂无'}</Typography.Paragraph>
                                    </Card>
                                    {r.assertionResults?.length > 0 && (
                                        <Card size="small" title="断言检查">
                                            <Table
                                                rowKey={(_, i) => `a-${i}`}
                                                size="small"
                                                pagination={false}
                                                dataSource={r.assertionResults}
                                                columns={[
                                                    { title: '断言', dataIndex: 'assertion' },
                                                    { title: 'Expected', dataIndex: 'expected', width: 150 },
                                                    { title: 'Actual', dataIndex: 'actual', width: 150 },
                                                    { title: '结果', dataIndex: 'passed', width: 80, render: (p: boolean) => <Tag color={p ? 'green' : 'red'}>{p ? 'PASS' : 'FAIL'}</Tag> },
                                                ]}
                                            />
                                        </Card>
                                    )}
                                </Space>
                            ),
                        }}
                    />
                </Card>
            )}
        </div>
    );
}
