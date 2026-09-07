import { createPrismaClient } from "@queueforge/database";
import { env } from "../config/env.js";

export const prisma = createPrismaClient(env.DATABASE_URL);