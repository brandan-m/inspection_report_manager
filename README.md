# gecko_reporting_workflow

`gecko_reporting_workflow` is a small Slack-to-Jira integration service for creating Jira work from Slack while keeping Jira Epics as the parent source of truth.

The repository is structured so additional Jira workflows, boards, or filter-backed scopes can be added later without changing the core Slack handling flow.

## What It Does

- Opens a Slack modal from a shortcut or App Home flow
- Searches Jira Epics live for the selected workflow
- Creates `Bug` or `EOD Report` issues in Jira
- Attaches the selected Epic as the parent
- Optionally posts a confirmation message to a Slack test channel
- Supports workflow-specific required fields, such as the `Reporting/Job Board` Bug requirements

## Current Workflow Configuration

The repo currently includes:

- Label: `API Data Delivery`
- Key: `api_data_delivery`
- Jira project: `APIDD`
- Allowed work types:
  - `Bug`
  - `EOD Report`
- Label: `Reporting/Job Board`
- Key: `reporting_job_board`
- Jira project: `RB`
- Allowed work types:
  - `Bug`
  - `EOD Report`
- Additional Bug fields:
  - `RUG Blocker Type`
  - `RUG Ops Downtime (hours)`

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

For a production-style local check:

```bash
npm run build
npm start
```

To mirror the deployed runtime locally with Docker:

```bash
docker build -t gecko-reporting-workflow .
docker run --env-file .env -p 3000:3000 gecko-reporting-workflow
```

## Slack App Setup

Create a Slack app and enable:

- Interactivity
- App Home
- A global shortcut, such as `Create Gecko Report`
- Socket Mode for local development, or an HTTPS Request URL for HTTP mode

Recommended bot scopes:

- `chat:write`
- `channels:join`
- `channels:read`
- `commands`
- `im:write`

Suggested global shortcut:

- Callback ID: `create_gecko_report`
- Title: `Create Gecko Report`

To let the bot post into a public test channel, either:

- invite the app into the channel with `/invite @YourAppName`, or
- grant `chat:write.public` if you want it to post without joining first

Slack documents both patterns in its official setup and messaging docs:

- [Creating an app from app settings](https://docs.slack.dev/app-management/quickstart-app-settings)
- [conversations.join](https://docs.slack.dev/reference/methods/conversations.join/)

Recommended App Home setup:

- Enable the Home tab
- Subscribe to the bot event `app_home_opened`
- Reinstall the app after changing scopes, events, or App Home settings

## Jira Setup

Create a Jira API token for the service account and confirm that:

- the account can search Epics in `APIDD`
- the account can create issues in `APIDD`
- the account can search Epics in `RB`
- the account can create issues in `RB`
- `Bug` and `EOD Report` are standard issue types under Epic in your Jira scheme
- any workflow-specific required fields are either present in the modal or no longer required in Jira

The initial Epic search JQL is:

```text
project = APIDD AND issuetype = Epic
```

## Testing Flow

For a local smoke test:

1. Start the app with `npm run dev`
2. Open `Gecko Reporting Workflow` in Slack
3. Use the App Home button to open the modal
4. Verify:
   - `API Data Delivery` only shows APIDD Epics
   - `Reporting/Job Board` only shows RB Epics
   - RB Bug flows show the extra required fields
   - EOD flows do not show RB-only Bug fields

## Deployment Notes

For a persistent deployment, move the app off a laptop and into a long-running environment such as:

- Render
- Railway
- Fly.io
- an internal container or VM

Deployment checklist:

- store Slack and Jira secrets outside the repo
- keep Socket Mode enabled, or switch to HTTPS-based event delivery
- reinstall the Slack app after any scope or manifest changes
- document the workflow config and board/project mappings in `config/workflows.json`

### Docker-Based Deployment

The repo now includes:

- [Dockerfile](/Users/brandan.moretton/Documents/New%20project/gecko_reporting_workflow/Dockerfile)
- [entrypoint.sh](/Users/brandan.moretton/Documents/New%20project/gecko_reporting_workflow/entrypoint.sh)
- [.dockerignore](/Users/brandan.moretton/Documents/New%20project/gecko_reporting_workflow/.dockerignore)

This is the closest match to the `gecko_salesforce` methodology: build the app into a container and run the container as the always-on service.

Basic Docker flow:

```bash
docker build -t gecko-reporting-workflow .
docker run --env-file .env -p 3000:3000 gecko-reporting-workflow
```

If your host platform deploys containers directly, you can use this Dockerfile instead of the Render-native `render.yaml`.

### Render Example

The repo now includes [render.yaml](/Users/brandan.moretton/Documents/New%20project/gecko_reporting_workflow/render.yaml) for a simple Render deployment using Socket Mode.

To deploy on Render:

1. Create a new Web Service from the GitHub repo
2. Let Render detect `render.yaml`, or point it at that file
3. Set the secret env vars in Render:
   - `SLACK_BOT_TOKEN`
   - `SLACK_SIGNING_SECRET`
   - `SLACK_APP_TOKEN`
   - `SLACK_TEST_CHANNEL_ID`
   - `JIRA_BASE_URL`
   - `JIRA_EMAIL`
   - `JIRA_API_TOKEN`
4. Deploy
5. After the service is live, confirm the Slack app still works from App Home

Because the app is using Socket Mode, you do not need a public Slack events URL for this deployment model.

### Production Checklist

Before calling it production-ready:

- verify `npm run build && npm start` works in the host environment
- confirm Slack scopes include `im:write` if you want DM confirmations
- verify both APIDD and RB flows against live Jira
- decide whether `SLACK_TEST_CHANNEL_ID` should stay as a test channel or move to a production notifications channel
- document ownership for future workflow config changes

## Adding Another Workflow Later

Add a new entry in `config/workflows.json` with:

- a unique workflow key
- a Slack-facing label
- the target Jira project key
- the allowed issue types
- the Epic search JQL for that board/project/filter scope

That lets you introduce future scopes such as `Reporting/Job Board` without changing the Slack modal contract.
