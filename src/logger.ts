import { createLogger, format, transports } from 'winston'
import { consoleFormat } from "winston-console-format";

export const logger = createLogger({
    level: "silly",
    format: format.combine(
      format.timestamp(),
      format.ms(),
      format.errors({ stack: true }),
      format.splat(),
      format.json()
    ),
    defaultMeta: { service: "Test" },
    transports: [
      new transports.Console({
        format: format.combine(
          format.colorize({ all: true }),
          format.padLevels(),
          consoleFormat({
            showMeta: true,
            metaStrip: ["timestamp", "service"],
            inspectOptions: {
              depth: Infinity,
              colors: true,
              maxArrayLength: Infinity,
              breakLength: 120,
              compact: Infinity,
            },
          })
        ),
      }),
    ],
  })

export function error(message: string, ...meta: any[]) {
    logger.error(message, ...meta)
}

export function warning(message: string, ...meta: any[]) {
    logger.warn(message, ...meta)
}

export function info(message: string, ...meta: any[]) {
    logger.info(message, ...meta)
}

export function debig(message: string, ...meta: any[]) {
    logger.debug(message, ...meta)
}