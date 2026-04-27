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
- `.github/workflows/deploy-prod.yml`: production deployment workflow scaffold
- `Makefile`: image-tag helper used by the GitHub deploy workflow

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

- move to Gecko GCP in Operations PROD

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

### Google Cloud Run Scaffolding

The repo now also includes:

- [.deploy/cloud-run/Chart.yaml](/Users/brandan.moretton/Documents/New%20project/gecko_reporting_workflow/.deploy/cloud-run/Chart.yaml)
- [.deploy/cloud-run/values.yaml](/Users/brandan.moretton/Documents/New%20project/gecko_reporting_workflow/.deploy/cloud-run/values.yaml)
- [.deploy/cloud-run/dev.values.yaml](/Users/brandan.moretton/Documents/New%20project/gecko_reporting_workflow/.deploy/cloud-run/dev.values.yaml)
- [.deploy/cloud-run/prod.values.yaml](/Users/brandan.moretton/Documents/New%20project/gecko_reporting_workflow/.deploy/cloud-run/prod.values.yaml)
- [.github/workflows/deploy-prod.yml](/Users/brandan.moretton/Documents/New%20project/gecko_reporting_workflow/.github/workflows/deploy-prod.yml)
- [Makefile](/Users/brandan.moretton/Documents/New%20project/gecko_reporting_workflow/Makefile)

This mirrors the `.deploy/cloud-run` structure you were shown from the internal `conduit-api` example so a platform owner can deploy this app into the existing Google Cloud process.

Open items to confirm with your cloud/platform team:

- whether `project_name: operations` is the correct GCP project target
- whether `region: us-east1` is correct for this service
- whether `JIRA_EMAIL`, `JIRA_BASE_URL`, and `SLACK_TEST_CHANNEL_ID` should remain secrets or become plain environment variables
- whether the secret names in `values.yaml` match your org’s actual Secret Manager entries
- whether the service name should remain `inspection-report-manager`
- whether the Artifact Registry image naming pattern in the `Makefile` matches your org’s standard
- whether the GitHub Actions runner label should remain `ubuntu-large`

The Terraform `projects/operations/main.tf` changes do not belong in this application repo. A handoff-friendly starter snippet now lives at [docs/cloud-run-infra-snippet.tf](/Users/brandan.moretton/Documents/New%20project/gecko_reporting_workflow/docs/cloud-run-infra-snippet.tf) so your platform team can adapt it inside the shared infrastructure repository.


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
