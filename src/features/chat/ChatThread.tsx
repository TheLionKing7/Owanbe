import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { Check, FileText, Image as ImageIcon, Paperclip, Send, X } from "lucide-react";
import { Link } from "@/lib/router";
import { quoteApi as defaultQuoteApi, type QuoteApi } from "@/features/quotes/api";
import { formatMinor } from "@/features/quotes/contracts";
import { chatErrorMessage, createChatApi, type ChatApi } from "./api";
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_IMAGE_ACCEPT,
  ATTACHMENT_MAX_BYTES,
  MESSAGE_MAX_LENGTH,
  attachmentKindLabel,
  captionSchema,
  formatFileSize,
  formatMessageTime,
  isImageAttachment,
  liveThreadQuote,
  messageBodySchema,
  messageDayLabel,
  threadRevision,
  type ChatAttachment,
  type ConversationThread,
  type MessageKind,
  type ThreadQuoteRevision,
} from "./contracts";
import { ThreadQuoteCard } from "./ThreadQuoteCard";

interface ChatThreadProps {
  conversationId: string;
  /** Injected in tests; defaults to the app's own chat routes. */
  api?: ChatApi | undefined;
  /** F-23: the quote boundary, used when the host counters inside the thread. */
  quoteApi?: QuoteApi | undefined;
  /** The caller's token decides whether they take part in the conversation. */
  getAccessToken?: (() => Promise<string | null>) | undefined;
}

const NO_TOKEN = async (): Promise<string | null> => null;

/** Downloads the file rather than opening the storage page. */
async function downloadFile(url: string, fileName: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("download_failed");
  const blob = await res.blob();
  if (typeof URL.createObjectURL === "function") {
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
    return;
  }
  window.open(url, "_blank", "noopener");
}

export function ChatThread({
  conversationId,
  api,
  quoteApi = defaultQuoteApi,
  getAccessToken,
}: ChatThreadProps) {
  const readToken = getAccessToken ?? NO_TOKEN;
  const client = useMemo(() => api ?? createChatApi(readToken), [api, readToken]);

  const [thread, setThread] = useState<ConversationThread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<File | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  // Display clock only: the deadline is decided by the database, never by this interval.
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const documentInputRef = useRef<HTMLInputElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setThread(await client.thread(conversationId));
    } catch (caught) {
      setThread(null);
      setError(chatErrorMessage(caught));
    }
  }, [client, conversationId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep the newest message in view, the way a messaging app does.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || typeof element.scrollTo !== "function") return;
    element.scrollTo({ top: element.scrollHeight });
  }, [thread?.messages.length]);

  // The composer grows with the message, up to the height of the bubble.
  useEffect(() => {
    const element = bodyRef.current;
    if (!element) return;
    element.style.height = "auto";
    if (element.scrollHeight > 0) {
      element.style.height = `${Math.min(element.scrollHeight, 140)}px`;
    }
  }, [body]);

  async function send() {
    const file = pending;
    const caption = body.trim();
    if (!file) {
      const parsed = messageBodySchema.safeParse(body);
      if (!parsed.success) {
        setSendError(parsed.error.issues[0]?.message ?? "Check your message and try again.");
        return;
      }
      setSendError(null);
      setSending(true);
      try {
        await client.send(conversationId, parsed.data);
        setBody("");
        await load();
      } catch (caught) {
        setSendError(chatErrorMessage(caught));
      } finally {
        setSending(false);
      }
      return;
    }

    const parsed = captionSchema.safeParse(body);
    if (!parsed.success) {
      setSendError(parsed.error.issues[0]?.message ?? "Check your message and try again.");
      return;
    }
    setSendError(null);
    setSending(true);
    try {
      await client.sendDocument(conversationId, caption, file);
      setBody("");
      setPending(null);
      await load();
    } catch (caught) {
      setSendError(chatErrorMessage(caught));
    } finally {
      setSending(false);
    }
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;
    if (file.size <= 0 || file.size > ATTACHMENT_MAX_BYTES) {
      setAttachError("Share a file of 10 MB or less.");
      return;
    }
    setAttachError(null);
    setPending(file);
  }

  async function openAttachment(attachment: ChatAttachment) {
    setAttachError(null);
    try {
      const link = await client.link(conversationId, attachment.attachment_id);
      await downloadFile(link.url, link.file_name || attachment.file_name);
    } catch (caught) {
      setAttachError(chatErrorMessage(caught));
    }
  }

  const signedUrl = useCallback(
    async (attachmentId: string): Promise<string> => {
      const link = await client.link(conversationId, attachmentId);
      return link.url;
    },
    [client, conversationId],
  );

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  const backHref = thread?.side === "vendor" ? "/vendor/enquiries" : "/host/enquiries";
  const counterparty = thread?.counterparty_name ?? "Conversation";
  const initial = counterparty.trim().charAt(0).toUpperCase() || "?";
  const liveQuote = thread ? liveThreadQuote(thread.quotes) : null;

  return (
    <div
      className="flex max-h-[calc(100vh-11rem)] min-h-[30rem] flex-col overflow-hidden rounded-3xl border border-plum-900/10 bg-white shadow-card"
      data-testid="chat-thread"
    >
      <header className="flex items-center gap-3 border-b border-plum-900/10 bg-white px-3 py-3 sm:px-4">
        <Link
          to={backHref}
          aria-label="Back to enquiries"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg text-plum-800 hover:bg-plum-100"
          data-testid="chat-back"
        >
          ←
        </Link>
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-plum-950 font-display text-base font-bold text-cream-50"
        >
          {initial}
        </span>
        <div className="min-w-0">
          <h1
            id="chat-title"
            className="truncate font-display text-lg font-bold text-plum-950"
            data-testid="chat-title"
          >
            {counterparty}
          </h1>
          <p className="truncate text-xs text-ink-muted">
            Private · only you and {counterparty} can read this
          </p>
        </div>
      </header>

      {liveQuote && (
        <div className="border-b border-plum-900/10 bg-cream-50 px-3 py-3 sm:px-6">
          <ThreadQuoteCard
            quote={liveQuote}
            side={thread?.side ?? "host"}
            conversationId={conversationId}
            api={quoteApi}
            onCountered={() => void load()}
            now={now}
          />
        </div>
      )}

      <div
        ref={scrollRef}
        className="flex-1 space-y-1 overflow-y-auto bg-cream-100 px-3 py-4 sm:px-6"
      >
        {thread === null && !error && (
          <p role="status" className="text-sm text-ink-muted" data-testid="thread-loading">
            Loading the conversation…
          </p>
        )}

        {error && (
          <section role="alert" className="surface p-6" data-testid="thread-error">
            <h2 className="font-display text-xl font-bold text-plum-950">
              We could not open this conversation
            </h2>
            <p className="mt-2 text-sm text-ink-muted">{error}</p>
            <button
              type="button"
              className="btn-outline mt-4 min-h-[44px] px-5 py-2 text-sm"
              onClick={() => void load()}
            >
              Try again
            </button>
          </section>
        )}

        {thread !== null && (
          <ul className="space-y-1" data-testid="thread-messages">
            {thread.messages.length === 0 && (
              <li>
                <p
                  className="mx-auto max-w-sm rounded-2xl bg-white/70 p-4 text-center text-sm text-ink-muted"
                  data-testid="thread-empty"
                >
                  No messages yet. Say hello and ask for a quote.
                </p>
              </li>
            )}

            {thread.messages.map((message, index) => {
              const previous = thread.messages[index - 1];
              const day =
                !previous || messageDayLabel(previous.sent_at) !== messageDayLabel(message.sent_at)
                  ? messageDayLabel(message.sent_at)
                  : "";
              const carried =
                message.kind === "quote_offer" || message.kind === "counter_offer"
                  ? threadRevision(thread.quotes, message.quote_id, message.revision)
                  : null;
              return (
                <li
                  key={message.message_id}
                  className={`flex ${message.mine ? "justify-end" : "justify-start"}`}
                  data-testid="chat-message"
                  data-mine={message.mine ? "true" : "false"}
                  data-kind={message.kind}
                >
                  <div className="w-full">
                    {day && (
                      <p
                        className="my-4 text-center text-xs font-semibold text-ink-muted"
                        data-testid="chat-day"
                      >
                        {day}
                      </p>
                    )}
                    <div
                      className={`max-w-[85%] rounded-2xl px-3 py-2 shadow-sm sm:max-w-[70%] ${
                        message.mine
                          ? "ml-auto rounded-br-md bg-plum-950 text-cream-50"
                          : "rounded-bl-md border border-plum-900/5 bg-white text-ink"
                      }`}
                    >
                      {!message.mine && (
                        <p className="text-xs font-semibold text-owanbe-emerald-green">
                          {message.sender_name || "Them"}
                        </p>
                      )}
                      {carried && (
                        <QuoteMessageCard
                          kind={message.kind}
                          revision={carried}
                          mine={message.mine}
                        />
                      )}
                      {message.attachments.map((attachment) => (
                        <AttachmentCard
                          key={attachment.attachment_id}
                          attachment={attachment}
                          mine={message.mine}
                          onOpen={openAttachment}
                          signedUrl={signedUrl}
                        />
                      ))}
                      {message.body && (
                        <p className="whitespace-pre-wrap text-sm leading-relaxed">
                          {message.body}
                        </p>
                      )}
                      <p
                        className={`mt-1 flex items-center justify-end gap-1 text-[11px] ${
                          message.mine ? "text-cream-200/80" : "text-ink-subtle"
                        }`}
                      >
                        {formatMessageTime(message.sent_at)}
                        {message.mine && <Check className="h-3 w-3" aria-label="Sent" />}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {thread !== null && (
        <div className="border-t border-plum-900/10 bg-white px-3 py-3">
          {pending && (
            <div
              className="mb-2 flex items-center gap-3 rounded-2xl border border-plum-900/10 bg-cream-50 p-2"
              data-testid="chat-pending-attachment"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-plum-100 text-plum-800">
                <FileText className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">
                  {pending.name}
                </span>
                <span className="block text-xs text-ink-muted">{formatFileSize(pending.size)}</span>
              </span>
              <button
                type="button"
                aria-label="Remove the file"
                className="flex h-9 w-9 items-center justify-center rounded-full text-ink-muted hover:bg-plum-100"
                onClick={() => setPending(null)}
                data-testid="chat-remove-attachment"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {attachError && (
            <p
              role="alert"
              className="mb-2 text-sm font-semibold text-owanbe-vibrant-red"
              data-testid="chat-attach-error"
            >
              {attachError}
            </p>
          )}

          <div className="flex items-end gap-2">
            <div className="relative">
              <button
                type="button"
                aria-label="Share a document"
                aria-expanded={attachMenuOpen}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-plum-900/15 text-plum-800 hover:bg-plum-100"
                onClick={() => setAttachMenuOpen((open) => !open)}
                data-testid="chat-attach"
              >
                <Paperclip className="h-5 w-5" />
              </button>

              {attachMenuOpen && (
                <div
                  className="absolute bottom-14 left-0 z-10 w-48 overflow-hidden rounded-2xl border border-plum-900/10 bg-white py-1 shadow-card"
                  data-testid="chat-attach-menu"
                >
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-ink hover:bg-plum-100"
                    onClick={() => {
                      setAttachMenuOpen(false);
                      documentInputRef.current?.click();
                    }}
                    data-testid="chat-attach-document"
                  >
                    <FileText className="h-4 w-4 text-plum-800" />
                    Document
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-ink hover:bg-plum-100"
                    onClick={() => {
                      setAttachMenuOpen(false);
                      photoInputRef.current?.click();
                    }}
                    data-testid="chat-attach-photo"
                  >
                    <ImageIcon className="h-4 w-4 text-plum-800" />
                    Photo
                  </button>
                </div>
              )}
            </div>

            <label htmlFor="chat-body" className="sr-only">
              Message
            </label>
            <textarea
              id="chat-body"
              ref={bodyRef}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              onKeyDown={onComposerKeyDown}
              maxLength={MESSAGE_MAX_LENGTH}
              rows={1}
              placeholder="Message"
              aria-invalid={Boolean(sendError)}
              className="max-h-36 min-h-[44px] flex-1 resize-none rounded-2xl border border-plum-900/15 bg-cream-50 px-4 py-3 text-sm text-ink"
              data-testid="chat-body"
            />

            <button
              type="button"
              aria-label="Send message"
              className="btn-primary flex h-11 w-11 items-center justify-center rounded-full"
              disabled={sending}
              onClick={() => void send()}
              data-testid="chat-send"
            >
              <Send className="h-5 w-5" />
            </button>
          </div>

          {sendError && (
            <p
              role="alert"
              className="mt-2 text-sm font-semibold text-owanbe-vibrant-red"
              data-testid="chat-send-error"
            >
              {sendError}
            </p>
          )}

          <input
            ref={documentInputRef}
            type="file"
            accept={ATTACHMENT_ACCEPT}
            className="sr-only"
            onChange={chooseFile}
            data-testid="chat-file-document"
          />
          <input
            ref={photoInputRef}
            type="file"
            accept={ATTACHMENT_IMAGE_ACCEPT}
            className="sr-only"
            onChange={chooseFile}
            data-testid="chat-file-photo"
          />
        </div>
      )}
    </div>
  );
}

interface QuoteMessageCardProps {
  kind: MessageKind;
  revision: ThreadQuoteRevision;
  mine: boolean;
}

/** F-23: an offer or a counter the thread carries, shown as the offer it is. */
function QuoteMessageCard({ kind, revision, mine }: QuoteMessageCardProps) {
  return (
    <div
      className={`mt-1 rounded-xl border p-3 ${
        mine ? "border-cream-50/20 bg-cream-50/10" : "border-plum-900/10 bg-cream-50"
      }`}
      data-testid="chat-quote-card"
      data-kind={kind}
    >
      <p className="text-xs font-semibold uppercase tracking-wide opacity-80">
        {kind === "counter_offer" ? "Counter sent" : "Offer sent"}
      </p>
      <p className="mt-1 text-sm font-semibold">{revision.title}</p>
      <p className="text-sm">{formatMinor(revision.total_minor, revision.currency)}</p>
    </div>
  );
}

interface AttachmentCardProps {
  attachment: ChatAttachment;
  mine: boolean;
  onOpen: (attachment: ChatAttachment) => void;
  signedUrl: (attachmentId: string) => Promise<string>;
}
/** A photo shows inline; a document shows as a card that opens when it is clicked. */
function AttachmentCard({ attachment, mine, onOpen, signedUrl }: AttachmentCardProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const image = isImageAttachment(attachment.content_type);

  useEffect(() => {
    if (!image) return;
    let cancelled = false;
    void signedUrl(attachment.attachment_id)
      .then((url) => {
        if (!cancelled) setPreview(url);
      })
      .catch(() => {
        if (!cancelled) setPreviewFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attachment.attachment_id, image, signedUrl]);

  return (
    <div
      className={`mt-1 overflow-hidden rounded-xl border ${
        mine ? "border-cream-50/20 bg-cream-50/10" : "border-plum-900/10 bg-cream-50"
      }`}
      data-testid="chat-attachment"
    >
      {image && !previewFailed && preview && (
        <img
          src={preview}
          alt={attachment.file_name}
          className="max-h-64 w-full object-cover"
          data-testid="chat-attachment-image"
        />
      )}
      <button
        type="button"
        className="flex w-full items-center gap-3 p-2 text-left"
        onClick={() => onOpen(attachment)}
        data-testid="chat-attachment-open"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-plum-100 text-plum-800">
          {image ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{attachment.file_name}</span>
          <span className="block text-xs opacity-80">
            {attachmentKindLabel(attachment.content_type)} · {formatFileSize(attachment.size_bytes)}
          </span>
        </span>
      </button>
    </div>
  );
}
