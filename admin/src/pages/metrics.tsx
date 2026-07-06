import { Card, Col, Descriptions, Row, Table, Tag } from "antd";
import { history } from "@umijs/max";
import AsyncState from "@/components/AsyncState";
import PageHeader from "@/components/PageHeader";
import { useApi } from "@/hooks/useApi";
import { api } from "@/services/api";
const names: Record<string, string> = {
  availableCash: "当前可用现金",
  expectedCollections: "本月预计回款",
  actualCollections: "本月实际回款",
  plannedExpenses: "本月计划支出",
  cashGap: "本月现金流缺口",
  overdueAmount: "逾期回款金额",
  todayTaskCount: "今日待处理事项",
};
const formulas: Record<string, string> = {
  availableCash: "Σ 最新账户余额",
  expectedCollections: "Σ 本月约定到账且未结清应收",
  actualCollections: "Σ 本月实际回款",
  plannedExpenses: "Σ 本月有效计划支出",
  cashGap: "max(计划支出 - 可用现金 - 预计回款, 0)",
  overdueAmount: "Σ 到期日早于核算日的未回金额",
  todayTaskCount: "Σ 规则生成且当日未完成任务",
};
export default function Metrics() {
  const q = useApi(api.overview, []);
  const o = q.data?.data;
  const rows = o
    ? Object.entries(o.metrics).map(([code, value]) => ({
        code,
        name: names[code],
        value,
        formula: formulas[code],
      }))
    : [];
  return (
    <>
      <PageHeader
        title="指标核对"
        subtitle="逐项核查结果、公式版本与复核状态，形成 CFO 口径确认依据"
        mock={q.mock}
      />
      <AsyncState loading={q.loading} error={q.error} onRetry={q.reload}>
        {o && (
          <>
            <Row gutter={16}>
              <Col span={24}>
                <Card className="audit-card">
                  <Descriptions
                    column={4}
                    items={[
                      { key: "date", label: "计算日期", children: o.asOfDate },
                      { key: "batch", label: "数据批次", children: o.batchId },
                      {
                        key: "rule",
                        label: "规则版本",
                        children: o.ruleVersion,
                      },
                      {
                        key: "review",
                        label: "复核状态",
                        children: <Tag color="gold">{o.reviewStatus}</Tag>,
                      },
                    ]}
                  />
                </Card>
              </Col>
            </Row>
            <Card
              className="audit-card"
              style={{ marginTop: 16 }}
              title="计算结果与口径"
            >
              <Table
                rowKey="code"
                pagination={false}
                dataSource={rows}
                columns={[
                  { title: "指标", dataIndex: "name" },
                  {
                    title: "结果",
                    dataIndex: "value",
                    render: (v, record) => (
                      <span className="amount">
                        {record.code === "todayTaskCount"
                          ? `${v} 项`
                          : `¥${Number(v).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}`}
                      </span>
                    ),
                  },
                  { title: "V0.1 公式", dataIndex: "formula" },
                  {
                    title: "复核",
                    render: () => <Tag color="gold">待 CFO 确认</Tag>,
                  },
                  {
                    title: "依据",
                    render: (_, record) => (
                      <a onClick={() => history.push(`/metrics/detail?metric=${record.code}`)}>
                        查看计算明细
                      </a>
                    ),
                  },
                ]}
              />
            </Card>
            {o.warnings.map((w) => (
              <p className="source-note" key={w}>
                {w}
              </p>
            ))}
          </>
        )}
      </AsyncState>
    </>
  );
}
