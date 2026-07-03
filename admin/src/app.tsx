import type { ReactNode } from 'react';
import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import AppLayout from './components/AppLayout';
import './global.less';

export function rootContainer(container: ReactNode) {
  return <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#167d8d', borderRadius: 10, colorBgLayout: '#f3f6f8' } }}><AntApp><AppLayout>{container}</AppLayout></AntApp></ConfigProvider>;
}
