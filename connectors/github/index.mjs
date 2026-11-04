// GitHub connector: REST API with a personal access token, polling for new issues,
// comments and failed workflow runs. No npm packages.
import { pathToFileURL } from "node:url";
import { ConnectorError, config, secret, createServer, fetchJson, clip, getState, setState, options } from "../_lib/connector.mjs";

const API = "https://api.github.com";

export function build({ env = process.env, fetchImpl = globalThis.fetch, retryScale = 1, output = process.stdout, now = () => new Date() } = {}) {
  const repos = () => (Array.isArray(config(env).repos) ? config(env).repos.map(String) : []);

  async function gh(path, init = {}) {
    const token = secret("token", env);
    if (!token) throw new ConnectorError("No GitHub token yet. Paste it in the setup form first.");
    return fetchJson(API + path, {
      ...init,
      fetchImpl,
      retryScale,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "NeuralAgent",
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });
  }

  const repo = (r) => {
    if (!/^[\w-][\w.-]*\/[\w-][\w.-]*$/.test(String(r || ""))) throw new ConnectorError('The repository must look like "owner/name".');
    return r;
  };
  const issueOut = (i, full) => ({
    number: i.number,
    title: i.title,
    state: i.state,
    author: i.user?.login,
    labels: (i.labels || []).map((l) => l.name || l),
    comments: i.comments,
    url: i.html_url,
    created: i.created_at,
    ...(full ? { body: clip(i.body, 8000) } : {}),
  });

  const tools = {
    whoami: {
      description: "Check the token. Returns the account name.",
      run: async () => {
        const me = await gh("/user");
        return { text: `Signed in as ${me.login}`, login: me.login };
      },
    },
    list_repos: {
      description: "Repositories the token can use, as [{value,label}] with value owner/name.",
      run: async () => options(await gh("/user/repos?per_page=100&sort=pushed"), (r) => r.full_name, (r) => r.full_name + (r.private ? " (private)" : "")),
    },
    list_issues: {
      description: "Issues of a repository (pull requests are left out).",
      schema: { repo: { type: "string", description: "owner/name" }, state: { type: "string", enum: ["open", "closed", "all"] }, labels: { type: "string", description: "comma separated" }, limit: { type: "number" } },
      required: ["repo"],
      run: async ({ repo: r, state = "open", labels, limit = 30 }) => {
        const q = new URLSearchParams({ state, per_page: String(Math.min(+limit || 30, 100)) });
        if (labels) q.set("labels", labels);
        return (await gh(`/repos/${repo(r)}/issues?${q}`)).filter((i) => !i.pull_request).map((i) => issueOut(i));
      },
    },
    get_issue: {
      description: "One issue with its text and its comments.",
      schema: { repo: { type: "string" }, number: { type: "number" } },
      required: ["repo", "number"],
      run: async ({ repo: r, number }) => {
        const [issue, comments] = await Promise.all([gh(`/repos/${repo(r)}/issues/${+number}`), gh(`/repos/${repo(r)}/issues/${+number}/comments?per_page=50`)]);
        return { ...issueOut(issue, true), comment_list: comments.map((c) => ({ id: c.id, author: c.user?.login, text: clip(c.body, 4000), created: c.created_at, url: c.html_url })) };
      },
    },
    list_runs: {
      description: "Recent workflow runs (builds), optionally only failed ones.",
      schema: { repo: { type: "string" }, status: { type: "string", description: "e.g. failure, success" } },
      required: ["repo"],
      run: async ({ repo: r, status }) => {
        const q = new URLSearchParams({ per_page: "20" });
        if (status) q.set("status", status);
        const j = await gh(`/repos/${repo(r)}/actions/runs?${q}`);
        return j.workflow_runs.map((w) => ({ id: w.id, name: w.name, branch: w.head_branch, conclusion: w.conclusion, status: w.status, url: w.html_url, created: w.created_at }));
      },
    },
    comment: {
      description: "Write a comment on an issue. Speaks publicly as the token's account.",
      schema: { repo: { type: "string" }, number: { type: "number" }, text: { type: "string" } },
      required: ["repo", "number", "text"],
      run: async ({ repo: r, number, text }) => {
        const c = await gh(`/repos/${repo(r)}/issues/${+number}/comments`, { method: "POST", body: JSON.stringify({ body: text }) });
        return { sent: true, url: c.html_url };
      },
    },
    label: {
      description: "Add labels to an issue.",
      schema: { repo: { type: "string" }, number: { type: "number" }, labels: { type: "array", items: { type: "string" } } },
      required: ["repo", "number", "labels"],
      run: async ({ repo: r, number, labels }) => {
        const l = await gh(`/repos/${repo(r)}/issues/${+number}/labels`, { method: "POST", body: JSON.stringify({ labels }) });
        return { labels: l.map((x) => x.name) };
      },
    },
    close_issue: {
      description: "Close an issue.",
      schema: { repo: { type: "string" }, number: { type: "number" }, reason: { type: "string", enum: ["completed", "not_planned"] } },
      required: ["repo", "number"],
      run: async ({ repo: r, number, reason = "completed" }) => {
        await gh(`/repos/${repo(r)}/issues/${+number}`, { method: "PATCH", body: JSON.stringify({ state: "closed", state_reason: reason }) });
        return { closed: true };
      },
    },
    poll: {
      description: "Returns { events } for new issues, comments and failed runs since the last call. The first call only sets the starting point.",
      run: async () => {
        const list = repos();
        const first = getState("cursor", null, env) == null;
        const started = now().toISOString();
        const since = getState("cursor", started, env);
        const events = [];
        if (!first) {
          const me = (await gh("/user")).login;
          for (const r of list) {
            const issues = await gh(`/repos/${repo(r)}/issues?state=open&sort=created&direction=desc&since=${encodeURIComponent(since)}&per_page=50`);
            for (const i of issues) {
              if (i.pull_request || i.created_at <= since || i.user?.login === me) continue;
              events.push({ type: "issue", id: `github:${r}#${i.number}`, title: i.title, text: clip(i.body, 6000), author: i.user?.login, url: i.html_url, meta: { repo: r, number: i.number, labels: (i.labels || []).map((l) => l.name) } });
            }
            const comments = await gh(`/repos/${repo(r)}/issues/comments?since=${encodeURIComponent(since)}&sort=created&direction=desc&per_page=50`);
            for (const c of comments) {
              if (c.created_at <= since || c.user?.login === me || c.user?.type === "Bot") continue;
              const number = Number(String(c.issue_url).split("/").pop());
              events.push({ type: "comment", id: `github:${r}:comment:${c.id}`, text: clip(c.body, 6000), author: c.user?.login, url: c.html_url, meta: { repo: r, number } });
            }
            const runs = await gh(`/repos/${repo(r)}/actions/runs?status=failure&created=${encodeURIComponent(">=" + since.slice(0, 19) + "Z")}&per_page=20`);
            for (const w of runs.workflow_runs || []) {
              if (w.created_at <= since) continue;
              events.push({ type: "failed_run", id: `github:${r}:run:${w.id}`, title: `${w.name} failed on ${w.head_branch}`, text: `The workflow "${w.name}" failed on branch ${w.head_branch} (${w.head_sha?.slice(0, 7)}).`, url: w.html_url, meta: { repo: r, run_id: w.id, branch: w.head_branch } });
            }
          }
        }
        setState("cursor", started, env);
        return { events };
      },
    },
  };

  const server = createServer({ name: "github", version: "1.0.0", tools, output });
  return { server, tools, start: () => server.serve() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) build().start();
