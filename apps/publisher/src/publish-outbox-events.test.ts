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
});