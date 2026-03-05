import { useEffect, useState } from 'react';
import { Typography, Row, Col, Card, Tag, Space, Statistic } from 'antd';
import {
    DatabaseOutlined,
    SafetyOutlined,
    ThunderboltOutlined,
    LinkOutlined,
    CheckCircleOutlined,
    CloseCircleOutlined,
} from '@ant-design/icons';
import api from '../api';
import type { ApiResponse, OntologySnapshot, TestRun } from '../types';

export default function DashboardPage() {
    const [snapshots, setSnapshots] = useState<OntologySnapshot[]>([]);
    const [runs, setRuns] = useState<TestRun[]>([]);

    useEffect(() => {
        api.get<ApiResponse<OntologySnapshot[]>>('/ontology/snapshots').then(r => setSnapshots(r.data.data || [])).catch(() => { });
        api.get<ApiResponse<TestRun[]>>('/executor/runs').then(r => setRuns(r.data.data || [])).catch(() => { });
    }, []);

    const latest = snapshots[0];
    const latestRun = runs[0];

    return (
        <div>
            <Typography.Title level={3} className="page-title">仪表盘</Typography.Title>
            <Typography.Paragraph style={{ color: '#9ba6c7' }}>
                RAAS Ontology 自动化测试平台总览
            </Typography.Paragraph>

            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
                {[
                    { label: '本体快照', value: snapshots.length, icon: <DatabaseOutlined />, color: '#22d3ee' },
                    { label: '测试运行', value: runs.length, icon: <ThunderboltOutlined />, color: '#a5b4fc' },
                    { label: '总通过', value: runs.reduce((a, r) => a + r.passedCases, 0), icon: <CheckCircleOutlined />, color: '#4ade80' },
                    { label: '总失败', value: runs.reduce((a, r) => a + r.failedCases, 0), icon: <CloseCircleOutlined />, color: '#fb7185' },
                ].map(item => (
                    <Col xs={24} sm={12} md={6} key={item.label}>
                        <div className="stat-card">
                            <div style={{ color: item.color, fontSize: 28, marginBottom: 8 }}>{item.icon}</div>
                            <div className="stat-value">{item.value}</div>
                            <div className="stat-label">{item.label}</div>
                        </div>
                    </Col>
                ))}
            </Row>

            {latest && (
                <Card title="最新本体快照" style={{ marginBottom: 16 }}>
                    <Space wrap>
                        <Tag color="cyan">ID: {latest.snapshotId}</Tag>
                        <Tag color="blue" icon={<SafetyOutlined />}>Rules: {latest.rulesCount}</Tag>
                        <Tag color="green" icon={<DatabaseOutlined />}>DataObjects: {latest.dataObjectsCount}</Tag>
                        <Tag color="orange" icon={<ThunderboltOutlined />}>Actions: {latest.actionsCount}</Tag>
                        <Tag color="purple">Events: {latest.eventsCount}</Tag>
                        <Tag color="geekblue" icon={<LinkOutlined />}>Links: {latest.linksCount}</Tag>
                    </Space>
                </Card>
            )}

            {latestRun && (
                <Card title="最近测试运行">
                    <Row gutter={16}>
                        <Col span={6}><Statistic title="总用例" value={latestRun.totalCases} /></Col>
                        <Col span={6}><Statistic title="通过" value={latestRun.passedCases} valueStyle={{ color: '#4ade80' }} /></Col>
                        <Col span={6}><Statistic title="失败" value={latestRun.failedCases} valueStyle={{ color: '#fb7185' }} /></Col>
                        <Col span={6}><Statistic title="通过率" value={`${(latestRun.coverageRate * 100).toFixed(0)}%`} /></Col>
                    </Row>
                </Card>
            )}
        </div>
    );
}
