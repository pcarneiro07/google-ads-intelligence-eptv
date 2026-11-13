-- TEMPLATE FOR ADMINISTRATIVE REVIEW ONLY. Do not run from the deployment job.
-- Replace the subject with the exact GitHub environment subject approved by IT.
-- No passwords, private keys, tokens, or wildcard trust.
-- SECURITYADMIN (or delegated CREATE USER / role administration privileges).
CREATE USER EPTV_ADS_GITHUB_REVIEW
  TYPE = SERVICE
  WORKLOAD_IDENTITY = (
    TYPE = OIDC
    ISSUER = 'https://token.actions.githubusercontent.com'
    SUBJECT = '<EXACT_APPROVED_GITHUB_ENVIRONMENT_SUBJECT>'
  )
  DEFAULT_ROLE = EPTV_ADS_APP_OWNER;
GRANT ROLE EPTV_ADS_APP_OWNER TO USER EPTV_ADS_GITHUB_REVIEW;

-- Typical subject (verify actual organization policy, including immutable IDs):
-- repo:ORG/REPO:environment:review
-- Because environment subjects do not bind a branch, restrict deployment branches
-- in GitHub Environment settings to migration/snowflake-app-runtime.
-- Do not grant roles owning ACIDADEON_INTELLIGENCE or broad future-object grants.
