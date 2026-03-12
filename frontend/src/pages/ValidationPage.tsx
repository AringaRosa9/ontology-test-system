import { useEffect, useState } from 'react';
import {
    Typography, Card, Button, Table, Tag, Space, message, Select, Descriptions,
    Progress, Collapse, Tooltip, Spin, Badge, Alert, Tabs, Empty, Statistic, Row, Col, Segmented,
} from 'antd';
import type { TabsProps, TableColumnsType } from 'antd';
import {
    SafetyCertificateOutlined, ReloadOutlined, ThunderboltOutlined,
    CheckCircleOutlined, CloseCircleOutlined, WarningOutlined,
    BugOutlined, LinkOutlined, NodeIndexOutlined, ApartmentOutlined,
    FileSearchOutlined, PlayCircleOutlined, AuditOutlined,
} from '@ant-design/icons';
import api from '../api';
import { useValidationStore } from '../store';
import type {
    ApiResponse, OntologySnapshot, ValidationReport, ValidationErrorItem,
    RuleCheckFinding, RuleCheckGroupResult, RuleCheckReportByGroup,
} from '../types';

const CLIENT_GROUPS = ['通用', '通用+腾讯', '通用+字节'] as const;
type ClientGroup = typeof CLIENT_GROUPS[number];

const SEVERITY_COLOR: Record<string, string> = { P0: 'red', P1: 'orange', P2: 'blue' };
const SEVERITY_LABEL: Record<string, string> = { P0: '阻塞', P1: '重要', P2: '提示' };
const ENTITY_ICON: Record<string, React.ReactNode> = {
    objects: <NodeIndexOutlined />,
    rules: <FileSearchOutlined />,
    actions: <ThunderboltOutlined />,
    events: <ThunderboltOutlined />,
    links: <LinkOutlined />,
    ontology: <ApartmentOutlined />,
};
const ENTITY_LABEL: Record<string, string> = {
    objects: '数据对象',
    rules: '业务规则',
    actions: '操作',
    events: '事件',
    links: '关联关系',
    ontology: '本体全局',
};

// ── Error Table ──────────────────────────────────────────────────────────────

function ErrorTable({ errors, title }: { errors: ValidationErrorItem[]; title?: string }) {
    const columns: TableColumnsType<ValidationErrorItem> = [
        {
            title: '严重度', dataIndex: 'severity', width: 80,
            filters: [
                { text: 'P0 阻塞', value: 'P0' },
                { text: 'P1 重要', value: 'P1' },
                { text: 'P2 提示', value: 'P2' },
            ],
            onFilter: (v, r) => r.severity === v,
            sorter: (a, b) => {
                const order: Record<string, number> = { P0: 0, P1: 1, P2: 2 };
                return (order[a.severity] ?? 9) - (order[b.severity] ?? 9);
            },
            render: (sev: string) => (
                <Tag color={SEVERITY_COLOR[sev]}>{sev} {SEVERITY_LABEL[sev]}</Tag>
            ),
        },
        {
            title: '错误码', dataIndex: 'code', width: 110,
            filters: [...new Set(errors.map(e => e.code))].map(c => ({ text: c, value: c })),
            onFilter: (v, r) => r.code === v,
            render: (code: string) => <Tag style={{ fontFamily: 'monospace' }}>{code}</Tag>,
        },
        {
            title: '类型', dataIndex: 'entityType', width: 100,
            filters: [...new Set(errors.map(e => e.entityType))].map(t => ({ text: ENTITY_LABEL[t] || t, value: t })),
            onFilter: (v, r) => r.entityType === v,
            render: (t: string) => (
                <Space size={4}>
                    {ENTITY_ICON[t]}
                    <span>{ENTITY_LABEL[t] || t}</span>
                </Space>
            ),
        },
        {
            title: '实体 ID', dataIndex: 'entityId', width: 180, ellipsis: true,
            render: (id: string) => <Typography.Text code copyable={{ text: id }}>{id}</Typography.Text>,
        },
        {
            title: '问题描述', dataIndex: 'message',
            render: (msg: string) => <Typography.Text style={{ fontSize: 13 }}>{msg}</Typography.Text>,
        },
        {
            title: '证据', dataIndex: 'evidence', width: 200, ellipsis: true,
            render: (ev: string) => ev
                ? <Tooltip title={ev}><Typography.Text type="secondary" style={{ fontSize: 12 }}>{ev}</Typography.Text></Tooltip>
                : <Typography.Text type="secondary">-</Typography.Text>,
        },
    ];

    return (
        <Table<ValidationErrorItem>
            rowKey={(r, i) => `${r.code}-${r.entityId}-${i}`}
            dataSource={errors}
            columns={columns}
            size="small"
            pagination={{ pageSize: 15, showSizeChanger: true, pageSizeOptions: ['10', '15', '30', '50', '100'] }}
            title={title ? () => <Typography.Text strong>{title} ({errors.length})</Typography.Text> : undefined}
            scroll={{ x: 900 }}
        />
    );
}

// ── Summary Cards ────────────────────────────────────────────────────────────

function SummaryCards({ report }: { report: ValidationReport }) {
    return (
        <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
            <Col xs={12} sm={6}>
                <Card size="small">
                    <Statistic
                        title="整体状态"
                        value={report.isDeterministicallyValid ? '通过' : '未通过'}
                        valueStyle={{ color: report.isDeterministicallyValid ? '#4ade80' : '#fb7185' }}
                        prefix={report.isDeterministicallyValid ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
                    />
                </Card>
            </Col>
            <Col xs={12} sm={6}>
                <Card size="small">
                    <Statistic
                        title="可运行性"
                        value={report.runnable ? '可运行' : '不可运行'}
                        valueStyle={{ color: report.runnable ? '#4ade80' : '#fb7185' }}
                        prefix={report.runnable ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
                    />
                </Card>
            </Col>
            <Col xs={12} sm={6}>
                <Card size="small">
                    <Statistic
                        title="P0 阻塞"
                        value={report.summary.P0}
                        valueStyle={{ color: report.summary.P0 > 0 ? '#fb7185' : '#4ade80' }}
                        prefix={<CloseCircleOutlined />}
                    />
                </Card>
            </Col>
            <Col xs={12} sm={6}>
                <Card size="small">
                    <Statistic
                        title="问题总数"
                        value={report.summary.total}
                        prefix={<BugOutlined />}
                    />
                </Card>
            </Col>
        </Row>
    );
}

// ── Severity Breakdown Bar ───────────────────────────────────────────────────

function SeverityBar({ report }: { report: ValidationReport }) {
    const total = report.summary.total || 1;
    return (
        <Card size="small" style={{ marginBottom: 24 }}>
            <Space direction="vertical" style={{ width: '100%' }} size={8}>
                <Space>
                    <Tag color="red">P0 阻塞: {report.summary.P0}</Tag>
                    <Tag color="orange">P1 重要: {report.summary.P1}</Tag>
                    <Tag color="blue">P2 提示: {report.summary.P2}</Tag>
                    <Typography.Text type="secondary" style={{ marginLeft: 12 }}>
                        校验码: <Typography.Text copyable code style={{ fontSize: 11 }}>{report.checksum.slice(0, 16)}</Typography.Text>
                    </Typography.Text>
                </Space>
                <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', background: '#1a2340' }}>
                    {report.summary.P0 > 0 && (
                        <div style={{ width: `${(report.summary.P0 / total) * 100}%`, background: '#fb7185' }} />
                    )}
                    {report.summary.P1 > 0 && (
                        <div style={{ width: `${(report.summary.P1 / total) * 100}%`, background: '#fbbf24' }} />
                    )}
                    {report.summary.P2 > 0 && (
                        <div style={{ width: `${(report.summary.P2 / total) * 100}%`, background: '#38bdf8' }} />
                    )}
                </div>
            </Space>
        </Card>
    );
}

// ── Blocker Panel ────────────────────────────────────────────────────────────

function BlockerPanel({ report }: { report: ValidationReport }) {
    const blockers = report.blockers;
    const runnableBlockers = report.runnableBlockers;

    if (blockers.length === 0 && runnableBlockers.length === 0) {
        return (
            <Alert
                type="success"
                showIcon
                icon={<CheckCircleOutlined />}
                message="无阻塞项"
                description="当前本体快照无 P0 级别阻塞问题，整体有效且可运行。"
                style={{ marginBottom: 24 }}
            />
        );
    }

    return (
        <Space direction="vertical" style={{ width: '100%', marginBottom: 24 }} size={12}>
            {blockers.length > 0 && (
                <Alert
                    type="error"
                    showIcon
                    icon={<CloseCircleOutlined />}
                    message={`${blockers.length} 个 P0 阻塞项`}
                    description={
                        <ul style={{ margin: '8px 0', paddingLeft: 20 }}>
                            {blockers.map((b, i) => (
                                <li key={i} style={{ marginBottom: 4 }}>
                                    <Tag color="red" style={{ fontFamily: 'monospace' }}>{b.code}</Tag>
                                    <strong>[{b.entityId}]</strong> {b.message}
                                </li>
                            ))}
                        </ul>
                    }
                />
            )}
            {runnableBlockers.length > 0 && (
                <Alert
                    type="warning"
                    showIcon
                    icon={<WarningOutlined />}
                    message={`${runnableBlockers.length} 个可运行性阻塞`}
                    description={
                        <ul style={{ margin: '8px 0', paddingLeft: 20 }}>
                            {runnableBlockers.map((b, i) => (
                                <li key={i} style={{ marginBottom: 4 }}>
                                    <Tag color="orange" style={{ fontFamily: 'monospace' }}>{b.code}</Tag>
                                    <strong>[{b.entityId}]</strong> {b.message}
                                </li>
                            ))}
                        </ul>
                    }
                />
            )}
        </Space>
    );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function ValidationPage() {
    const [snapshots, setSnapshots] = useState<OntologySnapshot[]>([]);
    const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
    const [report, setReport] = useState<ValidationReport | null>(null);
    const [loading, setLoading] = useState(false);
    const [runningDeterministic, setRunningDeterministic] = useState(false);
    const [ruleCheckLoading, setRuleCheckLoading] = useState(false);
    const [activeClientGroup, setActiveClientGroup] = useState<ClientGroup>('通用');

    // Store hooks
    const ruleCheckByGroup = useValidationStore(s => s.ruleCheckByGroup);
    const setGroupResult = useValidationStore(s => s.setGroupResult);
    const loadAllGroups = useValidationStore(s => s.loadAllGroups);

    // Derive current group result from store
    const currentGroupResult: RuleCheckGroupResult | null =
        selectedSnapshotId ? (ruleCheckByGroup[selectedSnapshotId]?.[activeClientGroup] ?? null) : null;
    const snapshotGroups = selectedSnapshotId ? (ruleCheckByGroup[selectedSnapshotId] ?? {}) : {};

    const fetchSnapshots = () => {
        api.get<ApiResponse<OntologySnapshot[]>>('/ontology/snapshots')
            .then(r => {
                const data = r.data.data || [];
                setSnapshots(data);
                if (!selectedSnapshotId && data.length > 0) {
                    setSelectedSnapshotId(data[0].snapshotId);
                }
            })
            .catch(() => message.error('加载快照列表失败'));
    };

    // Load existing rule-check results from backend when snapshot changes
    const loadExistingRuleCheck = async (snapshotId: string) => {
        // Already have data in store for this snapshot? Skip fetch.
        if (ruleCheckByGroup[snapshotId] && Object.keys(ruleCheckByGroup[snapshotId]).length > 0) return;
        try {
            const { data } = await api.get<ApiResponse<RuleCheckReportByGroup | null>>(
                `/ontology/snapshots/${snapshotId}/rule-self-check`
            );
            if (data.data && data.data.byClientGroup) {
                loadAllGroups(snapshotId, data.data.byClientGroup);
            }
        } catch {
            // No existing results — that's fine
        }
    };

    useEffect(() => { fetchSnapshots(); }, []);

    // Auto-load existing rule-check results when snapshot is selected
    useEffect(() => {
        if (selectedSnapshotId) {
            loadExistingRuleCheck(selectedSnapshotId);
        }
    }, [selectedSnapshotId]);

    const handleValidate = async () => {
        if (!selectedSnapshotId) { message.warning('请先选择快照'); return; }
        setLoading(true);
        setReport(null);
        try {
            const { data } = await api.get<ApiResponse<ValidationReport>>(
                `/ontology/snapshots/${selectedSnapshotId}/validate`
            );
            setReport(data.data);
            const r = data.data;
            if (r.isDeterministicallyValid) {
                message.success(`校验通过！共 ${r.summary.total} 项检查，无 P0 阻塞`);
            } else {
                message.warning(`校验完成：${r.summary.P0} 个 P0 阻塞，${r.summary.P1} 个 P1 问题`);
            }
        } catch (e: any) {
            message.error(e?.response?.data?.detail || '校验失败');
        }
        setLoading(false);
    };

    const handleRunDeterministic = async () => {
        if (!selectedSnapshotId) { message.warning('请先选择快照'); return; }
        setRunningDeterministic(true);
        try {
            const { data } = await api.post<ApiResponse<any>>('/executor/run-deterministic', {
                snapshotId: selectedSnapshotId,
            });
            const run = data.data;
            message.success(
                `确定性执行完成：${run.totalCases} 条记录，` +
                `通过 ${run.passedCases}，失败 ${run.failedCases}，警告 ${run.warningCases}`
            );
            if (run.validationReport) {
                setReport(run.validationReport);
            }
        } catch (e: any) {
            message.error(e?.response?.data?.detail || '确定性执行失败');
        }
        setRunningDeterministic(false);
    };

    const handleRuleCheck = async () => {
        if (!selectedSnapshotId) { message.warning('请先选择快照'); return; }
        setRuleCheckLoading(true);
        try {
            const { data } = await api.post<ApiResponse<RuleCheckGroupResult & { snapshotId: string }>>(
                `/ontology/snapshots/${selectedSnapshotId}/rule-self-check`,
                { clientGroup: activeClientGroup },
            );
            setGroupResult(selectedSnapshotId, activeClientGroup, data.data);
            const s = data.data.summary;
            message.success(`「${activeClientGroup}」规则自检完成：共 ${s.total} 个发现（P0: ${s.P0}, P1: ${s.P1}, P2: ${s.P2}）`);
        } catch (e: any) {
            message.error(e?.response?.data?.detail || '规则自检失败');
        }
        setRuleCheckLoading(false);
    };

    const STRATEGY_LABEL: Record<string, string> = {
        counter_example: '规则反例',
        conflict: '交叉冲突',
        boundary: '边界探测',
        omission: '遗漏探测',
        challenge: '综合挑战',
    };
    const STRATEGY_DESC: Record<string, string> = {
        counter_example: '检查规则是否存在被合理反例打破的场景',
        conflict: '检查规则之间是否存在逻辑矛盾或冲突',
        boundary: '检查规则边界条件是否明确',
        omission: '检查规则体系是否存在盲区和遗漏',
        challenge: '检查多规则叠加后是否产生意外结果',
    };

    const ruleCheckColumns = [
        {
            title: '严重度', dataIndex: 'severity', width: 80,
            filters: [{ text: 'P0', value: 'P0' }, { text: 'P1', value: 'P1' }, { text: 'P2', value: 'P2' }],
            onFilter: (v: any, r: RuleCheckFinding) => r.severity === v,
            render: (sev: string) => <Tag color={SEVERITY_COLOR[sev]}>{sev} {SEVERITY_LABEL[sev]}</Tag>,
        },
        {
            title: '涉及规则', dataIndex: 'ruleId', width: 180,
            render: (_: string, r: RuleCheckFinding) => (
                <Space size={4}>
                    <Typography.Text code copyable={{ text: r.ruleId }}>{r.ruleId}</Typography.Text>
                    {r.ruleIdB && <><span>↔</span><Typography.Text code copyable={{ text: r.ruleIdB }}>{r.ruleIdB}</Typography.Text></>}
                </Space>
            ),
        },
        { title: '问题描述', dataIndex: 'finding', render: (v: string) => <Typography.Text style={{ fontSize: 13 }}>{v}</Typography.Text> },
        { title: '修复建议', dataIndex: 'suggestion', width: 280, render: (v: string) => <Typography.Text type="secondary" style={{ fontSize: 12 }}>{v}</Typography.Text> },
    ];

    const ruleCheckTabContent = (
        <div>
            {/* Client group selector */}
            <div style={{ marginBottom: 16 }}>
                <Typography.Text strong style={{ marginRight: 12 }}>适用客户分类：</Typography.Text>
                <Segmented
                    options={CLIENT_GROUPS.map(g => ({
                        label: (
                            <Space size={4}>
                                <span>{g}</span>
                                {snapshotGroups[g] && (
                                    <Badge
                                        count={snapshotGroups[g].summary.total}
                                        style={{
                                            backgroundColor: snapshotGroups[g].summary.P0 > 0 ? '#fb7185'
                                                : snapshotGroups[g].summary.P1 > 0 ? '#fbbf24' : '#38bdf8',
                                        }}
                                        size="small"
                                    />
                                )}
                            </Space>
                        ),
                        value: g,
                    }))}
                    value={activeClientGroup}
                    onChange={(v) => setActiveClientGroup(v as ClientGroup)}
                />
            </div>

            <Space style={{ marginBottom: 16 }}>
                <Button
                    type="primary"
                    icon={<AuditOutlined />}
                    loading={ruleCheckLoading}
                    onClick={handleRuleCheck}
                    disabled={!selectedSnapshotId}
                    style={{ background: 'linear-gradient(135deg, #a78bfa, #6366f1)', border: 'none' }}
                >
                    执行规则自检（{activeClientGroup}）
                </Button>
                {currentGroupResult && (
                    <Space>
                        <Tag color="red">P0: {currentGroupResult.summary.P0}</Tag>
                        <Tag color="orange">P1: {currentGroupResult.summary.P1}</Tag>
                        <Tag color="blue">P2: {currentGroupResult.summary.P2}</Tag>
                        <Tag>总计: {currentGroupResult.summary.total}</Tag>
                    </Space>
                )}
            </Space>
            {currentGroupResult ? (
                <Collapse
                    key={activeClientGroup}
                    defaultActiveKey={Object.keys(currentGroupResult.checkResults).filter(k => (currentGroupResult.checkResults[k]?.length || 0) > 0)}
                    items={Object.entries(currentGroupResult.checkResults).map(([strategy, findings]) => ({
                        key: strategy,
                        label: (
                            <Space>
                                <span>{STRATEGY_LABEL[strategy] || strategy}</span>
                                <Badge count={findings.length} style={{ backgroundColor: findings.some(f => f.severity === 'P0') ? '#fb7185' : findings.some(f => f.severity === 'P1') ? '#fbbf24' : '#38bdf8' }} size="small" />
                                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{STRATEGY_DESC[strategy] || ''}</Typography.Text>
                            </Space>
                        ),
                        children: findings.length > 0 ? (
                            <Table<RuleCheckFinding>
                                rowKey={(r, i) => `${r.ruleId}-${r.strategy}-${i}`}
                                dataSource={findings}
                                columns={ruleCheckColumns}
                                size="small"
                                pagination={{ pageSize: 10 }}
                            />
                        ) : (
                            <Alert type="success" showIcon message="该维度未发现问题" />
                        ),
                    }))}
                />
            ) : (
                <Alert type="info" showIcon message={`选择适用客户分类并点击「执行规则自检」对「${activeClientGroup}」规则集合进行五维深度分析`} />
            )}
        </div>
    );

    // Build per-category tabs — insert "规则自检" between objects and ontology
    const categoryTabItems: TabsProps['items'] = report
        ? (() => {
            const ordered = ['objects', 'rules', 'actions', 'events', 'links'];
            const items: TabsProps['items'] = [];
            // Add entity type tabs (excluding ontology)
            for (const type of ordered) {
                const errors = report.errorsByType[type];
                if (!errors) continue;
                items.push({
                    key: type,
                    label: (
                        <Space size={4}>
                            {ENTITY_ICON[type] || <BugOutlined />}
                            <span>{ENTITY_LABEL[type] || type}</span>
                            <Badge count={errors.length} style={{ backgroundColor: errors.some(e => e.severity === 'P0') ? '#fb7185' : errors.some(e => e.severity === 'P1') ? '#fbbf24' : '#38bdf8' }} size="small" />
                        </Space>
                    ),
                    children: <ErrorTable errors={errors} />,
                });
            }
            // Insert rule self-check tab
            const groupCount = Object.keys(snapshotGroups).length;
            const totalGroupFindings = Object.values(snapshotGroups).reduce((sum, g) => sum + g.summary.total, 0);
            const hasP0 = Object.values(snapshotGroups).some(g => g.summary.P0 > 0);
            const hasP1 = Object.values(snapshotGroups).some(g => g.summary.P1 > 0);
            items.push({
                key: 'rule_self_check',
                label: (
                    <Space size={4}>
                        <AuditOutlined />
                        <span>规则自检</span>
                        {groupCount > 0 && <Badge count={totalGroupFindings} style={{ backgroundColor: hasP0 ? '#fb7185' : hasP1 ? '#fbbf24' : '#38bdf8' }} size="small" />}
                    </Space>
                ),
                children: ruleCheckTabContent,
            });
            // Add ontology tab last
            const ontErrors = report.errorsByType['ontology'];
            if (ontErrors) {
                items.push({
                    key: 'ontology',
                    label: (
                        <Space size={4}>
                            {ENTITY_ICON['ontology']}
                            <span>{ENTITY_LABEL['ontology']}</span>
                            <Badge count={ontErrors.length} style={{ backgroundColor: ontErrors.some(e => e.severity === 'P0') ? '#fb7185' : ontErrors.some(e => e.severity === 'P1') ? '#fbbf24' : '#38bdf8' }} size="small" />
                        </Space>
                    ),
                    children: <ErrorTable errors={ontErrors} />,
                });
            }
            // Add any remaining types not in ordered list
            for (const [type, errors] of Object.entries(report.errorsByType)) {
                if (!ordered.includes(type) && type !== 'ontology') {
                    items.push({
                        key: type,
                        label: (
                            <Space size={4}>
                                {ENTITY_ICON[type] || <BugOutlined />}
                                <span>{ENTITY_LABEL[type] || type}</span>
                                <Badge count={errors.length} style={{ backgroundColor: errors.some(e => e.severity === 'P0') ? '#fb7185' : errors.some(e => e.severity === 'P1') ? '#fbbf24' : '#38bdf8' }} size="small" />
                            </Space>
                        ),
                        children: <ErrorTable errors={errors} />,
                    });
                }
            }
            return items;
        })()
        : [];

    // Find selected snapshot info
    const selectedSnap = snapshots.find(s => s.snapshotId === selectedSnapshotId);

    return (
        <div>
            <Typography.Title level={3} className="page-title">
                <SafetyCertificateOutlined style={{ marginRight: 8 }} />
                有效性检验
            </Typography.Title>
            <Typography.Paragraph style={{ color: '#9ba6c7' }}>
                对本体快照执行确定性校验（无 LLM 依赖），检测数据对象、规则、操作/事件、关联关系及全局可运行性
            </Typography.Paragraph>

            {/* Snapshot Selector + Actions */}
            <Card style={{ marginBottom: 24 }}>
                <Space wrap size="middle" style={{ width: '100%' }}>
                    <Space size={8}>
                        <Typography.Text strong>选择快照：</Typography.Text>
                        <Select
                            value={selectedSnapshotId}
                            onChange={v => { setSelectedSnapshotId(v); setReport(null); }}
                            style={{ minWidth: 400 }}
                            placeholder="选择要校验的本体快照"
                            options={snapshots.map(s => ({
                                value: s.snapshotId,
                                label: (
                                    <Space>
                                        <span>{s.snapshotId.slice(0, 24)}…</span>
                                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                            R:{s.rulesCount} DO:{s.dataObjectsCount} A:{s.actionsCount} E:{s.eventsCount} L:{s.linksCount}
                                        </Typography.Text>
                                    </Space>
                                ),
                            }))}
                        />
                    </Space>
                    <Button
                        type="primary"
                        icon={<SafetyCertificateOutlined />}
                        loading={loading}
                        onClick={handleValidate}
                        disabled={!selectedSnapshotId}
                    >
                        执行校验
                    </Button>
                    <Button
                        icon={<PlayCircleOutlined />}
                        loading={runningDeterministic}
                        onClick={handleRunDeterministic}
                        disabled={!selectedSnapshotId}
                    >
                        确定性执行
                    </Button>
                    <Button icon={<ReloadOutlined />} onClick={fetchSnapshots}>刷新</Button>
                </Space>

                {selectedSnap && (
                    <Descriptions size="small" column={5} style={{ marginTop: 16 }} bordered>
                        <Descriptions.Item label="Rules">{selectedSnap.rulesCount}</Descriptions.Item>
                        <Descriptions.Item label="DataObjects">{selectedSnap.dataObjectsCount}</Descriptions.Item>
                        <Descriptions.Item label="Actions">{selectedSnap.actionsCount}</Descriptions.Item>
                        <Descriptions.Item label="Events">{selectedSnap.eventsCount}</Descriptions.Item>
                        <Descriptions.Item label="Links">{selectedSnap.linksCount}</Descriptions.Item>
                    </Descriptions>
                )}
            </Card>

            {/* Loading */}
            {loading && (
                <Card style={{ textAlign: 'center', padding: 48 }}>
                    <Spin size="large" />
                    <Typography.Paragraph style={{ marginTop: 16 }}>正在执行确定性校验…</Typography.Paragraph>
                </Card>
            )}

            {/* Report */}
            {report && !loading && (
                <>
                    <SummaryCards report={report} />
                    <SeverityBar report={report} />
                    <BlockerPanel report={report} />

                    {/* Per-category error tabs */}
                    {categoryTabItems.length > 0 ? (
                        <Card title="按类别查看校验结果">
                            <Tabs items={categoryTabItems} />
                        </Card>
                    ) : (
                        <Card>
                            <Alert type="success" showIcon message="所有检查项均通过，未发现任何问题。" />
                        </Card>
                    )}

                    {/* Full error list (collapsed) */}
                    {report.allErrors.length > 0 && (
                        <Collapse
                            style={{ marginTop: 24 }}
                            items={[{
                                key: 'all',
                                label: (
                                    <Space>
                                        <BugOutlined />
                                        <span>全部问题列表</span>
                                        <Badge count={report.allErrors.length} style={{ backgroundColor: '#6366f1' }} />
                                    </Space>
                                ),
                                children: <ErrorTable errors={report.allErrors} />,
                            }]}
                        />
                    )}
                </>
            )}

            {/* No report yet */}
            {!report && !loading && (
                <Card style={{ textAlign: 'center', padding: 48 }}>
                    <Empty
                        image={<SafetyCertificateOutlined style={{ fontSize: 64, color: '#38bdf8' }} />}
                        description={
                            <Space direction="vertical">
                                <Typography.Text>选择快照并点击"执行校验"以运行确定性有效性检验</Typography.Text>
                                <Typography.Text type="secondary">
                                    校验引擎不依赖 LLM，同一快照多次执行结果完全一致
                                </Typography.Text>
                            </Space>
                        }
                    />
                </Card>
            )}
        </div>
    );
}
