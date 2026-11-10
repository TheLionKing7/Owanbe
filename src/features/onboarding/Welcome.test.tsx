import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OnboardingApi } from "./api";
import { OnboardingError } from "./api";
import type { OnboardingState } from "./contracts";

const auth = vi.hoisted(() => ({
  value: {
    rpc: vi.fn(),
    user: {
      id: "u-1",
      auth0_sub: "auth0|1",
      email: "ada@example.com",
      display_name: "Ada Okafor",
      status: "active",
    },
    houses: [] as {
      house_id: string;
      kind: "host" | "vendor";
      display_name: string;
      role: "owner" | "staff";
      capabilities: string[];
    }[],
    refreshHouses: vi.fn(async () => {}),
  },
}));
const nav = vi.hoisted(() => ({ navigate: vi.fn(), search: "?role=host" }));

vi.mock("@/lib/auth/AuthProvider", () => ({ useAuth: () => auth.value }));
vi.mock("@/components/auth/RequireAuth", () => ({
  RequireAuth: ({ children }: { children: unknown }) => children,
}));
vi.mock("@/components/site/Logo", () => ({ Logo: () => null }));
vi.mock("@/lib/router", () => ({
  useNavigate: () => nav.navigate,
  useSearchParams: () => [new URLSearchParams(nav.search)],
  useLocation: () => ({ pathname: "/host", search: "", hash: "" }),
  Navigate: ({ to }: { to: string }) => <p data-testid="redirect">{to}</p>,
  Link: ({ to, children }: { to: string; children: unknown }) => (
    <a href={to}>{children as never}</a>
  ),
}));

import { WelcomeFlow } from "@/pages/Welcome";
import { OnboardingGate } from "./OnboardingGate";
import { forgetOnboarding } from "./gate-cache";

function stubApi(
  state: OnboardingState | null = null,
  overrides: Partial<OnboardingApi> = {},
): OnboardingApi {
  return {
    load: vi.fn(async () => state),
    save: vi.fn(async () => {}),
    complete: vi.fn(async () => {}),
    openVendorHouse: vi.fn(async () => {}),
    ...overrides,
  };
}

beforeEach(() => {
  nav.navigate.mockReset();
  nav.search = "?role=host";
  auth.value.houses = [];
  forgetOnboarding();
});
afterEach(cleanup);

describe("Welcome (F-7)", () => {
  it("takes a new host from contact details to intent, then into the Host house", async () => {
    const api = stubApi(null);
    render(<WelcomeFlow api={api} />);
    expect(await screen.findByText("About you")).toBeInTheDocument();
    expect(screen.getByText("Step 2 of 3")).toBeInTheDocument(); // the role was chosen on the sign-up page
    expect(screen.getByLabelText("Your full name")).toHaveValue("Ada Okafor");

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText(/full phone number/)).toBeInTheDocument();
    expect(api.save).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "0801 234 5678" } });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Lagos" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith({
        role: "host",
        displayName: "Ada Okafor",
        phone: "+2348012345678",
        city: "Lagos",
      }),
    );

    expect(await screen.findByText("What are you planning?")).toBeInTheDocument();
    expect(screen.getByText("Step 3 of 3")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/arranging it for a client/));
    fireEvent.change(screen.getByLabelText(/What kind of celebration/), {
      target: { value: "Wedding" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Finish and open my Host house/ }));
    await waitFor(() => expect(api.complete).toHaveBeenCalled());
    expect(api.save).toHaveBeenLastCalledWith({
      role: "host",
      hostIntent: "arranging",
      eventType: "Wedding",
      eventDate: null,
    });
    expect(nav.navigate).toHaveBeenCalledWith("/host?welcome=1", { replace: true });
  });

  it("opens the Vendor house once and lands on the profile", async () => {
    nav.search = "?role=vendor";
    const api = stubApi({
      role: "vendor",
      display_name: "Bayo",
      phone_e164: "+447700900123",
      phone_verified: false,
      city: "London",
      host_intent: null,
      event_type: null,
      event_date: null,
      business_category: null,
      has_vendor_house: false,
      completed_at: null,
    });
    render(<WelcomeFlow api={api} />);
    expect(await screen.findByText("Your business")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Business name"), { target: { value: "Bayo Events" } });
    fireEvent.click(screen.getByRole("button", { name: "Catering" }));
    fireEvent.click(screen.getByRole("button", { name: /Finish and open my Vendor house/ }));
    await waitFor(() => expect(api.complete).toHaveBeenCalled());
    expect(api.openVendorHouse).toHaveBeenCalledWith("Bayo Events");
    expect(api.save).toHaveBeenCalledWith({ role: "vendor", businessCategory: "Catering" });
    expect(auth.value.refreshHouses).toHaveBeenCalled();
    expect(nav.navigate).toHaveBeenCalledWith("/vendor/profile?welcome=1", { replace: true });
  });

  it("keeps what was typed and says what to do when saving fails", async () => {
    const api = stubApi(null, {
      save: vi.fn(async () => {
        throw new OnboardingError("network", "Failed to fetch");
      }),
    });
    render(<WelcomeFlow api={api} />);
    await screen.findByText("About you");
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "08012345678" } });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Ibadan" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText(/couldn't reach Ówàńbè/)).toBeInTheDocument();
    expect(screen.getByLabelText("City")).toHaveValue("Ibadan");
  });

  it("never traps anyone before the database update is run", async () => {
    const api = stubApi(null, {
      load: vi.fn(async () => {
        throw new OnboardingError("unavailable", "schema cache");
      }),
    });
    render(<WelcomeFlow api={api} />);
    fireEvent.click(await screen.findByRole("button", { name: "Continue to my house" }));
    expect(nav.navigate).toHaveBeenCalledWith("/host");
  });
});

describe("OnboardingGate (F-7)", () => {
  it("sends an unfinished account to /welcome and remembers where it was going", async () => {
    render(
      <OnboardingGate houseId="host" api={stubApi(null)}>
        <p>house</p>
      </OnboardingGate>,
    );
    expect(await screen.findByTestId("redirect")).toHaveTextContent(
      "/welcome?role=host&next=%2Fhost",
    );
    expect(screen.queryByText("house")).not.toBeInTheDocument();
  });

  it("opens the house when onboarding is done, or when the check can't run", async () => {
    const done = stubApi({
      role: "host",
      display_name: "Ada",
      phone_e164: "+2348012345678",
      phone_verified: false,
      city: "Lagos",
      host_intent: "hosting",
      event_type: null,
      event_date: null,
      business_category: null,
      has_vendor_house: false,
      completed_at: "2026-11-07T08:00:00Z",
    });
    render(
      <OnboardingGate houseId="host" api={done}>
        <p>house</p>
      </OnboardingGate>,
    );
    expect(await screen.findByText("house")).toBeInTheDocument();
    cleanup();
    forgetOnboarding();
    const broken = stubApi(null, {
      load: vi.fn(async () => {
        throw new OnboardingError("unavailable", "schema cache");
      }),
    });
    render(
      <OnboardingGate houseId="host" api={broken}>
        <p>house</p>
      </OnboardingGate>,
    );
    expect(await screen.findByText("house")).toBeInTheDocument();
  });

  it("lets invited staff into someone else's Vendor house without setting up a business", () => {
    auth.value.houses = [
      {
        house_id: "v-1",
        kind: "vendor",
        display_name: "Alice Events",
        role: "staff",
        capabilities: ["quotes"],
      },
    ];
    const api = stubApi(null);
    render(
      <OnboardingGate houseId="vendor" api={api}>
        <p>house</p>
      </OnboardingGate>,
    );
    expect(screen.getByText("house")).toBeInTheDocument();
    expect(api.load).not.toHaveBeenCalled();
  });
});
