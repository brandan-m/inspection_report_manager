import type { EpicOption, IssueOption, WorkflowDefinition, WorkflowParentIssueType } from "../types/workflow.js";
import { jiraRequest } from "./client.js";

interface JiraSearchResponse {
  issues: Array<{
    key: string;
    fields: {
      summary: string;
    };
  }>;
}

interface JiraIssueResponse {
  fields: {
    summary: string;
  };
}

let jiraSearchPath: "/rest/api/3/search/jql" | "/rest/api/3/search" = "/rest/api/3/search/jql";

export function getWorkflowParentIssueType(workflow: WorkflowDefinition): WorkflowParentIssueType {
  return workflow.parentIssueType ?? "Epic";
}

export function buildParentSearchJql(workflow: WorkflowDefinition, query: string): string {
  const escaped = query.replace(/"/g, '\\"').trim();
  const baseJql = `${workflow.epicSearchJql} AND status != Closed`;

  if (!escaped) {
    return `${baseJql} ORDER BY updated DESC`;
  }

  return `${baseJql} AND (summary ~ "${escaped}*" OR key ~ "${escaped}*") ORDER BY updated DESC`;
}

export function buildEpicSearchJql(workflow: WorkflowDefinition, query: string): string {
  return buildParentSearchJql(workflow, query);
}

export async function searchParentIssues(workflow: WorkflowDefinition, query: string): Promise<IssueOption[]> {
  const jql = buildParentSearchJql(workflow, query);
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
      throw new Error(`Jira parent issue search failed using ${jiraSearchPath}.`);
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

export async function searchEpics(workflow: WorkflowDefinition, query: string): Promise<EpicOption[]> {
  return searchParentIssues(workflow, query);
}

export async function searchChildTasks(
  workflow: WorkflowDefinition,
  parentEpicKey: string,
  query: string
): Promise<IssueOption[]> {
  const escapedParentKey = parentEpicKey.replace(/"/g, '\\"').trim();
  const escapedQuery = query.replace(/"/g, '\\"').trim();
  const scopedJqlBases = [
    `project = ${workflow.jiraProjectKey} AND issuetype = Task AND parentEpic = "${escapedParentKey}"`,
    `project = ${workflow.jiraProjectKey} AND issuetype = Task AND "Epic Link" = "${escapedParentKey}"`,
    `project = ${workflow.jiraProjectKey} AND issuetype = Task AND parent = "${escapedParentKey}"`
  ];
  const fallbackJqlBase = `project = ${workflow.jiraProjectKey} AND issuetype = Task`;

  async function runTaskSearch(jqlBase: string): Promise<IssueOption[]> {
    const jql = escapedQuery
      ? `${jqlBase} AND (summary ~ "${escapedQuery}*" OR key ~ "${escapedQuery}*") ORDER BY updated DESC`
      : `${jqlBase} ORDER BY updated DESC`;
    const payload = {
      jql,
      fields: ["summary"],
      maxResults: 20
    };

    try {
      const result = await jiraRequest<JiraSearchResponse>(jiraSearchPath, {
        method: "POST",
        body: JSON.stringify(payload)
      });

      return result.issues.map((issue) => ({
        key: issue.key,
        summary: issue.fields.summary
      }));
    } catch {
      jiraSearchPath = "/rest/api/3/search";
      const result = await jiraRequest<JiraSearchResponse>("/rest/api/3/search", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      return result.issues.map((issue) => ({
        key: issue.key,
        summary: issue.fields.summary
      }));
    }
  }

  for (const jqlBase of scopedJqlBases) {
    try {
      const issues = await runTaskSearch(jqlBase);
      if (issues.length > 0) {
        return issues;
      }
    } catch {
      continue;
    }
  }

  return runTaskSearch(fallbackJqlBase);
}

export async function getIssueSummary(issueKey: string): Promise<string> {
  const result = await jiraRequest<JiraIssueResponse>(
    `/rest/api/3/issue/${encodeURIComponent(issueKey.trim())}?fields=summary`
  );

  return result.fields.summary;
}
