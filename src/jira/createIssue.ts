import type { CreateIssueInput } from "../types/workflow.js";
import { jiraRequest } from "./client.js";

interface JiraCreateIssueResponse {
  key: string;
  self: string;
}

export async function createIssue(input: CreateIssueInput): Promise<JiraCreateIssueResponse> {
  const payload = {
    fields: {
      project: {
        key: input.workflow.jiraProjectKey
      },
      issuetype: {
        name: input.issueType
      },
      parent: {
        key: input.parentEpicKey
      },
      summary: input.summary,
      description: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: input.details
              }
            ]
          },
          ...(input.requesterName
            ? [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: `Requested from Slack by ${input.requesterName}`
                    }
                  ]
                }
              ]
            : [])
        ]
      }
    }
  };

  return jiraRequest<JiraCreateIssueResponse>("/rest/api/3/issue", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
