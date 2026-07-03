import { defineConfig } from '@umijs/max';

export default defineConfig({
  npmClient: 'pnpm',
  antd: {},
  model: {},
  initialState: {},
  request: {},
  layout: false,
  history: { type: 'browser' },
  routes: [
    { path: '/', redirect: '/workbench' },
    { path: '/workbench', component: 'workbench' },
    { path: '/imports', component: 'imports' },
    { path: '/imports/:id', component: 'imports/detail' },
    { path: '/data-preview', component: 'data-preview' },
    { path: '/metrics', component: 'metrics' },
    { path: '*', component: '404' },
  ],
  proxy: { '/api': { target: process.env.API_PROXY_TARGET || 'http://127.0.0.1:8000', changeOrigin: true } },
  title: '现金流数据验证工作台',
});
