import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as webhook } from "@/app/api/line/webhook/route";
import { GET as contactsApi } from "@/app/api/contacts/route";
import { getDb, schema } from "@/db";
import { SESSION_COOKIE, sessionToken } from "@/lib/auth";
import { getContact, markRead, sendText } from "@/lib/chat";
import { USER, lineHttpError, mockLine, resetDb, textEvent, webhookRequest } from "./helpers";

let line: ReturnType<typeof mockLine>;

beforeEach(async () => {
  vi.restoreAllMocks();
  line = mockLine();
  await resetDb();
});

async function userWrites(text = "hi", opts: Parameters<typeof textEvent>[2] = {}) {
  await webhook(webhookRequest([textEvent(USER, text, opts)]));
}

async function ageReplyToken(seconds: number) {
  const db = await getDb();
  await db
    .update(schema.contacts)
    .set({ replyTokenReceivedAt: sql`now() - make_interval(secs => ${seconds})` });
}

describe("delivery: Reply API first, Push as fallback", () => {
  it("answers a fresh message with the free Reply API", async () => {
    await userWrites("hi", { replyToken: "tok-1" });

    const msg = await sendText(USER, "hello!");

    expect(line.replyMessage).toHaveBeenCalledWith({
      replyToken: "tok-1",
      messages: [{ type: "text", text: "hello!" }],
    });
    expect(line.pushMessage).not.toHaveBeenCalled();
    expect(msg).toMatchObject({ status: "sent", delivery: "reply" });
  });

  it("uses each reply token only once", async () => {
    await userWrites("hi", { replyToken: "tok-1" });
    await sendText(USER, "first");
    const second = await sendText(USER, "second");

    expect(line.replyMessage).toHaveBeenCalledTimes(1);
    expect(second.delivery).toBe("push");
  });

  it("never hands the same token to two concurrent sends", async () => {
    await userWrites("hi", { replyToken: "tok-1" });
    const results = await Promise.all([sendText(USER, "a"), sendText(USER, "b")]);

    expect(line.replyMessage).toHaveBeenCalledTimes(1);
    expect(results.map((m) => m.delivery).sort()).toEqual(["push", "reply"]);
  });

  it("pushes when the token is too old to trust", async () => {
    await userWrites("hi", { replyToken: "tok-1" });
    await ageReplyToken(55);

    const msg = await sendText(USER, "late answer");

    expect(line.replyMessage).not.toHaveBeenCalled();
    expect(msg.delivery).toBe("push");
  });

  it("falls back to Push when LINE says the token is invalid (400)", async () => {
    await userWrites("hi", { replyToken: "tok-1" });
    line.replyMessage.mockRejectedValueOnce(lineHttpError(400, "Invalid reply token"));

    const msg = await sendText(USER, "hello");

    expect(line.pushMessage).toHaveBeenCalledOnce();
    expect(msg).toMatchObject({ status: "sent", delivery: "push" });
  });

  it("does not risk a double send when Reply fails ambiguously (5xx)", async () => {
    await userWrites("hi", { replyToken: "tok-1" });
    line.replyMessage.mockRejectedValueOnce(lineHttpError(500, "Internal error"));

    const msg = await sendText(USER, "hello");

    expect(line.pushMessage).not.toHaveBeenCalled();
    expect(msg).toMatchObject({ status: "failed", error: "Internal error" });
  });

  it("records a failed push with LINE's reason", async () => {
    await userWrites("hi");
    await ageReplyToken(120);
    line.pushMessage.mockRejectedValueOnce(lineHttpError(400, "Failed to send messages"));

    const msg = await sendText(USER, "hello");

    expect(msg).toMatchObject({ status: "failed", error: "Failed to send messages" });
    expect((await getContact(USER))?.lastMessagePreview).toBe("hi");
  });
});

describe("read receipts", () => {
  it("marks the newest message as read on LINE, once", async () => {
    await userWrites("one", { markAsReadToken: "read-1" });
    await userWrites("two", { markAsReadToken: "read-2" });

    await markRead(USER);
    await markRead(USER);

    expect(line.markMessagesAsReadByToken).toHaveBeenCalledOnce();
    expect(line.markMessagesAsReadByToken).toHaveBeenCalledWith({ markAsReadToken: "read-2" });
    expect((await getContact(USER))?.unreadCount).toBe(0);
  });
});

describe("API responses", () => {
  it("never exposes LINE tokens to the browser", async () => {
    await userWrites("hi", { replyToken: "secret-reply", markAsReadToken: "secret-read" });

    const req = new Request("http://localhost/api/contacts", {
      headers: { cookie: `${SESSION_COOKIE}=${await sessionToken()}` },
    });
    const body = await (await contactsApi(req)).text();

    expect(body).toContain(USER);
    expect(body).not.toMatch(/secret-reply|secret-read|replyToken|markAsReadToken/);
  });
});
