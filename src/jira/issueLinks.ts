import { jiraRequest, jiraRequestWithoutResponse } from "./client.js";

interface JiraIssueLinkType {
  id: string;
  name: string;
  inward: string;
  outward: string;
}

interface JiraIssueLinkTypesResponse {
  issueLinkTypes: JiraIssueLinkType[];
}

interface LinkIssuesInput {
  issueKey: string;
  relatedIssueKey: string;
  relationshipText: string;
}

async function getIssueLinkTypes(): Promise<JiraIssueLinkType[]> {
  const response = await jiraRequest<JiraIssueLinkTypesResponse>("/rest/api/3/issueLinkType");
  return response.issueLinkTypes ?? [];
}

function buildLinkPayload(input: LinkIssuesInput, issueLinkType: JiraIssueLinkType) {
  if (issueLinkType.outward === input.relationshipText) {
    return {
      outwardIssue: {
        key: input.issueKey
      },
      inwardIssue: {
        key: input.relatedIssueKey
      },
      type: {
        name: issueLinkType.name
      }
    };
  }

  if (issueLinkType.inward === input.relationshipText) {
    return {
      outwardIssue: {
        key: input.relatedIssueKey
      },
      inwardIssue: {
        key: input.issueKey
      },
      type: {
        name: issueLinkType.name
      }
    };
  }

  throw new Error(`Issue link type ${issueLinkType.name} does not support relationship "${input.relationshipText}".`);
}

export async function linkIssuesByRelationship(input: LinkIssuesInput): Promise<void> {
  const issueLinkType = (await getIssueLinkTypes()).find(
    (linkType) => linkType.outward === input.relationshipText || linkType.inward === input.relationshipText
  );

  if (!issueLinkType) {
    throw new Error(`Could not find a Jira issue link type for relationship "${input.relationshipText}".`);
  }

  await jiraRequestWithoutResponse("/rest/api/3/issueLink", {
    method: "POST",
    body: JSON.stringify(buildLinkPayload(input, issueLinkType))
  });
}
