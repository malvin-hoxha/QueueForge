import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  jobCreate: vi.fn(),
  outboxCreate: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("./lib/prisma.js", () => ({
  prisma: {
    $transaction: mocks.transaction,

    job: {
      findUnique: mocks.findUnique,
    },
  },
}));

import { app } from "./app.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /jobs", () => {
  it("creates a job and outbox event atomically", async () => {
    const payload = {
      to: "test@example.com",
      subject: "Test",
      body: "Hello",
    };

    mocks.jobCreate.mockResolvedValue({
      id: "job-123",
      type: "SEND_EMAIL",
      payload,
      status: "WAITING",
    });

    mocks.outboxCreate.mockResolvedValue({
      id: "event-123",
    });

    mocks.transaction.mockImplementation(
      async (callback) =>
        callback({
          job: {
            create: mocks.jobCreate,
          },
          outboxEvent: {
            create: mocks.outboxCreate,
          },
        }),
    );

    const response = await request(app)
      .post("/jobs")
      .send({
        type: "SEND_EMAIL",
        payload,
      });

    expect(response.status).toBe(202);

    expect(response.body).toEqual({
      message: "Job accepted",
      jobId: "job-123",
      status: "WAITING",
      statusUrl: "/jobs/job-123",
    });

    expect(mocks.jobCreate).toHaveBeenCalledWith({
      data: {
        type: "SEND_EMAIL",
        payload,
      },
    });

    expect(mocks.outboxCreate).toHaveBeenCalledWith({
      data: {
        type: "JOB_CREATED",
        payload: {
          jobId: "job-123",
        },
      },
    });
  });
});

describe("GET /jobs/:id", () => {
  it("returns 404 when job does not exist", async () => {
    mocks.findUnique.mockResolvedValue(null);

    const response = await request(app)
      .get("/jobs/job-123");

    expect(response.status).toBe(404);

    expect(response.body).toEqual({
      message: "Job not found",
    });
  });

  it("returns the job when it exists", async () => {
    const job = {
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
    };

    mocks.findUnique.mockResolvedValue(job);

    const response = await request(app)
      .get("/jobs/job-123");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(job);
  });
});