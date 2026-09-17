import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
    REDIS_HOST: z.string().min(1),
    REDIS_PORT: z.coerce.number().int().positive().default(6379),
    DATABASE_URL: z.string().min(1),
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().positive().default(1025)
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
    console.error(parsedEnv.error);
    process.exit(1);
}

export const env = parsedEnv.data;