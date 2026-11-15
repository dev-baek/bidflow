#!/usr/bin/env sh
set -eu

module_dir=infra/terraform/modules/budget

test -f "$module_dir/main.tf"
test -f "$module_dir/variables.tf"
test -f "$module_dir/outputs.tf"

rg -q 'aws_budgets_budget' "$module_dir"
rg -q 'threshold.*80' "$module_dir"
rg -q 'threshold.*100' "$module_dir"
rg -q 'notification_type.*ACTUAL' "$module_dir"
rg -q 'notification_type.*FORECASTED' "$module_dir"
rg -q 'subscriber_email_addresses' "$module_dir"
rg -q 'monthly_budget_amount' "$module_dir"
rg -q 'monthly_budget_currency' "$module_dir"
rg -q 'budget_notification_emails' infra/terraform/bootstrap infra/terraform/environments/verification
rg -q 'NAT Gateway.*Elastic IP.*Snapshot.*Log Group' infra/terraform/README.md

if rg -n --glob '*.tf' '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' infra/terraform; then
  echo 'Budget notification email addresses must not be committed.' >&2
  exit 1
fi
