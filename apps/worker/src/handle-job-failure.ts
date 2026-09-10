import type { Job } from "bullmq";
import { prisma } from "./lib/prisma.js";

type QueueJobData = {
    jobId: string;
};

export async function handleJobFailure(
    bullJob: Job<QueueJobData>,
    error: Error,
) {
    const maxAttempts =
        bullJob.opts.attempts ?? 1;

    const attemptsMade =
        bullJob.attemptsMade;

    const status =
        attemptsMade >= maxAttempts
        ? "FAILED"
        : "RETRYING";

    await prisma.job.update({
        where: {
        id: bullJob.data.jobId,
        },
        data: {
        status,
        error: error.message,
        },
    });
}