import type { GenerateReportPayload, GenerateReportResult } from "@queueforge/shared/job";

export async function generateReport(payload: GenerateReportPayload):Promise<GenerateReportResult> {
    console.log(`Generating report for ${payload.month}...`);

    return {
        filePath: "/path/to/report.pdf"
    };
}