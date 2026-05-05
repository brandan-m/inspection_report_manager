module "inspection_report_manager_service" {
  source = "../../modules/cloud-run"

  name    = "inspection-report-manager"
  project = module.operations_project.project_id

  allow_public_to_invoke = true

  cost_labels = {
    team = local.common.stack_default_team
    cogs = local.common.stack_default_cogs
  }
}

############################################
# THESE SECRETS MUST BE MANUALLY POPULATED #
############################################

module "inspection_report_manager_secrets" {
  for_each = toset([
    "inspection-report-manager-jira-api-token",
    "jira-base-url",
    "inspection-report-manager-jira-email",
    "inspection-report-manager-slack-app-token",
    "inspection-report-manager-slack-bot-token",
    "inspection-report-manager-slack-signing-secret",
    "slack-test-channel-id"
  ])
  source = "../../modules/secret"

  project = module.operations_project.project_id
  name    = each.value

  service_accounts_with_access = [module.inspection_report_manager_service.service_account_email]

  developers_can_access = true
}
