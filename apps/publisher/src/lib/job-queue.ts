import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../config/env.js";

const connection = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
});

export const jobQueue = new Queue("jobs", {
  connection,
});