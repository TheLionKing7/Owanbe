import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@/lib/router";
import type { HouseSummary } from "@/lib/auth/types";
import { chatErrorMessage, createChatApi, type ChatApi } from "./api";
import {
  chatPath,
  formatMessageTime,
  type ConversationSummary,
  type VendorOption,
} from "./contracts";

interface ChatPanelProps {
  house: HouseSummary;
  /** Injected in tests; defaults to the authorized projections and the app's own chat routes. */
  api?: ChatApi | undefined;
  /** The caller's token decides whether they take part in a conversation. */
  getAccessToken?: (() => Promise<string | null>) | undefined;
}

const NO_TOKEN = async (): Promise<string | null> => null;

export function ChatPanel({ house, api, getAccessToken }: ChatPanelProps) {
  const readToken = getAccessToken ?? NO_TOKEN;
  const client = useMemo(() => api ?? createChatApi(readToken), [api, readToken]);
  const navigate = useNavigate();
  const isHost = house.kind === "host";
  // Staff speak for a house only when the owner granted the capability (F-78 role matrix).
  const canChat = house.role === "owner" || house.capabilities.includes("chat");

  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [vendors, setVendors] = useState<VendorOption[] | null>(null);
  const [vendorError, setVendorError] = useState<string | null>(null);
  const [chosen, setChosen] = useState("");
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    setListError(null);
    try {
      setConversations(await client.list());
    } catch (caught) {
      setConversations(null);
      setListError(chatErrorMessage(caught));
    }
  }, [client]);

  useEffect(() => {
    if (!canChat) return;
    void load();
  }, [load, canChat]);

  useEffect(() => {
    if (!isHost) return;
    setVendorError(null);
    void (async () => {
      try {
        setVendors(await client.vendors());
      } catch (caught) {
        setVendors(null);
        setVendorError(chatErrorMessage(caught));
      }
    })();
  }, [client, isHost]);

  async function startConversation() {
    if (!chosen) {
      setStartError("Choose a vendor to message.");
      return;
    }
    setStartError(null);
    setStarting(true);
    try {
      const conversationId = await client.start(chosen);
      navigate(chatPath(conversationId));
    } catch (caught) {
      setStartError(chatErrorMessage(caught));
    } finally {
      setStarting(false);
    }
  }

  if (!canChat) {
    return (
      <div className="space-y-6" data-testid="chat-panel">
        <p className="surface p-6 text-sm text-ink-muted" data-testid="chat-capability-note">
          Your role in this house does not include chat. Ask the owner for the chat capability.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="chat-panel">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-outline min-h-[44px] px-5 py-3 text-sm"
          onClick={() => void load()}
          data-testid="chat-refresh"
        >
          Refresh
        </button>
      </div>

      {conversations === null && !listError && (
        <p role="status" className="surface p-6 text-sm text-ink-muted" data-testid="chat-loading">
          Loading your conversations…
        </p>
      )}

      {listError && (
        <section role="alert" className="surface p-6" data-testid="chat-error">
          <h2 className="font-display text-xl font-bold text-plum-950">
            We could not load your conversations
          </h2>
          <p className="mt-2 text-sm text-ink-muted">{listError}</p>
          <button
            type="button"
            className="btn-outline mt-4 min-h-[44px] px-5 py-2 text-sm"
            onClick={() => void load()}
          >
            Try again
          </button>
        </section>
      )}

      {conversations !== null && conversations.length === 0 && (
        <section className="surface p-6" data-testid="chat-empty">
          <h2 className="font-display text-xl font-bold text-plum-950">No conversations yet</h2>
          <p className="mt-2 text-sm text-ink-muted">
            {isHost
              ? "Start a conversation with a vendor to talk through dates, scope and price before anyone sends a formal quote."
              : "When a host starts a conversation with your business, it appears here and you can reply."}
          </p>
        </section>
      )}

      {conversations !== null && conversations.length > 0 && (
        <section aria-labelledby="conversation-list" className="space-y-4">
          <h2 id="conversation-list" className="font-display text-2xl font-bold text-plum-950">
            {isHost ? "Your conversations with vendors" : "Requests from hosts"}
          </h2>
          <ul className="overflow-hidden rounded-3xl border border-plum-900/10 bg-white shadow-card">
            {conversations.map((conversation) => (
              <li
                key={conversation.conversation_id}
                className="border-b border-plum-900/5 last:border-b-0"
              >
                <Link
                  to={chatPath(conversation.conversation_id)}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-cream-50"
                  data-testid="open-conversation"
                  data-conversation-id={conversation.conversation_id}
                >
                  <span
                    aria-hidden="true"
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-plum-950 font-display text-lg font-bold text-cream-50"
                  >
                    {conversation.counterparty_name.trim().charAt(0).toUpperCase() || "?"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate font-display text-base font-bold text-plum-950">
                        {conversation.counterparty_name}
                      </span>
                      <span className="shrink-0 text-xs text-ink-subtle">
                        {conversation.last_message_at
                          ? formatMessageTime(conversation.last_message_at)
                          : ""}
                      </span>
                    </span>
                    <span className="mt-1 flex items-center justify-between gap-3">
                      <span
                        className="truncate text-sm text-ink-muted"
                        data-testid="conversation-preview"
                      >
                        {conversation.last_message_preview || "Sent a document"}
                      </span>
                      <span className="shrink-0 text-xs text-ink-subtle">
                        {conversation.message_count}{" "}
                        {conversation.message_count === 1 ? "message" : "messages"}
                      </span>
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {isHost && (
        <section aria-labelledby="start-conversation" className="surface p-5 sm:p-6">
          <h2 id="start-conversation" className="font-display text-xl font-bold text-plum-950">
            Start a conversation
          </h2>
          <p className="mt-2 text-sm text-ink-muted">
            Message a vendor whose profile is published. Only the two of you can read this
            conversation.
          </p>

          {vendors === null && !vendorError && (
            <p role="status" className="mt-3 text-sm text-ink-muted" data-testid="vendors-loading">
              Loading vendors…
            </p>
          )}

          {vendorError && (
            <div role="alert" className="mt-3" data-testid="vendors-error">
              <p className="text-sm text-ink-muted">{vendorError}</p>
            </div>
          )}

          {vendors !== null && vendors.length === 0 && (
            <p className="mt-3 text-sm text-ink-muted" data-testid="vendors-empty">
              No vendor has published a profile yet, so there is nobody to message.
            </p>
          )}

          {vendors !== null && vendors.length > 0 && (
            <div className="mt-3">
              <label htmlFor="chat-vendor" className="block text-sm font-semibold text-ink">
                Vendor
              </label>
              <select
                id="chat-vendor"
                value={chosen}
                onChange={(event) => setChosen(event.target.value)}
                className="mt-2 min-h-[44px] w-full rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
                data-testid="chat-vendor"
              >
                <option value="">Choose a vendor</option>
                {vendors.map((vendor) => (
                  <option key={vendor.slug} value={vendor.slug}>
                    {vendor.business_name}
                    {vendor.category ? ` · ${vendor.category}` : ""}
                  </option>
                ))}
              </select>
              {startError && (
                <p
                  role="alert"
                  className="mt-2 text-sm font-semibold text-owanbe-vibrant-red"
                  data-testid="chat-start-error"
                >
                  {startError}
                </p>
              )}
              <button
                type="button"
                className="btn-primary mt-3 min-h-[44px] px-5 py-2 text-sm"
                disabled={starting}
                onClick={() => void startConversation()}
                data-testid="chat-start"
              >
                {starting ? "Opening…" : "Request a quote"}
              </button>
            </div>
          )}

          {startError && !vendors && (
            <p role="alert" className="mt-2 text-sm font-semibold text-owanbe-vibrant-red">
              {startError}
            </p>
          )}
        </section>
      )}

      {house.role === "staff" && !house.capabilities.includes("chat") && (
        <p className="text-sm text-ink-muted" data-testid="chat-capability-note">
          Your role in this house does not include chat. Ask the owner for the chat capability.
        </p>
      )}
    </div>
  );
}
