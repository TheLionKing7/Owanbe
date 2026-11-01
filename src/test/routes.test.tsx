import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp } from "./fakeAuth";

const renderAt = (path: string) => renderApp(path).router;

describe("route /", () => {
  it("renders the homepage hero, features, categories and vendors", () => {
    renderAt("/");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Plan. Source. Celebrate.");
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Explore Categories" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Featured Vendors" })).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.getByRole("heading", { name: /Experience the Ówàńbè Difference/ })).toBeInTheDocument();
  });

  it("sends the hero search to the AI planner in the Host house", async () => {
    const router = renderAt("/");
    await userEvent.type(screen.getByLabelText(/What kind of celebration/), "Naming ceremony for Tobi");
    await userEvent.click(screen.getByRole("button", { name: /Plan with AI/ }));
    expect(router.state.location.pathname).toBe("/host/plan");
    expect(router.state.location.search).toBe("?q=Naming%20ceremony%20for%20Tobi");
    expect(await screen.findByRole("heading", { name: "AI Planner" })).toBeInTheDocument();
  });

  it("opens a nav dropdown", async () => {
    renderAt("/");
    const nav = screen.getByRole("navigation", { name: "Main" });
    await userEvent.click(within(nav).getByRole("button", { name: /Vendors/ }));
    expect(within(nav).getByRole("menuitem", { name: "Become a Vendor" })).toHaveAttribute("href", "/vendor");
  });
});

describe("separate Host and Vendor houses", () => {
  it("lazy-loads the Host house with only host navigation", async () => {
    renderAt("/host");
    expect(await screen.findByTestId("house-name")).toHaveTextContent("Host House");
    const nav = screen.getByRole("navigation", { name: "Host House navigation" });
    expect(within(nav).getByRole("link", { name: "Guests" })).toHaveAttribute("href", "/host/guests");
    expect(within(nav).queryByRole("link", { name: "Payouts" })).toBeNull();
  });

  it("lazy-loads the Vendor house with only vendor navigation", async () => {
    renderAt("/vendor/payouts");
    expect(await screen.findByTestId("house-name")).toHaveTextContent("Vendor House");
    expect(await screen.findByRole("heading", { name: "Payouts", level: 1 })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Vendor House navigation" });
    expect(within(nav).queryByRole("link", { name: "Guests" })).toBeNull();
  });

  it("shows not found for an unknown house section", async () => {
    renderAt("/vendor/does-not-exist");
    expect(await screen.findByText(/couldn't find that page/)).toBeInTheDocument();
  });
});
