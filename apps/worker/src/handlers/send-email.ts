import type { SendEmailPayload, SendEmailResult } from "@queueforge/shared/job";
import { mailer } from "../lib/mailer.js";

export async function sendEmail(payload: SendEmailPayload): Promise<SendEmailResult> {
    console.log(`Sending email to ${payload.to}...`);

    const info = await mailer.sendMail({
        from: "queueforge@example.com",
        to: payload.to,
        subject: payload.subject,
        text: payload.body
    });

    return {
        messageId: info.messageId
    }
};