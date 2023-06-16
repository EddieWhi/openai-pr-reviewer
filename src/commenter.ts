import {info, warning} from './logger.js'

// eslint-disable-next-line camelcase
import {ReviewContext} from './review-context.js'
import {octokit} from './octokit.js'
import { PullRequest, ReviewComment, ReviewCommentArgs } from './pull-request.js'


export const COMMENT_GREETING = ':robot: OpenAI'

export const COMMENT_TAG =
  '<!-- This is an auto-generated comment by OpenAI -->'

export const COMMENT_REPLY_TAG =
  '<!-- This is an auto-generated reply by OpenAI -->'

export const SUMMARIZE_TAG =
  '<!-- This is an auto-generated comment: summarize by openai -->'

export const DESCRIPTION_START_TAG = `
<!-- This is an auto-generated comment: release notes by openai -->`
export const DESCRIPTION_END_TAG =
  '<!-- end of auto-generated comment: release notes by openai -->'

export const RAW_SUMMARY_START_TAG = `<!-- This is an auto-generated comment: raw summary by openai -->
<!--
`
export const RAW_SUMMARY_END_TAG = `-->
<!-- end of auto-generated comment: raw summary by openai -->`

export const SHORT_SUMMARY_START_TAG = `<!-- This is an auto-generated comment: short summary by openai -->
<!--
`

export const SHORT_SUMMARY_END_TAG = `-->
<!-- end of auto-generated comment: short summary by openai -->`

export const COMMIT_ID_START_TAG = '<!-- commit_ids_reviewed_start -->'
export const COMMIT_ID_END_TAG = '<!-- commit_ids_reviewed_end -->'

export class Commenter {
  context: ReviewContext
  repo: { owner: string; repo: string }
  issue: PullRequest
  
  constructor(context: ReviewContext, issue: PullRequest) {
    this.issue = issue
    this.context = context
    this.repo = context.repo
  }

  /**
   * @param mode Can be "create", "replace". Default is "replace".
   */
  async comment(message: string, tag: string, mode: string) {
    //TODO: extract from issues somewhere else
    // if (this.context.payload.pull_request != null) {
    //   target = this.context.payload.pull_request.number
    // } else if (this.context.payload.issue != null) {
    //   target = this.context.payload.issue.number
    // } else {
    //   warning(
    //     'Skipped: context.payload.pull_request and context.payload.issue are both null'
    //   )
    //   return
    // }

    if (!tag) {
      tag = COMMENT_TAG
    }

    const body = `${COMMENT_GREETING}

${message}

${tag}`

    if (mode === 'create') {
      await this.create(body)
    } else if (mode === 'replace') {
      await this.replace(body, tag)
    } else {
      warning(`Unknown mode: ${mode}, use "replace" instead`)
      await this.replace(body, tag)
    }
  }

  getContentWithinTags(content: string, startTag: string, endTag: string) {
    const start = content.indexOf(startTag)
    const end = content.indexOf(endTag)
    if (start >= 0 && end >= 0) {
      return content.slice(start + startTag.length, end)
    }
    return ''
  }

  removeContentWithinTags(content: string, startTag: string, endTag: string) {
    const start = content.indexOf(startTag)
    const end = content.indexOf(endTag)
    if (start >= 0 && end >= 0) {
      return content.slice(0, start) + content.slice(end + endTag.length)
    }
    return content
  }

  getRawSummary(summary: string) {
    return this.getContentWithinTags(
      summary,
      RAW_SUMMARY_START_TAG,
      RAW_SUMMARY_END_TAG
    )
  }

  getShortSummary(summary: string) {
    return this.getContentWithinTags(
      summary,
      SHORT_SUMMARY_START_TAG,
      SHORT_SUMMARY_END_TAG
    )
  }

  getDescription(description: string) {
    return this.removeContentWithinTags(
      description,
      DESCRIPTION_START_TAG,
      DESCRIPTION_END_TAG
    )
  }

  getReleaseNotes(description: string) {
    const releaseNotes = this.getContentWithinTags(
      description,
      DESCRIPTION_START_TAG,
      DESCRIPTION_END_TAG
    )
    return releaseNotes.replace(/(^|\n)> .*/g, '')
  }

  async updateDescription(pullNumber: number, message: string) {
    // add this response to the description field of the PR as release notes by looking
    // for the tag (marker)
    try {
      const description = this.getDescription(await this.issue.getDescription())

      const messageClean = this.removeContentWithinTags(
        message,
        DESCRIPTION_START_TAG,
        DESCRIPTION_END_TAG
      )
      const newDescription = `${description}${DESCRIPTION_START_TAG}\n${messageClean}\n${DESCRIPTION_END_TAG}`
      
      await this.issue.updateDescription(newDescription)
    } catch (e) {
      warning(
        `Failed to get PR: ${e}, skipping adding release notes to description.`
      )
    }
  }

  private readonly reviewCommentsBuffer: Array<{
    path: string
    startLine: number
    endLine: number
    message: string
  }> = []

  bufferReviewComment(
    path: string,
    startLine: number,
    endLine: number,
    message: string
  ) {
    message = `${COMMENT_GREETING}

${message}

${COMMENT_TAG}`
    this.reviewCommentsBuffer.push({
      path,
      startLine,
      endLine,
      message
    })
  }

  async submitReview(commitId: string) {
    info(
      `Submitting review for PR #${this.issue.number}, total comments: ${this.reviewCommentsBuffer.length}`
    )
    let commentCounter = 0
    for (const comment of this.reviewCommentsBuffer) {
      info(`Posting comment: ${comment.message}`)
      let found = false
      const comments = await this.getCommentsAtRange(
        comment.path,
        comment.startLine,
        comment.endLine
      )
      for (const c of comments) {
        if (c.body.includes(COMMENT_TAG)) {
          info(
            `Updating review comment for ${comment.path}:${comment.startLine}-${comment.endLine}: ${comment.message}`
          )
          try {
            await this.issue.updateReviewComment(c.id, comment.message)
          } catch (e) {
            warning(`Failed to update review comment: ${e}`)
          }
          found = true
          break
        }
      }

      if (!found) {
        info(
          `Creating new review comment for ${comment.path}:${comment.startLine}-${comment.endLine}: ${comment.message}`
        )
        
        const commentData: ReviewCommentArgs = {
          commit_id: commitId,
          body: comment.message,
          path: comment.path,
          line: comment.endLine,
          ...(comment.startLine === comment.endLine) ? {} : { 
            // eslint-disable-next-line camelcase
            start_side: 'RIGHT',
            // eslint-disable-next-line camelcase
            start_line: comment.startLine
          }
        }

        try {
          await this.issue.createReviewComment(commentData)
        } catch (e) {
          warning(`Failed to create review comment: ${e}`)
        }
      }

      commentCounter++
      info(
        `Comment ${commentCounter}/${this.reviewCommentsBuffer.length} posted`
      )
    }
  }

  async reviewCommentReply(
    pullNumber: number,
    topLevelComment: any,
    message: string
  ) {
    const reply = `${COMMENT_GREETING}

${message}

${COMMENT_REPLY_TAG}
`
    try {
      // Post the reply to the user comment
      await this.issue.createReplyForReviewComment(topLevelComment.id, reply)

    } catch (error) {
      warning(`Failed to reply to the top-level comment ${error}`)
      try {
        await this.issue.createReplyForReviewComment(
          topLevelComment.id, 
          `Could not post the reply to the top-level comment due to the following error: ${error}`,
        )
      } catch (e) {
        warning(`Failed to reply to the top-level comment ${e}`)
      }
    }
    try {
      if (topLevelComment.body.includes(COMMENT_TAG)) {
        // replace COMMENT_TAG with COMMENT_REPLY_TAG in topLevelComment
        const newBody = topLevelComment.body.replace(
          COMMENT_TAG,
          COMMENT_REPLY_TAG
        )
        await this.issue.updateReviewComment(topLevelComment.id, newBody)
      }
    } catch (error) {
      warning(`Failed to update the top-level comment ${error}`)
    }
  }

  async getCommentsWithinRange(
    path: string,
    startLine: number,
    endLine: number
  ) {
    const comments = await this.issue.listReviewComments()
    return comments.filter(
      (comment: ReviewComment) =>
        comment.path === path &&
        comment.body !== '' &&
        ((comment.start_line &&
          comment.start_line >= startLine &&
          comment.line &&
          comment.line <= endLine) ||
          (startLine === endLine && comment.line === endLine))
    )
  }

  private async getCommentsAtRange(
    path: string,
    startLine: number,
    endLine: number
  ) {
    const comments = await this.issue.listReviewComments()
    return comments.filter(
      (comment: any) =>
        comment.path === path &&
        comment.body !== '' &&
        ((comment.start_line !== undefined &&
          comment.start_line === startLine &&
          comment.line === endLine) ||
          (startLine === endLine && comment.line === endLine))
    )
  }

  async getCommentChainsWithinRange(
    path: string,
    startLine: number,
    endLine: number,
    tag = ''
  ) {
    const existingComments = await this.getCommentsWithinRange(
      path,
      startLine,
      endLine
    )
    // find all top most comments
    const topLevelComments = []
    for (const comment of existingComments) {
      if (!comment.in_reply_to_id) {
        topLevelComments.push(comment)
      }
    }

    let allChains = ''
    let chainNum = 0
    for (const topLevelComment of topLevelComments) {
      // get conversation chain
      const chain = await this.composeCommentChain(
        existingComments,
        topLevelComment
      )
      if (chain && chain.includes(tag)) {
        chainNum += 1
        allChains += `Conversation Chain ${chainNum}:
${chain}
---
`
      }
    }
    return allChains
  }

  private async composeCommentChain(reviewComments: any[], topLevelComment: any) {
    const conversationChain = reviewComments
      .filter((cmt: any) => cmt.in_reply_to_id === topLevelComment.id)
      .map((cmt: any) => `${cmt.user.login}: ${cmt.body}`)

    conversationChain.unshift(
      `${topLevelComment.user.login}: ${topLevelComment.body}`
    )

    return conversationChain.join('\n---\n')
  }

  async getCommentChain(comment: any) {
    try {
      const reviewComments = await this.issue.listReviewComments()
      const topLevelComment = await this.getTopLevelComment(
        reviewComments,
        comment
      )
      const chain = await this.composeCommentChain(
        reviewComments,
        topLevelComment
      )
      return {chain, topLevelComment}
    } catch (e) {
      warning(`Failed to get conversation chain: ${e}`)
      return {
        chain: '',
        topLevelComment: null
      }
    }
  }

  private async getTopLevelComment(reviewComments: any[], comment: any) {
    let topLevelComment = comment

    while (topLevelComment.in_reply_to_id) {
      const parentComment = reviewComments.find(
        (cmt: any) => cmt.id === topLevelComment.in_reply_to_id
      )

      if (parentComment) {
        topLevelComment = parentComment
      } else {
        break
      }
    }

    return topLevelComment
  }

  private async create(body: string) {
    try {
      // get commend ID from the response
      await this.issue.createComment(body)
    } catch (e) {
      warning(`Failed to create comment: ${e}`)
    }
  }

  private async replace(body: string, tag: string) {
    try {
      const cmt = await this.findCommentWithTag(tag)
      if (cmt) {
        await this.issue.updateComment(
          // eslint-disable-next-line camelcase
          cmt.id,
          body
        )
      } else {
        await this.create(body)
      }
    } catch (e) {
      warning(`Failed to replace comment: ${e}`)
    }
  }

  async findCommentWithTag(tag: string) {
    try {
      const comments = await this.issue.listComments()
      for (const cmt of comments) {
        if (cmt.body && cmt.body.includes(tag)) {
          return cmt
        }
      }

      return null
    } catch (e: unknown) {
      warning(`Failed to find comment with tag: ${e}`)
      return null
    }
  }

  // function that takes a comment body and returns the list of commit ids that have been reviewed
  // commit ids are comments between the commit_ids_reviewed_start and commit_ids_reviewed_end markers
  // <!-- [commit_id] -->
  getReviewedCommitIds(commentBody: string): string[] {
    const start = commentBody.indexOf(COMMIT_ID_START_TAG)
    const end = commentBody.indexOf(COMMIT_ID_END_TAG)
    if (start === -1 || end === -1) {
      return []
    }
    const ids = commentBody.substring(start + COMMIT_ID_START_TAG.length, end)
    // remove the <!-- and --> markers from each id and extract the id and remove empty strings
    return ids
      .split('<!--')
      .map(id => id.replace('-->', '').trim())
      .filter(id => id !== '')
  }

  // get review commit ids comment block from the body as a string
  // including markers
  getReviewedCommitIdsBlock(commentBody: string): string {
    const start = commentBody.indexOf(COMMIT_ID_START_TAG)
    const end = commentBody.indexOf(COMMIT_ID_END_TAG)
    if (start === -1 || end === -1) {
      return ''
    }
    return commentBody.substring(start, end + COMMIT_ID_END_TAG.length)
  }

  // add a commit id to the list of reviewed commit ids
  // if the marker doesn't exist, add it
  addReviewedCommitId(commentBody: string, commitId: string): string {
    const start = commentBody.indexOf(COMMIT_ID_START_TAG)
    const end = commentBody.indexOf(COMMIT_ID_END_TAG)
    if (start === -1 || end === -1) {
      return `${commentBody}\n${COMMIT_ID_START_TAG}\n<!-- ${commitId} -->\n${COMMIT_ID_END_TAG}`
    }
    const ids = commentBody.substring(start + COMMIT_ID_START_TAG.length, end)
    return `${commentBody.substring(
      0,
      start + COMMIT_ID_START_TAG.length
    )}${ids}<!-- ${commitId} -->\n${commentBody.substring(end)}`
  }

  // given a list of commit ids provide the highest commit id that has been reviewed
  getHighestReviewedCommitId(
    commitIds: string[],
    reviewedCommitIds: string[]
  ): string {
    for (const commitId in commitIds) {
      if (reviewedCommitIds.includes(commitId)) {
        return commitId
      }
    }
    return ''
  }
}
