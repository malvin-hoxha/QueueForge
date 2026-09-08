import express from 'express'

import { CreateJobInputSchema } from "@queueforge/shared/job-schema";
import { prisma } from "./lib/prisma.js";
import { jobQueue } from "./lib/job-queue.js";

import { env } from "./config/env.js";

const app = express();

const PORT = env.PORT;

app.use(express.json());

app.post('/jobs', async (req, res) => {
    const parsedBody = CreateJobInputSchema.safeParse(req.body); 

    if(!parsedBody.success) {
        res.status(400).json(parsedBody.error);
        return;
    }

    const input = parsedBody.data;

    const job = await prisma.job.create({
        data: {
            type: input.type,
            payload: input.payload
        }
    });

    await jobQueue.add(job.type, {
       jobId: job.id
    }, {
        attempts: 3,
        backoff: {
            type: "fixed",
            delay: 2000,
        },
    });

    res.status(202).json({
        message: "Job accepted",
        jobId: job.id,
        status: job.status,
        statusUrl: `/jobs/${job.id}`,
    });


});

app.get('/jobs/:id', async (req, res) => {
    const id = req.params.id;

    const job = await prisma.job.findUnique ({
        where: {
            id
        }
    })

    if (!job) {
        res.status(404).json({message: "Job not found"});
        return;
    }

    res.status(200).json(job);
});

app.get('/health', (_req, res) => {
    res.status(200).json({status: 'ok'});
});

app.listen(PORT, () => {
    console.log(`Listening on port ${PORT}`);
});