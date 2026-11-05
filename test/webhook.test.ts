import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/line/webhook/route";
import { getContact, listMessages } from "@/lib/chat";
import {
  OTHER_USER,
  USER,
  followEvent,
  mockLine,
  resetDb,
  textEvent,
  unfollowEvent,
  unsendEvent,
  webhookRequest,
} from "./helpers";

let line: ReturnType<typeof mockLine>;

beforeEach(async () => {
  vi.restoreAllMocks();
  line = mockLine();
  await resetDb();
});

describe("signature", () => {
  it("rejects a missing or wrong signature", async () => {
    expect((await POST(webhookRequest([], { signature: "" }))).status).toBe(401);
    expect((await POST(webhookRequest([], { signature: "bm9wZQ==" }))).status).toBe(401);
  });

  it("accepts LINE's empty verify request", async () => {
    expect((await POST(webhookRequest([]))).status).toBe(200);
  });
});

describe("messages", () => {
  it("stores the message and the sender's LINE profile", async () => {
    const res = await POST(webhookRequest([textEvent(USER, "สวัสดีครับ")]));
    expect(res.status).toBe(200);

    const contact = await getContact(USER);
    expect(contact).toMatchObject({
      displayName: `Name of ${USER.slice(0, 5)}`,
      unreadCount: 1,
      lastMessagePreview: "สวัสดีครับ",
    });
    const [msg] = await listMessages(USER);
    expect(msg).toMatchObject({ direction: "in", type: "text", text: "สวัสดีครับ" });
  });

  it("ignores redelivered duplicates", async () => {
    const event = textEvent(USER, "hello", { id: "42" });
    await POST(webhookRequest([event]));
    await POST(webhookRequest([{ ...event, deliveryContext: { isRedelivery: true } }]));

    expect(await listMessages(USER)).toHaveLength(1);
    expect((await getContact(USER))?.unreadCount).toBe(1);
  });

  it("caches the profile instead of fetching it on every message", async () => {
    await POST(webhookRequest([textEvent(USER, "one"), textEvent(USER, "two")]));
    expect(line.getProfile).toHaveBeenCalledTimes(1);
  });

  it("keeps the newest preview when an older event arrives late", async () => {
    const now = Date.now();
    await POST(webhookRequest([textEvent(USER, "newest", { timestamp: now })]));
    await POST(webhookRequest([textEvent(USER, "older", { timestamp: now - 60_000 })]));

    const contact = await getContact(USER);
    expect(contact?.lastMessagePreview).toBe("newest");
    expect(contact?.unreadCount).toBe(2);
    expect((await listMessages(USER)).map((m) => m.text)).toEqual(["older", "newest"]);
  });

  it("clears an unsent message's content", async () => {
    await POST(webhookRequest([textEvent(USER, "oops, wrong chat", { id: "77" })]));
    await POST(webhookRequest([unsendEvent(USER, "77")]));

    const [msg] = await listMessages(USER);
    expect(msg.text).toBeNull();
    expect(msg.unsentAt).toBeInstanceOf(Date);
    expect((await getContact(USER))?.lastMessagePreview).toBe("Message unsent");
  });
});

describe("follow state", () => {
  it("tracks block/unblock", async () => {
    const t = Date.now();
    await POST(webhookRequest([followEvent(USER, t)]));
    await POST(webhookRequest([unfollowEvent(USER, t + 1000)]));
    expect((await getContact(USER))?.isFollowing).toBe(false);
  });

  it("does not let a late, redelivered follow undo a newer unfollow", async () => {
    const t = Date.now();
    await POST(webhookRequest([followEvent(USER, t)]));
    await POST(webhookRequest([unfollowEvent(USER, t + 1000)]));
    await POST(webhookRequest([followEvent(USER, t)])); // redelivery of the old follow
    expect((await getContact(USER))?.isFollowing).toBe(false);
  });
});

describe("failures", () => {
  it("returns 500 so LINE retries, but still processes the other events", async () => {
    line.getProfile.mockRejectedValueOnce(new Error("LINE down")); // profile errors are tolerated
    const bad = { ...textEvent(USER, "x"), message: null } as unknown as ReturnType<typeof textEvent>;

    const res = await POST(webhookRequest([bad, textEvent(OTHER_USER, "still saved")]));

    expect(res.status).toBe(500);
    expect(await listMessages(OTHER_USER)).toHaveLength(1);
  });

  it("is safe to retry: the redelivered batch doesn't duplicate what succeeded", async () => {
    const good = textEvent(OTHER_USER, "once", { id: "900" });
    const bad = { ...textEvent(USER, "x"), message: null } as unknown as ReturnType<typeof textEvent>;
    await POST(webhookRequest([bad, good]));
    await POST(webhookRequest([bad, good]));
    expect(await listMessages(OTHER_USER)).toHaveLength(1);
  });
});
