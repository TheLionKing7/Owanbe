import { useState } from "react";
import { Loader2, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth/AuthProvider";

/** Lets a signed-in account open its single Vendor house. The database makes the caller its owner. */
export function OpenVendorHouse() {
  const { rpc, refreshHouses, user } = useAuth();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    if (name.trim().length < 2) {
      setError("Add your business name (at least 2 characters).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await rpc<string>("open_vendor_house", { p_display_name: name.trim() });
      await refreshHouses();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      setError(
        msg.includes("open_vendor_house") || msg.includes("schema cache")
          ? "Opening a Vendor house isn't switched on yet. The database update still needs to be run."
          : "We couldn't open your Vendor house. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="max-w-xl rounded-3xl bg-card p-8 shadow-card" data-testid="no-house">
      <Store aria-hidden className="h-8 w-8 text-primary" />
      <h1 className="mt-3 font-display text-3xl font-bold text-plum-950">Open your Vendor house</h1>
      <p className="mt-3 text-ink-muted">
        Your Vendor house is separate from your Host house{user?.display_name ? `, ${user.display_name.split(" ")[0]}` : ""}. You'll be its owner, and you can add your team later.
      </p>
      <form
        className="mt-6 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void open();
        }}
      >
        <Label htmlFor="vendor-house-name">Business name</Label>
        <Input id="vendor-house-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Adùnní Events" />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={busy} className="w-full sm:w-auto">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Open Vendor house
        </Button>
      </form>
    </section>
  );
}
