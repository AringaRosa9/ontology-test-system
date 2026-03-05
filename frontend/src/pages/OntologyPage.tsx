import { useEffect, useState, useRef } from 'react';
import { Typography, Card, Button, Table, Tag, Space, message, Alert, Descriptions } from 'antd';
import { UploadOutlined, DeleteOutlined, EyeOutlined } from '@ant-design/icons';
import api from '../api';
import type { ApiResponse, OntologySnapshot, OntologySnapshotDetail } from '../types';

export default function OntologyPage() {
    const [snapshots, setSnapshots] = useState<OntologySnapshot[]>([]);
    const [uploading, setUploading] = useState(false);
    const [detail, setDetail] = useState<OntologySnapshotDetail | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const fetchSnapshots = () => {
        api.get<ApiResponse<OntologySnapshot[]>>('/ontology/snapshots')
            .then(r => setSnapshots(r.data.data || []))
            .catch(() => message.error('加载快照失败'));
    };

    useEffect(() => { fetchSnapshots(); }, []);

    const handleUpload = async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        setUploading(true);
        let successCount = 0;
        for (let i = 0; i < files.length; i++) {
            const fd = new FormData();
            fd.append('file', files[i], files[i].name);
            try {
                await api.post('/ontology/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
                successCount++;
            } catch {
                message.error(`上传 ${files[i].name} 失败`);
            }
        }
        if (successCount > 0) message.success(`成功上传 ${successCount} 个文件`);
        setUploading(false);
        fetchSnapshots();
    };

    const handleDelete = async (id: string) => {
        try {
            await api.delete(`/ontology/snapshots/${id}`);
            message.success('已删除');
            fetchSnapshots();
            if (detail?.snapshotId === id) setDetail(null);
        } catch { message.error('删除失败'); }
    };

    const handleView = async (id: string) => {
        try {
            const { data } = await api.get<ApiResponse<OntologySnapshotDetail>>(`/ontology/snapshots/${id}`);
            setDetail(data.data);
        } catch { message.error('加载详情失败'); }
    };

    return (
        <div>
            <Typography.Title level={3} className="page-title">上传与拉取</Typography.Title>
            <Typography.Paragraph style={{ color: '#9ba6c7' }}>
                上传 Ontology JSON 文件（actions, rules, dataobjects, events, links），系统将自动解析并创建快照
            </Typography.Paragraph>

            <Card title="上传 Ontology 文件" style={{ marginBottom: 24 }}>
                <Space direction="vertical" style={{ width: '100%' }}>
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept=".json"
                        style={{ display: 'none' }}
                        onChange={e => handleUpload(e.target.files)}
                    />
                    <Button
                        type="primary"
                        icon={<UploadOutlined />}
                        loading={uploading}
                        onClick={() => fileInputRef.current?.click()}
                        size="large"
                    >
                        选择 JSON 文件上传（支持多选）
                    </Button>
                    <Alert type="info" message="提示：上传多个文件时，系统会自动将同时上传的文件合并为一个快照" showIcon />
                </Space>
            </Card>

            <Card title={`快照列表 (${snapshots.length})`} style={{ marginBottom: 24 }}>
                <Table
                    rowKey="snapshotId"
                    dataSource={snapshots}
                    size="small"
                    pagination={{ pageSize: 5 }}
                    columns={[
                        { title: '快照 ID', dataIndex: 'snapshotId', width: 240, ellipsis: true },
                        { title: '来源文件', dataIndex: 'sourceFiles', render: (files: string[]) => files?.join(', ') || '-' },
                        {
                            title: '统计',
                            render: (_: any, row: OntologySnapshot) => (
                                <Space wrap>
                                    <Tag color="blue">Rules: {row.rulesCount}</Tag>
                                    <Tag color="green">DO: {row.dataObjectsCount}</Tag>
                                    <Tag color="orange">Actions: {row.actionsCount}</Tag>
                                    <Tag color="purple">Events: {row.eventsCount}</Tag>
                                    <Tag color="cyan">Links: {row.linksCount}</Tag>
                                </Space>
                            ),
                        },
                        {
                            title: '操作',
                            width: 160,
                            render: (_: any, row: OntologySnapshot) => (
                                <Space>
                                    <Button size="small" icon={<EyeOutlined />} onClick={() => handleView(row.snapshotId)}>查看</Button>
                                    <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(row.snapshotId)}>删除</Button>
                                </Space>
                            ),
                        },
                    ]}
                />
            </Card>

            {detail && (
                <Card title={`快照详情 — ${detail.snapshotId}`}>
                    <Descriptions bordered size="small" column={3}>
                        <Descriptions.Item label="Rules">{detail.rulesCount}</Descriptions.Item>
                        <Descriptions.Item label="DataObjects">{detail.dataObjectsCount}</Descriptions.Item>
                        <Descriptions.Item label="Actions">{detail.actionsCount}</Descriptions.Item>
                        <Descriptions.Item label="Events">{detail.eventsCount}</Descriptions.Item>
                        <Descriptions.Item label="Links">{detail.linksCount}</Descriptions.Item>
                        <Descriptions.Item label="来源">{detail.sourceFiles?.join(', ')}</Descriptions.Item>
                    </Descriptions>
                </Card>
            )}
        </div>
    );
}
