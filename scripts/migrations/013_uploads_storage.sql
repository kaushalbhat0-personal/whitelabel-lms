-- Create uploads storage bucket for question answer images
INSERT INTO storage.buckets (id, name, public, avif_autodetection, file_size_limit, allowed_mime_types)
VALUES ('uploads', 'uploads', false, false, 10485760, ARRAY['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to the uploads bucket
CREATE POLICY "Authenticated users can upload to uploads"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'uploads');

-- Allow users to read their own uploads
CREATE POLICY "Users can read own uploads"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'uploads' AND (storage.foldername(name))[1] = 'question-answers');
