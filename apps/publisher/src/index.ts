import { prisma } from "./lib/prisma.js";
import { jobQueue } from "./lib/job-queue.js";
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
        let claimedAt: Date | null = null;

        try {
            const claimTime = new Date();

            const claimTimeout = new Date(Date.now() - 30_000);

            const claimResult = await prisma.outboxEvent.updateMany({
                where: {
                    id: event.id,
                    published: false,
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

            if (claimedAt) {
                await prisma.outboxEvent.updateMany({
                    where: {
                        id: event.id,
                        published: false,
                        claimedAt
                    },
                    data: {
                        claimedAt: null
                    }
                })
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

while (true) {
    try {
        await publishOutboxEvents();
        
    } catch (error) {
        console.error("Publisher cycle failed",error);
    }
    await sleep(1000);
  
}
