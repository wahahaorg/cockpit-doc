import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid(defineConfig({
  // GitHub Pages 部署在 /cockpit-doc/ 子路径下，必须设置 base
  // 如果用自定义域名则改为 '/'
  base: '/cockpit-doc/',

  title: 'CEO 现金流驾驶舱',
  description: 'V3 MVP 技术文档站',
  lang: 'zh-CN',

  themeConfig: {
    logo: '💹',
    siteTitle: 'CEO 现金流驾驶舱',

    nav: [
      { text: '首页', link: '/' },
      { text: 'V3 实现', link: '/v3/delivery-index' },
      { text: '模块方案', link: '/modules/cashflow' },
      { text: 'V1.0 规划', link: '/v1/tech-plan' },
    ],

    sidebar: {
      '/v3/': [
        {
          text: 'V3 交付物',
          items: [
            { text: '📋 交付索引', link: '/v3/delivery-index' },
            { text: '🗄️ 数据库表结构与字段字典', link: '/v3/db-schema' },
            { text: '📐 计算规则与 CFO 确认表', link: '/v3/calc-rules' },
            { text: '🔌 API 设计', link: '/v3/api-design' },
            { text: '🔄 后端数据流图', link: '/v3/data-flow' },
            { text: '📝 后端主要实现说明', link: '/v3/implementation' },
            { text: '❓ 待确认口径清单', link: '/v3/pending-qa' },
          ],
        },
      ],
      '/modules/': [
        {
          text: '模块技术方案',
          items: [
            { text: '📈 30/60/90 天现金流预测', link: '/modules/cashflow' },
            { text: '⚠️ 回款风险 Top 3', link: '/modules/receivable-risk' },
            { text: '💸 付款建议 Top 3', link: '/modules/payment-recommendation' },
            { text: '🎯 今日老板要拍板', link: '/modules/boss-decision' },
          ],
        },
      ],
      '/v1/': [
        {
          text: 'V1.0 规划',
          items: [
            { text: '🚀 MVP 技术方案讨论稿', link: '/v1/tech-plan' },
            { text: '🗺️ 落地执行方案', link: '/v1/execution-plan' },
            { text: '📏 产品边界说明', link: '/v1/product-boundary' },
            { text: '📊 字段算法与数据来源', link: '/v1/field-algo' },
            { text: '📥 财务数据接入说明', link: '/v1/data-ingestion' },
            { text: '🤝 团队 Agent 交接说明', link: '/v1/agent-handoff' },
          ],
        },
      ],
    },

    socialLinks: [],

    footer: {
      message: '内部技术文档 · 当前规则待 CFO 确认，不作为正式经营结论',
      copyright: 'CEO 现金流驾驶舱 V3 MVP',
    },

    search: {
      provider: 'local',
    },

    outline: {
      level: [2, 3],
      label: '本页目录',
    },

    docFooter: {
      prev: '上一篇',
      next: '下一篇',
    },

    lastUpdated: {
      text: '最后更新',
    },
  },

  markdown: {
    lineNumbers: true,
  },

  // Mermaid 配置
  mermaid: {
    theme: 'neutral',
  },
}))
