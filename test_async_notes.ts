
import { AppMakerOrchestrator } from './src/server/AppMakerLab/AppMakerOrchestrator';
import { BuildJobManager } from './src/server/AppMakerLab/jobs/BuildJobManager';
import { performance } from 'perf_hooks';

async function testAsyncNotes() {
    console.log("Starting async notes app creation...");
    const startTime = performance.now();
    
    // Trigger orchestration
    const result = await AppMakerOrchestrator.execute(
        "Create a Notes App with Signup, Login, Create Notes, Edit Notes, Delete Notes, and Search Notes features."
    );
    
    const endTime = performance.now();
    const responseTime = endTime - startTime;
    
    console.log(`Initial response time: ${responseTime.toFixed(2)}ms`);
    console.log(`Job triggered: ${JSON.stringify(result)}`);
    
    if (!result.message || !result.message.includes('job-')) {
        console.error("Job ID not returned!");
        process.exit(1);
    }
    
    const jobId = result.message.split(' ')[2];
    console.log(`Monitoring Job: ${jobId}`);
    
    // Poll job status
    let status = 'QUEUED';
    const timeline: { status: string, time: string }[] = [];
    
    while (status !== 'PREVIEW_READY' && status !== 'FAILED') {
        await new Promise(r => setTimeout(r, 2000)); // Poll every 2s to be faster
        console.log(`Polling status for ${jobId}...`);
        const job = await BuildJobManager.getJob(jobId);
        
        if (!job) {
            console.error("Job disappeared!");
            process.exit(1);
        }
        
        console.log(`Current status: ${job.status}`);
        
        if (job.status !== status) {
            status = job.status;
            timeline.push({ status, time: new Date().toISOString() });
            console.log(`Status update detected: ${status}`);
        }
    }
    
    const finalJob = await BuildJobManager.getJob(jobId);
    console.log("FINAL RESULTS:", JSON.stringify({
        jobId,
        responseTime,
        timeline,
        finalJob
    }, null, 2));
}

testAsyncNotes().catch(console.error);
