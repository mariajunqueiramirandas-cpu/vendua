import { githubClient, type GitHubClient } from './github.ts';
import { claudeRoutineRunner, type SiteRunner } from './runners.ts';

// The site builder's collaborators, read once from the environment. Every one is optional: a
// missing one parks its part of the feature (tasks wait, webhooks answer 404), never a crash.
export interface SiteDeps {
  /** null = VENDUA_SITE_ROUTINE_URL/TOKEN unset: queued tasks wait */
  runner: SiteRunner | null;
  /** null = VENDUA_GITHUB_REPO/TOKEN unset: approved tasks wait for a merge by hand */
  github: GitHubClient | null;
  /** null = VENDUA_GITHUB_WEBHOOK_SECRET unset: the webhook answers 404 */
  webhookSecret: string | null;
}

export function siteDeps(o: {
  routineUrl?: string | null | undefined;
  routineToken?: string | null | undefined;
  repo?: string | null | undefined;
  githubToken?: string | null | undefined;
  webhookSecret?: string | null | undefined;
  fetch?: typeof fetch;
}): SiteDeps {
  const url = o.routineUrl?.trim();
  const token = o.routineToken?.trim();
  const repo = o.repo?.trim();
  const ghToken = o.githubToken?.trim();
  return {
    runner:
      url && token && /^https?:\/\//.test(url)
        ? claudeRoutineRunner({ url, token, ...(o.fetch ? { fetch: o.fetch } : {}) })
        : null,
    github:
      repo && ghToken
        ? githubClient({ repo, token: ghToken, ...(o.fetch ? { fetch: o.fetch } : {}) })
        : null,
    webhookSecret: o.webhookSecret?.trim() || null,
  };
}

export function siteDepsFromEnv(): SiteDeps {
  const env = process.env;
  return siteDeps({
    routineUrl: env.VENDUA_SITE_ROUTINE_URL,
    routineToken: env.VENDUA_SITE_ROUTINE_TOKEN,
    repo: env.VENDUA_GITHUB_REPO,
    githubToken: env.VENDUA_GITHUB_TOKEN,
    webhookSecret: env.VENDUA_GITHUB_WEBHOOK_SECRET,
  });
}
