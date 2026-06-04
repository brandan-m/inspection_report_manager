import { jiraRequest } from "./client.js";

interface JiraUserSearchResult {
  accountId: string;
  displayName: string;
  emailAddress?: string;
  active?: boolean;
}

export interface JiraResolvedUser {
  accountId: string;
  displayName: string;
}

function normalize(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLowerCase() : undefined;
}

async function searchJiraUsers(query: string): Promise<JiraUserSearchResult[]> {
  return jiraRequest<JiraUserSearchResult[]>(
    `/rest/api/3/user/search?query=${encodeURIComponent(query)}&maxResults=20`
  );
}

function pickExactDisplayNameMatch(
  results: JiraUserSearchResult[],
  displayName: string
): JiraResolvedUser | undefined {
  const normalizedDisplayName = normalize(displayName);

  if (!normalizedDisplayName) {
    return undefined;
  }

  const exactMatch = results.find((result) => normalize(result.displayName) === normalizedDisplayName && result.active !== false);

  if (!exactMatch) {
    return undefined;
  }

  return {
    accountId: exactMatch.accountId,
    displayName: exactMatch.displayName
  };
}

function pickSingleActiveResult(results: JiraUserSearchResult[]): JiraResolvedUser | undefined {
  const activeResults = results.filter((result) => result.active !== false);

  if (activeResults.length !== 1) {
    return undefined;
  }

  return {
    accountId: activeResults[0].accountId,
    displayName: activeResults[0].displayName
  };
}

export async function findJiraUserForSlackProfile(input: {
  email?: string;
  displayName?: string;
  realName?: string;
}): Promise<JiraResolvedUser | undefined> {
  if (input.email) {
    const emailResults = await searchJiraUsers(input.email);
    const normalizedEmail = normalize(input.email);
    const exactEmailMatch = emailResults.find(
      (result) => normalize(result.emailAddress) === normalizedEmail && result.active !== false
    );

    if (exactEmailMatch) {
      return {
        accountId: exactEmailMatch.accountId,
        displayName: exactEmailMatch.displayName
      };
    }

    const singleEmailResult = pickSingleActiveResult(emailResults);

    if (singleEmailResult) {
      return singleEmailResult;
    }
  }

  for (const nameCandidate of [input.displayName, input.realName]) {
    if (!nameCandidate) {
      continue;
    }

    const results = await searchJiraUsers(nameCandidate);
    const exactDisplayNameMatch = pickExactDisplayNameMatch(results, nameCandidate);

    if (exactDisplayNameMatch) {
      return exactDisplayNameMatch;
    }

    const singleNameResult = pickSingleActiveResult(results);

    if (singleNameResult) {
      return singleNameResult;
    }
  }

  return undefined;
}
