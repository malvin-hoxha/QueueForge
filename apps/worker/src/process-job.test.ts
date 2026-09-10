import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
    findUnique: vi.fn(),
    update: vi.fn(),
    generateReport: vi.fn(),
    sendEmail: vi.fn(),
}));

vi.mock("./lib/prisma.js", () => ({
    prisma: {
        job: {
        findUnique: mocks.findUnique,
        update: mocks.update,
        },
    },
}));

vi.mock("./handlers/generate-report.js", () => ({
    generateReport: mocks.generateReport,
}));

vi.mock("./handlers/send-email.js", () => ({
    sendEmail: mocks.sendEmail,
}));

import { processJob } from "./process-job.js";

beforeEach(() => {
    vi.clearAllMocks();
});

describe("processJob", () => {
    it("skips a job that is already completed", async () => {
        mocks.findUnique.mockResolvedValue({
        id: "job-123",
        type: "SEND_EMAIL",
        payload: {
            to: "test@example.com",
            subject: "Test",
            body: "Hello",
        },
        status: "COMPLETED",
        attempts: 1,
        result: {
            messageId: "message-123",
        },
        error: null,
        });

        const bullJob = {
        name: "SEND_EMAIL",
        data: {
            jobId: "job-123",
        },
        } as any;

        await processJob(bullJob);

        expect(mocks.sendEmail).not.toHaveBeenCalled();
        expect(mocks.generateReport).not.toHaveBeenCalled();
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it("processes a SEND_EMAIL job successfully", async () => {
        mocks.findUnique.mockResolvedValue({
            id: "job-123",
            type: "SEND_EMAIL",
            payload: {
            to: "test@example.com",
            subject: "Test",
            body: "Hello",
            },
            status: "WAITING",
            attempts: 0,
            result: null,
            error: null,
        });

        mocks.sendEmail.mockResolvedValue({
            messageId: "message-123",
        });

        const bullJob = {
            name: "SEND_EMAIL",
            data: {
            jobId: "job-123",
            },
        } as any;

        await processJob(bullJob);

        expect(mocks.update).toHaveBeenNthCalledWith(
            1,
            {
            where: {
                id: "job-123",
            },
            data: {
                status: "PROCESSING",
                attempts: {
                increment: 1,
                },
                error: null,
            },
            },
        );

        expect(mocks.sendEmail).toHaveBeenCalledWith({
            to: "test@example.com",
            subject: "Test",
            body: "Hello",
        });

        expect(mocks.update).toHaveBeenNthCalledWith(
            2,
            {
            where: {
                id: "job-123",
            },
            data: {
                status: "COMPLETED",
                result: {
                messageId: "message-123",
                },
            },
            },
        );
    });

    it("processes a GENERATE_REPORT job successfully", async () => {
        mocks.findUnique.mockResolvedValue({
            id: "job-456",
            type: "GENERATE_REPORT",
            payload: {
            month: "2026-09",
            },
            status: "WAITING",
            attempts: 0,
            result: null,
            error: null,
        });

        mocks.generateReport.mockResolvedValue({
            filePath: "/app/storage/reports/2026-09.csv",
        });

        const bullJob = {
            name: "GENERATE_REPORT",
            data: {
            jobId: "job-456",
            },
        } as any;

        await processJob(bullJob);

        expect(mocks.generateReport).toHaveBeenCalledWith({
            month: "2026-09",
        });

        expect(mocks.sendEmail).not.toHaveBeenCalled();

        expect(mocks.update).toHaveBeenNthCalledWith(
            1,
            {
            where: {
                id: "job-456",
            },
            data: {
                status: "PROCESSING",
                attempts: {
                increment: 1,
                },
                error: null,
            },
            },
        );

        expect(mocks.update).toHaveBeenNthCalledWith(
            2,
            {
            where: {
                id: "job-456",
            },
            data: {
                status: "COMPLETED",
                result: {
                filePath: "/app/storage/reports/2026-09.csv",
                },
            },
            },
        );
    });

    it("throws when the job handler fails and does not mark the job as completed", async () => {
        mocks.findUnique.mockResolvedValue({
            id: "job-123",
            type: "SEND_EMAIL",
            payload: {
            to: "test@example.com",
            subject: "Test",
            body: "Hello",
            },
            status: "WAITING",
            attempts: 0,
            result: null,
            error: null,
        });

        mocks.sendEmail.mockRejectedValue(
            new Error("SMTP unavailable"),
        );

        const bullJob = {
            name: "SEND_EMAIL",
            data: {
            jobId: "job-123",
            },
        } as any;

        await expect(
            processJob(bullJob),
        ).rejects.toThrow("SMTP unavailable");

        expect(mocks.update).toHaveBeenCalledTimes(1);

        expect(mocks.update).toHaveBeenCalledWith({
            where: {
            id: "job-123",
            },
            data: {
            status: "PROCESSING",
            attempts: {
                increment: 1,
            },
            error: null,
            },
        });
    });
});