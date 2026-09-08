import { Worker } from "bullmq";
import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";

const worker = new Worker("jobs", 
    async (bullJob) => {
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

        await prisma.job.update({
            where: {
                id: dbJob.id
            },
            data: {
                status: "COMPLETED"
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