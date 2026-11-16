import { createBrowserRouter, useParams } from "react-router-dom";
import { HomePage } from "../pages/home/HomePage";
import { ListingCreatePage } from "../pages/listing-create/ListingCreatePage";
import { ListingSearchPage } from "../pages/listing-search/ListingSearchPage";
import { NotFoundPage } from "../pages/not-found/NotFoundPage";
import { LoginPage } from "../pages/auth/LoginPage";
import { RequireAuthenticated } from "../pages/auth/RequireAuthenticated";
import { AuctionDetailPage } from "../pages/auction-detail/AuctionDetailPage";
import { useAuth } from "../features/auth/auth-context";

export function createAppRouter(apiBaseUrl: string, wsBaseUrl: string) {
  return createBrowserRouter([
    {
      path: "/",
      element: <HomePage />,
    },
    {
      path: "/login",
      element: <LoginPage />,
    },
    {
      element: <RequireAuthenticated />,
      children: [
        {
          path: "/listings/new",
          element: <ListingCreatePage />,
        },
      ],
    },
    { path: "/listings", element: <ListingSearchPage apiBaseUrl={apiBaseUrl} /> },
    { path: "/auctions/:auctionId", element: <AuctionDetailRoute apiBaseUrl={apiBaseUrl} wsBaseUrl={wsBaseUrl} /> },
    {
      path: "*",
      element: <NotFoundPage />,
    },
  ]);
}

function AuctionDetailRoute({ apiBaseUrl, wsBaseUrl }: Readonly<{ apiBaseUrl: string; wsBaseUrl: string }>) {
  const { auctionId } = useParams();
  const { state } = useAuth();
  const localActorId = state.mode === "AUTHENTICATED" && state.provider === "LOCAL" ? state.subject : undefined;
  return auctionId ? <AuctionDetailPage auctionId={auctionId} apiBaseUrl={apiBaseUrl} wsBaseUrl={wsBaseUrl} localActorId={localActorId} /> : <NotFoundPage />;
}
