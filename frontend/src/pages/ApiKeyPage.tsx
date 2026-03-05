import { useEffect, useState } from 'react';
import {
    Typography, Card, Table, Tag, Space, Button, message, Modal, Input,
    Select, Popconfirm, Switch, Descriptions, Alert, AutoComplete,
} from 'antd';
import {
    KeyOutlined, PlusOutlined, DeleteOutlined, ApiOutlined,
    CheckCircleOutlined, CloseCircleOutlined, QuestionCircleOutlined,
    ThunderboltOutlined,
} from '@ant-design/icons';
import api from '../api';
import type { ApiResponse, ApiKeyItem } from '../types';

export default function ApiKeyPage() {
    const [keys, setKeys] = useState<ApiKeyItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [addModalOpen, setAddModalOpen] = useState(false);
    const [newProvider, setNewProvider] = useState('gemini');
    const [newLabel, setNewLabel] = useState('');
    const [newKey, setNewKey] = useState('');
    const [adding, setAdding] = useState(false);
    const [testingId, setTestingId] = useState('');
    const [testResult, setTestResult] = useState<any>(null);
    const [newModel, setNewModel] = useState('gemini-3.0-flash');
    const [newBaseUrl, setNewBaseUrl] = useState('');

    const fetchKeys = () => {
        setLoading(true);
        api.get<ApiResponse<ApiKeyItem[]>>('/api-keys')
            .then(r => setKeys(r.data.data || []))
            .catch(() => { })
            .finally(() => setLoading(false));
    };

    useEffect(() => { fetchKeys(); }, []);

    const handleAdd = async () => {
        if (!newKey.trim()) { message.warning('请输入API Key'); return; }
        setAdding(true);
        try {
            await api.post('/api-keys', {
                provider: newProvider,
                label: newLabel,
                key: newKey.trim(),
                model: newModel.trim() || 'gemini-3.0-flash',
                baseUrl: newProvider === 'custom' ? newBaseUrl.trim() : undefined,
            });
            message.success('API Key 添加成功');
            setAddModalOpen(false);
            setNewKey('');
            setNewLabel('');
            setNewModel('gemini-3.0-flash');
            setNewBaseUrl('');
            fetchKeys();
        } catch (e: any) {
            message.error(e?.response?.data?.detail || '添加失败');
        }
        setAdding(false);
    };

    const handleDelete = async (keyId: string) => {
        try {
            await api.delete(`/api-keys/${keyId}`);
            message.success('已删除');
            fetchKeys();
        } catch { message.error('删除失败'); }
    };

    const handleTest = async (keyId: string) => {
        setTestingId(keyId);
        setTestResult(null);
        try {
            const { data: resp } = await api.post<ApiResponse<any>>(`/api-keys/${keyId}/test`);
            setTestResult({ keyId, ...resp.data });
            if (resp.data.success) {
                message.success(`Key 验证成功 (${resp.data.latencyMs}ms)`);
            } else {
                message.error(`Key 验证失败: ${resp.data.error}`);
            }
            fetchKeys();
        } catch { message.error('测试请求失败'); }
        setTestingId('');
    };

    const handleToggle = async (keyId: string) => {
        try {
            await api.post(`/api-keys/${keyId}/toggle`);
            fetchKeys();
        } catch { message.error('切换状态失败'); }
    };

    const statusIcon = (status: string) => {
        if (status === 'valid') return <CheckCircleOutlined style={{ color: '#4ade80' }} />;
        if (status === 'invalid') return <CloseCircleOutlined style={{ color: '#fb7185' }} />;
        return <QuestionCircleOutlined style={{ color: '#fbbf24' }} />;
    };

    return (
        <div>
            <Typography.Title level={3} className="page-title">API Key 管理</Typography.Title>
            <Typography.Paragraph style={{ color: '#9ba6c7' }}>
                管理大模型API Key，支持添加、删除、验证连通性和切换活跃状态
            </Typography.Paragraph>

            <Card
                title={<><KeyOutlined style={{ marginRight: 8 }} />API Keys ({keys.length})</>}
                extra={
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddModalOpen(true)}>
                        添加 Key
                    </Button>
                }
                style={{ marginBottom: 16 }}
            >
                <Table
                    rowKey="keyId"
                    size="small"
                    loading={loading}
                    pagination={false}
                    dataSource={keys}
                    columns={[
                        {
                            title: '提供商', dataIndex: 'provider', width: 120,
                            render: (p: string) => (
                                <Tag color={p === 'gemini' ? 'blue' : p === 'openai' ? 'green' : 'default'}>
                                    {p.toUpperCase()}
                                </Tag>
                            ),
                        },
                        { title: '标签', dataIndex: 'label', width: 150 },
                        {
                            title: '接口地址', dataIndex: 'baseUrl', width: 180, ellipsis: true,
                            render: (url: string, r: ApiKeyItem) =>
                                r.provider === 'custom' && url
                                    ? <Typography.Text type="secondary" title={url} style={{ fontSize: 12 }}>{url}</Typography.Text>
                                    : <span style={{ color: '#4a5580' }}>—</span>,
                        },
                        {
                            title: '模型', dataIndex: 'model', width: 170,
                            render: (m: string) => <Tag color="purple">{m || 'gemini-3.0-flash'}</Tag>,
                        },
                        {
                            title: 'Key', dataIndex: 'maskedKey', width: 260,
                            render: (k: string) => <Typography.Text code copyable={{ text: k }}>{k}</Typography.Text>,
                        },
                        {
                            title: '状态', dataIndex: 'status', width: 100,
                            render: (s: string) => (
                                <Space>{statusIcon(s)}<span>{s === 'valid' ? '有效' : s === 'invalid' ? '无效' : '未测试'}</span></Space>
                            ),
                        },
                        {
                            title: '启用', dataIndex: 'isActive', width: 80,
                            render: (active: boolean, r: ApiKeyItem) => (
                                <Switch size="small" checked={active} onChange={() => handleToggle(r.keyId)} />
                            ),
                        },
                        {
                            title: '最后测试', dataIndex: 'lastTestedAt', width: 180,
                            render: (t: string | null) => t ? new Date(t).toLocaleString('zh-CN') : '-',
                        },
                        {
                            title: '操作', width: 180,
                            render: (_: any, r: ApiKeyItem) => (
                                <Space>
                                    <Button
                                        size="small"
                                        icon={<ThunderboltOutlined />}
                                        loading={testingId === r.keyId}
                                        onClick={() => handleTest(r.keyId)}
                                    >
                                        测试
                                    </Button>
                                    <Popconfirm title="确认删除此Key？" onConfirm={() => handleDelete(r.keyId)}>
                                        <Button size="small" danger icon={<DeleteOutlined />} />
                                    </Popconfirm>
                                </Space>
                            ),
                        },
                    ]}
                    locale={{ emptyText: <Empty description="暂无API Key，点击「添加 Key」按钮添加" /> }}
                />
            </Card>

            {testResult && (
                <Card title="测试结果" style={{ marginBottom: 16 }}>
                    <Alert
                        type={testResult.success ? 'success' : 'error'}
                        showIcon
                        message={testResult.success ? `验证成功` : '验证失败'}
                        description={
                            <Descriptions size="small" column={1} style={{ marginTop: 8 }}>
                                {testResult.success && (
                                    <Descriptions.Item label="LLM响应">{testResult.response}</Descriptions.Item>
                                )}
                                {!testResult.success && (
                                    <Descriptions.Item label="错误信息">{testResult.error}</Descriptions.Item>
                                )}
                                {testResult.model && (
                                    <Descriptions.Item label="使用模型"><Tag color="purple">{testResult.model}</Tag></Descriptions.Item>
                                )}
                                <Descriptions.Item label="延迟">{testResult.latencyMs} ms</Descriptions.Item>
                            </Descriptions>
                        }
                    />
                </Card>
            )}

            <Card title="使用说明" style={{ opacity: 0.8 }}>
                <Typography.Paragraph>
                    <ol style={{ paddingLeft: 20 }}>
                        <li>点击<strong>「添加 Key」</strong>按钮输入你的大模型API Key（当前支持 Gemini、OpenAI 等）</li>
                        <li>添加后点击<strong>「测试」</strong>按钮验证Key是否有效（会发起一次简短的LLM调用）</li>
                        <li>使用<strong>启用/禁用开关</strong>控制哪些Key参与测试用例生成</li>
                        <li>启用的Key将优先于环境变量中配置的Key被使用</li>
                        <li>系统支持多Key轮询，当一个Key失败时自动切换到下一个</li>
                    </ol>
                </Typography.Paragraph>
            </Card>

            {/* Add Key Modal */}
            <Modal
                open={addModalOpen}
                onCancel={() => { setAddModalOpen(false); setNewKey(''); setNewLabel(''); setNewModel('gemini-3.0-flash'); setNewBaseUrl(''); setNewProvider('gemini'); }}
                onOk={handleAdd}
                confirmLoading={adding}
                title="添加 API Key"
                okText="添加"
                cancelText="取消"
            >
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                    <div>
                        <Typography.Text>提供商</Typography.Text>
                        <Select
                            style={{ width: '100%', marginTop: 4 }}
                            value={newProvider}
                            onChange={v => { setNewProvider(v); if (v !== 'custom') setNewBaseUrl(''); }}
                            options={[
                                { label: 'Google Gemini', value: 'gemini' },
                                { label: 'OpenAI (GPT)', value: 'openai' },
                                { label: 'Anthropic (Claude)', value: 'anthropic' },
                                { label: '自定义', value: 'custom' },
                            ]}
                        />
                    </div>
                    {newProvider === 'custom' && (
                        <div>
                            <Typography.Text>接口地址（URL）</Typography.Text>
                            <Input
                                style={{ marginTop: 4 }}
                                placeholder="例：https://api.example.com/v1"
                                value={newBaseUrl}
                                onChange={e => setNewBaseUrl(e.target.value)}
                                allowClear
                            />
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                兼容 OpenAI 格式的自定义中转服务接口地址
                            </Typography.Text>
                        </div>
                    )}
                    <div>
                        <Typography.Text>模型名称</Typography.Text>
                        <AutoComplete
                            style={{ width: '100%', marginTop: 4 }}
                            value={newModel}
                            onChange={setNewModel}
                            placeholder="选择预设模型，或直接输入自定义模型名"
                            options={[
                                { label: 'gemini-3.0-flash（推荐）', value: 'gemini-3.0-flash' },
                                { label: 'gemini-3.0-pro', value: 'gemini-3.0-pro' },
                                { label: 'gemini-2.0-flash', value: 'gemini-2.0-flash' },
                                { label: 'gemini-2.0-flash-lite', value: 'gemini-2.0-flash-lite' },
                                { label: 'gemini-2.0-flash-exp', value: 'gemini-2.0-flash-exp' },
                                { label: 'gemini-1.5-flash', value: 'gemini-1.5-flash' },
                                { label: 'gemini-1.5-pro', value: 'gemini-1.5-pro' },
                                { label: 'gpt-4o', value: 'gpt-4o' },
                                { label: 'gpt-4o-mini', value: 'gpt-4o-mini' },
                                { label: 'gpt-4-turbo', value: 'gpt-4-turbo' },
                                { label: 'claude-3-5-sonnet-20241022', value: 'claude-3-5-sonnet-20241022' },
                                { label: 'deepseek-chat', value: 'deepseek-chat' },
                            ]}
                            filterOption={(input, option) =>
                                (option?.value ?? '').toLowerCase().includes(input.toLowerCase())
                            }
                            allowClear
                        />
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            gemini-3.0-flash 速度快、成本低；gemini-3.0-pro 能力更强
                        </Typography.Text>
                    </div>
                    <div>
                        <Typography.Text>标签（可选）</Typography.Text>
                        <Input
                            style={{ marginTop: 4 }}
                            placeholder="例：团队共享Key、测试Key"
                            value={newLabel}
                            onChange={e => setNewLabel(e.target.value)}
                        />
                    </div>
                    <div>
                        <Typography.Text>API Key</Typography.Text>
                        <Input.Password
                            style={{ marginTop: 4 }}
                            placeholder="输入API Key"
                            value={newKey}
                            onChange={e => setNewKey(e.target.value)}
                        />
                    </div>
                </Space>
            </Modal>
        </div>
    );
}

function Empty({ description }: { description: string }) {
    return (
        <div style={{ textAlign: 'center', padding: 24, color: '#9ba6c7' }}>
            <ApiOutlined style={{ fontSize: 32, marginBottom: 8 }} />
            <div>{description}</div>
        </div>
    );
}
