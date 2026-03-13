import { useEffect, useState } from 'react';
import {
    Typography, Card, Select, Button, Table, Tag, Space, message,
    Row, Col, InputNumber, Checkbox, Descriptions, Modal, Empty,
} from 'antd';
import {
    RobotOutlined, ExperimentOutlined, EyeOutlined, DeleteOutlined, ImportOutlined,
} from '@ant-design/icons';
import api from '../api';
import type { ApiResponse, OntologySnapshot, SimulatedDataItem } from '../types';

const RESUME_TYPES = [
    { value: 'normal', label: '正常简历', color: 'green' },
    { value: 'missing_education', label: '缺少教育经历', color: 'orange' },
    { value: 'missing_skills', label: '缺少关键技能', color: 'orange' },
    { value: 'career_gap', label: '职业空白', color: 'red' },
    { value: 'strange_degree', label: '冷门学位', color: 'red' },
    { value: 'overqualified', label: '过度资质', color: 'volcano' },
    { value: 'junior_candidate', label: '应届/初级', color: 'blue' },
];

const JD_TYPES = [
    { value: 'normal', label: '标准 JD', color: 'green' },
    { value: 'vague_requirements', label: '模糊需求', color: 'orange' },
    { value: 'conflicting_criteria', label: '矛盾条件', color: 'red' },
    { value: 'extreme_salary', label: '极端薪资范围', color: 'volcano' },
    { value: 'niche_role', label: '冷门/稀缺岗位', color: 'purple' },
];

export default function SimulatedDataPage() {
    const [snapshots, setSnapshots] = useState<OntologySnapshot[]>([]);
    const [snapshotId, setSnapshotId] = useState('');
    const [dataType, setDataType] = useState<'resume' | 'jd'>('resume');
    const [selectedSubTypes, setSelectedSubTypes] = useState<string[]>(['normal']);
    const [count, setCount] = useState(3);
    const [targetClient, setTargetClient] = useState('通用');
    const [generating, setGenerating] = useState(false);
    const [items, setItems] = useState<SimulatedDataItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [detailModal, setDetailModal] = useState<SimulatedDataItem | null>(null);
    const [batchImporting, setBatchImporting] = useState(false);

    const fetchItems = () => {
        setLoading(true);
        api.get<ApiResponse<SimulatedDataItem[]>>('/simulated-data/list')
            .then(r => setItems(r.data.data || []))
            .catch(() => {})
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        api.get<ApiResponse<OntologySnapshot[]>>('/ontology/snapshots')
            .then(r => {
                const snaps = r.data.data || [];
                setSnapshots(snaps);
                if (snaps.length > 0) setSnapshotId(snaps[0].snapshotId);
            })
            .catch(() => {});
        fetchItems();
    }, []);

    const handleGenerate = async () => {
        if (!snapshotId) { message.warning('请选择本体快照'); return; }
        if (selectedSubTypes.length === 0) { message.warning('请至少选择一种类型'); return; }
        setGenerating(true);
        try {
            const { data } = await api.post<ApiResponse<{ generated: SimulatedDataItem[] }>>('/simulated-data/generate', {
                snapshotId,
                dataType,
                subTypes: selectedSubTypes,
                count,
                ...(dataType === 'jd' ? { targetClient } : {}),
            });
            const gen = data.data.generated || [];
            message.success(`已生成 ${gen.length} 条模拟${dataType === 'resume' ? '简历' : 'JD'}`);
            fetchItems();
        } catch (e: any) {
            message.error(e?.response?.data?.detail || '生成失败，请检查 API Key');
        }
        setGenerating(false);
    };

    const handleDelete = async (itemId: string) => {
        try {
            await api.delete(`/simulated-data/${itemId}`);
            message.success('已删除');
            fetchItems();
        } catch { message.error('删除失败'); }
    };

    const handleImportToReal = async (itemId: string) => {
        try {
            await api.post(`/simulated-data/${itemId}/import`);
            message.success('已导入真实业务数据池');
        } catch (e: any) {
            message.error(e?.response?.data?.detail || '导入失败');
        }
    };

    const handleBatchImport = async (type: 'resume' | 'jd') => {
        const targetItems = items.filter(i => i.type === type);
        if (targetItems.length === 0) {
            message.warning(`暂无模拟${type === 'resume' ? '简历' : 'JD'}可导入`);
            return;
        }
        Modal.confirm({
            title: '批量导入确认',
            content: `确定要将全部 ${targetItems.length} 条模拟${type === 'resume' ? '简历' : 'JD'}导入到真实业务数据池吗？`,
            okText: '确定导入',
            cancelText: '取消',
            onOk: async () => {
                setBatchImporting(true);
                try {
                    const ids = targetItems.map(i => i.itemId);
                    const { data } = await api.post<ApiResponse<{ imported: number; failed: number }>>('/simulated-data/batch-import', { itemIds: ids });
                    const result = data.data;
                    message.success(`批量导入完成：成功 ${result.imported} 条，失败 ${result.failed} 条`);
                    fetchItems();
                } catch (e: any) {
                    message.error(e?.response?.data?.detail || '批量导入失败');
                }
                setBatchImporting(false);
            },
        });
    };

    const typeOptions = dataType === 'resume' ? RESUME_TYPES : JD_TYPES;
    const resumes = items.filter(i => i.type === 'resume');
    const jds = items.filter(i => i.type === 'jd');

    return (
        <div>
            <Typography.Title level={3} className="page-title">模拟业务数据</Typography.Title>
            <Typography.Paragraph style={{ color: '#9ba6c7' }}>
                使用 LLM 生成模拟简历和 JD（正常/异常/边界场景）以进行全面测试
            </Typography.Paragraph>

            {/* Generation Config */}
            <Card title={<><RobotOutlined style={{ color: '#a78bfa', marginRight: 8 }} />生成模拟数据</>} style={{ marginBottom: 16 }}>
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                    <Row gutter={16}>
                        <Col span={8}>
                            <Typography.Text strong>本体快照：</Typography.Text>
                            <Select
                                style={{ width: '100%', marginTop: 4 }}
                                placeholder="选择快照"
                                value={snapshotId || undefined}
                                onChange={setSnapshotId}
                                options={snapshots.map(s => ({
                                    label: `${s.snapshotId.slice(0, 20)}... (${s.rulesCount}R/${s.dataObjectsCount}DO)`,
                                    value: s.snapshotId,
                                }))}
                            />
                        </Col>
                        <Col span={8}>
                            <Typography.Text strong>数据类型：</Typography.Text>
                            <Select
                                style={{ width: '100%', marginTop: 4 }}
                                value={dataType}
                                onChange={(v) => { setDataType(v); setSelectedSubTypes(['normal']); }}
                                options={[
                                    { label: '简历', value: 'resume' },
                                    { label: '岗位描述 (JD)', value: 'jd' },
                                ]}
                            />
                        </Col>
                        <Col span={8}>
                            <Typography.Text strong>每种类型数量：</Typography.Text>
                            <InputNumber min={1} max={10} value={count} onChange={v => setCount(v || 3)}
                                style={{ width: '100%', marginTop: 4 }} />
                        </Col>
                    </Row>

                    {dataType === 'jd' && (
                        <Row gutter={16}>
                            <Col span={8}>
                                <Typography.Text strong>适用客户：</Typography.Text>
                                <Select
                                    style={{ width: '100%', marginTop: 4 }}
                                    value={targetClient}
                                    onChange={setTargetClient}
                                    options={[
                                        { label: '通用', value: '通用' },
                                        { label: '字节', value: '字节' },
                                        { label: '腾讯', value: '腾讯' },
                                    ]}
                                />
                            </Col>
                        </Row>
                    )}

                    <div>
                        <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>生成类型：</Typography.Text>
                        <Checkbox.Group
                            value={selectedSubTypes}
                            onChange={v => setSelectedSubTypes(v as string[])}
                        >
                            <Row gutter={[12, 8]}>
                                {typeOptions.map(t => (
                                    <Col key={t.value} xs={12} sm={8} md={6}>
                                        <Checkbox value={t.value}>
                                            <Tag color={t.color}>{t.label}</Tag>
                                        </Checkbox>
                                    </Col>
                                ))}
                            </Row>
                        </Checkbox.Group>
                    </div>

                    <Button
                        type="primary" size="large" icon={<ExperimentOutlined />}
                        loading={generating} onClick={handleGenerate}
                        disabled={!snapshotId || selectedSubTypes.length === 0}
                        style={{ width: 260 }}
                    >
                        {generating ? '生成中...' : `生成${dataType === 'resume' ? '简历' : 'JD'}`}
                    </Button>
                </Space>
            </Card>

            {/* Results */}
            <Card
                title={`模拟简历 (${resumes.length})`}
                extra={resumes.length > 0 ? <Button icon={<ImportOutlined />} loading={batchImporting} onClick={() => handleBatchImport('resume')}>批量导入到真实数据</Button> : null}
                style={{ marginBottom: 16 }}
            >
                {resumes.length > 0 ? (
                    <Table
                        rowKey="itemId" size="small" pagination={{ pageSize: 8 }}
                        dataSource={resumes} loading={loading}
                        columns={[
                            { title: '姓名', dataIndex: ['generatedData', 'name'], width: 100,
                              render: (n: string) => n || '-' },
                            { title: '类型', dataIndex: 'subType', width: 150,
                              render: (t: string) => {
                                const meta = RESUME_TYPES.find(r => r.value === t);
                                return <Tag color={meta?.color || 'default'}>{meta?.label || t}</Tag>;
                              }},
                            { title: '技能', dataIndex: ['generatedData', 'skills'], ellipsis: true,
                              render: (skills: string[]) => skills?.slice(0, 4).map(s => <Tag key={s} color="cyan">{s}</Tag>) || '-' },
                            { title: '生成时间', dataIndex: 'generatedAt', width: 170,
                              render: (t: string) => new Date(t).toLocaleString('zh-CN') },
                            { title: '操作', width: 200,
                              render: (_: any, r: SimulatedDataItem) => (
                                <Space>
                                    <Button size="small" icon={<EyeOutlined />} onClick={() => setDetailModal(r)}>详情</Button>
                                    <Button size="small" icon={<ImportOutlined />} onClick={() => handleImportToReal(r.itemId)}>导入</Button>
                                    <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(r.itemId)} />
                                </Space>
                              )},
                        ]}
                    />
                ) : <Empty description="暂无模拟简历" />}
            </Card>

            <Card
                title={`模拟 JD (${jds.length})`}
                extra={jds.length > 0 ? <Button icon={<ImportOutlined />} loading={batchImporting} onClick={() => handleBatchImport('jd')}>批量导入到真实数据</Button> : null}
            >
                {jds.length > 0 ? (
                    <Table
                        rowKey="itemId" size="small" pagination={{ pageSize: 8 }}
                        dataSource={jds} loading={loading}
                        columns={[
                            { title: '职位', dataIndex: ['generatedData', 'title'], width: 200, ellipsis: true },
                            { title: '部门', dataIndex: ['generatedData', 'department'], width: 120, ellipsis: true,
                              render: (d: string) => d || '-' },
                            { title: '适用客户', width: 100,
                              render: (_: any, r: SimulatedDataItem) => {
                                const client = r.applicableClient || r.generatedData?.applicableClient || '通用';
                                const colorMap: Record<string, string> = { '通用': 'blue', '字节': 'cyan', '腾讯': 'green' };
                                return <Tag color={colorMap[client] || 'default'}>{client}</Tag>;
                              }},
                            { title: '类型', dataIndex: 'subType', width: 150,
                              render: (t: string) => {
                                const meta = JD_TYPES.find(j => j.value === t);
                                return <Tag color={meta?.color || 'default'}>{meta?.label || t}</Tag>;
                              }},
                            { title: '要求', dataIndex: ['generatedData', 'requirements'], ellipsis: true,
                              render: (r: string[]) => r?.slice(0, 3).map((s, i) => <Tag key={i}>{s}</Tag>) || '-' },
                            { title: '生成时间', dataIndex: 'generatedAt', width: 170,
                              render: (t: string) => new Date(t).toLocaleString('zh-CN') },
                            { title: '操作', width: 200,
                              render: (_: any, r: SimulatedDataItem) => (
                                <Space>
                                    <Button size="small" icon={<EyeOutlined />} onClick={() => setDetailModal(r)}>详情</Button>
                                    <Button size="small" icon={<ImportOutlined />} onClick={() => handleImportToReal(r.itemId)}>导入</Button>
                                    <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(r.itemId)} />
                                </Space>
                              )},
                        ]}
                    />
                ) : <Empty description="暂无模拟 JD" />}
            </Card>

            {/* Detail Modal */}
            <Modal
                open={!!detailModal} onCancel={() => setDetailModal(null)} footer={null} width={700}
                title={<><RobotOutlined style={{ marginRight: 8 }} />模拟数据详情</>}
            >
                {detailModal && (
                    <div>
                        <Descriptions bordered size="small" column={2} style={{ marginBottom: 16 }}>
                            <Descriptions.Item label="类型">
                                <Tag color={detailModal.type === 'resume' ? 'magenta' : 'green'}>
                                    {detailModal.type === 'resume' ? '简历' : 'JD'}
                                </Tag>
                            </Descriptions.Item>
                            <Descriptions.Item label="子类型">
                                <Tag>{detailModal.subType}</Tag>
                            </Descriptions.Item>
                            <Descriptions.Item label="生成时间" span={2}>
                                {new Date(detailModal.generatedAt).toLocaleString('zh-CN')}
                            </Descriptions.Item>
                        </Descriptions>
                        <Card size="small" title="生成数据">
                            <pre style={{
                                maxHeight: 400, overflow: 'auto', fontSize: 12,
                                background: '#0a1226', padding: 12, borderRadius: 8,
                                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                            }}>
                                {JSON.stringify(detailModal.generatedData, null, 2)}
                            </pre>
                        </Card>
                    </div>
                )}
            </Modal>
        </div>
    );
}
