import { Worker } from "bullmq";
import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";

import { processJob } from "./process-job.js";
import { handleJobFailure } from "./handle-job-failure.js";

const worker = new Worker("jobs", processJob, {
    connection: {
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
    },
  },
);

worker.on("failed", async (bullJob, error) => {
    if (!bullJob) return;

    await handleJobFailure(bullJob, error);

});

let isShuttingDown = false;

async function shutdown(signal: string) {

    if(isShuttingDown) return;

    isShuttingDown = true;

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