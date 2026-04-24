import type { EpicOption, WorkflowDefinition } from "../types/workflow.js";
import { jiraRequest } from "./client.js";

interface JiraSearchResponse {
  issues: Array<{
    key: string;
    fields: {
      summary: string;
    };
  }>;
}

function buildEpicSearchJql(workflow: WorkflowDefinition, query: string): string {
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

  const result = await jiraRequest<JiraSearchResponse>("/rest/api/3/search/jql", {
    method: "POST",
    body: JSON.stringify(payload)
  });

  return result.issues.map((issue) => ({
    key: issue.key,
    summary: issue.fields.summary
  }));
}
