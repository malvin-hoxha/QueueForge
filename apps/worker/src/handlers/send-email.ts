import type { SendEmailPayload, SendEmailResult } from "@queueforge/shared/job";

export async function sendEmail(payload: SendEmailPayload): Promise<SendEmailResult> {
    console.log(`Sending email to ${payload.to}...`);

    return {
        messageId: "123"
    }
};