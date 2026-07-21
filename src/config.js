import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const REQUIRED = ["BOT_TOKEN", "ALLOWED_USER_ID", "ROUTER_BASE_URL", "ROUTER_API_KEY", "ROUTER_MODEL"];

export function validateConfig(env = process.env) {
  const missing = REQUIRED.filter((name) => !env[name]?.trim());
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  const retentionDays = Number(env.CONVERSATION_RETENTION_DAYS ?? 90);
  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    throw new Error("CONVERSATION_RETENTION_DAYS must be a positive integer");
  }
  return {
    botToken: env.BOT_TOKEN,
    allowedUserId: env.ALLOWED_USER_ID,
    routerBaseUrl: env.ROUTER_BASE_URL.replace(/\/$/, ""),
    routerApiKey: env.ROUTER_API_KEY,
    routerModel: env.ROUTER_MODEL,
    retentionDays,
    port: Number(env.PORT || 3000),
  };
}

export function loadConfig() {
  return validateConfig(process.env);
}
