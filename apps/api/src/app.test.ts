import { describe, expect, it } from "vitest";
import request from "supertest";

import { app } from "./app.js";

describe("GET /health", () => {
  it("returns API health status", async () => {
    const response = await request(app)
      .get("/health");

    expect(response.status).toBe(200);

    expect(response.body).toEqual({
      status: "ok",
    });
  });
});

describe("POST /jobs", () => {
  it("returns 400 for invalid job input", async () => {
    const response = await request(app)
      .post("/jobs")
      .send({
        type: "SEND_EMAIL",
        payload: {
          to: "not-an-email",
          subject: "Test",
          body: "Hello",
        },
      });

    expect(response.status).toBe(400);
  });
});