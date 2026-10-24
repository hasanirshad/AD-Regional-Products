import {
  type RouteConfig,
  index,
  layout,
  route,
} from "@react-router/dev/routes";

// One layout (nav + shared state). Overview is the home route, then
// Groups and Products.
export default [
  layout("views/layout.tsx", [
    index("views/overview.tsx"),
    route("groups", "views/groups.tsx"),
    route("products", "views/products.tsx"),
  ]),
] satisfies RouteConfig;
