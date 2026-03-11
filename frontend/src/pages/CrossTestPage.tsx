import { useEffect, useState } from 'react';
import {
    Typography, Card, Select, Button, Table, Tag, Space, App,
    Tabs, Row, Col, Statistic, Alert, Descriptions, Modal, Collapse, Tooltip,
} from 'antd';
import type { TabsProps } from 'antd';
import {
    SwapOutlined, UserOutlined, FileTextOutlined, PlayCircleOutlined,
    CheckCircleOutlined, CloseCircleOutlined, WarningOutlined,
    AimOutlined, RightOutlined, DownOutlined,
} from '@ant-design/icons';
import api from '../api';
import type {
    ApiResponse, OntologySnapshot, BusinessDataItem, CrossTestResult,
    FailedNode, StepTraceItem, StepRuleResult,
} from '../types';

/* ── Action name → Chinese label mapping ── */
const ACTION_LABELS: Record<string, string> = {
    processResume: '简历处理',
    matchResume: '简历匹配',
    analyzeRequirement: '需求分析',
};

const STATUS_COLOR: Record<string, string> = {
    pass: 'green', fail: 'red', skip: 'default', terminated: 'magenta', error: 'orange',
};
const STATUS_LABEL: Record<string, string> = {
    pass: '通过', fail: '失败', skip: '跳过', terminated: '终止', error: '错误',
};

/* ── FailedNodePanel: display failure details with Action/Step location ── */
function FailedNodePanel({ node, reasoning }: { node: FailedNode; reasoning?: string }) {
    const entities = (node.relatedEntities || '').split('\n').filter((e: string) => e.trim());

    return (
        <Card size="small" style={{ background: 'rgba(251, 113, 133, 0.08)', border: '1px solid rgba(251, 113, 133, 0.3)' }}>
            <Space orientation="vertical" style={{ width: '100%' }} size="small">
                <Row gutter={16}>
                    {node.actionName && (
                        <Col>
                            <Typography.Text type="secondary">失败位置：</Typography.Text>
                            <Tag color="geekblue">
                                {ACTION_LABELS[node.actionName] || node.actionName}
                                {node.stepName ? ` / ${node.stepName}` : ''}
                            </Tag>
                        </Col>
                    )}
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
                <Descriptions
                    bordered size="small"
                    column={{ xxl: 3, xl: 3, lg: 2, md: 2, sm: 1, xs: 1 }}
                    style={{ marginTop: 4 }}
                    title={<Typography.Text type="secondary" strong>失败规则</Typography.Text>}
                >
                    <Descriptions.Item label="规则ID">{node.id || '—'}</Descriptions.Item>
                    <Descriptions.Item label="场景阶段">{node.specificScenarioStage || '—'}</Descriptions.Item>
                    <Descriptions.Item label="规则名称">{node.businessLogicRuleName || node.ruleName || '—'}</Descriptions.Item>
                    <Descriptions.Item label="适用客户">{node.applicableClient || '—'}</Descriptions.Item>
                    <Descriptions.Item label="适用部门">{node.applicableDepartment || '—'}</Descriptions.Item>
                    <Descriptions.Item label="关联实体">
                        {entities.length > 0
                            ? entities.map((e: string, i: number) => <Tag key={i} color="blue" style={{ marginBottom: 2 }}>{e.trim()}</Tag>)
                            : '—'}
                    </Descriptions.Item>
                    <Descriptions.Item label="规则详情" span={3}>
                        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {node.standardizedLogicRule || node.ruleDescription || '—'}
                        </div>
                    </Descriptions.Item>
                </Descriptions>
            </Space>
        </Card>
    );
}

/* ── Rule result row inside a step ── */
function RuleResultTag({ rule }: { rule: StepRuleResult }) {
    const color = STATUS_COLOR[rule.status] || 'default';
    return (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <Tag color={color} style={{ flexShrink: 0, marginTop: 2 }}>
                {rule.ruleId} {STATUS_LABEL[rule.status] || rule.status}
            </Tag>
            {rule.terminateFlow && <Tag color="magenta" style={{ flexShrink: 0, marginTop: 2 }}>终止</Tag>}
            <Typography.Text style={{ color: '#b0b8d0', fontSize: 13 }}>{rule.detail}</Typography.Text>
        </div>
    );
}

/* ── StepTraceModal: Action → Step → Rule hierarchy view ── */
function StepTraceModal({ stepTrace, visible, onClose, title }: {
    stepTrace: StepTraceItem[];
    visible: boolean;
    onClose: () => void;
    title: string;
}) {
    // Group steps by action
    const actionGroups: { actionId: string; actionName: string; steps: StepTraceItem[] }[] = [];
    for (const st of stepTrace) {
        const last = actionGroups[actionGroups.length - 1];
        if (last && last.actionId === st.actionId) {
            last.steps.push(st);
        } else {
            actionGroups.push({ actionId: st.actionId, actionName: st.actionName, steps: [st] });
        }
    }

    return (
        <Modal
            title={<Space><AimOutlined style={{ color: '#6366f1' }} /> Action-Step-Rule 执行链路 — {title}</Space>}
            open={visible}
            onCancel={onClose}
            footer={null}
            width={780}
            styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
        >
            {actionGroups.length > 0 ? (
                <Collapse
                    defaultActiveKey={actionGroups.map(a => a.actionId)}
                    expandIcon={({ isActive }) => isActive ? <DownOutlined /> : <RightOutlined />}
                    style={{ background: 'transparent' }}
                    items={actionGroups.map(ag => {
                        const actionLabel = ACTION_LABELS[ag.actionName] || ag.actionName;
                        const hasFailInAction = ag.steps.some(s => ['fail', 'terminated'].includes(s.stepStatus || ''));
                        return {
                            key: ag.actionId,
                            label: (
                                <Space>
                                    <Tag color={hasFailInAction ? 'red' : 'green'}>Action {ag.actionId}</Tag>
                                    <Typography.Text strong>{actionLabel}</Typography.Text>
                                    <Typography.Text type="secondary">({ag.actionName})</Typography.Text>
                                </Space>
                            ),
                            children: (
                                <Collapse
                                    size="small"
                                    defaultActiveKey={ag.steps.filter(s => s.stepStatus !== 'skip').map(s => s.stepName)}
                                    items={ag.steps.map(step => {
                                        const stepStatus = step.stepStatus || '';
                                        const passCount = step.rules.filter(r => r.status === 'pass').length;
                                        const failCount = step.rules.filter(r => r.status === 'fail').length;
                                        const skipCount = step.rules.filter(r => r.status === 'skip').length;
                                        return {
                                            key: step.stepName,
                                            label: (
                                                <Space>
                                                    <Tag color={STATUS_COLOR[stepStatus] || 'default'}>
                                                        Step {step.stepOrder}
                                                    </Tag>
                                                    <Typography.Text strong>{step.stepName}</Typography.Text>
                                                    <Tag color={STATUS_COLOR[stepStatus] || 'default'}>
                                                        {STATUS_LABEL[stepStatus] || stepStatus}
                                                    </Tag>
                                                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                                        {passCount > 0 && `${passCount}通过 `}
                                                        {failCount > 0 && `${failCount}失败 `}
                                                        {skipCount > 0 && `${skipCount}跳过`}
                                                    </Typography.Text>
                                                </Space>
                                            ),
                                            children: (
                                                <div>
                                                    {step.stepDescription && (
                                                        <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: '0 0 8px' }}>
                                                            {step.stepDescription}
                                                        </Typography.Paragraph>
                                                    )}
                                                    {step.rules.map((rule, ri) => (
                                                        <RuleResultTag key={ri} rule={rule} />
                                                    ))}
                                                    {step.stepSummary && (
                                                        <div style={{ marginTop: 8, padding: '4px 8px', background: 'rgba(99,102,241,0.08)', borderRadius: 4 }}>
                                                            <Typography.Text style={{ color: '#a78bfa', fontSize: 12 }}>
                                                                {step.stepSummary}
                                                            </Typography.Text>
                                                        </div>
                                                    )}
                                                    {step.candidateStatusUpdates && step.candidateStatusUpdates.length > 0 && (
                                                        <div style={{ marginTop: 4 }}>
                                                            {step.candidateStatusUpdates.map((s, si) => (
                                                                <Tag key={si} color="warning" style={{ marginTop: 2 }}>{s}</Tag>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            ),
                                        };
                                    })}
                                />
                            ),
                        };
                    })}
                />
            ) : (
                <Alert type="info" title="无 Action-Step-Rule 执行链路数据" />
            )}
        </Modal>
    );
}

/* ── Main CrossTestPage ── */
export default function CrossTestPage() {
    const { message } = App.useApp();
    const [snapshots, setSnapshots] = useState<OntologySnapshot[]>([]);
    const [snapshotId, setSnapshotId] = useState('');
    const [businessData, setBusinessData] = useState<BusinessDataItem[]>([]);
    const [mode, setMode] = useState<'by_resume' | 'by_jd' | 'cross_validate'>('by_resume');

    const [selectedResume, setSelectedResume] = useState<string>('');
    const [selectedJds, setSelectedJds] = useState<string[]>([]);
    const [selectedJd, setSelectedJd] = useState<string>('');
    const [selectedResumes, setSelectedResumes] = useState<string[]>([]);

    const [executing, setExecuting] = useState(false);
    const [result, setResult] = useState<CrossTestResult | null>(null);

    // Step trace modal
    const [traceVisible, setTraceVisible] = useState(false);
    const [traceData, setTraceData] = useState<StepTraceItem[]>([]);
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
            if (e.code === 'ECONNABORTED' || e.message?.includes('timeout')) {
                message.error('交叉测试请求超时，请减少测试对象数量后重试');
            } else {
                message.error(e?.response?.data?.detail || '交叉测试执行失败，请检查后端服务');
            }
        }
        setExecuting(false);
    };

    const openTrace = (row: any) => {
        setTraceData(row.stepTrace && row.stepTrace.length > 0 ? row.stepTrace : []);
        setTraceTitle(`${row.resumeName} ↔ ${row.jdTitle}`);
        setTraceVisible(true);
    };

    const tabItems: TabsProps['items'] = [
        {
            key: 'by_resume',
            label: <span><UserOutlined /> 按简历 (1 对 N 个 JD)</span>,
            children: (
                <Space orientation="vertical" style={{ width: '100%' }} size="middle">
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
                <Space orientation="vertical" style={{ width: '100%' }} size="middle">
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
                <Space orientation="vertical" style={{ width: '100%' }} size="middle">
                    <Alert type="info" showIcon title="多对多测试将测试所有选定简历与所有选定 JD 的矩阵匹配。留空则使用全部可用数据。" />
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
                基于 Action → Step → Rule 链式验证，逐步执行本体规则匹配简历与 JD
            </Typography.Paragraph>

            {/* Config */}
            <Card style={{ marginBottom: 16 }}>
                <Space orientation="vertical" style={{ width: '100%' }} size="middle">
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
                        {executing ? '链式规则测试执行中...' : '执行交叉测试'}
                    </Button>
                </Space>
            </Card>

            {/* Results */}
            {result && (
                <Card
                    title={<Space><SwapOutlined style={{ color: '#a78bfa' }} /><span>交叉测试结果</span><Tag color="processing">{mode}</Tag><Tag color="geekblue">Action-Step-Rule 链式验证</Tag></Space>}
                    style={{ marginBottom: 16 }}
                >
                    {errors > 0 && (
                        <Alert
                            type="error" showIcon
                            title="部分测试出现错误"
                            description="LLM 服务可能不可用，请检查 API Key 配置。错误的测试结果标记为红色 ERROR 标签。"
                            style={{ marginBottom: 16 }}
                        />
                    )}
                    <Row gutter={16} style={{ marginBottom: 16 }}>
                        <Col span={6}><Statistic title="总计" value={resultRows.length} styles={{ content: { color: '#9ba6c7' } }} /></Col>
                        <Col span={6}><Statistic title="通过" value={passed} styles={{ content: { color: '#4ade80' } }} prefix={<CheckCircleOutlined />} /></Col>
                        <Col span={6}><Statistic title="失败" value={failed} styles={{ content: { color: '#fb7185' } }} prefix={<CloseCircleOutlined />} /></Col>
                        <Col span={6}><Statistic title="警告" value={warnings} styles={{ content: { color: '#fbbf24' } }} prefix={<WarningOutlined />} /></Col>
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
                                render: (rules: string[]) => rules?.length > 0
                                    ? <Tooltip title={rules.join(', ')}><span>{rules.slice(0, 3).map(r => <Tag key={r} color="volcano" style={{ marginBottom: 2 }}>{r}</Tag>)}{rules.length > 3 && <Tag>+{rules.length - 3}</Tag>}</span></Tooltip>
                                    : '-',
                            },
                            { title: '推理说明', dataIndex: 'reasoning', ellipsis: true },
                            {
                                title: '链路', width: 80,
                                render: (_: any, row: any) => {
                                    const hasTrace = row.stepTrace && row.stepTrace.length > 0;
                                    return hasTrace ? (
                                        <Tag
                                            color="geekblue"
                                            icon={<AimOutlined />}
                                            style={{ cursor: 'pointer' }}
                                            onClick={(e) => { e.stopPropagation(); openTrace(row); }}
                                        >
                                            链路
                                        </Tag>
                                    ) : null;
                                },
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
                    title="选择数据并运行交叉测试，系统将按 Action → Step → Rule 链式验证本体规则"
                    style={{ marginTop: 8 }}
                />
            )}

            <StepTraceModal
                stepTrace={traceData}
                visible={traceVisible}
                onClose={() => setTraceVisible(false)}
                title={traceTitle}
            />
        </div>
    );
}
