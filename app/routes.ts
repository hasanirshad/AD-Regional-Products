import {
  type RouteConfig,
  index,
  layout,
  route,
} from "@react-router/dev/routes";

// One layout (nav + shared state). Overview is the home route, then Products.
export default [
  layout("views/layout.tsx", [
    index("views/overview.tsx"),
    route("products", "views/products.tsx"),
    route("channels", "views/channels.tsx"),
    route("links", "views/links.tsx"),
    route("check", "views/check.tsx"),
  ]),
] satisfies RouteConfig;
