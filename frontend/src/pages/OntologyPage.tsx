import { useEffect, useState, useRef } from 'react';
import {
    Typography, Card, Button, Table, Tag, Space, message, Alert, Descriptions,
    Tabs, Input, Form, Switch, Spin, Checkbox, List, Badge,
} from 'antd';
import type { TabsProps } from 'antd';
import {
    UploadOutlined, DeleteOutlined, EyeOutlined, CloudDownloadOutlined,
    ApiOutlined, CheckCircleOutlined, CloseCircleOutlined,
    DatabaseOutlined, CloudServerOutlined, FolderOpenOutlined,
    SafetyCertificateOutlined, ExclamationCircleOutlined,
    WarningOutlined,
} from '@ant-design/icons';
import api from '../api';
import type { ApiResponse, OntologySnapshot, OntologySnapshotDetail, ValidationReport } from '../types';

// ── Neo4j Panel ──────────────────────────────────────────────────────────────

function Neo4jPanel({ onImported }: { onImported: () => void }) {
    const [form] = Form.useForm();
    const [testing, setTesting] = useState(false);
    const [pulling, setPulling] = useState(false);
    const [connStatus, setConnStatus] = useState<any>(null);

    const getFormValues = () => ({
        uri: form.getFieldValue('uri') || 'bolt://localhost:7687',
        username: form.getFieldValue('username') || 'neo4j',
        password: form.getFieldValue('password') || '',
        database: form.getFieldValue('database') || 'neo4j',
    });

    const handleTestConnection = async () => {
        setTesting(true);
        setConnStatus(null);
        try {
            const { data } = await api.post<ApiResponse<any>>('/import/neo4j/test-connection', getFormValues());
            setConnStatus(data.data);
            if (data.data.connected) {
                message.success(`Neo4j连接成功，共 ${data.data.nodeCount} 节点，${data.data.relationshipCount} 关系`);
            } else {
                message.error(`连接失败: ${data.data.error}`);
            }
        } catch (e: any) {
            message.error(e?.response?.data?.detail || '连接测试失败');
        }
        setTesting(false);
    };

    const handlePull = async () => {
        setPulling(true);
        try {
            const values = getFormValues();
            const { data } = await api.post<ApiResponse<any>>('/import/neo4j/pull', {
                ...values,
                description: `Neo4j导入 (${values.uri})`,
            });
            const d = data.data;
            message.success(
                `Neo4j数据导入成功！快照 ${d.snapshotId?.slice(0, 20)}… ` +
                `(Rules: ${d.rulesCount}, DO: ${d.dataObjectsCount}, Actions: ${d.actionsCount}, ` +
                `Events: ${d.eventsCount}, Links: ${d.linksCount})`
            );
            onImported();
        } catch (e: any) {
            message.error(e?.response?.data?.detail || 'Neo4j数据拉取失败');
        }
        setPulling(false);
    };

    return (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Alert type="info" showIcon message={
                <>
                    从 Neo4j 图数据库拉取节点和关系，自动映射为本体快照：
                    <strong> Rule节点→Rules</strong>、<strong>Action节点→Actions</strong>、
                    <strong>Event节点→Events</strong>、<strong>其他节点→DataObjects</strong>、
                    <strong>所有关系→Links</strong>
                </>
            } />
            <Form form={form} layout="vertical" initialValues={{
                uri: 'bolt://localhost:7687', username: 'neo4j', password: '', database: 'neo4j',
            }}>
                <Space wrap size="middle" style={{ width: '100%' }}>
                    <Form.Item label="Neo4j URI" name="uri" style={{ marginBottom: 8, minWidth: 280 }}>
                        <Input placeholder="bolt://localhost:7687" />
                    </Form.Item>
                    <Form.Item label="用户名" name="username" style={{ marginBottom: 8, minWidth: 140 }}>
                        <Input />
                    </Form.Item>
                    <Form.Item label="密码" name="password" style={{ marginBottom: 8, minWidth: 180 }}>
                        <Input.Password />
                    </Form.Item>
                    <Form.Item label="数据库" name="database" style={{ marginBottom: 8, minWidth: 140 }}>
                        <Input />
                    </Form.Item>
                </Space>
            </Form>
            <Space>
                <Button icon={<ApiOutlined />} loading={testing} onClick={handleTestConnection}>
                    测试连接
                </Button>
                <Button type="primary" icon={<CloudDownloadOutlined />}
                    loading={pulling} onClick={handlePull}
                    disabled={!connStatus?.connected}>
                    拉取图数据
                </Button>
            </Space>
            {connStatus && (
                <Card size="small" style={{ marginTop: 8 }}>
                    <Descriptions size="small" column={2} bordered>
                        <Descriptions.Item label="状态">
                            {connStatus.connected
                                ? <Tag icon={<CheckCircleOutlined />} color="success">已连接</Tag>
                                : <Tag icon={<CloseCircleOutlined />} color="error">连接失败</Tag>}
                        </Descriptions.Item>
                        {connStatus.connected && (
                            <>
                                <Descriptions.Item label="节点数">{connStatus.nodeCount}</Descriptions.Item>
                                <Descriptions.Item label="关系数">{connStatus.relationshipCount}</Descriptions.Item>
                                <Descriptions.Item label="节点标签">
                                    {connStatus.labels?.map((l: string) => <Tag key={l} color="blue">{l}</Tag>)}
                                </Descriptions.Item>
                                <Descriptions.Item label="关系类型" span={2}>
                                    {connStatus.relationshipTypes?.map((t: string) => <Tag key={t} color="orange">{t}</Tag>)}
                                </Descriptions.Item>
                            </>
                        )}
                        {!connStatus.connected && (
                            <Descriptions.Item label="错误" span={2}>
                                <Typography.Text type="danger">{connStatus.error}</Typography.Text>
                            </Descriptions.Item>
                        )}
                    </Descriptions>
                </Card>
            )}
        </Space>
    );
}

// ── MinIO Panel (for Ontology) ───────────────────────────────────────────────

function MinIOOntologyPanel({ onImported }: { onImported: () => void }) {
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
            if (d.ontologyFiles > 0) parts.push(`${d.ontologyFiles} 个本体JSON`);
            if (d.resumes > 0) parts.push(`${d.resumes} 份简历`);
            if (d.jds > 0) parts.push(`${d.jds} 个JD`);
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
        if (lower.endsWith('.json')) return <Tag color="blue">JSON</Tag>;
        if (lower.endsWith('.pdf')) return <Tag color="magenta">PDF</Tag>;
        if (lower.endsWith('.csv')) return <Tag color="green">CSV</Tag>;
        return <Tag>其他</Tag>;
    };

    return (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Alert type="info" showIcon message={
                <>
                    从 MinIO 对象存储拉取文件：
                    <strong>.json</strong> → 本体数据（dataobjects, actions, events, rules, links），
                    <strong>.pdf</strong> → 简历，<strong>.csv</strong> → 招聘需求JD
                </>
            } />
            <Form form={form} layout="vertical" initialValues={{
                endpoint: 'localhost:9000', access_key: '', secret_key: '', secure: false,
            }}>
                <Space wrap size="middle" style={{ width: '100%' }}>
                    <Form.Item label="Endpoint" name="endpoint" style={{ marginBottom: 8, minWidth: 220 }}>
                        <Input placeholder="localhost:9000" />
                    </Form.Item>
                    <Form.Item label="Access Key" name="access_key" style={{ marginBottom: 8, minWidth: 180 }}>
                        <Input />
                    </Form.Item>
                    <Form.Item label="Secret Key" name="secret_key" style={{ marginBottom: 8, minWidth: 180 }}>
                        <Input.Password />
                    </Form.Item>
                    <Form.Item label="HTTPS" name="secure" valuePropName="checked" style={{ marginBottom: 8 }}>
                        <Switch />
                    </Form.Item>
                </Space>
            </Form>
            <Space>
                <Button icon={<ApiOutlined />} loading={testing} onClick={handleTestConnection}>
                    测试连接
                </Button>
            </Space>

            {/* Bucket list */}
            {connStatus?.connected && connStatus.buckets?.length > 0 && (
                <Card size="small" title="存储桶">
                    <Space wrap>
                        {connStatus.buckets.map((b: any) => (
                            <Button key={b.name} size="small" icon={<FolderOpenOutlined />}
                                type={currentBucket === b.name ? 'primary' : 'default'}
                                onClick={() => handleBrowse(b.name)}>
                                {b.name}
                            </Button>
                        ))}
                    </Space>
                </Card>
            )}

            {/* Object browser */}
            {currentBucket && (
                <Card size="small"
                    title={<>
                        <CloudServerOutlined style={{ marginRight: 8 }} />
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
                                    拉取选中文件
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
    );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function OntologyPage() {
    const [snapshots, setSnapshots] = useState<OntologySnapshot[]>([]);
    const [uploading, setUploading] = useState(false);
    const [detail, setDetail] = useState<OntologySnapshotDetail | null>(null);
    const [validationReport, setValidationReport] = useState<ValidationReport | null>(null);
    const [validating, setValidating] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const fetchSnapshots = () => {
        api.get<ApiResponse<OntologySnapshot[]>>('/ontology/snapshots')
            .then(r => setSnapshots(r.data.data || []))
            .catch(() => message.error('加载快照失败'));
    };

    useEffect(() => { fetchSnapshots(); }, []);

    const handleUpload = async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        setUploading(true);
        let successCount = 0;
        for (let i = 0; i < files.length; i++) {
            const fd = new FormData();
            fd.append('file', files[i], files[i].name);
            try {
                await api.post('/ontology/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
                successCount++;
            } catch {
                message.error(`上传 ${files[i].name} 失败`);
            }
        }
        if (successCount > 0) message.success(`成功上传 ${successCount} 个文件`);
        setUploading(false);
        fetchSnapshots();
    };

    const handleDelete = async (id: string) => {
        try {
            await api.delete(`/ontology/snapshots/${id}`);
            message.success('已删除');
            fetchSnapshots();
            if (detail?.snapshotId === id) setDetail(null);
        } catch { message.error('删除失败'); }
    };

    const handleView = async (id: string) => {
        try {
            const { data } = await api.get<ApiResponse<OntologySnapshotDetail>>(`/ontology/snapshots/${id}`);
            setDetail(data.data);
            // Auto-load validation report
            handleValidate(id);
        } catch { message.error('加载详情失败'); }
    };

    const handleValidate = async (id: string) => {
        setValidating(true);
        try {
            const { data } = await api.get<ApiResponse<ValidationReport>>(`/ontology/snapshots/${id}/validation`);
            setValidationReport(data.data);
        } catch {
            setValidationReport(null);
        }
        setValidating(false);
    };

    const handleRevalidate = async (id: string) => {
        setValidating(true);
        try {
            const { data } = await api.post<ApiResponse<ValidationReport>>(`/ontology/snapshots/${id}/validate`);
            setValidationReport(data.data);
            message.success('校验完成');
        } catch {
            message.error('校验失败');
        }
        setValidating(false);
    };

    const importTabItems: TabsProps['items'] = [
        {
            key: 'local',
            label: <span><UploadOutlined /> 本地上传</span>,
            children: (
                <Space direction="vertical" style={{ width: '100%' }}>
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept=".json"
                        style={{ display: 'none' }}
                        onChange={e => handleUpload(e.target.files)}
                    />
                    <Button
                        type="primary"
                        icon={<UploadOutlined />}
                        loading={uploading}
                        onClick={() => fileInputRef.current?.click()}
                        size="large"
                    >
                        选择 JSON 文件上传（支持多选）
                    </Button>
                    <Alert type="info" message="提示：上传多个文件时，系统会自动将同时上传的文件合并为一个快照" showIcon />
                </Space>
            ),
        },
        {
            key: 'neo4j',
            label: <span><DatabaseOutlined /> Neo4j 拉取</span>,
            children: <Neo4jPanel onImported={fetchSnapshots} />,
        },
        {
            key: 'minio',
            label: <span><CloudServerOutlined /> MinIO 拉取</span>,
            children: <MinIOOntologyPanel onImported={fetchSnapshots} />,
        },
    ];

    return (
        <div>
            <Typography.Title level={3} className="page-title">上传与拉取</Typography.Title>
            <Typography.Paragraph style={{ color: '#9ba6c7' }}>
                上传 Ontology JSON 文件，或从 Neo4j / MinIO 拉取数据，系统将自动解析并创建快照
            </Typography.Paragraph>

            <Card title="导入数据源" style={{ marginBottom: 24 }}>
                <Tabs items={importTabItems} />
            </Card>

            <Card title={`快照列表 (${snapshots.length})`} style={{ marginBottom: 24 }}>
                <Table
                    rowKey="snapshotId"
                    dataSource={snapshots}
                    size="small"
                    pagination={{ pageSize: 5 }}
                    columns={[
                        { title: '快照 ID', dataIndex: 'snapshotId', width: 240, ellipsis: true },
                        { title: '来源', dataIndex: 'sourceFiles', render: (files: string[]) => files?.join(', ') || '-' },
                        {
                            title: '统计',
                            render: (_: any, row: OntologySnapshot) => (
                                <Space wrap>
                                    <Tag color="blue">Rules: {row.rulesCount}</Tag>
                                    <Tag color="green">DO: {row.dataObjectsCount}</Tag>
                                    <Tag color="orange">Actions: {row.actionsCount}</Tag>
                                    <Tag color="purple">Events: {row.eventsCount}</Tag>
                                    <Tag color="cyan">Links: {row.linksCount}</Tag>
                                </Space>
                            ),
                        },
                        {
                            title: '操作',
                            width: 160,
                            render: (_: any, row: OntologySnapshot) => (
                                <Space>
                                    <Button size="small" icon={<EyeOutlined />} onClick={() => handleView(row.snapshotId)}>查看</Button>
                                    <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(row.snapshotId)}>删除</Button>
                                </Space>
                            ),
                        },
                    ]}
                />
            </Card>

            {detail && (
                <Card title={`快照详情 — ${detail.snapshotId}`} style={{ marginBottom: 24 }}>
                    <Descriptions bordered size="small" column={3}>
                        <Descriptions.Item label="Rules">{detail.rulesCount}</Descriptions.Item>
                        <Descriptions.Item label="DataObjects">{detail.dataObjectsCount}</Descriptions.Item>
                        <Descriptions.Item label="Actions">{detail.actionsCount}</Descriptions.Item>
                        <Descriptions.Item label="Events">{detail.eventsCount}</Descriptions.Item>
                        <Descriptions.Item label="Links">{detail.linksCount}</Descriptions.Item>
                        <Descriptions.Item label="来源">{detail.sourceFiles?.join(', ')}</Descriptions.Item>
                    </Descriptions>
                </Card>
            )}

            {detail && (
                <Card
                    title={
                        <Space>
                            <SafetyCertificateOutlined />
                            确定性校验报告
                            {validating && <Spin size="small" />}
                        </Space>
                    }
                    extra={
                        <Button
                            size="small"
                            onClick={() => handleRevalidate(detail.snapshotId)}
                            loading={validating}
                        >
                            重新校验
                        </Button>
                    }
                >
                    {validationReport ? (
                        <Space direction="vertical" style={{ width: '100%' }} size="middle">
                            <Descriptions bordered size="small" column={4}>
                                <Descriptions.Item label="可运转">
                                    {validationReport.runnable
                                        ? <Tag icon={<CheckCircleOutlined />} color="success">是</Tag>
                                        : <Tag icon={<CloseCircleOutlined />} color="error">否</Tag>}
                                </Descriptions.Item>
                                <Descriptions.Item label="确定性校验">
                                    {validationReport.isDeterministicallyValid
                                        ? <Tag color="success">通过</Tag>
                                        : <Tag color="error">未通过</Tag>}
                                </Descriptions.Item>
                                <Descriptions.Item label="总错误数">{validationReport.totalErrors}</Descriptions.Item>
                                <Descriptions.Item label="P0阻塞项">{validationReport.blockerCount}</Descriptions.Item>
                            </Descriptions>

                            {validationReport.totalErrors > 0 && (
                                <Tabs
                                    size="small"
                                    items={Object.entries(validationReport.errorsByCategory || {})
                                        .filter(([, errs]) => errs.length > 0)
                                        .map(([cat, errs]) => ({
                                            key: cat,
                                            label: (
                                                <Badge count={errs.length} size="small" offset={[8, 0]}>
                                                    <span>{cat}</span>
                                                </Badge>
                                            ),
                                            children: (
                                                <Table
                                                    rowKey={(_, i) => `${cat}_${i}`}
                                                    dataSource={errs}
                                                    size="small"
                                                    pagination={{ pageSize: 10 }}
                                                    columns={[
                                                        {
                                                            title: '级别', dataIndex: 'severity', width: 70,
                                                            render: (s: string) => (
                                                                <Tag color={s === 'P0' ? 'red' : s === 'P1' ? 'orange' : 'default'}>
                                                                    {s === 'P0' && <ExclamationCircleOutlined style={{ marginRight: 4 }} />}
                                                                    {s === 'P1' && <WarningOutlined style={{ marginRight: 4 }} />}
                                                                    {s}
                                                                </Tag>
                                                            ),
                                                        },
                                                        { title: '错误码', dataIndex: 'code', width: 200 },
                                                        { title: '实体ID', dataIndex: 'entityId', width: 160, ellipsis: true },
                                                        { title: '说明', dataIndex: 'message' },
                                                        { title: '证据', dataIndex: 'evidence', ellipsis: true, width: 200 },
                                                    ]}
                                                />
                                            ),
                                        }))}
                                />
                            )}

                            {validationReport.totalErrors === 0 && (
                                <Alert type="success" showIcon
                                    message="本体通过全部确定性校验，无任何错误"
                                    description={`结果哈希: ${validationReport.resultHash?.slice(0, 16)}…`}
                                />
                            )}

                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                结果哈希: {validationReport.resultHash} （同一快照重复运行产出完全一致）
                            </Typography.Text>
                        </Space>
                    ) : (
                        <Alert type="info" showIcon message="点击「查看」按钮加载快照后自动执行确定性校验" />
                    )}
                </Card>
            )}
        </div>
    );
}
