import type { EpicOption, IssueOption, WorkflowDefinition } from "../types/workflow.js";
import { jiraRequest } from "./client.js";

interface JiraSearchResponse {
  issues: Array<{
    key: string;
    fields: {
      summary: string;
    };
  }>;
}

let jiraSearchPath: "/rest/api/3/search/jql" | "/rest/api/3/search" = "/rest/api/3/search/jql";

export function buildEpicSearchJql(workflow: WorkflowDefinition, query: string): string {
  const escaped = query.replace(/"/g, '\\"').trim();

  if (!escaped) {
    return `${workflow.epicSearchJql} ORDER BY updated DESC`;
  }

  return `${workflow.epicSearchJql} AND (summary ~ "${escaped}*" OR key ~ "${escaped}*") ORDER BY updated DESC`;
}

export async function searchEpics(workflow: WorkflowDefinition, query: string): Promise<EpicOption[]> {
  const jql = buildEpicSearchJql(workflow, query);
  const payload = {
    jql,
    fields: ["summary"],
    maxResults: 20
  };

  let result: JiraSearchResponse;

  try {
    result = await jiraRequest<JiraSearchResponse>(jiraSearchPath, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  } catch {
    if (jiraSearchPath === "/rest/api/3/search") {
      throw new Error(`Jira Epic search failed using ${jiraSearchPath}.`);
    }

    jiraSearchPath = "/rest/api/3/search";
    result = await jiraRequest<JiraSearchResponse>("/rest/api/3/search", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  return result.issues.map((issue) => ({
    key: issue.key,
    summary: issue.fields.summary
  }));
}

export async function searchChildTasks(
  workflow: WorkflowDefinition,
  parentEpicKey: string,
  query: string
): Promise<IssueOption[]> {
  const escapedParentKey = parentEpicKey.replace(/"/g, '\\"').trim();
  const escapedQuery = query.replace(/"/g, '\\"').trim();
  const jqlBase = `project = ${workflow.jiraProjectKey} AND issuetype = Task AND parent = "${escapedParentKey}"`;
  const jql = escapedQuery
    ? `${jqlBase} AND (summary ~ "${escapedQuery}*" OR key ~ "${escapedQuery}*") ORDER BY updated DESC`
    : `${jqlBase} ORDER BY updated DESC`;
  const payload = {
    jql,
    fields: ["summary"],
    maxResults: 20
  };

  let result: JiraSearchResponse;

  try {
    result = await jiraRequest<JiraSearchResponse>(jiraSearchPath, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  } catch {
    if (jiraSearchPath === "/rest/api/3/search") {
      throw new Error(`Jira child task search failed using ${jiraSearchPath}.`);
    }

    jiraSearchPath = "/rest/api/3/search";
    result = await jiraRequest<JiraSearchResponse>("/rest/api/3/search", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  return result.issues.map((issue) => ({
    key: issue.key,
    summary: issue.fields.summary
  }));
}
