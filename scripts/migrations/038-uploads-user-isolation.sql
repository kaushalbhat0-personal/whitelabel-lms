-- 038-uploads-user-isolation.sql
-- Harden uploads bucket RLS for question-answers to be user-isolated.
-- Keeps first folder question-answers for existing policy, adds auth.uid() check on second folder.
-- Prevents cross-user read/write even if path is guessed.

-- Drop existing permissive policies if they exist (idempotent)
DROP POLICY IF EXISTS "Authenticated users can upload to uploads" ON storage.objects;
DROP POLICY IF EXISTS "Users can read own uploads" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload own question answers" ON storage.objects;
DROP POLICY IF EXISTS "Users can read own question answers" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own question answers" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own question answers" ON storage.objects;

-- Ensure RLS is enabled (already enabled by Supabase, but idempotent)
-- No ALTER needed as storage.objects has RLS enabled by default

-- INSERT: only allow authenticated to insert under question-answers/{auth.uid()}/...
CREATE POLICY "Users can upload own question answers"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'uploads'
  AND (storage.foldername(name))[1] = 'question-answers'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

-- SELECT: only allow reading own objects under question-answers/{uid}/
CREATE POLICY "Users can read own question answers"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'uploads'
  AND (storage.foldername(name))[1] = 'question-answers'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

-- UPDATE: only owner can update own objects
CREATE POLICY "Users can update own question answers"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'uploads'
  AND (storage.foldername(name))[1] = 'question-answers'
  AND (storage.foldername(name))[2] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'uploads'
  AND (storage.foldername(name))[1] = 'question-answers'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

-- DELETE: only owner can delete own objects
CREATE POLICY "Users can delete own question answers"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'uploads'
  AND (storage.foldername(name))[1] = 'question-answers'
  AND (storage.foldername(name))[2] = auth.uid()::text
);
