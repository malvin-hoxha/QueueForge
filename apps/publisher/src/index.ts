import { prisma } from "./lib/prisma.js";
import { jobQueue } from "./lib/job-queue.js";
import { env } from "./config/env.js";
import { z } from "zod";

const OutboxJobPayloadSchema = z.object({
  jobId: z.uuid(),
});

async function publishOutboxEvents() {
    const events = await prisma.outboxEvent.findMany({
        where: {
            published: false
        },
        orderBy: {
            createdAt: "asc"
        },
        take: 10
    });

    for (const event of events) {
        try {
            const payload = OutboxJobPayloadSchema.parse(event.payload);

            const dbJob = await prisma.job.findUnique({
                where: {
                    id: payload.jobId
                }
            });

            if (!dbJob) {
                throw new Error(
                    `Job ${payload.jobId} not found for outbox event ${event.id}`,
                );
            }

            await jobQueue.add(dbJob.type, {
                jobId: dbJob.id
            }, {
                jobId: event.id,
                attempts: 3,
                backoff: {
                    type: "fixed",
                    delay: 2000
                }
            });

            await prisma.outboxEvent.update({
                where: {
                    id: event.id
                },
                data: {
                    published: true,
                    publishedAt: new Date()
                }
            });
        } catch (error) {
            console.error(
                `Failed to publish outbox event ${event.id}`,
                error,
            );
        }
        
    }
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

while (true) {
    try {
        await publishOutboxEvents();
        
    } catch (error) {
        console.error("Publisher cycle failed",error);
    }
    await sleep(1000);
  
}
