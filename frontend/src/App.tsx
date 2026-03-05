import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, theme as antTheme } from 'antd';
import AppLayout from './AppLayout';
import DashboardPage from './pages/DashboardPage';
import OntologyPage from './pages/OntologyPage';
import BusinessDataPage from './pages/BusinessDataPage';
import ComponentTestPage from './pages/ComponentTestPage';
import UnifiedTestPage from './pages/UnifiedTestPage';
import ExecutionPage from './pages/ExecutionPage';
import HistoryPage from './pages/HistoryPage';
import ReportPage from './pages/ReportPage';
import ApiKeyPage from './pages/ApiKeyPage';
import TestCaseLibraryPage from './pages/TestCaseLibraryPage';

function App() {
  return (
    <ConfigProvider
      theme={{
        algorithm: antTheme.darkAlgorithm,
        token: {
          colorPrimary: '#22d3ee',
          colorInfo: '#38bdf8',
          colorSuccess: '#4ade80',
          colorWarning: '#fbbf24',
          colorError: '#fb7185',
          colorBgBase: '#06080f',
          colorBgContainer: '#0b1020',
          colorTextBase: '#e6ecff',
          colorBorder: '#24304f',
          borderRadius: 12,
          fontFamily: "'Space Grotesk', 'Noto Sans SC', 'PingFang SC', sans-serif",
        },
        components: {
          Layout: { bodyBg: '#06080f', siderBg: '#070b16', headerBg: '#070b16' },
          Menu: {
            darkItemBg: '#070b16',
            darkSubMenuItemBg: '#070b16',
            darkItemColor: '#9ba6c7',
            darkItemHoverColor: '#e8eeff',
            darkItemSelectedColor: '#e8eeff',
            darkItemSelectedBg: 'rgba(34, 211, 238, 0.16)',
          },
          Card: {
            colorBgContainer: 'rgba(11, 16, 32, 0.75)',
            colorBorderSecondary: '#273458',
          },
          Table: {
            headerBg: 'rgba(14, 21, 40, 0.92)',
            headerColor: '#b9c7e8',
            colorBgContainer: 'rgba(9, 14, 28, 0.7)',
            borderColor: '#253356',
            rowHoverBg: 'rgba(34, 211, 238, 0.08)',
          },
          Input: { colorBgContainer: '#0a1226', colorBorder: '#2a3a61', activeBorderColor: '#22d3ee' },
          Select: { colorBgContainer: '#0a1226', colorBorder: '#2a3a61', optionSelectedBg: 'rgba(34, 211, 238, 0.14)' },
          Button: { primaryShadow: '0 10px 28px rgba(56, 189, 248, 0.32)' },
        },
      }}
    >
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/ontology" element={<OntologyPage />} />
            <Route path="/business-data" element={<BusinessDataPage />} />
            <Route path="/test-case-library" element={<TestCaseLibraryPage />} />
            <Route path="/component-test/:tab?" element={<ComponentTestPage />} />
            <Route path="/unified-test" element={<UnifiedTestPage />} />
            <Route path="/execution" element={<ExecutionPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/reports" element={<ReportPage />} />
            <Route path="/api-keys" element={<ApiKeyPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  );
}

export default App;
