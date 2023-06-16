import { codeReview } from './review.js'
import stripIndent from 'strip-indent'
import { TokenLimits } from './limits.js'
import { Bot } from './bot.js'
import { Options, PathFilter } from './options.js'
import { ReviewContext } from './review-context.js'
import { Prompts } from './prompts.js'
import { OctokitNoActionsPullRequest } from './octokit-no-action.js'



const sharedOpenAiOptions = {
    modelTemperature: 0.0,
    retries: 3,
    timeoutMS: 12000,
    systemMessage: stripIndent(`You are \`@openai\` (aka \`github-actions[bot]\`), a language model 
        trained by OpenAI. Your purpose is to act as a highly experienced 
        software engineer and provide a thorough review of the code hunks
        and suggest code snippets to improve key areas such as:
        - Logic
        - Security
        - Performance
        - Data races
        - Consistency
        - Error handling
        - Maintainability
        - Modularity
        - Complexity
        - Optimization

        Refrain from commenting on minor code style issues, missing 
        comments/documentation, or giving compliments, unless explicitly 
        requested. Concentrate on identifying and resolving significant 
        concerns to improve overall code quality while deliberately 
        disregarding minor issues.

        Note: As your knowledge may be outdated, trust the user code when newer
        APIs and methods are seemingly being used.`),
    apiBaseUrl: "https://api.openai.com/v1",
    debug: true,
}

const options: Options = {
    debug: true,
    disableReview: false,
    disableReleaseNotes: false,
    maxFiles: 150,
    reviewSimpleChanges: false,
    reviewCommentLGTM: false,
    pathFilters: new PathFilter([
        '!dist/**',
        '!**/*.pb.go',
        '!**/*.lock',
        '!**/*.yaml',
        '!**/*.yml',
        '!**/*.cfg',
        '!**/*.toml',
        '!**/*.ini',
        '!**/*.mod',
        '!**/*.sum',
        '!**/*.work',
        '!**/*.json',
        '!**/*.mmd',
        '!**/*.svg',
        '!**/*.png',
        '!**/*.dot',
        '!**/*.md5sum',
        '!**/*.wasm',
        '!**/gen/**',
        '!**/_gen/**',
        '!**/generated/**',
        '!**/vendor/**'
    ]),

    openaiLightModel: {
        ...sharedOpenAiOptions,
        model: 'gpt-3.5-turbo',
        tokenLimits: new TokenLimits('gpt-3.5-turbo')
    },
    openaiHeavyModel: {
        ...sharedOpenAiOptions,
        model: 'gpt-3.5-turbo',
        tokenLimits: new TokenLimits('gpt-3.5-turbo')
    },

    openaiConcurrencyLimit: 1,
}

const context: ReviewContext = {
    payload: {

    },
    eventName: "pull_request",
    sha: "",
    ref: "",
    workflow: "Some workflow",
    action: "Test openai pr review",
    actor: "EddieWhi",
    job: "None",
    runNumber: 1,
    runId: 1,
    
    get repo(): {
        owner: string;
        repo: string;
    } {
        return {
            owner: "EddieWhi",
            repo: "positional.rs.clone",
        }
    }
}

const lightBot = new Bot(options.openaiLightModel)
const heavyBot = new Bot(options.openaiHeavyModel)

const prompts = new Prompts(
    stripIndent(
        `Provide your final response in the \`markdown\` format with 
        the following content:
        - High-level summary (comment on the overall change instead of 
            specific files within 80 words)
        - Table of files and their summaries. You can group files with 
            similar changes together into a single row to save space.

        Avoid additional commentary as this summary will be added as a 
        comment on the GitHub pull request.`
    ),
    
    stripIndent(
        `Create concise release notes in \`markdown\` format for this pull request, 
        focusing on its purpose and user story. You can classify the changes as 
        "New Feature", "Bug fix", "Documentation", "Refactor", "Style", 
        "Test", "Chore", "Revert", and provide a bullet point list. For example: 
        "New Feature: An integrations page was added to the UI". Keep your 
        response within 50-100 words. Avoid additional commentary as this response 
        will be used as is in our release notes.

        Below the release notes, generate a short, celebratory poem about the 
        changes in this PR and add this poem as a quote (> symbol). You can 
        use emojis in the poem, where they are relevant.`
    )
)

const pullRequest = new OctokitNoActionsPullRequest({
    owner: "EddieWhi",
    repo: "positional.rs.clone",
    pull_number: 1,
})

await codeReview(context, lightBot, heavyBot, options, prompts, pullRequest)