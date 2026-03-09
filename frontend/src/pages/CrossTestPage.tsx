import { useEffect, useState } from 'react';
import {
    Typography, Card, Select, Button, Table, Tag, Space, message,
    Tabs, Row, Col, Statistic, Alert, Descriptions, Modal, Timeline,
} from 'antd';
import type { TabsProps } from 'antd';
import {
    SwapOutlined, UserOutlined, FileTextOutlined, PlayCircleOutlined,
    CheckCircleOutlined, CloseCircleOutlined, WarningOutlined, BugOutlined,
    AimOutlined,
} from '@ant-design/icons';
import api from '../api';
import type { ApiResponse, OntologySnapshot, BusinessDataItem, CrossTestResult, FailedNode, MatchTraceStep } from '../types';

function FailedNodePanel({ node, reasoning }: { node: FailedNode; reasoning?: string }) {
    return (
        <Card size="small" style={{ background: 'rgba(251, 113, 133, 0.08)', border: '1px solid rgba(251, 113, 133, 0.3)' }}>
            <Descriptions size="small" column={2} bordered>
                <Descriptions.Item label={<span style={{ color: '#fb7185' }}>失败规则</span>}>
                    <Tag color="red">{node.ruleName}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="失败类型">
                    <Tag color="volcano">{node.failureType || '规则不匹配'}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="规则描述" span={2}>
                    <Typography.Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                        {node.ruleDescription}
                    </Typography.Paragraph>
                </Descriptions.Item>
                {reasoning && (
                    <Descriptions.Item label={<span style={{ color: '#6366f1' }}>推理说明</span>} span={2}>
                        <Typography.Paragraph style={{ margin: 0 }}>
                            {reasoning}
                        </Typography.Paragraph>
                    </Descriptions.Item>
                )}
                {node.brokenLink && (
                    <Descriptions.Item label={<span style={{ color: '#fbbf24' }}>断裂链接</span>} span={2}>
                        <Tag color="orange">{node.brokenLink}</Tag>
                    </Descriptions.Item>
                )}
                {node.funnelStage && (
                    <Descriptions.Item label="漏斗阶段" span={2}>
                        <Tag color="purple">{node.funnelStage}</Tag>
                    </Descriptions.Item>
                )}
                {node.contextSnapshot && Object.keys(node.contextSnapshot).length > 0 && (
                    <Descriptions.Item label="上下文快照" span={2}>
                        <pre style={{ margin: 0, fontSize: 11, maxHeight: 120, overflow: 'auto' }}>
                            {JSON.stringify(node.contextSnapshot, null, 2)}
                        </pre>
                    </Descriptions.Item>
                )}
            </Descriptions>
        </Card>
    );
}

function TraceModal({ trace, visible, onClose, title }: {
    trace: MatchTraceStep[];
    visible: boolean;
    onClose: () => void;
    title: string;
}) {
    const colorMap: Record<string, string> = { pass: 'green', fail: 'red', skip: 'gray' };
    const labelMap: Record<string, string> = { pass: '通过', fail: '失败', skip: '跳过' };
    return (
        <Modal
            title={<Space><AimOutlined style={{ color: '#6366f1' }} /> 匹配追踪 — {title}</Space>}
            open={visible}
            onCancel={onClose}
            footer={null}
            width={600}
        >
            {trace.length > 0 ? (
                <Timeline
                    items={trace.map((t, i) => ({
                        color: colorMap[t.status] || 'blue',
                        children: (
                            <div key={i}>
                                <Space>
                                    <Typography.Text strong>{t.step}</Typography.Text>
                                    <Tag color={colorMap[t.status]}>{labelMap[t.status] || t.status}</Tag>
                                </Space>
                                <div style={{ color: '#9ba6c7', marginTop: 4 }}>{t.detail}</div>
                            </div>
                        ),
                    }))}
                />
            ) : (
                <Alert type="info" message="无追踪步骤数据" />
            )}
        </Modal>
    );
}

export default function CrossTestPage() {
    const [snapshots, setSnapshots] = useState<OntologySnapshot[]>([]);
    const [snapshotId, setSnapshotId] = useState('');
    const [businessData, setBusinessData] = useState<BusinessDataItem[]>([]);
    const [mode, setMode] = useState<'by_resume' | 'by_jd' | 'cross_validate'>('by_resume');

    // by_resume: select 1 resume, N jds
    const [selectedResume, setSelectedResume] = useState<string>('');
    const [selectedJds, setSelectedJds] = useState<string[]>([]);
    // by_jd: select 1 jd, N resumes
    const [selectedJd, setSelectedJd] = useState<string>('');
    const [selectedResumes, setSelectedResumes] = useState<string[]>([]);

    const [executing, setExecuting] = useState(false);
    const [result, setResult] = useState<CrossTestResult | null>(null);

    // Trace modal state
    const [traceVisible, setTraceVisible] = useState(false);
    const [traceData, setTraceData] = useState<MatchTraceStep[]>([]);
    const [traceTitle, setTraceTitle] = useState('');

    useEffect(() => {
        api.get<ApiResponse<OntologySnapshot[]>>('/ontology/snapshots')
            .then(r => {
                const snaps = r.data.data || [];
                setSnapshots(snaps);
                if (snaps.length > 0) setSnapshotId(snaps[0].snapshotId);
            }).catch(() => {});
        api.get<ApiResponse<BusinessDataItem[]>>('/business-data/list')
            .then(r => setBusinessData(r.data.data || []))
            .catch(() => {});
    }, []);

    const resumes = businessData.filter(d => d.type === 'resume');
    const jds = businessData.filter(d => d.type === 'jd');

    const handleExecute = async () => {
        if (!snapshotId) { message.warning('请选择快照'); return; }
        setExecuting(true);
        setResult(null);
        try {
            let endpoint = '';
            let payload: any = { snapshotId };

            if (mode === 'by_resume') {
                if (!selectedResume) { message.warning('请选择简历'); setExecuting(false); return; }
                if (selectedJds.length === 0) { message.warning('请至少选择一个 JD'); setExecuting(false); return; }
                endpoint = '/cross-test/by-resume';
                payload.resumeId = selectedResume;
                payload.jdIds = selectedJds;
            } else if (mode === 'by_jd') {
                if (!selectedJd) { message.warning('请选择 JD'); setExecuting(false); return; }
                if (selectedResumes.length === 0) { message.warning('请至少选择一份简历'); setExecuting(false); return; }
                endpoint = '/cross-test/by-jd';
                payload.jdId = selectedJd;
                payload.resumeIds = selectedResumes;
            } else {
                endpoint = '/cross-test/cross-validate';
                payload.resumeIds = selectedResumes.length > 0 ? selectedResumes : resumes.map(r => r.itemId);
                payload.jdIds = selectedJds.length > 0 ? selectedJds : jds.map(j => j.itemId);
            }

            const { data } = await api.post<ApiResponse<CrossTestResult>>(endpoint, payload);
            setResult(data.data);
            const results = data.data.results || [];
            const passed = results.filter(r => r.verdict === 'PASS').length;
            const failed = results.filter(r => r.verdict === 'FAIL').length;
            const errs = results.filter(r => r.verdict === 'ERROR').length;
            let msg = `交叉测试完成：${passed} 通过 / ${failed} 失败`;
            if (errs > 0) msg += ` / ${errs} 错误`;
            message.success(msg);
        } catch (e: any) {
            message.error(e?.response?.data?.detail || '交叉测试失败');
        }
        setExecuting(false);
    };

    const openTrace = (row: any) => {
        setTraceData(row.matchTrace || []);
        setTraceTitle(`${row.resumeName} ↔ ${row.jdTitle}`);
        setTraceVisible(true);
    };

    const tabItems: TabsProps['items'] = [
        {
            key: 'by_resume',
            label: <span><UserOutlined /> 按简历 (1 对 N 个 JD)</span>,
            children: (
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                    <div>
                        <Typography.Text strong>选择简历：</Typography.Text>
                        <Select
                            style={{ width: '100%', marginTop: 4 }}
                            placeholder="选择 1 份简历"
                            value={selectedResume || undefined}
                            onChange={setSelectedResume}
                            options={resumes.map(r => ({
                                label: `${(r.preview as any)?.name || r.filename}`,
                                value: r.itemId,
                            }))}
                        />
                    </div>
                    <div>
                        <Typography.Text strong>选择 JD（多选）：</Typography.Text>
                        <Select
                            mode="multiple"
                            style={{ width: '100%', marginTop: 4 }}
                            placeholder="选择要匹配的 JD"
                            value={selectedJds}
                            onChange={setSelectedJds}
                            options={jds.map(j => ({
                                label: `${j.filename} (${(j.preview as any)?.recordCount || 0} 条记录)`,
                                value: j.itemId,
                            }))}
                        />
                    </div>
                </Space>
            ),
        },
        {
            key: 'by_jd',
            label: <span><FileTextOutlined /> 按 JD (1 对 N 份简历)</span>,
            children: (
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                    <div>
                        <Typography.Text strong>选择 JD：</Typography.Text>
                        <Select
                            style={{ width: '100%', marginTop: 4 }}
                            placeholder="选择 1 个 JD"
                            value={selectedJd || undefined}
                            onChange={setSelectedJd}
                            options={jds.map(j => ({
                                label: `${j.filename} (${(j.preview as any)?.recordCount || 0} 条记录)`,
                                value: j.itemId,
                            }))}
                        />
                    </div>
                    <div>
                        <Typography.Text strong>选择简历（多选）：</Typography.Text>
                        <Select
                            mode="multiple"
                            style={{ width: '100%', marginTop: 4 }}
                            placeholder="选择要匹配的简历"
                            value={selectedResumes}
                            onChange={setSelectedResumes}
                            options={resumes.map(r => ({
                                label: `${(r.preview as any)?.name || r.filename}`,
                                value: r.itemId,
                            }))}
                        />
                    </div>
                </Space>
            ),
        },
        {
            key: 'cross_validate',
            label: <span><SwapOutlined /> 交叉验证 (N × M)</span>,
            children: (
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                    <Alert type="info" showIcon message="交叉验证将测试所有选定简历与所有选定 JD 的矩阵匹配。留空则使用全部可用数据。" />
                    <Row gutter={16}>
                        <Col span={12}>
                            <Typography.Text strong>简历（可选筛选）：</Typography.Text>
                            <Select
                                mode="multiple"
                                style={{ width: '100%', marginTop: 4 }}
                                placeholder={`全部 ${resumes.length} 份简历`}
                                value={selectedResumes}
                                onChange={setSelectedResumes}
                                options={resumes.map(r => ({
                                    label: `${(r.preview as any)?.name || r.filename}`,
                                    value: r.itemId,
                                }))}
                            />
                        </Col>
                        <Col span={12}>
                            <Typography.Text strong>JD（可选筛选）：</Typography.Text>
                            <Select
                                mode="multiple"
                                style={{ width: '100%', marginTop: 4 }}
                                placeholder={`全部 ${jds.length} 个 JD`}
                                value={selectedJds}
                                onChange={setSelectedJds}
                                options={jds.map(j => ({
                                    label: `${j.filename}`,
                                    value: j.itemId,
                                }))}
                            />
                        </Col>
                    </Row>
                </Space>
            ),
        },
    ];

    const resultRows = result?.results || [];
    const passed = resultRows.filter(r => r.verdict === 'PASS').length;
    const failed = resultRows.filter(r => r.verdict === 'FAIL').length;
    const warnings = resultRows.filter(r => r.verdict === 'WARNING').length;
    const errors = resultRows.filter(r => r.verdict === 'ERROR').length;

    return (
        <div>
            <Typography.Title level={3} className="page-title">交叉测试</Typography.Title>
            <Typography.Paragraph style={{ color: '#9ba6c7' }}>
                从多角度测试简历与 JD 的匹配：按简历、按 JD 或交叉验证矩阵
            </Typography.Paragraph>

            {/* Config */}
            <Card style={{ marginBottom: 16 }}>
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                    <Space wrap>
                        <Typography.Text strong>本体快照：</Typography.Text>
                        <Select
                            style={{ width: 420 }}
                            placeholder="选择快照"
                            value={snapshotId || undefined}
                            onChange={setSnapshotId}
                            options={snapshots.map(s => ({
                                label: `[快照] 规则:${s.rulesCount} | 数据对象:${s.dataObjectsCount} | 动作:${s.actionsCount}`,
                                value: s.snapshotId,
                            }))}
                        />
                    </Space>

                    <Tabs
                        activeKey={mode}
                        onChange={k => setMode(k as any)}
                        items={tabItems}
                    />

                    <Button
                        type="primary" size="large" icon={<PlayCircleOutlined />}
                        loading={executing} onClick={handleExecute}
                        disabled={!snapshotId}
                        style={{ background: 'linear-gradient(135deg, #a78bfa, #6366f1)', border: 'none', minWidth: 180 }}
                    >
                        {executing ? '交叉测试执行中...' : '执行交叉测试'}
                    </Button>
                </Space>
            </Card>

            {/* Results */}
            {result && (
                <Card
                    title={<Space><SwapOutlined style={{ color: '#a78bfa' }} /><span>交叉测试结果</span><Tag color="processing">{mode}</Tag></Space>}
                    style={{ marginBottom: 16 }}
                >
                    {errors > 0 && (
                        <Alert
                            type="error" showIcon
                            message="部分测试出现错误"
                            description="LLM 服务可能不可用，请检查 API Key 配置。错误的测试结果标记为红色 ERROR 标签。"
                            style={{ marginBottom: 16 }}
                        />
                    )}
                    <Row gutter={16} style={{ marginBottom: 16 }}>
                        <Col span={6}><Statistic title="总计" value={resultRows.length} valueStyle={{ color: '#9ba6c7' }} /></Col>
                        <Col span={6}><Statistic title="通过" value={passed} valueStyle={{ color: '#4ade80' }} prefix={<CheckCircleOutlined />} /></Col>
                        <Col span={6}><Statistic title="失败" value={failed} valueStyle={{ color: '#fb7185' }} prefix={<CloseCircleOutlined />} /></Col>
                        <Col span={6}><Statistic title="警告" value={warnings} valueStyle={{ color: '#fbbf24' }} prefix={<WarningOutlined />} /></Col>
                    </Row>

                    <Table
                        rowKey={(_, i) => `ct-${i}`}
                        size="small"
                        pagination={{ pageSize: 15 }}
                        dataSource={resultRows}
                        columns={[
                            { title: '简历', dataIndex: 'resumeName', width: 120, ellipsis: true },
                            { title: 'JD', dataIndex: 'jdTitle', width: 150, ellipsis: true },
                            {
                                title: '判定结果', dataIndex: 'verdict', width: 100,
                                render: (v: string) => (
                                    <Tag color={v === 'PASS' ? 'green' : v === 'FAIL' ? 'red' : v === 'ERROR' ? 'magenta' : 'orange'}>{v}</Tag>
                                ),
                            },
                            {
                                title: '触发规则', dataIndex: 'triggeredRules', width: 200,
                                render: (rules: string[]) => rules?.slice(0, 3).map(r => <Tag key={r} color="volcano" style={{ marginBottom: 2 }}>{r}</Tag>) || '-',
                            },
                            { title: '推理说明', dataIndex: 'reasoning', ellipsis: true },
                            {
                                title: '追踪', width: 80,
                                render: (_: any, row: any) => (row.failedNode || (row.matchTrace && row.matchTrace.length > 0)) ? (
                                    <Tag
                                        color="red"
                                        icon={<AimOutlined />}
                                        style={{ cursor: 'pointer' }}
                                        onClick={(e) => { e.stopPropagation(); openTrace(row); }}
                                    >
                                        追踪
                                    </Tag>
                                ) : null,
                            },
                        ]}
                        expandable={{
                            expandedRowRender: (row: any) => row.failedNode ? (
                                <FailedNodePanel node={row.failedNode} reasoning={row.reasoning} />
                            ) : (
                                <Typography.Text type="secondary">通过的测试无调试追踪信息</Typography.Text>
                            ),
                            rowExpandable: (row: any) => !!row.failedNode,
                        }}
                    />
                </Card>
            )}

            {!result && !executing && (
                <Alert type="info" showIcon
                    message="选择数据并运行交叉测试以查看带有调试追踪的结果"
                    style={{ marginTop: 8 }}
                />
            )}

            <TraceModal
                trace={traceData}
                visible={traceVisible}
                onClose={() => setTraceVisible(false)}
                title={traceTitle}
            />
        </div>
    );
}
