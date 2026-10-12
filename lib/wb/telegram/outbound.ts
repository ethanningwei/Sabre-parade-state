import "server-only";
import type { Api } from "grammy";
import { getBot } from "./bot";

// What the decision core needs to talk to Telegram: the API and the bot's
// username (for t.me links). The bot passes ctx.api and ctx.me; Mini App
// actions get it here. Tests mock this module to capture calls.

export interface Outbound {
  api: Api;
  botUsername: string;
}

export async function outbound(): Promise<Outbound> {
  const bot = await getBot();
  return { api: bot.api, botUsername: bot.botInfo.username };
}
