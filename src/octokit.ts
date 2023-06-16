import {getInput} from '@actions/core'
import {Octokit} from '@octokit/action'
import {Octokit as CoreOctokit} from '@octokit/core'
import {retry} from '@octokit/plugin-retry'
import {throttling} from '@octokit/plugin-throttling'
import {
  PullRequest,
  CommitComparison,
  FileContent,
  ReviewComment,
  ReviewCommentArgs,
  Commit
} from './pull-request.js'
import {ReviewContext} from './review-context.js'
import {warning} from './logger.js'
import assert from 'assert'

const token = getInput('token') || process.env.GITHUB_TOKEN

const RetryAndThrottlingOctokit = Octokit.plugin(throttling, retry)
export const octokit = new RetryAndThrottlingOctokit({
  auth: `token ${token}`,
  throttle: {
    onRateLimit: (
      retryAfter: number,
      options: any,
      _o: CoreOctokit,
      retryCount: number
    ) => {
      warning(
        `Request quota exhausted for request ${options.method} ${options.url}
Retry after: ${retryAfter} seconds
Retry count: ${retryCount}
`
      )
      return true
    },
    onSecondaryRateLimit: (_retryAfter: number, options: any) => {
      warning(
        `SecondaryRateLimit detected for request ${options.method} ${options.url}`
      )
      return true
    }
  },
  retry: {
    doNotRetry: ['429'],
    maxRetries: 10
  }
})

export class OctokitPullRequest implements PullRequest {
  readonly owner: string
  readonly repo: string
  readonly title: string
  readonly body: string
  readonly number: number
  readonly basesha: string
  readonly headsha: string

  private issueCommentsCache: Record<number, any[]> = {}
  private reviewCommentsCache: Record<number, any[]> = {}

  constructor(context: ReviewContext) {
    const prContext = context.payload.pull_request || context.payload.issue
    assert(prContext, 'context.payload.pull_request is null')

    this.title = prContext.title
    this.body = prContext.body || ''
    this.number = prContext.number
    this.basesha = prContext.base.sha
    this.headsha = prContext.head.sha

    this.owner = context.repo.owner
    this.repo = context.repo.repo
  }

  async compareCommits(base: string, head: string): Promise<CommitComparison> {
    return await octokit.repos.compareCommits({
      owner: this.owner,
      repo: this.repo,
      base,
      head
    })
  }

  async listCommits(): Promise<Commit[]> {
    const commits = await this.getAllPages(
      async (page, perPage) =>
        (
          await octokit.pulls.listCommits({
            owner: this.owner,
            repo: this.repo,
            pull_number: this.number,
            page,
            per_page: perPage
          })
        ).data
    )

    return commits
  }

  async getContent(path: string, ref: string): Promise<FileContent> {
    return await octokit.repos.getContent({
      owner: this.owner,
      repo: this.repo,
      path,
      ref
    })
  }

  async getDescription(): Promise<string> {
    const pull = await octokit.pulls.get({
      owner: this.owner,
      repo: this.repo,
      pull_number: this.number
    })
    return pull.data.body || ''
  }

  async updateDescription(description: string): Promise<void> {
    await octokit.pulls.update({
      owner: this.owner,
      repo: this.repo,
      pull_number: this.number,
      body: description
    })
  }

  async createComment(body: string): Promise<void> {
    await octokit.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: this.number,
      body
    })
  }

  async updateComment(commentId: number, body: string): Promise<void> {
    await octokit.issues.updateComment({
      owner: this.owner,
      repo: this.repo,
      comment_id: commentId,
      body
    })
  }

  async listComments(): Promise<any[]> {
    const cached = this.issueCommentsCache[this.number]
    if (cached) {
      return cached
    }

    try {
      const comments = await this.getAllPages(
        async (page, perPage) =>
          (
            await octokit.issues.listComments({
              owner: this.owner,
              repo: this.repo,
              issue_number: this.number,
              page,
              per_page: perPage
            })
          ).data
      )

      this.issueCommentsCache[this.number] = comments
      return comments
    } catch (e: any) {
      warning(`Failed to list comments: ${e}`)
      throw e
    }
  }

  async listReviewComments(): Promise<ReviewComment[]> {
    const cached = this.reviewCommentsCache[this.number]
    if (cached) {
      return cached
    }

    try {
      const comments = await this.getAllPages(
        async (page, perPage) =>
          (
            await octokit.pulls.listReviewComments({
              owner: this.owner,
              repo: this.repo,
              pull_number: this.number,
              page,
              per_page: perPage
            })
          ).data
      )

      this.reviewCommentsCache[this.number] = comments
      return comments
    } catch (e: any) {
      warning(`Failed to list comments: ${e}`)
      throw e
    }
  }

  async updateReviewComment(commentId: number, body: string): Promise<void> {
    await octokit.pulls.updateReviewComment({
      owner: this.owner,
      repo: this.repo,
      comment_id: commentId,
      body
    })
  }

  async createReviewComment(commentData: ReviewCommentArgs): Promise<void> {
    await octokit.pulls.createReviewComment({
      owner: this.owner,
      repo: this.repo,
      pull_number: this.number,
      ...commentData
    })
  }

  async createReplyForReviewComment(
    commentId: any,
    body: string
  ): Promise<void> {
    await octokit.pulls.createReplyForReviewComment({
      owner: this.owner,
      repo: this.repo,
      pull_number: this.number,
      comment_id: commentId,
      body
    })
  }

  private async getAllPages<T>(
    getPage: (page: number, perPage: number) => Promise<T[]>
  ): Promise<T[]> {
    const allItems: T[] = []
    const perPage = 100
    for (let pageNumber = 1; ; pageNumber++) {
      const pageData = await getPage(pageNumber, perPage)

      if (pageData.length === 0) {
        break
      }

      allItems.push(...pageData)

      if (pageData.length < perPage) {
        break
      }
    }
    return allItems
  }
}
