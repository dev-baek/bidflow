import { createBrowserRouter, useParams } from "react-router-dom";
import { HomePage } from "../pages/home/HomePage";
import { ListingCreatePage } from "../pages/listing-create/ListingCreatePage";
import { ListingSearchPage } from "../pages/listing-search/ListingSearchPage";
import { NotFoundPage } from "../pages/not-found/NotFoundPage";
import { LoginPage } from "../pages/auth/LoginPage";
import { RequireAuthenticated } from "../pages/auth/RequireAuthenticated";
import { AuctionDetailPage } from "../pages/auction-detail/AuctionDetailPage";

export function createAppRouter(apiBaseUrl: string) {
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
    { path: "/auctions/:auctionId", element: <AuctionDetailRoute apiBaseUrl={apiBaseUrl} /> },
    {
      path: "*",
      element: <NotFoundPage />,
    },
  ]);
}

function AuctionDetailRoute({ apiBaseUrl }: Readonly<{ apiBaseUrl: string }>) {
  const { auctionId } = useParams();
  return auctionId ? <AuctionDetailPage auctionId={auctionId} apiBaseUrl={apiBaseUrl} /> : <NotFoundPage />;
}
