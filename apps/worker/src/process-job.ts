import { prisma } from "./lib/prisma.js";
import { generateReport } from "./handlers/generate-report.js";
import { sendEmail } from "./handlers/send-email.js";
import { CreateJobInputSchema } from "@queueforge/shared/job-schema";
import type { Job } from "bullmq";

type QueueJobData = {
  jobId: string;
};

export async function processJob(bullJob: Job<QueueJobData>) {
    console.log("Received job:", bullJob.name);
    console.log("Data:", bullJob.data);
        
    const dbJob = await prisma.job.findUnique({
        where: {
        id: bullJob.data.jobId,
        },
    });

    if (!dbJob) {
        throw new Error("Job not found in database");
    }

    if (dbJob.status === "COMPLETED") {
        console.log(`Job ${dbJob.id} already completed. Skipping.`);
        return;
    }

    await prisma.job.update({
        where: {
        id: dbJob.id,
        },
        data: {
        status: "PROCESSING",
        attempts: {
            increment: 1,
        },
        error: null,
        },
    });

    const parsedJob = CreateJobInputSchema.parse({
        type: dbJob.type,
        payload: dbJob.payload,
    });

    let result;

    switch (parsedJob.type) {
        case "GENERATE_REPORT":
        result = await generateReport(parsedJob.payload);
        break;

        case "SEND_EMAIL":
        result = await sendEmail(parsedJob.payload);
        break;

        default:
        throw new Error("Unknown job type");
    }

    await prisma.job.update({
        where: {
        id: dbJob.id,
        },
        data: {
        status: "COMPLETED",
        result,
        },
    });
}