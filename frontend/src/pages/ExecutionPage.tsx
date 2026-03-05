import { useEffect, useState } from 'react';
import { Typography, Card, Select, Button, Table, Tag, Space, message, Alert } from 'antd';
import { PlayCircleOutlined, BugOutlined } from '@ant-design/icons';
import api from '../api';
import type { ApiResponse, OntologySnapshot, GeneratedTestCase, TestRun } from '../types';

export default function ExecutionPage() {
    const [snapshots, setSnapshots] = useState<OntologySnapshot[]>([]);
    const [snapshotId, setSnapshotId] = useState('');
    const [cases, setCases] = useState<GeneratedTestCase[]>([]);
    const [executing, setExecuting] = useState(false);
    const [result, setResult] = useState<TestRun | null>(null);
    const [deadlockLoading, setDeadlockLoading] = useState(false);
    const [deadlockResult, setDeadlockResult] = useState<any>(null);

    useEffect(() => {
        api.get<ApiResponse<OntologySnapshot[]>>('/ontology/snapshots').then(r => setSnapshots(r.data.data || [])).catch(() => { });
    }, []);

    useEffect(() => {
        if (snapshotId) {
            api.get<ApiResponse<GeneratedTestCase[]>>(`/generator/cases?snapshotId=${snapshotId}`).then(r => setCases(r.data.data || [])).catch(() => { });
        }
    }, [snapshotId]);

    const handleExecute = async () => {
        if (!snapshotId) { message.warning('请先选择快照'); return; }
        if (!cases.length) { message.warning('没有可执行的用例，请先生成'); return; }
        setExecuting(true);
        try {
            const { data } = await api.post<ApiResponse<TestRun>>('/executor/run', {
                snapshotId,
                caseIds: cases.map(c => c.caseId),
                executionMode: 'full',
            });
            setResult(data.data);
            message.success(`执行完成：${data.data.passedCases} 通过 / ${data.data.failedCases} 失败`);
        } catch { message.error('执行失败'); }
        setExecuting(false);
    };

    const handleDeadlock = async () => {
        if (!snapshotId) { message.warning('请先选择快照'); return; }
        setDeadlockLoading(true);
        try {
            const { data } = await api.post<ApiResponse<any>>('/executor/analyze-deadlock', { snapshotId });
            setDeadlockResult(data.data);
            if (data.data?.isClean) message.success('未检测到循环依赖');
            else message.warning(`检测到 ${data.data?.cyclesFound} 个循环依赖`);
        } catch { message.error('死锁分析失败'); }
        setDeadlockLoading(false);
    };

    return (
        <div>
            <Typography.Title level={3} className="page-title">执行测试</Typography.Title>
            <Typography.Paragraph style={{ color: '#9ba6c7' }}>选择快照和已生成的测试用例，运行全量或组件测试</Typography.Paragraph>

            <Card style={{ marginBottom: 16 }}>
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                    <Space wrap>
                        <Typography.Text strong>本体快照：</Typography.Text>
                        <Select
                            style={{ width: 400 }}
                            placeholder="选择快照"
                            value={snapshotId || undefined}
                            onChange={setSnapshotId}
                            options={snapshots.map(s => ({ label: `${s.snapshotId.slice(0, 20)}... (${s.rulesCount}R)`, value: s.snapshotId }))}
                        />
                    </Space>
                    {snapshotId && <Tag color="blue">已加载 {cases.length} 条测试用例</Tag>}
                    <Space>
                        <Button type="primary" icon={<PlayCircleOutlined />} loading={executing} onClick={handleExecute} disabled={!cases.length}>
                            {executing ? '执行中…' : '执行全量测试'}
                        </Button>
                        <Button icon={<BugOutlined />} loading={deadlockLoading} onClick={handleDeadlock} disabled={!snapshotId} danger>
                            死锁检测
                        </Button>
                    </Space>
                </Space>
            </Card>

            {deadlockResult && (
                <Alert
                    type={deadlockResult.isClean ? 'success' : 'error'}
                    showIcon
                    message={deadlockResult.isClean ? `无循环依赖 (${deadlockResult.totalRules} 条规则)` : `检测到 ${deadlockResult.cyclesFound} 个循环依赖`}
                    style={{ marginBottom: 16 }}
                />
            )}

            {result && (
                <Card title={`运行结果 — ${result.runId}`} style={{ marginBottom: 16 }}>
                    <Space wrap style={{ marginBottom: 16 }}>
                        <Tag color="blue">总计: {result.totalCases}</Tag>
                        <Tag color="green">通过: {result.passedCases}</Tag>
                        <Tag color="red">失败: {result.failedCases}</Tag>
                        <Tag color="orange">警告: {result.warningCases}</Tag>
                        <Tag color="cyan">通过率: {(result.coverageRate * 100).toFixed(0)}%</Tag>
                    </Space>
                    <Table
                        rowKey="recordId"
                        size="small"
                        pagination={{ pageSize: 10 }}
                        dataSource={result.records || []}
                        columns={[
                            { title: '用例 ID', dataIndex: 'caseId', width: 200, ellipsis: true },
                            { title: '裁定', dataIndex: 'verdict', width: 90, render: (v: string) => <Tag color={v === 'PASS' ? 'green' : v === 'FAIL' ? 'red' : 'orange'}>{v}</Tag> },
                            { title: '触发规则', dataIndex: 'triggeredRules', render: (rules: string[]) => rules?.length ? rules.map(r => <Tag key={r} color="volcano">{r}</Tag>) : <Tag>无</Tag> },
                            { title: '推理', dataIndex: 'reasoning', ellipsis: true },
                            { title: '耗时(ms)', dataIndex: 'executionDurationMs', width: 100 },
                        ]}
                    />
                </Card>
            )}
        </div>
    );
}
