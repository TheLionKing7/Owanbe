import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuoteError, type QuoteApi } from "@/features/quotes/api";
import { ChatError, type ChatApi } from "./api";
import { ChatThread } from "./ChatThread";
import type { ChatMessage, ConversationThread, ThreadQuote } from "./contracts";

const CONVERSATION_ID = "2a5b8c1d-4e6f-4a8b-9c0d-1e2f3a4b5c6d";
const QUOTE_ID = "8c7b6a5d-4e3f-4a2b-9c0d-1e2f3a4b5c6d";

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    message_id: "m-1",
    kind: "text",
    sender_side: "vendor",
    sender_name: "Ade",
    body: "Yes, 12 December works.",
    quote_id: null,
    revision: null,
    sent_at: "2026-11-09T10:00:00.000Z",
    mine: false,
    attachments: [],
    ...overrides,
  };
}

/** F-23: the offer the thread is about, with the revision it carries. */
function threadQuote(overrides: Partial<ThreadQuote> = {}): ThreadQuote {
  return {
    quote_id: QUOTE_ID,
    service_date: "2026-12-12",
    status: "sent",
    currency: "NGN",
    total_minor: 120000,
    current_revision: 1,
    sent_at: "2026-11-09T10:00:00.000Z",
    expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    counter_response_due_at: null,
    decided_at: null,
    version: 2,
    is_vendor_side: false,
    title: "Hall and decor",
    revisions: [
      {
        number: 1,
        authored_by_role: "vendor",
        title: "Hall and decor",
        inclusions: [{ label: "Hall", line_total_minor: 120000 }],
        extras: [],
        currency: "NGN",
        subtotal_minor: 120000,
        total_minor: 120000,
        message: null,
        created_at: "2026-11-09T09:00:00.000Z",
        conversation_id: CONVERSATION_ID,
      },
    ],
    ...overrides,
  };
}

function thread(
  messages: ChatMessage[] = [message()],
  quotes: ThreadQuote[] = [],
): ConversationThread {
  return {
    conversation_id: CONVERSATION_ID,
    side: "host",
    counterparty_name: "Adeola Cakes",
    counterparty_slug: "adeola-cakes",
    messages,
    quotes,
  };
}

function stubApi(overrides: Partial<ChatApi> = {}): ChatApi {
  return {
    list: vi.fn(async () => []),
    thread: vi.fn(async () => thread()),
    send: vi.fn(async () => "m-2"),
    sendDocument: vi.fn(async () => "m-3"),
    upload: vi.fn(async () => ({
      path: "conversations/2a5b8c1d-4e6f-4a8b-9c0d-1e2f3a4b5c6d/file.pdf",
      file_name: "file.pdf",
      content_type: "application/pdf",
      size_bytes: 1024,
    })),
    link: vi.fn(async () => ({
      url: "https://project.supabase.co/storage/v1/object/sign/chat-attachments/file.pdf?token=x",
      file_name: "file.pdf",
      content_type: "application/pdf",
    })),
    start: vi.fn(async () => CONVERSATION_ID),
    vendors: vi.fn(async () => []),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ChatThread", () => {
  it("shows the conversation and its messages", async () => {
    render(<ChatThread conversationId={CONVERSATION_ID} api={stubApi()} />);

    expect(screen.getByTestId("thread-loading")).toBeInTheDocument();
    expect(await screen.findByTestId("chat-title")).toHaveTextContent("Adeola Cakes");
    const messages = await screen.findByTestId("thread-messages");
    expect(messages).toHaveTextContent("Yes, 12 December works.");
  });

  it("marks the caller's own messages", async () => {
    render(
      <ChatThread
        conversationId={CONVERSATION_ID}
        api={stubApi({
          thread: vi.fn(async () =>
            thread([message(), message({ message_id: "m-2", mine: true })]),
          ),
        })}
      />,
    );
    const messages = await screen.findByTestId("thread-messages");
    expect(messages.querySelectorAll('[data-mine="true"]')).toHaveLength(1);
  });

  it("explains a conversation with no messages yet", async () => {
    render(
      <ChatThread
        conversationId={CONVERSATION_ID}
        api={stubApi({ thread: vi.fn(async () => thread([])) })}
      />,
    );
    expect(await screen.findByTestId("thread-empty")).toHaveTextContent("No messages yet");
  });

  it("refuses a conversation the caller is not part of", async () => {
    render(
      <ChatThread
        conversationId={CONVERSATION_ID}
        api={stubApi({
          thread: vi.fn(async () => {
            throw new ChatError("forbidden", "forbidden: conversation");
          }),
        })}
      />,
    );
    expect(await screen.findByTestId("thread-error")).toHaveTextContent(
      "You are not part of this conversation",
    );
  });

  it("sends a message and clears the box", async () => {
    const api = stubApi();
    render(<ChatThread conversationId={CONVERSATION_ID} api={api} />);
    await screen.findByTestId("chat-title");

    fireEvent.change(screen.getByTestId("chat-body"), {
      target: { value: "Can you do 12 December?" },
    });
    fireEvent.click(screen.getByTestId("chat-send"));

    await waitFor(() =>
      expect(api.send).toHaveBeenCalledWith(CONVERSATION_ID, "Can you do 12 December?"),
    );
    await waitFor(() => expect(screen.getByTestId("chat-body")).toHaveValue(""));
  });

  it("will not send an empty message", async () => {
    const api = stubApi();
    render(<ChatThread conversationId={CONVERSATION_ID} api={api} />);
    await screen.findByTestId("chat-title");

    fireEvent.click(screen.getByTestId("chat-send"));

    expect(await screen.findByTestId("chat-send-error")).toHaveTextContent(
      "Write a message before sending it.",
    );
    expect(api.send).not.toHaveBeenCalled();
  });

  it("keeps the typed message when sending fails", async () => {
    const api = stubApi({
      send: vi.fn(async () => {
        throw new ChatError("unknown", "boom");
      }),
    });
    render(<ChatThread conversationId={CONVERSATION_ID} api={api} />);
    await screen.findByTestId("chat-title");

    fireEvent.change(screen.getByTestId("chat-body"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByTestId("chat-send"));

    expect(await screen.findByTestId("chat-send-error")).toHaveTextContent(
      "Something went wrong. Try again in a moment.",
    );
    expect(screen.getByTestId("chat-body")).toHaveValue("Hello");
  });
});

describe("ChatThread documents", () => {
  const pdf = new File([new Uint8Array([1, 2, 3])], "quote.pdf", { type: "application/pdf" });

  it("offers the document and photo tools", async () => {
    render(<ChatThread conversationId={CONVERSATION_ID} api={stubApi()} />);
    await screen.findByTestId("chat-title");

    fireEvent.click(screen.getByTestId("chat-attach"));

    expect(screen.getByTestId("chat-attach-menu")).toBeInTheDocument();
    expect(screen.getByTestId("chat-attach-document")).toHaveTextContent("Document");
    expect(screen.getByTestId("chat-attach-photo")).toHaveTextContent("Photo");
  });

  it("keeps the chosen file until it is removed", async () => {
    render(<ChatThread conversationId={CONVERSATION_ID} api={stubApi()} />);
    await screen.findByTestId("chat-title");

    fireEvent.change(screen.getByTestId("chat-file-document"), { target: { files: [pdf] } });

    expect(await screen.findByTestId("chat-pending-attachment")).toHaveTextContent("quote.pdf");
    fireEvent.click(screen.getByTestId("chat-remove-attachment"));
    expect(screen.queryByTestId("chat-pending-attachment")).not.toBeInTheDocument();
  });

  it("refuses a file that is too large", async () => {
    render(<ChatThread conversationId={CONVERSATION_ID} api={stubApi()} />);
    await screen.findByTestId("chat-title");

    const large = new File([new Uint8Array(1)], "big.pdf", { type: "application/pdf" });
    Object.defineProperty(large, "size", { value: 11 * 1024 * 1024 });
    fireEvent.change(screen.getByTestId("chat-file-document"), { target: { files: [large] } });

    expect(await screen.findByTestId("chat-attach-error")).toHaveTextContent("10 MB or less");
    expect(screen.queryByTestId("chat-pending-attachment")).not.toBeInTheDocument();
  });

  it("sends the document with its caption", async () => {
    const api = stubApi();
    render(<ChatThread conversationId={CONVERSATION_ID} api={api} />);
    await screen.findByTestId("chat-title");

    fireEvent.change(screen.getByTestId("chat-file-document"), { target: { files: [pdf] } });
    await screen.findByTestId("chat-pending-attachment");
    fireEvent.change(screen.getByTestId("chat-body"), {
      target: { value: "Here is the quote." },
    });
    fireEvent.click(screen.getByTestId("chat-send"));

    await waitFor(() =>
      expect(api.sendDocument).toHaveBeenCalledWith(CONVERSATION_ID, "Here is the quote.", pdf),
    );
    expect(api.send).not.toHaveBeenCalled();
  });

  it("shows a document that was shared in the conversation", async () => {
    render(
      <ChatThread
        conversationId={CONVERSATION_ID}
        api={stubApi({
          thread: vi.fn(async () =>
            thread([
              message({
                message_id: "m-9",
                mine: true,
                body: "",
                attachments: [
                  {
                    attachment_id: "a-1",
                    message_id: "m-9",
                    file_name: "quote.pdf",
                    content_type: "application/pdf",
                    size_bytes: 2048,
                  },
                ],
              }),
            ]),
          ),
        })}
      />,
    );

    const attachment = await screen.findByTestId("chat-attachment");
    expect(attachment).toHaveTextContent("quote.pdf");
    expect(attachment).toHaveTextContent("PDF document");
    expect(attachment).toHaveTextContent("2 KB");
  });

  it("shows a photo inline", async () => {
    render(
      <ChatThread
        conversationId={CONVERSATION_ID}
        api={stubApi({
          thread: vi.fn(async () =>
            thread([
              message({
                message_id: "m-10",
                body: "",
                attachments: [
                  {
                    attachment_id: "a-2",
                    message_id: "m-10",
                    file_name: "cake.jpg",
                    content_type: "image/jpeg",
                    size_bytes: 4096,
                  },
                ],
              }),
            ]),
          ),
        })}
      />,
    );

    const image = await screen.findByTestId("chat-attachment-image");
    expect(image).toHaveAttribute("src", expect.stringContaining("chat-attachments"));
  });
  it("opens a document when it is clicked", async () => {
    const api = stubApi({
      thread: vi.fn(async () =>
        thread([
          message({
            message_id: "m-11",
            body: "",
            attachments: [
              {
                attachment_id: "a-3",
                message_id: "m-11",
                file_name: "quote.pdf",
                content_type: "application/pdf",
                size_bytes: 2048,
              },
            ],
          }),
        ]),
      ),
    });
    render(<ChatThread conversationId={CONVERSATION_ID} api={api} />);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Blob(["pdf"]), { status: 200 })),
    );
    vi.stubGlobal("open", vi.fn());
    fireEvent.click(await screen.findByTestId("chat-attachment-open"));

    await waitFor(() => expect(api.link).toHaveBeenCalledWith(CONVERSATION_ID, "a-3"));
  });
});

describe("ChatThread counter-offer (F-23)", () => {
  function stubQuoteApi(overrides: Partial<QuoteApi> = {}): QuoteApi {
    return {
      list: vi.fn(async () => []),
      history: vi.fn(async () => []),
      create: vi.fn(async () => QUOTE_ID),
      revise: vi.fn(async () => 2),
      send: vi.fn(async () => "2026-11-10T00:00:00.000Z"),
      counter: vi.fn(async () => {}),
      accept: vi.fn(async () => {}),
      decline: vi.fn(async () => {}),
      cancel: vi.fn(async () => {}),
      setDailyCapacity: vi.fn(async () => {}),
      ...overrides,
    };
  }

  it("shows the offer the thread is about", async () => {
    render(
      <ChatThread
        conversationId={CONVERSATION_ID}
        api={stubApi({
          thread: vi.fn(async () => thread([message()], [threadQuote()])),
        })}
        quoteApi={stubQuoteApi()}
      />,
    );

    const card = await screen.findByTestId("thread-quote");
    expect(card).toHaveTextContent("Hall and decor");
    expect(screen.getByTestId("thread-quote-total").textContent).toMatch(/1[.,]200/);
    expect(screen.getByTestId("thread-quote-countdown")).toHaveAttribute("data-deadline", "offer");
  });

  it("lets the host counter the offer in the thread", async () => {
    const quotes = stubQuoteApi();
    const api = stubApi({
      thread: vi.fn(async () => thread([message()], [threadQuote()])),
    });
    render(<ChatThread conversationId={CONVERSATION_ID} api={api} quoteApi={quotes} />);
    await screen.findByTestId("thread-quote");

    fireEvent.click(screen.getByTestId("thread-quote-counter"));
    fireEvent.change(screen.getByTestId("thread-quote-counter-body"), {
      target: { value: "Can you include the lighting?" },
    });
    fireEvent.click(screen.getByTestId("thread-quote-counter-submit"));

    await waitFor(() =>
      expect(quotes.counter).toHaveBeenCalledWith(
        QUOTE_ID,
        2,
        "Can you include the lighting?",
        CONVERSATION_ID,
      ),
    );
  });

  it("will not send a counter with nothing written", async () => {
    const quotes = stubQuoteApi();
    render(
      <ChatThread
        conversationId={CONVERSATION_ID}
        api={stubApi({
          thread: vi.fn(async () => thread([message()], [threadQuote()])),
        })}
        quoteApi={quotes}
      />,
    );
    await screen.findByTestId("thread-quote");

    fireEvent.click(screen.getByTestId("thread-quote-counter"));
    expect(screen.getByTestId("thread-quote-counter-submit")).toBeDisabled();

    fireEvent.click(screen.getByTestId("thread-quote-counter-submit"));
    expect(quotes.counter).not.toHaveBeenCalled();
  });

  it("explains a counter the database refused", async () => {
    const quotes = stubQuoteApi({
      counter: vi.fn(async () => {
        throw new QuoteError("invalid_transition", "invalid_transition");
      }),
    });
    render(
      <ChatThread
        conversationId={CONVERSATION_ID}
        api={stubApi({
          thread: vi.fn(async () => thread([message()], [threadQuote()])),
        })}
        quoteApi={quotes}
      />,
    );
    await screen.findByTestId("thread-quote");

    fireEvent.click(screen.getByTestId("thread-quote-counter"));
    fireEvent.change(screen.getByTestId("thread-quote-counter-body"), {
      target: { value: "Can you include the lighting?" },
    });
    fireEvent.click(screen.getByTestId("thread-quote-counter-submit"));

    expect(await screen.findByTestId("thread-quote-error")).toHaveTextContent(
      "That quote is no longer open to this action.",
    );
  });

  it("shows the vendor that the host can counter, and offers no counter to the vendor", async () => {
    const quotes = stubQuoteApi();
    render(
      <ChatThread
        conversationId={CONVERSATION_ID}
        api={stubApi({
          thread: vi.fn(async () => ({
            ...thread([message()], [threadQuote({ is_vendor_side: true })]),
            side: "vendor" as const,
          })),
        })}
        quoteApi={quotes}
      />,
    );

    expect(await screen.findByTestId("thread-quote-vendor-note")).toHaveTextContent(
      "The host can counter this offer here",
    );
    expect(screen.queryByTestId("thread-quote-counter")).not.toBeInTheDocument();
  });

  it("shows the vendor's window as the deadline that ends a counter", async () => {
    render(
      <ChatThread
        conversationId={CONVERSATION_ID}
        api={stubApi({
          thread: vi.fn(async () =>
            thread(
              [message()],
              [
                threadQuote({
                  status: "countered",
                  counter_response_due_at: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
                }),
              ],
            ),
          ),
        })}
        quoteApi={stubQuoteApi()}
      />,
    );

    const countdown = await screen.findByTestId("thread-quote-countdown");
    expect(countdown).toHaveAttribute("data-deadline", "counter");
    expect(countdown).toHaveTextContent("The vendor has");
  });

  it("shows the offer and the counter as the events they are", async () => {
    const quotes = [
      threadQuote({
        revisions: [
          ...threadQuote().revisions,
          {
            number: 2,
            authored_by_role: "host",
            title: "Hall and decor",
            inclusions: [{ label: "Hall", line_total_minor: 120000 }],
            extras: [],
            currency: "NGN",
            subtotal_minor: 120000,
            total_minor: 120000,
            message: "Can you include the lighting?",
            created_at: "2026-11-09T11:00:00.000Z",
            conversation_id: CONVERSATION_ID,
          },
        ],
      }),
    ];
    render(
      <ChatThread
        conversationId={CONVERSATION_ID}
        api={stubApi({
          thread: vi.fn(async () =>
            thread(
              [
                message({
                  message_id: "m-20",
                  kind: "quote_offer",
                  body: "",
                  quote_id: QUOTE_ID,
                  revision: 1,
                }),
                message({
                  message_id: "m-21",
                  kind: "counter_offer",
                  body: "Can you include the lighting?",
                  mine: true,
                  sender_side: "host",
                  quote_id: QUOTE_ID,
                  revision: 2,
                }),
              ],
              quotes,
            ),
          ),
        })}
        quoteApi={stubQuoteApi()}
      />,
    );

    const cards = await screen.findAllByTestId("chat-quote-card");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent("Offer sent");
    expect(cards[0]).toHaveTextContent("Hall and decor");
    expect(cards[1]).toHaveTextContent("Counter sent");
  });
});
