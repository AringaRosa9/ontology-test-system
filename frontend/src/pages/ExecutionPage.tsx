import { useEffect, useState } from 'react';
import {
    Typography, Card, Select, Button, Table, Tag, Space, message,
    Checkbox, Row, Col, Statistic, Divider, Progress, Alert,
} from 'antd';
import {
    PlayCircleOutlined, DatabaseOutlined, ThunderboltOutlined,
    SafetyOutlined, LinkOutlined, AppstoreOutlined, ExperimentOutlined,
    CheckCircleOutlined, CloseCircleOutlined, WarningOutlined, BugOutlined,
} from '@ant-design/icons';
import api from '../api';
import type { ApiResponse, OntologySnapshot, LibraryCase, TestRun, FailedNode } from '../types';

function FailedNodePanel({ node }: { node: FailedNode }) {
    const ruleColumns = [
        { title: '规则ID', dataIndex: 'id', key: 'id', width: 100 },
        { title: '场景阶段', dataIndex: 'specificScenarioStage', key: 'specificScenarioStage', width: 140 },
        { title: '规则名称', dataIndex: 'businessLogicRuleName', key: 'businessLogicRuleName', width: 160 },
        { title: '适用客户', dataIndex: 'applicableClient', key: 'applicableClient', width: 120 },
        { title: '适用部门', dataIndex: 'applicableDepartment', key: 'applicableDepartment', width: 120 },
        { title: '规则详情', dataIndex: 'standardizedLogicRule', key: 'standardizedLogicRule',
            render: (v: string) => <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{v || '—'}</div>,
        },
        {
            title: '关联实体', dataIndex: 'relatedEntities', key: 'relatedEntities', width: 180,
            render: (v: string) => v ? v.split('\n').map((e: string, i: number) => <Tag key={i} color="blue">{e.trim()}</Tag>) : '—',
        },
    ];

    const ruleData = [{
        key: 'rule-0',
        id: node.id || '—',
        specificScenarioStage: node.specificScenarioStage || '—',
        businessLogicRuleName: node.businessLogicRuleName || node.ruleName || '—',
        applicableClient: node.applicableClient || '—',
        applicableDepartment: node.applicableDepartment || '—',
        standardizedLogicRule: node.standardizedLogicRule || node.ruleDescription || '—',
        relatedEntities: node.relatedEntities || '',
    }];

    return (
        <Card size="small" style={{ background: 'rgba(251, 113, 133, 0.08)', border: '1px solid rgba(251, 113, 133, 0.3)', marginTop: 8 }}>
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
                <div>
                    <Typography.Text type="secondary" strong>失败规则：</Typography.Text>
                    <Table
                        size="small"
                        pagination={false}
                        columns={ruleColumns}
                        dataSource={ruleData}
                        style={{ marginTop: 4 }}
                        scroll={{ x: 900 }}
                    />
                </div>
            </Space>
        </Card>
    );
}

const CATEGORIES = [
    { key: 'dataobjects', label: 'DataObjects', icon: <DatabaseOutlined />, color: 'blue' },
    { key: 'actions_events', label: 'Actions & Events', icon: <ThunderboltOutlined />, color: 'purple' },
    { key: 'rules', label: 'Rules', icon: <SafetyOutlined />, color: 'gold' },
    { key: 'links', label: 'Links', icon: <LinkOutlined />, color: 'cyan' },
    { key: 'ontology', label: 'Ontology', icon: <AppstoreOutlined />, color: 'green' },
    { key: 'business_integration', label: '业务数据模拟测试', icon: <ExperimentOutlined />, color: 'magenta' },
];

export default function ExecutionPage() {
    const [snapshots, setSnapshots] = useState<OntologySnapshot[]>([]);
    const [snapshotId, setSnapshotId] = useState('');
    const [libraryCases, setLibraryCases] = useState<LibraryCase[]>([]);
    const [selectedCategories, setSelectedCategories] = useState<string[]>(CATEGORIES.map(c => c.key));
    const [executing, setExecuting] = useState(false);
    const [result, setResult] = useState<TestRun | null>(null);

    // Load snapshots
    useEffect(() => {
        api.get<ApiResponse<OntologySnapshot[]>>('/ontology/snapshots')
            .then(r => {
                const snaps = r.data.data || [];
                setSnapshots(snaps);
                if (snaps.length > 0) setSnapshotId(snaps[0].snapshotId);
            })
            .catch(() => { });
    }, []);

    // Load library cases
    useEffect(() => {
        api.get<ApiResponse<LibraryCase[]>>('/library/cases')
            .then(r => setLibraryCases(r.data.data || []))
            .catch(() => { });
    }, []);

    // Count per category
    const categoryCounts = Object.fromEntries(
        CATEGORIES.map(c => [c.key, libraryCases.filter(lc => lc.category === c.key).length])
    );
    const totalSelected = selectedCategories.reduce((sum, cat) => sum + (categoryCounts[cat] || 0), 0);

    const handleSelectAll = (checked: boolean) => {
        setSelectedCategories(checked ? CATEGORIES.map(c => c.key) : []);
    };

    const handleExecute = async () => {
        if (!snapshotId) { message.warning('请先选择本体快照'); return; }
        if (selectedCategories.length === 0) { message.warning('请至少选择一个测试分类'); return; }
        if (totalSelected === 0) { message.warning('所选分类中暂无测试用例，请先在测试用例库中生成'); return; }
        setExecuting(true);
        setResult(null);
        try {
            const { data } = await api.post<ApiResponse<TestRun>>('/executor/run-library', {
                snapshotId,
                categories: selectedCategories,
            });
            setResult(data.data);
            message.success(`执行完成：${data.data.passedCases} 通过 / ${data.data.failedCases} 失败 / ${data.data.warningCases} 警告`);
        } catch (e: any) {
            message.error(e?.response?.data?.detail || '执行失败，请检查 API Key 配置');
        }
        setExecuting(false);
    };

    const allSelected = selectedCategories.length === CATEGORIES.length;
    const indeterminate = selectedCategories.length > 0 && selectedCategories.length < CATEGORIES.length;

    return (
        <div>
            <Typography.Title level={3} className="page-title">执行测试</Typography.Title>
            <Typography.Paragraph style={{ color: '#9ba6c7' }}>
                从测试用例库中选择分类，结合本体快照使用 AI 评估，结果自动保存至历史记录
            </Typography.Paragraph>

            {/* Config Card */}
            <Card style={{ marginBottom: 16 }}>
                <Space direction="vertical" style={{ width: '100%' }} size="large">

                    {/* Snapshot selector */}
                    <Space wrap>
                        <Typography.Text strong>本体快照：</Typography.Text>
                        <Select
                            style={{ width: 420 }}
                            placeholder="选择快照（用于 LLM 评估上下文）"
                            value={snapshotId || undefined}
                            onChange={setSnapshotId}
                            options={snapshots.map(s => ({
                                label: `[快照] Rules:${s.rulesCount} | DataObj:${s.dataObjectsCount} | Actions:${s.actionsCount} | Events:${s.eventsCount} | Links:${s.linksCount}`,
                                value: s.snapshotId,
                            }))}
                        />
                    </Space>

                    <Divider style={{ margin: '4px 0' }} />

                    {/* Category selection */}
                    <div>
                        <Space style={{ marginBottom: 12 }}>
                            <Typography.Text strong>选择测试分类：</Typography.Text>
                            <Checkbox
                                indeterminate={indeterminate}
                                checked={allSelected}
                                onChange={e => handleSelectAll(e.target.checked)}
                            >
                                全选
                            </Checkbox>
                            <Tag color="blue">已选 {totalSelected} 条用例</Tag>
                        </Space>

                        <Row gutter={[12, 12]}>
                            {CATEGORIES.map(cat => {
                                const count = categoryCounts[cat.key] || 0;
                                const checked = selectedCategories.includes(cat.key);
                                return (
                                    <Col key={cat.key} xs={24} sm={12} md={8}>
                                        <Card
                                            size="small"
                                            style={{
                                                cursor: count > 0 ? 'pointer' : 'not-allowed',
                                                opacity: count === 0 ? 0.45 : 1,
                                                border: checked && count > 0
                                                    ? `1.5px solid var(--ant-color-primary, #22d3ee)`
                                                    : '1.5px solid transparent',
                                                background: checked && count > 0 ? 'rgba(34,211,238,0.06)' : undefined,
                                                transition: 'all 0.2s',
                                            }}
                                            onClick={() => {
                                                if (count === 0) return;
                                                setSelectedCategories(prev =>
                                                    prev.includes(cat.key)
                                                        ? prev.filter(k => k !== cat.key)
                                                        : [...prev, cat.key]
                                                );
                                            }}
                                        >
                                            <Space>
                                                <Checkbox
                                                    checked={checked && count > 0}
                                                    disabled={count === 0}
                                                    onChange={() => { }} // handled by card click
                                                />
                                                <span style={{ color: count > 0 ? `var(--ant-color-${cat.color}, #9ba6c7)` : '#6b7a99' }}>
                                                    {cat.icon}
                                                </span>
                                                <Typography.Text strong style={{ fontSize: 13 }}>{cat.label}</Typography.Text>
                                                <Tag color={count > 0 ? cat.color : 'default'} style={{ marginLeft: 'auto' }}>
                                                    {count} 条
                                                </Tag>
                                            </Space>
                                        </Card>
                                    </Col>
                                );
                            })}
                        </Row>
                    </div>

                    {/* Execute button */}
                    <Space>
                        <Button
                            type="primary" size="large"
                            icon={<PlayCircleOutlined />}
                            loading={executing}
                            onClick={handleExecute}
                            disabled={!snapshotId || selectedCategories.length === 0 || totalSelected === 0}
                            style={{ background: 'linear-gradient(135deg, #22d3ee, #6366f1)', border: 'none', minWidth: 160 }}
                        >
                            {executing ? `AI 评估中…` : `执行测试 (${totalSelected} 条)`}
                        </Button>
                        {executing && (
                            <Typography.Text type="secondary">LLM 正在评估，请稍候…</Typography.Text>
                        )}
                    </Space>
                </Space>
            </Card>

            {/* Result Card */}
            {result && (
                <Card
                    title={
                        <Space>
                            <CheckCircleOutlined style={{ color: '#4ade80' }} />
                            <span>执行结果 — {result.runId}</span>
                            <Tag color="processing">{result.executionMode}</Tag>
                        </Space>
                    }
                    style={{ marginBottom: 16 }}
                    extra={<Typography.Text type="secondary" style={{ fontSize: 12 }}>已保存至历史记录</Typography.Text>}
                >
                    {/* Summary stats */}
                    <Row gutter={16} style={{ marginBottom: 16 }}>
                        <Col span={4}>
                            <Statistic title="总计" value={result.totalCases} valueStyle={{ color: '#9ba6c7' }} />
                        </Col>
                        <Col span={4}>
                            <Statistic title="通过" value={result.passedCases} valueStyle={{ color: '#4ade80' }}
                                prefix={<CheckCircleOutlined />} />
                        </Col>
                        <Col span={4}>
                            <Statistic title="失败" value={result.failedCases} valueStyle={{ color: '#fb7185' }}
                                prefix={<CloseCircleOutlined />} />
                        </Col>
                        <Col span={4}>
                            <Statistic title="警告" value={result.warningCases} valueStyle={{ color: '#fbbf24' }}
                                prefix={<WarningOutlined />} />
                        </Col>
                        <Col span={8}>
                            <div style={{ paddingTop: 8 }}>
                                <Typography.Text type="secondary" style={{ fontSize: 12 }}>通过率</Typography.Text>
                                <Progress
                                    percent={Math.round(result.coverageRate * 100)}
                                    strokeColor={result.coverageRate >= 0.7 ? '#4ade80' : result.coverageRate >= 0.4 ? '#fbbf24' : '#fb7185'}
                                    style={{ marginTop: 4 }}
                                />
                            </div>
                        </Col>
                    </Row>

                    {/* Records table */}
                    <Table
                        rowKey="recordId"
                        size="small"
                        pagination={{ pageSize: 15, showTotal: total => `共 ${total} 条` }}
                        dataSource={result.records || []}
                        columns={[
                            {
                                title: '分类', dataIndex: 'category', width: 120,
                                render: (cat: string) => {
                                    const meta = CATEGORIES.find(c => c.key === cat);
                                    return meta ? <Tag color={meta.color}>{meta.label}</Tag> : <Tag>{cat || '-'}</Tag>;
                                },
                            },
                            {
                                title: '用例标题', dataIndex: 'title', width: 200, ellipsis: true,
                                render: (t: string, row: any) => t || row.caseId,
                            },
                            {
                                title: '裁定', dataIndex: 'verdict', width: 90,
                                render: (v: string) => (
                                    <Tag color={v === 'PASS' ? 'green' : v === 'FAIL' ? 'red' : v === 'WARNING' ? 'orange' : 'default'}>
                                        {v}
                                    </Tag>
                                ),
                            },
                            {
                                title: '触发规则', dataIndex: 'triggeredRules', width: 180,
                                render: (rules: string[]) => rules?.length
                                    ? rules.map(r => <Tag key={r} color="volcano" style={{ marginBottom: 2 }}>{r}</Tag>)
                                    : <Tag>无</Tag>,
                            },
                            { title: '推理', dataIndex: 'reasoning', ellipsis: true },
                            { title: '耗时(ms)', dataIndex: 'executionDurationMs', width: 90 },
                            {
                                title: '调试信息', width: 90,
                                render: (_: any, row: any) => row.failedNode ? (
                                    <Tag color="red" icon={<BugOutlined />}>追踪</Tag>
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

            {!result && !executing && (
                <Alert
                    type="info" showIcon
                    message="执行后结果将显示在此处，并自动保存至「历史记录」页面"
                    style={{ marginTop: 8 }}
                />
            )}
        </div>
    );
}
