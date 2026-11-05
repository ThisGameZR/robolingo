# 6. Attachments: the browser uploads straight to Vercel Blob

**Status:** accepted

## Context
Operators need to send images and documents. LINE's rules shape the design:
- **Images** are sent by **public HTTPS URL** (original JPEG/PNG ≤ 10 MB, plus a preview ≤ 1 MB). There is no upload API, so LINE fetches the file from our URL.
- **Files** (PDF, etc.) **can't be sent** by an OA at all. Only users can send files.

Vercel functions accept at most **4.5 MB** per request body, so files can't pass through our API.

## Decision
- **Storage:** Vercel Blob, a *public* store in `sin1`, because LINE must be able to fetch the files.
- **Direct uploads:** the browser asks `/api/uploads` for a short-lived client token (signed-in operators only; 10 minutes; content-type and size limits per kind: `image`, `preview`, `file`), then uploads directly to Blob. Every name gets a random suffix, so URLs are unguessable.
- **Images** are re-encoded in the browser: a JPEG of at most 2048 px (≤ 10 MB) plus a 240 px preview (≤ 1 MB). That meets LINE's format rules for any input (PNG, WebP, GIF…) and **strips EXIF metadata such as GPS location**.
- **Files** are sent as a text message with the name, size and download link.
- **Only our own URLs:** the send API accepts media URLs only from *our* store's host, under `uploads/`, so it can't be abused to make the OA deliver arbitrary images or links.
- **Sending** goes through the same Reply-first, Push-fallback path as text ([ADR 0002](0002-reply-api-first.md)).

## Consequences
- Large files never touch our functions: no 4.5 MB limit, and no function time spent streaming bytes.
- Uploaded files are public to anyone who has the exact URL. That's inherent to how LINE fetches media, and acceptable for files an operator is deliberately sending to a customer. A retention job (delete after N days) would be the next step for sensitive use.
- **Allowed file types:** only common document types. HTML, SVG and scripts are blocked, so the public store can't be used to host active content.
