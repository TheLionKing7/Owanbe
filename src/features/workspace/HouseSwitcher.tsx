/**
 * F-1 Dual workspace switcher. One account can hold a Host house and a Vendor house; this is
 * the one place that moves between them.
 *
 * Two rules the platform does not bend. The switch is never automatic: the person confirms
 * before the house changes, so a stray tap cannot drop them into the other house's work. And
 * each house carries its own unread count, so the badge says which house is waiting without
 * carrying anything from the other one.
 */
import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { holdsApi, type HoldsApi } from "@/features/holds/api";
import { unreadCount } from "@/features/holds/contracts";
import { HOUSES, type HouseId } from "@/lib/houses";
import type { HouseSummary } from "@/lib/auth/types";

export interface HouseSwitcherProps {
  /** The caller's own houses, from public.my_houses(). */
  houses: HouseSummary[];
  /** The house the person is in right now. */
  current: HouseId;
  /** Called only after the person confirms the switch. */
  onSwitch(kind: HouseId): void;
  /** Injected in tests; defaults to the notification projection. */
  api?: HoldsApi | undefined;
}

export function HouseSwitcher({ houses, current, onSwitch, api = holdsApi }: HouseSwitcherProps) {
  const [pending, setPending] = useState<HouseId | null>(null);
  const [unread, setUnread] = useState<Partial<Record<HouseId, number>>>({});

  const other = houses.find((house) => house.kind !== current);

  useEffect(() => {
    let live = true;
    async function load() {
      const entries = await Promise.all(
        houses.map(async (house) => {
          try {
            return [house.kind, unreadCount(await api.alerts(house.house_id))] as const;
          } catch {
            // A house whose alerts cannot be read shows no badge; it never blocks the switch.
            return [house.kind, 0] as const;
          }
        }),
      );
      if (live) setUnread(Object.fromEntries(entries));
    }
    void load();
    return () => {
      live = false;
    };
  }, [api, houses]);

  if (!other) return null;

  const target = pending ? HOUSES[pending] : null;
  const from = HOUSES[current];

  return (
    <div className="mt-4" data-testid="house-switcher">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-plum-500">Your spaces</p>
      <ul className="mt-2 space-y-1">
        {houses.map((house) => {
          const isCurrent = house.kind === current;
          const count = unread[house.kind] ?? 0;
          return (
            <li key={house.house_id}>
              <button
                type="button"
                onClick={() => {
                  if (!isCurrent) setPending(house.kind);
                }}
                aria-current={isCurrent ? "page" : undefined}
                className={`flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl border px-3 text-left text-sm font-medium transition-colors ${
                  isCurrent
                    ? "border-plum-900/15 bg-plum-100 text-plum-900"
                    : "border-plum-900/10 text-ink-muted hover:bg-plum-100"
                }`}
                data-testid={`house-switch-${house.kind}`}
              >
                <span>{HOUSES[house.kind].name}</span>
                {count > 0 && (
                  <span
                    className="rounded-full bg-gold-100 px-2 py-0.5 text-xs font-semibold text-plum-900"
                    data-testid={`house-switch-badge-${house.kind}`}
                  >
                    {count}
                    <span className="sr-only"> unread alerts</span>
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle data-testid="house-switch-title">
              {target ? `Switch to the ${target.name}?` : "Switch house?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              You are leaving the {from.name}. Each house keeps its own celebrations, quotes and
              payments, so nothing moves between them and nothing is shared.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="house-switch-cancel">Stay here</AlertDialogCancel>
            <AlertDialogAction
              data-testid="house-switch-confirm"
              onClick={() => {
                if (pending) onSwitch(pending);
                setPending(null);
              }}
            >
              {target ? `Switch to ${target.name}` : "Switch"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
