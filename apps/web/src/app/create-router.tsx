import { createBrowserRouter } from "react-router-dom";
import { HomePage } from "../pages/home/HomePage";
import { ListingCreatePage } from "../pages/listing-create/ListingCreatePage";
import { NotFoundPage } from "../pages/not-found/NotFoundPage";

export function createAppRouter() {
  return createBrowserRouter([
    {
      path: "/",
      element: <HomePage />,
    },
    {
      path: "/listings/new",
      element: <ListingCreatePage />,
    },
    {
      path: "*",
      element: <NotFoundPage />,
    },
  ]);
}
