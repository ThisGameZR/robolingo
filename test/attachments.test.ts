import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as webhook } from "@/app/api/line/webhook/route";
import { POST as sendRoute } from "@/app/api/contacts/[userId]/messages/route";
import { POST as uploadRoute } from "@/app/api/uploads/route";
import { SESSION_COOKIE, sessionToken } from "@/lib/auth";
import { getContact, listMessages } from "@/lib/chat";
import { USER, mockLine, resetDb, textEvent, webhookRequest } from "./helpers";

const STORE = "https://teststore123.public.blob.vercel-storage.com";
const IMG = `${STORE}/uploads/photo-AbC123.jpg`;
const PREVIEW = `${STORE}/uploads/photo-preview-XyZ789.jpg`;
const PDF = `${STORE}/uploads/price-list-Qw3.pdf`;

let line: ReturnType<typeof mockLine>;

beforeEach(async () => {
  vi.restoreAllMocks();
  line = mockLine();
  await resetDb();
  await webhook(webhookRequest([textEvent(USER, "hi", { replyToken: "tok-1" })]));
});

async function authed(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `${SESSION_COOKIE}=${await sessionToken()}`,
    },
    body: JSON.stringify(body),
  });
}

async function send(body: unknown) {
  const req = await authed(`http://localhost/api/contacts/${USER}/messages`, body);
  return sendRoute(req, { params: Promise.resolve({ userId: USER }) });
}

describe("sending an image", () => {
  it("sends a LINE image message, free via Reply when possible", async () => {
    const res = await send({ type: "image", url: IMG, previewUrl: PREVIEW });

    expect(res.status).toBe(201);
    expect(line.replyMessage).toHaveBeenCalledWith({
      replyToken: "tok-1",
      messages: [{ type: "image", originalContentUrl: IMG, previewImageUrl: PREVIEW }],
    });
    const [, sent] = await listMessages(USER);
    expect(sent).toMatchObject({ type: "image", mediaUrl: IMG, previewUrl: PREVIEW, delivery: "reply" });
    expect((await getContact(USER))?.lastMessagePreview).toBe("You: [Image]");
  });

  it.each([
    ["another site", "https://evil.example.com/uploads/x.jpg"],
    ["another Blob store", "https://otherstore.public.blob.vercel-storage.com/uploads/x.jpg"],
    ["outside uploads/", `${STORE}/secrets/x.jpg`],
    ["plain http", "http://teststore123.public.blob.vercel-storage.com/uploads/x.jpg"],
    ["not a URL", "javascript:alert(1)"],
  ])("refuses URLs from %s", async (_label, url) => {
    const res = await send({ type: "image", url, previewUrl: PREVIEW });
    expect(res.status).toBe(400);
    expect(line.replyMessage).not.toHaveBeenCalled();
    expect(line.pushMessage).not.toHaveBeenCalled();
  });
});

describe("sending a file", () => {
  it("sends a download link, because LINE can't deliver files from an OA", async () => {
    const res = await send({ type: "file", url: PDF, fileName: "price-list.pdf", fileSize: 245_760 });

    expect(res.status).toBe(201);
    expect(line.replyMessage).toHaveBeenCalledWith({
      replyToken: "tok-1",
      messages: [{ type: "text", text: `📎 price-list.pdf (240 KB)\n${PDF}` }],
    });
    const [, sent] = await listMessages(USER);
    expect(sent).toMatchObject({ type: "file", text: "price-list.pdf", mediaUrl: PDF, fileSize: 245_760 });
  });

  it("validates the file metadata", async () => {
    expect((await send({ type: "file", url: PDF, fileName: "", fileSize: 1 })).status).toBe(400);
    expect((await send({ type: "file", url: PDF, fileName: "a.pdf", fileSize: -1 })).status).toBe(400);
    expect((await send({ type: "file", url: PDF, fileName: "a.pdf", fileSize: 26 * 1024 * 1024 })).status).toBe(400);
  });
});

describe("upload tokens", () => {
  const tokenRequest = (kind: unknown, pathname = "uploads/photo.jpg") => ({
    type: "blob.generate-client-token",
    payload: { pathname, multipart: false, clientPayload: JSON.stringify({ kind }) },
  });

  it("are only issued to signed-in operators", async () => {
    const res = await uploadRoute(
      new Request("http://localhost/api/uploads", {
        method: "POST",
        body: JSON.stringify(tokenRequest("image")),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("are issued for known kinds under uploads/", async () => {
    const res = await uploadRoute(await authed("http://localhost/api/uploads", tokenRequest("image")));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ type: "blob.generate-client-token", clientToken: expect.any(String) });
  });

  it("are refused for unknown kinds or other paths", async () => {
    expect((await uploadRoute(await authed("http://localhost/api/uploads", tokenRequest("script")))).status).toBe(400);
    expect(
      (await uploadRoute(await authed("http://localhost/api/uploads", tokenRequest("image", "../etc/passwd")))).status,
    ).toBe(400);
  });

  it("don't accept upload-completed callbacks (we never register one)", async () => {
    const res = await uploadRoute(
      await authed("http://localhost/api/uploads", { type: "blob.upload-completed", payload: {} }),
    );
    expect(res.status).toBe(400);
  });
});
