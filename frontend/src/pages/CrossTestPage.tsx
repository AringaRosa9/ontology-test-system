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
        <Card size="small" style={{ background: 'rgba(251, 113, 133, 0.08)', border: '1px solid rgba(251, 113, 133, 0.3)' }}>
            <Space direction="vertical" style={{ width: '100%' }} size="small">
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
                {reasoning && (
                    <div>
                        <Typography.Text type="secondary" style={{ color: '#6366f1' }}>推理说明：</Typography.Text>
                        <Typography.Paragraph style={{ margin: 0 }}>{reasoning}</Typography.Paragraph>
                    </div>
                )}
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
            label: <span><SwapOutlined /> 多对多测试 (N × M)</span>,
            children: (
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                    <Alert type="info" showIcon message="多对多测试将测试所有选定简历与所有选定 JD 的矩阵匹配。留空则使用全部可用数据。" />
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

    const resultRows = (result?.results || []).slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
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
                                title: '评分', dataIndex: 'score', width: 80,
                                sorter: (a: any, b: any) => (a.score ?? 0) - (b.score ?? 0),
                                defaultSortOrder: 'descend' as const,
                                render: (s: number) => (
                                    <Typography.Text strong style={{ color: s >= 80 ? '#4ade80' : s >= 60 ? '#fbbf24' : '#fb7185' }}>
                                        {s ?? '-'}
                                    </Typography.Text>
                                ),
                            },
                            {
                                title: '触发规则', dataIndex: 'triggeredRules', width: 200,
                                render: (rules: string[]) => rules?.map(r => <Tag key={r} color="volcano" style={{ marginBottom: 2 }}>{r}</Tag>) || '-',
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
