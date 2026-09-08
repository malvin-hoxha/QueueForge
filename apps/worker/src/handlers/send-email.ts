import type { SendEmailPayload } from "@queueforge/shared/job";

export async function sendEmail(payload: SendEmailPayload) {
    console.log(`Sending email to ${payload.to}...`);
}