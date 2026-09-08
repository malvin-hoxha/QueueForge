import type { GenerateReportPayload, GenerateReportResult } from "@queueforge/shared/job";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";



export async function generateReport(payload: GenerateReportPayload):Promise<GenerateReportResult> {
    console.log(`Generating report for ${payload.month}...`);

    const reportDirectory = path.join(
        process.cwd(),
        "storage",
        "reports",
    );

    const filePath = path.join(reportDirectory, `${payload.month}.csv`);

    const csvContent = `month,status
        ${payload.month},generated`;

    await mkdir(reportDirectory, {recursive: true});
    await writeFile(filePath, csvContent);

    return {
        filePath: filePath
    };
}