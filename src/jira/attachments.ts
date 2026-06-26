import { jiraRequestWithoutResponse } from "./client.js";

export interface JiraAttachmentUploadInput {
  issueKey: string;
  filename: string;
  contentType?: string;
  data: Buffer;
}

export async function uploadAttachmentToIssue(input: JiraAttachmentUploadInput): Promise<void> {
  const formData = new FormData();

  formData.append(
    "file",
    new Blob([input.data], {
      type: input.contentType ?? "application/octet-stream"
    }),
    input.filename
  );

  await jiraRequestWithoutResponse(`/rest/api/3/issue/${encodeURIComponent(input.issueKey)}/attachments`, {
    method: "POST",
    headers: {
      "X-Atlassian-Token": "no-check"
    },
    body: formData
  });
}
