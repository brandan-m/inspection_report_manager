import type { JiraDocNode } from "../types/workflow.js";
import { jiraRequestWithoutResponse } from "./client.js";

export interface UpdateIssueInput {
  issueKey: string;
  summary?: string;
  details?: string;
  descriptionContent?: JiraDocNode[];
}

export async function updateIssue(input: UpdateIssueInput): Promise<void> {
  const fields: Record<string, unknown> = {};

  if (typeof input.summary === "string" && input.summary.trim().length > 0) {
    fields.summary = input.summary;
  }

  const descriptionContent = input.descriptionContent ?? (
    typeof input.details === "string" && input.details.trim().length > 0
      ? [
          {
            type: "paragraph" as const,
            content: [
              {
                type: "text" as const,
                text: input.details
              }
            ]
          }
        ]
      : undefined
  );

  if (descriptionContent) {
    fields.description = {
      type: "doc",
      version: 1,
      content: descriptionContent
    };
  }

  if (Object.keys(fields).length === 0) {
    return;
  }

  await jiraRequestWithoutResponse(`/rest/api/3/issue/${encodeURIComponent(input.issueKey)}`, {
    method: "PUT",
    body: JSON.stringify({
      fields
    })
  });
}
