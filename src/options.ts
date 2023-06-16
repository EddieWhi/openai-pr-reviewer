import {info} from './logger.js'
import {minimatch} from 'minimatch'
import {TokenLimits} from './limits.js'

export interface Options {
  debug: boolean
  disableReview: boolean
  disableReleaseNotes: boolean
  maxFiles: number
  reviewSimpleChanges: boolean
  reviewCommentLGTM: boolean
  pathFilters: PathFilter

  openaiLightModel: OpenAIOptions
  openaiHeavyModel: OpenAIOptions

  openaiConcurrencyLimit: number
}

export class PathFilter {
  private readonly rules: Array<[string /* rule */, boolean /* exclude */]>

  constructor(rules: string[] | null = null) {
    this.rules = []
    if (rules != null) {
      for (const rule of rules) {
        const trimmed = rule?.trim()
        if (trimmed) {
          if (trimmed.startsWith('!')) {
            this.rules.push([trimmed.substring(1).trim(), true])
          } else {
            this.rules.push([trimmed, false])
          }
        }
      }
    }
  }

  check(path: string): boolean {
    if (this.rules.length === 0) {
      info(`checking path: ${path}, no rules => ${true}`)
      return true
    }

    let included = false
    let excluded = false
    let inclusionRuleExists = false

    for (const [rule, exclude] of this.rules) {
      if (minimatch(path, rule)) {
        if (exclude) {
          excluded = true
        } else {
          included = true
        }
      }
      if (!exclude) {
        inclusionRuleExists = true
      }
    }

    const result = (!inclusionRuleExists || included) && !excluded
    info(`checking path: ${path} => ${result}`)
    return result
  }
}

export interface OpenAIOptions {
  model: string
  tokenLimits: TokenLimits
  modelTemperature: number
  systemMessage: string
  retries: number
  timeoutMS: number
  apiBaseUrl: string
  debug: boolean
}
