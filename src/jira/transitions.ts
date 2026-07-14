import { jiraRequest, jiraRequestWithoutResponse } from "./client.js";
import { getIssueDetails } from "./searchEpics.js";

interface JiraTransitionsResponse {
  transitions: Array<{
    id: string;
    name: string;
    to: {
      name: string;
    };
  }>;
}

function normalizeStatusName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function transitionIssueToStatus(issueKey: string, targetStatusName: string): Promise<void> {
  const issue = await getIssueDetails(issueKey);
  const normalizedTarget = normalizeStatusName(targetStatusName);

  if (issue.statusName && normalizeStatusName(issue.statusName) === normalizedTarget) {
    return;
  }

  const transitions = await jiraRequest<JiraTransitionsResponse>(
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`
  );
  const transition = transitions.transitions.find(
    (item) => normalizeStatusName(item.to.name) === normalizedTarget || normalizeStatusName(item.name) === normalizedTarget
  );

  if (!transition) {
    throw new Error(`Could not find a Jira transition to status "${targetStatusName}" for ${issueKey}.`);
  }

  await jiraRequestWithoutResponse(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, {
    method: "POST",
    body: JSON.stringify({
      transition: {
        id: transition.id
      }
    })
  });
}
