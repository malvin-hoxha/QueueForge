import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
     update: vi.fn(),
}));

vi.mock("./lib/prisma.js", () => ({
    prisma: {
        job: {
            update: mocks.update,
        },
    },
}));

import { handleJobFailure } from "./handle-job-failure.js";

beforeEach(() => {
    vi.clearAllMocks();
});

describe("handleJobFailure", () => {
    it("marks the job as RETRYING when attempts remain", async () => {
            const bullJob = {
                data: {
                    jobId: "job-123",
                },
                opts: {
                    attempts: 3,
                },
                attemptsMade: 1,
            } as any;

        await handleJobFailure(
            bullJob,
            new Error("SMTP unavailable"),
        );

        expect(mocks.update).toHaveBeenCalledWith({
            where: {
                id: "job-123",
            },
            data: {
                status: "RETRYING",
                error: "SMTP unavailable",
            },
        });
    });

    it("marks the job as FAILED when max attempts are reached", async () => {
        const bullJob = {
            data: {
                jobId: "job-123",
            },
            opts: {
                attempts: 3,
            },
            attemptsMade: 3,
        } as any;

        await handleJobFailure(
            bullJob,
            new Error("SMTP unavailable"),
        );

        expect(mocks.update).toHaveBeenCalledWith({
            where: {
                id: "job-123",
            },
            data: {
                status: "FAILED",
                error: "SMTP unavailable",
            },
        });
    });
});