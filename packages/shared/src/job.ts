export type JobStatus = | "WAITING" | "PROCESSING" | "RETRYING" | "COMPLETED" | "FAILED";

export type JobType = "GENERATE_REPORT" | "SEND_EMAIL";

export interface GenerateReportPayload {
  month: string;
};

export interface SendEmailPayload {
  to: string;
  subject: string;
  body: string;
};

export type GenerateReportResult = {
  filePath: string;
}

export type SendEmailResult = {
  messageId: string;
}

interface BaseJob<TResult> {
  id: string;
  status: JobStatus;
  attempts: number;
  result: TResult | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface SendEmailJob extends BaseJob<SendEmailResult> {
  type: "SEND_EMAIL";
  payload: SendEmailPayload;
}

interface GenerateReportJob extends BaseJob<GenerateReportResult> {
  type: "GENERATE_REPORT";
  payload: GenerateReportPayload;
}

export type Job = SendEmailJob | GenerateReportJob;