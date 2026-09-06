import express from 'express'
import { randomUUID } from "node:crypto";

import type { Job } from '@queueforge/shared/job'
import { CreateJobInputSchema } from "@queueforge/shared/job-schema";

const app = express();

const PORT = 3000;

const jobs = new Map<string, Job>();

app.use(express.json());

app.post('/jobs', (req, res) => {
    const parsedBody = CreateJobInputSchema.safeParse(req.body); 

    if(!parsedBody.success) {
        res.status(400).json(parsedBody.error);
        return;
    }

    const input = parsedBody.data;

    const job: Job = {
        ...input,
        id: randomUUID(),
        status: 'WAITING',
        attempts: 0,
        result: null,
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    }

    jobs.set(job.id, job);

    res.status(202).json(job);


});

app.get('/jobs/:id', (req, res) => {
    const id = req.params.id;

    const job = jobs.get(id);

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
    console.log('Listening on port 3000');
});