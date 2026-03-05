import { useEffect, useState } from 'react';
import {
    Typography, Card, Upload, Table, Tag, Space, Button, message, Empty,
    Descriptions, Select, Modal, Row, Col, Popconfirm, Spin, Divider, Drawer, Tabs,
} from 'antd';
import type { TabsProps } from 'antd';
import {
    FileTextOutlined, FilePdfOutlined, DeleteOutlined,
    ExperimentOutlined, InboxOutlined, EyeOutlined, UserOutlined,
} from '@ant-design/icons';
import api from '../api';
import type { ApiResponse, OntologySnapshot, BusinessDataItem, GeneratedTestCase } from '../types';

const { Dragger } = Upload;
const API_BASE = 'http://localhost:8000';

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
            message.success(`生成了 ${resp.data.generated?.length || 0} 条业务集成测试用例`);
        } catch (e: any) { message.error(e?.response?.data?.detail || '生成测试用例失败，请检查API Key配置'); }
        setGenerating(false);
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
    const jdTable = (
        jds.length > 0 ? (
            <Table
                rowKey="itemId" size="small" loading={loading}
                pagination={{ pageSize: 8 }} dataSource={jds}
                columns={[
                    {
                        title: '文件名', dataIndex: 'filename', width: 200, ellipsis: true,
                        render: (n: string) => <Space><FileTextOutlined style={{ color: '#4ade80' }} />{n}</Space>,
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
                导入简历PDF和JD CSV，解析后与本体定义结合生成端到端测试用例
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
