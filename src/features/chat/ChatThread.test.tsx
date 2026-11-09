import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatError, type ChatApi } from "./api";
import { ChatThread } from "./ChatThread";
import type { ChatMessage, ConversationThread } from "./contracts";

const CONVERSATION_ID = "2a5b8c1d-4e6f-4a8b-9c0d-1e2f3a4b5c6d";

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    message_id: "m-1",
    sender_side: "vendor",
    sender_name: "Ade",
    body: "Yes, 12 December works.",
    sent_at: "2026-11-09T10:00:00.000Z",
    mine: false,
    attachments: [],
    ...overrides,
  };
}

function thread(messages: ChatMessage[] = [message()]): ConversationThread {
  return {
    conversation_id: CONVERSATION_ID,
    side: "host",
    counterparty_name: "Adeola Cakes",
    counterparty_slug: "adeola-cakes",
    messages,
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
