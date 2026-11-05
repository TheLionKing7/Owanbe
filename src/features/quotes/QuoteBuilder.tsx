import { useState } from "react";
import {
  fromMinor,
  newQuoteSchema,
  quoteTotal,
  formatMinor,
  toMinor,
  type QuoteLine,
} from "./contracts";

interface LineDraft {
  key: number;
  label: string;
  amount: string;
}

export interface BuilderValues {
  host_house_id: string;
  service_date: string;
  currency: string;
  title: string;
  inclusions: QuoteLine[];
  extras: QuoteLine[];
  message?: string | undefined;
}

type BuilderField = "host_house_id" | "service_date" | "currency" | "title" | "inclusions";

interface QuoteBuilderProps {
  vendorHouseId: string;
  mode: "create" | "revise";
  /** Values carried over when a vendor edits an existing offer. */
  initial?: Partial<BuilderValues> | undefined;
  /** Prefilled from ?host=…&date=…; the enquiry rail that supplies these arrives with F-19/F-13. */
  hostHint?: string | null | undefined;
  dateHint?: string | null | undefined;
  pending: boolean;
  error: string | null;
  onSubmit(values: BuilderValues): void;
  onClose(): void;
}

let nextKey = 1;

const FIELD_KEYS: BuilderField[] = [
  "host_house_id",
  "service_date",
  "currency",
  "title",
  "inclusions",
];

function isField(key: string | undefined): key is BuilderField {
  return key !== undefined && (FIELD_KEYS as string[]).includes(key);
}

function emptyLine(): LineDraft {
  return { key: nextKey++, label: "", amount: "" };
}

function toLines(drafts: LineDraft[], currency: string): QuoteLine[] {
  return drafts
    .filter((draft) => draft.label.trim() || draft.amount.trim())
    .map((draft) => ({
      label: draft.label.trim(),
      line_total_minor: toMinor(draft.amount, currency) ?? 0,
    }));
}

function LineEditor({
  legend,
  lines,
  currency,
  onChange,
}: {
  legend: string;
  lines: LineDraft[];
  currency: string;
  onChange(lines: LineDraft[]): void;
}) {
  function update(key: number, patch: Partial<LineDraft>) {
    onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }
  return (
    <fieldset className="mt-5">
      <legend className="text-sm font-semibold text-plum-900">{legend}</legend>
      <ul className="mt-2 space-y-2">
        {lines.map((line) => (
          <li key={line.key} className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor={`line-${line.key}`}>
              Item name
            </label>
            <input
              id={`line-${line.key}`}
              value={line.label}
              placeholder="Item or service"
              maxLength={120}
              onChange={(event) => update(line.key, { label: event.target.value })}
              className="min-w-0 flex-1 rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
            />
            <label className="sr-only" htmlFor={`amount-${line.key}`}>
              Amount in {currency}
            </label>
            <input
              id={`amount-${line.key}`}
              value={line.amount}
              inputMode="decimal"
              placeholder={`Amount (${currency})`}
              onChange={(event) => update(line.key, { amount: event.target.value })}
              className="w-36 rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
            />
            <button
              type="button"
              className="btn-outline min-h-[44px] px-3 py-2 text-sm"
              onClick={() => onChange(lines.filter((item) => item.key !== line.key))}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="btn-outline mt-2 min-h-[44px] px-4 py-2 text-sm"
        onClick={() => onChange([...lines, emptyLine()])}
      >
        Add a line
      </button>
    </fieldset>
  );
}

export function QuoteBuilder({
  vendorHouseId,
  mode,
  initial,
  hostHint,
  dateHint,
  pending,
  error,
  onSubmit,
  onClose,
}: QuoteBuilderProps) {
  const initialCurrency = initial?.currency ?? "NGN";
  const toDrafts = (lines?: QuoteLine[]): LineDraft[] =>
    (lines ?? []).map((line) => ({
      key: nextKey++,
      label: line.label,
      amount: fromMinor(line.line_total_minor, initialCurrency),
    }));
  const [hostHouseId, setHostHouseId] = useState(initial?.host_house_id ?? hostHint ?? "");
  const [serviceDate, setServiceDate] = useState(initial?.service_date ?? dateHint ?? "");
  const [currency, setCurrency] = useState(initialCurrency);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [message, setMessage] = useState(initial?.message ?? "");
  const [inclusions, setInclusions] = useState<LineDraft[]>(() => {
    const drafts = toDrafts(initial?.inclusions);
    return drafts.length ? drafts : [emptyLine()];
  });
  const [extras, setExtras] = useState<LineDraft[]>(() => toDrafts(initial?.extras));
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<BuilderField, string>>>({});

  const total = quoteTotal(toLines(inclusions, currency), toLines(extras, currency));

  function submit() {
    const candidate = {
      vendor_house_id: vendorHouseId,
      host_house_id: hostHouseId.trim(),
      service_date: serviceDate.trim(),
      currency: currency.trim(),
      title: title.trim(),
      inclusions: toLines(inclusions, currency),
      extras: toLines(extras, currency),
    };
    const parsed = newQuoteSchema.safeParse(candidate);
    const next: Partial<Record<BuilderField, string>> = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]?.toString();
        if (isField(key)) next[key] ??= issue.message;
      }
    }
    // A blank or non-numeric amount becomes 0 in toLines, so an unrelated schema pass would submit
    // the line as free work; refuse it whatever the rest of the quote looks like.
    for (const draft of [...inclusions, ...extras]) {
      if (draft.label.trim() && toMinor(draft.amount, currency) === null) {
        next.inclusions ??= "Every line needs an amount of 0 or more";
      }
    }
    if (!parsed.success || Object.keys(next).length > 0) {
      setFieldErrors(next);
      return;
    }
    setFieldErrors({});
    onSubmit({
      ...parsed.data,
      ...(mode === "revise" && message.trim() ? { message: message.trim() } : {}),
    });
  }

  return (
    <section
      className="surface p-5 sm:p-6"
      aria-labelledby="quote-builder-title"
      data-testid="quote-builder"
    >
      <h2 id="quote-builder-title" className="font-display text-2xl font-bold text-plum-950">
        {mode === "create" ? "New quote" : "Revise this offer"}
      </h2>
      <p className="mt-2 text-sm text-ink-muted">
        Only your vendor house can author a quote. Every save appends a revision; nothing is
        overwritten, and the total is recalculated from your lines in the database.
      </p>
      {mode === "create" && !hostHint && (
        <p className="mt-3 rounded-2xl bg-gold-100 px-4 py-3 text-sm text-plum-900">
          Enquiries are not wired up yet (F-19), so paste the host house ID you are quoting for.
        </p>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {mode === "create" && (
          <div>
            <label htmlFor="builder-host" className="text-sm font-semibold text-ink">
              Host house ID
            </label>
            <input
              id="builder-host"
              value={hostHouseId}
              onChange={(event) => setHostHouseId(event.target.value)}
              className="mt-1 w-full rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
              aria-invalid={Boolean(fieldErrors.host_house_id)}
              aria-describedby={fieldErrors.host_house_id ? "builder-host-error" : undefined}
            />
            {fieldErrors.host_house_id && (
              <p
                id="builder-host-error"
                role="alert"
                className="mt-1 text-sm text-owanbe-vibrant-red"
              >
                {fieldErrors.host_house_id}
              </p>
            )}
          </div>
        )}
        <div>
          <label htmlFor="builder-date" className="text-sm font-semibold text-ink">
            Celebration date
          </label>
          <input
            id="builder-date"
            type="date"
            value={serviceDate}
            onChange={(event) => setServiceDate(event.target.value)}
            className="mt-1 w-full rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
            aria-invalid={Boolean(fieldErrors.service_date)}
            aria-describedby={fieldErrors.service_date ? "builder-date-error" : undefined}
          />
          {fieldErrors.service_date && (
            <p
              id="builder-date-error"
              role="alert"
              className="mt-1 text-sm text-owanbe-vibrant-red"
            >
              {fieldErrors.service_date}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="builder-currency" className="text-sm font-semibold text-ink">
            Currency
          </label>
          <input
            id="builder-currency"
            value={currency}
            maxLength={3}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
            className="mt-1 w-full rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
            aria-invalid={Boolean(fieldErrors.currency)}
            aria-describedby={fieldErrors.currency ? "builder-currency-error" : undefined}
          />
          {fieldErrors.currency && (
            <p
              id="builder-currency-error"
              role="alert"
              className="mt-1 text-sm text-owanbe-vibrant-red"
            >
              {fieldErrors.currency}
            </p>
          )}
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="builder-title" className="text-sm font-semibold text-ink">
            Quote title
          </label>
          <input
            id="builder-title"
            value={title}
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
            className="mt-1 w-full rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
            aria-invalid={Boolean(fieldErrors.title)}
            aria-describedby={fieldErrors.title ? "builder-title-error" : undefined}
          />
          {fieldErrors.title && (
            <p
              id="builder-title-error"
              role="alert"
              className="mt-1 text-sm text-owanbe-vibrant-red"
            >
              {fieldErrors.title}
            </p>
          )}
        </div>
      </div>

      <LineEditor
        legend="Included"
        lines={inclusions}
        currency={currency}
        onChange={setInclusions}
      />
      <LineEditor
        legend="Optional extras"
        lines={extras}
        currency={currency}
        onChange={setExtras}
      />
      {fieldErrors.inclusions && (
        <p role="alert" className="mt-2 text-sm text-owanbe-vibrant-red">
          {fieldErrors.inclusions}
        </p>
      )}

      <p className="mt-5 font-display text-2xl font-bold text-plum-900" data-testid="builder-total">
        {formatMinor(total, currency)}
      </p>

      {mode === "revise" && (
        <div className="mt-4">
          <label htmlFor="builder-message" className="text-sm font-semibold text-ink">
            Note to the host (optional)
          </label>
          <textarea
            id="builder-message"
            value={message}
            maxLength={2000}
            rows={3}
            onChange={(event) => setMessage(event.target.value)}
            className="mt-1 w-full rounded-2xl border border-plum-900/10 bg-white px-3 py-2 text-sm text-ink"
          />
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-2xl bg-owanbe-vibrant-red/10 px-4 py-3 text-sm font-semibold text-owanbe-vibrant-red"
        >
          {error}
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary min-h-[44px] px-5 py-2 text-sm"
          disabled={pending}
          onClick={submit}
          data-testid="builder-save"
        >
          {pending ? "Saving…" : mode === "create" ? "Save draft" : "Save revision"}
        </button>
        <button
          type="button"
          className="btn-outline min-h-[44px] px-5 py-2 text-sm"
          disabled={pending}
          onClick={onClose}
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
