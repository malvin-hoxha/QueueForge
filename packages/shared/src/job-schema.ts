import { z } from "zod";

export const GenerateReportJobInputSchema = z.object({
    type: z.literal("GENERATE_REPORT"),
    payload: z.object({
        month: z.string()
    })
});

export const SendEmailJobInputSchema = z.object({
    type: z.literal("SEND_EMAIL"),
    payload: z.object({
        to: z.email(),
        subject: z.string(),
        body: z.string()
    })
});

export const CreateJobInputSchema = z.discriminatedUnion("type", [
    GenerateReportJobInputSchema,
    SendEmailJobInputSchema
])