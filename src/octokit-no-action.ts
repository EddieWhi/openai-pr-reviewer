import {Octokit} from '@octokit/rest'
import {
  PullRequest,
  CommitComparison,
  FileContent,
  ReviewComment,
  ReviewCommentArgs,
  Commit
} from './pull-request.js'
import {warning, logger} from './logger.js'

const token = process.env.GITHUB_TOKEN

export const octokit = new Octokit({
  auth: `token ${token}`,
  userAgent: 'openai-pr-reviewer-test v1.0.0',
  retry: {
    doNotRetry: ['429'],
    maxRetries: 10
  },
  logger: {
    debug: (m: string, p: any[]) => logger.debug(m, p),
    info: (m: string, p: any[]) => logger.info(m, p),
    warn: (m: string, p: any[]) => logger.warn(m, p),
    error: (m: string, p: any[]) => logger.error(m, p)
  }
})

export interface OctokitNoActionsPullRequestParams {
  owner: string
  repo: string
  pullNumber: number
}

export class OctokitNoActionsPullRequest implements PullRequest {
  readonly owner: string
  readonly repo: string
  readonly title: string
  readonly body: string
  readonly number: number
  readonly basesha: string
  readonly headsha: string

  private issueCommentsCache: Record<number, any[]> = {}
  private reviewCommentsCache: Record<number, ReviewComment[]> = {}

  static async construct(
    params: OctokitNoActionsPullRequestParams
  ): Promise<OctokitNoActionsPullRequest> {
    const [issue, pull] = await Promise.all([
      octokit.issues.get({
        owner: params.owner,
        repo: params.repo,
        issue_number: params.pullNumber
      }),
      octokit.pulls.get({
        owner: params.owner,
        repo: params.repo,
        pull_number: params.pullNumber
      })
    ])

    logger.verbose(`Got pull request for {params}: {pull}`, {params, pull})

    return new OctokitNoActionsPullRequest({
      ...params,
      title: issue.data.title,
      body: issue.data.body || '',
      basesha: pull.data.base.sha,
      headsha: pull.data.head.sha
    })
  }

  constructor(
    params: OctokitNoActionsPullRequestParams & {
      title: string
      body: string
      basesha: string
      headsha: string
    }
  ) {
    this.owner = params.owner
    this.repo = params.repo
    this.number = params.pullNumber
    this.title = params.title
    this.body = params.body
    this.basesha = params.basesha
    this.headsha = params.headsha
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
