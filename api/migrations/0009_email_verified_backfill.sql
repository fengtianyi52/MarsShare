-- +goose Up
-- Backfill: mark all users created before the email-verification feature as
-- already verified, so they can continue to log in if the admin later
-- enables the verify-on-register toggle.
--
-- Only users with email_verified = FALSE and no corresponding email token
-- are affected (i.e. they registered before the feature existed).
UPDATE users
SET email_verified = TRUE, email_verified_at = created_at
WHERE email_verified = FALSE
  AND NOT EXISTS (
      SELECT 1 FROM email_tokens
      WHERE email_tokens.user_id = users.id
        AND email_tokens.token_type = 'email_verification'
  );

-- +goose Down
-- Cannot safely reverse this migration (we don't know which users were
-- truly verified vs. which ones were backfilled).
