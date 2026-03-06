import { useEffect, useState } from 'react';
import {
    Typography, Card, Tabs, Table, Tag, Space, Button, message, Empty,
    Modal, Form, Input, Select, Popconfirm, Descriptions, InputNumber,
} from 'antd';
import {
    PlusOutlined, DeleteOutlined, EditOutlined, ExportOutlined,
    RobotOutlined, DatabaseOutlined, ThunderboltOutlined,
    SafetyOutlined, LinkOutlined, AppstoreOutlined, ExperimentOutlined,
} from '@ant-design/icons';
import api from '../api';
import type { ApiResponse, OntologySnapshot, LibraryCase } from '../types';

type CategoryKey = 'dataobjects' | 'actions_events' | 'rules' | 'links' | 'ontology' | 'business_integration';

const CATEGORIES: Record<CategoryKey, { title: string; icon: React.ReactNode; color: string }> = {
    dataobjects: { title: 'DataObjects', icon: <DatabaseOutlined />, color: 'blue' },
    actions_events: { title: 'Actions & Events', icon: <ThunderboltOutlined />, color: 'purple' },
    rules: { title: 'Rules', icon: <SafetyOutlined />, color: 'gold' },
    links: { title: 'Links', icon: <LinkOutlined />, color: 'cyan' },
    ontology: { title: 'Ontology', icon: <AppstoreOutlined />, color: 'green' },
    business_integration: { title: '业务数据模拟测试', icon: <ExperimentOutlined />, color: 'magenta' },
};

export default function TestCaseLibraryPage() {
    const [activeTab, setActiveTab] = useState<CategoryKey>('dataobjects');
    const [cases, setCases] = useState<LibraryCase[]>([]);
    const [stats, setStats] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const [editingCase, setEditingCase] = useState<LibraryCase | null>(null);
    const [form] = Form.useForm();

    // AI generation state
    const [snapshots, setSnapshots] = useState<OntologySnapshot[]>([]);
    const [genSnapshotId, setGenSnapshotId] = useState('');
    const [genCount, setGenCount] = useState(10);
    const [generating, setGenerating] = useState(false);

    const fetchCases = async () => {
        setLoading(true);
        try {
            const { data } = await api.get<ApiResponse<LibraryCase[]>>('/library/cases');
            setCases(data.data || []);
        } catch { message.error('加载用例库失败'); }
        setLoading(false);
    };

    const fetchStats = async () => {
        try {
            const { data } = await api.get<ApiResponse<Record<string, number>>>('/library/stats');
            setStats(data.data || {});
        } catch { /* ignore */ }
    };

    useEffect(() => {
        fetchCases();
        fetchStats();
        api.get<ApiResponse<OntologySnapshot[]>>('/ontology/snapshots')
            .then(r => setSnapshots(r.data.data || []))
            .catch(() => { });
    }, []);

    const filteredCases = cases.filter(c => c.category === activeTab);

    const handleCreate = () => {
        setEditingCase(null);
        form.resetFields();
        form.setFieldsValue({ category: activeTab, priority: 'P1', tags: [activeTab] });
        setModalOpen(true);
    };

    const handleEdit = (record: LibraryCase) => {
        setEditingCase(record);
        form.setFieldsValue({
            title: record.title,
            description: record.description,
            category: record.category,
            priority: record.priority,
            tags: record.tags,
            expectedOutcome: record.expectedOutcome,
        });
        setModalOpen(true);
    };

    const handleSave = async () => {
        try {
            const values = await form.validateFields();
            if (editingCase) {
                await api.put(`/library/cases/${editingCase.caseId}`, values);
                message.success('更新成功');
            } else {
                await api.post('/library/cases', values);
                message.success('创建成功');
            }
            setModalOpen(false);
            fetchCases();
            fetchStats();
        } catch { /* validation error */ }
    };

    const handleDelete = async (caseId: string) => {
        try {
            await api.delete(`/library/cases/${caseId}`);
            message.success('已删除');
            fetchCases();
            fetchStats();
        } catch { message.error('删除失败'); }
    };

    const handleAIGenerate = async () => {
        if (!genSnapshotId) { message.warning('请先选择本体'); return; }
        setGenerating(true);
        try {
            const { data } = await api.post<ApiResponse<{ generated: LibraryCase[]; totalCount: number }>>(
                '/library/generate',
                { category: activeTab, snapshotId: genSnapshotId, count: genCount },
            );
            message.success(`AI 已生成 ${data.data.totalCount} 条 ${CATEGORIES[activeTab].title} 用例`);
            fetchCases();
            fetchStats();
        } catch (e: any) {
            message.error(e?.response?.data?.detail || 'AI 生成失败，请检查 API Key 配置');
        }
        setGenerating(false);
    };

    const handleExport = () => {
        const exportData = filteredCases.map(c => ({
            用例ID: c.caseId,
            标题: c.title,
            描述: c.description,
            分类: c.category,
            优先级: c.priority,
            标签: c.tags.join(', '),
            预期结果: c.expectedOutcome,
            测试步骤: c.steps?.join(' → ') || '',
            创建时间: c.createdAt,
        }));
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `test-case-library-${activeTab}-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        message.success('导出成功');
    };

    const columns = [
        {
            title: '标题', dataIndex: 'title', width: 200,
            render: (t: string) => <Typography.Text strong style={{ color: '#e6ecff' }}>{t}</Typography.Text>,
        },
        {
            title: '类型', width: 120,
            render: (_: any, r: LibraryCase) => r.isNegative
                ? <><Tag color="red">❌ 负向</Tag>{r.negativeType && <Tag color="volcano" style={{ fontSize: 11 }}>{r.negativeType}</Tag>}</>
                : <Tag color="green">✅ 正向</Tag>,
        },
        { title: '描述', dataIndex: 'description', ellipsis: true },
        {
            title: '策略', dataIndex: 'strategy', width: 150,
            render: (s: string) => s ? <Tag color="geekblue">{s}</Tag> : null,
        },
        {
            title: '标签', dataIndex: 'tags', width: 180,
            render: (tags: string[]) => tags?.filter(t => t !== activeTab).map(t => (
                <Tag key={t} color={CATEGORIES[activeTab].color}>{t}</Tag>
            )),
        },
        {
            title: '优先级', dataIndex: 'priority', width: 80,
            render: (p: string) => (
                <Tag color={p === 'P0' ? 'red' : p === 'P1' ? 'orange' : 'blue'}>{p}</Tag>
            ),
        },
        {
            title: '创建时间', dataIndex: 'createdAt', width: 120,
            render: (d: string) => d ? new Date(d).toLocaleDateString('zh-CN') : '-',
        },
        {
            title: '操作', width: 140, fixed: 'right' as const,
            render: (_: any, record: LibraryCase) => (
                <Space>
                    <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>编辑</Button>
                    <Popconfirm title="确定删除此用例？" onConfirm={() => handleDelete(record.caseId)}>
                        <Button size="small" danger icon={<DeleteOutlined />}>删</Button>
                    </Popconfirm>
                </Space>
            ),
        },
    ];



    return (
        <div>
            <Typography.Title level={3} className="page-title">测试用例库</Typography.Title>
            <Typography.Paragraph style={{ color: '#9ba6c7' }}>
                按类别管理和维护测试用例，支持 AI 智能生成与手动编辑
            </Typography.Paragraph>

            {/* AI Generation Card — hidden for business_integration tab */}
            {activeTab !== 'business_integration' && <Card style={{ marginBottom: 16 }}>
                <Space style={{ width: '100%', justifyContent: 'space-between' }} align="center">
                    <Space size="large">
                        <Space>
                            <Typography.Text strong>测试分区</Typography.Text>
                            <Select
                                style={{ width: 220 }}
                                value={activeTab}
                                onChange={(v) => setActiveTab(v as CategoryKey)}
                                options={Object.entries(CATEGORIES).map(([key, meta]) => ({
                                    label: meta.title,
                                    value: key,
                                }))}
                            />
                        </Space>
                        <Space>
                            <Typography.Text strong>选择本体</Typography.Text>
                            <Select
                                style={{ width: 380 }}
                                placeholder="选择本体快照（整体快照，按分区生成）"
                                value={genSnapshotId || undefined}
                                onChange={setGenSnapshotId}
                                options={snapshots.map(s => ({
                                    label: `[快照] Rules:${s.rulesCount ?? 0} | DataObj:${s.dataObjectsCount ?? 0} | Actions:${s.actionsCount ?? 0} | Events:${s.eventsCount ?? 0} | Links:${s.linksCount ?? 0}`,
                                    value: s.snapshotId,
                                }))}
                            />
                        </Space>
                        <Space>
                            <Typography.Text strong>数量</Typography.Text>
                            <InputNumber
                                min={1} max={50} value={genCount}
                                onChange={v => setGenCount(v || 10)}
                                style={{ width: 80 }}
                            />
                        </Space>
                    </Space>
                    <Button
                        type="primary"
                        icon={<RobotOutlined />}
                        loading={generating}
                        onClick={handleAIGenerate}
                        style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', border: 'none' }}
                    >
                        AI 生成
                    </Button>
                </Space>
            </Card>}

            {/* Category Tabs */}
            <Tabs
                activeKey={activeTab}
                onChange={key => setActiveTab(key as CategoryKey)}
                items={Object.entries(CATEGORIES).map(([key, meta]) => ({
                    key,
                    label: (
                        <span>
                            {meta.icon} {meta.title} ({stats[key] || 0})
                        </span>
                    ),
                }))}
            />

            {/* Case Table */}
            <Card
                title={`${CATEGORIES[activeTab].title} 测试用例`}
                extra={
                    <Space>
                        <Button icon={<PlusOutlined />} onClick={handleCreate}>新增用例</Button>
                        <Button icon={<ExportOutlined />} onClick={handleExport} disabled={!filteredCases.length}>导出</Button>
                    </Space>
                }
            >
                {filteredCases.length > 0 ? (
                    <Table
                        rowKey="caseId"
                        size="small"
                        loading={loading}
                        pagination={{ pageSize: 10, showTotal: total => `共 ${total} 条` }}
                        dataSource={filteredCases}
                        columns={columns}
                        expandable={{
                            expandedRowRender: (r: LibraryCase) => (
                                <div style={{ padding: '4px 8px' }}>
                                    <Descriptions size="small" column={1} bordered>
                                        <Descriptions.Item label="完整描述">{r.description || '-'}</Descriptions.Item>
                                        <Descriptions.Item label="输入变量">
                                            <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                                {r.inputVariables && Object.keys(r.inputVariables).length > 0
                                                    ? JSON.stringify(r.inputVariables, null, 2)
                                                    : '-'}
                                            </pre>
                                        </Descriptions.Item>
                                        <Descriptions.Item label="预期结果">{r.expectedOutcome || '-'}</Descriptions.Item>
                                    </Descriptions>
                                    {Array.isArray(r.steps) && r.steps.length > 0 && (
                                        <div style={{ marginTop: 8 }}>
                                            <Typography.Text strong style={{ fontSize: 12, color: '#9ba6c7' }}>测试步骤：</Typography.Text>
                                            <ol style={{ margin: '4px 0 0 0', paddingLeft: 20 }}>
                                                {r.steps.map((s: any, i) => {
                                                    const text = typeof s === 'string' ? s : (s?.description || s?.step || JSON.stringify(s));
                                                    return <li key={i} style={{ fontSize: 13 }}>{text}</li>;
                                                })}
                                            </ol>
                                        </div>
                                    )}
                                </div>
                            ),
                        }}
                    />
                ) : (
                    <Empty description={`暂无 ${CATEGORIES[activeTab].title} 类别的测试用例，点击「AI 生成」或「新增用例」添加`} />
                )}
            </Card>

            {/* Create/Edit Modal */}
            <Modal
                title={editingCase ? '编辑测试用例' : '新增测试用例'}
                open={modalOpen}
                onOk={handleSave}
                onCancel={() => setModalOpen(false)}
                width={640}
                okText={editingCase ? '保存' : '创建'}
                cancelText="取消"
            >
                <Form form={form} layout="vertical">
                    <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
                        <Input placeholder="用例标题" />
                    </Form.Item>
                    <Form.Item name="description" label="描述" rules={[{ required: true, message: '请输入描述' }]}>
                        <Input.TextArea rows={3} placeholder="详细描述测试目的和验证内容" />
                    </Form.Item>
                    <Space style={{ width: '100%' }} size="large">
                        <Form.Item name="category" label="分类" rules={[{ required: true }]}>
                            <Select style={{ width: 180 }} options={
                                Object.entries(CATEGORIES).map(([k, v]) => ({ label: v.title, value: k }))
                            } />
                        </Form.Item>
                        <Form.Item name="priority" label="优先级">
                            <Select style={{ width: 120 }} options={[
                                { label: 'P0 - 关键', value: 'P0' },
                                { label: 'P1 - 重要', value: 'P1' },
                                { label: 'P2 - 一般', value: 'P2' },
                            ]} />
                        </Form.Item>
                    </Space>
                    <Form.Item name="tags" label="标签">
                        <Select mode="tags" placeholder="输入标签后回车" />
                    </Form.Item>
                    <Form.Item name="expectedOutcome" label="预期结果">
                        <Input.TextArea rows={2} placeholder="预期的测试结果" />
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
}
