import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Typography, theme } from 'antd';
import type { MenuProps } from 'antd';
import {
    DashboardOutlined,
    DatabaseOutlined,
    AppstoreOutlined,
    ThunderboltOutlined,
    SafetyOutlined,
    LinkOutlined,
    ExperimentOutlined,
    PlayCircleOutlined,
    HistoryOutlined,
    BarChartOutlined,
    MenuFoldOutlined,
    MenuUnfoldOutlined,
    FolderOpenOutlined,
    KeyOutlined,
    BookOutlined,
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
        ],
    },
    { key: '/business-data', icon: <FolderOpenOutlined />, label: '业务数据管理' },
    { key: '/test-case-library', icon: <BookOutlined />, label: '测试用例库' },
    {
        key: 'component-test-group',
        icon: <AppstoreOutlined />,
        label: '分部测试',
        children: [
            { key: '/component-test/dataobjects', icon: <DatabaseOutlined />, label: 'DataObjects' },
            { key: '/component-test/actions_events', icon: <ThunderboltOutlined />, label: 'Actions&Events' },
            { key: '/component-test/rules', icon: <SafetyOutlined />, label: 'Rules' },
            { key: '/component-test/links', icon: <LinkOutlined />, label: 'Links' },
        ],
    },
    {
        key: 'unified-test-group',
        icon: <ExperimentOutlined />,
        label: '统一测试',
        children: [
            { key: '/unified-test', icon: <ExperimentOutlined />, label: '用例生成' },
            { key: '/execution', icon: <PlayCircleOutlined />, label: '执行测试' },
            { key: '/history', icon: <HistoryOutlined />, label: '历史记录' },
        ],
    },
    { key: '/reports', icon: <BarChartOutlined />, label: '测试报告' },
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
        if (p === '/ontology') return ['ontology-group'];
        if (p.startsWith('/component-test')) return ['component-test-group'];
        if (['/unified-test', '/execution', '/history'].includes(p)) return ['unified-test-group'];
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
