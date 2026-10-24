import type { Config } from "@react-router/dev/config";

// Static single-page app: no server, no database (playbook section 1).
export default {
  ssr: false,
} satisfies Config;
