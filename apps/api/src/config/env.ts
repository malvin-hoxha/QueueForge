import { z } from "zod";
import "dotenv/config";

const envSchema = z.object({
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().min(1),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
    console.error(parsedEnv.error);
    process.exit(1);
}

export const env = parsedEnv.data;