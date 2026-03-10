import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Typography, theme } from 'antd';
import type { MenuProps } from 'antd';
import {
    DashboardOutlined,
    DatabaseOutlined,
    ExperimentOutlined,
    PlayCircleOutlined,
    HistoryOutlined,
    BarChartOutlined,
    MenuFoldOutlined,
    MenuUnfoldOutlined,
    FolderOpenOutlined,
    KeyOutlined,
    BookOutlined,
    SafetyCertificateOutlined,
    RobotOutlined,
    SwapOutlined,
    BulbOutlined,
    FileSearchOutlined,
    AppstoreOutlined,
} from '@ant-design/icons';

const { Sider, Content } = Layout;
type MenuItem = Required<MenuProps>['items'][number];

const menuItems: MenuItem[] = [
    { key: '/', icon: <DashboardOutlined />, label: '仪表盘' },
    {
        key: 'ontology-group',
        icon: <DatabaseOutlined />,
        label: '本体管理',
        children: [
            { key: '/ontology', icon: <DatabaseOutlined />, label: '上传与拉取' },
            { key: '/validation', icon: <SafetyCertificateOutlined />, label: '有效性检验' },
        ],
    },
    {
        key: 'business-data-group',
        icon: <FolderOpenOutlined />,
        label: '业务数据管理',
        children: [
            { key: '/business-data/real', icon: <FolderOpenOutlined />, label: '真实业务数据' },
            { key: '/business-data/simulated', icon: <RobotOutlined />, label: '模拟业务数据' },
        ],
    },
    { key: '/test-case-library', icon: <BookOutlined />, label: '测试用例库' },
    {
        key: 'unified-test-group',
        icon: <ExperimentOutlined />,
        label: '统一测试',
        children: [
            { key: '/execution', icon: <PlayCircleOutlined />, label: '执行测试' },
            { key: '/cross-test', icon: <SwapOutlined />, label: '交叉测试' },
            { key: '/history', icon: <HistoryOutlined />, label: '历史记录' },
        ],
    },
    {
        key: 'results-group',
        icon: <FileSearchOutlined />,
        label: '测试结果',
        children: [
            { key: '/reports', icon: <BarChartOutlined />, label: '测试报告' },
            { key: '/coverage-matrix', icon: <AppstoreOutlined />, label: '覆盖矩阵' },
            { key: '/optimization', icon: <BulbOutlined />, label: '分析优化' },
        ],
    },
    { key: '/api-keys', icon: <KeyOutlined />, label: 'API Key 管理' },
];

export default function AppLayout() {
    const [collapsed, setCollapsed] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();
    const { token } = theme.useToken();

    const selectedKeys = [location.pathname];
    const defaultOpenKeys = (() => {
        const p = location.pathname;
        if (p === '/ontology' || p === '/validation') return ['ontology-group'];
        if (p.startsWith('/business-data')) return ['business-data-group'];
        if (['/execution', '/cross-test', '/history'].includes(p)) return ['unified-test-group'];
        if (['/reports', '/coverage-matrix', '/optimization'].includes(p)) return ['results-group'];
        return [];
    })();

    return (
        <Layout style={{ minHeight: '100vh' }}>
            <Sider
                collapsible
                collapsed={collapsed}
                onCollapse={setCollapsed}
                trigger={null}
                width={220}
                style={{
                    background: token.colorBgContainer,
                    borderRight: `1px solid ${token.colorBorderSecondary}`,
                }}
            >
                <div style={{
                    height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderBottom: `1px solid ${token.colorBorderSecondary}`,
                }}>
                    <Typography.Title level={4} style={{ margin: 0, color: token.colorPrimary, whiteSpace: 'nowrap' }}>
                        {collapsed ? 'OT' : 'Ontology 测试平台'}
                    </Typography.Title>
                </div>
                <Menu
                    mode="inline"
                    selectedKeys={selectedKeys}
                    defaultOpenKeys={defaultOpenKeys}
                    items={menuItems}
                    onClick={({ key }) => { if (key.startsWith('/')) navigate(key); }}
                    style={{ border: 'none' }}
                />
            </Sider>
            <Layout>
                <Layout.Header style={{
                    padding: '0 24px', background: token.colorBgContainer,
                    display: 'flex', alignItems: 'center',
                    borderBottom: `1px solid ${token.colorBorderSecondary}`,
                }}>
                    <div style={{ cursor: 'pointer', fontSize: 18 }} onClick={() => setCollapsed(!collapsed)}>
                        {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                    </div>
                    <Typography.Text style={{ marginLeft: 16, color: token.colorTextSecondary }}>
                        RAAS Ontology Automated Testing
                    </Typography.Text>
                </Layout.Header>
                <Content style={{
                    margin: 24, padding: 24,
                    background: token.colorBgContainer,
                    borderRadius: token.borderRadius,
                    minHeight: 280,
                    overflow: 'auto',
                }}>
                    <Outlet />
                </Content>
            </Layout>
        </Layout>
    );
}
