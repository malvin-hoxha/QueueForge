import { app } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";

const server = app.listen(env.PORT, () => {
  console.log(`Listening on port ${env.PORT}`);
});

let isShuttingDown = false;

async function shutdown(signal: string) {
    if (isShuttingDown) return;

    isShuttingDown = true;

    console.log(`Received ${signal}. Shutting down API...`);

    server.close(async () => {
        await prisma.$disconnect();
        console.log("API shut down gracefully.");

        process.exit(0);

    });
};

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
