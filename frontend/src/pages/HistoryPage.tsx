import { useEffect, useState } from 'react';
import { Typography, Card, Table, Tag, Button, message, Descriptions } from 'antd';
import { ReloadOutlined, EyeOutlined } from '@ant-design/icons';
import api from '../api';
import type { ApiResponse, TestRun } from '../types';

export default function HistoryPage() {
    const [runs, setRuns] = useState<TestRun[]>([]);
    const [detail, setDetail] = useState<TestRun | null>(null);
    const [loading, setLoading] = useState(false);

    const fetchRuns = () => {
        setLoading(true);
        api.get<ApiResponse<TestRun[]>>('/executor/runs')
            .then(r => setRuns(r.data.data || []))
            .catch(() => message.error('加载历史记录失败'))
            .finally(() => setLoading(false));
    };

    useEffect(() => { fetchRuns(); }, []);

    const viewDetail = async (runId: string) => {
        try {
            const { data } = await api.get<ApiResponse<TestRun>>(`/executor/runs/${runId}`);
            setDetail(data.data);
        } catch { message.error('加载详情失败'); }
    };

    return (
        <div>
            <Typography.Title level={3} className="page-title">历史记录</Typography.Title>
            <Typography.Paragraph style={{ color: '#9ba6c7' }}>所有测试运行的历史记录</Typography.Paragraph>

            <Card
                title={`运行记录 (${runs.length})`}
                extra={<Button icon={<ReloadOutlined />} onClick={fetchRuns} loading={loading}>刷新</Button>}
                style={{ marginBottom: 16 }}
            >
                <Table
                    rowKey="runId"
                    size="small"
                    pagination={{ pageSize: 8 }}
                    dataSource={runs}
                    loading={loading}
                    columns={[
                        { title: '运行 ID', dataIndex: 'runId', width: 180, ellipsis: true },
                        { title: '快照 ID', dataIndex: 'snapshotId', width: 180, ellipsis: true },
                        { title: '模式', dataIndex: 'executionMode', width: 90, render: (m: string) => <Tag>{m}</Tag> },
                        { title: '总用例', dataIndex: 'totalCases', width: 80 },
                        { title: '通过', dataIndex: 'passedCases', width: 70, render: (c: number) => <Tag color="green">{c}</Tag> },
                        { title: '失败', dataIndex: 'failedCases', width: 70, render: (c: number) => <Tag color={c ? 'red' : 'green'}>{c}</Tag> },
                        { title: '通过率', dataIndex: 'coverageRate', width: 90, render: (r: number) => `${(r * 100).toFixed(0)}%` },
                        { title: '时间', dataIndex: 'executedAt', width: 170, render: (t: string) => new Date(t).toLocaleString('zh-CN') },
                        { title: '操作', width: 80, render: (_: any, row: TestRun) => <Button size="small" icon={<EyeOutlined />} onClick={() => viewDetail(row.runId)}>详情</Button> },
                    ]}
                />
            </Card>

            {detail && (
                <Card title={`运行详情 — ${detail.runId}`}>
                    <Descriptions bordered size="small" column={4} style={{ marginBottom: 16 }}>
                        <Descriptions.Item label="快照">{detail.snapshotId}</Descriptions.Item>
                        <Descriptions.Item label="总用例">{detail.totalCases}</Descriptions.Item>
                        <Descriptions.Item label="通过">{detail.passedCases}</Descriptions.Item>
                        <Descriptions.Item label="失败">{detail.failedCases}</Descriptions.Item>
                    </Descriptions>
                    <Table
                        rowKey="recordId"
                        size="small"
                        pagination={{ pageSize: 10 }}
                        dataSource={detail.records || []}
                        columns={[
                            { title: '用例 ID', dataIndex: 'caseId', width: 200, ellipsis: true },
                            { title: '裁定', dataIndex: 'verdict', width: 90, render: (v: string) => <Tag color={v === 'PASS' ? 'green' : v === 'FAIL' ? 'red' : 'orange'}>{v}</Tag> },
                            { title: '推理', dataIndex: 'reasoning', ellipsis: true },
                            { title: '触发规则', dataIndex: 'triggeredRules', render: (rules: string[]) => rules?.map(r => <Tag key={r} color="volcano">{r}</Tag>) },
                        ]}
                    />
                </Card>
            )}
        </div>
    );
}
