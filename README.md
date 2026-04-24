# gecko_reporting_workflow

`gecko_reporting_workflow` is a small Slack-to-Jira integration service for creating Jira work from Slack while keeping Jira Epics as the parent source of truth.

The initial workflow is configured for the `APIDD` Jira project (`API Data Delivery`). The repository is structured so additional Jira workflows, boards, or filter-backed scopes can be added later without changing the core Slack handling flow.

## What It Does

- Opens a Slack modal from a shortcut or App Home flow
- Searches Jira Epics live for the selected workflow
- Creates `Bug` or `EOD Report` issues in Jira
- Attaches the selected Epic as the parent
- Optionally posts a confirmation message to a Slack test channel

Planned future workflow support includes:

- Epic creation
- Additional board/filter-backed scopes such as `Reporting/Job Board`
- More work types and custom field mappings

## Current Workflow Configuration

The repo starts with one workflow:

- Label: `API Data Delivery`
- Key: `api_data_delivery`
- Jira project: `APIDD`
- Allowed work types:
  - `Bug`
  - `EOD Report`

## Repository Layout

- `src/index.ts`: service entry point
- `src/slack/`: Slack modal and interaction handlers
- `src/jira/`: Jira search and create logic
- `src/config/`: environment loading and workflow definitions
- `src/types/`: shared types
- `config/workflows.json`: workflow routing config
- `slack-manifest.json`: starter Slack app manifest

## Local Setup

1. Copy `.env.example` to `.env` and fill in your Slack and Jira credentials.
2. Install dependencies:

```bash
npm install
```

3. Run the app:

```bash
npm run dev
```

If you want to avoid a public callback URL during development, set `SLACK_USE_SOCKET_MODE=true` and provide an app-level token.

## Slack App Setup

Create a Slack app and enable:

- Interactivity
- A global shortcut, such as `Create Gecko Report`
- Socket Mode for local development, or an HTTPS Request URL for HTTP mode

Recommended bot scopes:

- `chat:write`
- `channels:join`
- `channels:read`
- `commands`

Suggested global shortcut:

- Callback ID: `create_gecko_report`
- Title: `Create Gecko Report`

To let the bot post into a public test channel, either:

- invite the app into the channel with `/invite @YourAppName`, or
- grant `chat:write.public` if you want it to post without joining first

Slack documents both patterns in its official setup and messaging docs:

- [Creating an app from app settings](https://docs.slack.dev/app-management/quickstart-app-settings)
- [conversations.join](https://docs.slack.dev/reference/methods/conversations.join/)

## Jira Setup

Create a Jira API token for the service account and confirm that:

- the account can search Epics in `APIDD`
- the account can create issues in `APIDD`
- `Bug` and `EOD Report` are standard issue types under Epic in your Jira scheme

The initial Epic search JQL is:

```text
project = APIDD AND issuetype = Epic
```

## Adding Another Workflow Later

Add a new entry in `config/workflows.json` with:

- a unique workflow key
- a Slack-facing label
- the target Jira project key
- the allowed issue types
- the Epic search JQL for that board/project/filter scope

That lets you introduce future scopes such as `Reporting/Job Board` without changing the Slack modal contract.
