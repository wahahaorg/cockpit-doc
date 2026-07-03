import type { PropsWithChildren } from 'react';
import { Alert, Button, Empty, Skeleton } from 'antd';

export default function AsyncState({ loading, error, empty, onRetry, children }: PropsWithChildren<{ loading?: boolean; error?: string; empty?: boolean; onRetry?: () => void }>) {
  if (loading) return <Skeleton active paragraph={{ rows: 6 }} />;
  if (error) return <Alert type="error" showIcon message="数据加载失败" description={error} action={onRetry && <Button onClick={onRetry}>重试</Button>} />;
  if (empty) return <Empty description="暂无数据" />;
  return <>{children}</>;
}
