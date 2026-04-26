"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildLogger = buildLogger;
const pino_1 = __importDefault(require("pino"));
/** One pino logger per role process; pretty-printed in dev. */
function buildLogger(role) {
    return (0, pino_1.default)({
        name: `kestrel-agent:${role}`,
        transport: process.env.NODE_ENV === "production"
            ? undefined
            : {
                target: "pino-pretty",
                options: {
                    colorize: true,
                    translateTime: "SYS:HH:MM:ss.l",
                    singleLine: false,
                },
            },
        base: { role },
        level: process.env.AGENTS_LOG_LEVEL || "info",
    });
}
