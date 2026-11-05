// Test configuration. Never point tests at a real database or the real LINE API.
process.env.LINE_CHANNEL_SECRET = "0123456789abcdef0123456789abcdef";
process.env.LINE_CHANNEL_ACCESS_TOKEN = "t".repeat(120);
process.env.APP_PASSWORD = "correct-horse-battery";
process.env.PGLITE_DIR = "memory://";
// Fake Blob store "TestStore123": tokens are signed locally, nothing is uploaded.
process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_TestStore123_fakesecret0123456789";
delete process.env.DATABASE_URL;
delete process.env.LINE_API_BASE_URL;
delete process.env.VERCEL;
