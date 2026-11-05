import "server-only";
import { messagingApi } from "@line/bot-sdk";

/** Optional override, used only to point at a mock LINE server in tests. */
const API_BASE = process.env.LINE_API_BASE_URL || "https://api.line.me";
const DATA_API_BASE = process.env.LINE_API_BASE_URL || "https://api-data.line.me";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function channelSecret(): string {
  return requireEnv("LINE_CHANNEL_SECRET");
}

let client: messagingApi.MessagingApiClient | undefined;

export function lineClient(): messagingApi.MessagingApiClient {
  client ??= new messagingApi.MessagingApiClient({
    channelAccessToken: requireEnv("LINE_CHANNEL_ACCESS_TOKEN"),
    baseURL: API_BASE,
  });
  return client;
}

/** Downloads the binary content (image, video, ...) of a message a user sent. */
export function fetchMessageContent(messageId: string): Promise<Response> {
  return fetch(
    `${DATA_API_BASE}/v2/bot/message/${encodeURIComponent(messageId)}/content`,
    {
      headers: {
        Authorization: `Bearer ${requireEnv("LINE_CHANNEL_ACCESS_TOKEN")}`,
      },
      cache: "no-store",
    },
  );
}

/** Turns a LINE API error into a short message the UI can show. */
export function describeLineError(err: unknown): string {
  if (err && typeof err === "object" && "body" in err) {
    const body = (err as { body?: unknown }).body;
    if (typeof body === "string") {
      try {
        const parsed = JSON.parse(body) as { message?: string };
        if (parsed.message) return parsed.message;
      } catch {
        return body.slice(0, 200);
      }
    }
  }
  return err instanceof Error ? err.message : String(err);
}
