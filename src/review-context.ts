import { WebhookPayload } from "@actions/github/lib/interfaces.js";

export declare interface ReviewContext {
    /**
     * Webhook payload object that triggered the workflow
     */
    payload: WebhookPayload;
    eventName: string;
    sha: string;
    ref: string;
    workflow: string;
    action: string;
    actor: string;
    job: string;
    runNumber: number;
    runId: number;
    
    get repo(): {
        owner: string;
        repo: string;
    };
}
