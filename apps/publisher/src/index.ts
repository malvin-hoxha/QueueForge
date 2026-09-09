import { prisma } from "./lib/prisma.js";
import { jobQueue } from "./lib/job-queue.js";
import { z } from "zod";

const MAX_OUTBOX_ATTEMPTS = 5;

const OutboxJobPayloadSchema = z.object({
  jobId: z.uuid().min(1000),
});

async function publishOutboxEvents() {
    const events = await prisma.outboxEvent.findMany({
        where: {
            published: false,
            failed: false
        },
        orderBy: {
            createdAt: "asc"
        },
        take: 10
    });

    for (const event of events) {
        let claimedAt: Date | null = null;

        try {
            const claimTime = new Date();

            const claimTimeout = new Date(Date.now() - 30_000);

            const claimResult = await prisma.outboxEvent.updateMany({
                where: {
                    id: event.id,
                    published: false,
                    failed: false,
                    OR: [
                        {
                            claimedAt: null
                        },
                        {
                            claimedAt: { lt: claimTimeout }
                        }
                    ]
                },
                data: {
                    claimedAt: claimTime,
                }
            });

            if (claimResult.count === 0) {
                continue;
            }

            claimedAt = claimTime;

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

            const publishResult = await prisma.outboxEvent.updateMany({
                where: {
                    id: event.id,
                    published: false,
                    claimedAt,
                },
                data: {
                    published: true,
                    publishedAt: new Date(),
                    claimedAt: null,
                },
            });

            if (publishResult.count === 0) {
                throw new Error(
                    `Lost claim ownership for outbox event ${event.id}`,
                );
            }

            console.log(`Claimed outbox event ${event.id}`);
        } catch (error) {

            const errorMessage = error instanceof Error ? error.message : "Unknown publisher error";

            if (claimedAt) {
                const finalFailure = await prisma.outboxEvent.updateMany({
                    where: {
                        id: event.id,
                        published: false,
                        failed: false,
                        claimedAt,
                        attempts: { gte: MAX_OUTBOX_ATTEMPTS - 1 }   
                    },
                    data: {
                        attempts: { increment: 1 },
                        lastError: errorMessage,
                        failed: true,
                        claimedAt: null
                    }
                });

                if (finalFailure.count === 0) {
                    await prisma.outboxEvent.updateMany({
                        where: {
                            id: event.id,
                            published: false,
                            failed: false,
                            claimedAt,
                        },
                        data: {
                            attempts: { increment: 1 },
                            lastError: errorMessage,
                            claimedAt: null,
                        },
                    });
                }
            }

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

let isShuttingDown = false;

process.on("SIGINT", () => {
  console.log("Received SIGINT. Shutting down publisher...");
  isShuttingDown = true;
});

process.on("SIGTERM", () => {
  console.log("Received SIGTERM. Shutting down publisher...");
  isShuttingDown = true;
});

while (!isShuttingDown) {
    try {
        await publishOutboxEvents();
        
    } catch (error) {
        console.error("Publisher cycle failed",error);
    }
    if (!isShuttingDown) {
        await sleep(1000);
    }
}

await jobQueue.close();
await prisma.$disconnect();

console.log("Publisher shut down gracefully.");