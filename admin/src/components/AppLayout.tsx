import { useSyncExternalStore, type PropsWithChildren } from 'react';
import { AuditOutlined, DatabaseOutlined, FileSearchOutlined, FundOutlined, ImportOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { Layout, Menu, Space, Tag, Typography } from 'antd';
import { history } from '@umijs/max';

const items = [
  { key: '/workbench', icon: <FundOutlined />, label: '工作台' },
  { key: '/imports', icon: <ImportOutlined />, label: '导入批次' },
  { key: '/income-reconciliation', icon: <AuditOutlined />, label: '收入核对' },
  { key: '/data-preview', icon: <DatabaseOutlined />, label: '数据预览' },
  { key: '/metrics', icon: <FileSearchOutlined />, label: '指标核对' },
];

export default function AppLayout({ children }: PropsWithChildren) {
  const pathname = useSyncExternalStore(
    (onStoreChange) => history.listen(onStoreChange),
    () => history.location.pathname,
    () => '/',
  );
  const selectedPath = pathname.startsWith('/imports')
    ? '/imports'
    : pathname.startsWith('/income-reconciliation')
      ? '/income-reconciliation'
      : pathname.startsWith('/metrics')
        ? '/metrics'
        : pathname;

  return <Layout style={{ minHeight: '100vh' }}>
    <Layout.Sider width={232} theme="light" style={{ borderRight: '1px solid #e5ebef' }}>
      <div style={{ padding: '24px 22px 18px' }}>
        <Space align="start"><SafetyCertificateOutlined style={{ color: '#167d8d', fontSize: 28 }} /><div><Typography.Title level={4} style={{ margin: 0 }}>现金流验证台</Typography.Title><Typography.Text type="secondary">V3 · 财务审计工作台</Typography.Text></div></Space>
      </div>
      <Menu mode="inline" selectedKeys={[selectedPath]} items={items} onClick={({ key }) => history.push(key)} />
    </Layout.Sider>
    <Layout>
      <Layout.Header style={{ background: 'rgba(255,255,255,.92)', borderBottom: '1px solid #e5ebef', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 28px' }}>
        <Typography.Text strong>CEO 现金流驾驶舱 · 数据验证中心</Typography.Text>
        <Space><Tag color="gold">规则待 CFO 复核</Tag><Tag>单管理员模式</Tag></Space>
      </Layout.Header>
      <Layout.Content style={{ padding: 28, maxWidth: 1500, width: '100%', margin: '0 auto' }}>{children}</Layout.Content>
    </Layout>
  </Layout>;
}
