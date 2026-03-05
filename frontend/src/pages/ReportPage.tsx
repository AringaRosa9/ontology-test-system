import { useEffect, useState } from 'react';
import { Typography, Card, Table, Tag, Space, Button, message, Empty, Descriptions, Alert } from 'antd';
import { FileTextOutlined, BarChartOutlined } from '@ant-design/icons';
import api from '../api';
import type { ApiResponse, TestRun, TestReport } from '../types';

export default function ReportPage() {
    const [runs, setRuns] = useState<TestRun[]>([]);
    const [report, setReport] = useState<TestReport | null>(null);
    const [generating, setGenerating] = useState(false);

    useEffect(() => {
        api.get<ApiResponse<TestRun[]>>('/reports').then(r => setRuns(r.data.data || [])).catch(() => { });
    }, []);

    const handleGenerate = async (runId: string) => {
        setGenerating(true);
        try {
            const { data } = await api.post<ApiResponse<TestReport>>('/reports/generate', { runId });
            setReport(data.data);
            message.success('报告生成成功');
        } catch { message.error('报告生成失败'); }
        setGenerating(false);
    };

    return (
        <div>
            <Typography.Title level={3} className="page-title">测试报告</Typography.Title>
            <Typography.Paragraph style={{ color: '#9ba6c7' }}>选择一个测试运行，生成 AI 分析测试报告</Typography.Paragraph>

            <Card title={`可用的测试运行 (${runs.length})`} style={{ marginBottom: 16 }}>
                {runs.length > 0 ? (
                    <Table
                        rowKey="runId"
                        size="small"
                        pagination={{ pageSize: 5 }}
                        dataSource={runs}
                        columns={[
                            { title: '运行 ID', dataIndex: 'runId', width: 180, ellipsis: true },
                            { title: '快照', dataIndex: 'snapshotId', width: 180, ellipsis: true },
                            { title: '总用例', dataIndex: 'totalCases', width: 80 },
                            { title: '通过', dataIndex: 'passedCases', width: 70, render: (c: number) => <Tag color="green">{c}</Tag> },
                            { title: '失败', dataIndex: 'failedCases', width: 70, render: (c: number) => <Tag color={c ? 'red' : 'green'}>{c}</Tag> },
                            { title: '通过率', dataIndex: 'coverageRate', width: 90, render: (r: number) => `${(r * 100).toFixed(0)}%` },
                            {
                                title: '操作', width: 120,
                                render: (_: any, row: TestRun) => (
                                    <Button type="primary" size="small" icon={<FileTextOutlined />} loading={generating} onClick={() => handleGenerate(row.runId)}>
                                        生成报告
                                    </Button>
                                ),
                            },
                        ]}
                    />
                ) : <Empty description="暂无测试运行记录，请先执行测试" />}
            </Card>

            {report && (
                <Card
                    title={
                        <Space>
                            <BarChartOutlined style={{ color: '#22d3ee' }} />
                            <span>测试报告 — {report.reportId}</span>
                        </Space>
                    }
                >
                    <Space direction="vertical" style={{ width: '100%' }} size="middle">
                        <Descriptions bordered size="small" column={2}>
                            <Descriptions.Item label="报告 ID">{report.reportId}</Descriptions.Item>
                            <Descriptions.Item label="关联运行">{report.runId}</Descriptions.Item>
                            <Descriptions.Item label="生成时间">{new Date(report.generatedAt).toLocaleString('zh-CN')}</Descriptions.Item>
                            <Descriptions.Item label="通过率">{report.passRate !== undefined ? `${(report.passRate * 100).toFixed(0)}%` : '-'}</Descriptions.Item>
                        </Descriptions>

                        <Card size="small" title="📋 执行摘要">
                            <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{report.summary}</Typography.Paragraph>
                        </Card>

                        {report.coverageAnalysis && (
                            <Card size="small" title="📊 覆盖率分析">
                                <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{report.coverageAnalysis}</Typography.Paragraph>
                            </Card>
                        )}

                        {report.riskAssessment && (
                            <Card size="small" title="⚠️ 风险评估">
                                <Alert
                                    type={report.riskAssessment.includes('高') || report.riskAssessment.includes('high') ? 'error' : report.riskAssessment.includes('中') || report.riskAssessment.includes('medium') ? 'warning' : 'success'}
                                    message={report.riskAssessment}
                                    showIcon
                                />
                            </Card>
                        )}

                        {report.recommendations && report.recommendations.length > 0 && (
                            <Card size="small" title="💡 建议">
                                <ul style={{ paddingLeft: 20 }}>
                                    {report.recommendations.map((r, i) => <li key={i} style={{ marginBottom: 8 }}>{r}</li>)}
                                </ul>
                            </Card>
                        )}

                        {report.componentBreakdown && (
                            <Card size="small" title="🔧 组件分布">
                                <Space wrap>
                                    {Object.entries(report.componentBreakdown).map(([comp, data]: [string, any]) => (
                                        <Tag key={comp} color="blue">{comp}: {typeof data === 'object' ? JSON.stringify(data) : data}</Tag>
                                    ))}
                                </Space>
                            </Card>
                        )}
                    </Space>
                </Card>
            )}
        </div>
    );
}
