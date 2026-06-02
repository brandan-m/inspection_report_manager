import { env } from "../config/env.js";

function buildAuthHeader(): string {
  const credentials = Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString("base64");
  return `Basic ${credentials}`;
}

async function jiraFetch(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${env.JIRA_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: buildAuthHeader(),
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Jira request failed (${response.status}): ${body}`);
  }

  return response;
}

export async function jiraRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await jiraFetch(path, init);
  const body = await response.text();

  if (!body) {
    return undefined as T;
  }

  return JSON.parse(body) as T;
}

export async function jiraRequestWithoutResponse(path: string, init?: RequestInit): Promise<void> {
  await jiraFetch(path, init);
}
