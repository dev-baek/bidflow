import { createBrowserRouter, useParams } from "react-router-dom";
import { HomePage } from "../pages/home/HomePage";
import { ListingCreatePage } from "../pages/listing-create/ListingCreatePage";
import { ListingSearchPage } from "../pages/listing-search/ListingSearchPage";
import { NotFoundPage } from "../pages/not-found/NotFoundPage";
import { LoginPage } from "../pages/auth/LoginPage";
import { CognitoCallbackPage } from "../pages/auth/CognitoCallbackPage";
import { RequireAuthenticated } from "../pages/auth/RequireAuthenticated";
import { AuctionDetailPage } from "../pages/auction-detail/AuctionDetailPage";
import { useAuth } from "../features/auth/auth-context";
import { SiteLayout } from "./SiteLayout";

export function createAppRouter(apiBaseUrl: string, wsBaseUrl: string) {
  return createBrowserRouter([
    {
      path: "/login",
      element: <LoginPage />,
    },
    { path: "/auth/callback", element: <CognitoCallbackPage /> },
    {
      element: <SiteLayout />,
      children: [
        { path: "/", element: <HomePage /> },
        { path: "/listings", element: <ListingSearchPage apiBaseUrl={apiBaseUrl} /> },
        { path: "/auctions/:auctionId", element: <AuctionDetailRoute apiBaseUrl={apiBaseUrl} wsBaseUrl={wsBaseUrl} /> },
        { element: <RequireAuthenticated />, children: [
          { path: "/listings/new", element: <ListingCreateRoute apiBaseUrl={apiBaseUrl} /> },
        ] },
        { path: "*", element: <NotFoundPage /> },
      ],
    },
  ]);
}

function ListingCreateRoute({ apiBaseUrl }: Readonly<{ apiBaseUrl: string }>) {
  const { state, cognitoAccess } = useAuth();
  const localActorId = state.mode === "AUTHENTICATED" && state.provider === "LOCAL" ? state.subject : undefined;
  return <ListingCreatePage key={cognitoAccess ? `cognito:${cognitoAccess.id}` : `local:${localActorId}`} apiBaseUrl={apiBaseUrl} localActorId={localActorId} cognitoAccess={cognitoAccess} />;
}

function AuctionDetailRoute({ apiBaseUrl, wsBaseUrl }: Readonly<{ apiBaseUrl: string; wsBaseUrl: string }>) {
  const { auctionId } = useParams();
  const { state, cognitoAccess } = useAuth();
  const localActorId = state.mode === "AUTHENTICATED" && state.provider === "LOCAL" ? state.subject : undefined;
  return auctionId ? <AuctionDetailPage key={cognitoAccess ? `cognito:${cognitoAccess.id}` : `local:${localActorId}`} auctionId={auctionId} apiBaseUrl={apiBaseUrl} wsBaseUrl={wsBaseUrl} localActorId={localActorId} cognitoAccess={cognitoAccess} /> : <NotFoundPage />;
}
