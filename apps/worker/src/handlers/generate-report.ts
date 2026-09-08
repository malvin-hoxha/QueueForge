import type { GenerateReportPayload } from "@queueforge/shared/job";

export async function generateReport(payload: GenerateReportPayload) {
    console.log(`Generating report for ${payload.month}...`);
}