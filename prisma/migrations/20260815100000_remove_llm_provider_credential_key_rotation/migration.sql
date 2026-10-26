-- BYOK uses one deployment-owned encryption key. Key identifiers existed only
-- to support key-ring rotation, which is intentionally not part of the feature.
ALTER TABLE "llm_provider_credentials"
    DROP COLUMN "encryption_key_id";
