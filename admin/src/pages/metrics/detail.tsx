import { ArrowLeftOutlined, CheckCircleOutlined, DatabaseOutlined, FunctionOutlined } from '@ant-design/icons';
import { history } from '@umijs/max';
import { Alert, Button, Card, Result, Space, Tag, Typography } from 'antd';
import PageHeader from '@/components/PageHeader';

interface RuleDetail {
  code: string;
  name: string;
  formula: string;
  source: string;
  description: string;
}

const rules: RuleDetail[] = [
  {
    code: 'availableCash',
    name: '当前可用现金',
    formula: '各账户在核算日之前的最新可用余额之和',
    source: '账户余额表 account_balance',
    description: '先为每个账户找到不晚于核算日的最新快照日期，再汇总这些快照中的可用余额。当前版本不包含短期理财、备用金或已锁定支出的调整。',
  },
  {
    code: 'expectedCollections',
    name: '本月预计回款',
    formula: 'Σ 本月预计到账的应收未回金额',
    source: '应收款表 receivable + 实际回款表 collection',
    description: '应收未回金额等于应收金额减去有效回款。预计到账日期优先使用预计到账日，未填写时使用约定到账日；日期落在核算月内的未回金额参与汇总。',
  },
  {
    code: 'actualCollections',
    name: '本月实际回款',
    formula: 'Σ 核算月内的有效实际回款',
    source: '实际回款表 collection',
    description: '按照回款日期筛选核算月第一天至最后一天的记录，只统计状态为 active 的回款金额。',
  },
  {
    code: 'plannedExpenses',
    name: '本月计划支出',
    formula: 'Σ 核算月内未取消的计划支出',
    source: '计划支出表 planned_expense',
    description: '按照计划支出日期筛选核算月内的记录，审批状态为 planned、pending 或 approved 且数据状态为 active 时参与汇总。',
  },
  {
    code: 'cashGap',
    name: '本月现金流缺口',
    formula: 'max(本月剩余计划支出 - 当前可用现金 - 本月剩余预计回款, 0)',
    source: '当前可用现金、应收未回金额和计划支出的实时计算结果',
    description: '只计算从核算日至当月最后一天的剩余预计回款与剩余计划支出。结果小于或等于零时按零返回，表示当前预测没有现金缺口。',
  },
  {
    code: 'overdueAmount',
    name: '逾期回款金额',
    formula: 'Σ 已超过约定到账日的应收未回金额',
    source: '应收款表 receivable + 实际回款表 collection',
    description: '应收仍有未回金额，并且约定到账日早于核算日时，计入逾期金额。已全部回款的应收不再计算逾期。',
  },
  {
    code: 'todayTaskCount',
    name: '今日待处理事项',
    formula: 'Σ 到期且尚未完成的当前批次任务',
    source: '任务表 task',
    description: '统计当前已发布批次中，到期日不晚于核算日，状态为 pending 或 in_progress 的任务。',
  },
];

function currentMetricCode() {
  return new URLSearchParams(history.location.search).get('metric');
}

export default function MetricDetail() {
  const selectedCode = currentMetricCode();
  const selectedRule = rules.find((rule) => rule.code === selectedCode);

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => history.push('/metrics')}
          aria-label="返回指标核对"
        >
          返回指标核对
        </Button>
      </Space>
      <PageHeader
        title="计算规则明细"
        subtitle="当前 V0.1 后端实现口径；指标在请求时实时计算，不单独保存结果表"
      />
      <Alert
        type="warning"
        showIcon
        message="规则状态：待 CFO 确认"
        description="本页描述当前代码实际执行的规则，不代表最终财务口径。"
        style={{ marginBottom: 16 }}
      />
      {selectedRule ? (
        <div style={{ display: 'grid', gap: 12 }}>
          {[selectedRule].map((rule) => (
            <Card
              id={rule.code}
              key={rule.code}
              className="audit-card"
              style={{ borderColor: '#167d8d', boxShadow: '0 0 0 2px rgba(22,125,141,.12)' }}
              title={
                <Space wrap>
                  <Typography.Text strong>{rule.name}</Typography.Text>
                  <Tag color="cyan">当前查看</Tag>
                </Space>
              }
              extra={<Tag color="gold">待 CFO 确认</Tag>}
            >
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Space align="start">
                  <FunctionOutlined style={{ color: '#167d8d', marginTop: 4 }} />
                  <div>
                    <Typography.Text type="secondary">计算公式</Typography.Text>
                    <div className="amount" style={{ marginTop: 3 }}>{rule.formula}</div>
                  </div>
                </Space>
                <Space align="start">
                  <DatabaseOutlined style={{ color: '#167d8d', marginTop: 4 }} />
                  <div>
                    <Typography.Text type="secondary">数据来源</Typography.Text>
                    <div style={{ marginTop: 3 }}>{rule.source}</div>
                  </div>
                </Space>
                <Space align="start">
                  <CheckCircleOutlined style={{ color: '#167d8d', marginTop: 4 }} />
                  <div>
                    <Typography.Text type="secondary">当前实现说明</Typography.Text>
                    <Typography.Paragraph style={{ margin: '3px 0 0', lineHeight: 1.75 }}>
                      {rule.description}
                    </Typography.Paragraph>
                  </div>
                </Space>
              </Space>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="audit-card">
          <Result
            status="404"
            title="未找到指标规则"
            subTitle="请从指标核对页面选择一个指标查看。"
            extra={<Button type="primary" onClick={() => history.push('/metrics')}>返回指标核对</Button>}
          />
        </Card>
      )}
    </>
  );
}
