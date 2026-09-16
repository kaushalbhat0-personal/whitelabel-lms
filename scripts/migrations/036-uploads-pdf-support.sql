-- 036-uploads-pdf-support.sql
-- Broaden uploads bucket to allow PDF for student file-upload answers

UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/png','image/jpeg','image/gif','image/webp','application/pdf']
WHERE id = 'uploads';
