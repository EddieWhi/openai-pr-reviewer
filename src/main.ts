import {
  getBooleanInput,
  getInput,
  getMultilineInput,
  setFailed,
  info,
  warning
} from '@actions/core'
import {Bot} from './bot'
import {Options, PathFilter} from './options'
import {Prompts} from './prompts'
import {codeReview} from './review'
import {handleReviewComment} from './review-comment'
import {context} from '@actions/github'
import {TokenLimits} from './limits'
import {OctokitPullRequest} from './pull-request-impl'
import assert from 'assert'

async function run(): Promise<void> {
  const sharedOpenAiOptions = {
    modelTemperature: parseFloat(getInput('openai_model_temperature')),
    retries: parseInt(getInput('openai_retries')),
    timeoutMS: parseInt(getInput('openai_timeout_ms')),
    systemMessage: getInput('system_message'),
    apiBaseUrl: getInput('openai_base_url'),
    debug: getBooleanInput('debug')
  }

  const options: Options = {
    debug: getBooleanInput('debug'),
    disableReview: getBooleanInput('disable_review'),
    disableReleaseNotes: getBooleanInput('disable_release_notes'),
    maxFiles: parseInt(getInput('max_files')),
    reviewSimpleChanges: getBooleanInput('review_simple_changes'),
    reviewCommentLGTM: getBooleanInput('review_comment_lgtm'),
    pathFilters: new PathFilter(getMultilineInput('path_filters')),

    openaiLightModel: {
      ...sharedOpenAiOptions,
      model: getInput('openai_light_model'),
      tokenLimits: new TokenLimits(getInput('openai_light_model'))
    },
    openaiHeavyModel: {
      ...sharedOpenAiOptions,
      model: getInput('openai_heavy_model'),
      tokenLimits: new TokenLimits(getInput('openai_heavy_model'))
    },

    openaiConcurrencyLimit: parseInt(getInput('openai_concurrency_limit'))
  }

  // print options
  info(JSON.stringify(options))

  const prompts: Prompts = new Prompts(
    getInput('summarize'),
    getInput('summarize_release_notes')
  )

  // Create two bots, one for summary and one for review

  let lightBot: Bot | null = null
  try {
    lightBot = new Bot(options.openaiLightModel)
  } catch (e: any) {
    warning(
      `Skipped: failed to create summary bot, please check your openai_api_key: ${e}, backtrace: ${e.stack}`
    )
    return
  }

  let heavyBot: Bot | null = null
  try {
    heavyBot = new Bot(options.openaiHeavyModel)
  } catch (e: any) {
    warning(
      `Skipped: failed to create review bot, please check your openai_api_key: ${e}, backtrace: ${e.stack}`
    )
    return
  }

  try {
    const prContext = context.payload.pull_request || context.payload.issue
    assert(prContext, 'context.payload.pull_request is null')

    const pullRequest = new OctokitPullRequest({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pullNumber: prContext.number,
      title: prContext.title,
      body: prContext.body || '',
      headsha: prContext.head?.sha || '',
      basesha: prContext.base?.sha || ''
    })

    // check if the event is pull_request
    switch (context.eventName) {
      case 'pull_request':
      case 'pull_request_target':
        await codeReview(
          context,
          lightBot,
          heavyBot,
          options,
          prompts,
          pullRequest
        )
        break

      case 'pull_request_review_comment':
        await handleReviewComment(
          context,
          heavyBot,
          options,
          prompts,
          pullRequest
        )
        break

      default:
        warning(
          'Skipped: this action only works on push events or pull_request'
        )
    }
  } catch (e: any) {
    if (e instanceof Error) {
      setFailed(`Failed to run: ${e.message}, backtrace: ${e.stack}`)
    } else {
      setFailed(`Failed to run: ${e}, backtrace: ${e.stack}`)
    }
  }
}

process
  .on('unhandledRejection', (reason, p) => {
    warning(`Unhandled Rejection at Promise: ${reason}, promise is ${p}`)
  })
  .on('uncaughtException', (e: any) => {
    warning(`Uncaught Exception thrown: ${e}, backtrace: ${e.stack}`)
  })

run()
  // eslint-disable-next-line github/no-then
  .then(() => info('Done'))
  // eslint-disable-next-line github/no-then
  .catch(e => warning(`Uncaught Exception thrown: ${e}, backtrace: ${e.stack}`))
