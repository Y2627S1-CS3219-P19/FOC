output "state_bucket" {
  description = "Bucket name for the demo stack's S3 backend."
  value       = aws_s3_bucket.tfstate.bucket
}
