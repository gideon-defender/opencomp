-- Unknown legacy models remain NULL and cannot pass the current-model query guard.
-- Incremental document sync rebuilds them before retrieval; no vectors are deleted here.
ALTER TABLE "vector_embedding" ADD COLUMN "embeddingModel" TEXT;
