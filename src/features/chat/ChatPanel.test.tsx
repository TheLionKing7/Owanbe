import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatError, type ChatApi } from "./api";
import { ChatPanel } from "./ChatPanel";
import type { ConversationSummary, VendorOption } from "./contracts";
import type { HouseSummary } from "@/lib/auth/types";

const HOUSE_ID = "6f1e9c4a-2b3d-4e5f-8a7b-1c2d3e4f5a6b";
const CONVERSATION_ID = "2a5b8c1d-4e6f-4a8b-9c0d-1e2f3a4b5c6d";

const HOST_HOUSE: HouseSummary = {
  house_id: HOUSE_ID,
  kind: "host",
  display_name: "Tolu and Ife's wedding",
  role: "owner",
  capabilities: [],
};

const VENDOR_HOUSE: HouseSummary = {
  house_id: "9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f",
  kind: "vendor",
  display_name: "Adeola Cakes",
  role: "owner",
  capabilities: [],
};

function conversation(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    conversation_id: CONVERSATION_ID,
    side: "host",
    counterparty_name: "Adeola Cakes",
    counterparty_slug: "adeola-cakes",
    last_message_at: "2026-11-09T10:00:00.000Z",
    last_message_preview: "Yes, 12 December works.",
    message_count: 2,
    version: 1,
    ...overrides,
  };
}

const VENDORS: VendorOption[] = [
  { slug: "adeola-cakes", business_name: "Adeola Cakes", category: "Cakes" },
];

function stubApi(overrides: Partial<ChatApi> = {}): ChatApi {
  return {
    list: vi.fn(async () => [conversation()]),
    thread: vi.fn(async () => ({
      conversation_id: CONVERSATION_ID,
      side: "host" as const,
      counterparty_name: "Adeola Cakes",
      counterparty_slug: "adeola-cakes",
      messages: [],
    })),
    send: vi.fn(async () => "m-1"),
    sendDocument: vi.fn(async () => "m-2"),
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
    vendors: vi.fn(async () => VENDORS),
    ...overrides,
  };
}

afterEach(cleanup);

describe("ChatPanel", () => {
  it("lists the conversations of the house", async () => {
    const api = stubApi();
    render(<ChatPanel house={HOST_HOUSE} api={api} />);

    expect(screen.getByTestId("chat-loading")).toBeInTheDocument();
    expect(await screen.findByTestId("open-conversation")).toHaveAttribute(
      "data-conversation-id",
      CONVERSATION_ID,
    );
    expect(screen.getByText("Adeola Cakes")).toBeInTheDocument();
  });

  it("explains an empty house", async () => {
    render(<ChatPanel house={HOST_HOUSE} api={stubApi({ list: vi.fn(async () => []) })} />);
    expect(await screen.findByTestId("chat-empty")).toHaveTextContent("No conversations yet");
  });

  it("offers a retry when the read fails", async () => {
    const list = vi
      .fn()
      .mockRejectedValueOnce(new ChatError("forbidden", "forbidden: chat in house"))
      .mockResolvedValueOnce([conversation()]);
    render(<ChatPanel house={HOST_HOUSE} api={stubApi({ list })} />);

    expect(await screen.findByTestId("chat-error")).toHaveTextContent(
      "You are not part of this conversation, so you cannot read or reply to it.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("open-conversation")).toBeInTheDocument();
  });

  it("starts a conversation with a published vendor", async () => {
    const api = stubApi();
    render(<ChatPanel house={HOST_HOUSE} api={api} />);
    await screen.findByTestId("chat-vendor");

    fireEvent.change(screen.getByTestId("chat-vendor"), { target: { value: "adeola-cakes" } });
    fireEvent.click(screen.getByTestId("chat-start"));

    await waitFor(() => expect(api.start).toHaveBeenCalledWith("adeola-cakes"));
  });

  it("will not start a conversation before a vendor is chosen", async () => {
    const api = stubApi();
    render(<ChatPanel house={HOST_HOUSE} api={api} />);
    await screen.findByTestId("chat-vendor");

    fireEvent.click(screen.getByTestId("chat-start"));

    expect(await screen.findByTestId("chat-start-error")).toHaveTextContent(
      "Choose a vendor to message.",
    );
    expect(api.start).not.toHaveBeenCalled();
  });

  it("does not offer to start a conversation in a vendor house", async () => {
    render(<ChatPanel house={VENDOR_HOUSE} api={stubApi()} />);
    await screen.findByTestId("open-conversation");
    expect(screen.queryByTestId("chat-start")).not.toBeInTheDocument();
  });

  it("tells staff without the chat capability why nothing loads", async () => {
    const api = stubApi();
    render(
      <ChatPanel house={{ ...VENDOR_HOUSE, role: "staff", capabilities: ["profile"] }} api={api} />,
    );
    expect(screen.getByTestId("chat-capability-note")).toHaveTextContent("does not include chat");
    expect(api.list).not.toHaveBeenCalled();
  });
});
