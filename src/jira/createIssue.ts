import type { CreateIssueInput } from "../types/workflow.js";
import { jiraRequest } from "./client.js";

interface JiraCreateIssueResponse {
  key: string;
  self: string;
}

interface JiraIssueResponse {
  fields: {
    summary: string;
  };
}

interface JiraCreateMetaResponse {
  projects: Array<{
    issuetypes: Array<{
      fields: Record<
        string,
        {
          name: string;
          allowedValues?: Array<{
            id: string;
            value: string;
          }>;
        }
      >;
    }>;
  }>;
}

async function getIssueSummary(issueKey: string): Promise<string> {
  const result = await jiraRequest<JiraIssueResponse>(`/rest/api/3/issue/${issueKey}?fields=summary`);
  return result.fields.summary;
}
async function getCreateFields(projectKey: string, issueType: string) {
  const result = await jiraRequest<JiraCreateMetaResponse>(
    `/rest/api/3/issue/createmeta?projectKeys=${encodeURIComponent(projectKey)}&issuetypeNames=${encodeURIComponent(issueType)}&expand=projects.issuetypes.fields`
  );

  const fields = result.projects[0]?.issuetypes[0]?.fields;

  if (!fields) {
    throw new Error(`Could not load create metadata for ${projectKey} ${issueType}.`);
  }

  return fields;
}

export async function createIssue(input: CreateIssueInput): Promise<JiraCreateIssueResponse> {
  const fields: Record<string, unknown> = {
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
  };

  if (input.workflow.jiraProjectKey === "RB" && input.issueType === "Bug") {
    if (!input.blockerType) {
      throw new Error("RUG Blocker Type is required for Reporting/Job Board Bugs.");
    }

    if (typeof input.opsDowntimeHours !== "number" || Number.isNaN(input.opsDowntimeHours)) {
      throw new Error("RUG Ops Downtime (hours) is required for Reporting/Job Board Bugs.");
    }

    const createFields = await getCreateFields(input.workflow.jiraProjectKey, input.issueType);

    const blockerTypeOption = createFields.customfield_16963?.allowedValues?.find(
      (option) => option.value === input.blockerType
    );

    if (!blockerTypeOption) {
      throw new Error(`Could not map blocker type "${input.blockerType}" to a Jira option.`);
    }

    fields.customfield_16963 = { id: blockerTypeOption.id };
    fields.customfield_16964 = input.opsDowntimeHours;
  }

  const payload = {
    fields: {
      ...fields
    }
  };

  return jiraRequest<JiraCreateIssueResponse>("/rest/api/3/issue", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
