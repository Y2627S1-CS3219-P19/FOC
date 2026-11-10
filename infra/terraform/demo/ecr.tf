# aws-infra-plan.txt COMPUTE. One repo per image: foc/<image>.
#   IMMUTABLE    a tag (git SHA) can never be overwritten, so a SHA always means the same image
#   scan_on_push free basic vulnerability scan
#   force_delete lets the final `terraform destroy` remove repos that still hold images

resource "aws_ecr_repository" "app" {
  for_each = toset(local.images)

  name                 = "foc/${each.key}"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }
}

# Count-based, never age-based: old task definition revisions must still be able to pull for a rollback.
# The rule does not know which image is running, so keep enough that failed or push-only builds cannot
# push the running image out (it would then fail to restart or roll back). 10 x 7 repos is ~US$1/month.
resource "aws_ecr_lifecycle_policy" "app" {
  for_each = aws_ecr_repository.app

  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 10 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}
