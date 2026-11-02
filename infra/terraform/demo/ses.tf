# implementation-plan.txt 0.3 / 7.2. The account is in the SES sandbox: mail is only sent FROM and TO
# verified addresses. Creating an identity makes AWS email that address a link; click it once.
# SMTP credentials are NOT made here (they would be in state): create them in the SES console and
# give them to put-secrets.ps1.

resource "aws_sesv2_email_identity" "address" {
  for_each = toset(concat([var.ses_from_address], var.ses_recipient_addresses))

  email_identity = each.key
}
