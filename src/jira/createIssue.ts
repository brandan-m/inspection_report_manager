import type { CreateIssueInput } from "../types/workflow.js";
import { jiraRequest } from "./client.js";

interface JiraCreateIssueResponse {
  key: string;
  self: string;
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
  const descriptionContent = input.descriptionContent ?? [
    {
      type: "paragraph" as const,
      content: [
        {
          type: "text" as const,
          text: input.details
        }
      ]
    }
  ];

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
        ...descriptionContent,
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

  if (
    (input.workflow.jiraProjectKey === "RB" || input.workflow.jiraProjectKey === "APIDD") &&
    input.issueType === "Bug"
  ) {
    const isApiWorkflow = input.workflow.jiraProjectKey === "APIDD";
    const blockerTypeLabel = isApiWorkflow ? "API Blocker Type" : "RUG Blocker Type";
    const downtimeLabel = isApiWorkflow ? "API Ops Downtime (hours)" : "RUG Ops Downtime (hours)";
    const blockerTypeFieldId = isApiWorkflow ? "customfield_17561" : "customfield_16963";
    const downtimeFieldId = isApiWorkflow ? "customfield_17562" : "customfield_16964";

    if (!input.blockerType) {
      throw new Error(`${blockerTypeLabel} is required for ${input.workflow.label} Bugs.`);
    }

    if (typeof input.opsDowntimeHours !== "number" || Number.isNaN(input.opsDowntimeHours)) {
      throw new Error(`${downtimeLabel} is required for ${input.workflow.label} Bugs.`);
    }

    const createFields = await getCreateFields(input.workflow.jiraProjectKey, input.issueType);

    const blockerTypeOption = createFields[blockerTypeFieldId]?.allowedValues?.find(
      (option) => option.value === input.blockerType
    );

    if (!blockerTypeOption) {
      throw new Error(`Could not map blocker type "${input.blockerType}" to a Jira option.`);
    }

    fields[blockerTypeFieldId] = { id: blockerTypeOption.id };
    fields[downtimeFieldId] = input.opsDowntimeHours;
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
