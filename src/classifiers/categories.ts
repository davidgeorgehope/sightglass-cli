// ── Tool Category Taxonomy ──
// Maps packages to high-level categories for aggregate analysis

export const TOOL_CATEGORIES: Record<string, string[]> = {
  "CI/CD": ["github-actions", "gitlab-ci", "circleci", "jenkins", "travis-ci", "drone", "buildkite", "woodpecker"],
  "Authentication": ["passport", "jsonwebtoken", "bcrypt", "bcryptjs", "jose", "next-auth", "clerk", "auth0", "firebase-auth", "supabase-auth", "lucia", "arctic", "oslo", "better-auth", "devise", "authlib"],
  "State Management": ["zustand", "redux", "mobx", "jotai", "recoil", "valtio", "xstate", "pinia", "nanostores", "effector", "redux-toolkit", "@reduxjs/toolkit"],
  "ORM/Database": ["prisma", "drizzle", "drizzle-orm", "sequelize", "typeorm", "mongoose", "knex", "kysely", "sqlalchemy", "gorm", "diesel", "sea-orm", "mikro-orm", "objection", "bookshelf", "activerecord"],
  "UI Components": ["shadcn-ui", "@shadcn/ui", "material-ui", "@mui/material", "chakra-ui", "@chakra-ui/react", "ant-design", "antd", "radix-ui", "@radix-ui/react-dialog", "headless-ui", "@headlessui/react", "daisyui", "mantine", "@mantine/core"],
  "CSS/Styling": ["tailwindcss", "styled-components", "@emotion/react", "emotion", "sass", "css-modules", "vanilla-extract", "linaria", "stitches", "unocss", "windicss"],
  "Testing": ["jest", "vitest", "mocha", "pytest", "playwright", "@playwright/test", "cypress", "testing-library", "@testing-library/react", "supertest", "rspec", "nock", "msw"],
  "HTTP Client": ["axios", "node-fetch", "undici", "got", "ky", "requests", "httpx", "reqwest", "superagent", "ofetch"],
  "Payments": ["stripe", "@stripe/stripe-js", "paypal", "square", "braintree", "lemonsqueezy", "@lemonsqueezy/lemonsqueezy.js"],
  "Deployment": ["vercel", "railway", "netlify", "fly-io", "render", "cloudflare-pages", "wrangler", "docker", "dockerfile"],
  "Observability": ["sentry", "@sentry/node", "datadog", "dd-trace", "pino", "winston", "opentelemetry", "@opentelemetry/sdk-node", "newrelic", "bunyan", "morgan", "loglevel"],
  "Caching": ["redis", "ioredis", "memcached", "keyv", "node-cache", "lru-cache", "cacheable", "catbox"],
  "Validation": ["zod", "yup", "joi", "class-validator", "ajv", "valibot", "typebox", "@sinclair/typebox", "superstruct", "io-ts"],
  "API Framework": ["express", "fastapi", "hono", "koa", "fastify", "nestjs", "@nestjs/core", "django", "flask", "gin", "echo", "fiber", "actix-web", "axum", "chi", "rails", "sinatra"],
  "Real-time": ["socket.io", "ws", "pusher", "ably", "livekit", "phoenix-channels", "sockjs", "engine.io", "partykit"],
  "File Upload": ["multer", "formidable", "busboy", "uploadthing", "filepond", "tus", "uppy"],
  "Email": ["nodemailer", "resend", "@sendgrid/mail", "sendgrid", "ses", "postmark", "mailgun", "react-email"],
  "Job Queue": ["bullmq", "bull", "celery", "bee-queue", "agenda", "pg-boss", "temporal", "sidekiq", "graphile-worker"],
  "Feature Flags": ["launchdarkly", "unleash", "flagsmith", "growthbook", "@growthbook/growthbook", "flipt", "posthog"],
  "Package Manager": ["npm", "yarn", "pnpm", "bun"],
};

// Reverse lookup: package name → category
const _packageToCategory = new Map<string, string>();
for (const [category, packages] of Object.entries(TOOL_CATEGORIES)) {
  for (const pkg of packages) {
    _packageToCategory.set(pkg.toLowerCase(), category);
  }
}

/** Look up which category a package belongs to, or null if uncategorized */
export function categorizePackage(name: string): string | null {
  // Direct match
  const direct = _packageToCategory.get(name.toLowerCase());
  if (direct) return direct;

  // Try without scope prefix (@scope/pkg → pkg)
  if (name.startsWith("@")) {
    const withoutScope = name.replace(/^@[^/]+\//, "");
    const scopeless = _packageToCategory.get(withoutScope.toLowerCase());
    if (scopeless) return scopeless;
  }

  // Fuzzy: check if package name contains a known package name
  for (const [pkg, cat] of _packageToCategory.entries()) {
    if (name.toLowerCase().includes(pkg) || pkg.includes(name.toLowerCase())) {
      return cat;
    }
  }

  return null;
}

/** Get all categories */
export function getCategories(): string[] {
  return Object.keys(TOOL_CATEGORIES);
}

/** Get all packages in a category */
export function getCategoryPackages(category: string): string[] {
  return TOOL_CATEGORIES[category] ?? [];
}
