import { useEffect, useMemo, useState } from 'react';
import { CheckCircleOutlined, ClockCircleOutlined, CloudUploadOutlined, DownloadOutlined, EyeOutlined, FileExcelOutlined, LoadingOutlined, PlayCircleOutlined, ReloadOutlined, WarningOutlined } from '@ant-design/icons';
import { Button, Card, Col, Descriptions, Drawer, Form, message, Progress, Row, Space, Statistic, Table, Tabs, Tag, Timeline, Typography, Upload } from 'antd';
import type { UploadFile } from 'antd';
import PageHeader from '@/components/PageHeader';
import { api } from '@/services/api';
import type { IncomeReconciliationFile, IncomeReconciliationFileResult, IncomeReconciliationJob, IncomeReconciliationProgressEvent, IncomeReconciliationStatus } from '@/types/api';

type UploadNativeFile = File & { uid?: string };

const statusMeta: Record<IncomeReconciliationStatus, { text: string; color: string }> = {
  uploaded: { text: '已上传', color: 'blue' },
  parsing: { text: '解析中', color: 'processing' },
  parsed: { text: '已解析', color: 'green' },
  parse_failed: { text: '解析失败', color: 'red' },
  generating: { text: '生成中', color: 'processing' },
  generated: { text: '已生成', color: 'green' },
  generate_failed: { text: '生成失败', color: 'red' },
};

const fileStatusMeta: Record<string, { text: string; color: string }> = {
  pending: { text: '待解析', color: 'default' },
  parsing: { text: '解析中', color: 'processing' },
  success: { text: '成功', color: 'green' },
  failed: { text: '失败', color: 'red' },
  needs_ocr: { text: '需 OCR', color: 'gold' },
  warning: { text: '有警告', color: 'orange' },
};

const fileTypeLabels: Record<string, string> = {
  invoice_excel: '开票明细 Excel',
  cashflow_excel: '服务收支明细 Excel',
  settlement_excel: '结算单 Excel',
  settlement_pdf: '结算单 PDF',
  settlement_docx: '结算单 DOCX',
  settlement_file: '结算单文件',
};

const money = (value?: number | string | null) => `¥${Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const uploadFile = (file?: UploadNativeFile): UploadFile[] => file ? [{ uid: file.uid || file.name, name: file.name, status: 'done' }] : [];
const uploadFiles = (files: UploadNativeFile[]): UploadFile[] => files.map((file) => ({ uid: file.uid || file.name, name: file.name, status: 'done' }));
const fileKey = (file: UploadNativeFile | UploadFile) => file.uid || file.name;
const jsonBlock = (value: unknown) => <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{value ? JSON.stringify(value, null, 2) : '后端暂未返回该段解析结果'}</pre>;
const eventTime = (value?: string) => value ? new Date(value).toLocaleTimeString('zh-CN', { hour12: false }) : '--:--:--';
const eventRows = (event: IncomeReconciliationProgressEvent) => event.parsedRows ?? event.parsed_rows;
const eventValidRows = (event: IncomeReconciliationProgressEvent) => event.validRows ?? event.valid_rows;
const eventTextChars = (event: IncomeReconciliationProgressEvent) => event.textChars ?? event.text_chars;
const eventFileId = (event: IncomeReconciliationProgressEvent) => event.fileId ?? event.file_id;
const eventFileName = (event: IncomeReconciliationProgressEvent) => event.fileName ?? event.file_name;
const stageLabels: Record<string, string> = {
  excel_parse: 'Excel 解析',
  settlement_parse: '结算单解析',
  text_extract: '文本提取',
  ai_extract: 'AI 抽取',
  standardize: '字段标准化',
};

const eventColor = (event: IncomeReconciliationProgressEvent) => {
  if (event.type.includes('failed')) return 'red';
  if (event.type.includes('done')) return 'green';
  if (event.type.includes('started') || event.type === 'job_queued') return 'blue';
  return 'gray';
};

const eventDot = (event: IncomeReconciliationProgressEvent) => {
  if (event.type.includes('failed')) return <WarningOutlined />;
  if (event.type.includes('done')) return <CheckCircleOutlined />;
  if (event.type.includes('started') || event.type === 'job_queued') return <LoadingOutlined spin />;
  return <ClockCircleOutlined />;
};

export default function IncomeReconciliation() {
  const [invoiceFile, setInvoiceFile] = useState<UploadNativeFile>();
  const [cashflowFile, setCashflowFile] = useState<UploadNativeFile>();
  const [settlementFiles, setSettlementFiles] = useState<UploadNativeFile[]>([]);
  const [job, setJob] = useState<IncomeReconciliationJob>();
  const [mock, setMock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<IncomeReconciliationFileResult>();
  const [previewLoading, setPreviewLoading] = useState(false);
  const [parseEvents, setParseEvents] = useState<IncomeReconciliationProgressEvent[]>([]);
  const [eventPolling, setEventPolling] = useState(false);

  const files = job?.files || [];
  const currentStatus = job?.status;
  const isPolling = currentStatus === 'generating';
  const summary = job?.summary;
  const latestProgress = parseEvents.reduce((value, event) => Math.max(value, Number(event.progress || 0)), currentStatus === 'parsed' || currentStatus === 'generated' ? 100 : 0);
  const visibleEvents = (parseEvents.length ? parseEvents : [{ type: 'job_queued', message: '等待解析事件返回', createdAt: undefined }]).slice(-12).reverse();
  const currentEvent = [...parseEvents].reverse().find((event) => eventFileId(event));
  const currentFileId = currentEvent ? eventFileId(currentEvent) : undefined;
  const currentFile = currentFileId ? files.find((file) => file.fileId === currentFileId) : undefined;
  const currentStage = currentEvent?.stage;
  const fileSummary = {
    total: files.length,
    success: files.filter((file) => file.parseStatus === 'success').length,
    parsing: files.filter((file) => file.parseStatus === 'parsing' || file.parseStatus === 'pending').length,
    warning: files.filter((file) => file.parseStatus === 'warning' || file.parseStatus === 'needs_ocr').length,
    failed: files.filter((file) => file.parseStatus === 'failed').length,
  };

  useEffect(() => {
    if (!job?.jobId || !isPolling) return;
    const timer = window.setInterval(async () => {
      try {
        const result = await api.incomeReconciliationJob(job.jobId);
        setJob(result.value.data);
        setMock(result.mock);
      } catch (error) {
        message.warning(error instanceof Error ? error.message : '任务状态刷新失败');
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [job?.jobId, isPolling]);

  useEffect(() => {
    if (!job?.jobId || currentStatus !== 'parsing') {
      setEventPolling(false);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const result = await api.incomeReconciliationEvents(job.jobId);
        if (cancelled) return;
        setJob(result.value.data.job);
        setParseEvents(result.value.data.events.slice(-80));
        setMock(result.mock);
        setEventPolling(true);
      } catch (error) {
        if (!cancelled) {
          setEventPolling(false);
          message.warning(error instanceof Error ? error.message : '解析事件刷新失败');
        }
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      setEventPolling(false);
    };
  }, [job?.jobId, currentStatus]);

  const mainAction = useMemo(() => {
    if (!job) return { label: '上传并创建任务', icon: <CloudUploadOutlined /> };
    if (currentStatus === 'uploaded') return { label: '开始解析', icon: <PlayCircleOutlined /> };
    if (currentStatus === 'parsing') return { label: '解析中', icon: <ReloadOutlined spin /> };
    if (currentStatus === 'parse_failed') return { label: '重新解析', icon: <ReloadOutlined /> };
    if (currentStatus === 'parsed') return { label: '生成核对 Excel', icon: <FileExcelOutlined /> };
    if (currentStatus === 'generating') return { label: '生成中', icon: <ReloadOutlined spin /> };
    if (currentStatus === 'generate_failed') return { label: '重新生成', icon: <ReloadOutlined /> };
    return { label: '下载核对表', icon: <DownloadOutlined /> };
  }, [currentStatus, job]);

  const createJob = async () => {
    if (!invoiceFile || !cashflowFile || !settlementFiles.length) {
      message.warning('请先选择开票明细、服务收支明细和至少一个结算单文件');
      return;
    }
    setBusy(true);
    try {
      const result = await api.createIncomeReconciliationJob({ invoiceFile, cashflowFile, settlementFiles });
      setJob(result.value.data);
      setMock(result.mock);
      message.success('任务已创建');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '任务创建失败');
    } finally {
      setBusy(false);
    }
  };

  const runMainAction = async () => {
    if (!job) return createJob();
    if (currentStatus === 'generated') {
      window.open(job.downloadUrl || api.incomeReconciliationDownloadUrl(job.jobId), '_blank');
      return;
    }
    if (currentStatus === 'uploaded' || currentStatus === 'parse_failed') {
      setBusy(true);
      setParseEvents([{ type: 'job_queued', message: '正在启动后台解析', createdAt: new Date().toISOString(), progress: 1 }]);
      try {
        const result = await api.parseIncomeReconciliationJob(job.jobId, true);
        setJob(result.value.data);
        setMock(result.mock);
        message.success('已开始解析');
      } catch (error) {
        message.error(error instanceof Error ? error.message : '解析启动失败');
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    try {
      const result = await api.generateIncomeReconciliationExcel(job.jobId);
      setJob(result.value.data);
      setMock(result.mock);
      message.success(currentStatus === 'parsed' || currentStatus === 'generate_failed' ? '已开始生成核对表' : '操作已提交');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const openPreview = async (file: IncomeReconciliationFile) => {
    if (!job?.jobId) return;
    setPreviewLoading(true);
    try {
      const result = await api.incomeReconciliationFileResult(job.jobId, file.fileId);
      setPreview(result.value.data);
      setMock(result.mock);
    } catch (error) {
      setPreview({ fileId: file.fileId, fileName: file.fileName, rawText: file.errorReason || file.parseReason || '后端解析预览接口暂不可用', aiExtractedJson: null, standardJson: file });
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <>
      <PageHeader title="收入核对" subtitle="上传开票、到账和结算单材料，生成技术服务收入链路核对表" mock={mock} />
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={9}>
          <Card className="audit-card" title="原始材料">
            <Form layout="vertical">
              <Form.Item label="开票明细 Excel">
                <Upload accept=".xlsx,.xls" maxCount={1} fileList={uploadFile(invoiceFile)} beforeUpload={(file) => { setInvoiceFile(file as UploadNativeFile); return false; }} onRemove={() => { setInvoiceFile(undefined); return true; }}>
                  <Button icon={<FileExcelOutlined />}>选择开票明细</Button>
                </Upload>
              </Form.Item>
              <Form.Item label="服务收支明细 Excel">
                <Upload accept=".xlsx,.xls" maxCount={1} fileList={uploadFile(cashflowFile)} beforeUpload={(file) => { setCashflowFile(file as UploadNativeFile); return false; }} onRemove={() => { setCashflowFile(undefined); return true; }}>
                  <Button icon={<FileExcelOutlined />}>选择服务收支明细</Button>
                </Upload>
              </Form.Item>
              <Form.Item
                label={<Space size={8}><span>结算单文件</span>{settlementFiles.length > 0 && <Tag color="blue">已选 {settlementFiles.length}</Tag>}</Space>}
              >
                <Upload
                  className="settlement-upload"
                  multiple
                  accept=".xlsx,.xls,.pdf,.doc,.docx"
                  fileList={uploadFiles(settlementFiles)}
                  beforeUpload={(file) => { setSettlementFiles((current) => [...current, file as UploadNativeFile]); return false; }}
                  onRemove={(file) => { setSettlementFiles((current) => current.filter((item) => fileKey(item) !== fileKey(file))); return true; }}
                >
                  <Button icon={<CloudUploadOutlined />}>选择多个结算单</Button>
                </Upload>
              </Form.Item>
              <Button type="primary" block size="large" loading={busy || isPolling || currentStatus === 'parsing'} disabled={currentStatus === 'parsing'} icon={mainAction.icon} onClick={runMainAction}>{mainAction.label}</Button>
            </Form>
          </Card>
        </Col>
        <Col xs={24} xl={15}>
          <Card className="audit-card" title="任务状态">
            <Descriptions column={2} items={[
              { key: 'jobId', label: '任务 ID', children: job?.jobId || '尚未创建' },
              { key: 'status', label: '状态', children: currentStatus ? <Tag color={statusMeta[currentStatus]?.color}>{statusMeta[currentStatus]?.text}</Tag> : <Tag>待上传</Tag> },
            ]} />
            {(currentStatus === 'parsing' || parseEvents.length > 0) && (
              <div className="parse-progress">
                <Typography.Text type="secondary">总体进度</Typography.Text>
                <Progress percent={Math.min(Math.round(latestProgress), 100)} status={currentStatus === 'parse_failed' ? 'exception' : currentStatus === 'parsed' ? 'success' : 'active'} />
              </div>
            )}
          </Card>
          {(currentStatus === 'parsing' || parseEvents.length > 0) && (
            <Card
              className="audit-card"
              title="解析过程"
              style={{ marginTop: 16 }}
              extra={<Space size={6}><span className={eventPolling ? 'stream-dot is-live' : 'stream-dot'} /> <Typography.Text type={eventPolling ? 'success' : 'secondary'}>{eventPolling ? '轮询刷新中' : '等待刷新'}</Typography.Text></Space>}
            >
              <div className="parse-timeline-scroll">
                <Timeline
                  className="parse-timeline"
                  items={visibleEvents.map((event, index) => ({
                    color: eventColor(event),
                    dot: eventDot(event),
                    children: (
                      <div className="parse-event" key={`${event.seq || index}-${event.type}`}>
                        <div className="parse-event-main">
                          <Typography.Text className="parse-event-time">{eventTime(event.createdAt)}</Typography.Text>
                          <Typography.Text className="parse-event-message" strong>{event.message || event.type}</Typography.Text>
                        </div>
                        <div className="parse-event-meta">
                          {eventFileName(event) && <span>{eventFileName(event)}</span>}
                          {event.stage && <Tag>{stageLabels[event.stage] || event.stage}</Tag>}
                          {eventRows(event) != null && <span>{eventRows(event)} 行</span>}
                          {eventValidRows(event) != null && <span>{eventValidRows(event)} 有效</span>}
                          {eventTextChars(event) != null && <span>{eventTextChars(event)} 字</span>}
                          {event.confidence != null && <span>置信度 {Math.round(event.confidence * 100)}%</span>}
                          {event.reason && <Typography.Text type="danger">{event.reason}</Typography.Text>}
                        </div>
                      </div>
                    ),
                  }))}
                />
              </div>
              {currentEvent && (
                <div className="current-file-panel">
                  <div>
                    <Typography.Text type="secondary">当前处理文件</Typography.Text>
                    <Typography.Title level={5}>{eventFileName(currentEvent) || currentFile?.fileName}</Typography.Title>
                  </div>
                  <Space wrap>
                    {['text_extract', 'ai_extract', 'standardize', 'settlement_parse'].map((stage) => (
                      <Tag key={stage} color={currentStage === stage ? 'blue' : currentEvent.type.includes('done') ? 'green' : 'default'}>{stageLabels[stage]}</Tag>
                    ))}
                  </Space>
                </div>
              )}
            </Card>
          )}
          <Row gutter={16} style={{ marginTop: 16 }}>
            {[
              ['确认收入总额', money(summary?.confirmedRevenue), '按结算单/发票确认'],
              ['已到账金额', money(summary?.receivedAmount), '按回款记录统计'],
              ['未到账金额', money(summary?.unreceivedAmount), '确认收入 - 已到账'],
              ['待财务确认', `${summary?.manualCheckRequiredCount || 0} 笔`, `异常 ${summary?.abnormalCount || 0} 笔`],
            ].map(([title, value, note], index) => <Col xs={24} md={12} xl={6} key={title}><Card className="audit-card"><Statistic title={title} value={value} valueStyle={{ color: index === 2 ? '#c43d4f' : '#17384a', fontSize: 22 }} /><Typography.Text type="secondary">{note}</Typography.Text></Card></Col>)}
          </Row>
        </Col>
      </Row>
      <Card
        className="audit-card file-list-card"
        title="文件解析列表"
        style={{ marginTop: 16 }}
        extra={<Space wrap size={[8, 4]}><Tag>共 {fileSummary.total} 个文件</Tag><Tag color="green">成功 {fileSummary.success}</Tag><Tag color="processing">待/解析中 {fileSummary.parsing}</Tag><Tag color="orange">警告 {fileSummary.warning}</Tag><Tag color="red">失败 {fileSummary.failed}</Tag></Space>}
      >
        <Table rowKey="fileId" dataSource={files} pagination={false} scroll={{ y: 320, x: 1040 }} tableLayout="fixed" columns={[
          { title: '文件名', dataIndex: 'fileName', width: 260, ellipsis: true, render: (value: string) => <Typography.Text title={value} ellipsis>{value}</Typography.Text> },
          { title: '类型', dataIndex: 'fileType', width: 150, ellipsis: true, render: (value: string) => fileTypeLabels[value] || value },
          { title: '状态', dataIndex: 'parseStatus', width: 90, render: (value: string) => <Tag color={fileStatusMeta[value]?.color}>{fileStatusMeta[value]?.text || value}</Tag> },
          { title: '行数', dataIndex: 'parsedRows', width: 80, render: (value) => value ?? '-' },
          { title: '有效行数', dataIndex: 'validRows', width: 100, render: (value) => value ?? '-' },
          { title: '置信度', dataIndex: 'confidence', width: 90, render: (value?: number) => value == null ? '-' : `${Math.round(value * 100)}%` },
          { title: '原因', width: 150, ellipsis: true, render: (_, record) => record.errorReason || record.parseReason || '-' },
          { title: '操作', width: 120, render: (_, record) => <Button icon={<EyeOutlined />} onClick={() => openPreview(record)}>查看解析结果</Button> },
        ]} />
      </Card>
      <Drawer width={720} title={preview?.fileName || '解析结果'} open={!!preview || previewLoading} loading={previewLoading} onClose={() => setPreview(undefined)}>
        {preview && <Tabs items={[
          { key: 'raw', label: 'OCR/文本', children: <pre style={{ whiteSpace: 'pre-wrap' }}>{preview.rawText || '后端暂未返回 OCR/文本内容'}</pre> },
          { key: 'ai', label: 'AI 抽取 JSON', children: jsonBlock(preview.aiExtractedJson) },
          { key: 'standard', label: '标准 JSON', children: jsonBlock(preview.standardJson) },
        ]} />}
      </Drawer>
    </>
  );
}
