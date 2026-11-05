"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// JSON shapes returned by the API (dates arrive as ISO strings).
type Contact = {
  userId: string;
  displayName: string;
  pictureUrl: string | null;
  statusMessage: string | null;
  isFollowing: boolean;
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
};

type Message = {
  id: number;
  userId: string;
  direction: "in" | "out";
  type: string;
  text: string | null;
  lineMessageId: string | null;
  stickerPackageId: string | null;
  stickerId: string | null;
  status: "received" | "sent" | "failed";
  error: string | null;
  createdAt: string;
  /** Client-only: message shown before the server confirms it. */
  pending?: boolean;
};

const CONTACTS_POLL_MS = 4000;
const MESSAGES_POLL_MS = 2500;

/** Calls `fn` now and every `ms` while the tab is visible. */
function usePolling(fn: () => void, ms: number, enabled = true) {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      if (document.visibilityState === "visible") fnRef.current();
    };
    tick();
    const id = setInterval(tick, ms);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [ms, enabled]);
}

export default function Inbox() {
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  const handleUnauthorized = useCallback(
    (res: Response) => {
      if (res.status === 401) {
        router.replace("/login");
        return true;
      }
      return false;
    },
    [router],
  );

  const loadContacts = useCallback(async () => {
    try {
      const res = await fetch("/api/contacts", { cache: "no-store" });
      if (handleUnauthorized(res)) return;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { contacts: Contact[] };
      setContacts(data.contacts);
      setLoadError(null);
    } catch {
      setLoadError("Can't reach the server. Retrying…");
    }
  }, [handleUnauthorized]);

  usePolling(loadContacts, CONTACTS_POLL_MS);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!contacts || !q) return contacts ?? [];
    return contacts.filter((c) => c.displayName.toLowerCase().includes(q));
  }, [contacts, search]);

  const selected = contacts?.find((c) => c.userId === selectedId) ?? null;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-slate-100">
      {/* Sidebar: user list */}
      <aside
        className={`${selectedId ? "hidden md:flex" : "flex"} w-full flex-col border-r border-slate-200 bg-white md:w-80 lg:w-96`}
      >
        <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#06C755] font-bold text-white">
              R
            </div>
            <div>
              <h1 className="text-sm font-semibold leading-tight text-slate-900">Robolingo</h1>
              <p className="text-xs leading-tight text-slate-500">LINE OA webchat</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            Sign out
          </button>
        </header>

        <div className="border-b border-slate-200 p-3">
          <input
            type="search"
            placeholder="Search users"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-[#06C755]/30"
          />
        </div>

        {loadError && (
          <p className="bg-amber-50 px-4 py-2 text-xs text-amber-700">{loadError}</p>
        )}

        <ul className="flex-1 overflow-y-auto">
          {contacts === null && !loadError && (
            <li className="p-6 text-center text-sm text-slate-400">Loading…</li>
          )}
          {contacts !== null && filtered.length === 0 && (
            <li className="p-6 text-center text-sm leading-relaxed text-slate-400">
              {contacts.length === 0
                ? "No conversations yet. Add the LINE OA as a friend and send it a message."
                : "No users match your search."}
            </li>
          )}
          {filtered.map((c) => (
            <li key={c.userId}>
              <button
                onClick={() => setSelectedId(c.userId)}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50 ${
                  c.userId === selectedId ? "bg-emerald-50 hover:bg-emerald-50" : ""
                }`}
              >
                <Avatar contact={c} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium text-slate-900">
                      {c.displayName}
                    </span>
                    {c.lastMessageAt && (
                      <span className="shrink-0 text-xs text-slate-400">
                        {formatListTime(c.lastMessageAt)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-slate-500">
                      {c.lastMessagePreview ?? (c.isFollowing ? "New friend" : "")}
                    </span>
                    {c.unreadCount > 0 && c.userId !== selectedId && (
                      <span className="shrink-0 rounded-full bg-[#06C755] px-1.5 text-[11px] font-semibold leading-5 text-white">
                        {c.unreadCount > 99 ? "99+" : c.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* Conversation */}
      <main className={`${selectedId ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col`}>
        {selected ? (
          <Conversation
            key={selected.userId}
            contact={selected}
            onBack={() => setSelectedId(null)}
            onUnauthorized={handleUnauthorized}
            onChanged={loadContacts}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-slate-400">
            <ChatIcon />
            <p className="text-sm">Select a user to view the conversation and reply</p>
          </div>
        )}
      </main>
    </div>
  );
}

function Conversation({
  contact,
  onBack,
  onUnauthorized,
  onChanged,
}: {
  contact: Contact;
  onBack: () => void;
  onUnauthorized: (res: Response) => boolean;
  onChanged: () => void;
}) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [pending, setPending] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastCountRef = useRef(0);
  const userId = contact.userId;

  const loadMessages = useCallback(async () => {
    const res = await fetch(`/api/contacts/${encodeURIComponent(userId)}/messages`, {
      cache: "no-store",
    }).catch(() => null);
    if (!res || onUnauthorized(res) || !res.ok) return;
    const data = (await res.json()) as { messages: Message[] };
    setMessages(data.messages);
  }, [userId, onUnauthorized]);

  usePolling(loadMessages, MESSAGES_POLL_MS);

  // Clear the unread badge when opening the chat and whenever new messages arrive while it's open.
  useEffect(() => {
    if (contact.unreadCount === 0) return;
    fetch(`/api/contacts/${encodeURIComponent(userId)}/read`, { method: "POST" })
      .then(onChanged)
      .catch(() => {});
  }, [userId, contact.unreadCount, onChanged]);

  const all = useMemo(() => [...(messages ?? []), ...pending], [messages, pending]);

  // Keep the newest message in view.
  useEffect(() => {
    if (all.length !== lastCountRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: lastCountRef.current ? "smooth" : "auto" });
      lastCountRef.current = all.length;
    }
  }, [all.length]);

  async function send() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    setSendError(null);

    const temp: Message = {
      id: -Date.now(),
      userId,
      direction: "out",
      type: "text",
      text,
      lineMessageId: null,
      stickerPackageId: null,
      stickerId: null,
      status: "sent",
      error: null,
      createdAt: new Date().toISOString(),
      pending: true,
    };
    setPending((p) => [...p, temp]);

    try {
      const res = await fetch(`/api/contacts/${encodeURIComponent(userId)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (onUnauthorized(res)) return;
      const data = (await res.json().catch(() => ({}))) as {
        message?: Message;
        error?: string;
      };
      if (!res.ok) {
        setSendError(data.message?.error ?? data.error ?? `Send failed (HTTP ${res.status})`);
        if (!data.message) setDraft(text); // not saved at all: give the text back
      }
      await loadMessages();
      onChanged();
    } catch {
      setSendError("Network error, message not sent");
      setDraft(text);
    } finally {
      setPending((p) => p.filter((m) => m.id !== temp.id));
    }
  }

  return (
    <>
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <button
          onClick={onBack}
          className="-ml-2 rounded-md p-1 text-slate-500 hover:bg-slate-100 md:hidden"
          aria-label="Back to user list"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
            <path d="M12.5 15 7.5 10l5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <Avatar contact={contact} size={40} />
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-slate-900">{contact.displayName}</h2>
          <p className="truncate text-xs text-slate-500">
            {contact.isFollowing ? (
              contact.statusMessage || "Friend"
            ) : (
              <span className="text-red-500">Blocked the OA — replies won&apos;t be delivered</span>
            )}
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto bg-[#8CABD9]/25 px-4 py-4">
        {messages === null ? (
          <p className="mt-10 text-center text-sm text-slate-400">Loading messages…</p>
        ) : all.length === 0 ? (
          <p className="mt-10 text-center text-sm text-slate-400">No messages yet.</p>
        ) : (
          <ol className="mx-auto flex max-w-3xl flex-col gap-1.5">
            {all.map((m, i) => {
              const prev = all[i - 1];
              const showDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
              return (
                <li key={m.id} className="flex flex-col">
                  {showDay && (
                    <span className="my-3 self-center rounded-full bg-slate-500/20 px-3 py-0.5 text-xs text-slate-600">
                      {formatDay(m.createdAt)}
                    </span>
                  )}
                  <Bubble message={m} contact={contact} />
                </li>
              );
            })}
          </ol>
        )}
        <div ref={bottomRef} />
      </div>

      <footer className="border-t border-slate-200 bg-white p-3">
        {sendError && <p className="mb-2 text-xs text-red-600">{sendError}</p>}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={`Reply to ${contact.displayName}…`}
            maxLength={5000}
            className="max-h-40 min-h-10 flex-1 resize-none rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-900 outline-none [field-sizing:content] placeholder:text-slate-400 focus:ring-2 focus:ring-[#06C755]/30"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="h-10 rounded-xl bg-[#06C755] px-4 text-sm font-medium text-white transition hover:bg-[#05b14c] disabled:opacity-40"
          >
            Send
          </button>
        </form>
        <p className="mt-1 text-[11px] text-slate-400">Enter to send · Shift+Enter for a new line</p>
      </footer>
    </>
  );
}

function Bubble({ message: m, contact }: { message: Message; contact: Contact }) {
  const out = m.direction === "out";
  const time = new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className={`flex items-end gap-2 ${out ? "flex-row-reverse" : ""}`}>
      {!out && <Avatar contact={contact} size={28} />}
      <div className={`flex max-w-[75%] flex-col ${out ? "items-end" : "items-start"}`}>
        <MessageBody message={m} out={out} />
        <span className="mt-0.5 px-1 text-[11px] text-slate-500">
          {m.pending ? "Sending…" : m.status === "failed" ? (
            <span className="text-red-600" title={m.error ?? undefined}>
              Not delivered{m.error ? `: ${m.error}` : ""}
            </span>
          ) : (
            time
          )}
        </span>
      </div>
    </div>
  );
}

function MessageBody({ message: m, out }: { message: Message; out: boolean }) {
  const bubble = `whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm shadow-sm ${
    out
      ? `rounded-br-md ${m.status === "failed" ? "bg-red-100 text-red-900" : "bg-[#06C755] text-white"} ${m.pending ? "opacity-60" : ""}`
      : "rounded-bl-md bg-white text-slate-900"
  }`;

  if (m.type === "text") return <div className={bubble}>{m.text}</div>;

  if (m.type === "sticker" && m.stickerId) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`https://stickershop.line-scdn.net/stickershop/v1/sticker/${m.stickerId}/android/sticker.png`}
        alt={m.text ?? "Sticker"}
        className="h-28 w-28 object-contain"
        loading="lazy"
      />
    );
  }

  if (m.type === "image" && m.lineMessageId) {
    const src = `/api/media/${m.lineMessageId}`;
    return (
      <a href={src} target="_blank" rel="noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="Image from user" className="max-h-72 rounded-2xl shadow-sm" loading="lazy" />
      </a>
    );
  }

  if ((m.type === "video" || m.type === "audio" || m.type === "file") && m.lineMessageId) {
    return (
      <a
        href={`/api/media/${m.lineMessageId}`}
        target="_blank"
        rel="noreferrer"
        className={`${bubble} underline`}
      >
        {m.type === "file" ? `📎 ${m.text ?? "File"}` : m.type === "video" ? "🎬 Video" : "🔊 Audio"}
      </a>
    );
  }

  if (m.type === "location") return <div className={bubble}>📍 {m.text}</div>;

  return <div className={`${bubble} italic opacity-80`}>[{m.type} message]</div>;
}

function Avatar({ contact, size }: { contact: Contact; size: number }) {
  if (contact.pictureUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={contact.pictureUrl}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  const initial = contact.displayName.trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-slate-300 font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      aria-hidden
    >
      {initial}
    </div>
  );
}

function ChatIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 0 1-3.6-.67L3 21l1.5-4.2C3.55 15.4 3 13.76 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// --- date helpers -----------------------------------------------------------

function dayKey(iso: string) {
  return new Date(iso).toDateString();
}

function formatDay(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

function formatListTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}
