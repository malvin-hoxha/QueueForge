import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
  findUnique: vi.fn(),
  queueAdd: vi.fn(),
}));

vi.mock("./lib/prisma.js", () => ({
  prisma: {
    outboxEvent: {
      findMany: mocks.findMany,
      updateMany: mocks.updateMany,
    },
    job: {
      findUnique: mocks.findUnique,
    },
  },
}));

vi.mock("./lib/job-queue.js", () => ({
  jobQueue: {
    add: mocks.queueAdd,
  },
}));

import { publishOutboxEvents } from "./publish-outbox-events.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("publishOutboxEvents", () => {
  it("does not enqueue an event when claim is lost", async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: "event-123",
        type: "JOB_CREATED",
        payload: {
          jobId: "981077c9-cc56-4b02-8493-fb8fed920acb",
        },
        published: false,
        failed: false,
        attempts: 0,
        claimedAt: null,
      },
    ]);

    mocks.updateMany.mockResolvedValue({
      count: 0,
    });

    await publishOutboxEvents();

    expect(mocks.queueAdd).not.toHaveBeenCalled();

    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

    it("enqueues and publishes a successfully claimed event", async () => {
        const payload = {
            jobId: "981077c9-cc56-4b02-8493-fb8fed920acb",
        };

        mocks.findMany.mockResolvedValue([
            {
                id: "event-123",
                type: "JOB_CREATED",
                payload,
                published: false,
                failed: false,
                attempts: 0,
                claimedAt: null,
            },
        ]);

        mocks.updateMany
                .mockResolvedValueOnce({
                count: 1, // claim succeeded
            })
                .mockResolvedValueOnce({
                count: 1, // published successfully
            });

        mocks.findUnique.mockResolvedValue({
                id: payload.jobId,
                type: "SEND_EMAIL",
                payload: {
                to: "test@example.com",
                subject: "Test",
                body: "Hello",
            },
        });

        mocks.queueAdd.mockResolvedValue({
            id: "event-123",
        });

        await publishOutboxEvents();

        expect(mocks.queueAdd).toHaveBeenCalledWith(
            "SEND_EMAIL",
            {
                jobId: payload.jobId,
            },
            {
                jobId: "event-123",
                attempts: 3,
                backoff: {
                    type: "fixed",
                    delay: 2000,
                },
            },
        );
    });

    it("records a retryable publisher failure", async () => {
        mocks.findMany.mockResolvedValue([
            {
            id: "event-123",
            type: "JOB_CREATED",
            payload: {
                jobId: "981077c9-cc56-4b02-8493-fb8fed920acb",
            },
            published: false,
            failed: false,
            attempts: 1,
            claimedAt: null,
            },
        ]);

        mocks.updateMany
            .mockResolvedValueOnce({
            count: 1, // claim succeeded
            })
            .mockResolvedValueOnce({
            count: 0, // not final failure yet
            })
            .mockResolvedValueOnce({
            count: 1, // retry failure tracking update
            });

        mocks.findUnique.mockResolvedValue({
            id: "981077c9-cc56-4b02-8493-fb8fed920acb",
            type: "SEND_EMAIL",
            payload: {
            to: "test@example.com",
            subject: "Test",
            body: "Hello",
            },
        });

        mocks.queueAdd.mockRejectedValue(
            new Error("Redis unavailable"),
        );

        await publishOutboxEvents();

        expect(mocks.updateMany).toHaveBeenLastCalledWith(
            expect.objectContaining({
            data: {
                attempts: {
                increment: 1,
                },
                lastError: "Redis unavailable",
                claimedAt: null,
            },
            }),
        );
    });

    it("marks an outbox event as failed after max attempts", async () => {
        mocks.findMany.mockResolvedValue([
            {
            id: "event-123",
            type: "JOB_CREATED",
            payload: {
                jobId: "981077c9-cc56-4b02-8493-fb8fed920acb",
            },
            published: false,
            failed: false,
            attempts: 4,
            claimedAt: null,
            },
        ]);

        mocks.updateMany
            .mockResolvedValueOnce({
            count: 1, // claim succeeded
            })
            .mockResolvedValueOnce({
            count: 1, // final failure update succeeded
            });

        mocks.findUnique.mockResolvedValue({
            id: "981077c9-cc56-4b02-8493-fb8fed920acb",
            type: "SEND_EMAIL",
            payload: {
            to: "test@example.com",
            subject: "Test",
            body: "Hello",
            },
        });

        mocks.queueAdd.mockRejectedValue(
            new Error("Redis unavailable"),
        );

        await publishOutboxEvents();

        expect(mocks.updateMany).toHaveBeenLastCalledWith(
            expect.objectContaining({
            data: {
                attempts: {
                increment: 1,
                },
                lastError: "Redis unavailable",
                failed: true,
                claimedAt: null,
            },
            }),
        );
    });

});