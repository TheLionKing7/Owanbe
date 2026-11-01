import { lazy, Suspense } from "react";
import { createBrowserRouter, RouterProvider, type RouteObject } from "react-router-dom";
import PublicLayout from "@/layouts/PublicLayout";
import Home from "@/routes/Home";
import { AuthProvider } from "@/lib/auth/AuthProvider";

// Route-level code splitting: only the public shell + homepage ship in the initial bundle.
const HouseLayout = lazy(() => import("@/layouts/HouseLayout"));
const HousePage = lazy(() => import("@/routes/HousePage"));
const PlaceholderPage = lazy(() => import("@/routes/PlaceholderPage"));
const NotFound = lazy(() => import("@/routes/NotFound"));
const SignIn = lazy(() => import("@/routes/SignIn"));
const AuthCallback = lazy(() => import("@/routes/AuthCallback"));

function RouteFallback() {
  return (
    <div role="status" aria-live="polite" className="grid min-h-[40vh] place-items-center text-sm text-ink-muted">
      Loading…
    </div>
  );
}

const lazyEl = (el: JSX.Element) => <Suspense fallback={<RouteFallback />}>{el}</Suspense>;

const houseRoutes = (houseId: "host" | "vendor"): RouteObject => ({
  path: `/${houseId}`,
  element: lazyEl(<HouseLayout houseId={houseId} />),
  children: [
    { index: true, element: lazyEl(<HousePage houseId={houseId} />) },
    { path: ":section", element: lazyEl(<HousePage houseId={houseId} />) },
  ],
});

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <PublicLayout />,
    children: [
      { index: true, element: <Home /> },
      ...["discover", "discover/*", "vendors/*", "culture", "about", "help", "get-started"].map((path) => ({
        path,
        element: lazyEl(<PlaceholderPage />),
      })),
      { path: "sign-in", element: lazyEl(<SignIn />) },
      { path: "sign-up", element: lazyEl(<SignIn signup />) },
      { path: "auth/callback", element: lazyEl(<AuthCallback />) },
      { path: "*", element: lazyEl(<NotFound />) },
    ],
  },
  houseRoutes("host"),
  houseRoutes("vendor"),
];

export const routerFuture = {
  v7_relativeSplatPath: true,
  v7_fetcherPersist: true,
  v7_normalizeFormMethod: true,
  v7_partialHydration: true,
  v7_skipActionErrorRevalidation: true,
} as const;

const router = createBrowserRouter(routes, { future: routerFuture });

export default function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </AuthProvider>
  );
}
