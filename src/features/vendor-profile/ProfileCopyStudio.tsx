import { useEffect, useMemo, useState } from "react";
import { Check, Copy, ExternalLink, EyeOff, Globe, Loader2, PenLine, Plus, RefreshCw, Save, Sparkles, Trash2, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { publishProblem, saveErrorMessage, toSavePayload, type VendorProfileRow } from "./profile-data";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth/AuthProvider";
import { draftProfileCopy } from "./copy.functions";
import { profileBriefSchema, type ProfileCopy } from "./contracts";
import { findCategory, TONES, VENDOR_CATEGORIES, type Tone } from "./presets";

export function ProfileCopyStudio({ defaultName = "", houseId }: { defaultName?: string; houseId?: string }) {
  const { getAccessToken, rpc, selectOne } = useAuth();
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(houseId ? "loading" : "ready");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saved, setSaved] = useState<{ slug: string; published: boolean; updatedAt: string } | null>(null);
  const [saving, setSaving] = useState<null | "draft" | "publish" | "unpublish">(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [businessName, setBusinessName] = useState(defaultName);
  const [category, setCategory] = useState("");
  const [offerings, setOfferings] = useState<string[]>([]);
  const [customOfferings, setCustomOfferings] = useState<string[]>([]);
  const [customDraft, setCustomDraft] = useState("");
  const [details, setDetails] = useState<Record<string, string>>({});
  const [story, setStory] = useState("");
  const [tone, setTone] = useState<Tone>("warm");
  const [locations, setLocations] = useState("");
  const [priceNote, setPriceNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ message: string; retryable: boolean } | null>(null);
  const [copy, setCopy] = useState<ProfileCopy | null>(null);

  useEffect(() => {
    if (!houseId) return;
    let cancelled = false;
    setLoadState("loading");
    selectOne<VendorProfileRow>("vendor_profiles", "house_id", houseId)
      .then((row) => {
        if (cancelled) return;
        if (row) {
          setBusinessName(row.business_name);
          setCategory(row.category);
          setLocations(row.locations);
          setPriceNote(row.price_note);
          const b = row.brief ?? {};
          setOfferings(b.offerings ?? []);
          setCustomOfferings(b.customOfferings ?? []);
          setDetails(b.details ?? {});
          setStory(b.story ?? "");
          if (b.tone && TONES.some((t) => t.value === b.tone)) setTone(b.tone as Tone);
          if (row.headline || row.about) {
            setCopy({ headline: row.headline, tagline: row.tagline, about: row.about, services: row.services ?? [], highlights: row.highlights ?? [] });
          }
          setSaved({ slug: row.slug, published: row.published, updatedAt: row.updated_at });
        }
        setDirty(false);
        setLoadState("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Table not created yet: let the vendor keep drafting; saving explains what's missing.
        const msg = err instanceof Error ? err.message : "";
        setLoadState(msg.includes("vendor_profiles") || msg.includes("schema cache") ? "ready" : "error");
      });
    return () => {
      cancelled = true;
    };
  }, [houseId, selectOne, loadAttempt]);

  // Any edit after loading/saving marks the profile as having unsaved changes.
  useEffect(() => {
    if (loadState === "ready") setDirty(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessName, category, offerings, customOfferings, details, story, tone, locations, priceNote, copy]);

  async function save(mode: "draft" | "publish" | "unpublish") {
    if (!houseId || !copy) return;
    const input = {
      businessName,
      category,
      locations,
      priceNote,
      brief: { offerings, customOfferings, details, story, tone },
      copy,
    };
    if (mode === "publish") {
      const problem = publishProblem(input);
      if (problem) {
        setSaveError(problem);
        return;
      }
    }
    setSaving(mode);
    setSaveError(null);
    try {
      const publish = mode === "publish" || (mode === "draft" && !!saved?.published);
      const row = await rpc<VendorProfileRow>("save_vendor_profile", { p_house: houseId, p_profile: toSavePayload(input), p_publish: mode === "unpublish" ? false : publish });
      setSaved({ slug: row.slug, published: row.published, updatedAt: row.updated_at });
      setDirty(false);
      toast.success(mode === "publish" ? "Your profile is live" : mode === "unpublish" ? "Your profile is hidden from hosts" : "Profile saved");
    } catch (err) {
      setSaveError(saveErrorMessage(err));
    } finally {
      setSaving(null);
    }
  }

  function startBlank() {
    setCopy({ headline: "", tagline: "", about: "", services: offerings.map((o) => ({ name: o, description: "" })), highlights: [] });
  }

  const preset = useMemo(() => findCategory(category), [category]);
  const allOptions = [...(preset?.offerings ?? []), ...customOfferings];

  function pickCategory(slug: string) {
    setCategory(slug);
    setOfferings([]);
    setDetails({});
  }

  function toggle(option: string) {
    setOfferings((cur) => (cur.includes(option) ? cur.filter((o) => o !== option) : [...cur, option]));
  }

  function addCustom() {
    const value = customDraft.trim().slice(0, 80);
    if (!value || allOptions.some((o) => o.toLowerCase() === value.toLowerCase())) return;
    setCustomOfferings((c) => [...c, value]);
    setOfferings((c) => [...c, value]);
    setCustomDraft("");
  }

  function removeCustom(option: string) {
    setCustomOfferings((c) => c.filter((o) => o !== option));
    setOfferings((c) => c.filter((o) => o !== option));
  }

  async function generate() {
    const parsed = profileBriefSchema.safeParse({ businessName, category, offerings, details, story, tone, locations, priceNote });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    setFailure(null);
    setBusy(true);
    try {
      const token = await getAccessToken();
      if (!token) {
        setFailure({ message: "Please sign in again to use the writing assistant.", retryable: false });
        return;
      }
      const result = await draftProfileCopy({ data: parsed.data, headers: { authorization: `Bearer ${token}` } });
      if (result.ok) setCopy(result.copy);
      else setFailure({ message: result.error, retryable: result.retryable });
    } catch {
      setFailure({ message: "We couldn't reach the writing assistant. Check your connection and try again.", retryable: true });
    } finally {
      setBusy(false);
    }
  }

  function asText(c: ProfileCopy) {
    return [c.headline, c.tagline, "", c.about, "", "Services", ...c.services.map((s) => `• ${s.name}: ${s.description}`), "", "Why hosts choose us", ...c.highlights.map((h) => `• ${h}`)].join("\n");
  }

  async function copyAll() {
    if (!copy) return;
    try {
      await navigator.clipboard.writeText(asText(copy));
      toast.success("Profile copy copied");
    } catch {
      toast.error("Couldn't copy. Select the text and copy it manually.");
    }
  }

  const field = (key: string) => errors[key] && <p className="mt-1 text-sm text-destructive" role="alert">{errors[key]}</p>;

  return (
    <div className="grid gap-8 lg:grid-cols-2" data-testid="profile-copy-studio">
      <form
        className="space-y-6 rounded-2xl bg-card p-6 shadow-card"
        onSubmit={(e) => {
          e.preventDefault();
          void generate();
        }}
        aria-describedby="studio-intro"
      >
        <div>
          <h2 className="font-display text-2xl font-bold text-plum-950">Describe your business</h2>
          <p id="studio-intro" className="mt-1 text-sm text-ink-muted">
            Tell us what you offer in your own words. Our AI assistant turns it into polished profile copy you can edit. It only uses facts you give it.
          </p>
        </div>

        <div>
          <Label htmlFor="biz-name">Business name</Label>
          <Input id="biz-name" value={businessName} onChange={(e) => setBusinessName(e.target.value)} maxLength={80} className="mt-1" />
          {field("businessName")}
        </div>

        <fieldset>
          <legend className="text-sm font-medium">What kind of vendor are you?</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {VENDOR_CATEGORIES.map((c) => (
              <button
                key={c.slug}
                type="button"
                aria-pressed={category === c.slug}
                onClick={() => pickCategory(c.slug)}
                className={`rounded-full border px-3 py-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  category === c.slug ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          {field("category")}
        </fieldset>

        {preset && (
          <>
            <fieldset>
              <legend className="text-sm font-medium">Services you offer</legend>
              <p className="text-xs text-ink-muted">Hosts looking for {preset.label.toLowerCase()} usually check {preset.hostPriorities}.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {allOptions.map((o) => {
                  const on = offerings.includes(o);
                  const custom = customOfferings.includes(o);
                  return (
                    <span key={o} className="inline-flex items-center">
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggle(o)}
                        className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          on ? "border-secondary bg-secondary text-secondary-foreground" : "border-border bg-background hover:bg-muted"
                        }`}
                      >
                        {on && <Check className="h-3.5 w-3.5" aria-hidden />}
                        {o}
                      </button>
                      {custom && (
                        <button type="button" onClick={() => removeCustom(o)} aria-label={`Remove ${o}`} className="ml-1 rounded-full p-1 text-ink-muted hover:bg-muted">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </span>
                  );
                })}
              </div>
              <div className="mt-3 flex gap-2">
                <Input
                  aria-label="Add your own service"
                  placeholder="Add your own service"
                  value={customDraft}
                  maxLength={80}
                  onChange={(e) => setCustomDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCustom();
                    }
                  }}
                />
                <Button type="button" variant="outline" onClick={addCustom} disabled={!customDraft.trim()}>
                  <Plus className="h-4 w-4" /> Add
                </Button>
              </div>
              {field("offerings")}
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              {preset.details.map((d) => (
                <div key={d.key}>
                  <Label htmlFor={`d-${d.key}`}>{d.label} <span className="text-ink-subtle">(optional)</span></Label>
                  <Input id={`d-${d.key}`} className="mt-1" placeholder={d.placeholder} maxLength={200} value={details[d.key] ?? ""} onChange={(e) => setDetails((cur) => ({ ...cur, [d.key]: e.target.value }))} />
                </div>
              ))}
            </div>
          </>
        )}

        <div>
          <Label htmlFor="story">In your own words</Label>
          <Textarea id="story" className="mt-1 min-h-32" maxLength={1500} value={story} onChange={(e) => setStory(e.target.value)} placeholder="What makes your work special? Who do you love working with? Anything hosts should know?" />
          <p className="mt-1 text-right text-xs text-ink-subtle">{story.length}/1500</p>
          {field("story")}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="areas">Areas served <span className="text-ink-subtle">(optional)</span></Label>
            <Input id="areas" className="mt-1" maxLength={120} value={locations} onChange={(e) => setLocations(e.target.value)} placeholder="e.g. Lagos, Ibadan, London" />
          </div>
          <div>
            <Label htmlFor="price">Price note <span className="text-ink-subtle">(optional)</span></Label>
            <Input id="price" className="mt-1" maxLength={160} value={priceNote} onChange={(e) => setPriceNote(e.target.value)} placeholder="e.g. Packages from ₦500,000" />
          </div>
        </div>

        <fieldset>
          <legend className="text-sm font-medium">Tone</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {TONES.map((t) => (
              <button key={t.value} type="button" aria-pressed={tone === t.value} onClick={() => setTone(t.value)} className={`rounded-xl border px-3 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tone === t.value ? "border-primary bg-primary/10 font-medium" : "border-border hover:bg-muted"}`}>
                {t.label}
              </button>
            ))}
          </div>
        </fieldset>

        <Button type="submit" disabled={busy} className="w-full">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {busy ? "Writing your profile…" : copy ? "Write a new version" : "Write my profile"}
        </Button>
      </form>

      <section aria-live="polite" aria-busy={busy} className="rounded-2xl bg-card p-6 shadow-card">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-2xl font-bold text-plum-950">Your profile draft</h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-ink-muted">AI-written · review before use</span>
        </div>

        {failure && (
          <div role="alert" className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
            <p>{failure.message}</p>
            {failure.retryable && (
              <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => void generate()}>
                <RefreshCw className="h-4 w-4" /> Try again
              </Button>
            )}
          </div>
        )}

        {busy && !copy && (
          <div className="mt-6 space-y-3" aria-label="Loading draft">
            {[60, 90, 100, 80, 95].map((w, i) => <div key={i} className="h-4 animate-pulse rounded bg-muted" style={{ width: `${w}%` }} />)}
          </div>
        )}

        {!busy && !copy && !failure && (
          <p className="mt-6 text-sm text-ink-muted">
            Pick your category, choose your services and describe your business. Your draft headline, about section and service descriptions will appear here.
          </p>
        )}

        {copy && (
          <div className={`mt-4 space-y-4 ${busy ? "opacity-60" : ""}`}>
            <div>
              <Label htmlFor="out-headline">Headline</Label>
              <Input id="out-headline" className="mt-1 font-display text-lg" value={copy.headline} onChange={(e) => setCopy({ ...copy, headline: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="out-tagline">Tagline</Label>
              <Input id="out-tagline" className="mt-1" value={copy.tagline} onChange={(e) => setCopy({ ...copy, tagline: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="out-about">About</Label>
              <Textarea id="out-about" className="mt-1 min-h-40" value={copy.about} onChange={(e) => setCopy({ ...copy, about: e.target.value })} />
            </div>
            <div className="space-y-3">
              <p className="text-sm font-medium">Services</p>
              {copy.services.map((s, i) => (
                <div key={i} className="rounded-xl border border-border p-3">
                  <Input aria-label={`Service ${i + 1} name`} value={s.name} onChange={(e) => setCopy({ ...copy, services: copy.services.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                  <Textarea aria-label={`Service ${i + 1} description`} className="mt-2" value={s.description} onChange={(e) => setCopy({ ...copy, services: copy.services.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })} />
                </div>
              ))}
            </div>
            {copy.highlights.length > 0 && (
              <div>
                <p className="text-sm font-medium">Why hosts choose you</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                  {copy.highlights.map((h, i) => <li key={i}>{h}</li>)}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => void copyAll()}><Copy className="h-4 w-4" /> Copy all</Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => void generate()}><RefreshCw className="h-4 w-4" /> Rewrite</Button>
            </div>
            <p className="text-xs text-ink-subtle">Saving to your public profile arrives with the profile feature. For now, copy your draft.</p>
          </div>
        )}
      </section>
    </div>
  );
}
