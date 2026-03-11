import { Modal, Space, Tag, Collapse, Typography, Alert } from 'antd';
import { AimOutlined, RightOutlined, DownOutlined } from '@ant-design/icons';
import type { StepTraceItem, StepRuleResult } from '../types';

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

export default function StepTraceModal({ stepTrace, visible, onClose, title }: {
    stepTrace: StepTraceItem[];
    visible: boolean;
    onClose: () => void;
    title: string;
}) {
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
                <Alert type="info" message="无 Action-Step-Rule 执行链路数据" />
            )}
        </Modal>
    );
}
