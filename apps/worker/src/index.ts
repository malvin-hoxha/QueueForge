import { Worker } from "bullmq";
import { env } from "./config/env.js";

const worker = new Worker("jobs", 
    async (bullJob) => {
        console.log("Received job:", bullJob.name);
        console.log("Data:", bullJob.data);
    },
    {
        connection: {
            host: env.REDIS_HOST,
            port: env.REDIS_PORT
        }
    }
);