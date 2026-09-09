import { Worker } from "bullmq";
import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";
import { generateReport  } from "./handlers/generate-report.js"; 
import { sendEmail } from "./handlers/send-email.js";

import { CreateJobInputSchema } from "@queueforge/shared/job-schema";

const worker = new Worker("jobs", async (bullJob) => {
    console.log("Received job:", bullJob.name);
    console.log("Data:", bullJob.data);

    const dbJob = await prisma.job.findUnique({
        where: {
            id: bullJob.data.jobId
        }
    });

    if (!dbJob) {
        throw new Error("Job not found in database");
    }

    await prisma.job.update({
        where: {
            id: dbJob.id
        },
        data: {
            status: "PROCESSING",
            attempts: {increment: 1},
            error: null
        }
    });

    console.log(`Processing ${dbJob.type}...`);

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
            id: dbJob.id
        },
        data: {
            status: "COMPLETED",
            result
        }
    });
    },
    {
        connection: {
            host: env.REDIS_HOST,
            port: env.REDIS_PORT
        }
    }
);

worker.on("failed", async (bullJob, error) => {
    if (!bullJob) return;

    const maxAttempts = bullJob.opts.attempts ?? 1;
    const attemptsMade = bullJob.attemptsMade;

    const status = attemptsMade >= maxAttempts ? "FAILED" : "RETRYING";

    await prisma.job.update({
        where: {
            id: bullJob.data.jobId
        },
        data: {
            status,
            error: error.message
        }
    });

});

async function shutdown(signal: string) {
  console.log(`Received ${signal}. Shutting down worker...`);

  await worker.close();

  await prisma.$disconnect();

  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});