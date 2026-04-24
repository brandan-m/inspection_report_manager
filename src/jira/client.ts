import { env } from "../config/env.js";

function buildAuthHeader(): string {
  const credentials = Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString("base64");
  return `Basic ${credentials}`;
}

export async function jiraRequest<T>(path: string, init?: RequestInit): Promise<T> {
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

  return (await response.json()) as T;
}
