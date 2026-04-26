"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLogger = getLogger;
exports.marketLogger = marketLogger;
const pino_1 = __importDefault(require("pino"));
let cached = null;
function getLogger() {
    if (cached)
        return cached;
    const level = process.env.KESTREL_LOG_LEVEL || "info";
    const format = (process.env.KESTREL_LOG_FORMAT || "pretty").toLowerCase();
    if (format === "json") {
        cached = (0, pino_1.default)({ level });
    }
    else {
        cached = (0, pino_1.default)({
            level,
            transport: {
                target: "pino-pretty",
                options: {
                    colorize: true,
                    translateTime: "SYS:HH:MM:ss.l",
                    ignore: "pid,hostname",
                },
            },
        });
    }
    return cached;
}
function marketLogger(base, marketId) {
    return base.child({ market_id: marketId });
}
