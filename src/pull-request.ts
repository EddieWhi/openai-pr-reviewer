export type CommitComparison = { data: { commits: { sha: string }[], files?: { filename: string, patch?: string }[] } }
export type FileContent = { data?: { type: string, content?: string } | any }
export type ReviewCommentArgs = { commit_id: string, body: string, path: string, line: number, start_side?: "side" | "LEFT" | "RIGHT", start_line?: number }
export type ReviewComment = { id: number, commit_id: string, in_reply_to_id?: number, body: string, path: string, line?: number, start_side?: "side" | "LEFT" | "RIGHT" | null, start_line?: number | null }
export type Commit = { sha: string }

export interface Issue {
    readonly owner: string
    readonly repo: string
    readonly title: string
    readonly body: string
    readonly number: number

    getDescription(): Promise<string>;
    updateDescription(description: string): Promise<void>;
    listCommits(): Promise<Commit[]>;

    createComment(body: string): Promise<void>;

    updateComment(comment_id: number, body: string): Promise<void>;
    listComments(): Promise<any>;
  }

export interface PullRequest extends Issue {
    readonly basesha: string
    readonly headsha: string

    compareCommits(base: string, head: string): Promise<CommitComparison>
    getContent(path: string, ref: string): Promise<FileContent>;

    listReviewComments(): Promise<ReviewComment[]>;
    createReviewComment(commentData: ReviewCommentArgs): Promise<void>;
    updateReviewComment(comment_id: number, body: string): Promise<void>;
    createReplyForReviewComment(comment_id: any, body: string): Promise<void>;
  }
  