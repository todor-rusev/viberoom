// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

export type ConnectionGroup = "everyday" | "work" | "developers" | "creative" | "business";

export interface CatalogEntry {
  id: string;
  name: string;
  blurb: string;
  group: ConnectionGroup;
  mcpUrl: string;
  mark?: { hex: string; from: "simple-icons"; slug: string } | { hex: string; from: `https://${string}` };
}

export const CATALOG: readonly CatalogEntry[] = [
  { id: "perplexity", name: "Perplexity", blurb: "Answers from the web, with sources", group: "everyday", mcpUrl: "https://api.perplexity.ai/mcp", mark: { hex: "#1FB8CD", from: "simple-icons", slug: "perplexity" } },
  { id: "exa", name: "Exa", blurb: "Web search; no sign-in", group: "everyday", mcpUrl: "https://mcp.exa.ai/mcp", mark: { hex: "#0143D9", from: "https://exa.ai" } },
  { id: "tavily", name: "Tavily", blurb: "Web search and page extraction", group: "everyday", mcpUrl: "https://mcp.tavily.com/mcp/", mark: { hex: "#1F1E1E", from: "https://www.tavily.com" } },
  { id: "wolfram", name: "Wolfram", blurb: "Math, science and facts; no sign-in", group: "everyday", mcpUrl: "https://agenttools.wolfram.com/mcp", mark: { hex: "#DD1100", from: "simple-icons", slug: "wolfram" } },
  { id: "trello", name: "Trello", blurb: "Boards, lists and cards", group: "everyday", mcpUrl: "https://mcp.trello.com/v1", mark: { hex: "#0052CC", from: "simple-icons", slug: "trello" } },
  { id: "calendly", name: "Calendly", blurb: "Meetings and availability", group: "everyday", mcpUrl: "https://mcp.calendly.com", mark: { hex: "#006BFF", from: "simple-icons", slug: "calendly" } },
  { id: "craft", name: "Craft", blurb: "Notes and documents", group: "everyday", mcpUrl: "https://mcp.craft.do/my/mcp" },
  { id: "fireflies", name: "Fireflies", blurb: "Meeting notes and transcripts", group: "everyday", mcpUrl: "https://api.fireflies.ai/mcp", mark: { hex: "#E82A73", from: "https://fireflies.ai" } },
  { id: "canva", name: "Canva", blurb: "Designs, presentations and images", group: "everyday", mcpUrl: "https://mcp.canva.com/mcp", mark: { hex: "#7D2AE7", from: "https://svgl.app" } },
  { id: "gamma", name: "Gamma", blurb: "Presentations and documents", group: "everyday", mcpUrl: "https://mcp.gamma.app/mcp" },
  { id: "wordpress", name: "WordPress.com", blurb: "Sites and posts", group: "everyday", mcpUrl: "https://public-api.wordpress.com/wpcom/v2/mcp/v1", mark: { hex: "#21759B", from: "simple-icons", slug: "wordpress" } },
  { id: "kiwi", name: "Kiwi.com", blurb: "Flights; no sign-in", group: "everyday", mcpUrl: "https://mcp.kiwi.com", mark: { hex: "#00A991", from: "https://www.kiwi.com" } },
  { id: "trivago", name: "trivago", blurb: "Hotels; no sign-in", group: "everyday", mcpUrl: "https://mcp.trivago.com/mcp", mark: { hex: "#E32851", from: "simple-icons", slug: "trivago" } },
  { id: "alltrails", name: "AllTrails", blurb: "Hiking and running trails; no sign-in", group: "everyday", mcpUrl: "https://www.alltrails.com/mcp", mark: { hex: "#142800", from: "simple-icons", slug: "alltrails" } },
  { id: "atlassian", name: "Atlassian", blurb: "Jira and Confluence", group: "work", mcpUrl: "https://mcp.atlassian.com/v2/mcp", mark: { hex: "#0052CC", from: "simple-icons", slug: "atlassian" } },
  { id: "notion", name: "Notion", blurb: "Pages and databases", group: "work", mcpUrl: "https://mcp.notion.com/mcp", mark: { hex: "#000000", from: "simple-icons", slug: "notion" } },
  { id: "linear", name: "Linear", blurb: "Issues and projects", group: "work", mcpUrl: "https://mcp.linear.app/mcp", mark: { hex: "#5E6AD2", from: "simple-icons", slug: "linear" } },
  { id: "airtable", name: "Airtable", blurb: "Bases and records", group: "work", mcpUrl: "https://mcp.airtable.com/mcp", mark: { hex: "#18BFFF", from: "simple-icons", slug: "airtable" } },
  { id: "todoist", name: "Todoist", blurb: "Tasks and projects", group: "work", mcpUrl: "https://ai.todoist.net/mcp", mark: { hex: "#E44332", from: "simple-icons", slug: "todoist" } },
  { id: "sentry", name: "Sentry", blurb: "Errors and performance", group: "developers", mcpUrl: "https://mcp.sentry.dev/mcp", mark: { hex: "#362D59", from: "simple-icons", slug: "sentry" } },
  { id: "cloudflare", name: "Cloudflare", blurb: "Workers, DNS and the Cloudflare API", group: "developers", mcpUrl: "https://mcp.cloudflare.com/mcp", mark: { hex: "#F38020", from: "simple-icons", slug: "cloudflare" } },
  { id: "supabase", name: "Supabase", blurb: "Postgres projects", group: "developers", mcpUrl: "https://mcp.supabase.com/mcp", mark: { hex: "#3FCF8E", from: "simple-icons", slug: "supabase" } },
  { id: "huggingface", name: "Hugging Face", blurb: "Models, datasets and Spaces", group: "developers", mcpUrl: "https://huggingface.co/mcp", mark: { hex: "#FFD21E", from: "simple-icons", slug: "huggingface" } },
  { id: "monday", name: "monday.com", blurb: "Boards, items and workflows", group: "work", mcpUrl: "https://mcp.monday.com/mcp", mark: { hex: "#6161FF", from: "https://monday.com" } },
  { id: "clickup", name: "ClickUp", blurb: "Tasks, docs and goals", group: "work", mcpUrl: "https://mcp.clickup.com/mcp", mark: { hex: "#7B68EE", from: "simple-icons", slug: "clickup" } },
  { id: "miro", name: "Miro", blurb: "Boards and diagrams", group: "work", mcpUrl: "https://mcp.miro.com/", mark: { hex: "#050038", from: "simple-icons", slug: "miro" } },
  { id: "dropbox", name: "Dropbox", blurb: "Files and folders", group: "work", mcpUrl: "https://mcp.dropbox.com/mcp", mark: { hex: "#0061FF", from: "simple-icons", slug: "dropbox" } },
  { id: "vercel", name: "Vercel", blurb: "Projects and deployments", group: "developers", mcpUrl: "https://mcp.vercel.com", mark: { hex: "#000000", from: "simple-icons", slug: "vercel" } },
  { id: "netlify", name: "Netlify", blurb: "Sites and deploys", group: "developers", mcpUrl: "https://netlify-mcp.netlify.app/mcp", mark: { hex: "#00C7B7", from: "simple-icons", slug: "netlify" } },
  { id: "neon", name: "Neon", blurb: "Serverless Postgres", group: "developers", mcpUrl: "https://mcp.neon.tech/mcp", mark: { hex: "#34D59A", from: "simple-icons", slug: "neon" } },
  { id: "posthog", name: "PostHog", blurb: "Product analytics and feature flags", group: "developers", mcpUrl: "https://mcp.posthog.com/mcp", mark: { hex: "#000000", from: "simple-icons", slug: "posthog" } },
  { id: "webflow", name: "Webflow", blurb: "Sites and their content", group: "creative", mcpUrl: "https://mcp.webflow.com/mcp", mark: { hex: "#146EF5", from: "simple-icons", slug: "webflow" } },
  { id: "wix", name: "Wix", blurb: "Sites, stores and bookings", group: "creative", mcpUrl: "https://mcp.wix.com/mcp", mark: { hex: "#0C6EFC", from: "simple-icons", slug: "wix" } },
  { id: "stripe", name: "Stripe", blurb: "Payments, customers and invoices", group: "business", mcpUrl: "https://mcp.stripe.com", mark: { hex: "#635BFF", from: "simple-icons", slug: "stripe" } },
  { id: "paypal", name: "PayPal", blurb: "Payments, invoices and orders", group: "business", mcpUrl: "https://mcp.paypal.com/mcp", mark: { hex: "#002991", from: "simple-icons", slug: "paypal" } },
  { id: "context7", name: "Context7", blurb: "Current docs for any library; no sign-in", group: "developers", mcpUrl: "https://mcp.context7.com/mcp", mark: { hex: "#000000", from: "https://context7.com" } },
  { id: "deepwiki", name: "DeepWiki", blurb: "Docs of GitHub repositories; no sign-in", group: "developers", mcpUrl: "https://mcp.deepwiki.com/mcp" },
  { id: "mslearn", name: "Microsoft Learn", blurb: "Microsoft's documentation; no sign-in", group: "developers", mcpUrl: "https://learn.microsoft.com/api/mcp", mark: { hex: "#0078D4", from: "https://commons.wikimedia.org" } },
  { id: "awsknowledge", name: "AWS Knowledge", blurb: "AWS documentation; no sign-in", group: "developers", mcpUrl: "https://knowledge-mcp.global.api.aws", mark: { hex: "#232F3E", from: "https://aws.amazon.com" } },
  { id: "gitlab", name: "GitLab", blurb: "Projects, issues and merge requests", group: "developers", mcpUrl: "https://gitlab.com/api/v4/mcp", mark: { hex: "#FC6D26", from: "simple-icons", slug: "gitlab" } },
  { id: "postman", name: "Postman", blurb: "APIs, collections and environments", group: "developers", mcpUrl: "https://mcp.postman.com/mcp", mark: { hex: "#FF6C37", from: "simple-icons", slug: "postman" } },
  { id: "prisma", name: "Prisma", blurb: "Postgres databases", group: "developers", mcpUrl: "https://mcp.prisma.io/mcp", mark: { hex: "#2D3748", from: "simple-icons", slug: "prisma" } },
  { id: "grafana", name: "Grafana", blurb: "Dashboards, metrics and alerts", group: "developers", mcpUrl: "https://mcp.grafana.com/mcp", mark: { hex: "#F46800", from: "simple-icons", slug: "grafana" } },
  { id: "honeycomb", name: "Honeycomb", blurb: "Traces and observability", group: "developers", mcpUrl: "https://mcp.honeycomb.io/mcp", mark: { hex: "#FFB000", from: "https://commons.wikimedia.org" } },
  { id: "axiom", name: "Axiom", blurb: "Logs and events", group: "developers", mcpUrl: "https://mcp.axiom.co/mcp", mark: { hex: "#000000", from: "https://svgl.app" } },
  { id: "buildkite", name: "Buildkite", blurb: "Pipelines and builds", group: "developers", mcpUrl: "https://mcp.buildkite.com/mcp", mark: { hex: "#14CC80", from: "simple-icons", slug: "buildkite" } },
  { id: "semgrep", name: "Semgrep", blurb: "Code scans for security issues", group: "developers", mcpUrl: "https://mcp.semgrep.ai/mcp", mark: { hex: "#13BF95", from: "https://semgrep.dev" } },
  { id: "socket", name: "Socket", blurb: "Security of open-source packages; no sign-in", group: "developers", mcpUrl: "https://mcp.socket.dev/", mark: { hex: "#C93CD7", from: "simple-icons", slug: "socket" } },
  { id: "jam", name: "Jam", blurb: "Bug reports with their recordings", group: "developers", mcpUrl: "https://mcp.jam.dev/mcp", mark: { hex: "#FF4063", from: "https://jam.dev" } },
  { id: "apify", name: "Apify", blurb: "Web scrapers and the data they collect", group: "developers", mcpUrl: "https://mcp.apify.com/", mark: { hex: "#246DFF", from: "https://apify.com" } },
  { id: "globalping", name: "Globalping", blurb: "Network tests from around the world", group: "developers", mcpUrl: "https://mcp.globalping.dev/mcp", mark: { hex: "#17D4A7", from: "https://globalping.io" } },
  { id: "coda", name: "Coda", blurb: "Docs and tables", group: "work", mcpUrl: "https://coda.io/apis/mcp", mark: { hex: "#F46A54", from: "simple-icons", slug: "coda" } },
  { id: "granola", name: "Granola", blurb: "Meeting notes", group: "work", mcpUrl: "https://mcp.granola.ai/mcp", mark: { hex: "#B2C248", from: "https://svgl.app" } },
  { id: "guru", name: "Guru", blurb: "The company's knowledge", group: "work", mcpUrl: "https://mcp.api.getguru.com/mcp", mark: { hex: "#000000", from: "https://www.getguru.com" } },
  { id: "egnyte", name: "Egnyte", blurb: "Files and content", group: "work", mcpUrl: "https://mcp-server.egnyte.com/mcp", mark: { hex: "#00968F", from: "simple-icons", slug: "egnyte" } },
  { id: "cloudinary", name: "Cloudinary", blurb: "Images and videos, stored and transformed", group: "creative", mcpUrl: "https://asset-management.mcp.cloudinary.com/mcp", mark: { hex: "#3448C5", from: "simple-icons", slug: "cloudinary" } },
  { id: "replicate", name: "Replicate", blurb: "AI models for images, video and sound", group: "creative", mcpUrl: "https://mcp.replicate.com/mcp", mark: { hex: "#000000", from: "simple-icons", slug: "replicate" } },
  { id: "invideo", name: "invideo", blurb: "Videos from a prompt; no sign-in", group: "creative", mcpUrl: "https://mcp.invideo.io/mcp" },
  { id: "attio", name: "Attio", blurb: "CRM: people, companies and deals", group: "business", mcpUrl: "https://mcp.attio.com/mcp", mark: { hex: "#000000", from: "https://attio.com" } },
  { id: "close", name: "Close", blurb: "Sales CRM: leads and calls", group: "business", mcpUrl: "https://mcp.close.com/mcp" },
  { id: "square", name: "Square", blurb: "Payments, orders and catalog", group: "business", mcpUrl: "https://mcp.squareup.com/mcp", mark: { hex: "#3E4348", from: "simple-icons", slug: "square" } },
  { id: "ramp", name: "Ramp", blurb: "Company cards and spend", group: "business", mcpUrl: "https://mcp.ramp.com/mcp", mark: { hex: "#1A1A1A", from: "https://commons.wikimedia.org" } },
  { id: "mercury", name: "Mercury", blurb: "Business banking", group: "business", mcpUrl: "https://mcp.mercury.com/mcp", mark: { hex: "#272735", from: "https://mercury.com" } },
  { id: "higgsfield", name: "Higgsfield", blurb: "Images and video", group: "creative", mcpUrl: "https://mcp.higgsfield.ai/mcp", mark: { hex: "#D1FE17", from: "https://higgsfield.ai" } },
];

export const catalogEntry = (id: string): CatalogEntry | undefined => CATALOG.find((entry) => entry.id === id);

export const KEYED_SYSTEMS = [
  { id: "telegram", name: "Telegram", blurb: "the bot key from BotFather; the bot starts with it" },
  { id: "zep", name: "Zep Cloud", blurb: "the long-term memory's project key; entering it chooses Zep and proves the key live" },
  { id: "sieve", name: "the memory sieve", blurb: "the sieve model's API key; it switches the sieve to its model, with the baseUrl and model given" },
  { id: "voice", name: "the voice provider", blurb: "the speech provider's API key (Settings → Voice); it chooses the provider given (openai, groq, or compatible with its baseUrl and model), with the language given, and the key is proven against the provider" },
] as const;

export type KeyedSystemId = (typeof KEYED_SYSTEMS)[number]["id"];

export const keyedSystem = (id: string) => KEYED_SYSTEMS.find((entry) => entry.id === id);

export const CONNECTION_ID = /^[a-z][a-z0-9-]{1,31}$/;

export function ownConnectionId(name: string, taken: (id: string) => boolean): string {
  const slug = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^[^a-z]+|-+$/g, "").slice(0, 28).replace(/-+$/, "");
  const base = slug.length >= 2 ? slug : "server";
  if (!taken(base)) return base;
  for (let n = 2; ; n++) if (!taken(`${base}-${n}`)) return `${base}-${n}`;
}
for (const entry of CATALOG) if (!CONNECTION_ID.test(entry.id)) throw new Error(`catalogue id "${entry.id}" is not a connection id`);
for (const entry of KEYED_SYSTEMS) if (catalogEntry(entry.id)) throw new Error(`"${entry.id}" is both a catalogue system and a keyed one`);
