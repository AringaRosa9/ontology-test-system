import { useEffect, useState } from 'react';
import {
    Typography, Card, Upload, Table, Tag, Space, Button, message, Empty,
    Descriptions, Select, Modal, Row, Col, Popconfirm, Spin, Divider, Drawer, Tabs,
    Form, Input, Switch, List, Checkbox, Badge, Alert,
} from 'antd';
import type { TabsProps } from 'antd';
import {
    FileTextOutlined, FilePdfOutlined, DeleteOutlined,
    ExperimentOutlined, InboxOutlined, EyeOutlined, UserOutlined,
    CloudServerOutlined, CloudDownloadOutlined, ApiOutlined, FolderOpenOutlined,
    TagOutlined,
} from '@ant-design/icons';
import api from '../api';
import type { ApiResponse, OntologySnapshot, BusinessDataItem, GeneratedTestCase } from '../types';

const { Dragger } = Upload;
const API_BASE = 'http://localhost:8000';

// ── MinIO Import Panel for Business Data ─────────────────────────────────────

function MinIOBusinessPanel({ onImported }: { onImported: () => void }) {
    const [form] = Form.useForm();
    const [testing, setTesting] = useState(false);
    const [connStatus, setConnStatus] = useState<any>(null);
    const [browsing, setBrowsing] = useState(false);
    const [objects, setObjects] = useState<any[]>([]);
    const [currentBucket, setCurrentBucket] = useState('');
    const [currentPrefix, setCurrentPrefix] = useState('');
    const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
    const [pulling, setPulling] = useState(false);

    const getConnValues = () => ({
        endpoint: form.getFieldValue('endpoint') || 'localhost:9000',
        access_key: form.getFieldValue('access_key') || '',
        secret_key: form.getFieldValue('secret_key') || '',
        secure: form.getFieldValue('secure') || false,
    });

    const handleTestConnection = async () => {
        setTesting(true);
        setConnStatus(null);
        try {
            const { data } = await api.post<ApiResponse<any>>('/import/minio/test-connection', getConnValues());
            setConnStatus(data.data);
            if (data.data.connected) {
                message.success(`MinIO连接成功，共 ${data.data.buckets?.length || 0} 个存储桶`);
            } else {
                message.error(`连接失败: ${data.data.error}`);
            }
        } catch (e: any) {
            message.error(e?.response?.data?.detail || '连接测试失败');
        }
        setTesting(false);
    };

    const handleBrowse = async (bucket: string, prefix: string = '') => {
        setBrowsing(true);
        try {
            const { data } = await api.post<ApiResponse<any>>('/import/minio/browse', {
                ...getConnValues(), bucket, prefix,
            });
            setObjects(data.data.objects || []);
            setCurrentBucket(bucket);
            setCurrentPrefix(prefix);
            setSelectedKeys([]);
        } catch (e: any) {
            message.error(e?.response?.data?.detail || '浏览失败');
        }
        setBrowsing(false);
    };

    const handlePull = async () => {
        if (!selectedKeys.length) { message.warning('请先选择文件'); return; }
        setPulling(true);
        try {
            const { data } = await api.post<ApiResponse<any>>('/import/minio/pull', {
                ...getConnValues(),
                bucket: currentBucket,
                objects: selectedKeys,
            });
            const d = data.data;
            const parts = [];
            if (d.resumes > 0) parts.push(`${d.resumes} 份简历PDF`);
            if (d.jds > 0) parts.push(`${d.jds} 个JD CSV`);
            if (d.ontologyFiles > 0) parts.push(`${d.ontologyFiles} 个本体JSON`);
            message.success(`MinIO导入成功：${parts.join('，') || '0 文件'}`);
            if (d.errors?.length) {
                d.errors.forEach((err: string) => message.warning(err));
            }
            onImported();
            setSelectedKeys([]);
        } catch (e: any) {
            message.error(e?.response?.data?.detail || 'MinIO拉取失败');
        }
        setPulling(false);
    };

    const formatSize = (bytes: number) => {
        if (!bytes) return '-';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    const getFileTypeTag = (name: string) => {
        const lower = name.toLowerCase();
        if (lower.endsWith('.pdf')) return <Tag color="magenta">PDF</Tag>;
        if (lower.endsWith('.csv')) return <Tag color="green">CSV</Tag>;
        if (lower.endsWith('.json')) return <Tag color="blue">JSON</Tag>;
        return <Tag>其他</Tag>;
    };

    return (
        <Card title={<><CloudServerOutlined style={{ color: '#38bdf8', marginRight: 8 }} />从 MinIO 导入</>}
            style={{ marginBottom: 20 }}>
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
                <Alert type="info" showIcon message={
                    <>
                        从 MinIO 批量拉取：<strong>.pdf</strong> → 简历，
                        <strong>.csv</strong> → JD，<strong>.json</strong> → 本体数据
                    </>
                } />
                <Form form={form} layout="inline" initialValues={{
                    endpoint: 'localhost:9000', access_key: '', secret_key: '', secure: false,
                }}>
                    <Form.Item label="Endpoint" name="endpoint">
                        <Input placeholder="localhost:9000" style={{ width: 180 }} />
                    </Form.Item>
                    <Form.Item label="Access Key" name="access_key">
                        <Input style={{ width: 150 }} />
                    </Form.Item>
                    <Form.Item label="Secret Key" name="secret_key">
                        <Input.Password style={{ width: 150 }} />
                    </Form.Item>
                    <Form.Item label="HTTPS" name="secure" valuePropName="checked">
                        <Switch />
                    </Form.Item>
                    <Form.Item>
                        <Button icon={<ApiOutlined />} loading={testing} onClick={handleTestConnection}>
                            连接
                        </Button>
                    </Form.Item>
                </Form>

                {/* Bucket list */}
                {connStatus?.connected && connStatus.buckets?.length > 0 && (
                    <Space wrap>
                        {connStatus.buckets.map((b: any) => (
                            <Button key={b.name} size="small" icon={<FolderOpenOutlined />}
                                type={currentBucket === b.name ? 'primary' : 'default'}
                                onClick={() => handleBrowse(b.name)}>
                                {b.name}
                            </Button>
                        ))}
                    </Space>
                )}

                {/* Object browser */}
                {currentBucket && (
                    <Card size="small"
                        title={<>
                            {currentBucket}{currentPrefix ? ` / ${currentPrefix}` : ''}
                            {browsing && <Spin size="small" style={{ marginLeft: 8 }} />}
                        </>}
                        extra={
                            <Space>
                                {currentPrefix && (
                                    <Button size="small" onClick={() => {
                                        const parts = currentPrefix.split('/').filter(Boolean);
                                        parts.pop();
                                        handleBrowse(currentBucket, parts.length ? parts.join('/') + '/' : '');
                                    }}>上级目录</Button>
                                )}
                                <Badge count={selectedKeys.length} size="small">
                                    <Button type="primary" size="small" icon={<CloudDownloadOutlined />}
                                        loading={pulling} onClick={handlePull}
                                        disabled={!selectedKeys.length}>
                                        拉取选中
                                    </Button>
                                </Badge>
                            </Space>
                        }>
                        <List size="small" dataSource={objects} locale={{ emptyText: '空目录' }}
                            renderItem={(obj: any) => (
                                <List.Item
                                    actions={obj.isDir ? [
                                        <Button size="small" type="link" onClick={() => handleBrowse(currentBucket, obj.name)}>打开</Button>
                                    ] : []}
                                >
                                    <Space>
                                        {!obj.isDir && (
                                            <Checkbox
                                                checked={selectedKeys.includes(obj.name)}
                                                onChange={e => {
                                                    setSelectedKeys(prev =>
                                                        e.target.checked
                                                            ? [...prev, obj.name]
                                                            : prev.filter(k => k !== obj.name)
                                                    );
                                                }}
                                            />
                                        )}
                                        {obj.isDir ? <FolderOpenOutlined style={{ color: '#fbbf24' }} /> : getFileTypeTag(obj.name)}
                                        <span>{obj.name}</span>
                                        {!obj.isDir && <Typography.Text type="secondary">{formatSize(obj.size)}</Typography.Text>}
                                    </Space>
                                </List.Item>
                            )}
                        />
                    </Card>
                )}
            </Space>
        </Card>
    );
}

export default function BusinessDataPage() {
    const [data, setData] = useState<BusinessDataItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState<'resume' | 'jd' | null>(null);
    const [snapshots, setSnapshots] = useState<OntologySnapshot[]>([]);
    const [snapshotId, setSnapshotId] = useState('');
    const [generating, setGenerating] = useState(false);
    const [generatedCases, setGeneratedCases] = useState<GeneratedTestCase[]>([]);
    const [pdfDrawer, setPdfDrawer] = useState<{ open: boolean; itemId: string; filename: string }>({ open: false, itemId: '', filename: '' });
    const [resumeModal, setResumeModal] = useState<any>(null);
    const [resumeLoading, setResumeLoading] = useState(false);
    const [jdModal, setJdModal] = useState<any>(null);
    const [jdLoading, setJdLoading] = useState(false);
    const [selectedJdIds, setSelectedJdIds] = useState<string[]>([]);
    const [tagging, setTagging] = useState(false);

    const fetchData = () => {
        setLoading(true);
        api.get<ApiResponse<BusinessDataItem[]>>('/business-data/list')
            .then(r => setData(r.data.data || []))
            .catch(() => { })
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        // Auto-fix any stored resumes missing name/phone/skills/summary
        api.post('/business-data/reparse-names', {}).catch(() => { });
        api.post('/business-data/reparse-skills', {}).catch(() => { });
        fetchData();
        api.get<ApiResponse<OntologySnapshot[]>>('/ontology/snapshots')
            .then(r => setSnapshots(r.data.data || []))
            .catch(() => { });
    }, []);

    const handleResumeUpload = async (file: File) => {
        setUploading('resume');
        const form = new FormData();
        form.append('file', file);
        try {
            await api.post('/business-data/upload-resume', form);
            message.success(`简历 "${file.name}" 上传解析成功`);
            fetchData();
        } catch (e: any) {
            message.error(e?.response?.data?.detail || '简历上传失败');
        }
        setUploading(null);
        return false;
    };

    const handleJdUpload = async (file: File) => {
        setUploading('jd');
        const form = new FormData();
        form.append('file', file);
        try {
            await api.post('/business-data/upload-jd', form);
            message.success(`JD文件 "${file.name}" 解析成功`);
            fetchData();
        } catch (e: any) {
            message.error(e?.response?.data?.detail || 'JD上传失败');
        }
        setUploading(null);
        return false;
    };

    const handleDelete = async (itemId: string) => {
        try {
            await api.delete(`/business-data/${itemId}`);
            message.success('已删除');
            fetchData();
        } catch { message.error('删除失败'); }
    };

    const openResumeDetail = async (itemId: string) => {
        setResumeLoading(true);
        setResumeModal({});
        try {
            const { data: resp } = await api.get<ApiResponse<any>>(`/business-data/${itemId}`);
            setResumeModal(resp.data);
        } catch { message.error('加载详情失败'); }
        setResumeLoading(false);
    };

    const openJdDetail = async (itemId: string) => {
        setJdLoading(true);
        setJdModal({});
        try {
            const { data: resp } = await api.get<ApiResponse<any>>(`/business-data/${itemId}`);
            setJdModal(resp.data);
        } catch { message.error('加载详情失败'); }
        setJdLoading(false);
    };

    const handleGenerate = async () => {
        if (!snapshotId) { message.warning('请先选择本体快照'); return; }
        if (!data.length) { message.warning('请先上传简历或JD数据'); return; }
        setGenerating(true);
        try {
            const { data: resp } = await api.post<ApiResponse<{ generated: GeneratedTestCase[] }>>('/business-data/generate-cases', {
                snapshotId, businessDataIds: data.map(d => d.itemId),
            });
            setGeneratedCases(resp.data.generated || []);
            const count = resp.data.generated?.length || 0;
            message.success(`生成了 ${count} 条业务集成测试用例`);
            message.info('📚 已同步存入「测试用例库 → 业务数据模拟测试」，可前往查看', 4);
        } catch (e: any) { message.error(e?.response?.data?.detail || '生成测试用例失败，请检查API Key配置'); }
        setGenerating(false);
    };

    const handleBatchTagClient = async (client: '通用' | '字节' | '腾讯') => {
        if (!selectedJdIds.length) { message.warning('请先选择JD'); return; }
        setTagging(true);
        try {
            const { data: resp } = await api.patch<ApiResponse<{ updated: number }>>('/business-data/batch-tag-client', {
                itemIds: selectedJdIds,
                applicableClient: client,
            });
            message.success(`已将 ${resp.data.updated} 条JD标记为「${client}」`);
            setSelectedJdIds([]);
            fetchData();
        } catch (e: any) {
            message.error(e?.response?.data?.detail || '标记失败');
        }
        setTagging(false);
    };

    const resumes = data.filter(d => d.type === 'resume');
    const jds = data.filter(d => d.type === 'jd');
    const totalJdRecords = jds.reduce((s, j) => s + (j.recordCount ?? (j.preview as any)?.recordCount ?? 0), 0);

    // ── Resume table ────────────────────────────────────────────────
    const resumeTable = (
        resumes.length > 0 ? (
            <Table
                rowKey="itemId" size="small" loading={loading}
                pagination={{ pageSize: 8 }} dataSource={resumes}
                columns={[
                    {
                        title: '文件名', dataIndex: 'filename', width: 200, ellipsis: true,
                        render: (n: string) => <Space><FilePdfOutlined style={{ color: '#fb7185' }} />{n}</Space>,
                    },
                    {
                        title: '姓名', width: 100,
                        render: (_: any, r: BusinessDataItem) => {
                            const name = (r.preview as any)?.name;
                            return name && name !== '(未解析)' ? name : <span style={{ color: '#6b7a99' }}>—</span>;
                        },
                    },
                    {
                        title: '电话', width: 140,
                        render: (_: any, r: BusinessDataItem) => (r.preview as any)?.phone || <span style={{ color: '#6b7a99' }}>—</span>,
                    },
                    {
                        title: '技能', ellipsis: true,
                        render: (_: any, r: BusinessDataItem) => {
                            const skills = (r.preview as any)?.skills as string[] | undefined;
                            return skills?.length
                                ? skills.map(s => <Tag key={s} color="cyan" style={{ marginBottom: 2 }}>{s}</Tag>)
                                : <span style={{ color: '#6b7a99' }}>—</span>;
                        },
                    },
                    {
                        title: '摘要', ellipsis: true,
                        render: (_: any, r: BusinessDataItem) => {
                            const s = (r.preview as any)?.summary as string;
                            return s ? <span title={s}>{s}</span> : <span style={{ color: '#6b7a99' }}>—</span>;
                        },
                    },
                    {
                        title: '上传时间', dataIndex: 'uploadedAt', width: 170,
                        render: (t: string) => new Date(t).toLocaleString('zh-CN'),
                    },
                    {
                        title: '操作', width: 180, fixed: 'right' as const,
                        render: (_: any, r: BusinessDataItem) => (
                            <Space>
                                <Button size="small" icon={<EyeOutlined />}
                                    onClick={() => setPdfDrawer({ open: true, itemId: r.itemId, filename: r.filename })}>
                                    预览PDF
                                </Button>
                                <Button size="small" icon={<UserOutlined />} onClick={() => openResumeDetail(r.itemId)}>
                                    详情
                                </Button>
                                <Popconfirm title="确认删除？" onConfirm={() => handleDelete(r.itemId)}>
                                    <Button size="small" danger icon={<DeleteOutlined />} />
                                </Popconfirm>
                            </Space>
                        ),
                    },
                ]}
                scroll={{ x: 1000 }}
            />
        ) : <Empty description="暂无简历数据，请上传PDF文件" style={{ padding: 40 }} />
    );

    // ── JD table ────────────────────────────────────────────────────
    const CLIENT_COLOR: Record<string, string> = { '通用': 'blue', '字节': 'cyan', '腾讯': 'green' };
    const jdTable = (
        jds.length > 0 ? (
            <>
                {selectedJdIds.length > 0 && (
                    <div style={{ marginBottom: 12, padding: '8px 12px', background: '#111a2e', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
                        <Typography.Text>已选 <strong>{selectedJdIds.length}</strong> 条</Typography.Text>
                        <TagOutlined style={{ color: '#a78bfa' }} />
                        <Typography.Text>标记为：</Typography.Text>
                        {(['通用', '字节', '腾讯'] as const).map(c => (
                            <Button key={c} size="small" loading={tagging} onClick={() => handleBatchTagClient(c)}>
                                <Tag color={CLIENT_COLOR[c]} style={{ margin: 0 }}>{c}</Tag>
                            </Button>
                        ))}
                        <Button size="small" type="link" onClick={() => setSelectedJdIds([])}>取消选择</Button>
                    </div>
                )}
                <Table
                    rowKey="itemId" size="small" loading={loading}
                    pagination={{ pageSize: 8 }} dataSource={jds}
                    rowSelection={{
                        selectedRowKeys: selectedJdIds,
                        onChange: (keys) => setSelectedJdIds(keys as string[]),
                    }}
                    columns={[
                        {
                            title: '文件名', dataIndex: 'filename', width: 200, ellipsis: true,
                            render: (n: string) => <Space><FileTextOutlined style={{ color: '#4ade80' }} />{n}</Space>,
                        },
                        {
                            title: '适用客户', dataIndex: 'applicableClient', width: 100,
                            filters: [
                                { text: '通用', value: '通用' },
                                { text: '字节', value: '字节' },
                                { text: '腾讯', value: '腾讯' },
                            ],
                            onFilter: (value, record) => (record.applicableClient || '通用') === value,
                            render: (c: string) => {
                                const client = c || '通用';
                                return <Tag color={CLIENT_COLOR[client] || 'default'}>{client}</Tag>;
                            },
                        },
                        {
                            title: '所属部门', width: 100,
                            render: (_: any, r: BusinessDataItem) => {
                                const dept = (r as any).department || (r.preview as any)?.department || '';
                                return dept ? <Tag color="purple">{dept}</Tag> : <span style={{ color: '#6b7a99' }}>—</span>;
                            },
                            filters: [
                                { text: 'IEG', value: 'IEG' },
                                { text: 'PCG', value: 'PCG' },
                                { text: 'WXG', value: 'WXG' },
                                { text: 'CDG', value: 'CDG' },
                                { text: 'CSIG', value: 'CSIG' },
                                { text: 'TEG', value: 'TEG' },
                                { text: 'S线', value: 'S线' },
                            ],
                            onFilter: (value: any, record: any) => {
                                const dept = record.department || record.preview?.department || '';
                                return dept === value;
                            },
                        },
                        {
                            title: '字段', ellipsis: true,
                            render: (_: any, r: BusinessDataItem) => {
                                const cols: string[] = (r.preview as any)?.columns || [];
                                return cols.length > 0
                                    ? <>{cols.slice(0, 4).map(c => <Tag key={c}>{c}</Tag>)}{cols.length > 4 ? <Tag>…{cols.length}个字段</Tag> : null}</>
                                    : '—';
                            },
                        },
                        {
                            title: '记录数', width: 100,
                            render: (_: any, r: BusinessDataItem) => {
                                const cnt = r.recordCount ?? (r.preview as any)?.recordCount ?? 0;
                                return <Tag color="blue">{cnt} 条</Tag>;
                            },
                        },
                        {
                            title: '上传时间', dataIndex: 'uploadedAt', width: 170,
                            render: (t: string) => new Date(t).toLocaleString('zh-CN'),
                        },
                        {
                            title: '操作', width: 120, fixed: 'right' as const,
                            render: (_: any, r: BusinessDataItem) => (
                                <Space>
                                    <Button size="small" onClick={() => openJdDetail(r.itemId)}>查看记录</Button>
                                    <Popconfirm title="确认删除？" onConfirm={() => handleDelete(r.itemId)}>
                                        <Button size="small" danger icon={<DeleteOutlined />} />
                                    </Popconfirm>
                                </Space>
                            ),
                        },
                    ]}
                />
            </>
        ) : <Empty description="暂无JD数据，请上传CSV文件" style={{ padding: 40 }} />
    );

    // ── Tabs items (antd v5 API) ─────────────────────────────────────
    const tabItems: TabsProps['items'] = [
        {
            key: 'resume',
            label: <span><FilePdfOutlined /> 简历数据 <Tag color="magenta" style={{ marginLeft: 4 }}>{resumes.length} 份</Tag></span>,
            children: resumeTable,
        },
        {
            key: 'jd',
            label: <span><FileTextOutlined /> 招聘需求 (JD) <Tag color="green" style={{ marginLeft: 4 }}>{totalJdRecords} 条</Tag></span>,
            children: jdTable,
        },
    ];

    return (
        <div>
            <Typography.Title level={3} className="page-title">业务数据管理</Typography.Title>
            <Typography.Paragraph style={{ color: '#9ba6c7' }}>
                导入简历PDF和JD CSV（支持本地上传或从MinIO拉取），解析后与本体定义结合生成端到端测试用例
            </Typography.Paragraph>

            {/* Upload area */}
            <Row gutter={16} style={{ marginBottom: 20 }}>
                <Col xs={24} md={12}>
                    <Card title={<><FilePdfOutlined style={{ color: '#fb7185', marginRight: 8 }} />简历导入 (PDF)</>}>
                        <Dragger accept=".pdf" multiple showUploadList={false}
                            beforeUpload={handleResumeUpload} disabled={uploading === 'resume'}>
                            <p className="ant-upload-drag-icon"><InboxOutlined style={{ color: '#fb7185' }} /></p>
                            <p className="ant-upload-text">{uploading === 'resume' ? 'AI解析中...' : '点击或拖拽简历PDF上传'}</p>
                            <p className="ant-upload-hint">批量上传，AI自动提取姓名、技能、经历</p>
                        </Dragger>
                    </Card>
                </Col>
                <Col xs={24} md={12}>
                    <Card title={<><FileTextOutlined style={{ color: '#4ade80', marginRight: 8 }} />JD导入 (CSV)</>}>
                        <Dragger accept=".csv" multiple showUploadList={false}
                            beforeUpload={handleJdUpload} disabled={uploading === 'jd'}>
                            <p className="ant-upload-drag-icon"><InboxOutlined style={{ color: '#4ade80' }} /></p>
                            <p className="ant-upload-text">{uploading === 'jd' ? '解析中...' : '点击或拖拽JD CSV文件上传'}</p>
                            <p className="ant-upload-hint">支持UTF-8/GBK，自动识别多行表头</p>
                        </Dragger>
                    </Card>
                </Col>
            </Row>

            {/* MinIO Import */}
            <MinIOBusinessPanel onImported={fetchData} />

            {/* Data Tabs */}
            <Card style={{ marginBottom: 16 }}>
                <Tabs items={tabItems} />
            </Card>

            {/* Generate */}
            <Card title="生成业务集成测试用例" style={{ marginBottom: 16 }}>
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                    <Space wrap>
                        <Typography.Text strong>本体快照：</Typography.Text>
                        <Select style={{ width: 420 }} placeholder="选择本体快照"
                            value={snapshotId || undefined} onChange={setSnapshotId}
                            options={snapshots.map(s => ({
                                label: `${s.snapshotId.slice(0, 24)}… (${s.rulesCount}R/${s.dataObjectsCount}DO/${s.actionsCount}A)`,
                                value: s.snapshotId,
                            }))}
                        />
                    </Space>
                    <Space>
                        <Tag color="magenta">{resumes.length} 份简历</Tag>
                        <Tag color="green">{totalJdRecords} 条JD</Tag>
                    </Space>
                    <Button type="primary" size="large" icon={<ExperimentOutlined />}
                        loading={generating} onClick={handleGenerate}
                        disabled={!snapshotId || (!resumes.length && !jds.length)}
                        style={{ width: 240 }}>
                        生成业务集成用例
                    </Button>
                </Space>
            </Card>

            {generatedCases.length > 0 && (
                <Card title={`生成结果 (${generatedCases.length} 条)`}>
                    <Table rowKey="caseId" size="small" pagination={{ pageSize: 8 }} dataSource={generatedCases}
                        columns={[
                            { title: '用例 ID', dataIndex: 'caseId', width: 160 },
                            { title: '策略', dataIndex: 'strategy', width: 140, render: (s: string) => <Tag color="gold">{s}</Tag> },
                            { title: '优先级', dataIndex: 'priority', width: 70, render: (p: string) => <Tag color={p === 'P0' ? 'red' : p === 'P1' ? 'orange' : 'blue'}>{p}</Tag> },
                            { title: '描述', dataIndex: 'description', ellipsis: true },
                        ]}
                    />
                </Card>
            )}

            {/* PDF Preview Drawer */}
            <Drawer
                open={pdfDrawer.open}
                onClose={() => setPdfDrawer({ open: false, itemId: '', filename: '' })}
                title={<><FilePdfOutlined style={{ color: '#fb7185', marginRight: 8 }} />{pdfDrawer.filename}</>}
                width="55%"
                styles={{ body: { padding: 0 } }}
            >
                {pdfDrawer.open && (
                    <iframe
                        src={`${API_BASE}/business-data/${pdfDrawer.itemId}/file`}
                        title={pdfDrawer.filename}
                        style={{ width: '100%', height: '100%', border: 'none', minHeight: '85vh' }}
                    />
                )}
            </Drawer>

            {/* Resume Detail Modal */}
            <Modal open={!!resumeModal} onCancel={() => setResumeModal(null)} footer={null} width={760}
                title={<><UserOutlined style={{ marginRight: 8 }} />简历解析详情</>}>
                {resumeLoading
                    ? <div style={{ textAlign: 'center', padding: 40 }}><Spin size="large" /></div>
                    : resumeModal?.parsedData && (
                        <div>
                            <Descriptions size="small" column={2} bordered style={{ marginBottom: 16 }}>
                                <Descriptions.Item label="文件名" span={2}>{resumeModal.filename}</Descriptions.Item>
                                <Descriptions.Item label="姓名">{resumeModal.parsedData.name || '—'}</Descriptions.Item>
                                <Descriptions.Item label="电话">{resumeModal.parsedData.phone || '—'}</Descriptions.Item>
                                <Descriptions.Item label="邮箱">{resumeModal.parsedData.email || '—'}</Descriptions.Item>
                                <Descriptions.Item label="摘要" span={2}>{resumeModal.parsedData.summary || '—'}</Descriptions.Item>
                                <Descriptions.Item label="技能" span={2}>
                                    {resumeModal.parsedData.skills?.map((s: string) => <Tag key={s} color="cyan">{s}</Tag>) || '—'}
                                </Descriptions.Item>
                            </Descriptions>
                            {resumeModal.parsedData.education?.length > 0 && (
                                <>
                                    <Typography.Text strong style={{ display: 'block', margin: '12px 0 8px' }}>教育经历</Typography.Text>
                                    <Table size="small" pagination={false} rowKey={(_, i) => `edu-${i}`}
                                        dataSource={resumeModal.parsedData.education}
                                        columns={[
                                            { title: '学校', dataIndex: 'school' },
                                            { title: '学历', dataIndex: 'degree' },
                                            { title: '专业', dataIndex: 'major' },
                                            { title: '年份', dataIndex: 'graduationYear' },
                                        ]}
                                    />
                                </>
                            )}
                            {resumeModal.parsedData.experience?.length > 0 && (
                                <>
                                    <Typography.Text strong style={{ display: 'block', margin: '12px 0 8px' }}>工作经历</Typography.Text>
                                    <Table size="small" pagination={false} rowKey={(_, i) => `exp-${i}`}
                                        dataSource={resumeModal.parsedData.experience}
                                        columns={[
                                            { title: '公司', dataIndex: 'company' },
                                            { title: '职位', dataIndex: 'title' },
                                            { title: '开始', dataIndex: 'startDate', width: 100 },
                                            { title: '结束', dataIndex: 'endDate', width: 100 },
                                            { title: '职责', dataIndex: 'description', ellipsis: true },
                                        ]}
                                    />
                                </>
                            )}
                            {resumeModal.parsedData.rawText && (
                                <>
                                    <Divider>原始提取文本</Divider>
                                    <pre style={{ maxHeight: 260, overflow: 'auto', fontSize: 12, background: '#0a1226', padding: 12, borderRadius: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                        {resumeModal.parsedData.rawText}
                                    </pre>
                                </>
                            )}
                        </div>
                    )
                }
            </Modal>

            {/* JD Detail Modal */}
            <Modal open={!!jdModal} onCancel={() => setJdModal(null)} footer={null} width={960}
                title={<><FileTextOutlined style={{ color: '#4ade80', marginRight: 8 }} />JD记录详情</>}>
                {jdLoading
                    ? <div style={{ textAlign: 'center', padding: 40 }}><Spin size="large" /></div>
                    : jdModal?.records && (
                        <>
                            <Descriptions size="small" column={3} bordered style={{ marginBottom: 16 }}>
                                <Descriptions.Item label="文件名">{jdModal.filename}</Descriptions.Item>
                                <Descriptions.Item label="总记录"><Tag color="blue">{jdModal.recordCount} 条</Tag></Descriptions.Item>
                                <Descriptions.Item label="字段数">{jdModal.columns?.length} 个</Descriptions.Item>
                            </Descriptions>
                            <Table size="small" pagination={{ pageSize: 5 }} rowKey={(_, i) => `jd-${i}`}
                                dataSource={jdModal.records}
                                columns={(jdModal.columns || []).map((col: string) => ({
                                    title: col, dataIndex: col, ellipsis: true, width: 140,
                                }))}
                                scroll={{ x: 'max-content' }}
                            />
                        </>
                    )
                }
            </Modal>
        </div>
    );
}
