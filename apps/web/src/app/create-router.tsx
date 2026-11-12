import { createBrowserRouter } from "react-router-dom";
import { HomePage } from "../pages/home/HomePage";
import { ListingCreatePage } from "../pages/listing-create/ListingCreatePage";
import { ListingSearchPage } from "../pages/listing-search/ListingSearchPage";
import { NotFoundPage } from "../pages/not-found/NotFoundPage";

export function createAppRouter(apiBaseUrl: string) {
  return createBrowserRouter([
    {
      path: "/",
      element: <HomePage />,
    },
    {
      path: "/listings/new",
      element: <ListingCreatePage />,
    },
    { path: "/listings", element: <ListingSearchPage apiBaseUrl={apiBaseUrl} /> },
    {
      path: "*",
      element: <NotFoundPage />,
    },
  ]);
}
