import { useEffect, useMemo, useState } from 'react';
import { CloudUploadOutlined, DownloadOutlined, EyeOutlined, FileExcelOutlined, PlayCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, Card, Col, Descriptions, Drawer, Form, message, Row, Space, Statistic, Table, Tabs, Tag, Typography, Upload } from 'antd';
import type { UploadFile } from 'antd';
import PageHeader from '@/components/PageHeader';
import { api } from '@/services/api';
import type { IncomeReconciliationFile, IncomeReconciliationFileResult, IncomeReconciliationJob, IncomeReconciliationStatus } from '@/types/api';

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
const jsonBlock = (value: unknown) => <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{value ? JSON.stringify(value, null, 2) : '后端暂未返回该段解析结果'}</pre>;

export default function IncomeReconciliation() {
  const [invoiceFile, setInvoiceFile] = useState<UploadNativeFile>();
  const [cashflowFile, setCashflowFile] = useState<UploadNativeFile>();
  const [settlementFiles, setSettlementFiles] = useState<UploadNativeFile[]>([]);
  const [job, setJob] = useState<IncomeReconciliationJob>();
  const [mock, setMock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<IncomeReconciliationFileResult>();
  const [previewLoading, setPreviewLoading] = useState(false);

  const files = job?.files || [];
  const currentStatus = job?.status;
  const isPolling = currentStatus === 'parsing' || currentStatus === 'generating';
  const summary = job?.summary;

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
    setBusy(true);
    try {
      const result = currentStatus === 'uploaded' || currentStatus === 'parse_failed'
        ? await api.parseIncomeReconciliationJob(job.jobId)
        : await api.generateIncomeReconciliationExcel(job.jobId);
      setJob(result.value.data);
      setMock(result.mock);
      message.success(currentStatus === 'parsed' || currentStatus === 'generate_failed' ? '已开始生成核对表' : '已开始解析');
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
              <Form.Item label="结算单文件">
                <Upload multiple accept=".xlsx,.xls,.pdf,.doc,.docx" fileList={uploadFiles(settlementFiles)} beforeUpload={(file) => { setSettlementFiles((current) => [...current, file as UploadNativeFile]); return false; }} onRemove={(file) => { setSettlementFiles((current) => current.filter((item) => (item.uid || item.name) !== file.uid)); return true; }}>
                  <Button icon={<CloudUploadOutlined />}>选择多个结算单</Button>
                </Upload>
              </Form.Item>
              <Button type="primary" block size="large" loading={busy || isPolling} icon={mainAction.icon} onClick={runMainAction}>{mainAction.label}</Button>
            </Form>
          </Card>
        </Col>
        <Col xs={24} xl={15}>
          <Card className="audit-card" title="任务状态">
            <Descriptions column={2} items={[
              { key: 'jobId', label: '任务 ID', children: job?.jobId || '尚未创建' },
              { key: 'status', label: '状态', children: currentStatus ? <Tag color={statusMeta[currentStatus]?.color}>{statusMeta[currentStatus]?.text}</Tag> : <Tag>待上传</Tag> },
            ]} />
          </Card>
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
      <Card className="audit-card" title="文件解析列表" style={{ marginTop: 16 }}>
        <Table rowKey="fileId" dataSource={files} pagination={false} columns={[
          { title: '文件名', dataIndex: 'fileName' },
          { title: '类型', dataIndex: 'fileType', render: (value: string) => fileTypeLabels[value] || value },
          { title: '状态', dataIndex: 'parseStatus', render: (value: string) => <Tag color={fileStatusMeta[value]?.color}>{fileStatusMeta[value]?.text || value}</Tag> },
          { title: '行数', dataIndex: 'parsedRows', render: (value) => value ?? '-' },
          { title: '有效行数', dataIndex: 'validRows', render: (value) => value ?? '-' },
          { title: '置信度', dataIndex: 'confidence', render: (value?: number) => value == null ? '-' : `${Math.round(value * 100)}%` },
          { title: '原因', render: (_, record) => record.errorReason || record.parseReason || '-' },
          { title: '操作', render: (_, record) => <Button icon={<EyeOutlined />} onClick={() => openPreview(record)}>查看解析结果</Button> },
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
