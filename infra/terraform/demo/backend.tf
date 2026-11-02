# State in the bootstrap bucket. use_lockfile = S3-native locking (a .tflock object next to the state),
# so two people cannot apply at the same time. No DynamoDB table needed.
terraform {
  backend "s3" {
    bucket       = "foc-tfstate-698766074984"
    key          = "demo/terraform.tfstate"
    region       = "ap-southeast-1"
    use_lockfile = true
    encrypt      = true
  }
}
