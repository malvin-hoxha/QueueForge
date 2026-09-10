import { prisma } from "./lib/prisma.js";
import { jobQueue } from "./lib/job-queue.js";
import { publishOutboxEvents } from "./publish-outbox-events.js";

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